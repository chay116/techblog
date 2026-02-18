---
title: "ModelLoader - 모델 로딩 시스템"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# ModelLoader - 모델 로딩 시스템

> Updated: 2025-12-17 — Phase 4 구현 문서화

## 🧭 Overview

ModelLoader 모듈은 **MJCF (MuJoCo XML)** 및 **URDF (ROS Robot Description)** 포맷의 로봇 모델을 로드하고, 내부 `FMuJoCoModel` 구조체로 변환합니다.

**📂 위치:** `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Public/Loader/ModelLoader.h`

---

## 🏗️ 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Model Loading Architecture                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    IModelLoader (Interface)                      │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  + LoadFromFile(FilePath, Options) → FMuJoCoModel              │   │
│  │  + LoadFromString(Content, Options) → FMuJoCoModel             │   │
│  │  + GetSupportedExtensions() → TArray<FString>                   │   │
│  │  + GetLastError() → FString                                     │   │
│  └───────────────────────────┬─────────────────────────────────────┘   │
│                              │                                          │
│              ┌───────────────┼───────────────┐                         │
│              ▼               ▼               ▼                         │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐    │
│  │  FMJCFLoader      │ │  FURDFLoader      │ │ FPredefinedModels │    │
│  │  (.xml, .mjcf)    │ │  (.urdf, .xacro)  │ │ (프로그래매틱)     │    │
│  └─────────┬─────────┘ └─────────┬─────────┘ └─────────┬─────────┘    │
│            │                     │                     │               │
│            └─────────────────────┴─────────────────────┘               │
│                                  │                                      │
│                                  ▼                                      │
│                    ┌─────────────────────────────┐                     │
│                    │       FMuJoCoModel          │                     │
│                    │  - Bodies, Joints           │                     │
│                    │  - Actuators                │                     │
│                    │  - Nq, Nv, Nu               │                     │
│                    └─────────────────────────────┘                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  FModelLoaderFactory                             │   │
│  │  + CreateLoaderForFile(FilePath) → IModelLoader                 │   │
│  │  + LoadModel(FilePath, Options) → FMuJoCoModel                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 핵심 클래스

### EModelLoadResult - 로드 결과

```cpp
enum class EModelLoadResult : uint8
{
    Success,            // 성공
    FileNotFound,       // 파일 없음
    ParseError,         // XML 파싱 에러
    InvalidFormat,      // 잘못된 포맷
    UnsupportedFeature, // 지원하지 않는 기능
    MemoryError         // 메모리 할당 실패
};
```

### FModelLoadOptions - 로드 옵션

```cpp
struct FModelLoadOptions
{
    FReal LengthScale = 1.0;           // 길이 스케일
    FReal MassScale = 1.0;             // 질량 스케일
    TOptional<FVector3d> GravityOverride; // 중력 오버라이드
    bool bMergeFixedJoints = true;     // 고정 조인트 병합
    bool bLoadVisuals = false;         // 시각적 메시 로드
    bool bLoadCollisions = true;       // 충돌 메시 로드
    FString AssetBasePath;             // 에셋 기본 경로
    bool bVerbose = false;             // 상세 로깅
};
```

---

## 🔧 FMJCFLoader - MuJoCo XML 파서

### 지원하는 MJCF 요소

| 요소 | 지원 상태 | 설명 |
|------|----------|------|
| `<mujoco>` | ✅ | 루트 요소 |
| `<compiler>` | ✅ | 컴파일러 옵션 (angle, coordinate) |
| `<option>` | ✅ | 시뮬레이션 옵션 (gravity, timestep, integrator) |
| `<default>` | ✅ | 기본값 설정 (joint, geom) |
| `<worldbody>` | ✅ | 월드 바디 및 하위 구조 |
| `<body>` | ✅ | 강체 정의 (pos, quat, euler, axisangle) |
| `<inertial>` | ✅ | 관성 정의 (mass, pos, diaginertia, fullinertia) |
| `<joint>` | ✅ | 조인트 정의 (hinge, slide, ball, free) |
| `<geom>` | ⚠️ | 기하 형상 (프레임워크만) |
| `<actuator>` | ✅ | 액추에이터 섹션 |
| `<motor>` | ✅ | 토크 모터 |
| `<position>` | ✅ | 위치 제어 액추에이터 |
| `<velocity>` | ✅ | 속도 제어 액추에이터 |
| `<asset>` | ❌ | 메시/텍스처 (Phase 5) |
| `<tendon>` | ❌ | 텐돈 (Phase 7) |
| `<sensor>` | ❌ | 센서 (미구현) |

### 파싱 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MJCF Parsing Flow                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LoadFromFile(FilePath)                                                │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────┐                                                   │
│  │ Read File       │ → FFileHelper::LoadFileToString                   │
│  └────────┬────────┘                                                   │
│           ▼                                                             │
│  LoadFromString(Content)                                               │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────┐                                                   │
│  │ ParseDocument   │ → FXmlFile 파싱                                   │
│  └────────┬────────┘                                                   │
│           ▼                                                             │
│  ┌─────────────────┐                                                   │
│  │ ParseMuJoCoElem │ → <mujoco> 루트 처리                              │
│  └────────┬────────┘                                                   │
│           │                                                             │
│     ┌─────┴─────┬─────────────┬─────────────┐                         │
│     ▼           ▼             ▼             ▼                         │
│ <compiler>  <option>     <default>    <worldbody>                     │
│     │           │             │             │                         │
│     └───────────┴─────────────┴─────────────┘                         │
│                                │                                        │
│                                ▼                                        │
│                  ParseWorldBodyElement (재귀)                          │
│                         │                                               │
│           ┌─────────────┼─────────────┐                                │
│           ▼             ▼             ▼                                │
│       <body>        <joint>       <geom>                               │
│           │                                                             │
│           └─→ ParseBodyElement (재귀)                                  │
│                                                                         │
│  Post-Processing:                                                       │
│  1. LengthScale / MassScale 적용                                       │
│  2. GravityOverride 적용                                               │
│  3. Nq, Nv, Nu 계산                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 사용 예시

```cpp
#include "Loader/ModelLoader.h"

using namespace MuJoCoChaos;

// 1. 팩토리를 통한 자동 로드
FModelLoadOptions Options;
Options.LengthScale = 100.0;  // cm → m 변환
Options.bVerbose = true;

TUniquePtr<FMuJoCoModel> Model;
EModelLoadResult Result = FModelLoaderFactory::LoadModel(
    TEXT("Models/humanoid.xml"),
    Options,
    Model
);

if (Result == EModelLoadResult::Success)
{
    UE_LOG(LogTemp, Log, TEXT("Loaded model: %s with %d joints"),
        *Model->Name, Model->Njnt);
}

// 2. 직접 로더 사용
FMJCFLoader Loader;
TUniquePtr<FMuJoCoModel> Model2;
Loader.LoadFromFile(TEXT("Models/pendulum.xml"), Options, Model2);
```

---

## 🔧 FURDFLoader - URDF 파서

### 지원하는 URDF 요소

| 요소 | 지원 상태 | 설명 |
|------|----------|------|
| `<robot>` | ✅ | 루트 요소 |
| `<link>` | ✅ | 링크 정의 |
| `<inertial>` | ✅ | 관성 (mass, origin, inertia) |
| `<visual>` | ⚠️ | 시각적 형상 (origin만) |
| `<collision>` | ❌ | 충돌 형상 (미구현) |
| `<joint>` | ✅ | 조인트 정의 |
| `<origin>` | ✅ | xyz, rpy |
| `<axis>` | ✅ | 조인트 축 |
| `<limit>` | ✅ | 조인트 한계 |
| `<dynamics>` | ✅ | damping, friction |
| `<transmission>` | ✅ | 액추에이터 매핑 |

### 지원하는 조인트 타입

| URDF 타입 | MuJoCo 타입 | 설명 |
|----------|------------|------|
| `revolute` | Hinge | 회전 조인트 (한계 있음) |
| `continuous` | Hinge | 연속 회전 (한계 없음) |
| `prismatic` | Slide | 직선 조인트 |
| `fixed` | Fixed | 고정 |
| `floating` | Free | 자유 (6DOF) |
| `planar` | Free | 평면 (근사) |

### Kinematic Tree 구축

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    URDF Tree Building                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step 1: Parse all <link> elements                                     │
│          → ParsedLinks map (Name → FURDFLink)                          │
│                                                                         │
│  Step 2: Parse all <joint> elements                                    │
│          → ParsedJoints array (FURDFJoint)                             │
│          → ChildToParent map 구축                                       │
│                                                                         │
│  Step 3: Find root link                                                │
│          → Parent이면서 Child가 아닌 링크 찾기                          │
│                                                                         │
│  Step 4: BFS traversal                                                 │
│          root_link                                                      │
│              │                                                          │
│              ├──joint_1──▶ link_1                                      │
│              │                │                                         │
│              │                └──joint_3──▶ link_3                     │
│              │                                                          │
│              └──joint_2──▶ link_2                                      │
│                                                                         │
│  Step 5: Create FBodyDesc and FJointDesc                               │
│          - LocalPosition = joint origin                                │
│          - ParentIndex = parent body index                             │
│          - Qpos/Qvel indices 할당                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🏭 FPredefinedModels - 사전 정의 모델

프로그래매틱하게 생성 가능한 테스트용 모델들:

### 사용 가능한 모델

| 모델 | 함수 | Bodies | Joints | 설명 |
|------|------|--------|--------|------|
| Pendulum | `CreatePendulum()` | 2 | 1 | 단진자 |
| DoublePendulum | `CreateDoublePendulum()` | 3 | 2 | 이중진자 |
| CartPole | `CreateCartPole()` | 3 | 2 | 카트폴 |
| Chain | `CreateChain(N)` | N+1 | N | N-링크 체인 |
| Humanoid | `CreateHumanoid()` | 4+ | - | 휴머노이드 (간략) |
| Quadruped | `CreateQuadruped()` | 6 | 4 | 4족 로봇 |
| RoboticArm | `CreateRoboticArm(N)` | N+2 | N | N-DOF 로봇팔 |
| BallInCup | `CreateBallInCup()` | 3 | 3 | 볼인컵 |

### 사용 예시

```cpp
// 단진자 생성
auto Pendulum = FPredefinedModels::CreatePendulum(
    1.0,   // Length
    1.0,   // Mass
    0.1    // Damping
);

// 카트폴 생성 (RL 벤치마크)
auto CartPole = FPredefinedModels::CreateCartPole(
    1.0,   // Cart mass
    0.1,   // Pole mass
    1.0,   // Pole length
    4.0    // Track length
);

// 6-DOF 로봇팔 생성
auto Arm = FPredefinedModels::CreateRoboticArm(
    6,     // NumJoints
    0.2    // LinkLength
);
```

---

## 🎮 URlArticulationComponent - Blueprint 컴포넌트

### 클래스 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    URlArticulationComponent                             │
│  (UActorComponent 상속, BlueprintSpawnableComponent)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Configuration Properties:                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ SourceType: MJCF | URDF | Predefined | Custom                   │   │
│  │ ModelFilePath: FString                                          │   │
│  │ PredefinedModel: Pendulum | CartPole | ...                      │   │
│  │ ModelScale: float                                               │   │
│  │ Timestep: float                                                 │   │
│  │ SolverIterations: int32                                         │   │
│  │ bEnableVisualization: bool                                      │   │
│  │ bAutoSimulate: bool                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  State Access (BlueprintPure):                                         │
│  - GetJointStates() → TArray<FArticulationJointState>                  │
│  - GetJointPositions() → TArray<float>                                 │
│  - GetJointVelocities() → TArray<float>                                │
│  - GetLinkStates() → TArray<FArticulationLinkState>                    │
│  - GetObservation() → TArray<float>                                    │
│                                                                         │
│  Control (BlueprintCallable):                                          │
│  - SetControl(TArray<float>)                                           │
│  - SetActuatorControl(Index, Value)                                    │
│  - SetJointPositionTarget(Index, Position)                             │
│  - SetJointVelocityTarget(Index, Velocity)                             │
│  - ApplyExternalForce(BodyIndex, Force, Position)                      │
│                                                                         │
│  Simulation (BlueprintCallable):                                       │
│  - Step(DeltaTime) → FArticulationStepResult                          │
│  - StepN(NumSteps, DeltaTime) → FArticulationStepResult               │
│  - Reset()                                                             │
│  - ResetToState(Positions, Velocities)                                 │
│  - SetRandomState(PosScale, VelScale)                                  │
│                                                                         │
│  RL Interface (BlueprintCallable):                                     │
│  - RLReset() → TArray<float> (observation)                             │
│  - RLStep(Action, OutObs, OutReward, OutDone) → bool                  │
│                                                                         │
│  Events:                                                                │
│  - OnModelLoaded                                                       │
│  - OnSimulationStep                                                    │
│  - OnEpisodeEnd                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Blueprint 노드 예시

**모델 로드:**
```
[Event BeginPlay]
      │
      ▼
[Load Predefined Model]
  │ Model Type: CartPole
  │
  ▼
[Branch: Is Model Loaded?]
  │ True
  ▼
[Print: "Model loaded!"]
```

**RL 학습 루프:**
```
[RLReset]
      │
      ▼
  ┌──[Observation]
  │
  ▼
[Your Policy] ──▶ [Action]
  │
  ▼
[RLStep]
  │ Action: [Action]
  │
  ├──▶ OutObservation
  ├──▶ OutReward
  └──▶ OutDone
         │
         ▼
    [Branch: OutDone?]
     │ True      │ False
     ▼           └──▶ [Loop to Policy]
  [RLReset]
```

### C++ 사용 예시

```cpp
// Actor에서 컴포넌트 생성
UPROPERTY(VisibleAnywhere)
URlArticulationComponent* Articulation;

void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // 모델 로드
    Articulation->LoadPredefinedModel(EPredefinedModelType::CartPole);

    // 커스텀 보상 함수 설정
    Articulation->SetRewardFunction([](const FMuJoCoModel& Model, const FMuJoCoState& State) {
        // CartPole 보상: pole이 수직에 가까울수록 높은 보상
        float PoleAngle = State.Qpos[1];
        float Reward = FMath::Cos(PoleAngle);
        return Reward;
    });

    // 종료 조건 설정
    Articulation->SetTerminationFunction([](const FMuJoCoModel& Model, const FMuJoCoState& State) {
        float PoleAngle = FMath::Abs(State.Qpos[1]);
        float CartPos = FMath::Abs(State.Qpos[0]);
        return PoleAngle > PI / 4 || CartPos > 2.0;
    });
}

void AMyActor::Tick(float DeltaTime)
{
    // 액션 생성 (예: 간단한 PD 컨트롤러)
    TArray<float> Action;
    Action.Add(ComputeAction());

    // RL Step
    TArray<float> Obs;
    float Reward;
    bool bDone;

    Articulation->RLStep(Action, Obs, Reward, bDone);

    if (bDone)
    {
        Articulation->RLReset();
    }
}
```

---

## 💡 Tips & Best Practices

### 모델 로딩

**✅ 권장:**
```cpp
// 팩토리 사용 (자동 포맷 감지)
FModelLoaderFactory::LoadModel(FilePath, Options, Model);

// 옵션 명시적 설정
FModelLoadOptions Options;
Options.LengthScale = 100.0;  // MuJoCo는 m, UE는 cm
Options.bVerbose = true;       // 디버깅시 활성화
```

**❌ 피해야 할 것:**
```cpp
// 스케일 없이 로드 (단위 불일치)
FModelLoaderFactory::LoadModel(FilePath, FModelLoadOptions(), Model);
```

### 시뮬레이션

**✅ 권장:**
```cpp
// 고정 timestep 사용 (안정성)
Articulation->Timestep = 0.001f;  // 1ms

// 여러 스텝 한번에 (효율)
Articulation->StepN(10, 0.001f);
```

**❌ 피해야 할 것:**
```cpp
// 가변 timestep (불안정)
Articulation->Step(GetWorld()->DeltaTimeSeconds);
```

### RL 학습

```cpp
// 병렬 환경 (Phase 3의 FRLPhysicsWorld 사용 권장)
// 단일 환경 테스트시만 URlArticulationComponent 사용

// 관측값 정규화 권장
TArray<float> Obs = Articulation->GetObservation();
for (float& Val : Obs)
{
    Val = FMath::Clamp(Val, -10.0f, 10.0f);
}
```

---

## 🔗 References

| 참조 | 설명 |
|------|------|
| MuJoCo MJCF Reference | mujoco.readthedocs.io/en/latest/XMLreference.html |
| ROS URDF Specification | wiki.ros.org/urdf/XML |
| `ModelLoader.h:1-350` | 로더 인터페이스 |
| `MJCFLoader.cpp:1-600` | MJCF 파서 구현 |
| `URDFLoader.cpp:1-500` | URDF 파서 구현 |
| `RlArticulationComponent.h` | Blueprint 컴포넌트 |
