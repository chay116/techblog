---
title: "MuJoCoChaos - Chaos Physics Integration"
date: "2025-12-17"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# MuJoCoChaos - Chaos Physics Integration

## 🧭 Overview

MuJoCoChaos 플러그인이 Unreal Engine의 Chaos Physics 시스템과 통합되는 방식을 설명합니다. 핵심 과제는 MuJoCo 스타일의 **Generalized Coordinates** (qpos, qvel)와 Chaos의 **Maximal Coordinates** (각 바디의 독립 6DOF) 사이의 양방향 동기화입니다.

---

## 🧱 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MuJoCoChaos - Chaos 통합 아키텍처                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Game Thread                         Physics Thread                     │
│  ┌───────────────────┐              ┌────────────────────────────────┐ │
│  │ URlArticulation   │              │ FMuJoCoSimCallback             │ │
│  │ Component         │──Push GT────▶│  ├─ OnPreIntegrate (Dynamics) │ │
│  │ (Blueprint API)   │  Data        │  ├─ OnPreSolve (Constraints)   │ │
│  │                   │◀──Pull PT────│  ├─ OnPostIntegrate (Sync)     │ │
│  └───────────────────┘   Results    │  └─ OnPostSolve (Contacts)     │ │
│         │                           └──────────────┬─────────────────┘ │
│         │                                          │                   │
│         ▼                                          ▼                   │
│  ┌───────────────────┐              ┌────────────────────────────────┐ │
│  │ FArticulatedBody  │              │ FChaosContactHandler           │ │
│  │ PhysicsProxy      │◀────────────▶│  ├─ CollectContactImpulses()  │ │
│  │  ├─ Qpos, Qvel    │              │  ├─ ApplyContactForces()       │ │
│  │  ├─ LinkHandles[] │              │  └─ ComputePointJacobian()     │ │
│  │  └─ Model/State   │              └────────────────────────────────┘ │
│  └───────────────────┘                                                 │
│                                                                         │
│  Chaos Physics System                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ FPBDRigidsEvolutionGBF                                          │   │
│  │  ├─ FPBDRigidParticleHandle[] (MuJoCoChaos Link 파티클)          │   │
│  │  ├─ FPBDCollisionConstraints (충돌 감지 및 응답)                  │   │
│  │  └─ FPBDJointConstraints (조인트 제약 - 선택적)                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 좌표계 동기화

### Generalized → Maximal (Forward Kinematics)

MuJoCoChaos의 주요 데이터 흐름은 **Generalized → Maximal** 방향입니다:

```
Qpos (Joint Positions)
        │
        ▼
┌──────────────────────────┐
│ ComputeForwardKinematics │  FK 알고리즘으로 각 링크의 월드 Transform 계산
│  - 부모→자식 순서 순회    │
│  - 조인트별 Transform 누적 │
└──────────────────────────┘
        │
        ▼
Xpos[] (Link World Transforms)
        │
        ▼
┌──────────────────────────┐
│ SyncMaximalFromGeneralized│  Chaos 파티클 업데이트
│  - SetX(), SetR()         │
│  - SetV(), SetW()         │
│  - UpdateWorldSpaceState()│
└──────────────────────────┘
        │
        ▼
Chaos Particles (Maximal Coordinates)
```

**📂 위치:** `MuJoCoSimCallback.cpp:817` - `ComputeForwardKinematics()`

```cpp
void FMuJoCoSimCallback::ComputeForwardKinematics()
{
    for (uint32 i = 0; i < Model->Nbody; ++i)
    {
        // 부모 Transform + 로컬 Transform + 조인트 Transform
        State.Xpos[i].Rotation = ParentXform.Rotation * LocalPose.Rotation * JointTransform.Rotation;
        State.Xpos[i].Position = ParentXform.Position +
            ParentXform.Rotation.RotateVector(LocalPose.Position + JointTransform.Position);
    }
}
```

---

## ⚡ Contact Force Integration

### 문제점

Chaos 충돌 솔버가 접촉 임펄스를 계산하지만, `SyncMaximalFromGeneralized()`가 파티클 위치를 덮어쓰기 때문에 접촉 응답이 무시됩니다.

### 해결책: PostSolve Contact Collection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Contact Force Integration Flow                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Chaos Constraint Solving                                               │
│  ┌──────────────────────────┐                                          │
│  │ FPBDCollisionConstraints │                                          │
│  │  └─ ManifoldPointResult  │─────┐                                    │
│  │      └─ NetImpulse       │     │                                    │
│  └──────────────────────────┘     │                                    │
│                                   ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │ OnPostSolve_Internal()                                   │          │
│  │  ├─ CollectContactImpulses(CollisionHandles, Dt)         │          │
│  │  └─ ApplyContactForcesToGeneralized(Dt)                  │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                   │                                     │
│                                   ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │ J^T * F Conversion                                       │          │
│  │  ┌─────────────────────────────────────────────────────┐ │          │
│  │  │ tau[i] = J[i,0]*F.x + J[i,1]*F.y + J[i,2]*F.z       │ │          │
│  │  │        + J[i,3]*T.x + J[i,4]*T.y + J[i,5]*T.z       │ │          │
│  │  └─────────────────────────────────────────────────────┘ │          │
│  │                                                          │          │
│  │  State->QfrcApplied[i] += tau[i]                        │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `ChaosContactHandler.cpp:159` - `ApplyContactForcesToGeneralized()`

```cpp
void FChaosContactHandler::ApplyContactForcesToGeneralized(FReal Dt)
{
    for (FContactPointData& Contact : ContactData.Contacts)
    {
        // Point Jacobian 계산
        TArray<FReal> Jacobian;
        ComputePointJacobian(Contact.BodyIdx, Contact.WorldLocation, Jacobian);

        // 임펄스 → 힘 변환
        FVector3d ContactForce = Contact.Impulse / Dt;

        // 모멘트 계산 (오프셋에 의한 토크)
        FVector3d ContactTorque = FVector3d::CrossProduct(Offset, ContactForce);

        // J^T * [F; T] 적용
        for (uint32 i = 0; i < Nv; ++i)
        {
            State->QfrcApplied[i] +=
                Jacobian[i*6 + 0] * ContactForce.X + ...
                Jacobian[i*6 + 3] * ContactTorque.X + ...;
        }
    }
}
```

---

## 🔗 Point Jacobian 계산

Jacobian은 Cartesian 공간의 속도/힘을 Joint 공간으로 변환합니다:

```
                    ┌─ v_x ─┐
                    │ v_y   │
        ┌─────┐     │ v_z   │
qdot =  │  J  │  *  │ ω_x   │    (Inverse: velocity mapping)
        └─────┘     │ ω_y   │
                    └─ ω_z ─┘

                    ┌─ F_x ─┐
                    │ F_y   │
        ┌─────┐     │ F_z   │
tau  =  │ J^T │  *  │ T_x   │    (Force mapping)
        └─────┘     │ T_y   │
                    └─ T_z ─┘
```

### 조인트 타입별 Jacobian

| Joint Type | Linear Jacobian (Jv) | Angular Jacobian (Jw) |
|------------|---------------------|----------------------|
| **Revolute** | axis × (point - joint_pos) | axis |
| **Prismatic** | axis | 0 |
| **Spherical** | [X, Y, Z축 각각] | [X, Y, Z축 각각] |
| **Free** | I (identity 3x3) | [X, Y, Z축 각각] |

**📂 위치:** `ChaosContactHandler.cpp:240` - `ComputePointJacobianDefault()`

```cpp
switch (Joint.Type)
{
case EJointType::Revolute:
    {
        // v = ω × r = axis × (point - joint_pos)
        FVector3d R = WorldPoint - JointWorldPos;
        FVector3d WorldAxis = Rot.RotateVector(Axis);
        FVector3d LinearContrib = FVector3d::CrossProduct(WorldAxis, R);

        OutJacobian[QvelStart * 6 + 0] = LinearContrib.X;
        OutJacobian[QvelStart * 6 + 1] = LinearContrib.Y;
        OutJacobian[QvelStart * 6 + 2] = LinearContrib.Z;
        OutJacobian[QvelStart * 6 + 3] = WorldAxis.X;
        OutJacobian[QvelStart * 6 + 4] = WorldAxis.Y;
        OutJacobian[QvelStart * 6 + 5] = WorldAxis.Z;
    }
    break;
}
```

---

## 🛠️ Chaos Integration Helpers

### FChaosIntegrationHelper

기존 Chaos/BodyInstance 시스템과의 호환성을 위한 유틸리티 클래스:

```cpp
class FChaosIntegrationHelper
{
    // 충돌 지오메트리 생성 (Box, Sphere, Capsule)
    static void CreateCollisionShapes(
        FArticulatedBodyPhysicsProxy* Proxy,
        const TArray<FCollisionShapeDesc>& ShapeDescs);

    // 충돌 필터링 설정 (채널, 응답)
    static void SetupCollisionFiltering(
        FArticulatedBodyPhysicsProxy* Proxy,
        ECollisionChannel ObjectChannel,
        const FCollisionResponseContainer& ResponseContainer);

    // 네이티브 Chaos 조인트 제약 생성 (PGS 대안)
    static void CreateChaosJointConstraints(
        FArticulatedBodyPhysicsProxy* Proxy,
        Chaos::FPBDRigidsEvolutionGBF* Evolution);

    // FBodyInstance 스타일 래퍼 생성
    static FMuJoCoBodyInstanceWrapper CreateBodyInstanceWrapper(
        FArticulatedBodyPhysicsProxy* Proxy,
        int32 BodyIdx);
};
```

### FMuJoCoBodyInstanceWrapper

MuJoCoChaos 링크를 FBodyInstance처럼 사용할 수 있는 래퍼:

```cpp
struct FMuJoCoBodyInstanceWrapper
{
    FArticulatedBodyPhysicsProxy* Proxy;
    int32 BodyIdx;
    Chaos::FGeometryParticleHandle* ParticleHandle;

    // FBodyInstance 호환 인터페이스
    FTransform GetWorldTransform() const;
    FVector GetLinearVelocity() const;
    FVector GetAngularVelocity() const;

    // 힘/임펄스 적용 (일반화 좌표로 변환)
    void AddImpulse(const FVector& Impulse, const FVector& Location, bool bVelChange);
    void AddForce(const FVector& Force, const FVector& Location);
};
```

---

## 🔄 SimCallback 흐름

```
Physics Thread Tick
        │
        ▼
┌───────────────────────────────┐
│ OnPreIntegrate_Internal()     │ ← Forward Dynamics 계산
│  ├─ ProcessInput()            │   (CRB, Bias Forces, ABA)
│  ├─ ApplyControl()            │
│  ├─ ComputeCRB()              │
│  ├─ ComputeBiasForces()       │
│  ├─ ComputeForwardDynamics()  │
│  ├─ IntegrateVelocities(Dt)   │
│  ├─ IntegratePositions(Dt)    │
│  └─ ComputeForwardKinematics()│
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ OnPreSolve_Internal()         │ ← 제약 솔버 (PGS/Newton)
│  ├─ BuildJacobian()           │   Joint limits, contacts
│  └─ SolvePGS() / SolveNewton()│
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ [Chaos Constraint Solving]    │ ← Chaos 자체 충돌 해결
│  └─ FPBDCollisionConstraints  │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ OnPostSolve_Internal()        │ ← 접촉 임펄스 수집 및 적용
│  ├─ CollectContactImpulses()  │
│  └─ ApplyContactForces()      │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ OnPostIntegrate_Internal()    │ ← 좌표 동기화 및 결과 출력
│  ├─ SyncMaximalFromGeneralized│
│  ├─ BufferPhysicsResults()    │
│  └─ WriteOutput()             │
└───────────────────────────────┘
```

---

## ⚙️ 사용 예시

### 기본 사용

```cpp
// 1. 모델과 프록시 생성
FMuJoCoModel* Model = new FMuJoCoModel();
*Model = Models::Pendulum(100.0, 1.0);

FArticulatedBodyPhysicsProxy* Proxy =
    new FArticulatedBodyPhysicsProxy(Owner, Model);

// 2. SimCallback에 등록
SimCallback->SetModel(Model);
SimCallback->RegisterProxy(Proxy);  // 파티클도 ContactHandler에 자동 등록

// 3. 충돌 지오메트리 설정
TArray<FCollisionShapeDesc> Shapes;
FCollisionShapeDesc& Shape = Shapes.AddDefaulted_GetRef();
Shape.BodyIdx = 1;
Shape.ShapeType = ECollisionShape::Capsule;
Shape.Extent = FVector(5.0, 5.0, 50.0);  // Radius, Radius, HalfHeight

FChaosIntegrationHelper::CreateCollisionShapes(Proxy, Shapes);
FChaosIntegrationHelper::SetupCollisionFiltering(Proxy, ECC_PhysicsBody, ...);
```

### Chaos 네이티브 조인트 사용 (선택적)

```cpp
// MuJoCoChaos PGS 대신 Chaos 조인트 제약 사용
FChaosIntegrationHelper::CreateChaosJointConstraints(Proxy, Evolution);

// SimCallback의 PGS 솔버 비활성화
SimCallback->SetSolverIterations(0);
```

---

## 📊 성능 고려사항

### 접촉 수집 오버헤드

| 접촉 수 | 오버헤드 (추정) |
|--------|---------------|
| 0-10 | < 0.1ms |
| 10-50 | 0.1-0.5ms |
| 50-100 | 0.5-1.0ms |

**최적화 팁:**
- `bContactResponseEnabled = false`로 접촉 처리 비활성화 가능
- 복잡한 충돌 지오메트리 대신 단순 프리미티브 사용
- 자기 충돌 비활성화로 불필요한 접촉 감소

### Jacobian 계산 최적화

- 캐싱: 같은 바디에 여러 접촉점이 있으면 Jacobian 재사용 가능
- 희소 행렬: Jacobian은 대부분 0 → 희소 저장 고려

---

## 🐛 알려진 제한사항

1. **역운동학 미구현**: `SyncGeneralizedFromMaximal()` 미완성
2. **자기 충돌 필터링**: 프레임워크만 구현, 실제 필터링 미완성
3. **Newton 솔버**: PGS로 폴백
4. **GPU 접촉 처리**: CPU 전용

---

## 🔗 관련 파일

| 파일 | 설명 |
|------|------|
| `ChaosIntegration/ChaosContactHandler.h` | 접촉 핸들러 헤더 |
| `ChaosIntegration/ChaosContactHandler.cpp` | 접촉 처리 구현 |
| `MuJoCoSimCallback.h` | SimCallback 헤더 |
| `MuJoCoSimCallback.cpp` | SimCallback 구현 |
| `ArticulatedBodyPhysicsProxy.h/cpp` | Physics Proxy |

---

## 📚 참조

- Featherstone, Roy. "Rigid Body Dynamics Algorithms" - Jacobian 및 역동역학
- Chaos Physics 소스: `Engine/Source/Runtime/Experimental/Chaos/`
- MuJoCo 문서: [mujoco.org](https://mujoco.org)

---

## 🏗️ v1.3 독립 Physics Scene (Option A)

### 문제점: SimCallback 방식의 한계

기존 SimCallback 방식은 **Loose Coupling** 문제가 있습니다:

1. Chaos가 먼저 충돌을 풀고
2. MuJoCoChaos가 결과를 덮어쓰기 때문에
3. **1프레임 지연**이 발생하고 물리적 일관성이 떨어집니다

### 해결책: FMuJoCoPhysicsScene

완전히 독립된 물리 씬을 생성하여 Chaos를 **충돌 감지 전용**으로만 사용:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     v1.2 (SimCallback)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  [MuJoCo Dynamics] → [Chaos Solving] → [MuJoCo Overwrite] → [1 Frame Delay]│
└─────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     v1.3 (PhysicsScene)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  [Chaos Collision Detection Only] → [Unified MuJoCo Solver] → [No Delay]│
└─────────────────────────────────────────────────────────────────────────┘
```

### 아키텍처 상세

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FMuJoCoPhysicsScene                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │ Chaos Standalone Solver │    │ MuJoCo Dynamics Engine              │ │
│  │ (Collision Only)        │    │ - Forward Dynamics (ABA)            │ │
│  │ - Broadphase            │    │ - Bias Forces (RNE)                 │ │
│  │ - Narrowphase           │────│ - Unified Constraint Solver         │ │
│  │ - Contact Generation    │    │   (Joints + Contacts)               │ │
│  └─────────────────────────┘    └─────────────────────────────────────┘ │
│              │                                  │                       │
│              ▼                                  ▼                       │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │ Kinematic Particles     │    │ Generalized Coordinates             │ │
│  │ (For Render Sync)       │◄───│ (qpos, qvel, qacc)                  │ │
│  └─────────────────────────┘    └─────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 핵심 구현 사항

1. **Standalone Chaos Solver 생성**
```cpp
// FChaosSolversModule을 통한 독립 솔버 생성
ChaosSolver = FChaosSolversModule::GetModule()->CreateSolver(
    nullptr,                          // No owner (standalone)
    -1.0,                             // Synchronous mode
    Chaos::EThreadingMode::SingleThread,
    DebugName
);
ChaosSolver->SetStandaloneSolver(true);
```

2. **Kinematic Particles for Collision**
```cpp
// 각 MuJoCo body마다 kinematic particle 생성
Chaos::FPBDRigidParticleHandle* Particle =
    Particles.CreateKinematicParticles(1)[0];

// FK 결과로 위치 동기화
Particle->SetX(State.Xpos[BodyIdx].Position);
Particle->SetR(State.Xpos[BodyIdx].Rotation);
```

3. **통합 제약 솔버**
```cpp
// Joint constraints + Contact constraints를 동시에 처리
void FMuJoCoPhysicsScene::BuildConstraintSystem()
{
    // 1. Joint limit constraints (기존)
    BuildJointLimitConstraints(Model, State, Constraints);

    // 2. Contact constraints (새로 추가)
    for (const FCollisionContact& Contact : CollisionResult.Contacts)
    {
        // Normal constraint
        AddContactNormalConstraint(Contact);
        // Friction constraints
        AddFrictionConstraints(Contact);
    }
}
```

### 사용 예시

```cpp
// 1. Scene 생성 및 초기화
FMuJoCoSceneConfig Config;
Config.FixedDeltaTime = 0.002;     // 500 Hz
Config.SolverType = ESolverType::PGS;
Config.SolverIterations = 100;
Config.MaxContacts = 256;

FMuJoCoPhysicsScene Scene;
Scene.Initialize(Config);

// 2. 모델 설정
FMuJoCoModel* Model = Models::CartPole();
Scene.SetModel(Model);

// 3. 시뮬레이션 루프
while (true)
{
    Scene.SetControl(0, Controls);
    FSceneStepResult Result = Scene.Step(DeltaTime);

    // 결과 획득
    TArrayView<const FReal> Qpos = Scene.GetQpos(0);

    // Kinematic handles로 렌더링 동기화
    for (const FKinematicBodyHandle& Handle : Scene.GetKinematicHandles())
    {
        RenderComponent->SetWorldTransform(Handle.WorldTransform);
    }
}
```

### 배치 시뮬레이션 (RL용)

```cpp
// FBatchPhysicsScene으로 다중 환경 병렬 실행
FBatchPhysicsScene BatchScene;
BatchScene.Initialize(SharedModel, 256, Config);  // 256 environments

// 한 번에 모든 환경 스텝
TArray<TArray<FReal>> Controls;  // [256 x Nu]
BatchScene.SetControls(Controls);
BatchScene.StepAll(0.002);

// 관측치 획득
TArray<TArray<FReal>> Observations;
BatchScene.GetObservations(Observations);  // [256 x ObsDim]
```

### SimCallback vs PhysicsScene 비교

| 특성 | SimCallback (v1.2) | PhysicsScene (v1.3) |
|-----|-------------------|---------------------|
| **Chaos 통합** | 기존 Scene에 hook | 독립 Scene 생성 |
| **충돌 처리** | Chaos 솔버 후 수집 | Chaos 감지만 사용 |
| **제약 풀이** | MuJoCo만 or Chaos만 | 통합 (Joint+Contact) |
| **지연** | 1프레임 | 없음 |
| **렌더링** | 기존 proxy | Kinematic sync |
| **배치 지원** | 제한적 | 완전 지원 |
| **엔진 수정** | 없음 | 없음 |

---

## 🔗 관련 파일

| 파일 | 설명 |
|------|------|
| `ChaosIntegration/ChaosContactHandler.h` | 접촉 핸들러 헤더 |
| `ChaosIntegration/ChaosContactHandler.cpp` | 접촉 처리 구현 |
| `MuJoCoSimCallback.h` | SimCallback 헤더 |
| `MuJoCoSimCallback.cpp` | SimCallback 구현 |
| `ArticulatedBodyPhysicsProxy.h/cpp` | Physics Proxy |
| **v1.3 신규** | |
| `Scene/MuJoCoPhysicsScene.h` | 독립 Scene 헤더 |
| `Scene/MuJoCoPhysicsScene.cpp` | 독립 Scene 구현 |

---

## 📚 참조

- Featherstone, Roy. "Rigid Body Dynamics Algorithms" - Jacobian 및 역동역학
- Chaos Physics 소스: `Engine/Source/Runtime/Experimental/Chaos/`
- MuJoCo 문서: [mujoco.org](https://mujoco.org)

---

> Updated: 2025-12-17 — v1.3 Standalone PhysicsScene (Option A) architecture added
