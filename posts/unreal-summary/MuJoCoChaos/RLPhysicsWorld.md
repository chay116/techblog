---
title: "RLPhysicsWorld - RL 배치 시뮬레이션"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# RLPhysicsWorld - RL 배치 시뮬레이션

> Updated: 2025-12-17 — 강화학습용 병렬 물리 환경 문서화

## 🧭 Overview

RLPhysicsWorld는 **강화학습(Reinforcement Learning)** 훈련을 위한 **배치 물리 시뮬레이션** 시스템입니다. 여러 환경을 병렬로 실행하여 샘플 효율성을 극대화합니다.

**📂 위치:** `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Public/RL/RLPhysicsWorld.h`

### 핵심 특징

| 특징 | 설명 |
|------|------|
| **배치 시뮬레이션** | N개 환경 동시 실행 (nworld) |
| **Gymnasium 호환** | reset/step API |
| **병렬 처리** | ParallelFor 기반 멀티스레딩 |
| **커스터마이징** | 보상/종료 함수 등록 |

---

## 🧱 Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      RLPhysicsWorld Architecture                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Python / ML Framework                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  stable-baselines3 / PyTorch / TensorFlow                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                            │ (ZMQ / Binding)                            │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     FVectorizedEnv                               │   │
│  │  - reset() → observations[NumEnvs × ObsDim]                     │   │
│  │  - step(actions) → obs, rewards, dones, truncated               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     FRLPhysicsWorld                              │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐     ┌───────────┐   │   │
│  │  │ World 0   │ │ World 1   │ │ World 2   │ ... │ World N-1 │   │   │
│  │  │ ┌───────┐ │ │ ┌───────┐ │ │ ┌───────┐ │     │ ┌───────┐ │   │   │
│  │  │ │ State │ │ │ │ State │ │ │ │ State │ │     │ │ State │ │   │   │
│  │  │ │Context│ │ │ │Context│ │ │ │Context│ │     │ │Context│ │   │   │
│  │  │ │Solver │ │ │ │Solver │ │ │ │Solver │ │     │ │Solver │ │   │   │
│  │  │ └───────┘ │ │ └───────┘ │ │ └───────┘ │     │ └───────┘ │   │   │
│  │  └───────────┘ └───────────┘ └───────────┘     └───────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  Shared FMuJoCoModel                             │   │
│  │  (모든 World가 동일한 Model 참조)                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Key Components

### 1. FWorldConfig - 월드 설정

```cpp
struct FWorldConfig
{
    // ===== 병렬화 =====
    uint32 NumWorlds = 1;        // 병렬 환경 수
    bool bParallelWorlds = true; // 병렬 처리 활성화
    uint32 NumThreads = 0;       // 0 = 자동 감지

    // ===== 시뮬레이션 =====
    FReal Timestep = 0.002;      // 물리 dt (2ms)
    uint32 FrameSkip = 4;        // 제어 스텝당 물리 스텝
    FVector3d Gravity = FVector3d(0, 0, -981.0);

    // ===== 솔버 =====
    ESolverType Solver = ESolverType::PGS;
    uint32 SolverIterations = 100;

    // ===== 환경 설정 =====
    FEnvironmentConfig EnvConfig;
};

struct FEnvironmentConfig
{
    // ===== 에피소드 =====
    uint32 MaxEpisodeSteps = 1000;
    FReal TimeLimit = 10.0;

    // ===== 관측 공간 =====
    bool bIncludeJointPositions = true;
    bool bIncludeJointVelocities = true;
    bool bIncludeLinkTransforms = false;
    bool bIncludeContactForces = false;

    // ===== 행동 공간 =====
    bool bNormalizeActions = true;  // [-1, 1] → 실제 범위
    FReal ActionScale = 1.0;

    // ===== 종료 조건 =====
    bool bTerminateOnContact = false;
    bool bTerminateOnJointLimit = false;
    FReal TerminationHeight = -100.0;

    // ===== 리셋 =====
    bool bRandomizeInitialState = false;
    FReal InitialStateNoise = 0.0;
};
```

### 2. 배치 데이터 구조

```cpp
// 배치 관측 [NumWorlds × ObsDim]
struct FBatchObservation
{
    TArray<FReal> Data;
    uint32 NumWorlds;
    uint32 ObsDim;

    FReal* GetWorldObs(uint32 WorldIdx);
};

// 배치 행동 [NumWorlds × ActionDim]
struct FBatchAction
{
    TArray<FReal> Data;
    uint32 NumWorlds;
    uint32 ActionDim;

    FReal* GetWorldAction(uint32 WorldIdx);
};

// 스텝 결과
struct FBatchStepResult
{
    TArray<FReal> Rewards;      // [NumWorlds]
    TArray<uint8> Terminated;   // [NumWorlds] - 목표 달성/실패
    TArray<uint8> Truncated;    // [NumWorlds] - 시간 초과

    TArray<uint32> EpisodeSteps;   // 에피소드 길이
    TArray<FReal> EpisodeRewards;  // 누적 보상
};
```

### 3. FRLPhysicsWorld - 메인 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRLPhysicsWorld                                  │
│  (배치 물리 시뮬레이션 관리자)                                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - Model : FMuJoCoModel*              // 공유 물리 모델               │
│    - Config : FWorldConfig              // 설정                         │
│    - WorldStates : TArray<FMuJoCoState> // 월드별 상태 [NumWorlds]      │
│    - DynamicsContexts : TArray<...>     // 월드별 컨텍스트              │
│    - Solvers : TArray<TUniquePtr<FPGSSolver>>  // 월드별 솔버           │
│    - EpisodeStepCounts : TArray<uint32> // 에피소드 스텝 카운터         │
│    - EpisodeRewards : TArray<FReal>     // 누적 보상                    │
│    - CustomRewardFunc : FRewardFunction // 커스텀 보상 함수             │
│    - CustomTerminationFunc : FTerminationFunction  // 커스텀 종료       │
│                                                                         │
│  Public:                                                                │
│    + Initialize(model, config) : bool   // 초기화                       │
│    + Reset(outObs) : bool               // 전체 리셋                    │
│    + ResetWorld(idx, outObs) : bool     // 단일 월드 리셋               │
│    + Step(actions, outObs, outResults)  // 배치 스텝                    │
│    + StepWorld(idx, action, obs, result) // 단일 월드 스텝              │
│    + SetRewardFunction(func) : void     // 보상 함수 등록               │
│    + SetTerminationFunction(func) : void // 종료 함수 등록              │
│    + GetNumWorlds() : uint32            // 환경 수                      │
│    + GetObservationDim() : uint32       // 관측 차원                    │
│    + GetActionDim() : uint32            // 행동 차원                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Simulation Loop

### Step 흐름도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Step() Execution Flow                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step(Actions, OutObs, OutResults)                                      │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              SimulateAllWorlds(Actions)                          │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  ParallelFor(NumWorlds):                                 │    │   │
│  │  │      SimulateWorld(WorldIdx, Action)                     │    │   │
│  │  │          ├── ApplyAction()        // 제어 입력 적용      │    │   │
│  │  │          ├── for step in FrameSkip:                      │    │   │
│  │  │          │       ├── ComputeABA()       // 순동역학      │    │   │
│  │  │          │       ├── IntegrateVelocities() // 속도 적분  │    │   │
│  │  │          │       ├── SolvePGS()         // 제약 해결     │    │   │
│  │  │          │       └── IntegratePositions() // 위치 적분   │    │   │
│  │  │          └── ComputeForwardKinematics() // 순운동학      │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              ProcessResults (ParallelFor)                        │   │
│  │      ├── ComputeObservation(WorldIdx)   // 관측 계산            │   │
│  │      ├── ComputeReward(WorldIdx)        // 보상 계산            │   │
│  │      ├── CheckTermination(WorldIdx)     // 종료 확인            │   │
│  │      ├── CheckTruncation(WorldIdx)      // 시간 초과 확인       │   │
│  │      └── if (done): ResetWorldInternal() // 자동 리셋           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│         │                                                               │
│         ▼                                                               │
│  Return: (OutObs, OutResults)                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 관측 공간 구성

```cpp
void ComputeObservation(uint32 WorldIdx, FReal* OutObs) const
{
    uint32 Offset = 0;

    // 조인트 위치: [Nq]
    if (Config.EnvConfig.bIncludeJointPositions)
    {
        FMemory::Memcpy(OutObs + Offset, State.Qpos.GetData(), Nq * sizeof(FReal));
        Offset += Nq;
    }

    // 조인트 속도: [Nv]
    if (Config.EnvConfig.bIncludeJointVelocities)
    {
        FMemory::Memcpy(OutObs + Offset, State.Qvel.GetData(), Nv * sizeof(FReal));
        Offset += Nv;
    }

    // 링크 변환: [Nbody × 7] (position + quaternion)
    if (Config.EnvConfig.bIncludeLinkTransforms)
    {
        for (uint32 i = 0; i < Nbody; ++i)
        {
            // Position (3) + Quaternion (4)
        }
    }
}
```

---

## 🎮 Gymnasium API

### 기본 사용법

```cpp
// 1. 환경 생성
FWorldConfig Config;
Config.NumWorlds = 64;
Config.EnvConfig.MaxEpisodeSteps = 200;

FMuJoCoModel* Model = new FMuJoCoModel(Models::CartPole());
auto World = MakeUnique<FRLPhysicsWorld>();
World->Initialize(Model, Config);

// 2. 리셋
FBatchObservation Obs;
World->Reset(Obs);
// Obs.Data: [64 × ObsDim] 초기 관측

// 3. 스텝 루프
FBatchAction Actions;
Actions.Allocate(64, ActionDim);
FBatchStepResult Results;

for (int episode = 0; episode < 1000; ++episode)
{
    // 정책에서 행동 샘플링 (외부)
    SampleActions(Obs, Actions);

    // 환경 스텝
    World->Step(Actions, Obs, Results);

    // 학습 (외부)
    UpdatePolicy(Obs, Actions, Results);
}
```

### FVectorizedEnv 래퍼

```cpp
// stable-baselines3 스타일 인터페이스
class FVectorizedEnv
{
public:
    void Reset(TArray<FReal>& OutObs);

    void Step(
        const TArray<FReal>& Actions,  // [NumEnvs × ActionDim]
        TArray<FReal>& OutObs,         // [NumEnvs × ObsDim]
        TArray<FReal>& OutRewards,     // [NumEnvs]
        TArray<uint8>& OutDones,       // [NumEnvs]
        TArray<uint8>& OutTruncated    // [NumEnvs]
    );

    uint32 GetNumEnvs() const;
    uint32 GetObsDim() const;
    uint32 GetActionDim() const;
};
```

---

## 🛠️ Custom Functions

### 커스텀 보상 함수

```cpp
// 보상 함수 시그니처
using FRewardFunction = TFunction<FReal(
    const FMuJoCoModel& Model,
    const FMuJoCoState& State,
    const TArray<FReal>& Action
)>;

// Cart-Pole 보상 예시
World->SetRewardFunction([](const FMuJoCoModel& M, const FMuJoCoState& S,
    const TArray<FReal>& A) -> FReal
{
    // 폴이 수직에 가까울수록 +1
    FReal Theta = S.Qpos[1];  // 폴 각도
    FReal CosTheta = FMath::Cos(Theta);

    // 살아있는 보상 + 각도 보너스
    return 1.0 + CosTheta;
});

// Pendulum Swing-Up 보상 예시
World->SetRewardFunction([](const FMuJoCoModel& M, const FMuJoCoState& S,
    const TArray<FReal>& A) -> FReal
{
    FReal Theta = S.Qpos[0];
    FReal ThetaDot = S.Qvel[0];
    FReal Torque = A[0];

    // 목표: 위로 올리기 (cos(theta) = 1)
    // 페널티: 각속도, 토크 사용
    return FMath::Cos(Theta)
           - 0.1 * ThetaDot * ThetaDot
           - 0.001 * Torque * Torque;
});
```

### 커스텀 종료 함수

```cpp
// 종료 함수 시그니처
using FTerminationFunction = TFunction<bool(
    const FMuJoCoModel& Model,
    const FMuJoCoState& State
)>;

// Cart-Pole 종료 조건
World->SetTerminationFunction([](const FMuJoCoModel& M, const FMuJoCoState& S) -> bool
{
    // 폴이 ±12도 이상 기울면 종료
    FReal Theta = S.Qpos[1];
    if (FMath::Abs(Theta) > FMath::DegreesToRadians(12.0))
        return true;

    // 카트가 경계 밖으로 나가면 종료
    FReal X = S.Qpos[0];
    if (FMath::Abs(X) > 240.0)  // ±2.4m
        return true;

    return false;
});
```

---

## 📦 Predefined Environments

### Environments 네임스페이스

```cpp
namespace Environments
{
    // Pendulum Swing-Up
    TUniquePtr<FRLPhysicsWorld> CreatePendulum(
        uint32 NumWorlds = 1,
        FReal Length = 100.0,
        FReal Mass = 1.0
    );

    // Double Pendulum (Acrobot)
    TUniquePtr<FRLPhysicsWorld> CreateDoublePendulum(
        uint32 NumWorlds = 1
    );

    // Cart-Pole Balance
    TUniquePtr<FRLPhysicsWorld> CreateCartPole(
        uint32 NumWorlds = 1,
        FReal CartMass = 1.0,
        FReal PoleMass = 0.1,
        FReal PoleLength = 100.0
    );
}
```

### 환경별 관측/행동 공간

| 환경 | 관측 차원 | 행동 차원 | 설명 |
|------|----------|----------|------|
| Pendulum | 2 (θ, θ̇) | 1 (τ) | 토크 제어 |
| DoublePendulum | 4 (θ₁, θ₂, θ̇₁, θ̇₂) | 2 (τ₁, τ₂) | 두 조인트 토크 |
| CartPole | 4 (x, θ, ẋ, θ̇) | 1 (F) | 카트 힘 |

---

## 💡 Tips & Best Practices

### 성능 최적화

**✅ 권장:**
```cpp
// 충분한 병렬 환경 수 사용 (CPU 코어 × 2~4)
Config.NumWorlds = FPlatformMisc::NumberOfCores() * 4;

// 프레임 스킵으로 제어 주파수 조절
Config.FrameSkip = 4;  // 500Hz 물리, 125Hz 제어
```

**❌ 피해야 할 것:**
```cpp
// 매 스텝마다 메모리 할당
FBatchObservation Obs;
for (int step = 0; step < 10000; ++step)
{
    Obs.Allocate(NumWorlds, ObsDim);  // 매번 할당 (느림)
    World->Step(Actions, Obs, Results);
}

// 올바른 방법: 미리 할당
FBatchObservation Obs;
Obs.Allocate(NumWorlds, ObsDim);  // 한 번만
for (int step = 0; step < 10000; ++step)
{
    World->Step(Actions, Obs, Results);  // 재사용
}
```

### 디버깅

```cpp
// 단일 월드로 디버깅
Config.NumWorlds = 1;
Config.bParallelWorlds = false;  // 순차 실행

// 상태 직접 확인
const FMuJoCoState* State = World->GetWorldState(0);
UE_LOG(LogTemp, Log, TEXT("Qpos[0] = %f, Qvel[0] = %f"),
    State->Qpos[0], State->Qvel[0]);

// 에너지 모니터링
FReal TotalEnergy = 0;
for (uint32 i = 0; i < Model->Nbody; ++i)
{
    // 운동 에너지 + 위치 에너지
}
```

### 학습 팁

| 팁 | 설명 |
|----|------|
| **보상 스케일링** | 보상을 [-1, 1] 범위로 정규화 |
| **행동 정규화** | 항상 `bNormalizeActions = true` 사용 |
| **에피소드 길이** | 초기에는 짧게 (200), 점진적으로 증가 |
| **초기 상태** | `bRandomizeInitialState`로 다양성 확보 |

---

## 🔗 References

| 참조 | 설명 |
|------|------|
| Gymnasium | gymnasium.farama.org - 표준 RL 인터페이스 |
| stable-baselines3 | VecEnv 구현 참조 |
| MuJoCo Environments | Humanoid, Ant 등 표준 환경 |
| `RLPhysicsWorld.cpp:1-600` | 구현 소스 코드 |
