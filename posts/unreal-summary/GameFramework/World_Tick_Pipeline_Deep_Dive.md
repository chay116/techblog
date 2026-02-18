---
title: "World Tick Pipeline Deep Dive"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# World Tick Pipeline Deep Dive

## 🧭 개요

**UWorld::Tick()**은 Unreal Engine의 모든 게임플레이 로직이 매 프레임마다 실행되는 핵심 파이프라인입니다. 이 시스템은 수천 개의 Actor와 Component를 효율적으로 업데이트하며, 물리 시뮬레이션, 렌더링, 네트워크 복제 등 모든 서브시스템과 동기화됩니다.

**핵심 책임:**
- **Tick Group 관리**: TG_PrePhysics → TG_DuringPhysics → TG_PostPhysics 순차 실행
- **FTickFunction 스케줄링**: Prerequisite 의존성 해석 및 병렬 실행
- **Physics Integration**: Chaos/PhysX와 동기화
- **Network Replication**: 서버 Actor 복제 및 RPC 전송
- **Subsystem Updates**: AI, Navigation, Audio, Rendering 등

**📂 위치:**
- `Engine/Source/Runtime/Engine/Private/LevelTick.cpp`
- `Engine/Source/Runtime/Engine/Private/TickTaskManager.cpp`
- `Engine/Source/Runtime/Engine/Classes/Engine/EngineBaseTypes.h`

---

## 🧱 Tick Pipeline 전체 다이어그램

### 매 프레임 실행 파이프라인 (60 FPS 기준 ~16.67ms)

```
════════════════════════════════════════════════════════════════════════════════
                          WORLD TICK PIPELINE - SINGLE FRAME
════════════════════════════════════════════════════════════════════════════════

게임 루프                UWorld                  TickTaskManager            Physics
   │                       │                            │                      │
   │ Tick(DeltaSeconds)    │                            │                      │
   ├──────────────────────>│                            │                      │
   │                       │ OnWorldTickStart Delegate  │                      │
   │                       │ (Performance Tracking)     │                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 1: PRE-TICK SETUP                                               │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ UpdateCameraManager()      │                      │
   │                       │ - PlayerController Camera  │                      │
   │                       │ - ViewTarget 업데이트       │                      │
   │                       │                            │                      │
   │                       │ UpdateStreamingState()     │                      │
   │                       │ - Level Streaming 체크     │                      │
   │                       │ - Visibility 업데이트      │                      │
   │                       │                            │                      │
   │                       │ TickNetDriver()            │                      │
   │                       │ - PacketHandler Incoming   │                      │
   │                       │ - ProcessRemoteFunction    │                      │
   │                       │ - ClientRPC 처리           │                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 2: TG_PrePhysics (물리 전 Tick)                                 │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ RunTickGroup(TG_PrePhysics)│                      │
   │                       ├───────────────────────────>│                      │
   │                       │                            │ StartFrame()         │
   │                       │                            │ - 모든 TickFunction 수집
   │                       │                            │ - Prerequisite 분석   │
   │                       │                            │ - TaskGraph 구성     │
   │                       │                            │                      │
   │                       │          ┌─────────────────┴──────────────┐       │
   │                       │          │  TG_PrePhysics Tick Functions  │       │
   │                       │          │  - AActor::Tick()              │       │
   │                       │          │  - UActorComponent::Tick()     │       │
   │                       │          │  - APlayerController::Tick()   │       │
   │                       │          │  - ACharacter::Tick()          │       │
   │                       │          │  - UCharacterMovementComp      │       │
   │                       │          │    → MoveComponent()           │       │
   │                       │          │    → Physics Impulse 적용       │       │
   │                       │          └────────────────────────────────┘       │
   │                       │                            │                      │
   │                       │                            │ ★ PARALLEL EXECUTION │
   │                       │                            │ - bRunOnAnyThread    │
   │                       │                            │ - TaskGraph로 병렬화  │
   │                       │                            │                      │
   │                       │                            │ EndFrame(TG_PrePhys) │
   │                       │                            │ - 모든 Tick 완료 대기 │
   │                       │<───────────────────────────┤                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 3: TG_StartPhysics (물리 시작)                                  │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ RunTickGroup(TG_StartPhysics)                     │
   │                       ├───────────────────────────────────────────────────>│
   │                       │                            │ StartAsync()         │
   │                       │                            │ - Chaos Solver 시작  │
   │                       │                            │ - Force/Impulse 적용 │
   │                       │                            │ - Constraint Solve   │
   │                       │                            │                      │
   │                       │                            │ ★ PHYSICS ASYNC TASK │
   │                       │                            │ (별도 스레드 실행)    │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 4: TG_DuringPhysics (물리 중 병렬 Tick)                         │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ RunTickGroup(TG_DuringPhysics)                    │
   │                       ├───────────────────────────>│                 (Physics
   │                       │                            │                  Solving...)
   │                       │          ┌─────────────────┴──────────────┐       │
   │                       │          │  TG_DuringPhysics Ticks        │       │
   │                       │          │  - AI 의사결정                  │       │
   │                       │          │  - Animation 업데이트           │       │
   │                       │          │  - Particle System Tick        │       │
   │                       │          │  - Audio Source Tick           │       │
   │                       │          │  (물리와 무관한 작업들 병렬 실행) │       │
   │                       │          └────────────────────────────────┘       │
   │                       │                            │                      │
   │                       │                            │ EndFrame(DuringPhys) │
   │                       │<───────────────────────────┤                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 5: TG_EndPhysics (물리 종료 대기)                               │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ RunTickGroup(TG_EndPhysics)│                      │
   │                       ├────────────────────────────┼─────────────────────>│
   │                       │                            │ WaitForPhysics()     │
   │                       │                            │<─────────────────────┤
   │                       │                            │ Physics 완료 이벤트   │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 6: TG_PostPhysics (물리 후 Tick)                                │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ RunTickGroup(TG_PostPhysics)                      │
   │                       ├───────────────────────────>│                      │
   │                       │                            │                      │
   │                       │          ┌─────────────────┴──────────────┐       │
   │                       │          │  TG_PostPhysics Ticks          │       │
   │                       │          │  - UPrimitiveComponent         │       │
   │                       │          │    → SyncComponentToRBPhysics()│       │
   │                       │          │    → 물리 결과를 Transform에 반영│       │
   │                       │          │  - Cloth Simulation Update     │       │
   │                       │          │  - Skeletal Mesh Update        │       │
   │                       │          │  - Ragdoll 업데이트             │       │
   │                       │          └────────────────────────────────┘       │
   │                       │                            │                      │
   │                       │                            │ EndFrame(PostPhys)   │
   │                       │<───────────────────────────┤                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 7: TG_PostUpdateWork (최종 업데이트)                            │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ RunTickGroup(TG_PostUpdateWork)                   │
   │                       ├───────────────────────────>│                      │
   │                       │                            │                      │
   │                       │          ┌─────────────────┴──────────────┐       │
   │                       │          │  TG_PostUpdateWork Ticks       │       │
   │                       │          │  - Camera Finalization         │       │
   │                       │          │  - Final Transform Updates     │       │
   │                       │          │  - Late Update Systems         │       │
   │                       │          └────────────────────────────────┘       │
   │                       │                            │                      │
   │                       │                            │ EndFrame(PostUpdate) │
   │                       │<───────────────────────────┤                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 8: TG_NewlySpawned (새로 생성된 Actor 처리)                     │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ ★ REPEAT UNTIL EMPTY        │                      │
   │                       │ - SpawnActor()로 생성된 Actor│                      │
   │                       │ - 이번 프레임에 BeginPlay된 Actor                  │
   │                       │ - 모든 TG 다시 순회         │                      │
   │                       │                            │                      │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │     PHASE 9: POST-TICK OPERATIONS                                        │
   ├═══════════════════════╪════════════════════════════╪══════════════════════╪═══
   │                       │                            │                      │
   │                       │ TickNetDriver(DeltaSeconds)│                      │
   │                       │ - ServerReplicateActors()  │                      │
   │                       │ - PreReplication()         │                      │
   │                       │ - IsNetRelevantFor()       │                      │
   │                       │ - GetNetPriority()         │                      │
   │                       │ - ReplicateActor()         │                      │
   │                       │ - SendBunch()              │                      │
   │                       │                            │                      │
   │                       │ UpdateLevelStreaming()     │                      │
   │                       │ - 스트리밍 볼륨 체크        │                      │
   │                       │ - 레벨 로드/언로드          │                      │
   │                       │                            │                      │
   │                       │ OnWorldTickEnd Delegate    │                      │
   │                       │ (Performance Logging)      │                      │
   │                       │                            │                      │
   │<──────────────────────┤                            │                      │
   │ (다음 프레임으로)       │                            │                      │
════════════════════════════════════════════════════════════════════════════════
```

---

## 📐 계층별 상세 분석

### 1. **ETickingGroup - Tick 그룹 정의**

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Engine/EngineBaseTypes.h:83`

**소스 검증:**
```cpp
// EngineBaseTypes.h:83
enum ETickingGroup : int
{
    /** Any item that needs to be executed before physics simulation starts. */
    TG_PrePhysics UMETA(DisplayName="Pre Physics"),

    /** Special tick group that starts physics simulation. */
    TG_StartPhysics UMETA(Hidden, DisplayName="Start Physics"),

    /** Any item that can be run in parallel with our physics simulation work. */
    TG_DuringPhysics UMETA(DisplayName="During Physics"),

    /** Special tick group that ends physics simulation. */
    TG_EndPhysics UMETA(Hidden, DisplayName="End Physics"),

    /** Any item that needs rigid body and cloth simulation to be complete before being executed. */
    TG_PostPhysics UMETA(DisplayName="Post Physics"),

    /** Any item that needs the update work to be done before being ticked. */
    TG_PostUpdateWork UMETA(DisplayName="Post Update Work"),

    /** Catchall for anything demoted to the end. */
    TG_LastDemotable UMETA(Hidden, DisplayName = "Last Demotable"),

    /**
     * Special tick group that is not actually a tick group.
     * After every tick group this is repeatedly re-run until there are no more newly spawned items to run.
     */
    TG_NewlySpawned UMETA(Hidden, DisplayName="Newly Spawned"),

    TG_MAX,
};
```

**Tick Group 실행 순서:**
```
프레임 시작
   │
   ├──> TG_PrePhysics        (Movement Input, AI 의사결정, Force 적용)
   │
   ├──> TG_StartPhysics      (Chaos Solver 시작 - Async)
   │         │
   │         ├──> TG_DuringPhysics  (물리 계산 중 병렬 실행 가능 작업)
   │         │
   │         └──> TG_EndPhysics     (물리 완료 대기)
   │
   ├──> TG_PostPhysics       (물리 결과 적용, Transform 동기화)
   │
   ├──> TG_PostUpdateWork    (Camera Finalization, Late Updates)
   │
   └──> TG_NewlySpawned      (새로 Spawn된 Actor Tick - 반복)
```

**각 TickGroup의 용도:**

| TickGroup | 용도 | 예시 |
|-----------|------|------|
| **TG_PrePhysics** | 물리 시뮬레이션 전 실행 | CharacterMovement, AI 의사결정, Input 처리 |
| **TG_StartPhysics** | 물리 엔진 시작 (내부 전용) | Chaos Solver 시작, Force/Impulse 적용 |
| **TG_DuringPhysics** | 물리와 병렬 실행 가능 | Animation, Particle, Audio, UI |
| **TG_EndPhysics** | 물리 완료 대기 (내부 전용) | Physics Task 동기화 |
| **TG_PostPhysics** | 물리 결과 적용 | RigidBody → Transform 동기화, Ragdoll |
| **TG_PostUpdateWork** | 최종 업데이트 | Camera Finalization, Post-Processing |

---

### 2. **FTickFunction - Tick 함수의 메타데이터**

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Engine/EngineBaseTypes.h:171`

**FTickFunction 구조:**
```cpp
// EngineBaseTypes.h:171
USTRUCT()
struct FTickFunction
{
    GENERATED_USTRUCT_BODY()

    /** Defines the minimum tick group for this tick function. */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    TEnumAsByte<enum ETickingGroup> TickGroup;

    /** Defines the tick group that this tick function must finish in. */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    TEnumAsByte<enum ETickingGroup> EndTickGroup;

    /** Bool indicating that this function should execute even if the game is paused. */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    uint8 bTickEvenWhenPaused:1;

    /** If false, this tick function will never be registered and will never tick. */
    UPROPERTY()
    uint8 bCanEverTick:1;

    /** If true, this tick function will start enabled, but can be disabled later on. */
    UPROPERTY(EditDefaultsOnly, Category="Tick")
    uint8 bStartWithTickEnabled:1;

    /** If we allow this tick to run on a dedicated server */
    UPROPERTY(EditDefaultsOnly, Category="Tick", AdvancedDisplay)
    uint8 bAllowTickOnDedicatedServer:1;

    /** True if we allow this tick to be combined with other ticks for improved performance */
    uint8 bAllowTickBatching:1;

    /** Run this tick first within the tick group (high priority) */
    uint8 bHighPriority:1;

    /**
     * If false, this tick will run on the game thread,
     * otherwise it will run on any thread in parallel with the game thread
     */
    uint8 bRunOnAnyThread:1;

    /** The frequency in seconds at which this tick function will be executed. */
    UPROPERTY(EditDefaultsOnly, Category="Tick", meta=(DisplayName="Tick Interval (secs)"))
    float TickInterval;

private:
    /** Prerequisites for this tick function **/
    TArray<struct FTickPrerequisite> Prerequisites;
};
```

**핵심 프로퍼티:**

| 프로퍼티 | 기본값 | 설명 |
|---------|--------|------|
| **TickGroup** | `TG_PrePhysics` | 이 Tick이 실행될 최소 그룹 |
| **EndTickGroup** | `TG_PrePhysics` | 이 Tick이 완료되어야 하는 그룹 |
| **bCanEverTick** | `false` | Tick 가능 여부 (AActor 기본값) |
| **bStartWithTickEnabled** | `true` | 시작 시 Tick 활성화 여부 |
| **bRunOnAnyThread** | `false` | 멀티스레드 병렬 실행 가능 여부 |
| **bHighPriority** | `false` | TickGroup 내 우선 실행 여부 |
| **bAllowTickBatching** | `true` | 배칭 최적화 허용 여부 |
| **TickInterval** | `0.0f` | Tick 간격 (0이면 매 프레임) |

---

### 3. **TickTaskManager - Tick 스케줄러**

**📂 위치:** `Engine/Source/Runtime/Engine/Private/TickTaskManager.cpp:198`

**FTickContext - Tick 실행 컨텍스트:**
```cpp
// TickTaskManager.cpp:198
struct FTickContext
{
    /** The world in which the object being ticked is contained */
    UWorld* World;

    /** Delta time to tick */
    float DeltaSeconds;

    /** Current or desired thread */
    ENamedThreads::Type Thread;

    /** Tick type such as gameplay */
    TEnumAsByte<ELevelTick> TickType;

    /** Tick group this was started in */
    TEnumAsByte<ETickingGroup> TickGroup;

    /** If true, log each tick */
    bool bLogTick;

    /** If true, log prereqs */
    bool bLogTicksShowPrerequistes;

    FTickContext(float InDeltaSeconds = 0.0f,
                 ELevelTick InTickType = LEVELTICK_All,
                 ETickingGroup InTickGroup = TG_PrePhysics,
                 ENamedThreads::Type InThread = ENamedThreads::GameThread)
        : World(nullptr)
        , DeltaSeconds(InDeltaSeconds)
        , Thread(InThread)
        , TickType(InTickType)
        , TickGroup(InTickGroup)
        , bLogTick(false)
        , bLogTicksShowPrerequistes(false)
    {
    }
};
```

**FTickFunctionTask - 단일 Tick 작업:**
```cpp
// TickTaskManager.cpp:280
class FTickFunctionTask
{
    /** Functions to tick */
    FTickFunction* Target;

    /** Tick context with the desired execution thread */
    FTickContext Context;

public:
    FORCEINLINE FTickFunctionTask(FTickFunction* InTarget, const FTickContext* InContext)
        : Target(InTarget)
        , Context(*InContext)
    {
    }

    /** Return the desired execution thread for this task */
    FORCEINLINE ENamedThreads::Type GetDesiredThread()
    {
        // bRunOnAnyThread이면 AnyThread, 아니면 GameThread
        return (Target->bRunOnAnyThread)
            ? ENamedThreads::AnyThread
            : ENamedThreads::GameThread;
    }

    /** Execute the tick function */
    void DoTask(ENamedThreads::Type CurrentThread, const FGraphEventRef& MyCompletionGraphEvent)
    {
        // 실제 Tick 실행
        Target->ExecuteTick(Context.DeltaSeconds, Context.TickType,
                           CurrentThread, MyCompletionGraphEvent);
    }
};
```

---

### 4. **UWorld::Tick() - 메인 Tick 루프**

**📂 위치:** `Engine/Source/Runtime/Engine/Private/LevelTick.cpp:1477`

**소스 검증:**
```cpp
// LevelTick.cpp:1477
void UWorld::Tick( ELevelTick TickType, float DeltaSeconds )
{
    SCOPE_TIME_GUARD(TEXT("UWorld::Tick"));
    SCOPED_NAMED_EVENT(UWorld_Tick, FColor::Orange);
    CSV_SCOPED_TIMING_STAT_EXCLUSIVE(WorldTickMisc);

    if (GIntraFrameDebuggingGameThread)
    {
        return;
    }

    UE::Stats::FThreadIdleStats::BeginCriticalPath();
    RHI_BREADCRUMB_EVENT_GAMETHREAD("WorldTick");

    FWorldDelegates::OnWorldTickStart.Broadcast(this, TickType, DeltaSeconds);

    // 1. Camera Manager 업데이트
    {
        SCOPE_CYCLE_COUNTER(STAT_UpdateCameraTime);
        for (FConstPlayerControllerIterator Iterator = GetPlayerControllerIterator();
             Iterator; ++Iterator)
        {
            if (APlayerController* PlayerController = Iterator->Get())
            {
                PlayerController->UpdateCameraManager(DeltaSeconds);
            }
        }
    }

    // 2. Level Streaming 업데이트
    if (bIsLevelStreamingFrozen == false)
    {
        UpdateStreamingState();
    }

    // 3. Network Driver (Incoming Packets)
    if (NetDriver && NetDriver->ServerConnection)
    {
        TickNetDriver(DeltaSeconds);
    }

    // 4. ★ TICK ALL GROUPS (핵심 Tick 파이프라인)
    {
        SCOPE_CYCLE_COUNTER(STAT_TickTime);

        // TG_PrePhysics부터 TG_PostUpdateWork까지 순차 실행
        for (int32 TickGroup = TG_PrePhysics; TickGroup < TG_MAX; ++TickGroup)
        {
            RunTickGroup(static_cast<ETickingGroup>(TickGroup));
        }
    }

    // 5. Network Replication (Outgoing)
    if (NetDriver)
    {
        SCOPE_CYCLE_COUNTER(STAT_NetBroadcastTickTime);
        BroadcastTickFlush(DeltaSeconds); // Server → Client 복제
    }

    // 6. Post-Tick Operations
    {
        // Async Trace 완료
        SCOPE_CYCLE_COUNTER(STAT_FinishAsyncTraceTickTime);
        FinishAsyncTrace();

        // Navigation System Update
        if (NavigationSystem)
        {
            SCOPE_CYCLE_COUNTER(STAT_NavWorldTickTime);
            NavigationSystem->Tick(DeltaSeconds);
        }

        // Tickable Objects (UTickableWorldSubsystem 등)
        SCOPE_CYCLE_COUNTER(STAT_TickableTickTime);
        FTickableGameObject::TickObjects(this, TickType, DeltaSeconds);
    }

    FWorldDelegates::OnWorldTickEnd.Broadcast(this, TickType, DeltaSeconds);
}
```

**주요 단계 요약:**
1. **Camera Update** - PlayerController 카메라 업데이트
2. **Level Streaming** - 동적 레벨 로드/언로드 체크
3. **Network Incoming** - RPC 및 Replication 수신 처리
4. **Tick All Groups** - TG_PrePhysics ~ TG_PostUpdateWork 순차 실행
5. **Network Outgoing** - ServerReplicateActors() 실행
6. **Subsystems** - Navigation, Audio, Tickable Objects

---

### 5. **RunTickGroup() - 단일 TickGroup 실행**

**의사 코드 (실제 구현은 TickTaskManager.cpp):**
```cpp
void UWorld::RunTickGroup(ETickingGroup TickGroup)
{
    FTickTaskLevel* TickTaskLevel = GetTickTaskLevel();

    // 1. StartFrame - TickFunction 수집 및 TaskGraph 구성
    TickTaskLevel->StartFrame(this, DeltaSeconds, TickGroup);

    // 2. TickFunction 실행 (병렬 또는 순차)
    //    - Prerequisites 해석
    //    - bRunOnAnyThread에 따라 TaskGraph에 Dispatch
    //    - bHighPriority 우선 실행
    TickTaskLevel->RunTickGroup(TickGroup, /* bBlockTillComplete */ true);

    // 3. EndFrame - 모든 Tick 완료 대기
    TickTaskLevel->EndFrame();
}
```

**StartFrame() - Tick 준비:**
```cpp
void FTickTaskLevel::StartFrame(UWorld* World, float InDeltaSeconds, ETickingGroup InTickGroup)
{
    // 1. 이번 프레임 카운터 증가
    GFrameCounter++;

    // 2. 모든 TickFunction 수집
    TArray<FTickFunction*> AllTickFunctions;
    for (FTickFunction& TickFunc : TickFunctions[InTickGroup])
    {
        if (TickFunc.IsTickFunctionEnabled())
        {
            AllTickFunctions.Add(&TickFunc);
        }
    }

    // 3. Prerequisite 의존성 해석
    //    - AddPrerequisite()로 설정된 의존성 분석
    //    - DAG (Directed Acyclic Graph) 구성
    for (FTickFunction* TickFunc : AllTickFunctions)
    {
        for (FTickPrerequisite& Prereq : TickFunc->Prerequisites)
        {
            FTickFunction* PrereqFunc = Prereq.Get();
            if (PrereqFunc && PrereqFunc->IsTickFunctionRegistered())
            {
                // TaskGraph에 Dependency 등록
                AddDependency(TickFunc, PrereqFunc);
            }
        }
    }

    // 4. TaskGraph 최적화
    //    - bRunOnAnyThread인 Tick들 병렬화
    //    - bHighPriority Tick 우선 배치
    OptimizeTaskGraph();
}
```

---

## 🔄 Prerequisite 시스템 (의존성 관리)

### Prerequisite란?

**Prerequisite**는 "이 TickFunction이 실행되기 전에 반드시 완료되어야 하는 다른 TickFunction"을 지정하는 시스템입니다.

**사용 예시:**
```cpp
// ACharacter::PostInitializeComponents()
void ACharacter::PostInitializeComponents()
{
    Super::PostInitializeComponents();

    if (CharacterMovement && Mesh)
    {
        // CharacterMovement는 Mesh Tick 후에 실행되어야 함
        CharacterMovement->PrimaryComponentTick.AddPrerequisite(
            Mesh,
            Mesh->PrimaryComponentTick
        );
    }
}
```

### Prerequisite 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                    TG_PrePhysics TickGroup                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐                                           │
│  │SkeletalMesh  │ (Animation Tick)                          │
│  │  Tick()      │                                           │
│  └──────┬───────┘                                           │
│         │ Prerequisite                                      │
│         │ (AddPrerequisite)                                 │
│         ▼                                                   │
│  ┌──────────────────────┐                                   │
│  │CharacterMovementComp │                                   │
│  │  Tick()              │                                   │
│  │  - Animation 완료 후  │                                   │
│  │  - Bone Transform 읽기│                                   │
│  └──────────────────────┘                                   │
│                                                             │
│  실행 순서: SkeletalMesh → CharacterMovement                 │
│  (TaskGraph가 자동으로 순서 보장)                             │
└─────────────────────────────────────────────────────────────┘
```

**실제 소스 코드 (FTickFunction::AddPrerequisite):**
```cpp
// EngineBaseTypes.h:388
void FTickFunction::AddPrerequisite(UObject* TargetObject, struct FTickFunction& TargetTickFunction)
{
    // 중복 체크
    FTickPrerequisite NewPrereq(TargetObject, TargetTickFunction);
    if (!Prerequisites.Contains(NewPrereq))
    {
        Prerequisites.Add(NewPrereq);
    }
}
```

---

## ⚡ 병렬 Tick 최적화 (bRunOnAnyThread)

### 멀티스레드 Tick 실행

**bRunOnAnyThread = true**로 설정하면 GameThread가 아닌 Worker Thread에서 Tick 실행 가능:

```cpp
UCLASS()
class UMyParallelComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UMyParallelComponent()
    {
        PrimaryComponentTick.bCanEverTick = true;
        PrimaryComponentTick.bRunOnAnyThread = true;  // ★ 병렬 실행 활성화
        PrimaryComponentTick.TickGroup = TG_DuringPhysics; // 물리 중 병렬 실행
    }

    virtual void TickComponent(float DeltaTime,
                                ELevelTick TickType,
                                FActorComponentTickFunction* ThisTickFunction) override
    {
        Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

        // ★ 이 코드는 AnyThread에서 실행될 수 있음
        // - GameThread 전용 API 호출 금지!
        // - UObject 접근 시 thread-safe 보장 필요

        // 안전한 작업:
        // - 수학 계산 (FVector, FMatrix 등)
        // - 순수 알고리즘 (A*, Pathfinding)
        // - Read-Only UObject 프로퍼티 읽기

        // ❌ 금지된 작업:
        // - SpawnActor(), DestroyActor()
        // - AddComponent(), RemoveComponent()
        // - GetWorld()->LineTraceSingle() (일부 함수)
    }
};
```

### 병렬 실행 제약사항

**Thread-Safe 작업:**
- ✅ FVector, FMatrix, FQuat 등 수학 연산
- ✅ TArray, TMap 등 자체 Container 조작 (다른 Thread와 공유 안 할 경우)
- ✅ 순수 알고리즘 (A*, 경로 탐색, AI 계산)
- ✅ Read-Only로 UObject 프로퍼티 읽기 (const 접근)

**Thread-Unsafe 작업 (금지):**
- ❌ SpawnActor, DestroyComponent, AddComponent
- ❌ UWorld::LineTrace* (일부 버전)
- ❌ GEngine->AddOnScreenDebugMessage()
- ❌ UObject::Modify() (트랜잭션)
- ❌ 다른 Actor/Component의 Transform 수정

**안전한 병렬 Tick 패턴:**
```cpp
void UMyParallelComponent::TickComponent(float DeltaTime, ...)
{
    // 1. Read-Only 작업 (병렬 실행)
    FVector CurrentLocation = GetOwner()->GetActorLocation();
    FVector TargetLocation = CalculateTargetLocation(CurrentLocation);

    // 2. GameThread 작업은 Delegate로 지연 실행
    AsyncTask(ENamedThreads::GameThread, [this, TargetLocation]()
    {
        // GameThread에서만 실행
        GetOwner()->SetActorLocation(TargetLocation);
    });
}
```

---

## 🎯 실전 예시

### 1. Custom TickGroup 설정

```cpp
UCLASS()
class AMyPhysicsActor : public AActor
{
    GENERATED_BODY()

public:
    AMyPhysicsActor()
    {
        PrimaryActorTick.bCanEverTick = true;
        PrimaryActorTick.TickGroup = TG_PostPhysics;  // 물리 후 Tick
        PrimaryActorTick.bHighPriority = false;
    }

    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);

        // 물리 시뮬레이션 완료 후 실행
        // - RigidBody 위치를 읽어서 추가 로직 수행
        if (UPrimitiveComponent* Primitive = Cast<UPrimitiveComponent>(RootComponent))
        {
            FVector PhysicsLocation = Primitive->GetComponentLocation();
            // PhysicsLocation은 이미 물리 엔진이 업데이트한 값
        }
    }
};
```

---

### 2. Tick Interval (간격 조절)

```cpp
UCLASS()
class USlowTickComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    USlowTickComponent()
    {
        PrimaryComponentTick.bCanEverTick = true;
        PrimaryComponentTick.TickInterval = 0.5f;  // 0.5초마다 Tick (2Hz)
    }

    virtual void TickComponent(float DeltaTime, ...) override
    {
        Super::TickComponent(DeltaTime, ...);

        // 0.5초마다 실행
        // DeltaTime은 0.5초 누적 값
        UE_LOG(LogTemp, Log, TEXT("Tick! DeltaTime: %f"), DeltaTime);
    }
};
```

**TickInterval 동작:**
- `TickInterval = 0.0f` - 매 프레임 Tick (기본값)
- `TickInterval = 0.5f` - 0.5초마다 Tick (2 FPS)
- `TickInterval = 1.0f` - 1초마다 Tick (1 FPS)
- 내부적으로 Cooldown List에서 관리

---

### 3. Prerequisite로 의존성 설정

```cpp
UCLASS()
class AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    UPROPERTY(VisibleAnywhere)
    class UMyWeaponComponent* WeaponComponent;

    AMyCharacter()
    {
        WeaponComponent = CreateDefaultSubobject<UMyWeaponComponent>(TEXT("Weapon"));
    }

    virtual void PostInitializeComponents() override
    {
        Super::PostInitializeComponents();

        if (WeaponComponent && GetCharacterMovement())
        {
            // WeaponComponent는 CharacterMovement 후에 Tick
            WeaponComponent->PrimaryComponentTick.AddPrerequisite(
                GetCharacterMovement(),
                GetCharacterMovement()->PrimaryComponentTick
            );
        }
    }
};

UCLASS()
class UMyWeaponComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UMyWeaponComponent()
    {
        PrimaryComponentTick.bCanEverTick = true;
        PrimaryComponentTick.TickGroup = TG_PrePhysics;
    }

    virtual void TickComponent(float DeltaTime, ...) override
    {
        Super::TickComponent(DeltaTime, ...);

        // CharacterMovement Tick 완료 후 실행 보장
        // - 최신 Velocity, Location 사용 가능
        ACharacter* Owner = Cast<ACharacter>(GetOwner());
        if (Owner && Owner->GetCharacterMovement())
        {
            FVector CurrentVelocity = Owner->GetCharacterMovement()->Velocity;
            // 무기 애니메이션을 Velocity에 맞춰 조정
        }
    }
};
```

---

### 4. 조건부 Tick 활성화/비활성화

```cpp
UCLASS()
class UConditionalTickComponent : public UActorComponent
{
    GENERATED_BODY()

private:
    bool bIsActive = false;

public:
    UConditionalTickComponent()
    {
        PrimaryComponentTick.bCanEverTick = true;
        PrimaryComponentTick.bStartWithTickEnabled = false; // 시작 시 비활성화
    }

    void Activate()
    {
        if (!bIsActive)
        {
            bIsActive = true;
            SetComponentTickEnabled(true); // Tick 활성화
            UE_LOG(LogTemp, Log, TEXT("Component Activated"));
        }
    }

    void Deactivate()
    {
        if (bIsActive)
        {
            bIsActive = false;
            SetComponentTickEnabled(false); // Tick 비활성화
            UE_LOG(LogTemp, Log, TEXT("Component Deactivated"));
        }
    }

    virtual void TickComponent(float DeltaTime, ...) override
    {
        Super::TickComponent(DeltaTime, ...);

        // 활성화되었을 때만 실행
        UE_LOG(LogTemp, Log, TEXT("Ticking..."));
    }
};
```

**사용 시나리오:**
- 멀리 있는 Actor는 Tick 비활성화 (최적화)
- 일시 정지 시 특정 Component만 Tick 중단
- 필요할 때만 Tick 활성화 (이벤트 기반)

---

## 💡 일반적인 함정 및 해결 방법

### ❌ 함정 1: TG_DuringPhysics에서 Transform 읽기

**문제:**
```cpp
// TG_DuringPhysics Tick
void UMyComponent::TickComponent(float DeltaTime, ...)
{
    // ❌ 물리 시뮬레이션이 아직 완료되지 않음!
    FVector Location = GetOwner()->GetActorLocation();
    // Location은 이전 프레임 값 또는 부분 업데이트 값
}
```

**✅ 해결 방법:**
```cpp
// TG_PostPhysics로 변경
UMyComponent::UMyComponent()
{
    PrimaryComponentTick.TickGroup = TG_PostPhysics; // 물리 완료 후
}

void UMyComponent::TickComponent(float DeltaTime, ...)
{
    // ✅ 물리 시뮬레이션 완료된 최신 값
    FVector Location = GetOwner()->GetActorLocation();
}
```

---

### ❌ 함정 2: bRunOnAnyThread에서 UObject 수정

**문제:**
```cpp
void UMyParallelComponent::TickComponent(float DeltaTime, ...)
{
    // ❌ AnyThread에서 Actor Transform 수정 → Crash!
    GetOwner()->SetActorLocation(NewLocation);
}
```

**✅ 해결 방법:**
```cpp
void UMyParallelComponent::TickComponent(float DeltaTime, ...)
{
    // 1. AnyThread에서 계산
    FVector NewLocation = CalculateNewLocation();

    // 2. GameThread로 Dispatch
    AsyncTask(ENamedThreads::GameThread, [this, NewLocation]()
    {
        // GameThread에서 안전하게 수정
        GetOwner()->SetActorLocation(NewLocation);
    });
}
```

---

### ❌ 함정 3: Prerequisite 순환 의존성

**문제:**
```cpp
// Component A
A->PrimaryComponentTick.AddPrerequisite(B, B->PrimaryComponentTick);

// Component B
B->PrimaryComponentTick.AddPrerequisite(A, A->PrimaryComponentTick);

// ❌ A는 B를 기다리고, B는 A를 기다림 → Deadlock!
```

**✅ 해결 방법:**
```cpp
// 명확한 의존성 계층 설정
// A → B (A가 먼저 실행, B가 나중)
A->PrimaryComponentTick.AddPrerequisite(C, C->PrimaryComponentTick);
B->PrimaryComponentTick.AddPrerequisite(A, A->PrimaryComponentTick);

// 실행 순서: C → A → B (순환 없음)
```

---

### ❌ 함정 4: Tick 비용 과다 (성능 저하)

**문제:**
```cpp
void AMyActor::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    // ❌ 매 프레임 무거운 연산
    TArray<AActor*> AllActors;
    UGameplayStatics::GetAllActorsOfClass(GetWorld(), AActor::StaticClass(), AllActors);
    // 수천 개 Actor 순회 → 프레임 드롭
}
```

**✅ 해결 방법:**
```cpp
// 방법 1: TickInterval 사용
UMyActor::UMyActor()
{
    PrimaryActorTick.TickInterval = 0.2f; // 0.2초마다 (5Hz)
}

// 방법 2: 조건부 Tick
void AMyActor::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    // 플레이어가 가까울 때만 연산
    if (FVector::Dist(GetActorLocation(), PlayerLocation) < 1000.0f)
    {
        // 무거운 연산
    }
}

// 방법 3: Tick 비활성화 + Timer 사용
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    SetActorTickEnabled(false); // Tick 비활성화

    // Timer로 필요할 때만 실행
    GetWorldTimerManager().SetTimer(TimerHandle, this,
        &AMyActor::DoHeavyWork, 1.0f, true); // 1초마다
}

void AMyActor::DoHeavyWork()
{
    // 무거운 작업
}
```

---

## 🔧 디버깅 팁

### 1. Tick 로깅 활성화

```
# 콘솔 명령어
tick.LogTicks 1              # 모든 Tick 로그 출력
tick.ShowPrerequistes 1      # Prerequisite 의존성 표시
```

**출력 예시:**
```
LogTick: [TG_PrePhysics] MyActor::Tick (DeltaTime: 0.0167)
LogTick:   Prerequisites: SkeletalMeshComponent::Tick
LogTick: [TG_PostPhysics] MyComponent::Tick (DeltaTime: 0.0167)
```

---

### 2. stat 명령어로 성능 측정

```
# 콘솔 명령어
stat game                   # Tick 그룹별 시간 표시
stat scenerendering         # 렌더링 통계
stat unitgraph              # Frame/Game/Render/GPU Time 그래프
```

**stat game 출력:**
```
Ticks:
  TG_PrePhysics:   2.5 ms
  TG_DuringPhysics: 1.2 ms
  TG_PostPhysics:  3.1 ms
  TG_PostUpdateWork: 0.8 ms
Total Tick Time:  7.6 ms
```

---

### 3. Visual Logger로 Tick 추적

```cpp
void UMyComponent::TickComponent(float DeltaTime, ...)
{
    Super::TickComponent(DeltaTime, ...);

#if ENABLE_VISUAL_LOG
    UE_VLOG(GetOwner(), LogTemp, Log, TEXT("Tick: DeltaTime=%f, TickGroup=%d"),
            DeltaTime, (int32)PrimaryComponentTick.TickGroup);

    // 위치 시각화
    UE_VLOG_LOCATION(GetOwner(), LogTemp, Log, GetOwner()->GetActorLocation(),
                     50.f, FColor::Green, TEXT("Tick Location"));
#endif
}
```

---

## 📊 성능 최적화 체크리스트

### ✅ Tick 최적화

- [ ] **불필요한 Tick 비활성화**
  ```cpp
  PrimaryActorTick.bCanEverTick = false; // Tick이 필요 없는 경우
  ```

- [ ] **TickInterval 사용**
  ```cpp
  PrimaryActorTick.TickInterval = 0.1f; // 10Hz로 제한
  ```

- [ ] **조건부 Tick**
  ```cpp
  if (FVector::Dist(ActorLocation, PlayerLocation) > 5000.0f)
  {
      SetActorTickEnabled(false); // 멀리 있으면 Tick 중단
  }
  ```

- [ ] **적절한 TickGroup 배치**
  - 물리 필요: `TG_PrePhysics`
  - 물리 무관: `TG_DuringPhysics` (병렬 실행)
  - 물리 결과 사용: `TG_PostPhysics`

### ✅ 병렬화

- [ ] **bRunOnAnyThread 활성화**
  ```cpp
  PrimaryComponentTick.bRunOnAnyThread = true; // 병렬 실행
  ```

- [ ] **Thread-Safe 작업만 수행**
  - 수학 연산, AI 계산 등
  - GameThread 작업은 AsyncTask로 Dispatch

### ✅ 프로파일링

- [ ] **Unreal Insights 사용**
  ```
  UnrealInsights.exe
  ```

- [ ] **stat 명령어 활용**
  ```
  stat game
  stat unit
  ```

- [ ] **Heavy Tick 함수 식별**
  ```
  stat slow                # 느린 Tick 함수 표시
  stat dumpframe          # 상세 프레임 분석
  ```

---

## 🔗 참조 자료

- [Official Unreal Engine Actor Ticking](https://docs.unrealengine.com/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Actors/Ticking)
- [TickFunction Documentation](https://docs.unrealengine.com/API/Runtime/Engine/Engine/FTickFunction)
- [Multithreading and Performance](https://docs.unrealengine.com/ProductionPipelines/DevelopmentSetup/Tools/ConsoleManager)

**소스 파일:**
- `Engine/Source/Runtime/Engine/Private/LevelTick.cpp`
- `Engine/Source/Runtime/Engine/Private/TickTaskManager.cpp`
- `Engine/Source/Runtime/Engine/Classes/Engine/EngineBaseTypes.h`
- `Engine/Source/Runtime/Engine/Private/World.cpp`

---

> 🔄 Created: 2025-01-XX — World Tick Pipeline Deep Dive 초안 작성
