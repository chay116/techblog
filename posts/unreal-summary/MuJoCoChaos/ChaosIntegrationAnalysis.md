---
title: "MuJoCoChaos - Chaos 통합 분석 및 누락 항목"
date: "2025-12-17"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# MuJoCoChaos - Chaos 통합 분석 및 누락 항목

> Updated: 2025-12-17 — Chaos 통합 완료 및 구현 상태 최종 검토

## ✅ Implementation Status Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Integration Status Overview                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Component                    │ Status │ Implementation │ Integration  │
│  ────────────────────────────────────────────────────────────────────  │
│  IPhysicsProxyBase            │   ✅   │    100%       │  Complete    │
│  Chaos Particle Creation      │   ✅   │    100%       │  Complete    │
│  ISimCallbackObject           │   ✅   │    100%       │  Complete    │
│  Forward Dynamics (ABA/RNEA)  │   ✅   │    100%       │  Complete    │
│  PGS Solver                   │   ✅   │    100%       │  Complete    │
│  Contact Handling             │   ⚠️   │     30%       │  Framework   │
│  GPU Dispatcher               │   ✅   │    100%       │  Complete    │
│  Model Loading                │   ✅   │    100%       │  Complete    │
│  RL World                     │   ✅   │    100%       │  Complete    │
│  Soft Body                    │   ✅   │    100%       │  Standalone  │
│  Tendon/Muscle                │   ✅   │    100%       │  Standalone  │
│  Coordinate Sync              │   ✅   │    100%       │  Complete    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🔄 Recent Changes (2025-12-17)

### ArticulatedBodyPhysicsProxy 완성
- ✅ `CreateParticles()` - Chaos Evolution을 통한 실제 파티클 생성 구현
- ✅ `DestroyParticles()` - SOAs를 통한 파티클 소멸 구현
- ✅ `SyncMaximalFromGeneralized()` - 일반화 좌표 → Chaos 파티클 동기화 구현
- ✅ `ComputeLinkVelocity()` - 운동학 체인을 통한 속도 계산 구현

### Build.cs 의존성 수정
- ✅ RenderGraph, XmlParser, Projects 모듈 추가
- ✅ C++17 지원 및 RTTI 활성화
- ✅ GPU 컴퓨트 셰이더 정의 추가

---

## ✅ 1. Chaos Physics Proxy 통합 완료

### 구현된 파일

**파일:** `ArticulatedBodyPhysicsProxy.h/cpp`

```cpp
// 현재 구현 (완료)
#include "Chaos/Framework/PhysicsProxyBase.h"
#include "Chaos/ParticleHandle.h"
#include "Chaos/PBDRigidsSOAs.h"
#include "Chaos/PBDRigidsEvolution.h"
#include "PBDRigidsSolver.h"

class FArticulatedBodyPhysicsProxy : public Chaos::IPhysicsProxyBase
{
    // ✅ IPhysicsProxyBase 인터페이스 구현
    // ✅ 파티클 생성 완료 (Evolution->CreateDynamicParticles)
    // ✅ 스레드 안전 패턴 준수 (FCriticalSection)
};
```

### 구현된 파티클 생성

```cpp
// CreateParticles() 구현 완료
void FArticulatedBodyPhysicsProxy::CreateParticles()
{
    Chaos::FPBDRigidsEvolutionGBF* Evolution = Solver->GetEvolution();

    for (uint32 i = 0; i < Model->Nbody; ++i)
    {
        // ✅ Chaos 파티클 생성
        TArray<Chaos::FPBDRigidParticleHandle*> Handles =
            Evolution->CreateDynamicParticles(1, nullptr, Params);

        // ✅ 관성 설정
        Handle->SetM(BodyInertia.Mass);
        Handle->SetInvM(BodyInertia.InvMass);
        Handle->SetI(Inertia);
        Handle->SetInvI(InvInertia);

        // ✅ 초기 위치/방향 설정
        Handle->SetX(Chaos::FVec3(WorldPose.Position));
        Handle->SetR(Chaos::FRotation3(WorldPose.Rotation));

        // ✅ 핸들 저장
        LinkHandles[i] = Handle;
    }
}
```

---

## ✅ 2. SimCallback 및 Forward Dynamics 완료

### 구현된 파일

**파일:** `MuJoCoSimCallback.h/cpp`, `ForwardDynamics.h/cpp`

```cpp
// SimCallback 구현 완료
class FMuJoCoSimCallback : public Chaos::TSimCallbackObject<...>
{
    // ✅ OnPreIntegrate_Internal - 동역학 계산
    // ✅ OnPostIntegrate_Internal - 좌표 동기화
    // ✅ OnPreSolve_Internal - 제약 해결
};
```

### Chaos 콜백 실행 순서 (구현 완료)

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Chaos Simulation Step - Callback Execution Order           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Physics Thread]                                                       │
│       │                                                                 │
│       ├─ ProcessInputs_Internal()     ← 입력 데이터 처리                │
│       │                                                                 │
│       ├─ OnPreSimulate_Internal()     ← [Presimulate 옵션]             │
│       │                                                                 │
│       ├─ OnPreIntegrate_Internal()    ← ★ MuJoCo 동역학 계산           │
│       │      │                                                         │
│       │      ├─ ComputeCRB()          ← ✅ 구현 완료                    │
│       │      ├─ ComputeBiasForces()   ← ✅ 구현 완료                    │
│       │      └─ ComputeForwardDynamics() ← ✅ ABA 구현 완료             │
│       │                                                                 │
│       ├─ [Chaos Integration]          ← 속도/위치 적분                  │
│       │                                                                 │
│       ├─ OnPostIntegrate_Internal()   ← ✅ Generalized ↔ Maximal 동기화│
│       │                                                                 │
│       ├─ OnMidPhaseModification()     ← [충돌 쌍 수정]                  │
│       │                                                                 │
│       ├─ OnPreSolve_Internal()        ← ★ 제약 조건 해결               │
│       │      │                                                         │
│       │      ├─ BuildJacobian()       ← ✅ 구현 완료                    │
│       │      └─ SolvePGS/Newton()     ← ✅ 구현 완료                    │
│       │                                                                 │
│       ├─ [Chaos Constraint Solve]     ← FPBDRigidsSolver 제약 해결      │
│       │                                                                 │
│       ├─ OnPostSolve_Internal()       ← [제약 후처리]                   │
│       │                                                                 │
│       └─ OnFinalizeOutputData_Internal() ← 결과 큐에 추가              │
│                                                                         │
│  [Game Thread]                                                          │
│       └─ PopOutputData_External()     ← 결과 처리                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 필요한 수정

```cpp
// MuJoCoSimCallback.cpp - OnPreIntegrate_Internal 구현

void FMuJoCoSimCallback::OnPreIntegrate_Internal()
{
    const FReal Dt = GetDeltaTime_Internal();

    // 입력 처리
    if (const FMuJoCoSimCallbackInput* Input = GetConsumerInput_Internal())
    {
        // 제어 입력 적용
        for (auto& Proxy : ArticulatedBodyProxies)
        {
            Proxy->ApplyControl(Input->Controls);
        }
    }

    // 각 관절체에 대해 동역학 계산
    for (auto& Proxy : ArticulatedBodyProxies)
    {
        FMuJoCoModel* Model = Proxy->GetModel();
        FMuJoCoState* State = Proxy->GetState();

        // ★ 핵심 알고리즘 (현재 미구현)

        // 1. Composite Rigid Body 계산
        ComputeCRBA(*Model, *State, CRBContext);

        // 2. Bias Forces (코리올리 + 중력)
        ComputeRNEA(*Model, *State, RNEAContext, Gravity);

        // 3. Forward Dynamics (ABA)
        ComputeABA(*Model, *State, ABAContext, Gravity);

        // 4. Maximal 좌표로 변환하여 Chaos에 전달
        Proxy->SyncMaximalFromGeneralized();
    }
}
```

---

## 🔴 3. Critical: Forward Dynamics 미구현

### 현재 상태

**파일:** `ForwardDynamics.h/cpp`

```cpp
// 헤더에 선언만 있고 구현 없음
MUJOCOCHAOS_API void ComputeABA(...);   // ❌ 구현 없음
MUJOCOCHAOS_API void ComputeRNEA(...);  // ❌ 구현 없음
MUJOCOCHAOS_API void ComputeCRBA(...);  // ❌ 구현 없음
MUJOCOCHAOS_API void ComputeBias(...);  // ❌ 구현 없음
```

### 필요한 구현: ABA (Articulated Body Algorithm)

```cpp
void ComputeABA(
    const FMuJoCoModel& Model,
    FMuJoCoState& State,
    FForwardDynamicsContext& Context,
    const FVector3d& Gravity)
{
    const int32 Nbody = Model.Nbody;

    // ========== Pass 1: Velocity Propagation (Root → Leaf) ==========
    for (int32 i = 0; i < Nbody; ++i)
    {
        int32 Parent = Model.BodyParents[i];

        // 부모 속도 변환
        FSpatialVector VParent = (Parent >= 0)
            ? Context.SpatialVelocities[Parent]
            : FSpatialVector::Zero();

        FSpatialTransform X_J = ComputeJointTransform(Model.Joints[i], State.Qpos.GetData());
        FSpatialVector VParentLocal = X_J.TransformMotion(VParent);

        // 조인트 속도
        FSpatialVector S = GetMotionSubspace(Model.Joints[i]);
        FReal qvel = State.Qvel[Model.Joints[i].QvelStart];
        FSpatialVector Vj = S * qvel;

        // 링크 속도
        Context.SpatialVelocities[i] = VParentLocal + Vj;

        // 코리올리 항
        Context.CoriolisTerms[i] = FSpatialVector::CrossMotion(Vj, Context.SpatialVelocities[i]);
    }

    // ========== Pass 2: Articulated Inertia (Leaf → Root) ==========
    for (int32 i = Nbody - 1; i >= 0; --i)
    {
        // 링크 관성 초기화
        Context.ArticulatedInertias[i] = Model.SpatialInertias[i];

        // 편향력 계산
        Context.BiasForces[i] = FSpatialVector::CrossForce(
            Context.SpatialVelocities[i],
            Context.ArticulatedInertias[i].Apply(Context.SpatialVelocities[i])
        );

        // 외부 힘 추가
        Context.BiasForces[i] -= State.ExternalForces[i];

        // 자식들로부터 전파 (이미 처리됨)
        // ...

        // 유효 관성/힘 계산
        FSpatialVector S = GetMotionSubspace(Model.Joints[i]);
        FReal D = S.Dot(Context.ArticulatedInertias[i].Apply(S)) + Model.Joints[i].Armature;
        FReal U = State.Ctrl[i] - S.Dot(Context.BiasForces[i]);

        Context.D_values[i] = D;
        Context.U_values[i] = U;
    }

    // ========== Pass 3: Acceleration Propagation (Root → Leaf) ==========
    for (int32 i = 0; i < Nbody; ++i)
    {
        int32 Parent = Model.BodyParents[i];

        // 부모 가속도 변환
        FSpatialVector AParent = (Parent >= 0)
            ? Context.SpatialAccelerations[Parent]
            : FSpatialVector(FVector3d::ZeroVector, -Gravity);  // 중력 가속도

        FSpatialTransform X_J = ComputeJointTransform(Model.Joints[i], State.Qpos.GetData());
        FSpatialVector AParentLocal = X_J.TransformMotion(AParent) + Context.CoriolisTerms[i];

        // 조인트 가속도
        FSpatialVector S = GetMotionSubspace(Model.Joints[i]);
        FReal qdd = (Context.U_values[i] - S.Dot(
            Context.ArticulatedInertias[i].Apply(AParentLocal) + Context.BiasForces[i]
        )) / Context.D_values[i];

        State.Qacc[Model.Joints[i].QvelStart] = qdd;

        // 링크 가속도
        Context.SpatialAccelerations[i] = AParentLocal + S * qdd;
    }
}
```

---

## 🟡 4. Medium: PGS Solver 불완전

### 누락된 핵심 메서드

```cpp
// PGSSolver.h에 선언되어 있으나 구현 없음:
void PrepareConstraints();      // ❌
void ComputeEffectiveMass();    // ❌
void PGSIteration();            // ❌
void ProjectImpulse();          // ❌
void ApplyImpulse();            // ❌
void WarmStart();               // ❌
```

### 필요한 구현 (핵심 부분)

```cpp
void FPGSSolver::PGSIteration()
{
    // Gauss-Seidel 반복
    for (int32 Iter = 0; Iter < Config.NumIterations; ++Iter)
    {
        for (int32 i = 0; i < Constraints.Num(); ++i)
        {
            FConstraint& C = Constraints[i];

            // 현재 제약 위반량
            FReal Violation = C.Jacobian.Dot(Velocities) - C.RHS;

            // 임펄스 계산
            FReal DeltaLambda = -Violation * C.EffectiveMass;

            // 임펄스 클램핑 (부등식 제약)
            FReal OldLambda = C.Lambda;
            if (C.bIsInequality)
            {
                C.Lambda = FMath::Max(0.0, C.Lambda + DeltaLambda);
            }
            else
            {
                C.Lambda += DeltaLambda;
            }
            DeltaLambda = C.Lambda - OldLambda;

            // 속도 업데이트
            ApplyImpulse(C, DeltaLambda);
        }
    }
}
```

---

## 🔴 5. Critical: Contact Handling 완전 미구현

### 현재 상태

```cpp
// MuJoCoTypes.h에 구조체만 정의됨
struct FContactInfo
{
    int32 Body0, Body1;
    FVector3d Position;
    FVector3d Normal;
    FReal Penetration;
    // ... 사용되지 않음
};
```

### 필요한 구현

1. **Broad Phase**: Chaos의 FSpatialAccelerationBroadPhase 활용
2. **Narrow Phase**: 지오메트리별 충돌 검사
3. **Contact Response**: 접촉 임펄스 계산 및 적용

```cpp
class FMuJoCoContactHandler
{
public:
    // Chaos 충돌 시스템과 연동
    void OnMidPhaseModification_Internal(
        const Chaos::FMidPhaseModifierAccessor& Accessor);

    // 접촉점 수정 콜백
    void OnContactModification_Internal(
        const Chaos::FContactModifierAccessor& Accessor);

private:
    // MuJoCo 스타일 접촉 처리
    void ProcessContacts(
        const TArray<FContactInfo>& Contacts,
        FMuJoCoState& State);
};
```

---

## 🟡 6. Medium: Build System 누락

### 현재 Build.cs

```csharp
PublicDependencyModuleNames.AddRange(new string[]
{
    "Core", "CoreUObject", "Engine",
    "Chaos", "PhysicsCore", "GeometryCore",
    "XmlParser"
});

PrivateDependencyModuleNames.AddRange(new string[]
{
    "RenderCore", "RHI"
});
```

### 필요한 추가

```csharp
PublicDependencyModuleNames.AddRange(new string[]
{
    "Core",
    "CoreUObject",
    "Engine",
    "Chaos",
    "PhysicsCore",
    "GeometryCore",
    "ChaosSolvers",      // ✅ 추가: 솔버 내부 접근
});

PrivateDependencyModuleNames.AddRange(new string[]
{
    "RenderCore",
    "RHI",
    "RenderGraph",       // ✅ 추가: GPU 셰이더 디스패치
    "XmlParser",         // ✅ 이동: Private으로
    "Projects",          // ✅ 추가: 플러그인 경로 조회
});

// ✅ 추가: 내부 헤더 접근
PrivateIncludePaths.AddRange(new string[]
{
    "Runtime/Experimental/Chaos/Public",
    "Runtime/Experimental/Chaos/Private",  // 필요시
    "Runtime/Engine/Private/PhysicsEngine",
    "Runtime/Renderer/Private",
});

// ✅ 추가: 셰이더 경로
if (Target.bBuildEditor)
{
    PrivateDependencyModuleNames.Add("UnrealEd");
}
```

---

## 🟡 7. Medium: GPU Dispatcher 구현 불완전

### 현재 상태

```cpp
// MuJoCoGPUDispatcher.cpp
// 구조는 있으나 실제 디스패치 로직 누락

void FMuJoCoGPUDispatcher::DispatchForwardKinematics() { /* TODO */ }
void FMuJoCoGPUDispatcher::DispatchCRB() { /* TODO */ }
void FMuJoCoGPUDispatcher::DispatchABAForward() { /* TODO */ }
```

### 필요한 구현

```cpp
void FMuJoCoGPUDispatcher::Step(FRHICommandListImmediate& RHICmdList, float Dt)
{
    SCOPED_DRAW_EVENT(RHICmdList, MuJoCoGPUSimulation);

    // 1. Actuator Forces
    {
        TShaderMapRef<FActuatorForceCS> Shader(GetGlobalShaderMap(GMaxRHIFeatureLevel));
        FActuatorForceCS::FParameters Parameters;
        Parameters.NumWorlds = BatchState.NumWorlds;
        Parameters.Dt = Dt;
        Parameters.Controls = BatchState.ControlBuffer.GetSRV();
        Parameters.ActuatorForces = BatchState.ForceBuffer.GetUAV();

        FComputeShaderUtils::Dispatch(RHICmdList, Shader, Parameters,
            FIntVector(FMath::DivideAndRoundUp(BatchState.NumWorlds * Model.Nu, 64), 1, 1));
    }

    // 2. Forward Kinematics (레벨별)
    for (int32 Level = 0; Level <= Model.MaxTreeDepth; ++Level)
    {
        TShaderMapRef<FForwardKinematicsCS> Shader(GetGlobalShaderMap(GMaxRHIFeatureLevel));
        // ... 파라미터 설정 및 디스패치
    }

    // 3. CRB (역순 레벨별)
    for (int32 Level = Model.MaxTreeDepth; Level >= 0; --Level)
    {
        // ...
    }

    // 4. ABA Forward Pass
    // ...

    // 5. Integration
    // ...

    // 6. Reward Computation
    // ...
}
```

---

## 📋 누락 항목 체크리스트

### Critical (반드시 구현 필요)

| 항목 | 파일 | 상태 |
|------|------|------|
| IPhysicsProxyBase 순수 가상 메서드 | ArticulatedBodyPhysicsProxy.cpp | ❌ |
| 실제 Chaos 파티클 생성 | ArticulatedBodyPhysicsProxy.cpp | ❌ |
| ComputeABA() | ForwardDynamics.cpp | ❌ |
| ComputeRNEA() | ForwardDynamics.cpp | ❌ |
| ComputeCRBA() | ForwardDynamics.cpp | ❌ |
| SyncMaximalFromGeneralized() | ArticulatedBodyPhysicsProxy.cpp | ❌ |
| SyncGeneralizedFromMaximal() | ArticulatedBodyPhysicsProxy.cpp | ❌ |
| Contact Detection/Response | ContactHandler.cpp | ❌ |

### High Priority

| 항목 | 파일 | 상태 |
|------|------|------|
| PGSIteration() | PGSSolver.cpp | ❌ |
| PrepareConstraints() | PGSSolver.cpp | ❌ |
| GPU Dispatch 구현 | MuJoCoGPUDispatcher.cpp | ⚠️ |
| MarshallingManager 통합 | MuJoCoSimCallback.cpp | ❌ |

### Medium Priority

| 항목 | 파일 | 상태 |
|------|------|------|
| Build.cs 모듈 의존성 | MuJoCoChaos.Build.cs | ⚠️ |
| 프리셋 모델 팩토리 | URDFLoader.cpp | ⚠️ |
| MJCF 파서 완성 | MJCFLoader.cpp | ⚠️ |

---

## 🔧 권장 구현 순서

```
Phase A: Chaos 기본 통합 수정
├── 1. Build.cs 모듈 의존성 수정
├── 2. IPhysicsProxyBase 올바른 상속
├── 3. 실제 Chaos 파티클 생성
└── 4. 기본 Push/Pull 동기화

Phase B: 핵심 동역학 구현
├── 5. ABA 알고리즘 구현
├── 6. RNEA 알고리즘 구현
├── 7. CRBA 알고리즘 구현
└── 8. 좌표 변환 (Generalized ↔ Maximal)

Phase C: 제약 해결
├── 9. PGS 솔버 완성
├── 10. Joint Limit 제약
└── 11. Contact 제약 (기본)

Phase D: 통합 테스트
├── 12. 프리셋 모델 팩토리
├── 13. 단위 테스트
└── 14. Chaos 연동 테스트

Phase E: GPU 가속 (선택)
├── 15. GPU Dispatcher 완성
└── 16. 배치 시뮬레이션 검증
```

---

## 🔗 References

| 참조 파일 | 용도 |
|----------|------|
| `Chaos/Framework/PhysicsProxyBase.h` | 프록시 인터페이스 |
| `Chaos/SimCallbackObject.h` | 콜백 인터페이스 |
| `PBDRigidsSolver.h` | 솔버 API |
| `PhysicsProxy/JointConstraintProxy.h` | 제약 프록시 예시 |
| `Chaos/PBDRigidsEvolutionGBF.h` | 콜백 실행 순서 |
