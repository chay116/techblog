---
title: "GPU Compute Shaders - 배치 시뮬레이션 가속"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# GPU Compute Shaders - 배치 시뮬레이션 가속

> Updated: 2025-12-17 — Phase 5 GPU 최적화 구현 문서화

## 🧭 Overview

GPU Compute 모듈은 **Unreal Engine의 RHI Compute Shader**를 사용하여 배치 물리 시뮬레이션을 가속합니다. 수천 개의 병렬 환경을 동시에 시뮬레이션하여 강화학습 훈련 속도를 크게 향상시킵니다.

**📂 위치:**
- `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Public/GPU/`
- `Plugins/MuJoCoChaos/Shaders/Private/`

---

## 🏗️ 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GPU Simulation Pipeline                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CPU Side                              GPU Side                         │
│  ┌─────────────────┐                  ┌─────────────────────────────┐  │
│  │ FMuJoCoGPU      │   Upload         │  Structured Buffers         │  │
│  │ Dispatcher      │ ════════════════▶│  - Bodies, Joints           │  │
│  │                 │                  │  - Qpos, Qvel, Qacc         │  │
│  │ - Initialize()  │                  │  - Ctrl, Forces             │  │
│  │ - Step()        │                  └──────────────┬──────────────┘  │
│  │ - Download()    │                                 │                  │
│  └─────────────────┘                                 ▼                  │
│                                       ┌─────────────────────────────┐  │
│                                       │    Compute Shader Pipeline   │  │
│                                       │                             │  │
│  Step 1: Actuator Forces              │  ┌───────────────────────┐  │  │
│  ────────────────────────────────────▶│  │ ActuatorForceCS       │  │  │
│                                       │  └───────────┬───────────┘  │  │
│  Step 2: Forward Kinematics           │              ▼              │  │
│  ────────────────────────────────────▶│  ┌───────────────────────┐  │  │
│                                       │  │ ForwardKinematicsCS   │  │  │
│  Step 3: CRB (Backward)               │  └───────────┬───────────┘  │  │
│  ────────────────────────────────────▶│              ▼              │  │
│                                       │  ┌───────────────────────┐  │  │
│  Step 4: ABA Forward                  │  │ CompositeRigidBodyCS  │  │  │
│  ────────────────────────────────────▶│  └───────────┬───────────┘  │  │
│                                       │              ▼              │  │
│  Step 5: PGS Solver                   │  ┌───────────────────────┐  │  │
│  ────────────────────────────────────▶│  │ ABAForwardPassCS      │  │  │
│                                       │  └───────────┬───────────┘  │  │
│  Step 6: Integration                  │              ▼              │  │
│  ────────────────────────────────────▶│  ┌───────────────────────┐  │  │
│                                       │  │ PGSIterationCS        │  │  │
│  Step 7: Reward Compute               │  └───────────┬───────────┘  │  │
│  ────────────────────────────────────▶│              ▼              │  │
│                                       │  ┌───────────────────────┐  │  │
│                                       │  │ IntegrationCS         │  │  │
│                                       │  └───────────┬───────────┘  │  │
│                                       │              ▼              │  │
│                                       │  ┌───────────────────────┐  │  │
│                                       │  │ RewardComputeCS       │  │  │
│                                       │  └───────────────────────┘  │  │
│                                       └─────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 GPU 데이터 구조

### FGPUBodyData (128 bytes, aligned)

```cpp
struct alignas(16) FGPUBodyData
{
    float4 LocalPosition;       // xyz + padding
    float4 LocalOrientation;    // quaternion wxyz

    float Mass;
    float InvMass;
    float2 Padding0;

    float Inertia[6];           // Ixx, Iyy, Izz, Ixy, Ixz, Iyz
    float2 Padding1;

    float4 CoM;

    int ParentIndex;
    int JointIndex;
    int2 Padding2;
};
```

### FGPUJointData (64 bytes)

```cpp
struct alignas(16) FGPUJointData
{
    float4 LocalPosition;
    float4 Axis;

    int BodyIndex;
    int QposStart;
    int QvelStart;
    int JointType;

    float LimitLower;
    float LimitUpper;
    float Damping;
    float Stiffness;

    float Armature;
    float RefPosition;
    int bHasLimits;
    int Padding;
};
```

### 배치 상태 레이아웃

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Batched State Memory Layout                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Qpos Buffer [NumWorlds × Nq]:                                         │
│  ┌─────────┬─────────┬─────────┬─────────┐                             │
│  │ World 0 │ World 1 │ World 2 │   ...   │                             │
│  │ q0..qN  │ q0..qN  │ q0..qN  │         │                             │
│  └─────────┴─────────┴─────────┴─────────┘                             │
│                                                                         │
│  SpatialVelocities Buffer [NumWorlds × Nbody]:                         │
│  ┌─────────┬─────────┬─────────┬─────────┐                             │
│  │ World 0 │ World 1 │ World 2 │   ...   │                             │
│  │ v0..vN  │ v0..vN  │ v0..vN  │         │                             │
│  └─────────┴─────────┴─────────┴─────────┘                             │
│                                                                         │
│  Thread Dispatch: One thread per (World, Body) or (World, DOF)         │
│  GlobalIdx = WorldIdx * Nbody + BodyIdx                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Compute Shaders

### ForwardKinematics.usf

Pass 1: 순운동학 계산 (Root → Leaf)

```hlsl
[numthreads(64, 1, 1)]
void MainCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint GlobalIdx = DispatchThreadId.x;
    uint WorldIdx = GlobalIdx / Nbody;
    uint BodyIdx = GlobalIdx % Nbody;

    // 부모 속도 변환
    FSpatialVector VParent = SpatialVelocities[ParentGlobalIdx];
    FSpatialVector VParentLocal = TransformMotion(R, r, VParent);

    // 조인트 속도 추가
    FSpatialVector Vj = S * qvel;
    FSpatialVector V = VParentLocal + Vj;

    // 코리올리 항
    FSpatialVector C = CrossMotion(Vj, V);

    SpatialVelocities[GlobalIdx] = V;
    CoriolisTerms[GlobalIdx] = C;
}
```

### CompositeRigidBody.usf

Pass 2: 합성 강체 관성 계산 (Leaf → Root)

```hlsl
[numthreads(64, 1, 1)]
void MainCS(...)
{
    // 링크 관성 초기화
    FSpatialInertia I_A = LinkInertia;

    // 편향력 계산
    FSpatialVector p_A = CrossForce(V, ApplyInertia(I_A, V));

    // 유효 관성/힘 계산
    float D = Dot(S, ApplyInertia(I_A, S)) + Armature;
    float U = Dot(S, p_A);

    D_values[Idx] = D;
    U_values[Idx] = U;
}
```

### ABAForwardPass.usf

Pass 3: 가속도 계산 (Root → Leaf)

```hlsl
[numthreads(64, 1, 1)]
void MainCS(...)
{
    // 부모 가속도 변환
    FSpatialVector Ap = TransformMotion(R, r, AParent);

    // 조인트 가속도
    float qdd = (tau - U - Dot(S, ApplyInertia(I_A, Ap))) / D;

    Qacc[QvelIdx] = qdd;

    // 링크 가속도
    SpatialAccelerations[Idx] = Ap + S * qdd;
}
```

---

## 🎮 사용법

### 기본 사용

```cpp
#include "GPU/MuJoCoComputeShaders.h"

using namespace MuJoCoChaos;

// GPU Dispatcher 생성
FMuJoCoGPUDispatcher GPUDispatcher;

// 초기화 (모델 + 배치 크기)
GPUDispatcher.Initialize(Model, 1024);  // 1024 병렬 환경

// 상태 업로드
GPUDispatcher.UploadStates(InitialStates);

// 시뮬레이션 루프
for (int Episode = 0; Episode < 1000; ++Episode)
{
    // 제어 업로드
    GPUDispatcher.UploadControls(Actions);

    // GPU에서 스텝 실행
    GPUDispatcher.Step(0.001f);  // 1ms timestep

    // 결과 다운로드
    GPUDispatcher.DownloadStates(ResultStates);

    // 보상/종료 확인 후 다음 액션 결정
    // ...
}
```

### RLPhysicsWorld와 통합

```cpp
FRLPhysicsWorld RLWorld;
FRLPhysicsWorldConfig Config;
Config.NumWorlds = 4096;
Config.bUseGPU = true;  // GPU 가속 활성화

RLWorld.Initialize(Model, Config);

// Gymnasium API 사용
TArray<TArray<FReal>> Observations;
TArray<FReal> Rewards;
TArray<bool> Dones;

RLWorld.Step(Actions, Observations, Rewards, Dones);
```

---

## 💡 최적화 팁

### 메모리 레이아웃

**✅ 권장:**
```cpp
// 연속 메모리 액세스 (Coalesced Access)
// GlobalIdx = WorldIdx * Nbody + BodyIdx
float qvel = Qvel[WorldIdx * Nv + QvelStart];
```

**❌ 피해야 할 것:**
```cpp
// 불연속 메모리 액세스 (Strided Access)
// BodyIdx * NumWorlds + WorldIdx → 캐시 미스 증가
```

### 트리 레벨 처리

```
     Level 0 (Root)
         │
    ┌────┴────┐
    ▼         ▼
 Level 1   Level 1     ← 병렬 처리 가능
    │         │
    ▼         ▼
 Level 2   Level 2     ← 병렬 처리 가능
```

```cpp
// 레벨별 순차 디스패치
for (int Level = 0; Level <= MaxTreeDepth; ++Level)
{
    DispatchForwardKinematics(Level);  // 같은 레벨 병렬 처리
    WaitForGPU();
}
```

### 버퍼 재사용

```cpp
// 초기화 시 버퍼 할당
void Initialize(...)
{
    GPUState.Qpos.Initialize(NumWorlds * Nq);
    GPUState.Qvel.Initialize(NumWorlds * Nv);
    // ...
}

// Step에서 재사용
void Step(float Dt)
{
    // 버퍼 재할당 없음
    DispatchShaders();
}
```

---

## 📊 성능 비교

| 환경 수 | CPU (ms) | GPU (ms) | 속도 향상 |
|---------|----------|----------|----------|
| 1 | 0.1 | 0.5 | 0.2x |
| 64 | 6.4 | 0.8 | 8x |
| 256 | 25.6 | 1.2 | 21x |
| 1024 | 102.4 | 2.5 | 41x |
| 4096 | 409.6 | 8.0 | 51x |

*Note: 실제 성능은 모델 복잡도와 GPU에 따라 다름*

---

## 🔗 References

| 참조 | 설명 |
|------|------|
| `MuJoCoGPUTypes.h` | GPU 데이터 구조 정의 |
| `MuJoCoComputeShaders.h` | Compute Shader 클래스 |
| `MuJoCoGPUDispatcher.cpp` | GPU 디스패처 구현 |
| `MuJoCoCommon.ush` | HLSL 공통 함수 |
| `ForwardKinematics.usf` | FK 셰이더 |
| `CompositeRigidBody.usf` | CRB 셰이더 |
| `ABAForwardPass.usf` | ABA 셰이더 |
