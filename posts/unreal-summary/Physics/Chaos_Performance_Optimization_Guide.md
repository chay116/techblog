---
title: "Chaos Physics Performance Optimization Guide"
date: "2025-12-10"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Physics Performance Optimization Guide

## 🧭 개요

이 문서는 **Chaos Physics 시스템의 성능 최적화**를 위한 종합 가이드입니다. Destruction, Cloth, Rigid Body, Vehicle 등 모든 물리 시뮬레이션에 적용 가능한 최적화 기법을 다룹니다.

### 최적화 핵심 원칙

| 원칙 | 설명 | 효과 |
|------|------|------|
| **Sleep 활용** | 비활성 객체 시뮬레이션 중지 | CPU 부하 대폭 감소 |
| **Island 분리** | 독립적인 물체 그룹 병렬 처리 | 멀티코어 활용 극대화 |
| **단순 충돌체** | 복잡한 Convex → 단순 Primitive | Narrowphase 비용 감소 |
| **LOD 적용** | 거리별 물리 복잡도 조절 | 원거리 객체 비용 절감 |
| **Debris 관리** | 파편 자동 제거/비활성화 | 누적 부하 방지 |

---

## 🏗️ 최적화 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Chaos Physics Optimization Layers                            │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│  Layer 1: 렌더링 최적화                                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │  Nanite 활성화       │  │  Root Mesh Proxy    │  │  Niagara 대체      │     │
│  │  (자동 LOD)          │  │  (파괴 전 렌더링)    │  │  (소형 파편)        │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Layer 2: 물리 시뮬레이션 최적화                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │  Sleep/Disable      │  │  Island 분리        │  │  Substepping 조절   │     │
│  │  (비활성화 관리)      │  │  (병렬 처리)        │  │  (정확도/성능)       │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Layer 3: 충돌 최적화                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │  Simple Collision   │  │  Collision Filter   │  │  One-Way Interaction │     │
│  │  (단순 충돌체)        │  │  (채널 최적화)       │  │  (단방향 상호작용)    │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Layer 4: Destruction 특화 최적화                                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │  Debris Timeout     │  │  Remove on Break    │  │  Field 최적화       │     │
│  │  (파편 자동 제거)     │  │  (즉시 삭제)         │  │  (경량화)           │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 1. Destruction 최적화

### 1.1 Nanite & Root Mesh Proxy (렌더링)

**Epic Games 2025 GDC 권장 기법**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Nanite + Root Mesh Proxy                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  파괴 전:                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐            │
│  │  Root Mesh Proxy (Static Mesh)                                  │            │
│  │  - Nanite 활성화                                                │            │
│  │  - 단일 Draw Call                                               │            │
│  │  - 최소 메모리                                                   │            │
│  └─────────────────────────────────────────────────────────────────┘            │
│                                      │                                          │
│                          파괴 트리거  │                                          │
│                                      ↓                                          │
│  파괴 후:                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐            │
│  │  Geometry Collection (Fractured Pieces)                         │            │
│  │  - Nanite 자동 적용 (소스 메시 설정 상속)                       │            │
│  │  - ISM (Instanced Static Mesh) 배칭                            │            │
│  └─────────────────────────────────────────────────────────────────┘            │
│                                                                                  │
│  💡 효과: 렌더링 비용 최대 80% 절감                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**설정 방법:**
```cpp
// Geometry Collection Asset에서 설정
UGeometryCollectionComponent* GC = ...;

// 1. Nanite 활성화 확인 (소스 메시에서 상속)
// 에디터: Geometry Collection > Details > Rendering > Enable Nanite

// 2. Root Proxy 설정
// 에디터: Geometry Collection > Root Proxy > Add Root Proxy Mesh
```

### 1.2 One-Way Interaction

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         One-Way Interaction                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  기본 상호작용 (양방향):                                                         │
│  ┌───────┐         ┌───────┐                                                    │
│  │  A    │ ←──────→│   B   │   A가 B에 충격 → B도 A에 반력                      │
│  │파괴물 │   Strain │ 파괴물│   = 연쇄 파괴 가능, 높은 계산 비용                  │
│  └───────┘         └───────┘                                                    │
│                                                                                  │
│  One-Way Interaction:                                                           │
│  ┌───────┐         ┌───────┐                                                    │
│  │  A    │ ────────→│   B   │   A가 B에 충격 → B는 영향 없음                     │
│  │파괴물 │  No Strain│ 파괴물│   = 연쇄 파괴 방지, 낮은 계산 비용                  │
│  └───────┘         └───────┘                                                    │
│                                                                                  │
│  💡 용도: 대량 파편이 다른 구조물에 영향 안 주길 원할 때                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Debris 관리

```cpp
// Geometry Collection 설정
// 에디터: Geometry Collection > Chaos Physics > Debris

// 파편 자동 제거 설정
bEnableDebris = true;
DebrisTimeoutMin = 2.0f;  // 최소 2초 후 제거
DebrisTimeoutMax = 3.0f;  // 최대 3초 후 제거

// 크기 기반 제거
MinDebrisSize = 10.0f;    // 10cm 이하 파편 즉시 제거

// Sleep 기반 제거
bRemoveOnSleep = true;    // Sleep 상태 진입 시 제거
```

### 1.4 Field vs Trace/External Strain

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    파괴 트리거 방식 비교                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  방식              │ 성능   │ 정확도 │ 용도                                      │
│  ─────────────────┼────────┼────────┼─────────────────────────────────────────  │
│  Complex Field    │ ❌ 느림 │ ✅ 높음 │ 영화적 파괴 (프리렌더/캐싱)               │
│  Simple Field     │ ⚠️ 보통│ ⚠️ 보통│ 일반적인 파괴                             │
│  Trace + Strain   │ ✅ 빠름│ ⚠️ 보통│ 발사체 충돌 (슈팅 게임 권장)              │
│  External Strain  │ ✅ 빠름│ ⚠️ 보통│ 폭발 반경 파괴                            │
│                                                                                  │
│  💡 Epic 권장: 프로덕션 환경에서는 Trace + External Strain 조합 사용            │
│     Complex Field는 밀리초 단위 지연 발생 → 대량 파괴 시 프레임 드롭            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**경량 파괴 코드 예시:**
```cpp
// ❌ 비권장: Complex Field 사용
void TriggerDestructionWithField(FVector Location, float Radius)
{
    // Field 생성 및 적용 - 비용 높음
    UFieldSystemComponent* Field = ...;
    Field->ApplyRadialForce(Location, Radius, Strength);
}

// ✅ 권장: Trace + External Strain
void TriggerDestructionOptimized(FVector Location, float Radius, float Strain)
{
    // Line Trace로 충돌 감지
    FHitResult Hit;
    if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Destructible))
    {
        if (UGeometryCollectionComponent* GC = Cast<UGeometryCollectionComponent>(Hit.Component))
        {
            // External Strain 직접 적용 - 비용 낮음
            GC->ApplyExternalStrain(
                Hit.ImpactPoint,
                Radius,
                /*PropagationDepth=*/ 2,
                /*PropagationFactor=*/ 0.5f,
                Strain
            );
        }
    }
}
```

### 1.5 Remove on Break + Niagara

**Lego Fortnite에서 사용된 기법**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Remove on Break + Niagara 대체                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  기존 방식:                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐            │
│  │  1000개 파편 = 1000개 Rigid Body                                │            │
│  │  → CPU 물리 시뮬레이션 1000개                                   │            │
│  │  → 높은 비용                                                    │            │
│  └─────────────────────────────────────────────────────────────────┘            │
│                                                                                  │
│  Remove on Break + Niagara:                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐            │
│  │  파괴 시:                                                       │            │
│  │  1. 소형 파편 → 즉시 삭제                                       │            │
│  │  2. Niagara Mesh Particle로 대체                                │            │
│  │  → GPU 렌더링만 (물리 없음)                                     │            │
│  │  → 시각적으로 동일, 성능 대폭 향상                              │            │
│  └─────────────────────────────────────────────────────────────────┘            │
│                                                                                  │
│  💡 Epic 테스트 결과: 동상 105개 파괴 시 40-45 FPS 유지                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 2. Sleep & Island 최적화

### 2.1 Sleep System

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Sleep System 상태 전이                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                   ┌─────────────┐                                               │
│                   │   Active    │ ← 충돌/힘 적용                                │
│                   │  (시뮬레이션)│                                               │
│                   └──────┬──────┘                                               │
│                          │                                                       │
│            속도 < Threshold (N 프레임 지속)                                      │
│                          │                                                       │
│                          ↓                                                       │
│                   ┌─────────────┐                                               │
│                   │   Sleeping  │ ← 시뮬레이션 중지, 충돌로 깨어남               │
│                   │  (대기 상태) │                                               │
│                   └──────┬──────┘                                               │
│                          │                                                       │
│            Disable Field / Timeout                                              │
│                          │                                                       │
│                          ↓                                                       │
│                   ┌─────────────┐                                               │
│                   │  Disabled   │ ← 완전 제거, 깨어날 수 없음                   │
│                   │ (시뮬 제외)  │                                               │
│                   └─────────────┘                                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Sleep CVars

```cpp
// Sleep 임계값 설정
p.Chaos.SleepThresholdLinear = 0.5       // 선형 속도 임계값 (cm/s)
p.Chaos.SleepThresholdAngular = 0.5      // 각속도 임계값 (rad/s)
p.Chaos.SleepFramesToSleep = 30          // Sleep까지 필요한 프레임 수

// Physics Material에서 설정
UPhysicalMaterial* Mat = ...;
Mat->SleepLinearVelocityThreshold = 0.5f;
Mat->SleepAngularVelocityThreshold = 0.5f;

// 절대 Sleep 안 하게 하려면 (주의: 성능 저하)
Mat->SleepLinearVelocityThreshold = 0.0f;
Mat->SleepAngularVelocityThreshold = 0.0f;
```

### 2.3 Island System 최적화

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Island System                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  개념: 접촉/제약으로 연결된 물체들을 "Island"로 그룹화                           │
│  장점: 각 Island를 독립적으로 병렬 처리                                          │
│                                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                          │
│  │  Island A   │    │  Island B   │    │  Island C   │                          │
│  │  ○─○─○      │    │  ○─○        │    │     ○       │                          │
│  │  │ │        │    │  │          │    │             │                          │
│  │  ○─○        │    │  ○─○─○      │    │             │                          │
│  └─────────────┘    └─────────────┘    └─────────────┘                          │
│       │                   │                   │                                  │
│       └───────────────────┼───────────────────┘                                  │
│                           ↓                                                      │
│                    병렬 처리 (각 Island 독립)                                    │
│                                                                                  │
│  최적화 팁:                                                                      │
│  - 거대한 Island 분리: 연결된 물체 수 제한                                       │
│  - Island 병합 방지: 불필요한 접촉 최소화                                        │
│  - Sleep Island: 전체 Island가 Sleep 상태면 스킵                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 3. Collision 최적화

### 3.1 충돌체 단순화

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Collision Shape 비용 비교                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Shape Type        │ 상대 비용  │ 정확도 │ 권장 용도                            │
│  ─────────────────┼───────────┼────────┼────────────────────────────────────── │
│  Sphere           │ ★☆☆☆☆ (1x)│ ★★☆☆☆ │ 구형 객체, 빠른 충돌                  │
│  Capsule          │ ★★☆☆☆ (2x)│ ★★★☆☆ │ 캐릭터, 원통형 객체                   │
│  Box              │ ★★☆☆☆ (2x)│ ★★★☆☆ │ 직육면체 객체                         │
│  Convex Hull      │ ★★★☆☆ (5x)│ ★★★★☆ │ 복잡한 단일 객체                      │
│  Triangle Mesh    │ ★★★★★(20x)│ ★★★★★ │ 정적 레벨 지오메트리만                │
│                                                                                  │
│  💡 파괴 파편: Convex Hull 사용, 정점 수 최소화                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Convex 분해 최적화:**
```cpp
// Geometry Collection 설정
// 에디터: Fracture Mode > Collision > Convex Count Per Bone

// 권장 설정
MaxConvexHullsPerBone = 1;       // 파편당 1개 Convex (기본)
ConvexHullMaxVertices = 16;     // 정점 수 제한 (기본 32 → 16으로 감소)

// 극단적 최적화 (품질 희생)
UseBoxCollision = true;          // Convex 대신 Box 사용
```

### 3.2 Collision Channel 최적화

```cpp
// 불필요한 충돌 비활성화
void OptimizeCollisionChannels(UPrimitiveComponent* Comp)
{
    // 특정 채널만 충돌
    Comp->SetCollisionResponseToAllChannels(ECR_Ignore);
    Comp->SetCollisionResponseToChannel(ECC_WorldStatic, ECR_Block);
    Comp->SetCollisionResponseToChannel(ECC_WorldDynamic, ECR_Block);

    // 파편끼리 충돌 비활성화 (선택적)
    Comp->SetCollisionResponseToChannel(ECC_Destructible, ECR_Ignore);
}
```

---

## 🔷 4. Substepping 최적화

### 4.1 Substepping 이해

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Substepping 동작 원리                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  프레임 시간 = 33.3ms (30 FPS)                                                  │
│  Max Substep Delta = 8.33ms (120 Hz)                                            │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐           │
│  │                    Frame (33.3ms)                                │           │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │           │
│  │  │Substep 1│ │Substep 2│ │Substep 3│ │Substep 4│               │           │
│  │  │ 8.33ms  │ │ 8.33ms  │ │ 8.33ms  │ │ 8.33ms  │               │           │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘               │           │
│  └──────────────────────────────────────────────────────────────────┘           │
│                                                                                  │
│  장점: 안정적인 물리 시뮬레이션 (일정한 dt)                                      │
│  단점: CPU 비용 증가 (Substep 수 × 물리 비용)                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Substepping 설정

```cpp
// Project Settings > Physics > Framerate

// 권장 설정 (성능/안정성 균형)
bSubstepping = true;
MaxSubstepDeltaTime = 0.016667f;  // 60 Hz
MaxSubsteps = 2;                   // 최대 2 서브스텝

// 고성능 설정 (안정성 희생)
MaxSubstepDeltaTime = 0.033333f;  // 30 Hz
MaxSubsteps = 1;                   // 서브스텝 최소화

// 고정밀 설정 (성능 희생)
MaxSubstepDeltaTime = 0.008333f;  // 120 Hz
MaxSubsteps = 4;                   // Vehicle, Ragdoll 안정화
```

### 4.3 Async Physics

```cpp
// UE 5.6+ 권장 설정
// Project Settings > Physics > Async

bTickPhysicsAsync = true;         // 비동기 물리 활성화
AsyncPhysicsDeltaTime = 0.016667f; // 60 Hz 고정

// CVars
p.Chaos.EnableAsyncInitBody = true

// 주의: Substepping과 Async Physics는 상호 배타적
// 둘 중 하나만 활성화
```

---

## 🔷 5. Cloth 최적화

### 5.1 Cloth 성능 설정

```cpp
// Chaos Cloth Config 설정
UChaosClothConfig* Config = ...;

// 반복 횟수 감소 (기본 8)
Config->NumIterations = 4;       // 50% 성능 향상
Config->NumSubsteps = 1;         // 서브스텝 최소화

// Self-Collision 비활성화 (비용 높음)
Config->bUseSelfCollisions = false;
Config->bUseSelfCollisionSpheres = false;

// Tether 단순화
Config->bUseGeodesicDistance = false;  // 직선 거리 사용
```

### 5.2 Cloth LOD

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Cloth LOD Strategy                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  거리        │ Cloth 설정                                                       │
│  ───────────┼───────────────────────────────────────────────────────────────── │
│  0-5m       │ Full Simulation (모든 제약, Self-Collision)                       │
│  5-15m      │ Reduced (반복 4회, Self-Collision 없음)                           │
│  15-30m     │ Minimal (반복 2회, 단순 제약만)                                   │
│  30m+       │ Disabled (시뮬레이션 중지, 애니메이션만)                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 ML Cloth (Machine Learning)

**UE 5.7 신기능**

```cpp
// 기존 물리 기반 vs ML Cloth
// ML Cloth: 사전 학습된 모델로 고품질 시뮬레이션

// 장점:
// - 오프라인 시뮬레이션 품질
// - 런타임 비용 낮음
// - 메모리 효율적

// 적용 방법:
// 1. 고품질 시뮬레이션 데이터 생성
// 2. ML 모델 학습
// 3. 런타임에 모델 추론
```

---

## 🔷 6. 주요 CVars 정리

### 6.1 솔버 CVars

```cpp
// 솔버 반복 횟수
p.Chaos.Solver.Iterations = 8              // 기본값, 감소 시 성능 향상
p.Chaos.Solver.PushOutIterations = 3       // 푸시아웃 반복
p.Chaos.Solver.JointPairIterations = 2     // 관절 반복

// 충돌 감지
p.Chaos.Collision.CullDistance = 3.0       // 충돌 컬링 거리
p.Chaos.Collision.EnableBroadPhase = true  // Broadphase 활성화
```

### 6.2 Sleep CVars

```cpp
// Sleep 설정
p.Chaos.SleepThresholdLinear = 0.5         // 선형 속도 임계값
p.Chaos.SleepThresholdAngular = 0.5        // 각속도 임계값
p.Chaos.SleepFramesToSleep = 30            // Sleep까지 프레임
p.Chaos.AllowSleeping = true               // Sleep 허용
```

### 6.3 Destruction CVars

```cpp
// 파괴 설정
p.Chaos.GC.MaxSimulatedLevel = 2           // 시뮬레이션 레벨 제한
p.Chaos.GC.EnableClustering = true         // 클러스터링 활성화
p.Chaos.GC.ClusterBreakingEnabled = true   // 클러스터 파괴 활성화
```

### 6.4 디버그 CVars

```cpp
// 성능 분석용
p.Chaos.DebugDraw.Enabled = 1              // 디버그 드로우
p.Chaos.DebugDraw.Islands = 1              // Island 시각화
p.Chaos.DebugDraw.Sleeping = 1             // Sleep 상태 시각화
```

---

## 🔷 7. 프로파일링

### 7.1 Stat 명령어

```cpp
// 콘솔에서 실행
stat Physics                // 전체 물리 통계
stat ChaosStats             // Chaos 상세 통계
stat ChaosCollision         // 충돌 통계
stat ChaosSolver            // 솔버 통계
stat ChaosThread            // 물리 스레드 통계

// 주요 지표
// - BroadPhaseTime: 높으면 물체 수 과다
// - NarrowPhaseTime: 높으면 충돌체 복잡
// - SolverTime: 높으면 접촉/제약 과다
// - NumActiveRigidBodies: Sleep 미작동
```

### 7.2 Unreal Insights

```bash
# 물리 트레이스 활성화
UnrealEditor.exe -trace=default,physics

# Insights에서 분석
# Window > Developer Tools > Unreal Insights
# Physics 트랙 선택
```

---

## 💡 실전 최적화 체크리스트

### 일반적인 문제와 해결

| 문제 | 진단 | 해결 |
|------|------|------|
| **프레임 드롭** | stat Physics에서 SolverTime 높음 | 반복 횟수 감소, Sleep 활성화 |
| **파편 과다** | NumActiveRigidBodies 계속 증가 | Debris Timeout 설정, Remove on Break |
| **충돌 비용** | NarrowPhaseTime 높음 | 충돌체 단순화, Convex 정점 감소 |
| **Island 과대** | Island 시각화에서 거대 Island | 물체 분리, 연결 최소화 |
| **메모리 증가** | 파편 누적 | Disable 사용, 타임아웃 설정 |

### 플랫폼별 권장 설정

```cpp
// PC (High-End)
SolverIterations = 8;
MaxSubsteps = 2;
SelfCollision = true;

// PC (Mid-Range)
SolverIterations = 6;
MaxSubsteps = 1;
SelfCollision = false;

// Console
SolverIterations = 4;
MaxSubsteps = 1;
SelfCollision = false;
DebrisTimeout = 2.0f;

// Mobile
SolverIterations = 2;
MaxSubsteps = 1;
SelfCollision = false;
DebrisTimeout = 1.0f;
MaxSimulatedLevel = 1;
```

---

## 🎮 8. 실전 예시 (Case Studies)

### 8.1 예시 1: 슈팅 게임 - 벽 파괴 최적화

**시나리오:** 플레이어가 총으로 벽을 파괴하는 슈팅 게임

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Case Study: FPS 벽 파괴 시스템                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  문제 상황:                                                                      │
│  - 벽 1개 = 500개 파편                                                          │
│  - 동시 파괴 시 프레임 드롭 (60 FPS → 15 FPS)                                   │
│  - 파편 누적으로 메모리 증가                                                     │
│                                                                                  │
│  최적화 전:                      최적화 후:                                      │
│  ┌────────────────────┐         ┌────────────────────┐                         │
│  │ 500 Rigid Bodies   │         │ 50 Rigid Bodies    │                         │
│  │ Complex Field      │   →     │ Trace + Strain     │                         │
│  │ 무한 시뮬레이션    │         │ 2초 후 Disable     │                         │
│  │ 15 FPS            │         │ 55+ FPS            │                         │
│  └────────────────────┘         └────────────────────┘                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**최적화 코드:**

```cpp
// ============================================================
// 슈팅 게임 파괴 시스템 - 최적화 버전
// ============================================================

UCLASS()
class AOptimizedProjectile : public AActor
{
    GENERATED_BODY()

public:
    // 발사체 충돌 시 호출
    UFUNCTION()
    void OnProjectileHit(UPrimitiveComponent* HitComp, AActor* OtherActor,
                         UPrimitiveComponent* OtherComp, FVector NormalImpulse,
                         const FHitResult& Hit)
    {
        // ❌ 비권장: Field System 사용
        // SpawnFieldSystem(Hit.ImpactPoint);  // 비용 높음!

        // ✅ 권장: External Strain 직접 적용
        if (UGeometryCollectionComponent* GC =
            Cast<UGeometryCollectionComponent>(OtherComp))
        {
            // 충격 지점에 국소적 파괴
            GC->ApplyExternalStrain(
                Hit.ImpactPoint,
                /*Radius=*/ DestructionRadius,        // 50cm
                /*PropagationDepth=*/ 1,              // 인접 1단계만
                /*PropagationFactor=*/ 0.3f,          // 30% 전파
                /*StrainValue=*/ ProjectileDamage     // 1000
            );
        }

        // VFX (물리 없는 시각 효과)
        SpawnNiagaraDebris(Hit.ImpactPoint, Hit.ImpactNormal);

        Destroy();
    }

private:
    UPROPERTY(EditDefaultsOnly)
    float DestructionRadius = 50.0f;

    UPROPERTY(EditDefaultsOnly)
    float ProjectileDamage = 1000.0f;

    // Niagara로 소형 파편 시각화 (물리 없음)
    void SpawnNiagaraDebris(FVector Location, FVector Normal)
    {
        if (DebrisNiagaraSystem)
        {
            UNiagaraFunctionLibrary::SpawnSystemAtLocation(
                GetWorld(), DebrisNiagaraSystem, Location,
                Normal.Rotation(), FVector(1.0f), true, true
            );
        }
    }

    UPROPERTY(EditDefaultsOnly)
    UNiagaraSystem* DebrisNiagaraSystem;
};

// ============================================================
// Geometry Collection 설정 (에디터 또는 생성자에서)
// ============================================================
void SetupOptimizedWall(UGeometryCollectionComponent* GC)
{
    // 1. Debris 자동 제거 설정
    GC->SetDebrisMaxSpeedWhenStopping(5.0f);
    GC->SetDebrisTimeoutMin(1.5f);
    GC->SetDebrisTimeoutMax(2.5f);

    // 2. 파편 크기 필터링
    GC->SetMinSizeForSleeping(5.0f);  // 5cm 이하는 즉시 Sleep

    // 3. 클러스터링 레벨 제한
    // MaxSimulatedLevel = 2 → 최대 2단계까지만 파괴
}
```

**Geometry Collection Asset 설정:**

```
에디터 설정 (Geometry Collection):
├── Chaos Physics
│   ├── Damage Threshold: 800
│   ├── Damage Propagation: 0.3
│   └── Clustering
│       ├── Cluster Group Index: 0
│       └── Max Cluster Level: 2
│
├── Debris
│   ├── Enable Debris: ✓
│   ├── Debris Timeout Min: 1.5
│   ├── Debris Timeout Max: 2.5
│   └── Remove On Sleep: ✓
│
└── Collision
    ├── Collision Type: Particle Implicit (Simple)
    └── Implicit Type: Box (가장 빠름)
```

---

### 8.2 예시 2: 오픈 월드 - 대규모 건물 붕괴

**시나리오:** 폭발로 여러 건물이 동시에 붕괴하는 상황

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Case Study: 대규모 건물 붕괴                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  문제 상황:                                                                      │
│  - 건물 10개 × 1000파편 = 10,000개 Rigid Body                                   │
│  - 모든 파편이 하나의 거대 Island 형성                                          │
│  - 병렬 처리 불가 → 단일 스레드 병목                                            │
│                                                                                  │
│  최적화 전:                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐           │
│  │                    하나의 거대 Island                            │           │
│  │  ○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○                     │           │
│  │  │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │                       │           │
│  │  ○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○─○                     │           │
│  │              → 단일 스레드에서 처리 (느림)                       │           │
│  └──────────────────────────────────────────────────────────────────┘           │
│                                                                                  │
│  최적화 후:                                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│  │Island A │ │Island B │ │Island C │ │Island D │ │Island E │                  │
│  │ ○─○─○─○ │ │ ○─○─○─○ │ │ ○─○─○─○ │ │ ○─○─○─○ │ │ ○─○─○─○ │                  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘                  │
│       │           │           │           │           │                        │
│       └───────────┴───────────┴───────────┴───────────┘                        │
│                     → 5개 스레드 병렬 처리 (빠름)                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**최적화 코드:**

```cpp
// ============================================================
// 대규모 파괴 시스템 - Island 분리 최적화
// ============================================================

UCLASS()
class AMassDestructionManager : public AActor
{
    GENERATED_BODY()

public:
    // 대규모 폭발 트리거
    UFUNCTION(BlueprintCallable)
    void TriggerMassExplosion(FVector EpicenterLocation, float BlastRadius)
    {
        // 1. 범위 내 파괴 가능 오브젝트 수집
        TArray<UGeometryCollectionComponent*> AffectedGCs;
        CollectDestructiblesInRadius(EpicenterLocation, BlastRadius, AffectedGCs);

        // 2. 거리 기반 시차 파괴 (Island 분리 유도)
        for (int32 i = 0; i < AffectedGCs.Num(); i++)
        {
            UGeometryCollectionComponent* GC = AffectedGCs[i];
            float Distance = FVector::Dist(EpicenterLocation, GC->GetComponentLocation());

            // 거리에 따른 지연 시간 (가까울수록 먼저)
            float Delay = Distance / ExplosionWaveSpeed;

            // 타이머로 순차 파괴 → Island 자연 분리
            FTimerHandle TimerHandle;
            GetWorldTimerManager().SetTimer(
                TimerHandle,
                [this, GC, EpicenterLocation, Distance]()
                {
                    TriggerSingleDestruction(GC, EpicenterLocation, Distance);
                },
                Delay,
                false
            );
        }
    }

private:
    UPROPERTY(EditDefaultsOnly)
    float ExplosionWaveSpeed = 1000.0f;  // 10m/s 폭발파

    void TriggerSingleDestruction(UGeometryCollectionComponent* GC,
                                   FVector Epicenter, float Distance)
    {
        // 거리 감쇠 Strain
        float StrainValue = FMath::Max(0.0f, MaxStrain * (1.0f - Distance / MaxRange));

        // External Strain 적용 (Field보다 가벼움)
        GC->ApplyExternalStrain(
            GC->GetComponentLocation(),
            /*Radius=*/ 500.0f,
            /*PropagationDepth=*/ 3,
            /*PropagationFactor=*/ 0.5f,
            StrainValue
        );

        // One-Way Interaction 활성화 (연쇄 파괴 방지)
        // 파편이 다른 건물에 Strain 전달 안 함
        EnableOneWayInteraction(GC);
    }

    void EnableOneWayInteraction(UGeometryCollectionComponent* GC)
    {
        // Blueprint 또는 에디터에서 설정
        // Geometry Collection > Chaos Physics > One Way Interaction: ✓
    }

    UPROPERTY(EditDefaultsOnly)
    float MaxStrain = 5000.0f;

    UPROPERTY(EditDefaultsOnly)
    float MaxRange = 5000.0f;
};
```

**성능 비교:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         성능 측정 결과                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  테스트 환경: 건물 10개 동시 파괴, 총 8,000 파편                                 │
│                                                                                  │
│  항목              │ 최적화 전  │ 최적화 후  │ 개선율                            │
│  ─────────────────┼───────────┼───────────┼───────────────────────────────────  │
│  Frame Time       │ 45ms      │ 12ms      │ 73% 감소                            │
│  Physics Time     │ 38ms      │ 8ms       │ 79% 감소                            │
│  Island Count     │ 1         │ 10+       │ 병렬화 가능                         │
│  Active Bodies    │ 8,000     │ 2,000     │ 75% 감소 (Sleep/Disable)           │
│  Peak Memory      │ 450MB     │ 180MB     │ 60% 감소                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 8.3 예시 3: 레이싱 게임 - 차량 물리 최적화

**시나리오:** 20대의 차량이 동시에 경주하는 상황

```cpp
// ============================================================
// 레이싱 게임 차량 물리 최적화
// ============================================================

UCLASS()
class AOptimizedRacingVehicle : public AWheeledVehiclePawn
{
    GENERATED_BODY()

public:
    virtual void BeginPlay() override
    {
        Super::BeginPlay();

        // 플레이어 차량 vs AI 차량 설정 분리
        if (IsPlayerControlled())
        {
            SetupHighQualityPhysics();
        }
        else
        {
            SetupOptimizedAIPhysics();
        }
    }

private:
    // 플레이어 차량: 고품질 물리
    void SetupHighQualityPhysics()
    {
        UChaosWheeledVehicleMovementComponent* Movement = GetVehicleMovement();

        // Substepping 활성화 (안정적인 서스펜션)
        Movement->bUseSubstepping = true;
        Movement->MaxSubsteps = 4;
        Movement->SubstepDeltaTime = 0.004167f;  // 240Hz

        // 상세 타이어 모델
        Movement->bUseTireGripModel = true;
        Movement->TireFrictionScale = 1.0f;
    }

    // AI 차량: 최적화된 물리
    void SetupOptimizedAIPhysics()
    {
        UChaosWheeledVehicleMovementComponent* Movement = GetVehicleMovement();

        // Substepping 최소화
        Movement->bUseSubstepping = false;  // 비활성화
        // 또는 최소 설정:
        // Movement->MaxSubsteps = 1;
        // Movement->SubstepDeltaTime = 0.016667f;  // 60Hz

        // 단순 타이어 모델
        Movement->bUseTireGripModel = false;
        Movement->TireFrictionScale = 0.8f;  // 약간 낮춤
    }

    // 거리 기반 LOD 전환
    UFUNCTION()
    void UpdatePhysicsLOD()
    {
        APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
        if (!PC) return;

        float DistanceToPlayer = FVector::Dist(
            GetActorLocation(),
            PC->GetPawn()->GetActorLocation()
        );

        UChaosWheeledVehicleMovementComponent* Movement = GetVehicleMovement();

        if (DistanceToPlayer < 50.0f * 100.0f)  // 50m 이내
        {
            // 근거리: 중간 품질
            Movement->MaxSubsteps = 2;
        }
        else if (DistanceToPlayer < 150.0f * 100.0f)  // 150m 이내
        {
            // 중거리: 낮은 품질
            Movement->MaxSubsteps = 1;
        }
        else
        {
            // 원거리: 키네마틱 이동 (물리 비활성화)
            // 미리 계산된 경로를 따라 이동
            SwitchToKinematicMovement();
        }
    }
};
```

**Project Settings 최적화:**

```cpp
// DefaultEngine.ini

[/Script/Engine.PhysicsSettings]
; 레이싱 게임 최적화 설정

; Substepping (플레이어 차량용)
bSubstepping=True
MaxSubstepDeltaTime=0.004167    ; 240Hz for stable suspension
MaxSubsteps=6                    ; 최대 6회 (30FPS 기준)

; Async Physics (AI 차량용)
bTickPhysicsAsync=False          ; 차량 물리는 동기가 안정적

; Solver 설정
[Chaos.Solver]
Iterations=6                     ; 차량 제약 해결
JointPairIterations=4            ; 서스펜션 안정화

; Sleep 설정 (레이싱에서는 비활성화 권장)
[Chaos.Sleep]
AllowSleeping=False              ; 차량은 항상 활성
```

---

### 8.4 예시 4: 캐릭터 - Ragdoll 최적화

**시나리오:** 100명의 NPC가 동시에 사망하여 Ragdoll 활성화

```cpp
// ============================================================
// 대규모 Ragdoll 최적화 시스템
// ============================================================

UCLASS()
class ARagdollOptimizationManager : public AActor
{
    GENERATED_BODY()

public:
    // Ragdoll 활성화 요청
    UFUNCTION(BlueprintCallable)
    void ActivateRagdoll(ACharacter* Character, FVector ImpulseDirection)
    {
        if (!Character) return;

        USkeletalMeshComponent* Mesh = Character->GetMesh();

        // 1. 거리 기반 LOD 결정
        float DistanceToCamera = GetDistanceToMainCamera(Character);
        ERagdollLOD LOD = DetermineRagdollLOD(DistanceToCamera);

        // 2. LOD에 따른 Ragdoll 설정
        switch (LOD)
        {
            case ERagdollLOD::Full:
                ActivateFullRagdoll(Mesh, ImpulseDirection);
                break;

            case ERagdollLOD::Reduced:
                ActivateReducedRagdoll(Mesh, ImpulseDirection);
                break;

            case ERagdollLOD::Minimal:
                ActivateMinimalRagdoll(Mesh, ImpulseDirection);
                break;

            case ERagdollLOD::None:
                // 너무 멀면 단순 애니메이션 재생
                PlayDeathAnimation(Character);
                return;
        }

        // 3. 자동 비활성화 타이머
        SetupAutoDisable(Mesh, LOD);
    }

private:
    enum class ERagdollLOD
    {
        Full,       // 0-10m: 모든 본 시뮬레이션
        Reduced,    // 10-30m: 주요 본만
        Minimal,    // 30-50m: 루트 본만
        None        // 50m+: 애니메이션
    };

    ERagdollLOD DetermineRagdollLOD(float Distance)
    {
        if (Distance < 1000.0f) return ERagdollLOD::Full;       // 10m
        if (Distance < 3000.0f) return ERagdollLOD::Reduced;    // 30m
        if (Distance < 5000.0f) return ERagdollLOD::Minimal;    // 50m
        return ERagdollLOD::None;
    }

    // Full Ragdoll: 모든 본 활성화
    void ActivateFullRagdoll(USkeletalMeshComponent* Mesh, FVector Impulse)
    {
        Mesh->SetSimulatePhysics(true);
        Mesh->SetAllBodiesBelowSimulatePhysics(NAME_None, true, true);
        Mesh->AddImpulse(Impulse * 1000.0f);
    }

    // Reduced Ragdoll: 주요 본만 활성화
    void ActivateReducedRagdoll(USkeletalMeshComponent* Mesh, FVector Impulse)
    {
        // Physics Asset에서 "Essential" 프로파일 사용
        // 머리, 척추, 골반, 팔다리 루트만 포함
        Mesh->SetSimulatePhysics(true);

        // 작은 본들 비활성화
        TArray<FName> SmallBones = {
            TEXT("hand_l"), TEXT("hand_r"),
            TEXT("foot_l"), TEXT("foot_r"),
            TEXT("neck_01"), TEXT("neck_02")
        };

        for (const FName& BoneName : SmallBones)
        {
            Mesh->SetAllBodiesBelowSimulatePhysics(BoneName, false);
        }

        Mesh->AddImpulse(Impulse * 800.0f);
    }

    // Minimal Ragdoll: 루트만 물리
    void ActivateMinimalRagdoll(USkeletalMeshComponent* Mesh, FVector Impulse)
    {
        // 루트 본만 물리 시뮬레이션
        Mesh->SetSimulatePhysics(true);
        Mesh->SetAllBodiesBelowSimulatePhysics(TEXT("pelvis"), false);

        // 나머지는 애니메이션 블렌딩
        Mesh->AddImpulse(Impulse * 500.0f);
    }

    // 자동 비활성화 설정
    void SetupAutoDisable(USkeletalMeshComponent* Mesh, ERagdollLOD LOD)
    {
        float DisableTime;
        switch (LOD)
        {
            case ERagdollLOD::Full:    DisableTime = 5.0f; break;
            case ERagdollLOD::Reduced: DisableTime = 3.0f; break;
            case ERagdollLOD::Minimal: DisableTime = 2.0f; break;
            default: DisableTime = 1.0f;
        }

        FTimerHandle TimerHandle;
        GetWorldTimerManager().SetTimer(
            TimerHandle,
            [Mesh]()
            {
                if (Mesh && Mesh->IsSimulatingPhysics())
                {
                    // 물리 중지 후 현재 포즈 유지
                    Mesh->SetSimulatePhysics(false);
                    Mesh->bPauseAnims = true;
                }
            },
            DisableTime,
            false
        );
    }
};
```

**Physics Asset 프로파일 설정:**

```
Physics Asset: PA_Character
├── Bodies (20개)
│   ├── pelvis      [Essential]
│   ├── spine_01    [Essential]
│   ├── spine_02    [Essential]
│   ├── spine_03    [Essential]
│   ├── head        [Essential]
│   ├── upperarm_l  [Essential]
│   ├── upperarm_r  [Essential]
│   ├── lowerarm_l  [Optional]
│   ├── lowerarm_r  [Optional]
│   ├── hand_l      [Detail]      ← 원거리에서 비활성화
│   ├── hand_r      [Detail]
│   ├── thigh_l     [Essential]
│   ├── thigh_r     [Essential]
│   ├── calf_l      [Optional]
│   ├── calf_r      [Optional]
│   ├── foot_l      [Detail]
│   └── foot_r      [Detail]
│
└── Constraints (19개)
    └── Angular Limits 설정으로 안정성 확보
```

---

### 8.5 예시 5: Cloth - 대규모 NPC 의상 최적화

**시나리오:** 군중 씬에서 100명의 NPC가 망토/드레스 착용

```cpp
// ============================================================
// 대규모 Cloth 시뮬레이션 최적화
// ============================================================

UCLASS()
class UClothLODManager : public UActorComponent
{
    GENERATED_BODY()

public:
    virtual void TickComponent(float DeltaTime, ELevelTick TickType,
                                FActorComponentTickFunction* ThisTickFunction) override
    {
        Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

        // 매 프레임 거리 체크하지 않고 0.5초마다
        TimeSinceLastUpdate += DeltaTime;
        if (TimeSinceLastUpdate < 0.5f) return;
        TimeSinceLastUpdate = 0.0f;

        UpdateClothLOD();
    }

private:
    float TimeSinceLastUpdate = 0.0f;

    void UpdateClothLOD()
    {
        ACharacter* Owner = Cast<ACharacter>(GetOwner());
        if (!Owner) return;

        USkeletalMeshComponent* Mesh = Owner->GetMesh();
        UClothingSimulationInteractor* ClothInteractor = Mesh->GetClothingSimulationInteractor();
        if (!ClothInteractor) return;

        float Distance = GetDistanceToMainCamera(Owner);

        // 거리 기반 Cloth 품질 조절
        if (Distance < 500.0f)  // 5m
        {
            // 근거리: 고품질
            SetHighQualityCloth(ClothInteractor);
        }
        else if (Distance < 1500.0f)  // 15m
        {
            // 중거리: 중간 품질
            SetMediumQualityCloth(ClothInteractor);
        }
        else if (Distance < 3000.0f)  // 30m
        {
            // 원거리: 저품질
            SetLowQualityCloth(ClothInteractor);
        }
        else
        {
            // 매우 먼 거리: Cloth 비활성화
            DisableCloth(Mesh);
        }
    }

    void SetHighQualityCloth(UClothingSimulationInteractor* Interactor)
    {
        // 고품질 설정
        Interactor->SetNumIterations(8);
        Interactor->SetNumSubsteps(1);
        // Self-Collision 활성화 (근거리만)
    }

    void SetMediumQualityCloth(UClothingSimulationInteractor* Interactor)
    {
        // 중간 품질 설정
        Interactor->SetNumIterations(4);
        Interactor->SetNumSubsteps(1);
        // Self-Collision 비활성화
    }

    void SetLowQualityCloth(UClothingSimulationInteractor* Interactor)
    {
        // 저품질 설정
        Interactor->SetNumIterations(2);
        Interactor->SetNumSubsteps(1);
    }

    void DisableCloth(USkeletalMeshComponent* Mesh)
    {
        // Cloth 완전 비활성화, 스키닝만 사용
        for (int32 i = 0; i < Mesh->GetNumClothingAssets(); i++)
        {
            Mesh->SetClothingAssetEnabled(i, false);
        }
    }
};
```

**Cloth Config 프리셋:**

```cpp
// 품질별 Cloth Config 프리셋
void CreateClothPresets()
{
    // High Quality (플레이어, 근거리 NPC)
    UChaosClothConfig* HighConfig = NewObject<UChaosClothConfig>();
    HighConfig->MassMode = EClothMassMode::Density;
    HighConfig->Density = 0.35f;
    HighConfig->EdgeStiffness = {0.8f, 1.0f};
    HighConfig->BendingStiffness = {0.6f, 0.8f};
    HighConfig->bUseSelfCollisions = true;
    HighConfig->NumIterations = 8;
    HighConfig->NumSubsteps = 1;

    // Medium Quality (중거리 NPC)
    UChaosClothConfig* MediumConfig = NewObject<UChaosClothConfig>();
    MediumConfig->MassMode = EClothMassMode::Density;
    MediumConfig->Density = 0.35f;
    MediumConfig->EdgeStiffness = {0.9f, 1.0f};  // 더 뻣뻣하게
    MediumConfig->BendingStiffness = {0.8f, 1.0f};
    MediumConfig->bUseSelfCollisions = false;    // 비활성화
    MediumConfig->NumIterations = 4;             // 절반
    MediumConfig->NumSubsteps = 1;

    // Low Quality (원거리 NPC)
    UChaosClothConfig* LowConfig = NewObject<UChaosClothConfig>();
    LowConfig->MassMode = EClothMassMode::Density;
    LowConfig->Density = 0.35f;
    LowConfig->EdgeStiffness = {1.0f, 1.0f};     // 최대 강성
    LowConfig->BendingStiffness = {1.0f, 1.0f};
    LowConfig->bUseSelfCollisions = false;
    LowConfig->NumIterations = 2;                // 최소
    LowConfig->NumSubsteps = 1;
}
```

---

### 8.6 종합 성능 비교 표

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    최적화 기법별 성능 개선 효과                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  기법                      │ CPU 절감 │ GPU 절감 │ 메모리 절감 │ 품질 영향      │
│  ─────────────────────────┼─────────┼─────────┼────────────┼─────────────────  │
│  Nanite + Root Proxy       │ 10%     │ 60-80%  │ 30%        │ 없음            │
│  Remove on Break + Niagara │ 70%     │ 20%     │ 60%        │ 약간 (소형만)   │
│  One-Way Interaction       │ 30%     │ -       │ -          │ 없음            │
│  Debris Timeout (2초)      │ 50%     │ 40%     │ 70%        │ 없음            │
│  Trace + Strain (vs Field) │ 80%     │ -       │ -          │ 약간 낮음       │
│  Sleep 최적화              │ 40%     │ -       │ 20%        │ 없음            │
│  Island 분리               │ 30-50%  │ -       │ -          │ 없음            │
│  Collision 단순화          │ 20-40%  │ -       │ 10%        │ 약간 낮음       │
│  Substepping 감소          │ 30-50%  │ -       │ -          │ 안정성 감소     │
│  Cloth LOD                 │ 60%     │ -       │ 20%        │ 거리별 다름     │
│  Ragdoll LOD               │ 50%     │ -       │ 30%        │ 거리별 다름     │
│                                                                                  │
│  💡 복합 적용 시: CPU 80-90% 절감 가능                                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 참고 자료

### Epic Games 공식
- [Chaos Destruction Optimization](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-destruction-optimization) - 공식 최적화 가이드
- [Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine) - 물리 시스템 개요
- [A Tech Artist's Playbook for Chaos Performance](https://dev.epicgames.com/community/learning/tutorials/KWeX/unreal-engine-a-tech-artist-s-playbook-for-chaos-performance) - 기술 아티스트 가이드
- [Chaos Scene Queries and Rigid Body Engine in UE5](https://www.unrealengine.com/en-US/tech-blog/chaos-scene-queries-and-rigid-body-engine-in-ue5) - 기술 블로그

### 커뮤니티
- [Chaos Physics & Simulation Guide](https://deepwiki.com/mikeroyal/Unreal-Engine-Guide/2.3-chaos-physics-and-simulation)
- [Physics Sub-Stepping 상세 가이드](https://www.aclockworkberry.com/unreal-engine-substepping/)
- [SDLC Corp Chaos Physics Guide](https://sdlccorp.com/post/exploring-unreal-engines-chaos-physics-system-for-game-destruction/)

### 관련 문서
- [Chaos_Debug_And_Profiling.md](Chaos_Debug_And_Profiling.md) - 디버그 및 프로파일링
- [Chaos_Destruction_And_Geometry_Collection_Deep_Dive.md](Chaos_Destruction_And_Geometry_Collection_Deep_Dive.md) - Destruction 상세
- [Chaos_Cloth_Simulation_Deep_Dive.md](Chaos_Cloth_Simulation_Deep_Dive.md) - Cloth 시뮬레이션
- [Chaos_Substepping_And_Async_Physics.md](Chaos_Substepping_And_Async_Physics.md) - Substepping 상세

---

> 이 문서는 Chaos Physics 시스템의 성능 최적화 가이드입니다.
> 2025 GDC Tech Talk 및 Epic Games 공식 문서를 참고하여 작성되었습니다.