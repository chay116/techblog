---
title: "Actor 생명주기 및 Replication Deep Dive"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# Actor 생명주기 및 Replication Deep Dive

## 🧭 개요

**AActor**는 Unreal Engine의 모든 게임 오브젝트의 기본 클래스입니다. Actor는 복잡한 생명주기(Lifecycle)와 네트워크 복제(Replication) 시스템을 가지고 있으며, 이를 이해하는 것은 멀티플레이어 게임 개발에 필수적입니다.

**핵심 책임:**
- **Spawn & Initialization**: 다단계 초기화 프로세스 (Construction → Registration → PostInit → BeginPlay)
- **Tick**: 매 프레임 업데이트 (`PrimaryActorTick`)
- **Network Replication**: 서버에서 클라이언트로 상태 전송
- **Component Management**: ActorComponent들의 생명주기 관리
- **Cleanup**: EndPlay → Destroy → 가비지 컬렉션

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h`
**📂 구현:** `Engine/Source/Runtime/Engine/Private/Actor.cpp`

---

## 🧱 Actor 생명주기 전체 다이어그램

### 전체 프로세스 (SpawnActor → BeginPlay → Tick → Destroy)

```
════════════════════════════════════════════════════════════════════════════════
                          ACTOR LIFECYCLE - FULL PIPELINE
════════════════════════════════════════════════════════════════════════════════

게임 코드                     UWorld                AActor              UActorComponent
   │                            │                      │                      │
   │ SpawnActor<T>()            │                      │                      │
   ├───────────────────────────>│                      │                      │
   │                            │  AActor 생성자       │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ InitializeDefaults() │
   │                            │                      │ - bReplicates=false  │
   │                            │                      │ - Role=ROLE_Authority│
   │                            │                      │ - NetUpdateFreq=100  │
   │                            │<─────────────────────┤                      │
   │                            │                      │                      │
   │                            │ PostActorCreated()   │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │                      │
   │                            │ ┌─────────────────────────────────────────┐ │
   │                            │ │ USER CONSTRUCTION SCRIPT                │ │
   │                            │ │ - Blueprint의 Construction Script 실행  │ │
   │                            │ │ - bRunningUserConstructionScript = true │ │
   │                            │ └─────────────────────────────────────────┘ │
   │                            │                      │                      │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │     PHASE 1: COMPONENT REGISTRATION                                     │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │                            │                      │                      │
   │                            │ PreRegisterAllComponents()                  │
   │                            ├─────────────────────>│                      │
   │                            │                      │ bHasPreRegisteredAllComponents=true
   │                            │                      │                      │
   │                            │ RegisterComponent()  │                      │
   │                            ├──────────────────────┼─────────────────────>│
   │                            │                      │ OnComponentCreated() │
   │                            │                      │ (네이티브 컴포넌트용) │
   │                            │                      │ RegisterComponent()  │
   │                            │                      │ - 물리 표현 생성      │
   │                            │                      │ - 렌더링 등록         │
   │                            │                      │ - PhysX/Chaos 등록    │
   │                            │                      │                      │
   │                            │ PostRegisterAllComponents()                 │
   │                            ├─────────────────────>│                      │
   │                            │                      │ bHasRegisteredAllComponents=true
   │                            │                      │                      │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │     PHASE 2: INITIALIZATION                                             │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │                            │                      │                      │
   │                            │ PreInitializeComponents()                   │
   │                            ├─────────────────────>│                      │
   │                            │                      │                      │
   │                            │ InitializeComponent()│                      │
   │                            ├──────────────────────┼─────────────────────>│
   │                            │                      │ (bWantsInitializeComponent일 때만)
   │                            │                      │ Activate()           │
   │                            │                      │ (bAutoActivate일 때)  │
   │                            │                      │                      │
   │                            │ PostInitializeComponents()                  │
   │                            ├─────────────────────>│                      │
   │                            │                      │ bActorInitialized=true
   │                            │                      │                      │
   │                            │ FinishSpawning()     │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ bHasFinishedSpawning=true
   │                            │                      │                      │
   │                            │ ★ NETWORKING SETUP   │                      │
   │                            │   (서버일 경우)       │                      │
   │                            │   - NetDriver 등록    │                      │
   │                            │   - ActorChannel 생성 │                      │
   │                            │                      │                      │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │     PHASE 3: BEGIN PLAY                                                 │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │                            │                      │                      │
   │                            │ DispatchBeginPlay()  │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ ActorHasBegunPlay=BeginningPlay
   │                            │                      │                      │
   │                            │ BeginPlay()          │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ SetLifeSpan(InitialLifeSpan)
   │                            │                      │ RegisterAllActorTickFunctions()
   │                            │                      │                      │
   │                            │                      │ BeginPlay()          │
   │                            │                      ├─────────────────────>│
   │                            │                      │                      │
   │                            │ ReceiveBeginPlay()   │                      │
   │                            │ (Blueprint Event)    │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ ActorHasBegunPlay=HasBegunPlay
   │                            │                      │                      │
   │                            │ TRACE_OBJECT_LIFETIME_BEGIN()               │
   │                            │                      │                      │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │     PHASE 4: TICK (EVERY FRAME)                                         │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │                            │                      │                      │
   │                      ┌─────▼─────────┐            │                      │
   │                      │  Tick Manager │            │                      │
   │                      │  - TG_PrePhysics           │                      │
   │                      │  - TG_DuringPhysics        │                      │
   │                      │  - TG_PostPhysics          │                      │
   │                      └─────┬─────────┘            │                      │
   │                            │                      │                      │
   │                            │ PrimaryActorTick.ExecuteTick()              │
   │                            ├─────────────────────>│                      │
   │                            │ TickActor(DeltaTime * CustomTimeDilation)   │
   │                            │                      │                      │
   │                            │ Tick()               │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ TickComponent()      │
   │                            │                      ├─────────────────────>│
   │                            │                      │                      │
   │                     ★ NETWORK REPLICATION         │                      │
   │                       (NetUpdateFrequency 주기)   │                      │
   │                       - PreReplication()          │                      │
   │                       - ReplicateActor()          │                      │
   │                       - 클라이언트로 전송          │                      │
   │                            │                      │                      │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │     PHASE 5: END PLAY & DESTROY                                         │
   ├════════════════════════════╪══════════════════════╪══════════════════════╪══════════
   │                            │                      │                      │
   │ Destroy()                  │                      │                      │
   ├───────────────────────────>│ EndPlay(Reason)      │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ ActorHasBegunPlay=HasNotBegunPlay
   │                            │                      │                      │
   │                            │ ★ STOP REPLICATION   │                      │
   │                            │   FReplicationSystemUtil::StopReplicatingActor()
   │                            │                      │                      │
   │                            │ ReceiveEndPlay()     │                      │
   │                            │ (Blueprint)          │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ EndPlay()            │
   │                            │                      ├─────────────────────>│
   │                            │                      │ (모든 컴포넌트)       │
   │                            │                      │                      │
   │                            │ OnEndPlay.Broadcast()│                      │
   │                            │                      │                      │
   │                            │ UnregisterAllComponents()                   │
   │                            ├─────────────────────>│                      │
   │                            │                      │ UnregisterComponent()│
   │                            │                      ├─────────────────────>│
   │                            │                      │ (물리/렌더링 제거)    │
   │                            │                      │                      │
   │                            │ DestroyActor()       │                      │
   │                            ├─────────────────────>│                      │
   │                            │                      │ bActorIsBeingDestroyed=true
   │                            │                      │ RemoveFromNetDriver()│
   │                            │                      │ MarkPendingKill()    │
   │                            │                      │                      │
   │                            │ TRACE_OBJECT_LIFETIME_END()                 │
   │                            │                      │                      │
   │                      ┌─────▼─────────┐            │                      │
   │                      │  GC System    │ ───────────┼──> (UObject GC)     │
   │                      │ - 다음 GC 때  │            │    실제 메모리 해제  │
   │                      │   메모리 해제 │            │                      │
   │                      └───────────────┘            │                      │
════════════════════════════════════════════════════════════════════════════════
```

---

## 📐 계층별 상세 분석

### 1. **AActor::InitializeDefaults() - 기본 설정**

**📂 위치:** `Engine/Source/Runtime/Engine/Private/Actor.cpp:271`

**역할:** 생성자에서 호출되어 Actor의 기본 값들을 초기화합니다.

**소스 코드:**
```cpp
// Actor.cpp:271
void AActor::InitializeDefaults()
{
    PrimaryActorTick.TickGroup = TG_PrePhysics;
    PrimaryActorTick.bCanEverTick = false;
    PrimaryActorTick.bStartWithTickEnabled = true;
    PrimaryActorTick.bAllowTickBatching = true;
    PrimaryActorTick.SetTickFunctionEnable(false);
    bAsyncPhysicsTickEnabled = false;

    CustomTimeDilation = 1.0f;

    SetRole(ROLE_Authority);     // 서버 Role
    RemoteRole = ROLE_None;      // 기본적으로 복제 안 함
    bReplicates = false;
    bCallPreReplication = true;
    bCallPreReplicationForReplay = true;
    bReplicateUsingRegisteredSubObjectList = GDefaultUseSubObjectReplicationList;
    PhysicsReplicationMode = EPhysicsReplicationMode::Default;
    NetPriority = 1.0f;
    SetNetUpdateFrequency(100.0f);     // 초당 100회 업데이트
    SetMinNetUpdateFrequency(2.0f);    // 최소 초당 2회
    bNetLoadOnClient = true;
}
```

**핵심 초기 값:**
| 프로퍼티 | 초기값 | 의미 |
|---------|--------|------|
| **Role** | `ROLE_Authority` | 서버 권한 (클라이언트는 나중에 `ROLE_SimulatedProxy`로 변경) |
| **RemoteRole** | `ROLE_None` | 복제 안 함 (SetReplicates()로 변경 가능) |
| **NetUpdateFrequency** | `100.0f` | 초당 최대 100회 복제 시도 |
| **NetPriority** | `1.0f` | 복제 우선순위 (거리 기반 조정) |
| **PrimaryActorTick.TickGroup** | `TG_PrePhysics` | 물리 시뮬레이션 전에 Tick |

---

### 2. **Component 등록 프로세스**

#### PreRegisterAllComponents() → RegisterComponent() → PostRegisterAllComponents()

**흐름:**
```
AActor::PreRegisterAllComponents()
   │
   ├──> bHasPreRegisteredAllComponents = true
   │
   └──> 각 컴포넌트:
         ├─> UActorComponent::OnComponentCreated()  (네이티브 컴포넌트)
         ├─> UActorComponent::RegisterComponent()
         │    ├─> CreatePhysicsState()  (UPrimitiveComponent)
         │    ├─> CreateRenderState()   (UPrimitiveComponent)
         │    └─> 충돌 설정, PhysX/Chaos 등록
         │
         └──> AActor::PostRegisterAllComponents()
               └─> bHasRegisteredAllComponents = true
```

**RegisterComponent()의 역할 (UPrimitiveComponent 예시):**
- **물리 상태 생성:** `CreatePhysicsState()` - Chaos 또는 PhysX에 RigidBody 등록
- **렌더링 상태 생성:** `CreateRenderState()` - SceneProxy 생성 및 렌더 스레드 등록
- **충돌 등록:** Collision 채널 설정 및 Overlap 초기화
- **World에 등록:** Component를 World의 Component List에 추가

---

### 3. **BeginPlay() - 게임플레이 시작**

**📂 위치:** `Engine/Source/Runtime/Engine/Private/Actor.cpp:4753`

**소스 검증:**
```cpp
// Actor.cpp:4753
void AActor::BeginPlay()
{
    TRACE_OBJECT_LIFETIME_BEGIN(this);

    ensureMsgf(ActorHasBegunPlay == EActorBeginPlayState::BeginningPlay,
               TEXT("BeginPlay was called on actor %s which was in state %d"),
               *GetPathName(), (int32)ActorHasBegunPlay);

    SetLifeSpan(InitialLifeSpan);
    RegisterAllActorTickFunctions(true, false); // Components는 아래에서 처리

    TInlineComponentArray<UActorComponent*> Components;
    GetComponents(Components);

    for (UActorComponent* Component : Components)
    {
        if (Component->IsRegistered() && !Component->HasBegunPlay())
        {
            Component->RegisterAllComponentTickFunctions(true);
            Component->BeginPlay();
            ensureMsgf(Component->HasBegunPlay(),
                       TEXT("Failed to route BeginPlay (%s)"), *Component->GetFullName());
        }
    }
}
```

**실행 순서:**
1. **LifeSpan 설정:** `InitialLifeSpan` 값에 따라 자동 파괴 타이머 설정
2. **Actor Tick 등록:** `PrimaryActorTick`을 TickManager에 등록
3. **Component BeginPlay:** 모든 등록된 컴포넌트의 `BeginPlay()` 호출
4. **Blueprint BeginPlay:** `ReceiveBeginPlay()` 이벤트 발생

**네트워크에서의 BeginPlay 지연:**
```cpp
// Actor.cpp:4690
void AActor::DispatchBeginPlay(bool bFromLevelStreaming)
{
    // 네트워크로 Spawn된 Actor는 초기 상태 적용까지 BeginPlay 지연
    if (bActorIsPendingPostNetInit)
    {
        if (UE::Net::FReplicationSystemUtil::GetReplicationSystem(this))
        {
            return;  // 아직 BeginPlay하지 않음!
        }
    }
    // ...
}
```

**핵심:** 클라이언트에서 복제된 Actor는 **첫 Replication Update를 받은 후**에야 BeginPlay가 실행됩니다.

---

### 4. **EndPlay() - 게임플레이 종료**

**📂 위치:** `Engine/Source/Runtime/Engine/Private/Actor.cpp:3232`

**소스 검증:**
```cpp
// Actor.cpp:3232
void AActor::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    if (ActorHasBegunPlay == EActorBeginPlayState::HasBegunPlay)
    {
        TRACE_OBJECT_LIFETIME_END(this);

        ActorHasBegunPlay = EActorBeginPlayState::HasNotBegunPlay;

        // ★ CRITICAL: Replication 중단
        UE::Net::FReplicationSystemUtil::StopReplicatingActor(this,
            FStopReplicatingActorParams(EndPlayReason));

        // Blueprint 이벤트 발생
        ReceiveEndPlay(EndPlayReason);
        OnEndPlay.Broadcast(this, EndPlayReason);

        TInlineComponentArray<UActorComponent*> Components;
        GetComponents(Components);

        for (UActorComponent* Component : Components)
        {
            if (Component->HasBegunPlay())
            {
                Component->EndPlay(EndPlayReason);
            }
        }
    }
}
```

**EndPlayReason 종류:**
```cpp
namespace EEndPlayReason
{
    enum Type
    {
        Destroyed,                  // Actor가 명시적으로 파괴됨
        LevelTransition,            // 레벨 전환
        EndPlayInEditor,            // PIE 종료
        RemovedFromWorld,           // World에서 제거됨
        Quit                        // 게임 종료
    };
}
```

**네트워크 정리:**
- `StopReplicatingActor()` - ActorChannel 닫기, NetDriver에서 제거
- 클라이언트에서도 자동으로 EndPlay 호출 (서버가 Destroy 복제 시)

---

## 🌐 Network Replication 시스템

### 복제 구조 다이어그램

```
════════════════════════════════════════════════════════════════════════════════
                     ACTOR REPLICATION ARCHITECTURE
════════════════════════════════════════════════════════════════════════════════

SERVER (Authority)                                    CLIENT (SimulatedProxy)
      │                                                        │
      │                                                        │
┌─────▼──────────────────────────────────────┐      ┌─────────▼──────────────┐
│           AActor (ROLE_Authority)          │      │  AActor (ROLE_Simulated│
│  - bReplicates = true                      │      │         Proxy)         │
│  - Role = ROLE_Authority                   │      │  - Role = ROLE_Simulated│
│  - RemoteRole = ROLE_SimulatedProxy        │      │                        │
│                                            │      │                        │
│  ┌──────────────────────────────────────┐ │      │  ┌──────────────────┐  │
│  │  FRepMovement ReplicatedMovement     │ │      │  │ FRepMovement     │  │
│  │  - Location                          │ │      │  │ (복제된 데이터)   │  │
│  │  - Rotation                          │ │      │  └──────────────────┘  │
│  │  - LinearVelocity                    │ │      │                        │
│  │  - AngularVelocity                   │ │      │  ┌──────────────────┐  │
│  │  - bRepPhysics                       │ │      │  │ OnRep_Replicated │  │
│  └──────────────────────────────────────┘ │      │  │     Movement()   │  │
│                                            │      │  │ - 위치 보간       │  │
│  ┌──────────────────────────────────────┐ │      │  │ - Physics 동기화 │  │
│  │  FRepAttachment AttachmentReplication│ │      │  └──────────────────┘  │
│  │  - AttachParent                      │ │      │                        │
│  │  - AttachSocket                      │ │      └────────────────────────┘
│  └──────────────────────────────────────┘ │                 ▲
│                                            │                 │
│  ┌──────────────────────────────────────┐ │      ┌──────────┴──────────┐
│  │  Custom Properties (UPROPERTY)       │ │      │   Replicated Data   │
│  │  UPROPERTY(Replicated)               │ │      │   - Properties      │
│  │  int32 Health;                       │ │      │   - RPCs            │
│  │                                      │ │      └─────────────────────┘
│  │  UPROPERTY(ReplicatedUsing=OnRep)   │ │
│  │  float Shield;                       │ │
│  └──────────────────────────────────────┘ │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │  Replication Pipeline (매 Tick)      │ │
│  │  1. PreReplication()                 │ │
│  │     - GatherCurrentMovement()        │ │
│  │     - 조건부 Replication 활성화      │ │
│  │  2. IsNetRelevantFor() 체크          │ │
│  │     - 거리, 가시성, Owner 확인       │ │
│  │  3. GetNetPriority() 계산            │ │
│  │     - 거리 기반 우선순위             │ │
│  │  4. ReplicateActor()                 │ │
│  │     - Property 변경 감지             │ │
│  │     - Bunch 직렬화                   │ │
│  │     - ActorChannel로 전송            │ │
│  └──────────────────────────────────────┘ │
│                                            │
│                  ┌──────────────────┐      │
└─────────────────►│  UActorChannel   │──────┘
                   │  - Server → Client
                   │  - Property Replication
                   │  - RPC 전송
                   │  - Bunch Serialization
                   └──────────────────┘
                            │
                            │ UDP Packet
                            ▼
                   ┌──────────────────┐
                   │   UNetConnection │
                   │  - Reliable      │
                   │  - Unreliable    │
                   │  - Packet Loss   │
                   └──────────────────┘
                            │
════════════════════════════╪════════════════════════════════════════════════════
                            │ Network (Internet)
════════════════════════════╪════════════════════════════════════════════════════
```

---

### Replication 주요 구조체: FRepMovement

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Engine/ReplicatedState.h:118`

**FRepMovement 구조:**
```cpp
// ReplicatedState.h:118
USTRUCT()
struct FRepMovement
{
    GENERATED_BODY()

    /** Velocity of component in world space */
    UPROPERTY(Transient)
    FVector LinearVelocity;

    /** Velocity of rotation for component (only valid if bRepPhysics is set) */
    UPROPERTY(Transient)
    FVector AngularVelocity;

    /** Location in world space */
    UPROPERTY(Transient)
    FVector Location;

    /** Current rotation */
    UPROPERTY(Transient)
    FRotator Rotation;

    /** Acceleration of component in world space. Only valid if bRepAcceleration is set. */
    UPROPERTY(Transient)
    FVector Acceleration;

    /** If set, RootComponent should be sleeping. */
    UPROPERTY(Transient)
    uint8 bSimulatedPhysicSleep : 1;

    /** If set, additional physic data (angular velocity) will be replicated. */
    UPROPERTY(Transient)
    uint8 bRepPhysics : 1;

    /** If set, additional acceleration data will be replicated. */
    UPROPERTY(Transient)
    uint8 bRepAcceleration : 1;

    /** Server physics step */
    UPROPERTY(Transient)
    int32 ServerFrame;

    /** ID assigned by server used to ensure determinism by physics. */
    UPROPERTY(Transient)
    int32 ServerPhysicsHandle = INDEX_NONE;

    /** Allows tuning the compression level for the replicated location vector. */
    UPROPERTY(EditDefaultsOnly, Category=Replication, AdvancedDisplay)
    EVectorQuantization LocationQuantizationLevel;

    /** Allows tuning the compression level for the replicated velocity vectors. */
    UPROPERTY(EditDefaultsOnly, Category=Replication, AdvancedDisplay)
    EVectorQuantization VelocityQuantizationLevel;

    /** Allows tuning the compression level for replicated rotation. */
    UPROPERTY(EditDefaultsOnly, Category=Replication, AdvancedDisplay)
    ERotatorQuantization RotationQuantizationLevel;
};
```

**Quantization (양자화):**
```cpp
enum class EVectorQuantization : uint8
{
    RoundWholeNumber,     // 1.0 단위로 반올림 (1m 정밀도)
    RoundOneDecimal,      // 0.1 단위로 반올림 (10cm 정밀도)
    RoundTwoDecimals      // 0.01 단위로 반올림 (1cm 정밀도)
};

enum class ERotatorQuantization : uint8
{
    ByteComponents,       // 8-bit per component (1.4도 정밀도)
    ShortComponents       // 16-bit per component (0.0055도 정밀도)
};
```

**대역폭 계산:**
| Quantization Level | Vector Size (bits) | Rotator Size (bits) |
|--------------------|--------------------|---------------------|
| **RoundWholeNumber** | 3 × 32 = 96 | - |
| **RoundOneDecimal** | 3 × 32 = 96 | - |
| **ByteComponents** | - | 3 × 8 = 24 |
| **ShortComponents** | - | 3 × 16 = 48 |

**FRepMovement 기본 크기:**
- Location (RoundTwoDecimals): ~96 bits
- Rotation (ShortComponents): ~48 bits
- LinearVelocity: ~96 bits
- **Total (기본):** ~240 bits = **30 bytes**

---

### PreReplication() - 복제 전 준비

**📂 위치:** `Engine/Source/Runtime/Engine/Private/Actor.cpp:2001`

**소스 검증:**
```cpp
// Actor.cpp:2001
void AActor::PreReplication(IRepChangedPropertyTracker & ChangedPropertyTracker)
{
#if WITH_PUSH_MODEL
    const AActor* const OldAttachParent = AttachmentReplication.AttachParent;
    const UActorComponent* const OldAttachComponent = AttachmentReplication.AttachComponent;
#endif

    // Attachment replication gets filled in by GatherCurrentMovement(),
    // but in the case of a detached root we need to trigger remote detachment.
    AttachmentReplication.AttachParent = nullptr;
    AttachmentReplication.AttachComponent = nullptr;

    GatherCurrentMovement();

    DOREPLIFETIME_ACTIVE_OVERRIDE_FAST(AActor, ReplicatedMovement, IsReplicatingMovement());

    // Don't need to replicate AttachmentReplication if the root component replicates,
    // because it already handles it.
    DOREPLIFETIME_ACTIVE_OVERRIDE_FAST(AActor, AttachmentReplication,
        RootComponent && !RootComponent->GetIsReplicated());

#if WITH_PUSH_MODEL
    // Push Model: 변경 감지 후 즉시 전송
    if (OldAttachParent != AttachmentReplication.AttachParent ||
        OldAttachComponent != AttachmentReplication.AttachComponent)
    {
        MARK_PROPERTY_DIRTY_FROM_NAME(AActor, AttachmentReplication, this);
    }
#endif
}
```

**역할:**
1. **GatherCurrentMovement():** RootComponent의 현재 위치/속도를 `ReplicatedMovement`에 복사
2. **조건부 Replication 활성화:**
   - `IsReplicatingMovement()` - `bReplicateMovement`가 true일 때만 복제
   - `AttachmentReplication` - RootComponent가 복제되지 않을 때만 복제
3. **Push Model 최적화:** 변경된 프로퍼티만 즉시 전송 (대역폭 절약)

**실행 주기:**
- `NetUpdateFrequency` (기본 100Hz) - 초당 최대 100회
- `MinNetUpdateFrequency` (기본 2Hz) - 변경 없어도 최소 초당 2회

---

### IsNetRelevantFor() - 관련성 판단

**📂 위치:** `Engine/Source/Runtime/Engine/Private/ActorReplication.cpp:382`

**소스 검증:**
```cpp
// ActorReplication.cpp:382
bool AActor::IsNetRelevantFor(const AActor* RealViewer, const AActor* ViewTarget,
                              const FVector& SrcLocation) const
{
    // 1. 항상 관련 있는 경우
    if (bAlwaysRelevant || IsOwnedBy(ViewTarget) || IsOwnedBy(RealViewer) ||
        this == ViewTarget || ViewTarget == GetInstigator())
    {
        return true;
    }
    // 2. Owner의 Relevancy 사용
    else if (bNetUseOwnerRelevancy && Owner)
    {
        return Owner->IsNetRelevantFor(RealViewer, ViewTarget, SrcLocation);
    }
    // 3. Owner에게만 관련 있음
    else if (bOnlyRelevantToOwner)
    {
        return false;
    }
    // 4. Attach Parent의 Relevancy 사용
    else if (RootComponent && RootComponent->GetAttachParent() &&
             RootComponent->GetAttachParent()->GetOwner() &&
             (Cast<USkeletalMeshComponent>(RootComponent->GetAttachParent()) ||
              (RootComponent->GetAttachParent()->GetOwner() == Owner)))
    {
        return RootComponent->GetAttachParent()->GetOwner()->IsNetRelevantFor(
            RealViewer, ViewTarget, SrcLocation);
    }
    // 5. 숨겨져 있고 충돌 없으면 관련 없음
    else if(IsHidden() && (!RootComponent || !RootComponent->IsCollisionEnabled()))
    {
        return false;
    }
    // 6. 거리 기반 Relevancy (NetCullDistanceSquared)
    else
    {
        return !GetDefault<AGameNetworkManager>()->bUseDistanceBasedRelevancy ||
               IsWithinNetRelevancyDistance(SrcLocation);
    }
}
```

**Relevancy 우선순위:**
1. **bAlwaysRelevant** - 항상 복제 (GameMode, GameState 등)
2. **Owner 관계** - 소유자에게는 항상 보임
3. **ViewTarget** - 카메라 대상은 항상 보임
4. **Instigator** - Instigator와 관련된 Actor
5. **거리 기반** - `NetCullDistanceSquared` 이내
6. **숨김 & 충돌 없음** - 관련 없음

**실전 예시:**
```cpp
// 플레이어의 무기는 Owner에게만 보임
AWeapon::AWeapon()
{
    bOnlyRelevantToOwner = true;  // 다른 클라이언트에게는 보이지 않음
}

// GameMode는 항상 모든 클라이언트에게 복제
AGameMode::AGameMode()
{
    bAlwaysRelevant = true;  // 모든 클라이언트에게 전송
    bReplicates = true;
}
```

---

### GetNetPriority() - 우선순위 계산

**📂 위치:** `Engine/Source/Runtime/Engine/Private/ActorReplication.cpp:45`

**소스 검증:**
```cpp
// ActorReplication.cpp:45
float AActor::GetNetPriority(const FVector& ViewPos, const FVector& ViewDir,
                             AActor* Viewer, AActor* ViewTarget,
                             UActorChannel* InChannel, float Time, bool bLowBandwidth)
{
    // 1. Owner의 Priority 사용
    if (bNetUseOwnerRelevancy && Owner)
    {
        return Owner->GetNetPriority(ViewPos, ViewDir, Viewer, ViewTarget,
                                     InChannel, Time, bLowBandwidth);
    }

    // 2. ViewTarget이면 높은 우선순위 (4배)
    if (ViewTarget && (this == ViewTarget || GetInstigator() == ViewTarget))
    {
        Time *= 4.f;
    }
    // 3. 위치 기반 우선순위 조정
    else if (!IsHidden() && GetRootComponent() != NULL)
    {
        FVector Dir = GetActorLocation() - ViewPos;
        float DistSq = Dir.SizeSquared();

        // 거리 기반 우선순위 감소
        // - 가까운 Actor: 높은 우선순위
        // - 먼 Actor: 낮은 우선순위
        if (DistSq < FMath::Square(1000.f))
        {
            Time *= 2.f;  // 1000 유닛 이내: 2배
        }
        else if (DistSq < FMath::Square(5000.f))
        {
            Time *= 1.f;  // 5000 유닛 이내: 1배
        }
        else
        {
            Time *= 0.4f;  // 5000 유닛 이상: 0.4배
        }

        // 시야 방향 고려 (뒤쪽 Actor는 우선순위 낮음)
        Dir.Normalize();
        float Dot = ViewDir | Dir;
        if (Dot < 0.f)  // 뒤쪽
        {
            Time *= 0.2f;
        }
        else if (Dot < 0.5f)  // 측면
        {
            Time *= 0.4f;
        }
    }

    return NetPriority * Time;
}
```

**우선순위 공식:**
```
최종 Priority = NetPriority × Time × DistanceFactor × ViewDirFactor

DistanceFactor:
- < 1000 units:  2.0
- < 5000 units:  1.0
- >= 5000 units: 0.4

ViewDirFactor:
- 뒤쪽 (Dot < 0):    0.2
- 측면 (Dot < 0.5):  0.4
- 정면 (Dot >= 0.5): 1.0
```

**대역폭 포화 시 동작:**
1. 모든 Actor의 Priority 계산
2. Priority 높은 순으로 정렬
3. 대역폭 한계까지 전송
4. 나머지는 다음 프레임으로 연기

**실전 예시:**
```cpp
// 중요한 Actor는 높은 NetPriority 설정
AImportantActor::AImportantActor()
{
    NetPriority = 3.0f;  // 기본(1.0f)보다 3배 높은 우선순위
}

// ViewTarget은 자동으로 4배 가중치 적용 (코드에서 처리)
```

---

## 🔄 Replication Update Frequency 제어

### NetUpdateFrequency와 NetUpdateTime

**메커니즘:**
```cpp
// NetDriver.cpp (의사 코드)
void UNetDriver::ServerReplicateActors(float DeltaSeconds)
{
    for (AActor* Actor : RelevantActors)
    {
        // NetUpdateTime은 다음 업데이트 예정 시간
        if (Actor->NetUpdateTime <= CurrentTime)
        {
            // Priority 계산
            float Priority = Actor->GetNetPriority(...);

            // 다음 업데이트 시간 계산
            if (bActorHasRecentlyChanged)
            {
                // 변경 있으면 NetUpdateFrequency 사용
                Actor->NetUpdateTime = CurrentTime + 1.0f / Actor->NetUpdateFrequency;
            }
            else
            {
                // 변경 없으면 MinNetUpdateFrequency로 throttle
                Actor->NetUpdateTime = CurrentTime + 1.0f / Actor->MinNetUpdateFrequency;
            }

            // Replication 실행
            ReplicateActor(Actor, Priority);
        }
    }
}
```

**Frequency 설정 예시:**
```cpp
// 빠르게 움직이는 Actor (총알, 발사체)
AProjectile::AProjectile()
{
    bReplicates = true;
    NetUpdateFrequency = 100.0f;     // 초당 100회
    MinNetUpdateFrequency = 50.0f;   // 최소 50회
}

// 느리게 움직이는 Actor (문, 상자)
AStaticProp::AStaticProp()
{
    bReplicates = true;
    NetUpdateFrequency = 10.0f;      // 초당 10회
    MinNetUpdateFrequency = 1.0f;    // 최소 1회
}

// 플레이어 캐릭터
ACharacter::ACharacter()
{
    NetUpdateFrequency = 100.0f;     // 빠른 업데이트
    MinNetUpdateFrequency = 2.0f;    // 정지 시 2Hz로 throttle
}
```

---

## 🎯 실전 예시

### 1. 간단한 Replicated Actor 만들기

```cpp
// MyReplicatedActor.h
UCLASS()
class AMyReplicatedActor : public AActor
{
    GENERATED_BODY()

public:
    AMyReplicatedActor();

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

    // Replicated Property
    UPROPERTY(Replicated)
    int32 Health;

    // RepNotify Property
    UPROPERTY(ReplicatedUsing=OnRep_Shield)
    float Shield;

    UFUNCTION()
    void OnRep_Shield();

    // Server RPC
    UFUNCTION(Server, Reliable)
    void ServerTakeDamage(int32 Damage);

    // Multicast RPC
    UFUNCTION(NetMulticast, Reliable)
    void MulticastPlayHitEffect();
};

// MyReplicatedActor.cpp
AMyReplicatedActor::AMyReplicatedActor()
{
    bReplicates = true;
    bAlwaysRelevant = false;
    NetUpdateFrequency = 10.0f;

    Health = 100;
    Shield = 50.0f;
}

void AMyReplicatedActor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    // 모든 클라이언트에게 복제
    DOREPLIFETIME(AMyReplicatedActor, Health);
    DOREPLIFETIME(AMyReplicatedActor, Shield);

    // 조건부 Replication (Owner에게만)
    // DOREPLIFETIME_CONDITION(AMyReplicatedActor, Shield, COND_OwnerOnly);
}

void AMyReplicatedActor::OnRep_Shield()
{
    // Shield 변경 시 클라이언트에서 실행
    UE_LOG(LogTemp, Log, TEXT("Shield changed to: %f"), Shield);
}

void AMyReplicatedActor::ServerTakeDamage_Implementation(int32 Damage)
{
    // 서버에서만 실행
    if (HasAuthority())
    {
        Health -= Damage;
        Shield -= Damage * 0.5f;

        // 모든 클라이언트에게 효과 표시
        MulticastPlayHitEffect();
    }
}

void AMyReplicatedActor::MulticastPlayHitEffect_Implementation()
{
    // 서버 + 모든 클라이언트에서 실행
    UE_LOG(LogTemp, Log, TEXT("Playing hit effect"));
}
```

---

### 2. 조건부 Replication 활용

```cpp
// 특정 조건에서만 복제
UCLASS()
class AAdvancedActor : public AActor
{
    GENERATED_BODY()

public:
    virtual void PreReplication(IRepChangedPropertyTracker & ChangedPropertyTracker) override;

    UPROPERTY(Replicated)
    FVector SecretLocation;  // Owner에게만 보여줄 정보
};

void AAdvancedActor::PreReplication(IRepChangedPropertyTracker & ChangedPropertyTracker)
{
    Super::PreReplication(ChangedPropertyTracker);

    // SecretLocation은 Owner에게만 복제
    DOREPLIFETIME_ACTIVE_OVERRIDE(AAdvancedActor, SecretLocation,
        GetOwner() != nullptr);
}

void AAdvancedActor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    // 조건부 Replication 조건들:
    // COND_None - 항상 복제
    // COND_InitialOnly - 초기 한 번만 복제
    // COND_OwnerOnly - Owner에게만
    // COND_SkipOwner - Owner 제외하고
    // COND_SimulatedOnly - Simulated Proxy에게만
    // COND_AutonomousOnly - Autonomous Proxy에게만
    // COND_SimulatedOrPhysics - Simulated 또는 Physics 시뮬레이팅 중일 때
    // COND_InitialOrOwner - 초기 또는 Owner
    // COND_Custom - 커스텀 조건 (PreReplication에서 설정)

    DOREPLIFETIME_CONDITION(AAdvancedActor, SecretLocation, COND_OwnerOnly);
}
```

---

### 3. 대역폭 최적화

```cpp
// 대역폭 최적화된 Projectile
UCLASS()
class AOptimizedProjectile : public AActor
{
    GENERATED_BODY()

public:
    AOptimizedProjectile()
    {
        bReplicates = true;
        bReplicateMovement = true;  // FRepMovement 사용

        // 빠른 업데이트
        NetUpdateFrequency = 100.0f;
        MinNetUpdateFrequency = 50.0f;

        // 짧은 거리에서만 복제
        NetCullDistanceSquared = 10000.0f * 10000.0f;  // 10000 유닛

        // 높은 우선순위
        NetPriority = 2.5f;

        // Quantization 레벨 설정 (대역폭 절약)
        // ReplicatedMovement.LocationQuantizationLevel = EVectorQuantization::RoundWholeNumber;
        // ReplicatedMovement.VelocityQuantizationLevel = EVectorQuantization::RoundWholeNumber;
        // ReplicatedMovement.RotationQuantizationLevel = ERotatorQuantization::ByteComponents;
    }

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override
    {
        Super::GetLifetimeReplicatedProps(OutLifetimeProps);

        // 초기에만 복제 (발사 후 변경되지 않는 정보)
        DOREPLIFETIME_CONDITION(AOptimizedProjectile, ProjectileType, COND_InitialOnly);
    }

private:
    UPROPERTY(Replicated)
    int32 ProjectileType;  // 한 번만 복제
};
```

**대역폭 계산 예시:**
```
FRepMovement (기본):
- Location: 96 bits
- Rotation: 48 bits
- LinearVelocity: 96 bits
Total: 240 bits = 30 bytes

100Hz 업데이트:
- 30 bytes × 100 = 3000 bytes/sec = ~3 KB/s (Actor 1개당)
- 100 Actors: 300 KB/s
- 10 Players: 3 MB/s (업로드 대역폭)

최적화 후 (RoundWholeNumber + ByteComponents):
- Location: 96 bits (변화 없음, 이미 양자화됨)
- Rotation: 24 bits (48 → 24, ShortComponents → ByteComponents)
- LinearVelocity: 96 bits
Total: 216 bits = 27 bytes (10% 절약)
```

---

## 💡 일반적인 함정 및 해결 방법

### ❌ 함정 1: BeginPlay에서 복제된 프로퍼티 읽기

**문제:**
```cpp
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // ❌ 클라이언트에서 Health가 0일 수 있음!
    UE_LOG(LogTemp, Log, TEXT("Health: %d"), Health);
}
```

**원인:**
- 클라이언트에서 BeginPlay는 첫 Replication Update 후에 실행
- 하지만 모든 프로퍼티가 동기화되었다는 보장 없음

**✅ 해결 방법:**
```cpp
// 방법 1: RepNotify 사용
UPROPERTY(ReplicatedUsing=OnRep_Health)
int32 Health;

UFUNCTION()
void OnRep_Health()
{
    // Health가 복제될 때마다 실행
    UE_LOG(LogTemp, Log, TEXT("Health updated: %d"), Health);
}

// 방법 2: PostNetInit 사용
virtual void PostNetInit() override
{
    Super::PostNetInit();

    // 네트워크 초기화 완료 후 실행 (클라이언트만)
    if (!HasAuthority())
    {
        UE_LOG(LogTemp, Log, TEXT("Health: %d"), Health);
    }
}
```

---

### ❌ 함정 2: 서버 RPC를 클라이언트에서 호출 실패

**문제:**
```cpp
UFUNCTION(Server, Reliable)
void ServerDoSomething();

void AMyActor::SomeFunction()
{
    ServerDoSomething();  // ❌ 실행되지 않음!
}
```

**원인:**
- Server RPC는 **Owner가 있는 Actor**에서만 동작
- 또는 PlayerController가 RPC를 호출해야 함

**✅ 해결 방법:**
```cpp
// 방법 1: Owner 설정
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    if (APlayerController* PC = Cast<APlayerController>(GetOwner()))
    {
        SetOwner(PC);  // Owner 설정
    }
}

// 방법 2: PlayerController를 통해 호출
void APlayerController::DoSomething()
{
    ServerDoSomethingOnActor(MyActor);
}

UFUNCTION(Server, Reliable)
void ServerDoSomethingOnActor(AActor* Actor)
{
    if (Actor)
    {
        // Server에서 실행
    }
}
```

---

### ❌ 함정 3: 대역폭 낭비 (불필요한 Replication)

**문제:**
```cpp
UPROPERTY(Replicated)
FString LongDescription;  // 수십 KB 크기!

UPROPERTY(Replicated)
TArray<FVector> PathPoints;  // 수백 개 원소
```

**✅ 해결 방법:**
```cpp
// 방법 1: 초기에만 복제
DOREPLIFETIME_CONDITION(AMyActor, LongDescription, COND_InitialOnly);

// 방법 2: Owner에게만 복제
DOREPLIFETIME_CONDITION(AMyActor, PathPoints, COND_OwnerOnly);

// 방법 3: 필요할 때만 수동으로 복제
void AMyActor::SendDataToClient(APlayerController* PC)
{
    if (PC)
    {
        ClientReceiveData(LongDescription);
    }
}

UFUNCTION(Client, Reliable)
void ClientReceiveData(const FString& Data);
```

---

### ❌ 함정 4: EndPlay가 호출되지 않음

**문제:**
```cpp
void AMyActor::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    Super::EndPlay(EndPlayReason);

    // 정리 작업
    CleanupResources();
}

// ❌ 클라이언트에서 호출되지 않는 경우가 있음
```

**원인:**
- 서버가 갑자기 연결 끊김
- Level Streaming으로 인한 갑작스런 Unload

**✅ 해결 방법:**
```cpp
// 방법 1: Destroyed() 오버라이드
virtual void Destroyed() override
{
    Super::Destroyed();
    CleanupResources();
}

// 방법 2: BeginDestroy() 사용 (최후의 수단)
virtual void BeginDestroy() override
{
    CleanupNonUObjectResources();  // UObject가 아닌 리소스만 정리
    Super::BeginDestroy();
}

// 방법 3: 안전한 정리 패턴
void AMyActor::SafeCleanup()
{
    if (!bHasCleanedUp)
    {
        bHasCleanedUp = true;
        CleanupResources();
    }
}

virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override
{
    SafeCleanup();
    Super::EndPlay(EndPlayReason);
}

virtual void Destroyed() override
{
    SafeCleanup();
    Super::Destroyed();
}
```

---

## 🔧 디버깅 팁

### 1. Replication 디버깅 명령어

```
# 네트워크 상태 확인
stat net

# Actor Replication 상태 확인
obj list class=Actor

# 특정 Actor의 Replication 추적
log LogNetTraffic Verbose
log LogNetPlayerMovement Verbose

# Network Emulation (패킷 로스, 지연 시뮬레이션)
net PktLoss=10        # 10% 패킷 로스
net PktLag=100        # 100ms 지연
net PktDup=5          # 5% 패킷 중복
```

### 2. Visual Logger를 통한 Replication 추적

```cpp
void AMyActor::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

#if ENABLE_VISUAL_LOG
    if (HasAuthority())
    {
        UE_VLOG_LOCATION(this, LogNetworkVerbose, Log, GetActorLocation(), 50.f, FColor::Green,
                         TEXT("Server: Health=%d"), Health);
    }
    else
    {
        UE_VLOG_LOCATION(this, LogNetworkVerbose, Log, GetActorLocation(), 50.f, FColor::Blue,
                         TEXT("Client: Health=%d"), Health);
    }
#endif
}
```

### 3. RepNotify 로깅

```cpp
UFUNCTION()
void OnRep_Health()
{
    UE_LOG(LogTemp, Log, TEXT("[%s] Health changed to: %d (Authority: %d)"),
           *GetName(), Health, HasAuthority());

    // Visual Logger
    UE_VLOG(this, LogTemp, Log, TEXT("Health: %d"), Health);
}
```

---

## 📊 성능 최적화 체크리스트

### ✅ Replication 최적화

- [ ] **NetUpdateFrequency 조정**
  - 중요한 Actor: 100Hz
  - 일반 Actor: 10Hz
  - 정적 Actor: 1Hz

- [ ] **조건부 Replication 사용**
  - `COND_OwnerOnly` - 개인 정보
  - `COND_InitialOnly` - 초기 설정
  - `COND_SkipOwner` - 서버 피드백 제외

- [ ] **NetCullDistanceSquared 설정**
  - 시각 효과: 5000 ~ 10000 유닛
  - 게임플레이 중요 Actor: 15000 ~ 20000 유닛
  - 전역 Actor: 무제한 (0)

- [ ] **Relevancy 최적화**
  - `bAlwaysRelevant` 최소화
  - `bOnlyRelevantToOwner` 활용
  - `bNetUseOwnerRelevancy` 활용

- [ ] **Quantization 레벨 조정**
  - 정밀도가 중요하지 않은 경우 `RoundWholeNumber` 사용
  - Rotation은 `ByteComponents` 고려

### ✅ Tick 최적화

- [ ] **Tick 간격 조정**
  ```cpp
  PrimaryActorTick.TickInterval = 0.1f;  // 10Hz로 Tick
  ```

- [ ] **조건부 Tick**
  ```cpp
  void AMyActor::BeginPlay()
  {
      Super::BeginPlay();

      // 필요할 때만 Tick 활성화
      SetActorTickEnabled(false);
  }

  void AMyActor::OnSomethingHappened()
  {
      SetActorTickEnabled(true);

      // 5초 후 자동 비활성화
      GetWorldTimerManager().SetTimer(TimerHandle, [this]()
      {
          SetActorTickEnabled(false);
      }, 5.0f, false);
  }
  ```

- [ ] **TickGroup 최적화**
  ```cpp
  // 물리 전에 Tick이 필요한 경우
  PrimaryActorTick.TickGroup = TG_PrePhysics;

  // 물리 후에 Tick (대부분의 경우)
  PrimaryActorTick.TickGroup = TG_PostPhysics;
  ```

---

## 🔗 참조 자료

- [Official Unreal Engine Actor Lifecycle](https://docs.unrealengine.com/Programming/UnrealArchitecture/Actors/ActorLifecycle)
- [Official Networking and Multiplayer](https://docs.unrealengine.com/InteractiveExperiences/Networking/Actors)
- [Replication Graph Documentation](https://docs.unrealengine.com/ProgrammingAndScripting/Networking/ReplicationGraph)
- [Network Profiler](https://docs.unrealengine.com/TestingAndOptimization/PerformanceAndProfiling/NetworkProfiler)

**소스 파일:**
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h`
- `Engine/Source/Runtime/Engine/Private/Actor.cpp`
- `Engine/Source/Runtime/Engine/Private/ActorReplication.cpp`
- `Engine/Source/Runtime/Engine/Classes/Engine/ReplicatedState.h`

---

> 🔄 Created: 2025-01-XX — Actor 생명주기 및 Replication 시스템 Deep Dive 초안 작성
