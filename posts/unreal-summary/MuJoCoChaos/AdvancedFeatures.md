---
title: "Advanced Features - Soft Body & Tendon/Muscle Systems"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# Advanced Features - Soft Body & Tendon/Muscle Systems

> Updated: 2025-12-17 — Phase 7 고급 기능 구현 문서화

## 🧭 Overview

Advanced Features 모듈은 **연성체 시뮬레이션**과 **근골격계 시뮬레이션**을 제공합니다. 이 시스템들은 로봇 공학, 바이오메카닉스, 소프트 로보틱스 등의 RL 환경에서 활용됩니다.

**📂 위치:**
- `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Public/Advanced/`
- `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Private/Advanced/`

---

## 🏗️ 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Advanced Features Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Soft Body Simulation                          │   │
│  │                                                                  │   │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │   │
│  │   │ SoftBody    │    │ XPBD        │    │ Constraint  │        │   │
│  │   │ Types       │───▶│ Solver      │───▶│ System      │        │   │
│  │   │             │    │             │    │             │        │   │
│  │   │ - Vertices  │    │ - Substeps  │    │ - Distance  │        │   │
│  │   │ - Tetrahedra│    │ - Iterations│    │ - Volume    │        │   │
│  │   │ - Materials │    │ - Damping   │    │ - Collision │        │   │
│  │   └─────────────┘    └─────────────┘    └─────────────┘        │   │
│  │                                                                  │   │
│  │   FSoftBodyFactory: Cube, Sphere, Beam, TetMesh 생성            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  Tendon/Muscle System                            │   │
│  │                                                                  │   │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │   │
│  │   │ Tendon      │    │ Hill Muscle │    │ Force       │        │   │
│  │   │ Path        │───▶│ Model       │───▶│ Application │        │   │
│  │   │             │    │             │    │             │        │   │
│  │   │ - Wrap      │    │ - CE/PE/SE  │    │ - Body      │        │   │
│  │   │ - Routing   │    │ - Activation│    │ - Joint     │        │   │
│  │   │ - Length    │    │ - FL/FV     │    │ - Qfrc      │        │   │
│  │   └─────────────┘    └─────────────┘    └─────────────┘        │   │
│  │                                                                  │   │
│  │   FTendonMuscleFactory: Simple, Wrapped, Antagonist 생성        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

# Part 1: Soft Body Simulation (XPBD)

## 📦 데이터 구조

### FSoftBodyMaterial

```cpp
struct FSoftBodyMaterial
{
    FReal YoungModulus = 1e6;      // 탄성 계수 (Pa)
    FReal PoissonRatio = 0.3;      // 푸아송 비
    FReal Density = 1000.0;        // 밀도 (kg/m³)

    // Lamé 파라미터 (YoungModulus, PoissonRatio에서 계산)
    FReal Lambda;  // First Lamé parameter
    FReal Mu;      // Shear modulus

    void ComputeLameParameters()
    {
        Mu = YoungModulus / (2.0 * (1.0 + PoissonRatio));
        Lambda = YoungModulus * PoissonRatio /
                 ((1.0 + PoissonRatio) * (1.0 - 2.0 * PoissonRatio));
    }
};
```

### FSoftBodyVertex

```cpp
struct FSoftBodyVertex
{
    FVector3d Position;     // 현재 위치
    FVector3d Velocity;     // 속도
    FVector3d Force;        // 외부 힘
    FReal Mass;             // 질량
    bool bFixed;            // 고정 여부
};
```

### FTetrahedron

```cpp
struct FTetrahedron
{
    int32 Indices[4];           // 4개 정점 인덱스
    FReal RestVolume;           // 초기 볼륨
    FMatrix3d InvRestMatrix;    // 역 초기 변형 행렬 (Dm^-1)
    int32 MaterialIndex;        // 재질 인덱스
};
```

---

## 🔧 XPBD 알고리즘

### 알고리즘 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        XPBD Algorithm Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step(DeltaTime)                                                        │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────┐                               │
│  │ 1. Apply External Forces            │                               │
│  │    v = v + (gravity + f/m) * dt     │                               │
│  └─────────────────┬───────────────────┘                               │
│                    ▼                                                    │
│  ┌─────────────────────────────────────┐                               │
│  │ 2. Predict Positions                │                               │
│  │    x* = x + v * dt                  │                               │
│  └─────────────────┬───────────────────┘                               │
│                    ▼                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 3. For each Substep (NumSubsteps iterations)                    │   │
│  │    ┌───────────────────────────────────────────────────────┐    │   │
│  │    │ For each Iteration (NumIterations)                    │    │   │
│  │    │    ├── Solve Distance Constraints                     │    │   │
│  │    │    ├── Solve Volume Constraints                       │    │   │
│  │    │    └── Solve Collision Constraints                    │    │   │
│  │    └───────────────────────────────────────────────────────┘    │   │
│  └─────────────────┬───────────────────────────────────────────────┘   │
│                    ▼                                                    │
│  ┌─────────────────────────────────────┐                               │
│  │ 4. Update Velocities                │                               │
│  │    v = (x* - x) / dt                │                               │
│  └─────────────────┬───────────────────┘                               │
│                    ▼                                                    │
│  ┌─────────────────────────────────────┐                               │
│  │ 5. Apply Damping                    │                               │
│  │    v = v * damping                  │                               │
│  └─────────────────────────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### XPBD 제약 조건

**Distance Constraint (거리 제약):**
```
C(x_i, x_j) = |x_i - x_j| - L_rest

Δx_i = -w_i / (w_i + w_j + α/dt²) * C * n
Δx_j = +w_j / (w_i + w_j + α/dt²) * C * n

where n = (x_i - x_j) / |x_i - x_j|
      α = 1/Stiffness (compliance)
```

**Volume Constraint (볼륨 제약):**
```
C(x_0, x_1, x_2, x_3) = V_current - V_rest

V = (1/6) * det([x_1-x_0, x_2-x_0, x_3-x_0])

∂C/∂x_0 = -(1/6) * (x_1-x_0) × (x_2-x_0) - ...
∂C/∂x_i = (1/6) * (x_j-x_0) × (x_k-x_0)
```

---

## 🎮 사용법

### 기본 사용

```cpp
#include "Advanced/SoftBodySimulation.h"

using namespace MuJoCoChaos;

// Soft Body 생성
FSoftBodyMaterial Material;
Material.YoungModulus = 1e6;
Material.PoissonRatio = 0.3;
Material.Density = 1000.0;

FSoftBodyDesc Desc = FSoftBodyFactory::CreateCube(
    FVector3d(0, 0, 2),    // Center
    FVector3d(1, 1, 1),    // Size
    5,                      // Resolution
    Material
);

// Simulation 초기화
FSoftBodySolverConfig Config;
Config.NumIterations = 10;
Config.NumSubsteps = 4;
Config.Gravity = FVector3d(0, 0, -9.81);

FSoftBodySimulation Simulation;
Simulation.Initialize(Desc, Config);

// 일부 정점 고정
Simulation.SetVertexFixed(0, true);

// 시뮬레이션 루프
for (int Frame = 0; Frame < 1000; ++Frame)
{
    Simulation.Step(0.016f);  // 60 FPS

    const FSoftBodyState& State = Simulation.GetState();
    // State.Positions, State.Velocities 사용
}
```

### Factory 함수들

```cpp
// Cube 생성
FSoftBodyDesc Cube = FSoftBodyFactory::CreateCube(
    Center, Size, Resolution, Material);

// Sphere 생성
FSoftBodyDesc Sphere = FSoftBodyFactory::CreateSphere(
    Center, Radius, Resolution, Material);

// Beam (빔) 생성
FSoftBodyDesc Beam = FSoftBodyFactory::CreateBeam(
    Start, End, Width, Height, NumSegments, Material);

// Surface Mesh에서 생성 (자동 사면체화)
FSoftBodyDesc FromMesh = FSoftBodyFactory::CreateFromSurfaceMesh(
    Vertices, Triangles, Material);
```

### Rigid Body와 연결

```cpp
// Soft body 정점을 Rigid body에 연결
Simulation.AttachVertexToBody(
    VertexIndex,           // 연결할 정점
    BodyIndex,             // 연결할 바디
    LocalPosition          // 바디 로컬 좌표
);

// 매 프레임 업데이트
Simulation.UpdateAttachments(BodyTransforms);
```

---

# Part 2: Tendon/Muscle System

## 📦 데이터 구조

### Hill Muscle Model 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Hill-Type Muscle Model                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│       Origin                                    Insertion               │
│          │                                          │                   │
│          ▼                                          ▼                   │
│     ┌────────────────────────────────────────────────┐                 │
│     │                                                │                 │
│     │    ┌───────────────────┐                      │                 │
│     ├────┤   CE (Contractile)├──────┬───────────────┤                 │
│     │    │   Active Force     │      │               │                 │
│     │    └───────────────────┘      │               │                 │
│     │                               │               │                 │
│     │                             ┌─┴─┐             │                 │
│     │                             │PE │             │                 │
│     │                             │   │             │ SE (Tendon)     │
│     │                             └─┬─┘             │                 │
│     │                               │               │                 │
│     └───────────────────────────────┴───────────────┘                 │
│                                                                         │
│  CE: Contractile Element - 활성 수축력 생성                             │
│  PE: Parallel Elastic Element - 수동 탄성 (근육 자체)                   │
│  SE: Series Elastic Element - 직렬 탄성 (건)                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FMuscleParams

```cpp
struct FMuscleParams
{
    FReal Fmax = 100.0;              // 최대 등척성 힘 (N)
    FReal OptimalFiberLength = 0.1;   // 최적 근섬유 길이 (m)
    FReal TendonSlackLength = 0.2;    // 건 이완 길이 (m)
    FReal PennationAngle = 0.0;       // 우각 (rad)
    FReal Vmax = 10.0;                // 최대 수축 속도 (Lopt/s)

    // Force-Length 곡선 파라미터
    FReal FLActive = 0.45;    // Active bell curve width
    FReal FLPassive = 4.0;    // Passive exponential shape
    FReal PassiveStrain = 0.6;

    // Force-Velocity 곡선 파라미터
    FReal FVmax = 1.4;        // Max eccentric force ratio
    FReal FVcurve = 0.25;     // Shape parameter

    // Activation dynamics
    FReal ActivationTimeConstant = 0.01;   // τ_act (s)
    FReal DeactivationTimeConstant = 0.04; // τ_deact (s)
};
```

### FTendonWrapPoint

```cpp
enum class ETendonWrapType : uint8
{
    Site,      // 직접 부착
    Cylinder,  // 원통 감기
    Sphere,    // 구 감기
    Pulley,    // 풀리
    Guide      // 가이드
};

struct FTendonWrapPoint
{
    ETendonWrapType Type;
    int32 BodyIndex;
    FVector3d LocalPosition;
    FVector3d LocalAxis;      // Cylinder/Sphere용
    FReal Radius;             // Cylinder/Sphere용
    int32 Side;               // Wrap 방향
};
```

---

## 🔧 Hill Muscle 역학

### Force-Length Relationship (Active)

```
                    1.0 ┤
                        │      ╱╲
                        │     ╱  ╲
    Active Force        │    ╱    ╲
    (Normalized)        │   ╱      ╲
                        │  ╱        ╲
                   0.0 ─┼─╱──────────╲────────
                        0.5  1.0  1.5  2.0
                        Normalized Fiber Length (L/Lopt)

    f_active(L) = exp(-((L/Lopt - 1) / w)²)
    where w = FLActive
```

### Force-Length Relationship (Passive)

```
                   1.0 ┤                    ╱
                       │                   ╱
    Passive Force      │                 ╱
    (Normalized)       │               ╱
                       │             ╱
                  0.0 ─┼───────────╱─────────
                       1.0       1.5       2.0
                        Normalized Fiber Length

    f_passive(L) = (exp(k*(L/Lopt - 1)) - 1) / (exp(k*ε_p) - 1)
    where k = FLPassive, ε_p = PassiveStrain
```

### Force-Velocity Relationship

```
                  1.4 ┤═══════════╗
                      │           ╚═══════╗
                 1.0 ─┼─────────────────────╬────────
    Normalized        │                     ╠═══════╗
    Force             │                     ║       ╚═══
                 0.0 ─┼─────────────────────╨────────────
                     -1.0       0.0        1.0
                      ◄──Shortening   Lengthening──►
                      Normalized Velocity (V/Vmax)

    Concentric (V < 0):  f_v = (1 - V/Vmax) / (1 + V/(Vmax*k))
    Eccentric (V > 0):   f_v = f_vmax - (f_vmax - 1) * (1 - V/Vmax) / (1 + V/(Vmax*k))
```

### Total Muscle Force

```cpp
F_total = F_max * [
    activation * f_active(L) * f_velocity(V)  // Active
    + f_passive(L)                            // Passive
] * cos(pennation)
```

### Activation Dynamics

```cpp
// First-order activation dynamics
da/dt = (excitation - activation) / τ

where τ = τ_act   if excitation > activation
        = τ_deact if excitation < activation

// Discrete update
a_new = a + dt * (e - a) / τ
```

---

## 🎮 사용법

### 기본 사용

```cpp
#include "Advanced/TendonSystem.h"

using namespace MuJoCoChaos;

// Tendon 정의
FTendonDesc BicepTendon = FTendonMuscleFactory::CreateWrappedTendon(
    "Bicep_Tendon",
    ShoulderBodyIdx,           // Origin body
    FVector3d(0, 0.05, 0),     // Origin local pos
    HumerusBodyIdx,            // Wrap body
    FVector3d(0, 0, 0),        // Wrap center
    FVector3d(1, 0, 0),        // Wrap axis
    0.02,                       // Wrap radius
    ForearmBodyIdx,            // Insertion body
    FVector3d(0, 0.03, 0),     // Insertion local pos
    0.25,                       // Rest length
    5000.0                      // Stiffness
);

// Muscle 정의
FMuscleDesc BicepMuscle = FTendonMuscleFactory::CreateMuscle(
    "Bicep",
    0,           // Tendon index
    300.0,       // Fmax (N)
    0.12,        // Optimal fiber length (m)
    0.2,         // Tendon slack length (m)
    0.0          // Pennation angle (rad)
);

// 시스템 초기화
FTendonMuscleSystem MuscleSystem;
MuscleSystem.Initialize(Model, {BicepTendon}, {BicepMuscle});

// 시뮬레이션 루프
for (int Frame = 0; Frame < 1000; ++Frame)
{
    // Excitation 설정 (0~1, 신경 신호)
    MuscleSystem.SetMuscleExcitation(0, ControlSignal);

    // Activation dynamics 업데이트
    MuscleSystem.UpdateMuscles(DeltaTime);

    // Tendon 경로 및 힘 계산
    MuscleSystem.Update(Model, State, BodyTransforms);

    // 일반화 좌표에 힘 적용
    MuscleSystem.ApplyToGeneralizedForces(Model, State);

    // 상태 확인
    const FMuscleState& MuscleState = MuscleSystem.GetMuscleState(0);
    // MuscleState.Activation, TotalForce, FiberLength 등
}
```

### 길항근 쌍 (Antagonist Pair) 생성

```cpp
TArray<FTendonDesc> Tendons;
TArray<FMuscleDesc> Muscles;

// 굴곡근/신전근 쌍 자동 생성
FTendonMuscleFactory::CreateAntagonistPair(
    "Elbow",                    // Base name
    ElbowBodyIdx,               // Joint body
    FlexorOrigin,               // Flexor origin position
    ExtensorOrigin,             // Extensor origin position
    InsertionPos,               // Common insertion
    200.0,                      // Fmax
    Tendons,
    Muscles
);

// 결과: Elbow_Flexor, Elbow_Extensor 생성
```

### RL 환경에서 사용

```cpp
// Action space: 근육 excitations [0, 1]
void ApplyActions(const TArray<FReal>& Actions)
{
    MuscleSystem.SetMuscleExcitations(Actions);
}

// Observation에 근육 상태 포함
void GetObservation(TArray<FReal>& Obs)
{
    for (int32 i = 0; i < MuscleSystem.GetNumMuscles(); ++i)
    {
        const FMuscleState& State = MuscleSystem.GetMuscleState(i);
        Obs.Add(State.Activation);
        Obs.Add(State.FiberLength);
        Obs.Add(State.TotalForce / Muscles[i].Params.Fmax);
    }
}
```

---

## 📊 성능 특성

### Soft Body Simulation

| Resolution | Vertices | Tetrahedra | Step Time (ms) |
|------------|----------|------------|----------------|
| 3x3x3 | 27 | ~50 | 0.1 |
| 5x5x5 | 125 | ~500 | 0.5 |
| 10x10x10 | 1000 | ~5000 | 5.0 |
| 20x20x20 | 8000 | ~40000 | 40.0 |

*Config: 10 iterations, 4 substeps*

### Muscle System

| # Muscles | # Tendons | Update Time (ms) |
|-----------|-----------|------------------|
| 10 | 10 | 0.05 |
| 50 | 50 | 0.2 |
| 100 | 100 | 0.5 |
| 300 | 300 | 1.5 |

*Humanoid 수준: ~300 muscles*

---

## 💡 최적화 팁

### Soft Body

**✅ 권장:**
```cpp
// 낮은 해상도로 시작
FSoftBodyDesc Desc = FSoftBodyFactory::CreateCube(
    Center, Size, 5, Material);  // Resolution = 5

// Substep 조절
Config.NumSubsteps = 2;  // 안정성 vs 성능 트레이드오프
Config.NumIterations = 5;
```

**❌ 피해야 할 것:**
```cpp
// 과도한 해상도
FSoftBodyFactory::CreateCube(Center, Size, 50, Material);  // 너무 많음

// 너무 많은 반복
Config.NumSubsteps = 20;
Config.NumIterations = 100;  // 불필요하게 느림
```

### Muscle System

**✅ 권장:**
```cpp
// Wrap 포인트 최소화
FTendonDesc SimpleTendon = FTendonMuscleFactory::CreateSimpleTendon(...);

// 필요한 경우만 Wrap 사용
if (bNeedsWrapping)
{
    Tendon = FTendonMuscleFactory::CreateWrappedTendon(...);
}
```

---

## 🔗 References

| 참조 | 설명 |
|------|------|
| `SoftBodyTypes.h` | Soft body 데이터 구조 |
| `SoftBodySimulation.h` | XPBD 시뮬레이션 클래스 |
| `SoftBodySimulation.cpp` | XPBD 구현 |
| `TendonSystem.h` | Tendon/Muscle 인터페이스 |
| `TendonSystem.cpp` | Hill muscle 구현 |

### 학술 참조

- **XPBD**: Macklin et al., "XPBD: Position-Based Simulation of Compliant Constrained Dynamics" (2016)
- **Hill Muscle**: Zajac, "Muscle and Tendon: Properties, Models, Scaling, and Application to Biomechanics" (1989)
- **OpenSim**: Delp et al., "OpenSim: Open-Source Software to Create and Analyze Dynamic Simulations of Movement" (2007)
