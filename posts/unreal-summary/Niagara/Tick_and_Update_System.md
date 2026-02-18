---
title: "Tick and Update System (Tick 및 업데이트 시스템)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Tick and Update System (Tick 및 업데이트 시스템)

## 🧭 개요

Niagara의 Tick 시스템은 **Game Thread (GT)**와 **Concurrent Thread (병렬 실행 스레드)** 간의 정교한 협업을 통해 파티클 시스템을 갱신합니다. 이 시스템은 멀티스레딩을 최대한 활용하여 성능을 최적화하면서도, Thread-Safety를 유지하고 GPU Tick을 적절한 시점에 제출합니다.

**핵심 설계 원칙:**
- **3단계 파이프라인**: Tick_GameThread → Tick_Concurrent → FinalizeTick_GameThread
- **Task Graph 기반 병렬화**: FGraphEvent와 TaskGraph를 사용한 비동기 실행
- **Batch 처리**: 동일한 System의 여러 인스턴스를 한 번에 처리
- **GPU Tick 분리**: GPU 시뮬레이션과 CPU 시뮬레이션의 독립적인 실행

---

## 🧱 Tick 파이프라인 아키텍처

### 전체 흐름도

```
Game Thread                 Task Graph                 Render Thread
    │                           │                            │
    ├─ Tick_GameThread()        │                            │
    │  ├─ Tick Instance Params  │                            │
    │  ├─ DataInterface PreTick │                            │
    │  └─ Age/TickCount 증가    │                            │
    │                            │                            │
    ├─ Launch ConcurrentTask ──>│                            │
    │                            │                            │
    │                            ├─ Tick_Concurrent()        │
    │                            │  ├─ System Spawn/Update   │
    │                            │  ├─ Emitter Tick (병렬)   │
    │                            │  ├─ Bounds 계산           │
    │                            │  └─ GPU Tick 생성 (옵션)  │
    │                            │                            │
    │                            ├─ Launch FinalizeTask ───> │
    │                            │                            │
    ├─ Wait (if needed) <───────┤                            │
    │                            │                            │
    ├─ FinalizeTick_GameThread() │                            │
    │  ├─ DataInterface PostTick │                            │
    │  ├─ Handle Completion      │                            │
    │  └─ GPU Tick 제출 ──────────┼────────────────────────> │
    │                            │                            │
    └─ OnPostTick Callback       │                            │
                                 │                            ▼
                                 │                      GPU Simulation
```

### ENiagaraGPUTickHandlingMode

GPU Tick을 언제 제출할지 결정하는 모드:

```cpp
// NiagaraSystemSimulation.h:19
enum class ENiagaraGPUTickHandlingMode
{
    None,                  // GPU Tick 불필요
    GameThread,            // GameThread에서 개별 제출
    Concurrent,            // Concurrent Tick 중 개별 제출
    GameThreadBatched,     // GameThread에서 Batch 제출
    ConcurrentBatched,     // Concurrent Tick 중 Batch 제출
};
```

**결정 기준:**
- GPU Emitter가 있는가?
- Async 실행이 가능한가?
- Batch 처리가 가능한가?

---

## 🧩 계층별 상세 분석

### 1. **FNiagaraSystemInstance - 인스턴스별 Tick**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystemInstance.cpp:2562`

**역할:** 개별 System Instance의 Tick을 관리하고, 3단계 파이프라인을 조율

#### Tick_GameThread

```cpp
// NiagaraSystemInstance.cpp:2562
void FNiagaraSystemInstance::Tick_GameThread(float DeltaSeconds)
{
    // 1. 이전 비동기 작업 대기
    WaitForConcurrentTickAndFinalize(true);

    // 2. Component 유효성 검사
    if (GetAttachComponent() == nullptr)
    {
        Complete(true);
        return;
    }

    // 3. DeltaSeconds 캐싱
    CachedDeltaSeconds = DeltaSeconds;
    FixedBounds_CNC = FixedBounds_GT;

    // 4. Instance Parameter Tick
    TickInstanceParameters_GameThread(DeltaSeconds);

    // 5. DataInterface PreTick
    TickDataInterfaces(DeltaSeconds, false);

    // 6. Age/TickCount 증가
    Age += DeltaSeconds;
    TickCount += 1;
}
```

**핵심 책임:**
- **GameThread 전용 작업**: Component 접근, Parameter 갱신
- **DeltaTime 캐싱**: Concurrent 단계에서 사용할 데이터 준비
- **동기화 보장**: 이전 Tick이 완료될 때까지 대기

#### Tick_Concurrent

```cpp
// NiagaraSystemInstance.cpp:2626
void FNiagaraSystemInstance::Tick_Concurrent(bool bEnqueueGPUTickIfNeeded)
{
    // 1. GPU 파라미터 초기화
    TotalGPUParamSize = 0;
    ActiveGPUEmitterCount = 0;

    // 2. Emitter 순회 및 Tick
    for (const FNiagaraEmitterExecutionIndex& EmitterExecIdx : EmitterExecutionOrder)
    {
        if (EmittersShouldTick[EmitterExecIdx.EmitterIndex])
        {
            FNiagaraEmitterInstance& Emitter = Emitters[EmitterExecIdx.EmitterIndex].Get();
            Emitter.PreTick();
        }
    }

    // 3. Emitter Tick (병렬 실행 가능)
    for (const FNiagaraEmitterExecutionIndex& EmitterExecIdx : EmitterExecutionOrder)
    {
        FNiagaraEmitterInstance& Emitter = Emitters[EmitterExecIdx.EmitterIndex].Get();
        if (EmittersShouldTick[EmitterExecIdx.EmitterIndex])
        {
            Emitter.Tick(CachedDeltaSeconds);
        }

        // GPU Emitter 처리
        if (!Emitter.IsComplete() && Emitter.GetSimTarget() == ENiagaraSimTarget::GPUComputeSim)
        {
            if (FNiagaraComputeExecutionContext* GPUContext = StatefulEmitter->GetGPUContext())
            {
                TotalCombinedParamStoreSize += GPUContext->GetConstantBufferSize();
                ActiveGPUEmitterCount++;
            }
        }
    }

    // 4. Bounds 계산 (Dynamic/Fixed)
    if (System->bFixedBounds)
    {
        LocalBounds = System->GetFixedBounds();
    }
    else
    {
        FBox NewDynamicBounds(ForceInit);
        for (const auto& Emitter : Emitters)
        {
            NewDynamicBounds += Emitter->GetBounds();
        }
        LocalBounds = NewDynamicBounds;
    }

    // 5. GPU Tick 생성 (Concurrent 모드인 경우)
    ENiagaraGPUTickHandlingMode Mode = Sim->GetGPUTickHandlingMode();
    if (Mode == ENiagaraGPUTickHandlingMode::Concurrent)
    {
        GenerateAndSubmitGPUTick();
    }
}
```

**핵심 책임:**
- **Thread-Safe 작업**: GameThread 접근 없이 시뮬레이션 수행
- **Emitter 병렬 실행**: 독립적인 Emitter들을 동시에 처리
- **GPU 파라미터 수집**: GPU Tick에 필요한 데이터 준비

#### FinalizeTick_GameThread

```cpp
// NiagaraSystemInstance.cpp:2805
void FNiagaraSystemInstance::FinalizeTick_GameThread(bool bEnqueueGPUTickIfNeeded)
{
    // 1. Concurrent 작업 완료 확인
    check(ConcurrentTickGraphEvent == nullptr || ConcurrentTickGraphEvent->IsComplete());
    ConcurrentTickGraphEvent = nullptr;
    FinalizeRef.ConditionalClear();

    // 2. Completion 처리
    if (!HandleCompletion())
    {
        // 3. DataInterface PostTick
        TickDataInterfaces(CachedDeltaSeconds, true);

        // 4. GPU Tick 제출 (GameThread 모드인 경우)
        ENiagaraGPUTickHandlingMode Mode = Sim->GetGPUTickHandlingMode();
        if (Mode == ENiagaraGPUTickHandlingMode::GameThread)
        {
            GenerateAndSubmitGPUTick();
        }

        // 5. Callback 실행
        if (OnPostTickDelegate.IsBound())
        {
            OnPostTickDelegate.Execute();
        }
    }

    // 6. Deferred Reset 처리
    if (DeferredResetMode != EResetMode::None)
    {
        Reset(DeferredResetMode);
    }
}
```

**핵심 책임:**
- **GameThread 복귀**: Thread-Safe하지 않은 작업 수행
- **GPU Tick 제출**: RenderThread로 GPU 명령 전달
- **Callback 실행**: 외부 시스템에 Tick 완료 알림

---

### 2. **FNiagaraSystemSimulation - Batch 처리**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystemSimulation.cpp:1187`

**역할:** 동일한 UNiagaraSystem의 여러 Instance를 Batch로 처리하여 성능 최적화

#### Tick_GameThread_Internal

```cpp
// NiagaraSystemSimulation.cpp:1187
void FNiagaraSystemSimulation::Tick_GameThread_Internal(
    float DeltaSeconds,
    const FGraphEventRef& MyCompletionGraphEvent)
{
    // 1. Instance 상태 확인
    TArray<FNiagaraSystemInstance*>& SystemInstances = GetSystemInstances(ENiagaraSystemInstanceState::Running);
    TArray<FNiagaraSystemInstance*>& PendingSystemInstances = GetSystemInstances(ENiagaraSystemInstanceState::PendingSpawn);

    // 2. 각 Instance의 Tick_GameThread 호출
    int32 SystemIndex = 0;
    while (SystemIndex < SystemInstances.Num())
    {
        FNiagaraSystemInstance* Instance = SystemInstances[SystemIndex];

        // Tick Group 변경 처리
        if (bUpdateTickGroups)
        {
            ETickingGroup DesiredTickGroup = Instance->CalculateTickGroup();
            if (DesiredTickGroup != SystemTickGroup)
            {
                // Demotion: 다른 Simulation으로 이전
                if (DesiredTickGroup > SystemTickGroup)
                {
                    TSharedPtr<FNiagaraSystemSimulation> NewSim = WorldManager->GetSystemSimulation(DesiredTickGroup, System);
                    NewSim->TransferInstance(Instance);
                    continue;
                }
                // Promotion: 나중에 처리
                else
                {
                    AddTickGroupPromotion(Instance);
                }
            }
        }

        // Instance Tick
        Instance->Tick_GameThread(DeltaSeconds);

        ++SystemIndex;
    }

    // 3. System Level Parameter 설정
    SetupParameters_GameThread(DeltaSeconds);

    // 4. Pending Instance 처리
    while (PendingSystemInstances.Num() > 0)
    {
        FNiagaraSystemInstance* Instance = PendingSystemInstances[0];
        Instance->Tick_GameThread(DeltaSeconds);

        SetInstanceState(Instance, ENiagaraSystemInstanceState::Running);
        ++SpawnNum;
    }

    // 5. Concurrent Task 생성
    FNiagaraSystemSimulationTickContext Context(this, SystemInstances, MainDataSet, DeltaSeconds, SpawnNum, MyCompletionGraphEvent.IsValid());
    if (Context.IsRunningAsync())
    {
        auto ConcurrentTickTask = TGraphTask<FNiagaraSystemSimulationTickConcurrentTask>::CreateTask(nullptr, ENamedThreads::GameThread).ConstructAndHold(Context, AllWorkCompleteGraphEvent);

        ConcurrentTickGraphEvent = ConcurrentTickTask->GetCompletionEvent();

        // Instance에 GraphEvent 전달
        for (FNiagaraSystemInstance* Instance : Context.Instances)
        {
            Instance->ConcurrentTickGraphEvent = ConcurrentTickGraphEvent;
        }

        ConcurrentTickTask->Unlock();

        // Completion 설정
        MyCompletionGraphEvent->DontCompleteUntil(AllWorkCompleteGraphEvent);
    }
    else
    {
        // 동기 실행
        Tick_Concurrent(Context);
    }
}
```

**핵심 최적화:**
- **Batch 처리**: 같은 System의 Instance들을 한 번에 처리
- **TickGroup 동적 조정**: 런타임에 TickGroup 변경 지원
- **조건부 비동기**: 가능한 경우에만 Task Graph 사용

#### Tick_Concurrent (Batch)

```cpp
// NiagaraSystemSimulation.cpp:1848
void FNiagaraSystemSimulation::Tick_Concurrent(FNiagaraSystemSimulationTickContext& Context)
{
    // 1. System Level Script 실행 여부 확인
    if (bRunUpdateScript)
    {
        // System Script가 있는 경우: Spawn → Update 순서로 실행
        for (FNiagaraSystemInstance* SystemInstance : Context.Instances)
        {
            SystemInstance->TickInstanceParameters_Concurrent();
        }

        PrepareForSystemSimulate(Context);

        if (Context.SpawnNum > 0)
        {
            SpawnSystemInstances(Context);  // System Spawn Script 실행
        }

        UpdateSystemInstances(Context);  // System Update Script 실행

        // 결과를 각 Instance의 Parameter Store로 복사
        TransferSystemSimulationResults(Context);
    }
    else
    {
        // System Script 없는 경우: Instance별로 직접 처리
        for (int32 i = 0; i < NumInstances; ++i)
        {
            FNiagaraSystemInstance* SystemInstance = Context.Instances[i];

            SystemInstance->TickInstanceParameters_Concurrent();
            SystemInstance->TickSystemState();

            // Batch에 추가 (최대 4개씩)
            AddSystemToTickBatch(Context, SystemInstance, i == NumInstances - 1);
        }
    }

    // 2. Batch로 Instance Tick 실행
    TickInstancesBatch(Context);
}
```

**핵심 최적화:**
- **DataSet 기반 Batch**: FNiagaraDataSet을 사용한 SoA(Structure of Arrays) 처리
- **System Script 공유**: 모든 Instance가 동일한 System Script 공유
- **병렬 Emitter Tick**: 각 Instance의 Emitter들을 병렬로 실행

---

### 3. **Task Graph 통합**

**📂 위치:** `Engine/Plugins/FX\Niagara/Source/Niagara/Private/NiagaraSystemSimulation.cpp:1373`

**역할:** UE의 Task Graph 시스템을 활용한 비동기 실행

#### FGraphEvent 체인

```
GameThread Task              Concurrent Task             Finalize Task
     │                            │                            │
     ├─ CreateTask()              │                            │
     │                            │                            │
     ├─ ConcurrentTickGraphEvent ─┼──> Tick_Concurrent()       │
     │  (FGraphEvent)             │                            │
     │                            │                            │
     │                            ├─ Complete                  │
     │                            │                            │
     │                            └─ AllWorkCompleteGraphEvent ─┼──> FinalizeTick_GameThread()
     │                                                         │
     ├─ Wait() <─────────────────────────────────────────────┤
     │                                                         │
     └─ Continue                                              │
```

#### FNiagaraSystemInstanceFinalizeRef

```cpp
// NiagaraSystemInstance.h:636
FGraphEventRef ConcurrentTickGraphEvent;        // System Simulation Concurrent Tick
FGraphEventRef ConcurrentTickBatchGraphEvent;   // Instance Batch Tick

FNiagaraSystemInstanceFinalizeRef FinalizeRef;  // Finalize 대기 토큰
```

**Finalize 메커니즘:**
- `FinalizeRef.IsPending()`: Finalize가 필요한지 확인
- `FinalizeRef.ConditionalClear()`: Finalize 완료 표시
- `SetPendingFinalize()`: Finalize 예약

---

### 4. **WaitForConcurrentTickAndFinalize - 동기화**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystemInstance.cpp:2533`

**역할:** 비동기 작업이 완료될 때까지 대기하고 Finalize 실행

```cpp
// NiagaraSystemInstance.cpp:2533
void FNiagaraSystemInstance::WaitForConcurrentTickAndFinalize(bool bEnsureComplete)
{
    // 1. Concurrent Tick 대기
    WaitForConcurrentTickDoNotFinalize(bEnsureComplete);

    // 2. Finalize 실행
    if (FinalizeRef.IsPending())
    {
        FinalizeTick_GameThread();
    }
}
```

#### WaitForConcurrentTickDoNotFinalize

```cpp
// NiagaraSystemInstance.cpp:2477
void FNiagaraSystemInstance::WaitForConcurrentTickDoNotFinalize(bool bEnsureComplete)
{
    check(IsInGameThread());

    const uint64 StartCycles = FPlatformTime::Cycles64();
    bool bDidWait = false;

    // System Concurrent Tick 대기
    if (ConcurrentTickGraphEvent && !ConcurrentTickGraphEvent->IsComplete())
    {
        CSV_SCOPED_SET_WAIT_STAT(Effects);
        SCOPE_CYCLE_COUNTER(STAT_NiagaraSystemWaitForAsyncTick);

        bDidWait = true;

        // Timeout 설정 (GNiagaraSystemSimulationTaskStallTimeout)
        if (GNiagaraSystemSimulationTaskStallTimeout > 0)
        {
            if (WaitForAnyTaskCompleted({ ConcurrentTickGraphEvent }, FTimespan::FromMicroseconds(GNiagaraSystemSimulationTaskStallTimeout)) == INDEX_NONE)
            {
                DumpStalledInfo();  // Timeout 발생 시 디버그 정보 출력
            }
        }
        else
        {
            FTaskGraphInterface::Get().WaitUntilTaskCompletes(ConcurrentTickGraphEvent, ENamedThreads::GameThread_Local);
        }
    }

    // Instance Batch Tick 대기
    if (ConcurrentTickBatchGraphEvent && !ConcurrentTickBatchGraphEvent->IsComplete())
    {
        bDidWait = true;
        FTaskGraphInterface::Get().WaitUntilTaskCompletes(ConcurrentTickBatchGraphEvent, ENamedThreads::GameThread_Local);
    }

    // Stall 경고
    if (bDidWait)
    {
        ensureAlwaysMsgf(!bEnsureComplete, TEXT("Async Work not complete and is expected to be."));

        const double StallTimeMS = FPlatformTime::ToMilliseconds64(FPlatformTime::Cycles64() - StartCycles);
        if (StallTimeMS > GWaitForAsyncStallWarnThresholdMS)
        {
            UE_LOG(LogNiagara, Log, TEXT("Niagara Effect stalled GT for %g ms. System(%s)"), StallTimeMS, *GetFullNameSafe(GetSystem()));
        }
    }

    ConcurrentTickGraphEvent = nullptr;
    ConcurrentTickBatchGraphEvent = nullptr;
}
```

**핵심 기능:**
- **Timeout 보호**: 무한 대기 방지
- **Stall 감지**: 성능 문제 경고
- **디버깅 지원**: DumpStalledInfo로 상태 출력

---

### 5. **GPU Tick 생성 및 제출**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystemInstance.cpp:2864`

**역할:** GPU 시뮬레이션을 위한 명령을 RenderThread로 전달

#### GenerateAndSubmitGPUTick

```cpp
// NiagaraSystemInstance.cpp:2864
void FNiagaraSystemInstance::GenerateAndSubmitGPUTick()
{
    if (NeedsGPUTick())
    {
        ensure(!IsComplete());

        // 1. GPU Tick 데이터 생성
        FNiagaraGPUSystemTick GPUTick;
        InitGPUTick(GPUTick);

        // 2. RenderThread로 제출
        ENQUEUE_RENDER_COMMAND(FNiagaraGiveSystemInstanceTickToRT)(
            [RT_Proxy=SystemGpuComputeProxy.Get(), GPUTick](FRHICommandListImmediate& RHICmdList) mutable
            {
                RT_Proxy->QueueTick(GPUTick);
            }
        );
    }
}
```

#### InitGPUTick

```cpp
// NiagaraSystemInstance.cpp:2885
void FNiagaraSystemInstance::InitGPUTick(FNiagaraGPUSystemTick& OutTick)
{
    check(SystemGpuComputeProxy.IsValid());
    OutTick.Init(this);

    // GPU Tick에 필요한 데이터:
    // - Global/System/Owner/Emitter Parameters (FNiagaraGlobalParameters 등)
    // - GPU DataInterface Instance Data
    // - Particle DataSet 정보
    // - Simulation Stage 정보
}
```

**GPU Tick 제출 시점:**

| 모드                      | 제출 시점                      | Thread          |
|---------------------------|--------------------------------|-----------------|
| GameThread                | FinalizeTick_GameThread        | GameThread      |
| Concurrent                | Tick_Concurrent                | Worker Thread   |
| GameThreadBatched         | FinalizeTick_GameThread (Batch)| GameThread      |
| ConcurrentBatched         | Tick_Concurrent (Batch)        | Worker Thread   |

---

### 6. **FNiagaraTickInfo - Tick 메타데이터**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemSimulation.h:28`

**역할:** Fixed Tick 및 Multi-Tick을 위한 메타데이터 저장

```cpp
// NiagaraSystemSimulation.h:28
struct FNiagaraTickInfo
{
    bool UsesFixedTick = false;       // Fixed Delta Time 사용 여부
    float EngineTick = 0.0;           // 엔진 DeltaTime
    float SystemTick = 0.0;           // System DeltaTime (Fixed 가능)
    int32 TickCount = 0;              // 총 Tick 횟수
    int32 TickNumber = 0;             // 현재 Tick 번호
    float TimeStepFraction = 0.0;     // 현재 Tick의 시간 비율
};
```

**Fixed Tick 처리:**

```cpp
// NiagaraSystemSimulation.cpp:1100
if (System->HasFixedTickDelta())
{
    float FixedDelta = System->GetFixedTickDeltaTime();
    float Budget = FixedDelta > 0 ? FMath::Fmod(FixedDeltaTickAge, FixedDelta) + DeltaSeconds : 0;
    int32 Ticks = FixedDelta > 0 ? FMath::Min(FMath::FloorToInt(Budget / FixedDelta), GNiagaraSystemSimulationMaxTickSubsteps) : 0;

    TickInfo.UsesFixedTick = true;
    TickInfo.EngineTick = DeltaSeconds;
    TickInfo.SystemTick = FixedDelta;
    TickInfo.TickCount = Ticks;

    for (int i = 0; i < Ticks; i++)
    {
        TickInfo.TickNumber = i;
        TickInfo.TimeStepFraction = 1.0f * (i + 1) / Ticks;

        Tick_GameThread_Internal(FixedDelta, nullptr);
        Budget -= FixedDelta;
    }

    FixedDeltaTickAge += DeltaSeconds;
}
```

**핵심 개념:**
- **Budget**: 누적된 시간 예산
- **Substeps**: 프레임당 여러 번 Tick (최대 GNiagaraSystemSimulationMaxTickSubsteps)
- **TimeStepFraction**: Interpolation을 위한 시간 비율

---

## 💡 실전 예시

### 예시 1: Solo Instance 동기 Tick

```cpp
// Solo System은 Batch 없이 단독으로 Tick
UNiagaraComponent* NiagaraComp = CreateDefaultSubobject<UNiagaraComponent>(TEXT("NiagaraComp"));
NiagaraComp->SetForceSolo(true);

// Tick 실행 순서:
// 1. Tick_GameThread()       - GT
// 2. Tick_Concurrent()        - GT (동기 실행)
// 3. FinalizeTick_GameThread() - GT
```

**특징:**
- Task Graph 미사용
- 모든 작업이 GameThread에서 순차 실행
- Batch 처리 없음

---

### 예시 2: Batch System 비동기 Tick

```cpp
// 월드에 같은 System의 Instance 여러 개 존재
for (int32 i = 0; i < 100; ++i)
{
    UNiagaraComponent* Comp = World->SpawnActor<AActor>()->CreateComponentByClass(UNiagaraComponent::StaticClass());
    Comp->SetAsset(NiagaraSystem);  // 모두 같은 System
    Comp->Activate();
}

// FNiagaraSystemSimulation이 100개 Instance를 Batch로 처리:
// 1. Tick_GameThread()       - GT: 각 Instance의 GT 작업
// 2. Launch ConcurrentTask   - GT: Task Graph에 제출
// 3. Tick_Concurrent()        - Worker Thread: Batch 시뮬레이션
// 4. Launch FinalizeTask     - Worker Thread: Finalize 예약
// 5. FinalizeTick_GameThread() - GT: Finalize 실행 (대기 또는 비동기)
```

**최적화 포인트:**
- System Script를 한 번만 실행 (모든 Instance 공유)
- DataSet을 사용한 SoA 처리
- Emitter Tick 병렬화

---

### 예시 3: GPU Emitter와 CPU Emitter 혼합

```cpp
UNiagaraSystem* MixedSystem;  // CPU Emitter 2개 + GPU Emitter 1개

// Tick 흐름:
// 1. Tick_GameThread()       - GT
// 2. Tick_Concurrent()        - Worker Thread
//    ├─ CPU Emitter 0 Tick   - Worker Thread
//    ├─ CPU Emitter 1 Tick   - Worker Thread
//    └─ GPU Emitter 파라미터 수집
// 3. GPU Tick 제출 (Concurrent 모드)
//    └─ ENQUEUE_RENDER_COMMAND → RT
// 4. FinalizeTick_GameThread() - GT
```

**GPU Tick 타이밍:**
- `ENiagaraGPUTickHandlingMode::Concurrent`: Tick_Concurrent에서 제출
- `ENiagaraGPUTickHandlingMode::GameThread`: FinalizeTick_GameThread에서 제출

---

### 예시 4: Fixed Delta Time System

```cpp
UNiagaraSystem* FixedDeltaSystem;
FixedDeltaSystem->SetFixedTickDeltaTime(0.0166f);  // 60 FPS

// 엔진 DeltaTime = 0.05 (20 FPS)일 때:
// - Budget = 0.05
// - Ticks = floor(0.05 / 0.0166) = 3
// - 3번 Tick 실행 (각 0.0166초)

for (int i = 0; i < 3; i++)
{
    Tick_GameThread_Internal(0.0166f, nullptr);
}

// 남은 시간: 0.05 - (3 * 0.0166) = 0.0002
// 다음 프레임에 누적
```

**사용 사례:**
- Physics Simulation과 동기화
- 일정한 시뮬레이션 정확도 보장
- Deterministic Replay

---

### 예시 5: TickGroup 동적 변경

```cpp
// Instance가 Camera와 가까워져서 TickGroup 변경
FNiagaraSystemInstance* Instance = GetSystemInstance();

// CalculateTickGroup()에서 DataInterface의 Prerequisite 확인
ETickingGroup DesiredTickGroup = Instance->CalculateTickGroup();

if (DesiredTickGroup != CurrentTickGroup)
{
    if (DesiredTickGroup > CurrentTickGroup)
    {
        // Demotion: 즉시 이전
        TSharedPtr<FNiagaraSystemSimulation> NewSim = WorldManager->GetSystemSimulation(DesiredTickGroup, System);
        NewSim->TransferInstance(Instance);
    }
    else
    {
        // Promotion: 다음 PostActorTick에서 이전
        AddTickGroupPromotion(Instance);
    }
}
```

**TickGroup 결정 기준:**
- DataInterface의 Tick Prerequisites
- `ENiagaraTickBehavior` 설정
- Component의 TickGroup

---

### 예시 6: 명시적 Wait와 Finalize

```cpp
// Component를 즉시 Deactivate해야 하는 경우
void UNiagaraComponent::DeactivateImmediate()
{
    if (SystemInstanceController)
    {
        // 비동기 작업이 완료될 때까지 대기
        SystemInstanceController->WaitForConcurrentTickAndFinalize();

        // 안전하게 Deactivate
        SystemInstanceController->Deactivate(true);
    }
}
```

**Wait가 필요한 경우:**
- Component 파괴
- System Reset
- DataInterface 변경
- World Teardown

---

## ⚠️ 일반적인 함정

### ❌ 하지 말아야 할 것

**1. Concurrent Tick 중 GameThread 데이터 접근:**

```cpp
// 위험: Tick_Concurrent에서 UObject 접근
void FMyEmitterInstance::Tick_Concurrent(float DeltaSeconds)
{
    // ❌ UObject는 GameThread에서만 접근 가능!
    if (MyDataAsset->SomeValue > 0)
    {
        // Race Condition!
    }
}
```

**2. Wait 없이 Instance 파괴:**

```cpp
// 위험: 비동기 작업 중 파괴
void DestroyNiagaraComponent()
{
    // ❌ Concurrent Tick이 진행 중일 수 있음!
    NiagaraComponent->DestroyComponent();
}
```

**3. GPU Tick 중복 제출:**

```cpp
// 위험: 같은 프레임에 두 번 제출
void FNiagaraSystemInstance::MyCustomTick()
{
    GenerateAndSubmitGPUTick();  // ❌ 한 프레임에 한 번만!

    // ... 다른 작업 ...

    GenerateAndSubmitGPUTick();  // ❌ 중복 제출!
}
```

---

### ✅ 올바른 방법

**1. Concurrent-Safe 데이터 구조 사용:**

```cpp
// 좋은 예: Concurrent Tick 전에 데이터 캐싱
void FMyEmitterInstance::Tick_GameThread(float DeltaSeconds)
{
    // GameThread에서 미리 값 읽기
    CachedValue = MyDataAsset->SomeValue;
}

void FMyEmitterInstance::Tick_Concurrent(float DeltaSeconds)
{
    // ✅ Cached 값 사용
    if (CachedValue > 0)
    {
        // Thread-Safe!
    }
}
```

**2. Wait 후 안전하게 파괴:**

```cpp
// 좋은 예: 명시적 대기
void DestroyNiagaraComponent()
{
    if (NiagaraComponent->GetSystemInstance())
    {
        // ✅ 비동기 작업 완료 대기
        NiagaraComponent->GetSystemInstance()->WaitForConcurrentTickAndFinalize();
    }

    NiagaraComponent->DestroyComponent();
}
```

**3. Mode에 따른 GPU Tick 제출:**

```cpp
// 좋은 예: 시스템이 자동으로 처리
void FNiagaraSystemInstance::Tick_Concurrent(bool bEnqueueGPUTickIfNeeded)
{
    // ... Tick 작업 ...

    // ✅ Mode 확인 후 제출
    ENiagaraGPUTickHandlingMode Mode = Sim->GetGPUTickHandlingMode();
    if (Mode == ENiagaraGPUTickHandlingMode::Concurrent)
    {
        GenerateAndSubmitGPUTick();
    }
    // GameThread 모드는 FinalizeTick_GameThread에서 제출
}
```

---

## 🐛 디버깅

### Tick 상태 추적

```cpp
// 명령어: obj dump MyNiagaraSystem
void FNiagaraSystemInstance::DumpTickInfo(FOutputDevice& Ar)
{
    Ar.Logf(TEXT("System: %s"), *GetNameSafe(GetSystem()));
    Ar.Logf(TEXT("Age: %f"), Age);
    Ar.Logf(TEXT("TickCount: %d"), TickCount);
    Ar.Logf(TEXT("CachedDeltaSeconds: %f"), CachedDeltaSeconds);
    Ar.Logf(TEXT("ConcurrentTickGraphEvent: %s"), ConcurrentTickGraphEvent ? (ConcurrentTickGraphEvent->IsComplete() ? TEXT("Complete") : TEXT("Pending")) : TEXT("None"));
    Ar.Logf(TEXT("FinalizeRef: %s"), FinalizeRef.IsPending() ? TEXT("Pending") : TEXT("None"));
}
```

### Stall 감지

```cpp
// GNiagaraSystemSimulationTaskStallTimeout 설정
// 기본값: 0 (무제한 대기)
// 디버그 빌드: 10000000 (10초)

void FNiagaraSystemInstance::DumpStalledInfo()
{
    UE_LOG(LogNiagara, Fatal, TEXT("FNiagaraSystemInstance is stalled.\n"
        "System: %s\n"
        "ConcurrentTickGraphEvent Complete: %d\n"
        "FinalizeRef Pending: %d\n"
        "SystemInstanceIndex: %d\n"),
        *GetNameSafe(GetSystem()),
        ConcurrentTickGraphEvent ? ConcurrentTickGraphEvent->IsComplete() : true,
        FinalizeRef.IsPending(),
        SystemInstanceIndex);
}
```

### Task Graph 추적

```cpp
// 명령어: stat TaskGraphTasks
// Niagara Task 확인:
// - FNiagaraSystemSimulationTickConcurrentTask
// - FNiagaraSystemSimulationSpawnConcurrentTask

// Insights에서 추적:
// - Niagara::Tick_Concurrent
// - Niagara::FinalizeTick_GameThread
```

---

## 🔧 성능 최적화

### ✅ 해야 할 것

**1. Batch 처리 활용:**

```cpp
// 같은 System의 Instance를 많이 사용
// ✅ FNiagaraSystemSimulation이 자동으로 Batch 처리
for (int32 i = 0; i < 1000; ++i)
{
    SpawnNiagaraSystem(MySystem);  // 모두 같은 System
}

// 결과: 1000개 Instance를 한 번에 처리
// - System Script 1회 실행
// - Emitter Tick 병렬화
```

**2. AsyncWorkCanOverlapTickGroups 활용:**

```cpp
// System에서 설정
UNiagaraSystem* MySystem;
MySystem->AsyncWorkCanOverlapTickGroups = true;

// 효과: Tick이 다음 프레임까지 늦어져도 됨
// ⚠️ DataInterface가 GameThread 데이터를 참조하지 않아야 함
```

**3. Fixed Delta Time 사용 (필요시):**

```cpp
// Physics와 동기화가 필요한 경우
UNiagaraSystem* MySystem;
MySystem->SetFixedTickDeltaTime(0.0166f);

// ✅ 일정한 시뮬레이션 정확도
// ⚠️ 성능 부하 증가 (여러 번 Tick)
```

---

### ❌ 피해야 할 것

**1. Solo 남용:**

```cpp
// ❌ 모든 Instance를 Solo로 설정
for (int32 i = 0; i < 100; ++i)
{
    UNiagaraComponent* Comp = CreateComponent();
    Comp->SetForceSolo(true);  // ❌ Batch 불가능!
}

// 결과: 100번의 독립적인 Tick (비효율)
```

**2. GameThread 대기:**

```cpp
// ❌ GameThread에서 명시적 Wait
void ATick()
{
    NiagaraSystemInstance->WaitForConcurrentTickAndFinalize();  // ❌ Stall 발생!
}

// ✅ 대신 비동기 Callback 사용
NiagaraSystemInstance->OnPostTickDelegate.BindLambda([]()
{
    // Finalize 완료 후 실행
});
```

**3. 과도한 Fixed Delta Time:**

```cpp
// ❌ 너무 작은 Fixed Delta
UNiagaraSystem* MySystem;
MySystem->SetFixedTickDeltaTime(0.001f);  // ❌ 1ms = 1000 FPS!

// 30 FPS 프레임에서:
// - Ticks = 30 / 1 = 30번 Tick!
// - 성능 부하 심각
```

---

## 🔗 참조 자료

**소스 파일:**
- `NiagaraSystemInstance.h/cpp` - Instance Tick 구현
- `NiagaraSystemSimulation.h/cpp` - Batch Tick 구현
- `NiagaraWorldManager.cpp` - Tick 조율

**관련 문서:**
- [System_and_Emitter_Lifecycle.md](System_and_Emitter_Lifecycle.md) - 생명주기와 Tick의 관계
- [VM_Execution.md](VM_Execution.md) - CPU 시뮬레이션 실행

**Console Variables:**
- `GNiagaraSystemSimulationTaskStallTimeout` - Task Timeout (μs)
- `GWaitForAsyncStallWarnThresholdMS` - Stall 경고 임계값
- `GNiagaraSystemSimulationMaxTickSubsteps` - Fixed Tick 최대 횟수
- `GNiagaraSystemSimulationAllowASyncSimCache` - SimCache 비동기 허용

---

> 🔄 작성: 2025-11-22 — Niagara Tick 시스템의 GT/RT 파이프라인, Task Graph 통합, GPU Tick 제출 메커니즘 상세 분석
