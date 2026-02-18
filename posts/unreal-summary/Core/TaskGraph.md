---
title: "TaskGraph (태스크 그래프 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# TaskGraph (태스크 그래프 시스템)

## 🧭 개요

**TaskGraph**는 언리얼 엔진의 **멀티스레드 작업 스케줄링 시스템**으로, DAG(Directed Acyclic Graph) 기반의 의존성 관리를 통해 태스크들을 병렬로 실행합니다. 이 시스템은 게임 스레드, 렌더링 스레드, RHI 스레드 같은 명명된 스레드와 범용 워커 스레드 풀을 조율하여 CPU 코어를 효율적으로 활용합니다.

**핵심 철학:**
> **명명된 스레드(Named Threads)**는 "순서가 중요한 작업" (GameThread, RenderThread),
> **워커 스레드(Worker Threads)**는 "병렬 처리 가능한 작업" (AnyThread),
> **의존성 그래프(DAG)**는 "실행 순서 보장"을 담당한다.

**📂 위치:**
- `Engine/Source/Runtime/Core/Public/Async/TaskGraphInterfaces.h`
- `Engine/Source/Runtime/Core/Private/Async/TaskGraph.cpp`
- `Engine/Source/Runtime/Core/Public/Async/ParallelFor.h`

---

## 🧱 스레드 아키텍처

### 스레드 계층 구조

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Named Threads (명명된 스레드)                     │
│  - 특정 역할을 가진 스레드 (고정된 실행 순서 보장)                         │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
│  │  GameThread     │  │ RenderThread    │  │  RHIThread      │       │
│  │  (게임 로직)     │  │ (렌더 커맨드)   │  │ (GPU 제출)      │       │
│  │                 │  │                 │  │                 │       │
│  │  MainQueue      │  │  MainQueue      │  │  MainQueue      │       │
│  │  LocalQueue     │  │  LocalQueue     │  │  LocalQueue     │       │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌────────────────────────────────────────────────────────────────────────┐
│                    Worker Threads (워커 스레드 풀)                       │
│  - CPU 코어 수에 맞춰 동적 생성되는 스레드 풀                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │              Normal Priority Workers (일반)                   │     │
│  │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐     │     │
│  │  │ W0  │  │ W1  │  │ W2  │  │ W3  │  │ ...  │  │ WN  │     │     │
│  │  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘     │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │              High Priority Workers (고우선순위)                │     │
│  │  ┌─────┐  ┌─────┐                                           │     │
│  │  │ HP0 │  │ HP1 │      (선택적, 플랫폼 의존)                  │     │
│  │  └─────┘  └─────┘                                           │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │            Background Priority Workers (백그라운드)            │     │
│  │  ┌─────┐  ┌─────┐                                           │     │
│  │  │ BP0 │  │ BP1 │      (선택적, 플랫폼 의존)                  │     │
│  │  └─────┘  └─────┘                                           │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### ENamedThreads 열거형

**📂 위치:** `TaskGraphInterfaces.h:62`

```cpp
namespace ENamedThreads
{
    enum Type : int32
    {
        // 명명된 스레드 (Thread Index Mask: 0xFF)
        UnusedAnchor = -1,
        StatsThread = 0,
        RHIThread = 1,
        AudioThread = 2,
        GameThread = 3,
        ActualRenderingThread = GameThread + 1,  // 조건부로 할당

        // 워커 스레드
        AnyThread = 0xff,

        // 큐 타입 (Queue Index Mask: 0x100)
        MainQueue = 0x000,    // 기본 큐 (순차 실행)
        LocalQueue = 0x100,   // 지역 큐 (재귀 태스크용)

        // 태스크 우선순위 (Task Priority Mask: 0x600)
        NormalTaskPriority = 0x000,
        HighTaskPriority = 0x200,

        // 스레드 우선순위 (Thread Priority Mask: 0x1800)
        NormalThreadPriority = 0x000,
        HighThreadPriority = 0x800,
        BackgroundThreadPriority = 0x1000,

        NumThreadPriorities = 3,
    };
}
```

**비트 구조:**
```
   15      12      10       8       0
    │       │       │       │       │
    └───┬───┴───┬───┴───┬───┴───┬───┘
    Thread  Task   Queue Thread
    Priority Priority Index Index
    (2 bits)(2 bits)(1 bit)(8 bits)
```

---

## 🧩 핵심 클래스

### 클래스 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  UE::Tasks::Private::FTaskBase                          │
│  (새로운 Tasks 시스템의 기본 태스크 클래스)                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - Prerequisites : TArray<FTaskBase*>     // 선행 조건 태스크          │
│    - Subsequents : TArray<FTaskBase*>       // 후속 태스크               │
│    - RefCount : std::atomic<int32>          // 참조 카운트               │
│                                                                         │
│  Public:                                                                │
│    + TryExecuteTask() : bool                // 태스크 실행 시도          │
│    + IsCompleted() : bool                   // 완료 여부 확인            │
│    + AddPrerequisites()                     // 선행 조건 추가            │
│    + AddNested()                            // 중첩 태스크 추가          │
└─────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ 상속
                                      │
┌─────────────────────────────────────────────────────────────────────────┐
│                        FBaseGraphTask                                   │
│  (TaskGraph 시스템과 Tasks 시스템의 브리지)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + GetCompletionEvent() : FGraphEventRef  // 완료 이벤트 반환          │
│    + DontCompleteUntil(FGraphEventRef)      // 중첩 태스크 대기          │
│    + IsComplete() : bool                    // 완료 확인 (호환성)        │
│    + Wait(ENamedThreads::Type)              // 완료까지 대기             │
│    + Unlock()                               // 태스크 실행 시작          │
│    + DispatchSubsequents()                  // 후속 태스크 실행          │
└─────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ 상속
                                      │
┌─────────────────────────────────────────────────────────────────────────┐
│                    TGraphTask<TTask>                                    │
│  (실제 사용자 태스크를 실행하는 템플릿 클래스)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - TaskStorage : TTask                    // 실제 태스크 객체          │
│                                                                         │
│  Public:                                                                │
│    + CreateTask() : FConstructor            // 태스크 생성 헬퍼          │
│    + DoTask() : void                        // TTask::DoTask() 호출     │
│                                                                         │
│  Nested:                                                                │
│    - FConstructor                           // 빌더 패턴 헬퍼            │
│      + ConstructAndDispatchWhenReady()      // 생성 및 즉시 실행        │
│      + ConstructAndHold()                   // 생성 후 대기             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1. **FBaseGraphTask - 태스크 기반 클래스**

**📂 위치:** `TaskGraphInterfaces.h:480`

**역할:** TaskGraph 시스템과 새로운 Tasks 시스템의 브리지 역할. 의존성 관리, 생명주기 제어, 스레드 라우팅 제공.

**핵심 멤버:**

```cpp
class FBaseGraphTask : public UE::Tasks::Private::FTaskBase
{
public:
    explicit FBaseGraphTask(const FGraphEventArray* InPrerequisites)
        : FTaskBase(/*InitRefCount=*/ 1, false)
    {
        if (InPrerequisites != nullptr)
        {
            AddPrerequisites(*InPrerequisites, false);
        }
        UnlockPrerequisites();
    }

    // 완료 이벤트 반환 (다른 태스크의 선행 조건으로 사용)
    FGraphEventRef GetCompletionEvent()
    {
        return this;
    }

    // 중첩 태스크 추가 (현재 태스크 내부에서 다른 태스크 생성)
    void DontCompleteUntil(FGraphEventRef NestedTask)
    {
        checkSlow(UE::Tasks::Private::GetCurrentTask() == this);
        AddNested(*NestedTask);
    }

    // 완료까지 대기 (블로킹)
    void Wait(ENamedThreads::Type CurrentThreadIfKnown = ENamedThreads::AnyThread)
    {
        FTaskBase::WaitWithNamedThreadsSupport();
    }
};
```

**제공 기능:**
- **선행 조건 관리**: `AddPrerequisites()`로 DAG 구성
- **중첩 태스크**: `DontCompleteUntil()`로 동적 의존성 추가
- **동기화**: `Wait()`로 완료 대기
- **이벤트 시스템**: `GetCompletionEvent()`로 참조 전달

---

### 2. **TGraphTask<TTask> - 템플릿 태스크**

**📂 위치:** `TaskGraphInterfaces.h:607`

**역할:** 사용자가 정의한 태스크 클래스를 래핑하여 TaskGraph에서 실행 가능하게 만듦.

**사용자 태스크 요구사항:**
```cpp
class FMyTask
{
public:
    // 필수: 태스크 이름
    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FMyTask, STATGROUP_TaskGraphTasks);
    }

    // 필수: 스레드 지정
    static ENamedThreads::Type GetDesiredThread()
    {
        return ENamedThreads::AnyThread;
    }

    // 필수: 태스크 실행 로직
    void DoTask(ENamedThreads::Type CurrentThread, const FGraphEventRef& MyCompletionGraphEvent)
    {
        // 작업 수행
        UE_LOG(LogTemp, Log, TEXT("Task executed on thread %d"), CurrentThread);
    }
};
```

**생성 및 실행:**
```cpp
// 방법 1: 즉시 실행
FGraphEventRef MyTask = TGraphTask<FMyTask>::CreateTask(nullptr, ENamedThreads::AnyThread)
    .ConstructAndDispatchWhenReady();

// 방법 2: 선행 조건 지정
FGraphEventArray Prerequisites;
Prerequisites.Add(PreviousTask);
FGraphEventRef MyTask = TGraphTask<FMyTask>::CreateTask(&Prerequisites, ENamedThreads::GameThread)
    .ConstructAndDispatchWhenReady(Param1, Param2);

// 방법 3: Hold 후 수동 실행
FGraphEventRef MyTask = TGraphTask<FMyTask>::CreateTask(nullptr, ENamedThreads::AnyThread)
    .ConstructAndHold();
// ... 나중에 실행
MyTask->Unlock();
```

---

### 3. **FGraphEventRef - 태스크 참조**

**📂 위치:** `TaskGraphInterfaces.h:40`

```cpp
// TRefCountPtr을 사용한 스마트 포인터
typedef TRefCountPtr<FBaseGraphTask> FGraphEventRef;
```

**역할:** 태스크의 생명주기를 관리하고 의존성 그래프를 구성할 때 사용.

**특징:**
- **참조 카운팅**: 자동으로 메모리 관리
- **null 허용**: 빈 이벤트 가능
- **DAG 노드**: 다른 태스크의 선행 조건으로 전달 가능

---

## 🔁 의존성 관리 (DAG)

### DAG 실행 흐름

```
    사용자 코드                TaskGraph 시스템            Worker Threads
       │                             │                          │
       │ CreateTask(Prerequisites)   │                          │
       ├────────────────────────────>│                          │
       │                             │ 선행 조건 확인            │
       │                             │ (모두 완료?)             │
       │                             ├─────────┐                │
       │                             │         │ No             │
       │                             │         └──> Pending     │
       │                             │              Queue       │
       │                             │                          │
       │                             │         │ Yes            │
       │                             │<────────┘                │
       │                             │                          │
       │                             │ QueueTask()              │
       │                             ├─────────────────────────>│
       │                             │                          │ ★ Execute
       │                             │                          ├──────────┐
       │                             │                          │ DoTask() │
       │                             │                          │<─────────┘
       │                             │<─────────────────────────┤
       │                             │  OnTaskCompleted         │
       │                             │                          │
       │                             │ Unlock Subsequents       │
       │                             ├─────────────────────────>│
       │                             │                          │ ★ Execute
       │                             │                          │  (후속 태스크)
```

### 선행 조건 패턴

```cpp
// 패턴 1: 단일 선행 조건
FGraphEventRef Task1 = TGraphTask<FTask1>::CreateTask().ConstructAndDispatchWhenReady();
FGraphEventRef Task2 = TGraphTask<FTask2>::CreateTask(&Task1).ConstructAndDispatchWhenReady();
// Task2는 Task1 완료 후 실행

// 패턴 2: 다중 선행 조건
FGraphEventArray Prerequisites;
Prerequisites.Add(Task1);
Prerequisites.Add(Task2);
Prerequisites.Add(Task3);
FGraphEventRef GatherTask = TGraphTask<FGatherTask>::CreateTask(&Prerequisites)
    .ConstructAndDispatchWhenReady();
// GatherTask는 모든 선행 조건 완료 후 실행

// 패턴 3: 중첩 태스크 (동적 의존성)
class FParentTask
{
    void DoTask(ENamedThreads::Type CurrentThread, const FGraphEventRef& MyCompletionGraphEvent)
    {
        // 동적으로 하위 태스크 생성
        FGraphEventRef SubTask = TGraphTask<FSubTask>::CreateTask()
            .ConstructAndDispatchWhenReady();

        // 부모 태스크는 하위 태스크 완료까지 대기
        MyCompletionGraphEvent->DontCompleteUntil(SubTask);
    }
};
```

---

## 🎯 ParallelFor - 병렬 반복 패턴

### ParallelFor 구조

**📂 위치:** `ParallelFor.h:115`

```cpp
template<typename BodyType>
void ParallelFor(
    int32 Num,                     // 반복 횟수
    BodyType Body,                 // 람다 함수
    EParallelForFlags Flags = EParallelForFlags::None
);
```

**내부 동작:**
1. **작업 분할**: `Num`을 `NumWorkers`로 나눔
2. **배치 생성**: 각 워커에 `[Start, End)` 범위 할당
3. **태스크 생성**: 각 배치에 대해 `TGraphTask` 생성
4. **동기화**: 모든 태스크 완료 대기

**배치 크기 계산:**
```cpp
// ParallelFor.h:84
inline int32 GetNumberOfThreadTasks(int32 Num, int32 MinBatchSize, EParallelForFlags Flags)
{
    int32 NumThreadTasks = 0;
    if (Num > 1 && !(Flags & EParallelForFlags::ForceSingleThread))
    {
        // 워커 수와 배치 크기 고려
        NumThreadTasks = FMath::Min(
            int32(LowLevelTasks::FScheduler::Get().GetNumWorkers()),
            (Num + (MinBatchSize/2)) / MinBatchSize
        );
    }

    // 현재 스레드도 작업에 참여
    if (!LowLevelTasks::FScheduler::Get().IsWorkerThread())
    {
        NumThreadTasks++;
    }

    // CPU 코어 수 제한
    return FMath::Min(NumThreadTasks, FPlatformMisc::NumberOfCoresIncludingHyperthreads());
}
```

### 실전 예시

```cpp
// 예시 1: 배열 변환
TArray<int32> Numbers;
Numbers.SetNum(10000);

ParallelFor(Numbers.Num(), [&](int32 Index)
{
    Numbers[Index] = Index * Index;
});

// 예시 2: 최소 배치 크기 지정 (너무 작은 작업 방지)
ParallelFor(Numbers.Num(), [&](int32 Index)
{
    Numbers[Index] = FMath::Sqrt(Index);
},
100);  // 최소 100개씩 처리

// 예시 3: 백그라운드 우선순위
ParallelFor(Numbers.Num(), [&](int32 Index)
{
    // 낮은 우선순위 작업
    HeavyComputation(Index);
},
EParallelForFlags::BackgroundPriority);

// 예시 4: 불균형 작업 (작업량 차이가 클 때)
ParallelFor(Actors.Num(), [&](int32 Index)
{
    // 각 액터마다 처리 시간이 크게 다를 수 있음
    Actors[Index]->ComplexUpdate();
},
EParallelForFlags::Unbalanced);
```

---

## 🎨 태스크 우선순위 제어

### 우선순위 조합

```cpp
// 일반 우선순위, 일반 스레드
ENamedThreads::Type Normal = ENamedThreads::AnyThread;

// 높은 태스크 우선순위
ENamedThreads::Type HighTask = ENamedThreads::SetTaskPriority(
    ENamedThreads::AnyThread,
    ENamedThreads::HighTaskPriority
);

// 높은 스레드 우선순위
ENamedThreads::Type HighThread = ENamedThreads::SetThreadPriority(
    ENamedThreads::AnyThread,
    ENamedThreads::HighThreadPriority
);

// 스레드 + 태스크 우선순위 동시 설정
ENamedThreads::Type HighBoth = ENamedThreads::SetPriorities(
    ENamedThreads::AnyThread,
    ENamedThreads::HighThreadPriority,
    ENamedThreads::HighTaskPriority
);
```

**우선순위 비트 추출:**
```cpp
// TaskGraphInterfaces.h:153
FORCEINLINE int32 GetQueueIndex(Type ThreadAndIndex)
{
    return (ThreadAndIndex & QueueIndexMask) >> QueueIndexShift;
}

FORCEINLINE int32 GetTaskPriority(Type ThreadAndIndex)
{
    return (ThreadAndIndex & TaskPriorityMask) >> TaskPriorityShift;
}

FORCEINLINE int32 GetThreadPriorityIndex(Type ThreadAndIndex)
{
    int32 Result = (ThreadAndIndex & ThreadPriorityMask) >> ThreadPriorityShift;
    check(Result >= 0 && Result < NumThreadPriorities);
    return Result;
}
```

---

## 📊 설계 철학

| 설계 결정 | 이유 | 효과 |
|----------|------|------|
| **DAG 기반 의존성** | 태스크 실행 순서를 명시적으로 표현 | 데드락 방지, 최적화 가능 |
| **Named Threads 분리** | 게임/렌더링 로직은 순서 보장 필요 | 프레임 일관성 유지 |
| **Worker Thread 풀** | CPU 코어 최대 활용 | 병렬 처리 극대화 |
| **Reference Counting** | 태스크 생명주기 자동 관리 | 메모리 누수 방지 |
| **FTaskBase 통합** | 새로운 Tasks 시스템과 호환 | 점진적 마이그레이션 |
| **Local Queue** | 재귀 태스크 최적화 | 캐시 효율성 향상 |

**핵심 철학:**

> **"의존성은 명시적으로, 실행은 자동으로, 우선순위는 유연하게"**
>
> - 프로그래머는 **"무엇을 언제 실행해야 하는가"**를 선언
> - TaskGraph는 **"어떻게 최적으로 실행할 것인가"**를 결정
> - 스레드 풀은 **"어디서 실행할 것인가"**를 조율

---

## 💡 실전 패턴

### 패턴 1: Scatter-Gather

```cpp
// 작업 분산 (Scatter)
FGraphEventArray ScatterTasks;
for (int32 i = 0; i < 100; i++)
{
    FGraphEventRef Task = TGraphTask<FProcessTask>::CreateTask()
        .ConstructAndDispatchWhenReady(i);
    ScatterTasks.Add(Task);
}

// 결과 수집 (Gather)
FGraphEventRef GatherTask = TGraphTask<FGatherTask>::CreateTask(&ScatterTasks)
    .ConstructAndDispatchWhenReady();

GatherTask->Wait();  // 모든 작업 완료 대기
```

### 패턴 2: Pipeline (생산자-소비자)

```cpp
class FProducerTask
{
    void DoTask(ENamedThreads::Type CurrentThread, const FGraphEventRef& MyCompletionGraphEvent)
    {
        TArray<FData> ProducedData = ProduceData();

        // 소비자 태스크에 데이터 전달
        FGraphEventRef ConsumerTask = TGraphTask<FConsumerTask>::CreateTask()
            .ConstructAndDispatchWhenReady(ProducedData);

        MyCompletionGraphEvent->DontCompleteUntil(ConsumerTask);
    }
};
```

### 패턴 3: Fork-Join with Priority

```cpp
// 고우선순위 작업
FGraphEventRef CriticalTask = TGraphTask<FCriticalTask>::CreateTask(
    nullptr,
    ENamedThreads::SetPriorities(
        ENamedThreads::AnyThread,
        ENamedThreads::HighThreadPriority,
        ENamedThreads::HighTaskPriority
    )
).ConstructAndDispatchWhenReady();

// 백그라운드 작업
FGraphEventRef BackgroundTask = TGraphTask<FBackgroundTask>::CreateTask(
    nullptr,
    ENamedThreads::SetThreadPriority(
        ENamedThreads::AnyThread,
        ENamedThreads::BackgroundThreadPriority
    )
).ConstructAndDispatchWhenReady();

// 두 작업 모두 완료 대기
FGraphEventArray JoinTasks = { CriticalTask, BackgroundTask };
FTaskGraphInterface::Get().WaitUntilTasksComplete(JoinTasks);
```

---

## 🚀 성능 최적화

### ✅ 해야 할 것

```cpp
// 좋은 예시 1: 적절한 배치 크기
ParallelFor(LargeArray.Num(), [&](int32 Index)
{
    QuickOperation(Index);
},
1000);  // 작은 작업은 배치 크기를 크게

// 좋은 예시 2: 태스크 재사용 (선행 조건 활용)
FGraphEventRef LoadTask = TGraphTask<FLoadDataTask>::CreateTask()
    .ConstructAndDispatchWhenReady();

// LoadTask를 여러 후속 작업의 선행 조건으로 재사용
FGraphEventRef ProcessTask1 = TGraphTask<FProcessTask1>::CreateTask(&LoadTask)
    .ConstructAndDispatchWhenReady();
FGraphEventRef ProcessTask2 = TGraphTask<FProcessTask2>::CreateTask(&LoadTask)
    .ConstructAndDispatchWhenReady();

// 좋은 예시 3: 중첩 태스크로 동적 로드 밸런싱
class FAdaptiveTask
{
    void DoTask(ENamedThreads::Type CurrentThread, const FGraphEventRef& MyCompletionGraphEvent)
    {
        if (WorkloadIsLarge())
        {
            // 큰 작업은 분할
            FGraphEventRef SubTask1 = TGraphTask<FAdaptiveTask>::CreateTask()
                .ConstructAndDispatchWhenReady(FirstHalf);
            FGraphEventRef SubTask2 = TGraphTask<FAdaptiveTask>::CreateTask()
                .ConstructAndDispatchWhenReady(SecondHalf);

            MyCompletionGraphEvent->DontCompleteUntil(SubTask1);
            MyCompletionGraphEvent->DontCompleteUntil(SubTask2);
        }
        else
        {
            // 작은 작업은 직접 처리
            ProcessDirectly();
        }
    }
};
```

### ❌ 피해야 할 것

```cpp
// 나쁜 예시 1: 너무 작은 태스크 (오버헤드 > 작업 시간)
ParallelFor(100, [&](int32 Index)
{
    Result[Index] = Index + 1;  // 단순 덧셈은 병렬화 불필요
});

// 나쁜 예시 2: 블로킹 Wait() 남용
FGraphEventRef Task = TGraphTask<FMyTask>::CreateTask().ConstructAndDispatchWhenReady();
Task->Wait();  // 즉시 대기 → 병렬성 상실!
// → 대신 선행 조건으로 연결

// 나쁜 예시 3: Named Thread에서 긴 작업
class FLongGameThreadTask
{
    static ENamedThreads::Type GetDesiredThread()
    {
        return ENamedThreads::GameThread;  // ❌ 게임 스레드 블로킹
    }

    void DoTask(...)
    {
        Sleep(1000);  // 게임 스레드가 1초간 멈춤!
    }
};
// → 대신 AnyThread에서 실행하고 결과만 GameThread로 전달

// 나쁜 예시 4: 순환 의존성
FGraphEventRef TaskA = TGraphTask<FTaskA>::CreateTask(&TaskB).ConstructAndHold();
FGraphEventRef TaskB = TGraphTask<FTaskB>::CreateTask(&TaskA).ConstructAndHold();
TaskA->Unlock();
TaskB->Unlock();  // ❌ 데드락!
```

### 측정 결과 (예시)

```
테스트: 10,000개 요소 배열 처리 (각 요소당 0.1ms 작업)

1. 단일 스레드:                 ~1000ms
2. ParallelFor (배치=1):         ~350ms  (오버헤드 큼)
3. ParallelFor (배치=100):       ~130ms  (최적)
4. ParallelFor (배치=10000):     ~1000ms (병렬화 안됨)

결론: 배치 크기는 (총 작업 / 워커 수) 정도가 최적
```

---

## 🐛 디버깅과 프로파일링

### 일반적인 함정

#### ❌ 함정 1: 데이터 레이스

```cpp
// 위험한 코드
int32 SharedCounter = 0;
ParallelFor(1000, [&](int32 Index)
{
    SharedCounter++;  // ❌ 데이터 레이스!
});

// 올바른 방법 1: Atomic
std::atomic<int32> SharedCounter{0};
ParallelFor(1000, [&](int32 Index)
{
    SharedCounter.fetch_add(1);
});

// 올바른 방법 2: Per-Thread 누적 + Gather
TArray<int32> PerThreadCounters;
PerThreadCounters.SetNumZeroed(NumThreads);
ParallelFor(1000, [&](int32 Index)
{
    int32 ThreadID = FPlatformTLS::GetCurrentThreadId();
    PerThreadCounters[ThreadID]++;
});
int32 Total = 0;
for (int32 Count : PerThreadCounters) Total += Count;
```

#### ❌ 함정 2: 캡처 참조 생명주기

```cpp
// 위험한 코드
void SpawnAsyncTask()
{
    TArray<int32> LocalData = LoadData();

    TGraphTask<FProcessTask>::CreateTask()
        .ConstructAndDispatchWhenReady([&LocalData]()  // ❌ LocalData가 스택 변수!
        {
            Process(LocalData);  // 이미 소멸된 메모리 접근
        });
}  // LocalData 소멸

// 올바른 방법: 값 캡처 또는 힙 할당
void SpawnAsyncTask()
{
    TSharedPtr<TArray<int32>> SharedData = MakeShared<TArray<int32>>(LoadData());

    TGraphTask<FProcessTask>::CreateTask()
        .ConstructAndDispatchWhenReady([SharedData]()  // ✅ 값 캡처 (참조 카운트 증가)
        {
            Process(*SharedData);
        });
}
```

### 디버깅 도구

```cpp
// 1. 태스크 이름 지정 (프로파일러에 표시)
class FMyTask
{
    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FMyTask, STATGROUP_TaskGraphTasks);
    }
};

// 2. 현재 스레드 확인
ENamedThreads::Type CurrentThread = FTaskGraphInterface::Get().GetCurrentThreadIfKnown();
if (CurrentThread == ENamedThreads::GameThread)
{
    UE_LOG(LogTemp, Warning, TEXT("Running on GameThread!"));
}

// 3. 태스크 완료 여부 확인
if (MyTask->IsComplete())
{
    UE_LOG(LogTemp, Log, TEXT("Task already completed"));
}
else
{
    UE_LOG(LogTemp, Log, TEXT("Task still running"));
}

// 4. 콘솔 명령어
// stat TaskGraph          - 태스크 그래프 통계
// TaskGraph.ABTestThreads - 스레드 우선순위 A/B 테스트
// TaskGraph.UseDynamicPrioritization - 동적 우선순위 조정 활성화
```

### Unreal Insights 프로파일링

```
UnrealInsights로 다음 정보 확인:
- TaskGraph Lane: 각 태스크의 실행 시간, 대기 시간
- Thread States: 스레드 활용률
- Prerequisites: 의존성 체인 시각화
- Wake-up Delays: 태스크 깨우기 지연 시간
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Asynchronous Asset Loading](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/Assets/AsyncLoading/)
- Unreal Engine Docs: [Multi-Threading and Performance](https://docs.unrealengine.com/en-US/TestingAndOptimization/PerformanceAndProfiling/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/Async/TaskGraphInterfaces.h` - TaskGraph 인터페이스
- `Engine/Source/Runtime/Core/Private/Async/TaskGraph.cpp` - TaskGraph 구현
- `Engine/Source/Runtime/Core/Public/Async/ParallelFor.h` - ParallelFor 구현
- `Engine/Source/Runtime/Core/Public/Tasks/Task.h` - 새로운 Tasks 시스템

### 커뮤니티 자료
- [UE4 TaskGraph系统源码浅析 - timlly](https://www.cnblogs.com/timlly/p/14327537.html)
  - TaskGraph 구조 분석 (Named/Unnamed Threads, FBaseGraphTask, DAG 의존성)
- [UE4 TaskGraph 源码分析 - kekec](https://www.cnblogs.com/kekec/p/13915313.html)
  - 스레드 풀 구조 (NamedThread vs AnyThread, 우선순위, 작업 큐)

### 관련 주제
- `UnrealSummary/Core/Templates.md` - TGraphTask에서 사용하는 템플릿 기법
- `UnrealSummary/Core/SmartPointers.md` - FGraphEventRef의 참조 카운팅
- `UnrealSummary/CoreUObject/Async.md` - UObject 비동기 로딩 (TaskGraph 활용)

---

> 🔄 Created: 2025-01-XX — Initial documentation for TaskGraph system in UE 5.7
