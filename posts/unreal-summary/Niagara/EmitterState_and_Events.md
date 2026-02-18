---
title: "EmitterState & Events - Niagara Emitter 상태 및 이벤트"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# EmitterState & Events - Niagara Emitter 상태 및 이벤트

## 🧭 개요 (Overview)

**Niagara EmitterState & Events 시스템**은 **Emitter의 생명주기를 관리**하고, **Emitter 간 통신**을 가능하게 하는 핵심 시스템입니다.

이 시스템은 **ENiagaraExecutionState (실행 상태)**, **Loop Behavior (반복 동작)**, **Inactive Response (비활성 반응)**, **Distance/Visibility Culling (Emitter 단위)** 등을 통해 **정밀한 Emitter 제어**를 제공합니다.

**핵심 사용 사례:**
- **Execution State**: Active, Inactive, Complete, Disabled 상태 관리
- **Loop Behavior**: Infinite, Multiple, Once 반복 모드
- **Inactive Response**: Complete (파티클 수명까지 유지) vs Kill (즉시 제거)
- **Emitter Culling**: Distance/Visibility 기반 Sleep/Awaken
- **Event System**: Emitter 간 데이터 전달 (Collision, Death 등)

**📂 주요 위치:**
- Emitter State: `Engine/Plugins/FX/Niagara/Source/Niagara/Internal/NiagaraSystemEmitterState.h`
- Emitter Instance: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEmitterInstance.h`

---

## 🎯 설계 철학

### 문제: Emitter 생명주기 관리의 복잡성

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Emitter 생명주기 관리의 문제점                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: System vs Emitter 생명주기 독립성                            │
│  - System이 Inactive → 모든 Emitter도 Inactive?                         │
│  - Emitter별로 다른 Loop 횟수 필요 (연기 10초, 불꽃 1초)                │
│                                                                         │
│  ❌ 문제 2: 파티클 정리 방식                                             │
│  - Emitter Inactive 시 기존 파티클 처리?                                 │
│  - 즉시 제거 (Kill) vs 수명까지 유지 (Complete)?                        │
│                                                                         │
│  ❌ 문제 3: Emitter 단위 Culling                                         │
│  - System 단위 Culling만으로는 부족                                     │
│  - 일부 Emitter만 거리 기반 비활성화 필요                                │
│                                                                         │
│  ❌ 문제 4: Emitter 간 통신                                              │
│  - "충돌 파티클이 지면 닿으면 먼지 파티클 생성" 어떻게?                  │
│  - Emitter 간 데이터 전달 방법 부재                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   Niagara EmitterState & Events 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ✅ 해결 1: FNiagaraEmitterStateData                                     │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Emitter별 독립적인 설정:                           │              │
│  │    LoopBehavior: Infinite, Multiple, Once           │              │
│  │    LoopDuration: 5.0s                               │              │
│  │    LoopCount: 3 (Multiple일 때)                     │              │
│  │    LoopDelay: 1.0s (반복 사이 대기)                 │              │
│  │                                                     │              │
│  │  System과 독립적으로 동작!                          │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 2: ENiagaraEmitterInactiveResponse                             │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Complete: 파티클 수명까지 유지 후 Emitter 종료     │              │
│  │    - 연기, 잔여 불꽃 등                             │              │
│  │                                                     │              │
│  │  Kill: Emitter & 파티클 즉시 제거                   │              │
│  │    - 스파크, 섬광 등                                │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 3: Emitter 단위 Culling                                        │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  bEnableDistanceCulling: true                        │              │
│  │  MinDistance: 500.0 (가까우면 Awaken)               │              │
│  │  MaxDistance: 5000.0 (멀면 Sleep)                   │              │
│  │                                                     │              │
│  │  Reaction:                                          │              │
│  │    - Awaken: 활성화                                 │              │
│  │    - SleepAndLetParticlesFinish: 새 파티클 중지     │              │
│  │    - KillAndClear: 즉시 제거                        │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 4: Event System (Data Interface)                               │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  CollisionEmitter:                                   │              │
│  │    OnCollision → Generate Event:                     │              │
│  │      { Position, Normal, Velocity }                  │              │
│  │                                                     │              │
│  │  DustEmitter:                                        │              │
│  │    Receive Event → Spawn Particles at Position      │              │
│  │                                                     │              │
│  │  Emitter 간 이벤트 기반 통신!                        │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 핵심 구조 상세

### 1. ENiagaraExecutionState - 실행 상태

```
enum class ENiagaraExecutionState : uint8
{
    Active,           // 실행 중 (파티클 생성 + 시뮬레이션)
    Inactive,         // 비활성 (파티클 생성 중지, 기존 파티클 시뮬레이션)
    InactiveClear,    // 비활성 + 파티클 즉시 제거
    Complete,         // 완료 (생명주기 종료)
    Disabled,         // 비활성화 (Scalability 등)
    Num
};
```

**상태 전이:**

```
[Spawn] → Active
            │
            ├─► Inactive (새 파티클 생성 중지)
            │     └─► Complete (모든 파티클 사망 후)
            │
            ├─► InactiveClear (즉시 모든 파티클 제거)
            │     └─► Complete
            │
            └─► Disabled (Scalability Culling)
                  └─► Active (Awaken)
```

---

### 2. FNiagaraEmitterStateData - Emitter 상태 설정

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Internal/NiagaraSystemEmitterState.h:88-161`

```
struct FNiagaraEmitterStateData
{
    // Loop 설정
    ENiagaraLoopBehavior LoopBehavior;
      - Infinite: 무한 반복
      - Multiple: LoopCount만큼 반복
      - Once: 1회 실행

    int32 LoopCount;                      // Multiple일 때 반복 횟수
    ENiagaraLoopDurationMode LoopDurationMode;
      - Fixed: 고정 Duration
      - Infinite: 무한 (Once 모드일 때만)

    FNiagaraDistributionRangeFloat LoopDuration;  // Loop 지속 시간 (초)
    FNiagaraDistributionRangeFloat LoopDelay;     // Loop 사이 대기 시간

    bool bLoopDelayEnabled;               // LoopDelay 활성화
    bool bRecalculateDurationEachLoop;    // 매 Loop마다 Duration 재계산
    bool bDelayFirstLoopOnly;             // 첫 Loop만 Delay
    bool bRecalculateDelayEachLoop;       // 매 Loop마다 Delay 재계산

    // Inactive Response
    ENiagaraEmitterInactiveResponse InactiveResponse;
      - Complete: 파티클 수명까지 유지 후 종료
      - Kill: 즉시 Emitter & 파티클 제거

    // Emitter 단위 Culling
    bool bEnableDistanceCulling;          // 거리 기반 Culling
    bool bMinDistanceEnabled;             // 최소 거리 활성화
    bool bMaxDistanceEnabled;             // 최대 거리 활성화
    float MinDistance;                    // 최소 거리 (이하면 Awaken)
    float MaxDistance;                    // 최대 거리 (이상이면 Sleep)

    ENiagaraExecutionStateManagement MinDistanceReaction;
      - Awaken: 활성화
    ENiagaraExecutionStateManagement MaxDistanceReaction;
      - SleepAndLetParticlesFinish: 새 파티클 중지, 기존 유지
      - KillAndClear: 즉시 제거

    bool bEnableVisibilityCulling;        // 가시성 기반 Culling
    ENiagaraExecutionStateManagement VisibilityCullReaction;
    float VisibilityCullDelay;            // Culling까지 대기 시간

    bool bResetAgeOnAwaken;               // Awaken 시 Age 리셋
};
```

---

## 🎯 실전 사용 예시

### 예시 1: Loop Behavior 설정

**시나리오 1: 무한 Loop (연기)**

```
Emitter: NS_Smoke
  LoopBehavior: Infinite
  LoopDuration: 5.0s
  InactiveResponse: Complete

동작:
  0s ~ 5s: Active (파티클 생성)
  5s: Inactive → 기존 파티클은 수명까지
  5s: 다시 Active (새 Loop 시작)
  → 무한 반복
```

**시나리오 2: 3회 반복 (불꽃)**

```
Emitter: NS_Firework
  LoopBehavior: Multiple
  LoopCount: 3
  LoopDuration: 2.0s
  LoopDelay: 1.0s
  InactiveResponse: Complete

동작:
  0s ~ 2s: Loop 1 (Active)
  2s ~ 3s: Delay
  3s ~ 5s: Loop 2 (Active)
  5s ~ 6s: Delay
  6s ~ 8s: Loop 3 (Active)
  8s: Complete (종료)
```

**시나리오 3: 1회 실행 (폭발)**

```
Emitter: NS_Explosion
  LoopBehavior: Once
  LoopDurationMode: Fixed
  LoopDuration: 3.0s
  InactiveResponse: Complete

동작:
  0s ~ 3s: Active
  3s: Inactive
  3s ~ 5s: 기존 파티클 수명까지 유지
  5s: Complete
```

---

### 예시 2: Inactive Response 비교

**Complete (부드러운 종료):**

```
Emitter: NS_Fire
  InactiveResponse: Complete

Timeline:
  0s: Active (파티클 생성 시작)
  5s: SetInactive() 호출
    → 새 파티클 생성 중지
    → 기존 파티클은 LifeTime까지 시뮬레이션
  7s: 마지막 파티클 사망
    → ExecutionState = Complete
```

**Kill (즉시 종료):**

```
Emitter: NS_Spark
  InactiveResponse: Kill

Timeline:
  0s: Active
  5s: SetInactive() 호출
    → 모든 파티클 즉시 제거
    → ExecutionState = Complete
```

---

### 예시 3: Emitter 단위 Distance Culling

**시나리오:** 먼 거리에서는 Emitter 비활성화

```
Emitter: NS_SmallDetails
  bEnableDistanceCulling: true
  bMaxDistanceEnabled: true
  MaxDistance: 3000.0  // 30m
  MaxDistanceReaction: SleepAndLetParticlesFinish

동작:
  Player 거리 < 30m:
    ExecutionState = Active
    → 파티클 생성 + 시뮬레이션

  Player 거리 > 30m:
    ExecutionState = Inactive
    → 새 파티클 생성 중지
    → 기존 파티클은 수명까지 유지
    → 모든 파티클 사망 후 Sleep

  Player 거리 < 30m (다시):
    ExecutionState = Active
    → 파티클 생성 재개
```

---

### 예시 4: Min/Max Distance 조합

**시나리오:** 가까이선 비활성, 중간 거리에서만 활성

```
Emitter: NS_DistantFog
  bMinDistanceEnabled: true
  MinDistance: 1000.0  // 10m
  MinDistanceReaction: SleepAndLetParticlesFinish

  bMaxDistanceEnabled: true
  MaxDistance: 5000.0  // 50m
  MaxDistanceReaction: SleepAndLetParticlesFinish

동작:
  거리 < 10m: Inactive (너무 가까움)
  거리 10m ~ 50m: Active (적절한 거리)
  거리 > 50m: Inactive (너무 멀음)
```

---

### 예시 5: Visibility Culling

**시나리오:** 화면 밖이면 Culling

```
Emitter: NS_ExpensiveEffect
  bEnableVisibilityCulling: true
  VisibilityCullReaction: SleepAndLetParticlesFinish
  VisibilityCullDelay: 2.0s

동작:
  화면 안:
    ExecutionState = Active

  화면 밖:
    2초 대기 (VisibilityCullDelay)
    → ExecutionState = Inactive
    → 새 파티클 생성 중지

  화면 안 (다시):
    즉시 ExecutionState = Active
```

---

### 예시 6: bResetAgeOnAwaken

**시나리오:** Awaken 시 Age 리셋 여부

```
Emitter: NS_AnimatedEffect
  bResetAgeOnAwaken: true

동작:
  거리 > MaxDistance:
    Sleep (Age = 5.0s)

  거리 < MaxDistance (Awaken):
    bResetAgeOnAwaken = true
    → Age = 0.0 (처음부터 다시 시작)

vs

  bResetAgeOnAwaken = false
    → Age = 5.0 (이어서 계속)
```

---

## 🐛 디버깅 팁

### 일반적인 함정

#### ❌ 하지 말아야 할 것:

```
// 1. InactiveResponse=Kill + LoopBehavior=Infinite
Emitter:
  LoopBehavior: Infinite
  InactiveResponse: Kill
// Loop 종료 시 모든 파티클 즉시 제거
// → 부자연스러운 끊김

// 2. MaxDistance가 너무 가까움
Emitter:
  MaxDistance: 500.0  // 5m
// Player 근처에서도 자주 Cull됨

// 3. VisibilityCullDelay가 너무 짧음
Emitter:
  VisibilityCullDelay: 0.1s
// 카메라 빠르게 돌리면 깜빡임
```

#### ✅ 올바른 방법:

```
// 1. 부드러운 Loop
Emitter:
  LoopBehavior: Infinite
  InactiveResponse: Complete  // 파티클 수명까지 유지

// 2. 적절한 MaxDistance
Emitter:
  MaxDistance: 3000.0 ~ 5000.0  // 30~50m

// 3. 적절한 VisibilityCullDelay
Emitter:
  VisibilityCullDelay: 1.0 ~ 2.0s  // 1~2초 여유
```

---

### 디버깅 시나리오

| 증상 | 원인 | 해결 방법 |
|------|------|----------|
| **Loop가 끊김** | InactiveResponse=Kill | Complete로 변경 |
| **Emitter가 자주 사라짐** | MaxDistance 너무 작음 | MaxDistance 증가 |
| **Awaken 시 처음부터** | bResetAgeOnAwaken=true | false로 변경 (이어서 재생) |
| **Visibility Culling 깜빡임** | VisibilityCullDelay 짧음 | 1~2초로 증가 |
| **Loop Delay 안 먹힘** | bLoopDelayEnabled=false | true로 변경 |

---

## 📖 참고 자료

### 소스 파일 참조

- **Emitter State:** `Engine/Plugins/FX/Niagara/Source/Niagara/Internal/NiagaraSystemEmitterState.h:88-161`
- **Emitter Instance:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEmitterInstance.h:24-150`

### 핵심 개념

- **ENiagaraExecutionState:** Active, Inactive, Complete, Disabled
- **Loop Behavior:** Infinite, Multiple, Once
- **Inactive Response:** Complete (부드러운 종료) vs Kill (즉시 제거)
- **Emitter Culling:** Distance, Visibility 기반 Sleep/Awaken
- **ExecutionStateManagement:** Awaken, Sleep, KillAndClear
