---
title: "MuJoCoChaos Version History"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# MuJoCoChaos Version History

## 🗓️ Changelog

### v1.3.0 (2025-12-17)

**Architecture Refactoring - Option A: Standalone Physics Scene**

#### 새로운 FMuJoCoPhysicsScene 클래스
완전히 독립된 물리 씬으로 Chaos 충돌 감지와 MuJoCoChaos 동역학을 분리

##### 핵심 설계 변경
- [x] **별도의 Chaos Solver 생성**
  - `FChaosSolversModule::CreateSolver()` 사용
  - Standalone solver flag 설정
  - 충돌 감지 전용 (제약 풀이 제외)

- [x] **Kinematic Particles for Collision**
  - 각 MuJoCo body마다 kinematic particle 생성
  - Forward kinematics 결과로 위치 동기화
  - Chaos broadphase/narrowphase 활용

- [x] **통합 제약 솔버**
  - Joint constraints + Contact constraints 동시 처리
  - PGS/Newton 솔버 선택 가능
  - 물리적 일관성 보장 (1프레임 지연 없음)

##### 새로운 파일
- [x] `Scene/MuJoCoPhysicsScene.h` - 독립 물리 씬 헤더
  - FMuJoCoSceneConfig 구성 옵션
  - FCollisionContact, FCollisionResult 구조체
  - FKinematicBodyHandle 관리
  - FSceneStepResult 통계

- [x] `Scene/MuJoCoPhysicsScene.cpp` - 구현
  - CreateChaosSolver/DestroyChaosSolver
  - CreateKinematicParticles/DestroyKinematicParticles
  - SetupCollisionShapes (Box, Sphere, Capsule, Plane)
  - RunBroadphase/RunNarrowphase/CollectContacts
  - BuildConstraintSystem/SolveConstraints
  - IntegrateVelocities/IntegratePositions

- [x] `FBatchPhysicsScene` - 배치 시뮬레이션 클래스
  - 다중 환경 병렬 시뮬레이션
  - RL 학습용 인터페이스
  - SetControls/GetObservations

##### 아키텍처 다이어그램
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

##### API 확장
- [x] `Dynamics/ForwardDynamics.h` - 간소화 인터페이스 추가
  - `ComputeForwardKinematics(Model, State)`
  - `ComputeCRB(Model, State, ...)`
  - `ComputeRNE(Model, State, Gravity)`
  - `ComputeABA(Model, State, JointTorque, ActuatorForce)`
  - `ComputePointJacobian(Model, State, BodyIdx, Point, OutJ)`
  - `ComputeBodyJacobian(Model, State, BodyIdx, OutJ_lin, OutJ_ang)`

- [x] `Solver/PGSSolver.h` - 간소화 인터페이스 추가
  - `SolvePGS(Model, State, J, Error, Lambda, NumConstraints, ...)`
  - `SolveNewton(Model, State, J, Error, Lambda, NumConstraints, ...)`
  - `ApplyConstraintForces(Model, State, J, Lambda, NumConstraints)`

##### 기존 SimCallback vs 새 PhysicsScene 비교

| 특성 | SimCallback (v1.2) | PhysicsScene (v1.3) |
|-----|-------------------|---------------------|
| Chaos 통합 | 기존 Scene에 hook | 독립 Scene 생성 |
| 충돌 처리 | Chaos 솔버 후 수집 | Chaos 감지만 사용 |
| 제약 풀이 | MuJoCo만 or Chaos만 | 통합 (Joint+Contact) |
| 지연 | 1프레임 | 없음 |
| 렌더링 | 기존 proxy | Kinematic sync |
| 배치 지원 | 제한적 | 완전 지원 |

##### Known Limitations
- GPU 컴퓨트 셰이더 경로 미구현 (CPU 우선)
- 복잡한 메시 충돌은 기본 형상으로 대체
- 자기 충돌 필터링은 인접 body만 기본 비활성화

---

### v1.2.2 (2025-12-17)

**Chaos Contact Integration Complete - Collision Response & BodyInstance Compatibility**

#### Contact Force to Generalized Coordinates 구현
- [x] `ChaosIntegration/ChaosContactHandler.h/cpp` - 충돌 응답 핸들러
  - `CollectContactImpulses()` - Chaos FPBDCollisionConstraint에서 impulse 수집
  - `ApplyContactForcesToGeneralized()` - Jacobian transpose를 통한 일반화 힘 변환
  - `ComputePointJacobianDefault()` - 기하학적 점 Jacobian 계산
  - 모든 조인트 타입 지원 (Revolute, Prismatic, Spherical, Free)
- [x] `FContactPointData` - 접촉점 데이터 구조체
  - BodyIdx, WorldLocation, WorldNormal, Impulse, Penetration
  - GeneralizedForce (변환된 조인트 공간 힘)

#### SimCallback PostSolve 통합
- [x] `MuJoCoSimCallback.h` - PostSolve 콜백 옵션 추가
  - `ESimCallbackOptions::PostSolve` 추가
  - `FChaosContactHandler ContactHandler` 멤버
  - `bContactResponseEnabled` 플래그
- [x] `MuJoCoSimCallback.cpp::OnPostSolve_Internal()`
  - Evolution에서 collision constraint handles 획득
  - ContactHandler를 통한 impulse 수집 및 적용

#### Chaos Integration Helper
- [x] `FChaosIntegrationHelper` - BodyInstance 호환성 유틸리티
  - `CreateCollisionShapes()` - Box, Sphere, Capsule 지오메트리 생성
  - `SetupCollisionFiltering()` - 충돌 채널 및 응답 설정
  - `DisableSelfCollision()` - 자기 충돌 비활성화
  - `CreateChaosJointConstraints()` - 네이티브 Chaos 조인트 제약 생성
  - `SyncJointLimitsToConstraints()` - 조인트 제한 동기화
  - `CreateBodyInstanceWrapper()` - FBodyInstance 스타일 래퍼

#### MuJoCoBodyInstanceWrapper
- [x] `FMuJoCoBodyInstanceWrapper` - BodyInstance 호환 인터페이스
  - `GetWorldTransform()`, `GetLinearVelocity()`, `GetAngularVelocity()`
  - `AddImpulse()`, `AddForce()` - 일반화 좌표로 변환

#### Proxy 파티클 등록
- [x] `RegisterProxy()` 업데이트
  - Proxy의 LinkHandles를 ContactHandler에 등록
  - 충돌 감지를 위한 Particle → BodyIndex 매핑

---

### v1.2.1 (2025-12-17)

**Chaos Integration Complete - Physics Proxy & Coordinate Sync**

#### Chaos Physics Proxy 완성
- [x] `ArticulatedBodyPhysicsProxy.cpp` - Chaos 파티클 생성 완료
  - `CreateParticles()` - Evolution->CreateDynamicParticles() 사용
  - `DestroyParticles()` - SOAs를 통한 파티클 소멸
  - Mass, Inertia, Position, Rotation 설정
  - Sphere 기본 충돌 지오메트리 생성
- [x] `SyncMaximalFromGeneralized()` - 좌표 동기화 완료
  - Forward Kinematics → Chaos 파티클 위치 업데이트
  - SetX(), SetR(), SetV(), SetW() 호출
  - UpdateWorldSpaceState() 공간 가속 구조 갱신
- [x] `ComputeLinkVelocity()` - 속도 계산 완료
  - 운동학 체인을 통한 속도 전파
  - 조인트 타입별 속도 기여 계산 (Revolute, Prismatic, Spherical, Free)
  - 로컬/월드 좌표 변환

#### Build.cs 의존성 수정
- [x] `RenderGraph` 모듈 추가 (GPU Compute Shader dispatch)
- [x] `XmlParser` Private 의존성 (MJCF/URDF parsing)
- [x] `Projects` 모듈 추가 (Plugin path access)
- [x] C++17 지원 (`CppStandard = CppStandardVersion.Cpp17`)
- [x] RTTI 활성화 (`bUseRTTI = true`)

---

### v1.2.0 (2025-12-17)

**Phase 5 & 7 Complete - GPU Optimization & Advanced Features**

#### Phase 5: GPU Compute Shaders
- [x] `GPU/MuJoCoGPUTypes.h` - GPU data structures
  - FGPUBodyData (128 bytes, 16-byte aligned)
  - FGPUJointData (64 bytes, 16-byte aligned)
  - FGPUSpatialVector, FGPUSpatialInertia
  - TGPUStructuredBuffer template
  - FMuJoCoGPUModel, FMuJoCoGPUBatchState
- [x] `GPU/MuJoCoComputeShaders.h` - Compute shader classes
  - FForwardKinematicsCS, FCompositeRigidBodyCS
  - FABAForwardPassCS, FIntegrationCS
  - FActuatorForceCS, FPGSIterationCS
  - FRewardComputeCS
  - FMuJoCoGPUDispatcher orchestration
- [x] `GPU/MuJoCoGPUDispatcher.cpp` - GPU dispatch implementation
- [x] Shader files (`.ush`, `.usf`):
  - `MuJoCoCommon.ush` - Quaternion, spatial math utilities
  - `ForwardKinematics.usf` - FK computation
  - `CompositeRigidBody.usf` - CRB backward pass
  - `ABAForwardPass.usf` - ABA forward dynamics
  - `Integration.usf` - Euler/Semi-implicit integration
  - `ActuatorForce.usf` - Actuator force computation
  - `PGSIteration.usf` - Constraint solver iteration
  - `RewardCompute.usf` - RL reward (CartPole, Pendulum, Humanoid)

#### Phase 7: Advanced Features
- [x] `Advanced/SoftBodyTypes.h` - Soft body data structures
  - FSoftBodyMaterial (Young's modulus, Lamé params)
  - FSoftBodyVertex, FTetrahedron
  - FDistanceConstraint, FVolumeConstraint
  - XPBD constraint base class
- [x] `Advanced/SoftBodySimulation.h/cpp` - XPBD solver
  - FSoftBodySolverConfig (iterations, substeps, damping)
  - FSoftBodySimulation class
  - Distance/Volume constraint solving
  - Rigid body attachment support
  - FSoftBodyFactory (Cube, Sphere, Beam, TetMesh)
- [x] `Advanced/TendonSystem.h/cpp` - Tendon/Muscle system
  - FTendonDesc, FTendonWrapPoint (Site, Cylinder, Sphere wrap)
  - FMuscleParams (Hill model parameters)
  - FMuscleState (activation, fiber length, forces)
  - FTendonMuscleSystem class
  - Force-Length, Force-Velocity relationships
  - Activation dynamics (τ_act, τ_deact)
  - FTendonMuscleFactory (Simple, Wrapped, Antagonist pairs)

---

### v1.1.0 (2025-12-17)

**Phase 4 Complete - Model Loading & Blueprint Integration**

#### Phase 4: Model Loading
- [x] `ModelLoader.h` - Model loader interface
  - IModelLoader base class
  - FModelLoadOptions configuration
  - FModelLoadContext parsing state
  - FModelLoaderFactory auto-detection
- [x] `MJCFLoader.cpp` - MuJoCo XML parser
  - Full MJCF element parsing
  - Body, joint, actuator support
  - Compiler, option, default settings
  - Recursive worldbody parsing
- [x] `URDFLoader.cpp` - URDF parser
  - ROS robot description format
  - Link, joint, transmission support
  - Kinematic tree building (BFS)
  - Joint type conversion
- [x] `FPredefinedModels` - Programmatic models
  - Pendulum, DoublePendulum, CartPole
  - Chain, Humanoid, Quadruped
  - RoboticArm, BallInCup
- [x] `RlArticulationComponent.h/cpp` - Blueprint component
  - UActorComponent with full Blueprint exposure
  - Model loading (file, predefined, custom)
  - State access (joints, links, observations)
  - Control interface (actuators, forces)
  - Gymnasium-style RL API (reset/step)
  - Custom reward/termination functions
  - Debug visualization

---

### v1.0.0 (2025-12-17)

**Initial Release - Phase 1~3 Complete**

#### Phase 1: Foundation
- [x] Plugin structure (`MuJoCoChaos.uplugin`, `Build.cs`)
- [x] `MuJoCoTypes.h` - Core data structures
  - FMuJoCoModel, FMuJoCoState
  - EJointType, EActuatorType enums
  - FModelBuilder fluent API
  - Predefined models (Pendulum, DoublePendulum, CartPole, Chain)
- [x] `ArticulatedBodyPhysicsProxy.h/cpp`
  - IPhysicsProxyBase implementation
  - GT ↔ PT synchronization
  - Forward kinematics

#### Phase 2: Dynamics & Solver
- [x] `MuJoCoSimCallback.h/cpp`
  - ISimCallbackObject extension
  - OnPreIntegrate, OnPostIntegrate, OnPreSolve callbacks
- [x] `ForwardDynamics.h/cpp`
  - Spatial math (FSpatialVector, FSpatialInertia, FSpatialTransform)
  - ABA (Articulated Body Algorithm)
  - RNEA (Recursive Newton-Euler Algorithm)
  - CRBA (Composite Rigid Body Algorithm)
- [x] `PGSSolver.h/cpp`
  - Projected Gauss-Seidel solver
  - Newton solver (basic)
  - Joint limit constraints
  - Contact constraints (framework)

#### Phase 3: RL Integration
- [x] `RLPhysicsWorld.h/cpp`
  - Batch simulation (nworld)
  - Gymnasium-compatible API (reset/step)
  - ParallelFor multi-threading
  - Custom reward/termination functions
  - Predefined environments

---

## 📋 Roadmap

### Phase 5: GPU Optimization ✅ Complete
- [x] GPU data structures (16-byte aligned)
- [x] CRB Compute Shader
- [x] Batched ABA on GPU
- [x] FK, Integration, Actuator, PGS, Reward shaders
- [x] FMuJoCoGPUDispatcher orchestration

### Phase 6: Python Binding (Skipped)
- *User decided to skip this phase*
- Alternative: Direct C++ API or UnrealEnginePython

### Phase 7: Advanced Features ✅ Complete
- [x] Soft body simulation (XPBD)
- [x] Tendon/muscle systems (Hill model)
- [ ] Contact dynamics refinement (Future)
- [ ] MPC integration (Future)

---

## 📁 File Summary

| File | Lines | Description |
|------|-------|-------------|
| **v1.3 - Standalone Scene** | | |
| `Scene/MuJoCoPhysicsScene.h` | ~480 | Standalone scene header |
| `Scene/MuJoCoPhysicsScene.cpp` | ~850 | Scene implementation |
| **Phase 1** | | |
| `MuJoCoTypes.h` | ~500 | Core type definitions |
| `ArticulatedBodyPhysicsProxy.h` | ~320 | Physics proxy header |
| `ArticulatedBodyPhysicsProxy.cpp` | ~1070 | Physics proxy impl + FModelBuilder |
| **Phase 2** | | |
| `MuJoCoSimCallback.h` | ~250 | SimCallback header |
| `MuJoCoSimCallback.cpp` | ~600 | SimCallback impl + dynamics |
| `ForwardDynamics.h` | ~250 | Dynamics algorithms header |
| `ForwardDynamics.cpp` | ~400 | ABA, RNEA, CRBA impl |
| `PGSSolver.h` | ~250 | Constraint solver header |
| `PGSSolver.cpp` | ~500 | PGS, Newton solver impl |
| **Phase 3** | | |
| `RLPhysicsWorld.h` | ~450 | RL environment header |
| `RLPhysicsWorld.cpp` | ~600 | Batch simulation impl |
| **Phase 4** | | |
| `ModelLoader.h` | ~350 | Loader interface + factory |
| `MJCFLoader.cpp` | ~600 | MJCF parser impl |
| `URDFLoader.cpp` | ~550 | URDF parser + predefined models |
| `RlArticulationComponent.h` | ~350 | Blueprint component header |
| `RlArticulationComponent.cpp` | ~500 | Blueprint component impl |
| **Phase 5 (GPU)** | | |
| `GPU/MuJoCoGPUTypes.h` | ~350 | GPU data structures |
| `GPU/MuJoCoComputeShaders.h` | ~450 | Compute shader classes |
| `GPU/MuJoCoGPUDispatcher.cpp` | ~400 | GPU dispatch impl |
| `Shaders/MuJoCoCommon.ush` | ~200 | HLSL common utilities |
| `Shaders/ForwardKinematics.usf` | ~100 | FK shader |
| `Shaders/CompositeRigidBody.usf` | ~100 | CRB shader |
| `Shaders/ABAForwardPass.usf` | ~100 | ABA shader |
| `Shaders/Integration.usf` | ~80 | Integration shader |
| `Shaders/ActuatorForce.usf` | ~80 | Actuator shader |
| `Shaders/PGSIteration.usf` | ~120 | PGS solver shader |
| `Shaders/RewardCompute.usf` | ~150 | Reward computation shader |
| **Phase 7 (Advanced)** | | |
| `Advanced/SoftBodyTypes.h` | ~250 | Soft body data structures |
| `Advanced/SoftBodySimulation.h` | ~150 | XPBD simulation header |
| `Advanced/SoftBodySimulation.cpp` | ~450 | XPBD implementation |
| `Advanced/TendonSystem.h` | ~420 | Tendon/Muscle types & interface |
| `Advanced/TendonSystem.cpp` | ~500 | Hill muscle implementation |
| **Chaos Integration** | | |
| `ChaosIntegration/ChaosContactHandler.h` | ~290 | Contact handler header |
| `ChaosIntegration/ChaosContactHandler.cpp` | ~850 | Contact & integration helpers |
| **Total** | **~12,110** | |

---

## 🔧 Build Configuration

```cpp
// MuJoCoChaos.Build.cs
PublicDependencyModuleNames.AddRange(new string[]
{
    "Core",
    "CoreUObject",
    "Engine",
    "Chaos",
    "PhysicsCore",
    "GeometryCore",
    "XmlParser"        // Phase 4: XML parsing
});

PrivateDependencyModuleNames.AddRange(new string[]
{
    "RenderCore",
    "RHI"
});
```

---

## 📊 Test Status

| Component | Unit Test | Integration Test | Status |
|-----------|-----------|------------------|--------|
| MuJoCoTypes | - | - | Pending |
| PhysicsProxy | - | - | Pending |
| SimCallback | - | - | Pending |
| ForwardDynamics | - | - | Pending |
| PGSSolver | - | - | Pending |
| RLPhysicsWorld | - | - | Pending |
| ModelLoader | - | - | Pending |
| RlArticulationComponent | - | - | Pending |

---

## 🐛 Known Issues

1. **Newton Solver**: Falls back to PGS (full implementation pending)
2. ~~**Contact Forces**: Framework only, not fully integrated~~ ✅ Implemented (v1.2.2)
3. ~~**GPU Path**: Not implemented (Phase 5)~~ ✅ Implemented
4. **Python Binding**: Skipped (use C++ API or UnrealEnginePython)
5. **MJCF Assets**: Mesh/texture loading not implemented
6. **URDF Collision**: Collision geometry parsing not implemented
7. **FK Visualization**: Full forward kinematics visualization pending
8. **Soft Body GPU**: Currently CPU only, GPU XPBD planned for future
9. **Muscle GPU**: Tendon/muscle system CPU only
10. **Inverse Kinematics**: `SyncGeneralizedFromMaximal()` not fully implemented
11. **Self-Collision Filter**: Framework only, actual filtering not implemented

---

## 📚 Documentation Files

| File | Description |
|------|-------------|
| `Overview.md` | Architecture and component overview |
| `MuJoCoTypes.md` | Type system documentation |
| `ChaosIntegration.md` | Chaos physics integration patterns |
| `ForwardDynamics.md` | Dynamics algorithms |
| `RLPhysicsWorld.md` | RL environment system |
| `ModelLoader.md` | Model loading & Blueprint component |
| `GPUCompute.md` | GPU compute shaders & batched simulation |
| `AdvancedFeatures.md` | Soft body & Tendon/Muscle systems |
| `VersionHistory.md` | This file |

---

## 📂 Plugin Structure

```
Plugins/MuJoCoChaos/
├── MuJoCoChaos.uplugin
├── Source/MuJoCoChaos/
│   ├── MuJoCoChaos.Build.cs
│   ├── Public/
│   │   ├── MuJoCoChaosModule.h
│   │   ├── MuJoCoTypes.h
│   │   ├── ArticulatedBodyPhysicsProxy.h
│   │   ├── MuJoCoSimCallback.h
│   │   ├── Scene/                         # v1.3 Standalone Scene
│   │   │   └── MuJoCoPhysicsScene.h
│   │   ├── Dynamics/
│   │   │   └── ForwardDynamics.h
│   │   ├── Solver/
│   │   │   └── PGSSolver.h
│   │   ├── RL/
│   │   │   └── RLPhysicsWorld.h
│   │   ├── Loader/
│   │   │   └── ModelLoader.h
│   │   ├── Components/
│   │   │   └── RlArticulationComponent.h
│   │   ├── GPU/                           # Phase 5
│   │   │   ├── MuJoCoGPUTypes.h
│   │   │   └── MuJoCoComputeShaders.h
│   │   ├── ChaosIntegration/              # Contact Integration
│   │   │   └── ChaosContactHandler.h
│   │   └── Advanced/                      # Phase 7
│   │       ├── SoftBodyTypes.h
│   │       ├── SoftBodySimulation.h
│   │       └── TendonSystem.h
│   └── Private/
│       ├── MuJoCoChaosModule.cpp
│       ├── ArticulatedBodyPhysicsProxy.cpp
│       ├── MuJoCoSimCallback.cpp
│       ├── Scene/                         # v1.3 Standalone Scene
│       │   └── MuJoCoPhysicsScene.cpp
│       ├── Dynamics/
│       │   └── ForwardDynamics.cpp
│       ├── Solver/
│       │   └── PGSSolver.cpp
│       ├── RL/
│       │   └── RLPhysicsWorld.cpp
│       ├── Loader/
│       │   ├── MJCFLoader.cpp
│       │   └── URDFLoader.cpp
│       ├── Components/
│       │   └── RlArticulationComponent.cpp
│       ├── GPU/                           # Phase 5
│       │   └── MuJoCoGPUDispatcher.cpp
│       ├── ChaosIntegration/              # Contact Integration
│       │   └── ChaosContactHandler.cpp
│       └── Advanced/                      # Phase 7
│           ├── SoftBodySimulation.cpp
│           └── TendonSystem.cpp
└── Shaders/                               # Phase 5 (GPU Shaders)
    └── Private/
        ├── MuJoCoCommon.ush
        ├── ForwardKinematics.usf
        ├── CompositeRigidBody.usf
        ├── ABAForwardPass.usf
        ├── Integration.usf
        ├── ActuatorForce.usf
        ├── PGSIteration.usf
        └── RewardCompute.usf
```
