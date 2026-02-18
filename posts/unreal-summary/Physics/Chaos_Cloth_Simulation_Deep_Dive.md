---
title: "Chaos Cloth Simulation Deep Dive"
date: "2025-12-09"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Cloth Simulation Deep Dive

## 🧭 개요

**Chaos Cloth**는 UE5의 천 시뮬레이션 시스템으로, 옷, 깃발, 커튼 등의 부드러운 물체를 시뮬레이션합니다. PBD (Position-Based Dynamics)와 Force-based Solver를 지원하며, CPU 기반으로 동작합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Cloth Particle** | 천을 구성하는 개별 정점 |
| **Constraint** | 입자 간 관계 정의 (거리, 굽힘 등) |
| **Collision** | 외부 물체 및 자기 충돌 |
| **AnimDrive** | 애니메이션 메시로 천 구동 |
| **Backstop** | 침투 방지 제약 |

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Chaos Cloth Architecture                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

  USkeletalMeshComponent
         │
         └── UClothingAssetCommon
                  │
                  ├── UChaosClothConfig (설정)
                  │        │
                  │        ├── Mass Properties
                  │        ├── Material Properties
                  │        ├── Damping
                  │        ├── Wind/Aerodynamics
                  │        ├── Collision
                  │        ├── Self-Collision
                  │        └── Animation Drive
                  │
                  └── FClothingSimulationSolver (솔버)
                           │
                           ├── Legacy PBD Solver (PBDEvolution)
                           │     └── Position-Based Dynamics
                           │
                           └── Force-based Solver (신규)
                                 └── 더 정확한 물리 시뮬레이션

```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `ChaosCloth/Public/ChaosCloth/ChaosClothConfig.h` | 설정 클래스 (34KB) |
| `ChaosCloth/Public/ChaosCloth/ChaosClothingSimulationSolver.h` | 솔버 (33KB) |
| `ChaosCloth/Private/ChaosCloth/ChaosClothingSimulationSolver.cpp` | 솔버 구현 (109KB) |
| `ChaosCloth/Public/ChaosCloth/ChaosClothConstraints.h` | 제약 시스템 |
| `ClothingSystemRuntimeInterface/Public/ClothCollisionData.h` | 충돌 데이터 |

---

## 🔷 Cloth Config

### UChaosClothConfig 주요 설정

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          UChaosClothConfig                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. Mass Properties (질량)                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  MassMode:                                                              │   │
│  │    - UniformMass: 모든 입자 동일 질량 (0.00015 kg)                     │   │
│  │    - TotalMass: 전체 천 질량 분배 (0.5 kg)                             │   │
│  │    - Density: 면밀도 기반 (0.35 kg/m²) ← 권장                          │   │
│  │                                                                         │   │
│  │  밀도 예시:                                                             │   │
│  │    Melton Wool: 0.7  │  Cotton: 0.2                                    │   │
│  │    Heavy Leather: 0.6 │  Silk: 0.1                                     │   │
│  │    Denim: 0.4         │  Light Leather: 0.3                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  2. Material Properties (재질)                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  EdgeStiffness: 선형 제약 강도 (0.0 ~ 1.0)                             │   │
│  │  BendingStiffness: 굽힘 제약 강도 (0.0 ~ 1.0)                          │   │
│  │  AreaStiffness: 면적 보존 강도 (0.0 ~ 1.0)                             │   │
│  │  BucklingRatio: 접힘 임계값 (0.0 ~ 1.0)                                │   │
│  │  BucklingStiffness: 접힘 후 강도                                       │   │
│  │  FlatnessRatio: 평면화 비율 (0=3D 휴지, 1=완전 평면)                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  3. Damping (감쇠)                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  DampingCoefficient: 전역 속도 감쇠 (0.001 ~ 0.05)                     │   │
│  │  LocalDampingCoefficient: 지역 속도 편차 감쇠 (0 ~ 0.3)                │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Weight Map 기반 설정

```cpp
// FChaosClothWeightedValue - Low/High 보간
struct FChaosClothWeightedValue
{
    float Low;   // Weight Map 0일 때 값
    float High;  // Weight Map 1일 때 값
};

// 지원되는 Weight Map 타겟:
// - Edge Stiffness, Bend Stiffness, Area Stiffness
// - Tether Stiffness/Scale
// - Drag, Lift, Pressure
// - Anim Drive Stiffness/Damping
```

---

## 🔶 Wind & Aerodynamics

### 바람 시스템

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Wind & Aerodynamics                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Aerodynamic Wind Model (Default):                                               │
│    - 메시 표면 기반 정확한 공기역학                                             │
│    - Drag & Lift 계수 사용                                                      │
│                                                                                  │
│  Parameters:                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Drag (내측):        0.035 (Low) ~ 1.0 (High)                          │   │
│  │  OuterDrag (외측):   0.035 (Low) ~ 1.0 (High)                          │   │
│  │  Lift (내측):        0.035 (Low) ~ 1.0 (High)                          │   │
│  │  OuterLift (외측):   0.035 (Low) ~ 1.0 (High)                          │   │
│  │  Pressure:           0.0 (Low) ~ 1.0 (High)                            │   │
│  │  FluidDensity:       1.225 kg/m³ (공기 밀도)                           │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 Collision System

### External & Self Collision

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Collision System                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  External Collision:                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  지원 Primitive: Sphere, Capsule, Box, Convex                          │   │
│  │  CollisionThickness = 1.0 cm                                           │   │
│  │  FrictionCoefficient = 0.8                                             │   │
│  │  bUseCCD = false (연속 충돌 감지)                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  Self-Collision:                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Mode 1: Point-Face Collision (bUseSelfCollisions)                     │   │
│  │    - SelfCollisionThickness = 2.0 cm                                   │   │
│  │                                                                         │   │
│  │  Mode 2: Sphere-Based (bUseSelfCollisionSpheres)                       │   │
│  │    - SelfCollisionSphereRadius = 0.5 cm                                │   │
│  │    - 더 빠르지만 덜 정확                                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔶 Backstop & AnimDrive

### Backstop System

```
목적: 천이 캐릭터 메시를 뚫고 들어가는 것 방지

       Animation Mesh
            ║
            ║←───── BackstopDistance (양수: 바깥)
            ║
        ════╬════  Backstop Sphere (BackstopRadius)
            ║
            ↓
       Cloth Particle

모드:
  - Legacy Backstop: 수동 반경 포함 (작성 어려움)
  - New Backstop: 자동 반경 추가 (권장)
```

### AnimDrive System

```cpp
// AnimDrive: 애니메이션 메시로 천 입자 구동
// Stiffness = 0: 자유 물리
// Stiffness = 1: 완전 애니메이션 추종

// Weight Map 사용:
// - "Anim Drive Stiffness"
// - "Anim Drive Damping"
```

---

## 🔷 Long Range Attachment (Tethers)

```
목적: 장거리 늘어남 방지, 안정성 향상

Parameters:
  TetherStiffness: 장거리 결합 강도 (Low ~ High)
  TetherScale: 텔더 길이 배율 (Low ~ High)
  bUseGeodesicDistance:
    - true: 메시 표면 따라 거리 계산 (정확, 느림)
    - false: 직선 거리 (빠름, 아티팩트 가능)
```

---

## 💡 실전 사용 예시

### 1. 런타임 설정 변경

```cpp
void AMyCharacter::UpdateClothSettings(float WindStrength)
{
    if (UClothingSimulationInteractor* Interactor = GetClothInteractor())
    {
        // 바람 강도 조정
        Interactor->SetWindVelocity(FVector(WindStrength, 0, 0));

        // AnimDrive 조정 (컷신 등)
        Interactor->SetAnimDriveSpringStiffness(0.8f);

        // 반복 횟수 조정
        Interactor->SetNumIterations(10);
        Interactor->SetNumSubsteps(2);
    }
}
```

### 2. 성능 최적화

```cpp
void OptimizeCloth(UChaosClothConfig* Config)
{
    // 반복 횟수 감소
    Config->NumIterations = 4;
    Config->NumSubsteps = 1;

    // Self-Collision 비활성화 (비용 높음)
    Config->bUseSelfCollisions = false;

    // Tether 단순화
    Config->bUseGeodesicDistance = false;
}
```

---

## ⚙️ GPU 지원 여부

**현재 Chaos Cloth는 GPU 시뮬레이션 미지원**

- ✅ CPU 기반 시뮬레이션만 지원
- ✅ ISPC 코드로 멀티코어 최적화
- ❌ CUDA/DirectCompute 없음

---

## 🔧 일반적인 문제 및 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| **천이 뚫고 나감** | 충돌 두께 부족 | CollisionThickness 증가 |
| **과도한 늘어남** | Stiffness 부족 | EdgeStiffness 증가, Tether 사용 |
| **불안정/진동** | Damping 부족 | DampingCoefficient 증가 |
| **성능 저하** | Self-Collision | 비활성화 또는 Sphere 모드 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [FieldSystem.md](FieldSystem.md) - Field로 천에 힘 적용

---

> 이 문서는 Chaos Cloth Simulation 시스템을 설명합니다.