---
title: "TickSystem (틱 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# TickSystem (틱 시스템)

## 🧭 개요

**FTickFunction**은 언리얼 엔진의 **프레임별 업데이트 메커니즘의 핵심**입니다. 모든 Actor와 Component는 FTickFunction을 통해 매 프레임 업데이트되며, Tick Group, 우선순위, 의존성을 정밀하게 제어할 수 있습니다.

**핵심 철학:**
> **FTickFunction**은 "실행 단위" (Tick 설정, 의존성),
> **FTickTaskLevel**은 "Level별 Tick 관리" (Enable/Disable/Cooldown 리스트),
> **FTickTaskSequencer**는 "전역 스케줄러" (TaskGraph 통합),
> **FTickTaskManager**는 "최상위 관리자" (World → Level → Tick 흐름)을 담당한다.

**주요 특징:**
- **Tick Group**: TG_PrePhysics, TG_DuringPhysics, TG_PostPhysics 등 물리 시뮬레이션과 동기화
- **Prerequisites**: Tick 간 의존성 설정 (A가 완료된 후 B 실행)
- **Tick Interval**: 쿨다운 시스템으로 N초마다 Tick (성능 최적화)
- **Multi-threading**: bRunOnAnyThread로 병렬 실행 지원
- **Tick State**: Enabled → CoolingDown → Enabled 순환

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/Engine/EngineBaseTypes.h` (FTickFunction)
- `Engine/Source/Runtime/Engine/Private/TickTaskManager.cpp` (구현)
- `UnrealSummary/External/Foundation/TickTaskManager.h` (주석 코드)

---

## 🧱 Tick Group 시스템

### ETickingGroup - 물리와의 동기화

**📂 위치:** `EngineBaseTypes.h:80-109`

```cpp
enum ETickingGroup : int
{
    /** 물리 시뮬레이션 시작 전 */
    TG_PrePhysics,

    /** 물리 시뮬레이션 시작 (특수) */
    TG_StartPhysics,

    /** 물리 시뮬레이션과 병렬 실행 가능 */
    TG_DuringPhysics,

    /** 물리 시뮬레이션 종료 (특수) */
    TG_EndPhysics,

    /** 물리와 Cloth 시뮬레이션 완료 후 */
    TG_PostPhysics,

    /** 업데이트 작업 완료 후 */
    TG_PostUpdateWork,

    /** 최종 단계 */
    TG_LastDemotable,

    /** 프레임 중 새로 스폰된 Actor용 (반복 실행) */
    TG_NewlySpawned,

    TG_MAX,
};
```

**Tick Group 실행 순서:**
```
프레임 시작
     │
     ↓
┌────────────────────────────────────────────────┐
│  TG_PrePhysics                                 │
│  - 물리 입력 준비 (CharacterMovement)          │
│  - 물리 이전 로직                               │
└────────────┬───────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────┐
│  TG_StartPhysics (특수)                        │
│  - 물리 시뮬레이션 시작                         │
└────────────┬───────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────┐
│  TG_DuringPhysics                              │
│  - 물리와 병렬로 실행 가능한 로직               │
│  - AI 계산, 애니메이션 블렌딩                   │
└────────────┬───────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────┐
│  TG_EndPhysics (특수)                          │
│  - 물리 시뮬레이션 종료                         │
└────────────┬───────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────┐
│  TG_PostPhysics                                │
│  - 물리 결과 반영 (IK, Ragdoll)                │
│  - Transform 동기화                            │
└────────────┬───────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────┐
│  TG_PostUpdateWork                             │
│  - 최종 정리 작업                               │
└────────────┬───────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────┐
│  TG_NewlySpawned (반복)                        │
│  - 이번 프레임에 스폰된 Actor 처리              │
│  - 빈 큐가 될 때까지 반복                       │
└────────────────────────────────────────────────┘
             ↓
프레임 종료
```

### StartTickGroup vs EndTickGroup

**📂 위치:** `EngineBaseTypes.h:185-194`

```cpp
struct FTickFunction
{
    /** 이 Tick이 시작 가능한 최소 TickGroup */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    TEnumAsByte<enum ETickingGroup> TickGroup;

    /** 이 Tick이 반드시 완료되어야 하는 TickGroup */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    TEnumAsByte<enum ETickingGroup> EndTickGroup;
};
```

**사용 예시:**
```cpp
// TickGroup = TG_PrePhysics, EndTickGroup = TG_PostPhysics
// → TG_PrePhysics에 시작되지만, TG_PostPhysics가 끝나기 전에 완료되어야 함
// → 실제로는 TG_PrePhysics + TG_StartPhysics + TG_DuringPhysics 동안 실행 가능

MyTickFunction.TickGroup = TG_PrePhysics;
MyTickFunction.EndTickGroup = TG_PostPhysics;
```

**2D 배열로 관리:**
```
┌───────────────────┬─────────────────────┬────────────────────────┬────────────────────┐
│  Start\End        │    TG_PrePhysics    │    TG_StartPhysics     │   TG_EndPhysics    │
├───────────────────┼─────────────────────┼────────────────────────┼────────────────────┤
│  TG_PrePhysics    │   Pre → Pre         │    Pre → Start         │    Pre → End       │
├───────────────────┼─────────────────────┼────────────────────────┼────────────────────┤
│  TG_StartPhysics  │   Invalid           │    Start → Start       │    Start → End     │
├───────────────────┼─────────────────────┼────────────────────────┼────────────────────┤
│  TG_EndPhysics    │   Invalid           │    Invalid             │    End → End       │
└───────────────────┴─────────────────────┴────────────────────────┴────────────────────┘
```

---

## 📋 FTickFunction 구조

### 핵심 멤버 변수

**📂 위치:** `EngineBaseTypes.h:170-319`

```cpp
USTRUCT()
struct FTickFunction
{
    // ========== Tick 설정 ==========

    /** Tick Group (TG_PrePhysics, TG_PostPhysics 등) */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    TEnumAsByte<enum ETickingGroup> TickGroup;

    /** 완료 필수 Tick Group */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    TEnumAsByte<enum ETickingGroup> EndTickGroup;

    // ========== Tick 옵션 ==========

    /** 게임이 일시정지되어도 Tick 실행 여부 */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    uint8 bTickEvenWhenPaused:1;

    /** Tick 가능 여부 (기본값 설정에만 사용) */
    UPROPERTY()
    uint8 bCanEverTick:1;

    /** 활성화 상태로 시작할지 여부 */
    UPROPERTY(EditDefaultsOnly, Category="Tick")
    uint8 bStartWithTickEnabled:1;

    /** Dedicated Server에서도 Tick 허용 */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    uint8 bAllowTickOnDedicatedServer:1;

    /** Tick Batching 허용 (성능 최적화) */
    uint8 bAllowTickBatching:1;

    /** 높은 우선순위 (Tick Group 내에서 먼저 실행) */
    uint8 bHighPriority:1;

    /** 병렬 실행 허용 (게임 스레드 외 스레드에서 실행) */
    uint8 bRunOnAnyThread:1;

    /** 수동 디스패치 (명시적 호출 시에만 실행) */
    uint8 bDispatchManually:1;

    // ========== Tick Interval ==========

    /** Tick 간격 (초), 0 이하면 매 프레임 */
    UPROPERTY(EditDefaultsOnly, Category="Tick", meta=(DisplayName="Tick Interval (secs)"))
    float TickInterval;

    // ========== Tick State ==========

private:
    enum class ETickState : uint8
    {
        Disabled,      // Tick 비활성화
        Enabled,       // Tick 활성화 (매 프레임 또는 쿨다운 완료)
        CoolingDown    // TickInterval 대기 중
    };

    ETickState TickState : 2;

    /** Prerequisites - 이 Tick 이전에 완료되어야 하는 Tick들 */
    TArray<struct FTickPrerequisite> Prerequisites;

    /** 등록된 Tick Function의 내부 데이터 */
    struct FInternalData
    {
        bool bRegistered : 1;                          // 등록 여부
        bool bWasInterval:1;                           // TickInterval 설정 여부
        ETickTaskState TaskState;                      // TaskGraph 상태
        TEnumAsByte<enum ETickingGroup> ActualStartTickGroup;  // 실제 시작 TickGroup
        TEnumAsByte<enum ETickingGroup> ActualEndTickGroup;    // 실제 종료 TickGroup
        void* TaskPointer;                             // TGraphTask 포인터
        FTickFunction* Next;                           // Cooldown List의 다음 노드
        float RelativeTickCooldown;                    // 상대적 쿨다운 시간
        float LastTickGameTimeSeconds;                 // 마지막 Tick 시간
        class FTickTaskLevel* TickTaskLevel;           // 소속 Level
    };

    TUniquePtr<FInternalData> InternalData;
};
```

### FActorTickFunction vs FActorComponentTickFunction

**📂 위치:** `Actor.h:21-40` (External/Foundation)

```cpp
/** Actor의 Tick Function */
struct FActorTickFunction : public FTickFunction
{
    virtual void ExecuteTick(
        float DeltaTime,
        ELevelTick TickType,
        ENamedThreads::Type CurrentThread,
        const FGraphEventRef& MyCompletionGraphEvent
    ) override
    {
        if (Target && IsValidChecked(Target) && !Target->IsUnreachable())
        {
            if (TickType != LEVELTICK_ViewportsOnly || Target->ShouldTickIfViewportsOnly())
            {
                // AActor::TickActor 호출
                Target->TickActor(DeltaTime * Target->CustomTimeDilation, TickType, *this);
            }
        }
    }

    class AActor* Target;  // Tick할 Actor
};

/** Component의 Tick Function */
struct FActorComponentTickFunction : public FTickFunction
{
    virtual void ExecuteTick(...) override
    {
        if (Target && IsValidChecked(Target) && !Target->IsUnreachable())
        {
            // UActorComponent::TickComponent 호출
            Target->TickComponent(DeltaTime, TickType, *this);
        }
    }

    class UActorComponent* Target;  // Tick할 Component
};
```

---

## 🗂️ FTickTaskLevel - Level별 Tick 관리

### 3개의 Tick 리스트

**📂 위치:** `TickTaskManager.h:536-566` (External/Foundation)

```cpp
class FTickTaskLevel
{
    // ========== (1) AllEnabledTickFunctions ==========
    // 매 프레임 실행되는 Tick Function들
    TSet<FTickFunction*> AllEnabledTickFunctions;

    // ========== (2) AllCoolingDownTickFunctions ==========
    // TickInterval 대기 중인 Tick Function들 (Singly-Linked List)
    struct FCoolingDownTickFunctionList
    {
        FTickFunction* Head;  // 리스트 헤드

        bool Contains(FTickFunction* TickFunction) const
        {
            FTickFunction* Node = Head;
            while (Node)
            {
                if (Node == TickFunction)
                    return true;
                Node = Node->InternalData->Next;
            }
            return false;
        }
    };
    FCoolingDownTickFunctionList AllCoolingDownTickFunctions;

    // ========== (3) AllDisabledTickFunctions ==========
    // 비활성화된 Tick Function들
    TSet<FTickFunction*> AllDisabledTickFunctions;

    // ========== (4) TickFunctionsToReschedule ==========
    // Cooldown List로 이동 예정인 Tick Function들
    TArrayWithThreadsafeAdd<FTickScheduleDetails> TickFunctionsToReschedule;

    // ========== (5) NewlySpawnedTickFunctions ==========
    // 이번 프레임에 새로 추가된 Tick Function들
    TSet<FTickFunction*> NewlySpawnedTickFunctions;

    /** 새로운 Tick 추가 허용 여부 */
    bool bTickNewlySpawned;
};
```

**Tick Function 생명주기:**
```
등록 (RegisterTickFunction)
     │
     ↓
┌────────────────────────────────────────────┐
│  TickState::Disabled                       │
│  └─ AllDisabledTickFunctions               │
└────────────┬───────────────────────────────┘
             │ SetTickFunctionEnable(true)
             ↓
┌────────────────────────────────────────────┐
│  TickState::Enabled                        │
│  └─ AllEnabledTickFunctions                │
│     │                                       │
│     ├─ TickInterval == 0: 매 프레임 실행   │
│     └─ TickInterval > 0: 실행 후 이동 ──┐  │
└─────────────────────────────────────────┼──┘
                                          │
                      ┌───────────────────┘
                      ↓
┌────────────────────────────────────────────┐
│  TickState::CoolingDown                    │
│  └─ AllCoolingDownTickFunctions (Linked)  │
│     │                                       │
│     └─ DeltaTime 경과 후 다시 Enabled ──┐  │
└─────────────────────────────────────────┼──┘
                                          │
                      ┌───────────────────┘
                      ↓
            (다시 Enabled로 순환)
```

### Cooldown List 구조 - Relative Time

**📂 위치:** `TickTaskManager.h:229-359` (External/Foundation)

**핵심 개념:** 각 노드는 **이전 노드로부터의 상대 시간**을 저장합니다.

```
AllCoolingDownTickFunctions
 │   ┌──────┐    ┌───────────────────┐       ┌───────────────────┐       ┌────────────────────┐
 └───┤ Head ◄────┤ TickFunction0     ◄───────┤ TickFunction1     ◄───────┤ TickFunction2      ◄─────
     └──────┘    │                   │       │                   │       │                    │
                 │ Relative=3.0f     │       │ Relative=6.0f     │       │ Relative=2.0f      │
                 │ Cumulative=3.0f   │       │ Cumulative=9.0f   │       │ Cumulative=11.0f   │
                 └───────────────────┘       └───────────────────┘       └────────────────────┘
```

**장점:**
1. **쿨다운 업데이트 간단**: Head의 RelativeTickCooldown만 빼면 됨
2. **삽입 효율적**: 정렬된 위치 찾아서 RelativeTickCooldown 재계산
3. **메모리 효율적**: 전역 시간 대신 상대 시간만 저장

**쿨다운 경과 예시:**
```
[DeltaTime = 5.0f]

Before:
    Head → [Rel=3.0f] → [Rel=6.0f] → [Rel=2.0f]
           (Cum=3.0f)   (Cum=9.0f)   (Cum=11.0f)

Step 1: Cumulative < DeltaTime인 노드를 Enabled로 변경
    - TickFunction0 (Cum=3.0f < 5.0f) → Enabled

Step 2: Head 업데이트 및 다음 노드 RelativeTickCooldown 조정
    Head → [Rel=4.0f] → [Rel=2.0f]
           (Cum=4.0f)   (Cum=6.0f)

    * TickFunction1의 Relative: 9.0f - 5.0f = 4.0f

After:
    AllEnabledTickFunctions: [TickFunction0]
    AllCoolingDownTickFunctions: TickFunction1 → TickFunction2
```

### ScheduleTickFunctionCooldowns() - Reschedule List 처리

**📂 위치:** `TickTaskManager.h:229-359` (External/Foundation)

```cpp
void FTickTaskLevel::ScheduleTickFunctionCooldowns()
{
    if (TickFunctionsToReschedule.Num() > 0)
    {
        // 1. Reschedule List를 Cooldown 시간 기준 오름차순 정렬
        TickFunctionsToReschedule.Sort([](const FTickScheduleDetails& A, const FTickScheduleDetails& B)
        {
            return A.Cooldown < B.Cooldown;
        });

        // 2. Cooldown List에 Insertion Sort 방식으로 삽입
        int32 RescheduleIndex = 0;
        float CumulativeCooldown = 0.f;
        FTickFunction* PrevComparisonTickFunction = nullptr;
        FTickFunction* ComparisonTickFunction = AllCoolingDownTickFunctions.Head;

        while (ComparisonTickFunction && RescheduleIndex < TickFunctionsToReschedule.Num())
        {
            const float CooldownTime = TickFunctionsToReschedule[RescheduleIndex].Cooldown;

            // Cumulative + Relative > CooldownTime이면 삽입 위치 찾음
            if ((CumulativeCooldown + ComparisonTickFunction->InternalData->RelativeTickCooldown) > CooldownTime)
            {
                FTickFunction* TickFunction = TickFunctionsToReschedule[RescheduleIndex].TickFunction;

                if (TickFunction->TickState != FTickFunction::ETickState::Disabled)
                {
                    // 삽입: PrevComparisonTickFunction ↔ TickFunction ↔ ComparisonTickFunction
                    TickFunction->TickState = FTickFunction::ETickState::CoolingDown;
                    TickFunction->InternalData->RelativeTickCooldown = CooldownTime - CumulativeCooldown;

                    if (PrevComparisonTickFunction)
                        PrevComparisonTickFunction->InternalData->Next = TickFunction;
                    else
                        AllCoolingDownTickFunctions.Head = TickFunction;

                    TickFunction->InternalData->Next = ComparisonTickFunction;
                    PrevComparisonTickFunction = TickFunction;

                    // ComparisonTickFunction의 RelativeTickCooldown 조정
                    ComparisonTickFunction->InternalData->RelativeTickCooldown -= TickFunction->InternalData->RelativeTickCooldown;
                    CumulativeCooldown += TickFunction->InternalData->RelativeTickCooldown;
                }

                ++RescheduleIndex;
            }
            else
            {
                // 아직 삽입 위치 아님, 다음 노드로
                CumulativeCooldown += ComparisonTickFunction->InternalData->RelativeTickCooldown;
                PrevComparisonTickFunction = ComparisonTickFunction;
                ComparisonTickFunction = ComparisonTickFunction->InternalData->Next;
            }
        }

        // 3. 남은 Tick Function들을 리스트 끝에 추가
        for (; RescheduleIndex < TickFunctionsToReschedule.Num(); ++RescheduleIndex)
        {
            FTickFunction* TickFunction = TickFunctionsToReschedule[RescheduleIndex].TickFunction;
            if (TickFunction->TickState != FTickFunction::ETickState::Disabled)
            {
                const float CooldownTime = TickFunctionsToReschedule[RescheduleIndex].Cooldown;
                TickFunction->TickState = FTickFunction::ETickState::CoolingDown;
                TickFunction->InternalData->RelativeTickCooldown = CooldownTime - CumulativeCooldown;
                TickFunction->InternalData->Next = nullptr;

                if (PrevComparisonTickFunction)
                    PrevComparisonTickFunction->InternalData->Next = TickFunction;
                else
                    AllCoolingDownTickFunctions.Head = TickFunction;

                PrevComparisonTickFunction = TickFunction;
                CumulativeCooldown += TickFunction->InternalData->RelativeTickCooldown;
            }
        }

        TickFunctionsToReschedule.Reset();
    }
}
```

**삽입 다이어그램:**
```
TickFunctionsToReschedule (정렬됨):
[Cooldown=5.f] [Cooldown=7.f] [Cooldown=10.f] [Cooldown=13.f] [Cooldown=15.f]
     │              │               │                │               │
     └──────────────┴───────────────┴────────────────┴───────────────┘
                                    ↓ 삽입
AllCoolingDownTickFunctions:
[Rel=3.f] → [Rel=6.f] → [Rel=2.f]
(Cum=3.f)   (Cum=9.f)   (Cum=11.f)
     ↓           ↓           ↓
삽입 결과:
[Rel=3.f] → [Rel=2.f: New] → [Rel=2.f: New] → [Rel=3.f: New] → [Rel=2.f: New] → [Rel=2.f]
(Cum=3.f)   (Cum=5.f)        (Cum=7.f)        (Cum=10.f)       (Cum=13.f)       (Cum=15.f)
```

---

## 🎯 FTickTaskSequencer - 전역 Tick 스케줄러

### TaskGraph 통합

**📂 위치:** `TickTaskManager.h:649-940` (External/Foundation)

```cpp
class FTickTaskSequencer
{
public:
    /** Singleton 인스턴스 */
    static FTickTaskSequencer& Get()
    {
        static FTickTaskSequencer SingletonInstance;
        return SingletonInstance;
    }

    // ========== Tick Function을 TGraphTask로 변환 ==========

    void StartTickTask(
        const FGraphEventArray* Prerequisites,
        FTickFunction* TickFunction,
        const FTickContext& TickContext
    )
    {
        FTickContext UseContext = TickContext;
        bool bIsOriginalTickGroup = (TickFunction->InternalData->ActualStartTickGroup == TickFunction->TickGroup);

        // 병렬 실행 여부 결정
        if (TickFunction->bRunOnAnyThread && bIsOriginalTickGroup)
        {
            if (TickFunction->bHighPriority)
                UseContext.Thread = CPrio_HiPriAsyncTickTaskPriority.Get();
            else
                UseContext.Thread = CPrio_NormalAsyncTickTaskPriority.Get();
        }
        else
        {
            // 게임 스레드에서 실행
            UseContext.Thread = ENamedThreads::SetTaskPriority(
                ENamedThreads::GameThread,
                TickFunction->bHighPriority ? ENamedThreads::HighTaskPriority : ENamedThreads::NormalTaskPriority
            );
        }

        // TGraphTask 생성 (ConstructAndHold - 아직 실행 안 함)
        TickFunction->InternalData->TaskPointer = TGraphTask<FTickFunctionTask>::CreateTask(
            Prerequisites,
            TickContext.Thread
        ).ConstructAndHold(TickFunction, &UseContext, false, false);
    }

    // ========== Tick Group 별 Task 관리 ==========

    /** HiPri/Normal Task를 TickGroup별로 저장 */
    TArrayWithThreadsafeAdd<TGraphTask<FTickFunctionTask>*> HiPriTickTasks[TG_MAX][TG_MAX];
    TArrayWithThreadsafeAdd<TGraphTask<FTickFunctionTask>*> TickTasks[TG_MAX][TG_MAX];

    void AddTickTaskCompletion(
        ETickingGroup StartTickGroup,
        ETickingGroup EndTickGroup,
        TGraphTask<FTickFunctionTask>* Task,
        bool bHiPri
    )
    {
        if (bHiPri)
            HiPriTickTasks[StartTickGroup][EndTickGroup].Add(Task);
        else
            TickTasks[StartTickGroup][EndTickGroup].Add(Task);

        // Completion Event 캐시
        new (TickCompletionEvents[EndTickGroup]) FGraphEventRef(Task->GetCompletionEvent());
    }

    // ========== Tick Group 디스패치 (Unlock) ==========

    void DispatchTickGroup(ENamedThreads::Type CurrentThread, ETickingGroup WorldTickGroup)
    {
        // (1) HiPri Tasks 디스패치
        for (int32 IndexInner = 0; IndexInner < TG_MAX; IndexInner++)
        {
            TArray<TGraphTask<FTickFunctionTask>*>& TickArray = HiPriTickTasks[WorldTickGroup][IndexInner];
            if (IndexInner >= WorldTickGroup)
            {
                for (int32 Index = 0; Index < TickArray.Num(); ++Index)
                {
                    // Unlock → TaskGraph에서 실행 시작
                    TickArray[Index]->Unlock(CurrentThread);
                }
            }
            TickArray.Reset();
        }

        // (2) Normal Tasks 디스패치
        for (int32 IndexInner = 0; IndexInner < TG_MAX; IndexInner++)
        {
            TArray<TGraphTask<FTickFunctionTask>*>& TickArray = TickTasks[WorldTickGroup][IndexInner];
            if (IndexInner >= WorldTickGroup)
            {
                for (int32 Index = 0; Index < TickArray.Num(); Index++)
                {
                    TickArray[Index]->Unlock(CurrentThread);
                }
            }
            TickArray.Reset();
        }
    }

    // ========== Tick Group 대기 ==========

    void ReleaseTickGroup(ETickingGroup WorldTickGroup, bool bBlockTillComplete)
    {
        // 비동기 디스패치 또는 동기 디스패치
        if (CVarAllowAsyncTickDispatch.GetValueOnGameThread() == 0)
        {
            DispatchTickGroup(ENamedThreads::GameThread, WorldTickGroup);
        }
        else
        {
            FTaskGraphInterface::Get().WaitUntilTaskCompletes(
                TGraphTask<FDispatchTickGroupTask>::CreateTask(nullptr, ENamedThreads::GameThread)
                    .ConstructAndDispatchWhenReady(*this, WorldTickGroup)
            );
        }

        if (bBlockTillComplete)
        {
            // WaitForTickGroup부터 WorldTickGroup까지 모든 Tick 완료 대기
            for (ETickingGroup Block = WaitForTickGroup; Block <= WorldTickGroup; Block = ETickingGroup(Block + 1))
            {
                if (TickCompletionEvents[Block].Num())
                {
                    // TaskGraph에서 대기 (게임 스레드는 다른 Task 처리)
                    FTaskGraphInterface::Get().WaitUntilTasksComplete(
                        TickCompletionEvents[Block],
                        ENamedThreads::GameThread
                    );

                    // Completion Event 정리
                    if (Block == TG_NewlySpawned || TickCompletionEvents[Block].Num() < 50)
                        ResetTickGroup(Block);
                    else
                        CleanupTasks.Add(TGraphTask<FResetTickGroupTask>::CreateTask(...));
                }
            }

            WaitForTickGroup = ETickingGroup(WorldTickGroup + (WorldTickGroup == TG_NewlySpawned ? 0 : 1));
        }
        else
        {
            // 비블로킹: 현재 대기 중인 Task만 처리
            FTaskGraphInterface::Get().ProcessThreadUntilIdle(ENamedThreads::GameThread);
        }
    }

private:
    /** 각 TickGroup의 Completion Event */
    TArrayWithThreadsafeAdd<FGraphEventRef, TInlineAllocator<4>> TickCompletionEvents[TG_MAX];

    /** 프레임 끝에서 정리할 Task */
    FGraphEventArray CleanupTasks;

    /** 현재 대기 중인 TickGroup */
    ETickingGroup WaitForTickGroup;

    /** 새로운 Tick 추가 허용 여부 */
    bool bTickNewlySpawned;
};
```

**ConstructAndHold vs ConstructAndDispatchWhenReady:**
```
┌─────────────────────────┐
│      TaskQueue          │                          ┌───────────────┐
├─────────────────────────┤                       ┌──┤ TickFunction0 │
│                         │                       │  └───────────────┘   ┌───Prerequisite[1,]
│ ┌─────────────────────┐ │                       │                      │
│ │  TickFunction0      ◄─┼───┬────Dispatch────┬──┤  ┌───────────────┐   │   ┌───────────────┐
│ └─────────────────────┘ │   │                 │  └──┤ TickFunction1 ◄───┴───┤ TickFunction2 │
│                         │   │                 │     └───────────────┘       └───────────────┘
│ ┌─────────────────────┐ │   │                 │                             (아직 Queue에 안 들어감)
│ │  TickFunction1      ◄─┼───┘                 │
│ └─────────────────────┘ │                     │     ┌───────────────┐
│                         │                     │  ┌─┤ TickFunction3 │
│                       ◄─┼─────ConstructAndHold──┤  └───────────────┘
│                         │                        │
└─────────────────────────┘                        │  ┌───────────────┐
                                                   └─┤ TickFunction4 │
                                                      └───────────────┘
                                                      (Unlock 호출 전까지 대기)
```

---

## 🌐 FTickTaskManager - 최상위 관리자

### UWorld::Tick → FTickTaskManager 흐름

**📂 위치:** `TickTaskManager.h:942-1160` (External/Foundation)

```cpp
class FTickTaskManager : public FTickTaskManagerInterface
{
public:
    /** Singleton 인스턴스 */
    static FTickTaskManager& Get()
    {
        static FTickTaskManager SingletonInstance;
        return SingletonInstance;
    }

    /** Level별 TickTaskLevel 할당 */
    virtual FTickTaskLevel* AllocateTickTaskLevel() override
    {
        return new FTickTaskLevel;
    }

    /** 프레임 시작 */
    virtual void StartFrame(
        UWorld* InWorld,
        float InDeltaSeconds,
        ELevelTick InTickType,
        const TArray<ULevel*>& LevelsToTick
    ) override
    {
        // Tick Context 설정
        Context.TickGroup = ETickingGroup(0);  // TG_PrePhysics
        Context.DeltaSeconds = InDeltaSeconds;
        Context.TickType = InTickType;
        Context.Thread = ENamedThreads::GameThread;
        Context.World = InWorld;

        // Sequencer 초기화
        TickTaskSequencer.StartFrame();

        // Level 리스트 준비
        FillLevelList(LevelsToTick);

        // 각 Level의 StartFrame 호출
        int32 TotalTickFunctions = 0;
        for (int32 LevelIndex = 0; LevelIndex < LevelList.Num(); LevelIndex++)
        {
            TotalTickFunctions += LevelList[LevelIndex]->StartFrame(Context);
        }

        // 모든 Tick Function을 TaskGraph에 Queue
        for (int32 LevelIndex = 0; LevelIndex < LevelList.Num(); LevelIndex++)
        {
            LevelList[LevelIndex]->QueueAllTicks();
        }
    }

    /** Tick Group 실행 */
    virtual void RunTickGroup(ETickingGroup Group, bool bBlockTillComplete) override
    {
        // Tick 디스패치 및 대기
        TickTaskSequencer.ReleaseTickGroup(Group, bBlockTillComplete);

        // 다음 TickGroup으로 이동
        Context.TickGroup = ETickingGroup(Context.TickGroup + 1);
    }

    /** 프레임 종료 */
    void EndFrame() override
    {
        TickTaskSequencer.EndFrame();
        bTickNewlySpawned = false;

        for (int32 LevelIndex = 0; LevelIndex < LevelList.Num(); LevelIndex++)
        {
            LevelList[LevelIndex]->EndFrame();
        }

        Context.World = nullptr;
        LevelList.Reset();
    }

private:
    /** 전역 Sequencer */
    FTickTaskSequencer& TickTaskSequencer;

    /** 현재 프레임의 Level 리스트 */
    TArray<FTickTaskLevel*> LevelList;

    /** Tick Context */
    FTickContext Context;

    /** 새로운 Tick 추가 허용 여부 */
    bool bTickNewlySpawned;
};
```

**전체 Tick 흐름:**
```
UWorld::Tick(DeltaSeconds)
     │
     ↓
FTickTaskManager::StartFrame(DeltaSeconds, LevelsToTick)
     │
     ├─ TickTaskSequencer.StartFrame()
     │   └─ CleanupTasks 정리, TickCompletionEvents 초기화
     │
     ├─ FillLevelList(LevelsToTick)
     │   └─ World->TickTaskLevel, Level->TickTaskLevel 수집
     │
     ├─ For Each Level:
     │   └─ TickTaskLevel->StartFrame(Context)
     │       ├─ ScheduleTickFunctionCooldowns()
     │       │   └─ TickFunctionsToReschedule → AllCoolingDownTickFunctions
     │       │
     │       └─ Cooldown List에서 DeltaSeconds만큼 경과한 Tick을 Enabled로 변경
     │
     └─ For Each Level:
         └─ TickTaskLevel->QueueAllTicks()
             ├─ AllEnabledTickFunctions → TGraphTask (ConstructAndHold)
             └─ AllCoolingDownTickFunctions (Enabled 상태) → TGraphTask (ConstructAndHold)
     ↓
For Each TickGroup (TG_PrePhysics, TG_DuringPhysics, ...):
     │
     └─ FTickTaskManager::RunTickGroup(TickGroup, bBlockTillComplete)
         │
         ├─ TickTaskSequencer.ReleaseTickGroup(TickGroup, bBlockTillComplete)
         │   ├─ DispatchTickGroup(TickGroup) - Unlock all TGraphTasks
         │   │   ├─ HiPriTickTasks[TickGroup][*] → Unlock
         │   │   └─ TickTasks[TickGroup][*] → Unlock
         │   │
         │   └─ if (bBlockTillComplete):
         │       └─ WaitUntilTasksComplete(TickCompletionEvents[TickGroup])
         │
         └─ Context.TickGroup++
     ↓
FTickTaskManager::EndFrame()
     ├─ TickTaskSequencer.EndFrame()
     │   └─ ScheduleTickFunctionCooldowns() (최종 Reschedule)
     │
     └─ For Each Level:
         └─ TickTaskLevel->EndFrame()
```

**FTickTaskLevel::QueueAllTicks() 상세:**

**📂 위치:** `TickTaskManager.h:441-503` (External/Foundation)

```cpp
void FTickTaskLevel::QueueAllTicks()
{
    FTickTaskSequencer& TTS = FTickTaskSequencer::Get();

    // (1) AllEnabledTickFunctions 큐잉
    for (TSet<FTickFunction*>::Iterator It(AllEnabledTickFunctions); It; ++It)
    {
        FTickFunction* TickFunction = *It;

        // TGraphTask로 변환 및 큐잉
        TickFunction->QueueTickFunction(TTS, Context);

        // TickInterval이 있으면 Reschedule List에 추가
        if (TickFunction->TickInterval > 0.f)
        {
            It.RemoveCurrent();  // AllEnabledTickFunctions에서 제거
            RescheduleForInterval(TickFunction, TickFunction->TickInterval);
        }
    }

    // (2) Cooldown List에서 Enabled로 변경된 Tick 큐잉
    float CumulativeCooldown = 0.f;
    while (FTickFunction* TickFunction = AllCoolingDownTickFunctions.Head)
    {
        if (TickFunction->TickState == FTickFunction::ETickState::Enabled)
        {
            CumulativeCooldown += TickFunction->InternalData->RelativeTickCooldown;
            TickFunction->QueueTickFunction(TTS, Context);

            // 다음 Interval을 위해 Reschedule
            RescheduleForInterval(
                TickFunction,
                TickFunction->TickInterval - (Context.DeltaSeconds - CumulativeCooldown)
            );

            // Head 업데이트
            AllCoolingDownTickFunctions.Head = TickFunction->InternalData->Next;
        }
        else
        {
            break;  // CoolingDown 상태 만남 → 종료
        }
    }
}
```

---

## ⏱️ Tick Interval과 Cooldown 시스템

### Tick Interval 동작 원리

**📂 위치:** `TickTaskManager.h:432-438` (External/Foundation)

```cpp
void FTickTaskLevel::RescheduleForInterval(FTickFunction* TickFunction, float InInterval)
{
    // bWasInterval 플래그 설정
    TickFunction->InternalData->bWasInterval = true;

    // Reschedule List에 추가
    TickFunctionsToReschedule.Add(FTickScheduleDetails(TickFunction, InInterval));
}
```

**Tick Interval 전체 흐름:**
```
[Frame N]
Actor->PrimaryActorTick.TickInterval = 0.5f  // 0.5초마다 Tick

     ↓
AllEnabledTickFunctions: [ActorTick]
     │
     ↓ QueueAllTicks()
     │
     ├─ ActorTick->QueueTickFunction() - 이번 프레임 실행
     └─ RescheduleForInterval(ActorTick, 0.5f)
         └─ TickFunctionsToReschedule: [ActorTick: Cooldown=0.5f]

     ↓ EndFrame() 또는 StartFrame()
     │
     └─ ScheduleTickFunctionCooldowns()
         └─ AllCoolingDownTickFunctions: [ActorTick: Relative=0.5f]

[Frame N+1] DeltaTime=0.016f
     │
     ↓ StartFrame()
     │
     └─ Cumulative=0.016f < 0.5f
         → ActorTick는 CoolingDown 유지
         → ActorTick->InternalData->RelativeTickCooldown = 0.5f - 0.016f = 0.484f

[Frame N+2] DeltaTime=0.016f
     │
     ↓ StartFrame()
     │
     └─ Cumulative=0.032f < 0.5f
         → ActorTick는 CoolingDown 유지
         → ActorTick->InternalData->RelativeTickCooldown = 0.484f - 0.016f = 0.468f

     ... (반복)

[Frame N+31] DeltaTime=0.016f
     │
     ↓ StartFrame()
     │
     └─ Cumulative=0.496f < 0.5f
         → ActorTick는 CoolingDown 유지
         → ActorTick->InternalData->RelativeTickCooldown = 0.5f - 0.496f = 0.004f

[Frame N+32] DeltaTime=0.016f
     │
     ↓ StartFrame()
     │
     └─ Cumulative=0.004f + 0.016f = 0.020f >= 0.5f (초과!)
         → ActorTick->TickState = Enabled
         → Head 업데이트
         → ActorTick->InternalData->RelativeTickCooldown = 0.004f - (0.016f - 0.004f) = -0.012f
            (음수는 다음 Frame에서 즉시 Reschedule)

     ↓ QueueAllTicks()
     │
     ├─ ActorTick 다시 실행!
     └─ RescheduleForInterval(ActorTick, 0.5f - (-0.012f)) = 0.512f
         (남은 쿨다운 보정)
```

**성능 이점:**
- **CPU 절약**: 매 프레임 Tick하지 않아도 되는 Actor/Component
- **메모리 효율**: Relative Time으로 관리하여 업데이트 비용 최소화
- **정확도**: DeltaTime 오차 누적 방지 (LastTickGameTimeSeconds 저장)

---

## 🔗 Prerequisites - Tick 의존성

### AddPrerequisite()

**📂 위치:** `EngineBaseTypes.h:384-388`

```cpp
void FTickFunction::AddPrerequisite(UObject* TargetObject, struct FTickFunction& TargetTickFunction)
{
    Prerequisites.Add(FTickPrerequisite(TargetObject, TargetTickFunction));
}
```

**사용 예시:**
```cpp
// MyComponent는 MyActor가 Tick된 후에 Tick되어야 함
MyComponent->PrimaryComponentTick.AddPrerequisite(MyActor, MyActor->PrimaryActorTick);

// 실행 순서:
// 1. MyActor->Tick()
// 2. MyComponent->TickComponent()
```

**Prerequisites 다이어그램:**
```
PlayerController
     │ PrimaryActorTick
     ↓
┌────────────────┐
│ControllerTick  │
└────────┬───────┘
         │ AddPrerequisite
         ↓
     Pawn
      │ PrimaryActorTick
      ↓
 ┌────────────────┐
 │   PawnTick     │
 └────────┬───────┘
          │ AddPrerequisite
          ↓
     SkeletalMeshComponent
      │ PrimaryComponentTick
      ↓
 ┌──────────────────────┐
 │ SkeletalMeshTick     │
 └──────────────────────┘

실행 순서:
1. ControllerTick
2. PawnTick
3. SkeletalMeshTick
```

**AttachToComponent와 Tick 의존성:**

**📂 위치:** `SceneComponent.h:2562-2878` (Component.md 참조)

```cpp
bool USceneComponent::AttachToComponent(USceneComponent* Parent, ...)
{
    // ...

    // Tick 의존성 설정: 부모 Tick 후 자식 Tick
    PrimaryComponentTick.AddPrerequisite(Parent, Parent->PrimaryComponentTick);

    // ...
}
```

---

## 💡 실전 패턴

### 패턴 1: Tick 설정

```cpp
class AMyActor : public AActor
{
public:
    AMyActor()
    {
        // 기본 Tick 설정
        PrimaryActorTick.bCanEverTick = true;
        PrimaryActorTick.bStartWithTickEnabled = true;
        PrimaryActorTick.TickGroup = TG_PostPhysics;  // 물리 완료 후 Tick
        PrimaryActorTick.TickInterval = 0.0f;  // 매 프레임

        // 일시정지 시에도 Tick
        PrimaryActorTick.bTickEvenWhenPaused = false;

        // 병렬 실행 허용
        PrimaryActorTick.bRunOnAnyThread = false;  // 게임 스레드에서만

        // 우선순위
        PrimaryActorTick.bHighPriority = false;
    }
};
```

### 패턴 2: Tick Interval 활용

```cpp
class APatrolAI : public AActor
{
public:
    APatrolAI()
    {
        // AI는 0.2초마다 Tick (매 프레임 불필요)
        PrimaryActorTick.TickInterval = 0.2f;
    }

    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);

        // 경로 재계산
        RecalculatePath();

        // 다음 목표 지점 설정
        MoveToNextWaypoint();
    }
};
```

### 패턴 3: 동적 Tick 활성화/비활성화

```cpp
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // 처음에는 Tick 비활성화
    SetActorTickEnabled(false);
}

void AMyActor::OnPlayerNearby()
{
    // 플레이어가 가까워지면 Tick 활성화
    SetActorTickEnabled(true);
}

void AMyActor::OnPlayerFarAway()
{
    // 플레이어가 멀어지면 Tick 비활성화 (성능 최적화)
    SetActorTickEnabled(false);
}
```

### 패턴 4: 다중 TickGroup 활용

```cpp
class AComplexActor : public AActor
{
public:
    AComplexActor()
    {
        // Actor는 PrePhysics에서 시작
        PrimaryActorTick.TickGroup = TG_PrePhysics;
        // PostPhysics까지 완료 보장
        PrimaryActorTick.EndTickGroup = TG_PostPhysics;

        // Component는 PostPhysics에서 Tick
        MyComponent = CreateDefaultSubobject<UMyComponent>(TEXT("MyComponent"));
        MyComponent->PrimaryComponentTick.TickGroup = TG_PostPhysics;
    }

    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);

        // PrePhysics: 물리에 영향을 줄 입력 처리
        ApplyForces();
    }
};

void UMyComponent::TickComponent(float DeltaTime, ...)
{
    Super::TickComponent(DeltaTime, ...);

    // PostPhysics: 물리 결과 반영
    UpdateVisualPosition();
}
```

### 패턴 5: Prerequisites를 이용한 순서 보장

```cpp
class AWeaponActor : public AActor
{
public:
    void AttachToCharacter(ACharacter* Character)
    {
        // Character의 Mesh Component에 부착
        AttachToComponent(Character->GetMesh(), ...);

        // Tick 순서: Character → Weapon
        // (AttachToComponent에서 자동으로 설정됨)
    }

    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);

        // Character가 이미 Tick되었으므로 최신 위치 사용 가능
        FVector MuzzleLocation = GetMuzzleWorldLocation();
    }
};
```

### 패턴 6: 병렬 Tick

```cpp
class AParticleSimulationActor : public AActor
{
public:
    AParticleSimulationActor()
    {
        // 병렬 실행 허용 (Thread-Safe 보장 필요)
        PrimaryActorTick.bRunOnAnyThread = true;
        PrimaryActorTick.TickGroup = TG_DuringPhysics;  // 물리와 병렬 실행
    }

    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);

        // ⚠️ Thread-Safe 보장 필요
        // - 다른 Actor/Component에 접근 금지
        // - UObject 함수 호출 금지
        // - GC 가능 객체 접근 금지

        // 안전한 로컬 계산만 수행
        for (int32 i = 0; i < Particles.Num(); ++i)
        {
            Particles[i].Position += Particles[i].Velocity * DeltaTime;
            Particles[i].Velocity += Gravity * DeltaTime;
        }
    }
};
```

### 패턴 7: 수동 디스패치

```cpp
class AEventDrivenActor : public AActor
{
public:
    AEventDrivenActor()
    {
        // 자동 Tick 비활성화
        PrimaryActorTick.bCanEverTick = true;
        PrimaryActorTick.bStartWithTickEnabled = false;

        // 수동 디스패치 모드
        PrimaryActorTick.bDispatchManually = true;
    }

    void OnCustomEvent()
    {
        // 명시적으로 Tick 실행
        if (PrimaryActorTick.CanDispatchManually())
        {
            PrimaryActorTick.DispatchManually();
        }
    }
};
```

---

## 🏗️ Tick 실행 최적화

### 성능 측정

```cpp
// Tick 비용 측정
void AMyActor::Tick(float DeltaTime)
{
    SCOPE_CYCLE_COUNTER(STAT_MyActorTick);

    Super::Tick(DeltaTime);

    // Heavy work...
}

// Console: stat game
// → MyActorTick 시간 확인
```

### Tick 부하 줄이기

```cpp
class AOptimizedActor : public AActor
{
public:
    AOptimizedActor()
    {
        // 1. Tick Interval 사용
        PrimaryActorTick.TickInterval = 0.1f;  // 0.1초마다

        // 2. 필요 시에만 활성화
        PrimaryActorTick.bStartWithTickEnabled = false;
    }

    void OnBecameRelevant()
    {
        // 플레이어에게 보이거나 중요해질 때만 Tick
        SetActorTickEnabled(true);
    }

    void OnBecameIrrelevant()
    {
        // 플레이어에게서 멀거나 중요하지 않을 때 Tick 중지
        SetActorTickEnabled(false);
    }
};
```

### LOD 기반 Tick Interval

```cpp
class ALODBasedActor : public AActor
{
public:
    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);

        // 플레이어와의 거리에 따라 Tick Interval 조정
        float Distance = GetDistanceToPlayer();

        if (Distance < 1000.f)
        {
            // 가까움: 매 프레임
            PrimaryActorTick.TickInterval = 0.0f;
        }
        else if (Distance < 5000.f)
        {
            // 중간: 0.1초마다
            PrimaryActorTick.TickInterval = 0.1f;
        }
        else
        {
            // 멀리: 0.5초마다
            PrimaryActorTick.TickInterval = 0.5f;
        }
    }
};
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Tick Function](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Actors/Ticking/)
- Unreal Engine Docs: [Task Graph](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/Async/TaskGraphSystem/)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/Engine/EngineBaseTypes.h` - FTickFunction 선언
- `Engine/Source/Runtime/Engine/Private/TickTaskManager.cpp` - FTickTaskManager 구현
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h` - FActorTickFunction
- `Engine/Source/Runtime/Engine/Classes/Components/ActorComponent.h` - FActorComponentTickFunction
- `UnrealSummary/External/Foundation/TickTaskManager.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/World.md` - UWorld::Tick
- `UnrealSummary/GameFramework/Actor.md` - AActor::Tick
- `UnrealSummary/GameFramework/Component.md` - UActorComponent::TickComponent

---

> 🔄 Created: 2025-01-XX — Initial documentation for Tick System (FTickFunction, FTickTaskManager, Cooldown, Prerequisites) in UE 5.7
