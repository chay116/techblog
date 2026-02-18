---
title: "Chaos Solver Deep Dive - PBD Rigids Evolution"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Solver Deep Dive - PBD Rigids Evolution

## 🧭 개요 (Overview)

Chaos는 Unreal Engine 5의 **실시간 물리 시뮬레이션 시스템**으로, Position Based Dynamics (PBD) 기반 강체 (Rigid Body) 솔버를 제공합니다.

**핵심 철학:**
- **Island-Based Parallel Solving**: 독립적인 물리 객체 그룹을 병렬로 시뮬레이션
- **Position Based Dynamics**: 안정적인 제약 조건 해결을 위해 위치 기반 접근 방식 사용
- **Constraint Graph Architecture**: 파티클과 제약 조건을 그래프로 표현하여 효율적 처리

---

## 🧱 핵심 아키텍처

### 계층 구조

```
                    UWorld
                      │
                      ↓
               FPhysScene_Chaos
                      │
                      ↓ 소유
              ┌─────────────────┐
              │ FPBDRigidsSolver │  ← Game Thread ↔ Physics Thread 동기화
              └─────────────────┘
                      │
                      ↓ 소유
        ┌──────────────────────────┐
        │ FPBDRigidsEvolutionGBF   │  ← 핵심 시뮬레이션 엔진
        └──────────────────────────┘
                      │
                      ↓ 포함
        ┌──────────────────────────┐
        │ - FPBDRigidsSOAs         │  ← 파티클 저장소
        │ - CollisionConstraints   │  ← 충돌 제약
        │ - JointConstraints       │  ← Joint 제약
        │ - BroadPhase             │  ← 충돌 감지
        │ - CollisionDetector      │  ← 정밀 충돌
        │ - IslandManager          │  ← Island 관리
        │ - IslandGroupManager     │  ← 병렬 Solver
        │ - CCDManager             │  ← CCD
        │ - Clustering             │  ← GeometryCollection
        └──────────────────────────┘
```

**📂 주요 소스 파일:**
- `Engine/Source/Runtime/Experimental/Chaos/Public/PBDRigidsSolver.h:83`
- `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/PBDRigidsEvolutionGBF.h:50`
- `Engine/Source/Runtime/Experimental/Chaos/Private/Chaos/PBDRigidsEvolutionGBF.cpp:528`

---

## 🔄 Physics Tick Pipeline

매 프레임마다 실행되는 물리 시뮬레이션 파이프라인:

```
┌───────────────────────────────────────────────────────────┐
│  FPBDRigidsEvolutionGBF::AdvanceOneTimeStepImpl(Dt)       │
└───────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ↓               ↓               ↓
  ┌─────────┐   ┌─────────────┐  ┌──────────────┐
  │ Phase 1 │   │   Phase 2   │  │   Phase 3    │
  │ Pre &   │→  │  Collision  │→ │  Constraint  │
  │Integrate│   │  Detection  │  │   Solving    │
  └─────────┘   └─────────────┘  └──────────────┘
                                          │
                                          ↓
                                  ┌──────────────┐
                                  │   Phase 4    │
                                  │ Post-Solve & │
                                  │ Finalization │
                                  └──────────────┘
```

### Phase 1: Pre-Integration & Integration

**📂 위치:** `PBDRigidsEvolutionGBF.cpp:571-611`

```cpp
// 1-1. PreIntegrateCallback
if (PreIntegrateCallback != nullptr) {
    PreIntegrateCallback(Dt);  // 사용자 정의 물리 로직
}

// 1-2. Integrate - 속도와 위치 업데이트
Integrate(Dt);

// 1-3. Kinematic Target 적용
ApplyKinematicTargets(Dt, SubStepInfo.PseudoFraction);

// 1-4. PostIntegrateCallback
if (PostIntegrateCallback != nullptr) {
    PostIntegrateCallback(Dt);
}
```

**Integrate 내부 동작:**

**📂 위치:** `PBDRigidsEvolutionGBF.cpp:856-927`

```cpp
for each Dynamic Particle:
    // 1. 이전 속도 저장
    Particle.SetPreV(V);
    Particle.SetPreW(W);

    // 2. 외부 힘 적용 (중력, 필드 시스템)
    for (FForceRule ForceRule : ForceRules) {
        ForceRule(Particle, Dt);
    }

    // 3. Euler Step - 가속도 적용
    V += Particle.Acceleration() * Dt;
    W += Particle.AngularAcceleration() * Dt;

    // 4. 충격량 적용
    V += Particle.LinearImpulseVelocity();
    W += Particle.AngularImpulseVelocity();
    Particle.LinearImpulseVelocity() = FVec3(0);
    Particle.AngularImpulseVelocity() = FVec3(0);

    // 5. Ether Drag (감쇠)
    V *= (1 - Particle.LinearEtherDrag() * Dt);
    W *= (1 - Particle.AngularEtherDrag() * Dt);

    // 6. Gyroscopic Torque (회전하는 물체의 추가 회전력)
    if (Particle.GyroscopicTorqueEnabled()) {
        W = ApplyGyroscopicTorques(W, Dt);
    }

    // 7. 최대 속도 클램핑
    V = ClampToMaxSpeed(V, Particle.MaxLinearSpeedSq());
    W = ClampToMaxSpeed(W, Particle.MaxAngularSpeedSq());

    // 8. 위치와 회전 업데이트 (Semi-Implicit Euler)
    P = P + V * Dt;
    Q = Q + Quat(W * Dt / 2) * Q;

    // 9. AABB 업데이트
    Particle.UpdateWorldSpaceState(Transform, FBounds);
```

### Phase 2: Collision Detection

**📂 위치:** `PBDRigidsEvolutionGBF.cpp:626-657`

```
BroadPhase (넓은 범위 검색)
    │
    ├─ Spatial Acceleration (BVH/Grid)
    ├─ AABB Overlap 검사
    └─ Potential Collision Pairs 생성
    │
    ↓
MidPhase (중간 단계 필터링)
    │
    ├─ Complex Geometry 분해 (Convex/Trimesh)
    ├─ MidPhaseModifier Callback
    └─ Filtered Pairs
    │
    ↓
NarrowPhase (정밀 검사)
    │
    ├─ GJK/EPA 알고리즘
    ├─ Contact Manifold 생성
    │   - Contact Position
    │   - Contact Normal
    │   - Penetration Depth
    └─ Contact Point 선택 (최대 4개)
```

**소스 코드:**

```cpp
// BroadPhase
CollisionDetector.RunBroadPhase(Dt, GetCurrentStepResimCache());

// MidPhase Modifier (옵션)
if (MidPhaseModifiers) {
    ApplyMidPhaseModifier(Dt);
}

// NarrowPhase
CollisionDetector.RunNarrowPhase(Dt, GetCurrentStepResimCache());

// Post Detection Callback
if (PostDetectCollisionsCallback != nullptr) {
    PostDetectCollisionsCallback(Dt);
}

// Joint Collision Transfer (Joint로 연결된 부모에게 충돌 전달)
TransferJointConstraintCollisions();
```

### Phase 3: Constraint Graph & Solving

**📂 위치:** `PBDRigidsEvolutionGBF.cpp:689-754`

**3-1. Constraint Graph 생성:**

```cpp
// Constraint Graph 구축
CreateConstraintGraph();

// Island 생성 (Union-Find 알고리즘)
CreateIslands();

// 만료된 Collision 제거
CollisionConstraints.GetConstraintAllocator().PruneExpiredItems();
```

**Constraint Graph 개념:**

```
파티클 (Node)와 제약 조건 (Edge)로 구성된 그래프

     [Kinematic Box]
            │
        (Joint Edge)
            │
     [Dynamic Sphere A] ─────(Collision Edge)───── [Dynamic Sphere B]
            │
        (Joint Edge)
            │
     [Kinematic Ground]

Island 분리:
- Island 1: [Kinematic Box, Dynamic Sphere A, Kinematic Ground]
              + [Joint K-A, Joint A-G]
- Island 2: [Dynamic Sphere A, Dynamic Sphere B]
              + [Collision A-B]

* Dynamic Sphere A는 두 Island에 모두 속함 (Kinematic은 여러 Island 참여 가능)
```

**3-2. Island Grouping & Solving:**

```cpp
// Island를 Color로 그룹화 (병렬 처리를 위해)
IslandGroupManager.BuildGroups(bIsResim);

// PreSolveCallback
if (PreSolveCallback != nullptr) {
    PreSolveCallback(Dt);
}

// Gravity 설정
CollisionConstraints.SetGravity(GetGravityForces().GetAcceleration(0));

// Resim Cache 복원 (Network Prediction)
ReloadParticlesCache();

// Island 병렬 Solve
IslandGroupManager.Solve(Dt);

// CCD 보정 (Post-Solve)
CCDManager.ProjectCCD(Dt, CCDConstraints);

// PostSolveCallback
if (PostSolveCallback != nullptr) {
    PostSolveCallback(Dt);
}
```

**Island Solve 내부 (PBD 알고리즘):**

```
for each Island Color (순차 실행):
    for each Island in Color (병렬 실행):

        ┌─────────────────────────────────────────┐
        │ Position Iterations (기본 8회)          │
        ├─────────────────────────────────────────┤
        │ for i = 0 to 8:                         │
        │   for each Constraint:                  │
        │     Compute Position Error              │
        │     Apply Position Correction           │
        │       ΔP = -Error * Stiffness           │
        │       P0 += ΔP * (InvM0 / TotalInvM)    │
        │       P1 -= ΔP * (InvM1 / TotalInvM)    │
        └─────────────────────────────────────────┘
                        ↓
        ┌─────────────────────────────────────────┐
        │ Velocity Solve (기본 2회)               │
        ├─────────────────────────────────────────┤
        │ for i = 0 to 2:                         │
        │   V = (P - PrevP) / Dt                  │
        │   for each Constraint:                  │
        │     Compute Velocity Error              │
        │     Apply Restitution & Friction        │
        └─────────────────────────────────────────┘
                        ↓
        ┌─────────────────────────────────────────┐
        │ Projection Iterations (기본 1회)        │
        ├─────────────────────────────────────────┤
        │ for i = 0 to 1:                         │
        │   for each Constraint:                  │
        │     Hard Constraint 강제 적용            │
        │     (예: Joint Locked DOF)              │
        └─────────────────────────────────────────┘
```

### Phase 4: Post-Solve & Finalization

**📂 위치:** `PBDRigidsEvolutionGBF.cpp:768-846`

```cpp
// 4-1. Resim Cache에 상태 저장
SaveParticlePostSolve();

// 4-2. Sleep 업데이트
IslandManager.UpdateSleep(Dt);
IslandManager.UpdateDisable([this](FPBDRigidParticleHandle* Rigid) {
    DisableParticle(Rigid);
});

// 4-3. Clustering (GeometryCollection 파괴/병합)
Clustering.AdvanceClustering(Dt, GetCollisionConstraints());

// 4-4. Rewind Data 저장 (Network Prediction)
if (CaptureRewindData) {
    CaptureRewindData(Particles.GetDirtyParticlesView());
}

// 4-5. 최종 위치 적용
ParticleUpdatePosition(Particles.GetDirtyParticlesView(), Dt);
// X = P, R = Q

// 4-6. Island 정리
IslandManager.EndTick();

// 4-7. Probe Collision (다음 프레임 예측용)
if (DoFinalProbeNarrowPhase) {
    GetCollisionConstraints().DetectProbeCollisions(Dt);
}
```

---

## 🔬 핵심 시스템 상세 분석

### 1. FPBDRigidsSOAs - 파티클 저장소

**SOA (Structure of Arrays) 구조**

일반적인 AoS (Array of Structures):
```cpp
struct FParticle {
    FVec3 Position;
    FVec3 Velocity;
    FReal Mass;
};
TArray<FParticle> Particles;  // ❌ 캐시 효율 낮음
```

Chaos의 SOA 구조:
```cpp
class FPBDRigidsSOAs {
    TArray<FVec3> Positions;   // P
    TArray<FVec3> Velocities;  // V
    TArray<FReal> Masses;      // M
};
// ✅ SIMD 친화적, 캐시 효율 높음
```

**파티클 분류 (Views):**

```cpp
// 동적 파티클만
GetNonDisabledDynamicView();

// 활성 파티클 (Dynamic + Moving Kinematic)
GetActiveDynamicMovingKinematicParticlesView();

// Sleep 중이지 않은 파티클
GetActiveParticlesView();

// Dirty Particles (변경된 파티클만)
GetDirtyParticlesView();
```

### 2. Island Manager - Constraint Graph

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/Island/IslandManager.h:40`

**데이터 구조:**

```cpp
// 파티클 노드
class FPBDIslandParticle {
    FGeometryParticleHandle* Particle;        // 실제 파티클
    FPBDIsland* Island;                       // 속한 Island (Dynamic만)
    TArray<FPBDIslandConstraint*> Edges;      // 연결된 제약 조건들
    int32 Level = 0;                          // Kinematic으로부터 거리

    // Sleep 임계값
    FRealSingle SleepLinearThresholdSq;
    FRealSingle SleepAngularThresholdSq;
    int32 SleepCounterThreshold;
};

// 제약 조건 엣지
class FPBDIslandConstraint {
    FConstraintHandle* Constraint;            // 실제 제약 조건
    FPBDIsland* Island;                       // 속한 Island
    FPBDIslandParticle* Nodes[2];             // 연결된 파티클 2개
    int32 Level = 0;                          // Constraint Level (정렬용)
    uint32 LevelSortKey = 0;                  // 같은 Level 내 정렬
};

// Island - 독립적인 시뮬레이션 단위
class FPBDIsland {
    TArray<FPBDIslandParticle*> Particles;
    TArray<FPBDIslandConstraint*> Constraints;

    int32 SleepCounter = 0;
    bool bIsSleeping = false;
    bool bNeedsResim = false;

    FIterationSettings IterationSettings;     // Solver 반복 횟수 설정
};
```

**Island 생성 과정 (Union-Find):**

```cpp
void FPBDIslandManager::CreateIslands() {
    // 1. 모든 Dynamic Particle 초기화
    for (FPBDIslandParticle* Particle : DynamicParticles) {
        Particle->Island = nullptr;
    }

    // 2. 제약 조건을 따라 파티클 병합
    for (FPBDIslandConstraint* Edge : Constraints) {
        FPBDIslandParticle* P0 = Edge->Nodes[0];
        FPBDIslandParticle* P1 = Edge->Nodes[1];

        if (P0->IsDynamic() && P1->IsDynamic()) {
            FPBDIsland* Island0 = FindIsland(P0);
            FPBDIsland* Island1 = FindIsland(P1);

            if (Island0 != Island1) {
                UnionIslands(Island0, Island1);
            }
        }
    }

    // 3. Level 계산 (BFS)
    for (FPBDIsland* Island : Islands) {
        CalculateLevels(Island);
    }

    // 4. Constraint를 Level별로 정렬
    for (FPBDIsland* Island : Islands) {
        Island->Constraints.Sort([](const auto& A, const auto& B) {
            return A.GetSortKey() < B.GetSortKey();
        });
    }
}
```

**Level 개념:**

```
Kinematic Box (Level 0)
    │
    │ Joint
    ↓
Dynamic Sphere A (Level 1)
    │
    │ Collision
    ↓
Dynamic Sphere B (Level 2)
    │
    │ Collision
    ↓
Dynamic Sphere C (Level 3)

* Level이 낮은 Constraint부터 해결 → 안정성 향상
```

### 3. Island Group Manager - 병렬 Solver

**Color Grouping:**

```
Island 간 의존성:

Island 1 ────┬──── Kinematic ────┬──── Island 2
             │                   │
             └───── Joint ────────┘

→ Island 1과 Island 2는 Kinematic을 공유 → 동시 실행 불가

Color 할당:

Color 0 (병렬 실행):
  - Island 1, Island 3, Island 5

Color 1 (병렬 실행):
  - Island 2, Island 4, Island 6

* 같은 Color의 Island는 서로 독립적 → 병렬 처리
```

**Solver 코드:**

```cpp
void FPBDIslandGroupManager::Solve(FReal Dt) {
    // Color별로 순차 실행
    for (int32 ColorIndex = 0; ColorIndex < NumColors; ++ColorIndex) {
        const TArray<FPBDIsland*>& IslandsInColor = IslandsByColor[ColorIndex];

        // 같은 Color의 Island들을 병렬로 Solve
        PhysicsParallelFor(IslandsInColor.Num(), [&](int32 IslandIndex) {
            FPBDIsland* Island = IslandsInColor[IslandIndex];

            if (!Island->IsSleeping() && Island->NeedsResim()) {
                SolveIsland(Island, Dt);
            }
        });
    }
}
```

### 4. Sleep System

**Sleep 조건 확인:**

```cpp
void FPBDIslandManager::UpdateSleep(FReal Dt) {
    for (FPBDIsland* Island : Islands) {
        bool bCanSleep = true;

        for (FPBDIslandParticle* Particle : Island->Particles) {
            if (!Particle->IsDynamic()) continue;

            FPBDRigidParticleHandle* Rigid = Particle->GetParticle()->CastToRigidParticle();

            // VSmooth: 지수 이동 평균 속도
            FVec3 VSmooth = Rigid->VSmooth();
            FVec3 WSmooth = Rigid->WSmooth();

            FReal LinearSpeedSq = VSmooth.SizeSquared();
            FReal AngularSpeedSq = WSmooth.SizeSquared();

            if (LinearSpeedSq > Particle->SleepLinearThresholdSq ||
                AngularSpeedSq > Particle->SleepAngularThresholdSq) {
                bCanSleep = false;
                Island->SleepCounter = 0;
                break;
            }
        }

        if (bCanSleep) {
            Island->SleepCounter++;

            if (Island->SleepCounter >= Island->GetSleepCounterThreshold()) {
                Island->SetIsSleeping(true);

                for (FPBDIslandParticle* Particle : Island->Particles) {
                    if (Particle->IsDynamic()) {
                        Particle->GetParticle()->SetObjectState(EObjectStateType::Sleeping);
                    }
                }
            }
        }
    }
}
```

**VSmooth 계산:**

```cpp
// 매 프레임 업데이트
const FReal SmoothRate = 0.3f;  // CVars::SmoothedPositionLerpRate

FVec3 PredictedV = Particle.GetV() + Particle.Acceleration() * FakeDt + Particle.LinearImpulseVelocity();
Particle.VSmooth() = FMath::Lerp(Particle.VSmooth(), PredictedV, SmoothRate);

// 지수 이동 평균으로 노이즈 제거
```

---

## 💡 핵심 개념 및 최적화

### Position Based Dynamics (PBD)

**기본 원리:**

Impulse-Based Dynamics:
```
F = ma
Impulse = ∫F dt = mΔV
→ 속도를 직접 변경
→ 물리적으로 정확하지만 불안정
```

Position-Based Dynamics:
```
Constraint: C(x) = 0 (예: |x1 - x2| - Length = 0)
ΔP = -C(x) * Stiffness / TotalInvMass
→ 위치를 직접 변경
→ 안정적이지만 비물리적
```

**장단점:**

| 특징 | PBD | Impulse-Based |
|------|-----|---------------|
| **안정성** | 높음 (큰 Dt에서도 폭발 안 함) | 낮음 (작은 Dt 필요) |
| **파라미터** | 직관적 (Stiffness 0~1) | 복잡 (Damping, Spring Constant) |
| **병렬화** | 용이 (Jacobi-style) | 어려움 (데이터 의존성) |
| **물리 정확도** | 낮음 (에너지 보존 안 됨) | 높음 (에너지 보존) |
| **용도** | 게임 물리 | 물리 시뮬레이터 |

### Sub-Stepping

**권장 설정:**

| 시나리오 | MaxSubstepDeltaTime | 이유 |
|----------|---------------------|------|
| **일반 게임** | 1/60 (0.0167) | 60fps 기준 sub-step 없음 |
| **빠른 물체** | 1/120 (0.0083) | CCD 보조 |
| **복잡한 Joint** | 1/90 (0.011) | Ragdoll 안정성 |

**코드:**

```cpp
// Project Settings
MaxSubstepDeltaTime = 0.0167f;
MaxSubsteps = 4;

// 30fps로 떨어지면:
// Dt = 0.0333 / 0.0167 = 2 sub-steps
// 실제 시뮬레이션: 2 * 60Hz = 120Hz
```

### Inertia Conditioning

**문제:**

```
얇은 막대:
  Ixx = 833.3   (회전하기 쉬움)
  Iyy = 0.0833  (회전하기 어려움)

  → Ixx / Iyy = 10000배 차이
  → Joint로 연결 시 떨림 발생
```

**해결:**

```cpp
// Inertia를 증가 (회전하기 쉽게)
FReal TargetInvI = (RotationRatio² ) / (ConditioningDistance²);
InvI = FMath::Max(InvI, TargetInvI);

// 설정 (Console)
p.Chaos.Solver.InertiaConditioning.Enabled 1
p.Chaos.Solver.InertiaConditioning.Distance 20      // 20cm
p.Chaos.Solver.InertiaConditioning.RotationRatio 2.5
```

### Deterministic Simulation

**Network Prediction 워크플로우:**

```
Client                    Server
  │                         │
  │ 1️⃣ Predict Frame 100     │
  │    SaveCache()           │
  │                         │
  │ 2️⃣ Send Input ────────>  │
  │                         │
  │                         │ 3️⃣ Simulate Frame 100
  │                         │
  │ <──────────────── 4️⃣ Correction (Server State)
  │                         │
  │ 5️⃣ Resim 100 → 105       │
  │    LoadCache(100)        │
  │    for 101 to 105:       │
  │      Simulate()          │
  │      Compare()           │
```

**요구사항:**

```cpp
// 1. Determinism 활성화
ChaosSolver->SetIsDeterministic(true);

// 2. Rewind 활성화
ChaosSolver->EnableRewindCapture(30);  // 30 프레임 버퍼

// 3. Double Precision 사용
using FReal = double;

// 4. 병렬 처리 비활성화
if (bIsDeterministic) {
    for (int32 i = 0; i < Num; ++i) { Work(i); }
} else {
    PhysicsParallelFor(Num, Work);
}

// 5. 순서 보장
TArray instead of TMap/TSet
```

---

## 🐛 일반적인 함정 (Pitfalls)

### ❌ Kinematic Target을 한 번만 설정

```cpp
// ❌ BeginPlay에서만 설정
void BeginPlay() {
    PhysicsProxy->SetKinematicTarget_External(Target);
}

// ✅ 매 프레임 설정
void Tick(float DeltaTime) {
    if (bShouldMove) {
        PhysicsProxy->SetKinematicTarget_External(Target);
    }
}
```

### ❌ Sleep 중인 물체에 작은 힘 반복 적용

```cpp
// ❌ 매 프레임 작은 힘
void Tick(float DeltaTime) {
    BodyInstance.AddForce(FVector(0, 0, 10));  // Sleep 불가
}

// ✅ 한 번만 Impulse
void OnEvent() {
    BodyInstance.AddImpulse(Impulse);
}
```

### ❌ Sub-Step Dt를 너무 작게 설정

```cpp
// ❌
MaxSubstepDeltaTime = 0.001f;  // 1ms
// 30fps → 33 sub-steps 필요 → MaxSubsteps = 16 제한 → 슬로우 모션

// ✅
MaxSubstepDeltaTime = 0.0167f;  // 1/60
MaxSubsteps = 4;
```

---

## 🔍 디버깅 및 프로파일링

### Console Commands

```cpp
// Debug Draw
p.Chaos.DebugDraw.Enabled 1
p.Chaos.DebugDraw.ShowCollisionContacts 1
p.Chaos.DebugDraw.ShowIslands 1
p.Chaos.DebugDraw.ShowSleepState 1

// Performance Stats
stat Physics
stat PhysicsVerbose

// CSV Profiler
stat startfile
stat stopfile

// Visual Debugger
p.Chaos.VisualDebugger.Enable 1
```

### 주요 Stats 목표

| Stat | 목표 |
|------|------|
| **AdvanceOneTimeStepImpl** | < 5ms |
| **Integrate** | < 0.5ms |
| **DetectCollisions** | < 2ms |
| **PerIslandSolve** | < 2ms |

---

## 🔗 Constraints 상세

### Collision Constraints

```cpp
// Contact Point 구조
struct FContactPoint
{
    FVec3 Location;           // 충돌 위치
    FVec3 Normal;             // 충돌 Normal
    FReal Penetration;        // 침투 깊이 (음수 = 분리됨)
};

// PBD Position Correction
void SolveCollision(FContactPoint& Contact)
{
    if (Contact.Penetration > 0)
    {
        FVec3 Correction = Contact.Normal * Contact.Penetration;
        Particle1.X += Correction * (InvM1 / TotalInvM);
        Particle2.X -= Correction * (InvM2 / TotalInvM);
    }
}
```

### Joint Constraints

```cpp
// Physics Constraint Component 사용 예시
UPhysicsConstraintComponent* Constraint = ...;

// Constraint 설정
Constraint->SetLinearXLimit(ELinearConstraintMotion::Limited, 100.0f);
Constraint->SetAngularSwing1Limit(EAngularConstraintMotion::Locked, 0.0f);

// 내부: FPBDJointConstraints::Apply()
void ApplyJointConstraint(FJoint& Joint)
{
    // Linear Constraint (Position)
    FVec3 Delta = Body2.X - Body1.X - TargetOffset;
    ApplyPositionCorrection(Body1, Body2, Delta);

    // Angular Constraint (Rotation)
    FQuat DeltaQ = Body2.R * Inverse(Body1.R) * Inverse(TargetRotation);
    ApplyAngularCorrection(Body1, Body2, DeltaQ);
}
```

---

## 🎮 실전 예시

### 예시 1: Impulse 적용

```cpp
// Blueprint에서 AddImpulse
UPrimitiveComponent* Mesh = GetMesh();
Mesh->AddImpulse(FVector(0, 0, 1000), NAME_None, true);  // 위로 튀어오름

// 내부 처리:
// 1. Game Thread → Physics Thread Command 전송
// 2. Physics Thread에서 Particle.V += Impulse / Mass
```

### 예시 2: Custom Gravity

```cpp
// Per-Object Gravity
void AMyActor::Tick(float DeltaTime)
{
    UPrimitiveComponent* Mesh = GetMesh();
    FVector CustomGravity = FVector(0, 0, -980.0f) * 2.0f;  // 2배 중력
    Mesh->AddForce(CustomGravity * Mesh->GetMass());
}
```

### 예시 3: 효율적인 Collision 설정

```cpp
// Simple Collision 사용 (Box/Sphere/Capsule)
UStaticMeshComponent* Mesh = ...;
Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
Mesh->SetCollisionObjectType(ECC_PhysicsBody);
Mesh->SetSimulatePhysics(true);

// ✅ Simple Collision: ~0.1ms
// ❌ Complex Collision (Per-Poly): ~10ms+
```

### INI 설정 참고

```ini
[/Script/Engine.PhysicsSettings]
; Substep 설정 (안정성 vs 성능)
MaxSubstepDeltaTime=0.0166667  ; 60Hz
MaxSubsteps=6

; Iteration 설정
PositionIterations=8   ; 높을수록 안정적 (느림)
VelocityIterations=1
```

---

## 📚 참고 자료

**관련 문서:**
- [Chaos_Collision_Detection_Deep_Dive.md](./Chaos_Collision_Detection_Deep_Dive.md) - 충돌 감지 시스템
- [Chaos_Threading_And_Synchronization.md](./Chaos_Threading_And_Synchronization.md) - Game Thread ↔ Physics Thread 통신 아키텍처

**소스 파일:**
- `PBDRigidsSolver.h`
- `PBDRigidsEvolutionGBF.h/.cpp`
- `IslandManager.h`
- `ConstraintGroupSolver.h`

**논문:**
- [Position Based Dynamics - Müller et al. 2007](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)

**공식 문서:**
- [Chaos Physics Overview](https://docs.unrealengine.com/en-US/InteractiveExperiences/Physics/ChaosPhysics/Overview/)

---

## 요약

Chaos는 **Position Based Dynamics** 기반 실시간 물리 엔진으로:

1. **Island-Based Parallel Solving** - 독립적인 그룹을 병렬 처리
2. **Iterative Solver** - Position (8회) → Velocity (2회) → Projection (1회)
3. **Sleep Optimization** - 정지 물체 자동 비활성화 (200배 성능)
4. **Deterministic Mode** - Network Prediction 지원
5. **Sub-Stepping** - 안정성과 성능 균형
6. **Inertia Conditioning** - 작고 얇은 물체 안정성

**핵심 메트릭:**
- Position Iterations: 8회
- Velocity Iterations: 2회
- Sub-Step Dt: 1/60초
- Physics Tick 목표: < 5ms (60fps)
- Sleep Threshold: LinearV < 2cm/s

**전형적인 Scene (100 Rigid Bodies) 성능:**

| 항목 | 시간 |
|------|------|
| **Broad Phase** | 0.5ms |
| **Narrow Phase** | 1.0ms |
| **Constraint Solve** | 2.0ms |
| **Total Physics Thread** | ~4ms (Fixed 60Hz) |