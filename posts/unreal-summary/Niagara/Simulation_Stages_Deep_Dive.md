---
title: "Simulation Stages Deep Dive (시뮬레이션 스테이지 심화)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Simulation Stages Deep Dive (시뮬레이션 스테이지 심화)

## 🧭 개요

Simulation Stage는 Niagara에서 **파티클 또는 DataInterface를 반복적으로 처리**할 수 있는 강력한 기능입니다. 일반적인 Spawn/Update Script 외에 추가적인 시뮬레이션 단계를 정의하여, Grid 연산, Neighbor 검색, Multi-Pass 알고리즘 등을 구현할 수 있습니다.

**핵심 개념:**
- **Iteration Source**: Particles / DataInterface (Grid2D, Grid3D 등)
- **NumIterations**: Stage를 여러 번 반복 실행
- **Particle State Filtering**: 특정 조건을 만족하는 파티클만 처리
- **GPU Dispatch Customization**: Thread Group 크기 및 Dimension 제어

---

## 🧱 주요 구성 요소

### 1. **UNiagaraSimulationStageBase**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSimulationStageBase.h:18`

```cpp
UCLASS(abstract)
class UNiagaraSimulationStageBase
{
    UPROPERTY()
    UNiagaraScript* Script;  // Stage Script

    UPROPERTY(EditAnywhere)
    FName SimulationStageName;

    UPROPERTY()
    uint32 bEnabled : 1;
};
```

### 2. **FNiagaraSimStageData (Runtime)**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSimStageData.h:21`

```cpp
struct FNiagaraSimStageData
{
    uint16 bFirstStage : 1;
    uint16 bLastStage : 1;
    uint16 StageIndex;

    uint16 NumIterations;   // 총 반복 횟수
    uint16 IterationIndex;  // 현재 반복 번호

    FNiagaraSimStageDispatchArgs DispatchArgs;

    FNiagaraDataBuffer* Source;       // 입력 버퍼
    FNiagaraDataBuffer* Destination;  // 출력 버퍼

    FNiagaraDataInterfaceProxyRW* AlternateIterationSource;  // Grid 등
};
```

---

## 💡 주요 사용 사례

### 예시 1: Grid 기반 Fluid Simulation

```
Stage 1: Advect Velocity (Grid3D Iteration)
    - Grid의 각 Cell 순회
    - 이전 Velocity를 기반으로 새 Velocity 계산

Stage 2: Apply Forces (Grid3D Iteration)
    - Gravity, Buoyancy 등 적용

Stage 3: Pressure Solve (Grid3D Iteration, NumIterations = 10)
    - Jacobi Iteration으로 압력 해결
    - 10번 반복하여 수렴

Stage 4: Apply Pressure (Grid3D Iteration)
    - 압력 Gradient를 Velocity에 반영

Stage 5: Update Particles (Particle Iteration)
    - Grid에서 Velocity 샘플링
    - 파티클 위치 업데이트
```

### 예시 2: Particle State 기반 처리

```cpp
// Stage 1: Active Particles Only
IterationSource = Particles
bParticleIterationStateEnabled = true
ParticleIterationStateBinding = "Particles.State"
ParticleIterationStateRange = (1, 1)  // State == 1인 파티클만 처리

// Stage 2: Inactive Particles Activation
ParticleIterationStateRange = (0, 0)  // State == 0인 파티클만 처리
```

### 예시 3: Custom Dispatch Size

```cpp
// 2D Grid 전체 순회 (128x128)
IterationSource = DataInterface (Grid2D)
DirectDispatchType = TwoD
DirectDispatchElementType = NumThreads
OverrideGpuDispatchNumThreadsX = 8
OverrideGpuDispatchNumThreadsY = 8

// Dispatch: (128/8, 128/8, 1) = (16, 16, 1) Thread Groups
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. 과도한 Iteration:**
```cpp
// ❌ 너무 많은 반복 → GPU Timeout
NumIterations = 1000;  // GPU가 응답 없음!
```

**2. Source == Destination (잘못된 사용):**
```cpp
// ❌ 같은 버퍼를 읽고 쓰면 Race Condition
// bDisablePartialParticleUpdate를 활성화하지 않으면 안전하지 않음
```

### ✅ 올바른 방법

**1. 적절한 Iteration 횟수:**
```cpp
// ✅ 수렴에 필요한 최소 횟수만 사용
NumIterations = 5;  // 충분히 빠르고 정확함
```

**2. Double Buffering:**
```cpp
// ✅ Source/Destination 분리
// Niagara가 자동으로 처리 (BeginSimulate/EndSimulate)
```

---

## 🔗 참조 자료

**소스 파일:**
- `NiagaraSimulationStageBase.h/cpp`
- `NiagaraSimStageData.h`
- `NiagaraGpuComputeDispatch.cpp` (GPU Dispatch 로직)

**관련 문서:**
- [Script_Compilation.md](Script_Compilation.md) - Simulation Stage Script 컴파일
- [VM_Execution.md](VM_Execution.md) - CPU에서의 Stage 실행

---

> 🔄 작성: 2025-11-22 — Niagara Simulation Stage 시스템 개요
