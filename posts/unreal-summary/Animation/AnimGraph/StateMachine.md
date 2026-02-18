---
title: "State Machine - 애니메이션 상태 머신 (Animation State Machine)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "AnimGraph"]
---
# State Machine - 애니메이션 상태 머신 (Animation State Machine)

## 🧭 개요 (Overview)

**State Machine**은 Unreal Animation Framework의 **핵심 제어 시스템**으로, 복잡한 애니메이션 전환 로직을 **시각적**으로 관리합니다. 캐릭터의 행동 상태(Idle, Walk, Run, Jump 등)를 노드로 표현하고, 조건 기반으로 자동 전환합니다.

**핵심 역할:**
- **상태 관리 (State Management)**: 현재 캐릭터 상태 추적 (Idle, Walk, Run 등)
- **전환 로직 (Transition Logic)**: 조건 기반 상태 전환 (속도, 공중 여부 등)
- **자동 블렌딩 (Automatic Blending)**: 상태 간 부드러운 전환
- **Conduit**: 복잡한 상태 라우팅 로직
- **전환 이벤트 (Transition Events)**: 게임 코드에서 명시적 전환 요청
- **계층적 설계**: 여러 State Machine을 중첩 사용 가능

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_StateMachine.h:120`

---

## 🎯 설계 철학: 왜 State Machine인가?

### 문제: 복잡한 애니메이션 전환 관리

```
┌─────────────────────────────────────────────────────────────────────────┐
│            전통적 애니메이션 제어 방식의 한계                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: 코드 기반 수동 블렌딩                                        │
│  ┌──────────────────────────────────────────┐                          │
│  │  if (Speed > 300) {                      │                          │
│  │      BlendToRun(0.25f);                  │                          │
│  │  } else if (Speed > 10) {                │                          │
│  │      BlendToWalk(0.25f);                 │                          │
│  │  } else {                                │                          │
│  │      BlendToIdle(0.25f);                 │                          │
│  │  }                                       │                          │
│  │  → 복잡한 if-else 지옥                    │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
│  ❌ 문제 2: 불완전한 전환 관리                                            │
│  - 블렌딩 중간에 다른 상태 전환 시 어색함                                 │
│  - 되돌아가는 전환(Idle→Walk→Idle) 처리 어려움                          │
│  - 전환 타이밍 제어 불가 (남은 시간, 애니메이션 끝 등)                    │
│                                                                         │
│  ❌ 문제 3: 디버깅 어려움                                                 │
│  - 현재 어느 상태인지 추적 어려움                                         │
│  - 전환 조건 복잡도 증가                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   State Machine 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ✅ 해결 1: 시각적 상태 그래프                                            │
│  ┌──────────────────────────────────────────┐                          │
│  │  [Idle] ──Speed > 10──> [Walk]           │                          │
│  │    ↑                       ↓              │                          │
│  │    └───────Speed < 10──────┘              │                          │
│  │                                           │                          │
│  │  [Walk] ──Speed > 300──> [Run]           │                          │
│  │    ↑                       ↓              │                          │
│  │    └───────Speed < 300─────┘              │                          │
│  └──────────────────────────────────────────┘                          │
│  - 드래그 앤 드롭으로 상태 추가                                           │
│  - 전환 조건 시각적 표시                                                  │
│                                                                         │
│  ✅ 해결 2: 자동 블렌딩 관리                                              │
│  - 전환 시간 설정 (Duration)                                             │
│  - 블렌드 커브 (Linear, Cubic, EaseIn/Out)                              │
│  - 블렌드 프로필 (본별 가중치)                                            │
│  - Inertialization (관성 블렌딩, 더 자연스러운 전환)                      │
│                                                                         │
│  ✅ 해결 3: 런타임 상태 추적                                              │
│  - GetCurrentStateName()                                               │
│  - GetStateWeight(StateIndex)                                          │
│  - GetRelevantAnimTimeRemaining()                                      │
│  - Pose Watch (에디터에서 실시간 디버깅)                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 설계 결정

| 결정 사항 | 이유 | 트레이드오프 |
|----------|------|-------------|
| **Baked State Machine** | 런타임 오버헤드 최소화 | 컴파일 시간 증가 |
| **조건 기반 전환 (Rule)** | 자동 상태 전환 | 복잡한 조건 시 성능 저하 |
| **자동 블렌딩** | 부드러운 전환 보장 | 블렌딩 시간 동안 제어 제한적 |
| **Conduit** | 복잡한 라우팅 로직 | 디버깅 어려움 |
| **전환 이벤트 큐** | 게임 로직 제어 가능 | 타이밍 문제 발생 가능 |

**📂 소스 검증:**
- `AnimNode_StateMachine.h:120-252` - FAnimNode_StateMachine 클래스 정의
- `AnimStateMachineTypes.h:362-388` - FBakedAnimationStateMachine 구조
- `AnimStateMachineTypes.h:184-250` - FAnimationTransitionBetweenStates 전환 데이터

---

## 🏗️ 시스템 아키텍처 (System Architecture)

### 전체 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  State Machine 실행 파이프라인                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 컴파일 타임 (Blueprint Editor)                                      │
│  ┌──────────────────────────────────────────┐                          │
│  │  Animation Blueprint Editor              │                          │
│  │  - State Machine Graph 편집              │                          │
│  │  - 상태 노드 추가                         │                          │
│  │  - 전환 조건 정의                         │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓ 컴파일러 (FAnimBlueprintCompiler)                             │
│  ┌──────────────────────────────────────────┐                          │
│  │  FBakedAnimationStateMachine 생성       │                          │
│  │  - States[] 배열                         │                          │
│  │  - Transitions[] 배열                    │                          │
│  │  - InitialState 인덱스                   │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [2] 런타임 초기화 (Initialize Phase)                                    │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_StateMachine::Initialize()    │                          │
│  │  - PRIVATE_MachineDescription 로드       │                          │
│  │  - CurrentState = InitialState           │                          │
│  │  - StatePoseLinks 초기화                 │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [3] 매 프레임 업데이트 (Update Phase)                                   │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_StateMachine::Update()        │                          │
│  │  ├─ ElapsedTime += DeltaTime             │                          │
│  │  ├─ 전환 조건 평가 (Transition Rules)     │                          │
│  │  ├─ 새 전환 발생 시:                      │                          │
│  │  │   - ActiveTransitionArray에 추가       │                          │
│  │  │   - CurrentState 변경                 │                          │
│  │  ├─ 활성 전환 업데이트 (블렌딩 진행)       │                          │
│  │  └─ 전환 완료 시 제거                     │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [4] 포즈 평가 (Evaluate Phase)                                          │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_StateMachine::Evaluate()      │                          │
│  │  - CurrentState 포즈 계산                │                          │
│  │  - 활성 전환 블렌딩:                      │                          │
│  │    - 이전 상태 포즈 + 다음 상태 포즈      │                          │
│  │    - 블렌드 알파 계산 (CrossfadeDuration) │                          │
│  │  - 최종 포즈 출력                         │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 클래스 구조 (Class Structure)

### 1. FAnimNode_StateMachine - 런타임 노드

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_StateMachine.h:120-252`

```cpp
// AnimNode_StateMachine.h:120-252
USTRUCT()
struct FAnimNode_StateMachine : public FAnimNode_Base
{
    GENERATED_USTRUCT_BODY()

    // === 식별 ===
    /** Index into the BakedStateMachines array in the owning UAnimBlueprintGeneratedClass */
    UPROPERTY()
    int32 StateMachineIndexInClass;

    // === 설정 ===
    /** The maximum number of transitions that can be taken by this machine 'simultaneously' in a single frame */
    UPROPERTY(EditAnywhere, Category=Settings)
    int32 MaxTransitionsPerFrame = 3;

    /** The maximum number of transition requests that can be buffered at any time */
    UPROPERTY(EditAnywhere, Category = Settings, meta = (ClampMin = "0"))
    int32 MaxTransitionsRequests = 32;

    /** Flag to skip the first update transition check. Useful if you need to initialize some parameters in an anim instance
     *  and don't want the state machine to transition on the first update based on those parameters. */
    UPROPERTY(EditAnywhere, Category = Settings)
    bool bSkipFirstUpdateTransition = false;

    /** When the state machine becomes relevant, it is reinitialized. If this is true, it will also reset its current state. */
    UPROPERTY(EditAnywhere, Category = Settings)
    bool bReinitializeOnBecomingRelevant = true;

protected:
    // === 상태 추적 ===
    /** The index of the currently selected state */
    int32 CurrentState;

    /** The time we have been in the current state */
    float ElapsedTime;

    /** Pointer to the state machine description in the class */
    const FBakedAnimationStateMachine* PRIVATE_MachineDescription;

    /** Active transitions (블렌딩 중인 전환들) */
    TArray<FAnimationActiveTransitionEntry> ActiveTransitionArray;

    /** State pose links (각 상태의 포즈 평가 링크) */
    TArray<FPoseLink> StatePoseLinks;

    /** Queued transition events (게임 코드에서 요청한 전환 이벤트들) */
    TArray<FTransitionEvent> QueuedTransitionEvents;

public:
    // === 핵심 인터페이스 ===
    virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
    virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
    virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
    virtual void Evaluate_AnyThread(FPoseContext& Output) override;
    virtual void GatherDebugData(FNodeDebugData& DebugData) override;

    // === 상태 쿼리 ===
    int32 GetCurrentState() const { return CurrentState; }
    float GetCurrentStateElapsedTime() const { return ElapsedTime; }
    FName GetCurrentStateName() const;
    float GetStateWeight(int32 StateIndex) const;

    // === 전환 이벤트 관리 ===
    bool RequestTransitionEvent(const FTransitionEvent& InTransitionEvent);
    void ClearTransitionEvents(const FName& EventName);
    void ClearAllTransitionEvents();
    bool QueryTransitionEvent(const int32 TransitionIndex, const FName& EventName) const;
    bool QueryAndMarkTransitionEvent(const int32 TransitionIndex, const FName& EventName);
    void ConsumeMarkedTransitionEvents();
};
```

**클래스 다이어그램:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FAnimNode_StateMachine                               │
│  (런타임 State Machine 실행 노드)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Private:                                                               │
│    - CurrentState : int32                   // 현재 상태 인덱스         │
│    - ElapsedTime : float                    // 현재 상태 경과 시간      │
│    - PRIVATE_MachineDescription : FBakedAnimationStateMachine*         │
│                                             // Baked State Machine 참조│
│    - ActiveTransitionArray : TArray<FAnimationActiveTransitionEntry>   │
│                                             // 활성 전환 배열           │
│    - StatePoseLinks : TArray<FPoseLink>     // 상태 포즈 링크           │
│    - QueuedTransitionEvents : TArray<FTransitionEvent>                 │
│                                             // 전환 이벤트 큐           │
│                                                                         │
│  Public:                                                                │
│    + Initialize_AnyThread(Context) : void   // 초기화                   │
│    + Update_AnyThread(Context) : void       // 매 프레임 업데이트       │
│    + Evaluate_AnyThread(Output) : void      // 포즈 평가                │
│    + GetCurrentState() : int32              // 현재 상태 인덱스         │
│    + GetStateWeight(StateIndex) : float     // 상태 가중치              │
│    + RequestTransitionEvent(...) : bool     // 전환 요청                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2. FBakedAnimationStateMachine - 컴파일된 데이터

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimStateMachineTypes.h:362-388`

```cpp
// AnimStateMachineTypes.h:362-388
USTRUCT()
struct FBakedAnimationStateMachine
{
    GENERATED_USTRUCT_BODY()

    /** Name of this machine (for debugging purposes) */
    UPROPERTY()
    FName MachineName;

    /** The index of the initial state that the machine will start in */
    UPROPERTY()
    int32 InitialState;

    /** All states contained in the machine */
    UPROPERTY()
    TArray<FBakedAnimationState> States;

    /** All transitions between states */
    UPROPERTY()
    TArray<FAnimationTransitionBetweenStates> Transitions;

#if STATS
    // Stat ID for this machine
    mutable TStatId StatID;
#endif
};
```

**구조:**

```
FBakedAnimationStateMachine
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  MachineName: "DefaultStateMachine"                                    │
│  InitialState: 0  (Idle)                                               │
│                                                                         │
│  States[]:                                                              │
│  ┌──────────────────────────────────────────┐                          │
│  │  [0] Idle                                 │                          │
│  │      - PlayerNodeIndices: [23]           │                          │
│  │      - Transitions: [{ToState:1, Rule...}]│                          │
│  │  [1] Walk                                 │                          │
│  │      - PlayerNodeIndices: [24]           │                          │
│  │      - Transitions: [{ToState:0, Rule...},│                          │
│  │                      {ToState:2, Rule...}]│                          │
│  │  [2] Run                                  │                          │
│  │      - PlayerNodeIndices: [25]           │                          │
│  │      - Transitions: [{ToState:1, Rule...}]│                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
│  Transitions[]:                                                         │
│  ┌──────────────────────────────────────────┐                          │
│  │  [0] Idle → Walk                          │                          │
│  │      - PreviousState: 0                   │                          │
│  │      - NextState: 1                       │                          │
│  │      - CrossfadeDuration: 0.25f           │                          │
│  │      - BlendMode: Cubic                   │                          │
│  │      - LogicType: StandardBlend           │                          │
│  │  [1] Walk → Idle                          │                          │
│  │      ... (동일한 구조)                     │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 3. FBakedAnimationState - 개별 상태

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimStateMachineTypes.h:306-359`

```cpp
// AnimStateMachineTypes.h:306-359
USTRUCT()
struct FBakedAnimationState
{
    GENERATED_USTRUCT_BODY()

    /** The name of this state */
    UPROPERTY()
    FName StateName;

    /** Index of root node in AnimNodeProperties */
    UPROPERTY()
    int32 StateRootNodeIndex;

    /** Indices into the UAnimBlueprintGeneratedClass::AnimNodeProperties array
     *  for player nodes contained in this state. */
    UPROPERTY()
    TArray<int32> PlayerNodeIndices;

    /** Indices into the UAnimBlueprintGeneratedClass::AnimNodeProperties array
     *  for layer nodes contained in this state. */
    UPROPERTY()
    TArray<int32> LayerNodeIndices;

    /** The transitions available from this state */
    UPROPERTY()
    TArray<FBakedStateExitTransition> Transitions;

    // Notifies
    /** The index in the AnimNotifyEventReference array for the entry notify */
    UPROPERTY()
    int32 StartNotify;

    /** The index in the AnimNotifyEventReference array for the exit notify */
    UPROPERTY()
    int32 EndNotify;

    /** The index in the AnimNotifyEventReference array for the fully blended notify */
    UPROPERTY()
    int32 FullyBlendedNotify;

    /** Whether or not this state will ALWAYS reset it's state on reentry,
     *  regardless of remaining weight */
    UPROPERTY()
    bool bAlwaysResetOnEntry;

    /** Whether this state is a conduit (routing node for transitions) */
    UPROPERTY()
    bool bIsAConduit;
};
```

**상태 구조:**

```
FBakedAnimationState - Idle
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  StateName: "Idle"                                                      │
│  StateRootNodeIndex: 100  → AnimGraph의 루트 노드 인덱스                │
│                                                                         │
│  PlayerNodeIndices: [23]                                               │
│  → AnimGraph에서 이 상태의 애니메이션 재생 노드들                        │
│    (SequencePlayer, BlendSpace 등)                                      │
│                                                                         │
│  Transitions: [                                                         │
│    {PreviousStateIndex: 0, NextStateIndex: 1, ...},  // Idle → Walk    │
│    {PreviousStateIndex: 0, NextStateIndex: 3, ...}   // Idle → Jump    │
│  ]                                                                      │
│                                                                         │
│  Notifies:                                                              │
│    - StartNotify: 10    → State 진입 시 발생                            │
│    - EndNotify: 11      → State 종료 시 발생                            │
│    - FullyBlendedNotify: 12  → 완전 블렌드 완료 시                      │
│                                                                         │
│  bAlwaysResetOnEntry: false  → 재진입 시 초기화 여부                     │
│  bIsAConduit: false          → Conduit 노드 여부                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 4. FAnimationTransitionBetweenStates - 전환 데이터

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimStateMachineTypes.h:184-250`

```cpp
// AnimStateMachineTypes.h:184-250
USTRUCT()
struct FAnimationTransitionBetweenStates : public FAnimationStateBase
{
    GENERATED_USTRUCT_BODY()

    /** The state this transition goes from */
    UPROPERTY()
    int32 PreviousState;

    /** The state this transition goes to */
    UPROPERTY()
    int32 NextState;

    /** The duration to cross-fade for */
    UPROPERTY()
    float CrossfadeDuration;

    /** The type of blending to use in the crossfade */
    UPROPERTY()
    EAlphaBlendOption BlendMode;

    /** The blend profile to use for this transition */
    UPROPERTY()
    TObjectPtr<UBlendProfile> BlendProfile;

    /** Custom blend curve */
    UPROPERTY()
    TObjectPtr<UCurveFloat> CustomCurve;

    /** Type of logic to use for this transition */
    UPROPERTY()
    TEnumAsByte<ETransitionLogicType::Type> LogicType;

    /** Minimum amount of time a state must be active before a re-entry transition to it is allowed */
    UPROPERTY()
    float MinTimeBeforeReentry;
};
```

**전환 타입:**

```cpp
// AnimStateMachineTypes.h:68-83
namespace ETransitionLogicType
{
    enum Type
    {
        /** 표준 블렌드 (두 포즈 간 선형 보간) */
        TLT_StandardBlend,

        /** Inertialization 블렌드 (관성 블렌딩, UE 5.0+) */
        TLT_Inertialization,

        /** 커스텀 블렌드 (사용자 정의 그래프) */
        TLT_Custom,
    };
}
```

---

### 5. FAnimationActiveTransitionEntry - 활성 전환

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_StateMachine.h:14-87`

```cpp
// AnimNode_StateMachine.h:14-87
USTRUCT()
struct FAnimationActiveTransitionEntry
{
    GENERATED_USTRUCT_BODY()

    /** Elapsed time for this transition (0 to CrossfadeDuration) */
    float ElapsedTime;

    /** Duration of crossfade */
    float CrossfadeDuration;

    /** 이전 상태 인덱스 */
    int32 PreviousState;

    /** 다음 상태 인덱스 */
    int32 NextState;

    /** Blend alpha (0.0 = PreviousState, 1.0 = NextState) */
    float Alpha;

    /** Blend mode (Linear, Cubic, EaseIn, EaseOut, etc.) */
    EAlphaBlendOption BlendMode;

    /** Blend profile for per-bone weights */
    TObjectPtr<UBlendProfile> BlendProfile;

    /** Custom blend curve */
    TObjectPtr<UCurveFloat> CustomCurve;

    /** Transition logic type */
    TEnumAsByte<ETransitionLogicType::Type> LogicType;

    /** Transition start notify has been triggered */
    bool bStartedTransitionNotify;
};
```

**활성 전환 추적:**

```
ActiveTransitionArray 예시:
┌────────────────────────────────────────────────────────────────────┐
│  Transition: Walk → Run                                            │
│  ┌──────────────────────────────────────┐                         │
│  │  ElapsedTime: 0.15f                  │  (진행 중)               │
│  │  CrossfadeDuration: 0.25f            │  (전체 시간)             │
│  │  Alpha: 0.6f                         │  (60% 블렌드)            │
│  │  PreviousState: 1 (Walk)             │                         │
│  │  NextState: 2 (Run)                  │                         │
│  │  BlendMode: Cubic                    │                         │
│  │  LogicType: TLT_StandardBlend        │                         │
│  └──────────────────────────────────────┘                         │
│                                                                    │
│  현재 포즈 = Lerp(Walk Pose, Run Pose, Alpha=0.6)                  │
│             = 40% Walk + 60% Run                                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 생명주기 (Lifecycle)

### 전체 생명주기 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│              FAnimNode_StateMachine 생명주기                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 컴파일 (Blueprint Compilation)                                     │
│  ┌──────────────────────────────────────────┐                          │
│  │  Animation Blueprint Editor에서 편집     │                          │
│  │  - State Machine Graph 작성              │                          │
│  │  - 상태 추가 (Idle, Walk, Run...)        │                          │
│  │  - 전환 조건 정의 (Speed > 10 등)         │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓ FAnimBlueprintCompiler                                       │
│  ┌──────────────────────────────────────────┐                          │
│  │  FBakedAnimationStateMachine 생성        │                          │
│  │  - States[] 배열 채우기                  │                          │
│  │  - Transitions[] 배열 채우기             │                          │
│  │  - UAnimBlueprintGeneratedClass에 저장  │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [2] 초기화 (Initialize)                                                 │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_StateMachine::Initialize()    │                          │
│  │    1. PRIVATE_MachineDescription 로드    │                          │
│  │       = GeneratedClass->BakedStateMachines[                         │
│  │           StateMachineIndexInClass]      │                          │
│  │    2. CurrentState = InitialState        │                          │
│  │    3. ElapsedTime = 0.0f                 │                          │
│  │    4. StatePoseLinks 초기화              │                          │
│  │    5. ActiveTransitionArray.Empty()      │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [3] 매 프레임 업데이트 (Update)                                         │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_StateMachine::Update()        │                          │
│  │  ┌────────────────────────────────────┐  │                          │
│  │  │ A. ElapsedTime += DeltaTime        │  │                          │
│  │  ├────────────────────────────────────┤  │                          │
│  │  │ B. 전환 이벤트 처리                 │  │                          │
│  │  │    - QueuedTransitionEvents 순회   │  │                          │
│  │  │    - 조건 만족 시 전환 시작         │  │                          │
│  │  ├────────────────────────────────────┤  │                          │
│  │  │ C. 현재 상태의 전환 조건 평가        │  │                          │
│  │  │    for (Transition in CurrentState.Transitions)                 │
│  │  │    {                               │  │                          │
│  │  │        if (EvaluateTransitionRule(Transition))                  │
│  │  │        {                           │  │                          │
│  │  │            // 새 전환 시작           │  │                          │
│  │  │            FAnimationActiveTransitionEntry Entry;               │
│  │  │            Entry.PreviousState = CurrentState;                  │
│  │  │            Entry.NextState = Transition.NextState;              │
│  │  │            Entry.CrossfadeDuration = Transition.CrossfadeDuration;│ │
│  │  │            ActiveTransitionArray.Add(Entry);                    │
│  │  │            CurrentState = Transition.NextState;                 │
│  │  │            ElapsedTime = 0.0f;      │  │                          │
│  │  │            break;                   │  │                          │
│  │  │        }                           │  │                          │
│  │  │    }                               │  │                          │
│  │  ├────────────────────────────────────┤  │                          │
│  │  │ D. 활성 전환 업데이트               │  │                          │
│  │  │    for (ActiveTransition in ActiveTransitionArray)              │
│  │  │    {                               │  │                          │
│  │  │        ActiveTransition.ElapsedTime += DeltaTime;               │
│  │  │        ActiveTransition.Alpha =    │  │                          │
│  │  │            CalculateBlendAlpha(...);│  │                          │
│  │  │                                    │  │                          │
│  │  │        if (ElapsedTime >= CrossfadeDuration)                    │
│  │  │        {                           │  │                          │
│  │  │            // 전환 완료, 제거        │  │                          │
│  │  │            ActiveTransitionArray.RemoveAt(i);                   │
│  │  │        }                           │  │                          │
│  │  │    }                               │  │                          │
│  │  └────────────────────────────────────┘  │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [4] 포즈 평가 (Evaluate)                                                │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_StateMachine::Evaluate()      │                          │
│  │  ┌────────────────────────────────────┐  │                          │
│  │  │ A. 현재 상태 포즈 계산              │  │                          │
│  │  │    FPoseContext CurrentStatePose;  │  │                          │
│  │  │    EvaluateState(CurrentState, CurrentStatePose);               │
│  │  ├────────────────────────────────────┤  │                          │
│  │  │ B. 활성 전환 블렌딩                 │  │                          │
│  │  │    if (ActiveTransitionArray.Num() > 0)                         │
│  │  │    {                               │  │                          │
│  │  │        for (ActiveTransition in ActiveTransitionArray)          │
│  │  │        {                           │  │                          │
│  │  │            FPoseContext PrevPose;  │  │                          │
│  │  │            EvaluateState(ActiveTransition.PreviousState, PrevPose);│ │
│  │  │                                    │  │                          │
│  │  │            FPoseContext NextPose;  │  │                          │
│  │  │            EvaluateState(ActiveTransition.NextState, NextPose); │
│  │  │                                    │  │                          │
│  │  │            // 블렌딩                 │  │                          │
│  │  │            switch (ActiveTransition.LogicType)                  │
│  │  │            {                       │  │                          │
│  │  │            case TLT_StandardBlend: │  │                          │
│  │  │                FAnimationRuntime::BlendTwoPoses(               │
│  │  │                    PrevPose,      │  │                          │
│  │  │                    NextPose,      │  │                          │
│  │  │                    ActiveTransition.Alpha,                      │
│  │  │                    Output);        │  │                          │
│  │  │                break;              │  │                          │
│  │  │            case TLT_Inertialization:│  │                          │
│  │  │                // Inertialization 블렌딩 (UE 5.0+)              │
│  │  │                break;              │  │                          │
│  │  │            case TLT_Custom:        │  │                          │
│  │  │                // 커스텀 블렌드 그래프 실행                       │
│  │  │                break;              │  │                          │
│  │  │            }                       │  │                          │
│  │  │        }                           │  │                          │
│  │  │    }                               │  │                          │
│  │  │    else                            │  │                          │
│  │  │    {                               │  │                          │
│  │  │        // 전환 없음, 현재 상태만 출력│  │                          │
│  │  │        Output = CurrentStatePose;  │  │                          │
│  │  │    }                               │  │                          │
│  │  └────────────────────────────────────┘  │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 핵심 기능 (Core Features)

### 1. 전환 조건 (Transition Rules)

**전환 조건 평가:**

```cpp
// Blueprint에서 정의된 조건 예시
// Idle → Walk 전환 조건:
//   Speed > 10.0f

// 런타임 평가 (C++ 코드):
bool EvaluateTransitionRule(const FBakedStateExitTransition& Transition)
{
    // FAnimationTransitionRule의 RuleToExecute 함수 호출
    // (Blueprint 컴파일러가 자동 생성)
    bool bCanTransition = ExecuteTransitionRuleFunction(Transition.RuleIndex);
    return bCanTransition;
}
```

**실전 예시 (Blueprint):**

```
Transition Rule: Idle → Walk

┌────────────────────────────────────────┐
│  [Get Speed] ──> [> 10.0] ──> [Return] │
│                                        │
│  조건: Speed > 10.0f                   │
└────────────────────────────────────────┘

Transition Rule: Walk → Idle

┌────────────────────────────────────────┐
│  [Get Speed] ──> [< 10.0] ──> [Return] │
│                                        │
│  조건: Speed < 10.0f                   │
└────────────────────────────────────────┘
```

---

### 2. 전환 블렌딩 (Transition Blending)

#### **2.1 StandardBlend (표준 블렌딩)**

**📂 위치:** `AnimNode_StateMachine.h:300`

```cpp
// AnimNode_StateMachine.h:300
void EvaluateTransitionStandardBlendInternal(
    FPoseContext& Output,
    FAnimationActiveTransitionEntry& Transition,
    const FPoseContext& PreviousStateResult,
    const FPoseContext& NextStateResult);
```

**동작:**

```
StandardBlend:
┌─────────────────────────────────────────────────────────────────────────┐
│  PreviousState Pose (Idle)    +    NextState Pose (Walk)                │
│  ┌─────────────────┐                 ┌─────────────────┐                │
│  │  Weight: 1-Alpha│                 │  Weight: Alpha  │                │
│  └─────────────────┘                 └─────────────────┘                │
│         ↓                                     ↓                          │
│  ┌────────────────────────────────────────────────────┐                 │
│  │  Output = Lerp(Idle, Walk, Alpha)                 │                 │
│  │         = (1 - Alpha) * Idle + Alpha * Walk        │                 │
│  └────────────────────────────────────────────────────┘                 │
│                                                                          │
│  Alpha 계산:                                                             │
│    Alpha = ElapsedTime / CrossfadeDuration                              │
│    BlendMode에 따라 커브 적용 (Linear, Cubic, EaseIn/Out)                │
└─────────────────────────────────────────────────────────────────────────┘
```

**블렌드 모드:**

```cpp
// AnimTypes.h (EAlphaBlendOption)
enum class EAlphaBlendOption : uint8
{
    Linear,        // 선형 보간 (Alpha = t)
    Cubic,         // 3차 보간 (부드러움)
    HermiteCubic,  // 에르미트 보간
    Sinusoidal,    // 사인 곡선
    QuadraticInOut,// 2차 InOut
    CubicInOut,    // 3차 InOut
    QuarticInOut,  // 4차 InOut
    QuinticInOut,  // 5차 InOut
    CircularIn,    // 원형 In
    CircularOut,   // 원형 Out
    CircularInOut, // 원형 InOut
    ExpIn,         // 지수 In
    ExpOut,        // 지수 Out
    ExpInOut,      // 지수 InOut
    Custom,        // 커스텀 커브 (UCurveFloat)
};
```

**실전 예시:**

```cpp
// ✅ 전환 설정 (Blueprint Editor에서 시각적 설정)
Transition: Walk → Run
  - CrossfadeDuration: 0.25f
  - BlendMode: Cubic (부드러운 전환)
  - BlendProfile: UpperBodyProfile (상체만 빠르게 전환)
```

---

#### **2.2 Inertialization (관성 블렌딩, UE 5.0+)**

**설계 철학: 왜 Inertialization인가?**

```
StandardBlend의 문제:
┌────────────────────────────────────────────────────────────────────┐
│  Idle → Walk 전환 시:                                              │
│  ┌─────────────────────────────────────────┐                       │
│  │  Idle: 손 위치 = (0, 50, 100)           │                       │
│  │  Walk: 손 위치 = (10, 60, 110)          │                       │
│  │  → StandardBlend: 선형 보간              │                       │
│  │  → 손이 부자연스럽게 점프 (Popping)       │                       │
│  └─────────────────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────────┘
                      ↓
        Inertialization 해결책:
┌────────────────────────────────────────────────────────────────────┐
│  관성 유지 (Pose의 속도 및 가속도 고려):                            │
│  ┌─────────────────────────────────────────┐                       │
│  │  1. 현재 Pose의 속도 계산                 │                       │
│  │  2. 목표 Pose로 부드럽게 감속             │                       │
│  │  3. 자연스러운 곡선 경로 생성             │                       │
│  │  → 손이 자연스럽게 이동                   │                       │
│  └─────────────────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────────┘
```

**활성화 방법:**

```
Transition: Walk → Run
  - LogicType: Inertialization
  - CrossfadeDuration: 0.25f  (Inertialization 블렌드 시간)
```

---

#### **2.3 Custom Blend (커스텀 블렌드)**

**사용 시나리오:** 특수한 전환 애니메이션이 필요한 경우

```
Transition: Idle → Crouch
  - LogicType: Custom
  - Custom Blend Graph:
    ┌────────────────────────────────────────┐
    │  [Idle Pose] ──┬──> [Custom Logic]     │
    │  [Crouch Pose]─┘       ↓               │
    │             [Output Pose]              │
    └────────────────────────────────────────┘
```

---

### 3. Conduit (상태 라우팅)

**Conduit란?**
- 복잡한 전환 라우팅을 위한 중간 노드
- 여러 입력 상태 → Conduit → 여러 출력 상태

**사용 시나리오:**

```
복잡한 전환 시나리오:
┌────────────────────────────────────────────────────────────────────┐
│  [Idle] ──┐                                                        │
│  [Walk] ──┼──> [AttackConduit] ──┬──> [LightAttack]               │
│  [Run]  ──┘                       ├──> [HeavyAttack]               │
│                                   └──> [DodgeAttack]               │
│                                                                    │
│  AttackConduit 내부 로직:                                           │
│  - if (bIsHeavyAttack) → HeavyAttack                               │
│  - else if (bIsDodging) → DodgeAttack                              │
│  - else → LightAttack                                              │
└────────────────────────────────────────────────────────────────────┘
```

**구현:**

```cpp
// FBakedAnimationState::bIsAConduit = true

// Conduit 평가 시:
// 1. 입력 상태로부터 전환 가능한지 확인
// 2. Conduit 내부 조건 평가
// 3. 적절한 출력 상태 선택
// 4. 즉시 전환 (블렌드 시간 없음)
```

---

### 4. 전환 이벤트 (Transition Events)

**📂 위치:** `AnimNode_StateMachine.h:337-353`

```cpp
// AnimNode_StateMachine.h:337-353
/** Queues a new transition request, returns true if the transition request was successfully queued */
bool RequestTransitionEvent(const FTransitionEvent& InTransitionEvent);

/** Removes all queued transition requests with the given event name */
void ClearTransitionEvents(const FName& EventName);

/** Removes all queued transition requests*/
void ClearAllTransitionEvents();

/** Returns whether or not the given event transition request has been queued */
bool QueryTransitionEvent(const int32 TransitionIndex, const FName& EventName) const;

/** Behaves like QueryTransitionEvent but additionally marks the event for consumption */
bool QueryAndMarkTransitionEvent(const int32 TransitionIndex, const FName& EventName);

/** Removes all marked events that are queued */
void ConsumeMarkedTransitionEvents();
```

**사용 시나리오: 게임 로직에서 명시적 전환 요청**

```cpp
// ✅ 게임 코드에서 전환 이벤트 요청
void AMyCharacter::PerformAttack()
{
    UAnimInstance* AnimInstance = GetMesh()->GetAnimInstance();
    if (AnimInstance)
    {
        // "Attack" 이벤트 요청
        FTransitionEvent Event;
        Event.EventName = FName(TEXT("Attack"));
        AnimInstance->RequestTransitionEvent(Event);
    }
}

// Transition Rule (Idle → Attack):
// ┌────────────────────────────────────────┐
// │  [Query Transition Event: "Attack"]    │
// │         ↓                              │
// │  [Return: true if event queued]        │
// └────────────────────────────────────────┘
```

---

### 5. State Notifies

**📂 위치:** `AnimStateMachineTypes.h:324-332`

```cpp
// AnimStateMachineTypes.h:324-332
/** The index in the AnimNotifyEventReference array for the entry notify */
int32 StartNotify;

/** The index in the AnimNotifyEventReference array for the exit notify */
int32 EndNotify;

/** The index in the AnimNotifyEventReference array for the fully blended notify */
int32 FullyBlendedNotify;
```

**Notify 발생 시점:**

```
State: Idle

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  State 진입 (Entry):                                                     │
│    ↓                                                                    │
│  [StartNotify 발생]  → OnNotifyBegin_Idle()                             │
│    ↓                                                                    │
│  블렌딩 진행...                                                          │
│    ↓                                                                    │
│  [FullyBlendedNotify 발생]  → OnNotifyFullyBlended_Idle()               │
│    ↓                                                                    │
│  State 내부 실행 중...                                                   │
│    ↓                                                                    │
│  State 종료 (Exit):                                                      │
│    ↓                                                                    │
│  [EndNotify 발생]  → OnNotifyEnd_Idle()                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**사용 예시:**

```cpp
// Blueprint에서 State Notify 이벤트 구현
// State: Walk
//   - Start Notify: OnWalkStarted
//   - End Notify: OnWalkEnded
//   - Fully Blended Notify: OnWalkFullyBlended

void UMyAnimInstance::OnWalkStarted()
{
    // 걷기 시작 시 로직
    PlayFootstepSound();
}

void UMyAnimInstance::OnWalkFullyBlended()
{
    // 완전히 블렌드 완료 후 로직
    EnableWalkEffects();
}

void UMyAnimInstance::OnWalkEnded()
{
    // 걷기 종료 시 로직
    StopFootstepSound();
}
```

---

## 💡 실전 예시 (Practical Examples)

### ✅ 좋은 예: 기본 State Machine 설정

```cpp
UCLASS()
class UMyAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    // Blueprint-visible 변수 (State Transition Rule에서 사용)
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    float Speed;

    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bIsInAir;

    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bIsCrouching;

protected:
    virtual void NativeUpdateAnimation(float DeltaSeconds) override
    {
        Super::NativeUpdateAnimation(DeltaSeconds);

        APawn* Pawn = TryGetPawnOwner();
        if (!Pawn) return;

        // ✅ 매 프레임 변수 업데이트
        // State Machine의 Transition Rule이 이 변수들을 참조함
        Speed = Pawn->GetVelocity().Size();
        bIsInAir = Pawn->GetMovementComponent()->IsFalling();
        bIsCrouching = Pawn->GetMovementComponent()->IsCrouching();
    }
};

// Blueprint State Machine 구조:
// ┌────────────────────────────────────────────────────────────────┐
// │  [Idle] ──Speed > 10──> [Walk] ──Speed > 300──> [Run]         │
// │    ↑                       ↓                       ↓           │
// │    └─────Speed < 10────────┘                       │           │
// │    └──────────────────Speed < 300──────────────────┘           │
// │                                                                │
// │  [Any State] ──bIsInAir──> [Jump/Fall]                        │
// │                              ↓                                 │
// │                       [Landing] ──> [Idle]                     │
// └────────────────────────────────────────────────────────────────┘
```

---

### ✅ 좋은 예: 전환 이벤트 사용

```cpp
UCLASS()
class AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    void PerformDodge()
    {
        UAnimInstance* AnimInstance = GetMesh()->GetAnimInstance();
        if (!AnimInstance) return;

        // ✅ "Dodge" 전환 이벤트 요청
        FTransitionEvent DodgeEvent;
        DodgeEvent.EventName = FName(TEXT("Dodge"));

        if (AnimInstance->RequestTransitionEvent(DodgeEvent))
        {
            // 이벤트 큐에 성공적으로 추가됨
            UE_LOG(LogTemp, Log, TEXT("Dodge transition requested"));
        }
    }

    void PerformAttack()
    {
        UAnimInstance* AnimInstance = GetMesh()->GetAnimInstance();
        if (!AnimInstance) return;

        // ✅ "Attack" 전환 이벤트 요청
        FTransitionEvent AttackEvent;
        AttackEvent.EventName = FName(TEXT("Attack"));
        AnimInstance->RequestTransitionEvent(AttackEvent);
    }
};

// Blueprint State Machine에서:
// Transition Rule (Any State → Dodge):
// ┌────────────────────────────────────────┐
// │  [Query Transition Event: "Dodge"]     │
// │         ↓                              │
// │  [Return: true]                        │
// └────────────────────────────────────────┘
//
// Transition Rule (Idle/Walk/Run → Attack):
// ┌────────────────────────────────────────┐
// │  [Query Transition Event: "Attack"]    │
// │         ↓                              │
// │  [AND] ← [Not Is In Air]               │
// │         ↓                              │
// │  [Return: true]                        │
// └────────────────────────────────────────┘
```

---

### ✅ 좋은 예: Conduit 활용

```cpp
// Conduit를 사용한 복잡한 공격 라우팅

Blueprint State Machine:
┌────────────────────────────────────────────────────────────────────┐
│  [Idle] ──Attack Event──> [AttackConduit]                          │
│  [Walk] ──Attack Event──> [AttackConduit]                          │
│  [Run]  ──Attack Event──> [AttackConduit]                          │
│                                ↓                                   │
│  [AttackConduit 내부 조건:]                                         │
│  ┌─────────────────────────────────────────┐                       │
│  │  if (ComboCount == 1)                   │                       │
│  │      → [LightAttack1]                   │                       │
│  │  else if (ComboCount == 2)              │                       │
│  │      → [LightAttack2]                   │                       │
│  │  else if (ComboCount == 3)              │                       │
│  │      → [LightAttack3]                   │                       │
│  │  else if (bHeavyAttack)                 │                       │
│  │      → [HeavyAttack]                    │                       │
│  └─────────────────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────────┘

// C++ 코드:
UCLASS()
class UMyAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintReadOnly, Category = "Combat")
    int32 ComboCount;

    UPROPERTY(BlueprintReadOnly, Category = "Combat")
    bool bHeavyAttack;

    void IncrementCombo()
    {
        ComboCount = FMath::Clamp(ComboCount + 1, 1, 3);
    }

    void ResetCombo()
    {
        ComboCount = 0;
    }
};
```

---

### ❌ 나쁜 예: 수동 상태 제어 시도

```cpp
// ❌ State Machine을 무시하고 직접 애니메이션 블렌딩
UCLASS()
class UBadAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

protected:
    virtual void NativeUpdateAnimation(float DeltaSeconds) override
    {
        Super::NativeUpdateAnimation(DeltaSeconds);

        // ❌ 수동 블렌딩 시도 (State Machine 무시)
        if (Speed > 300)
        {
            // ❌ PlaySlotAnimationAsDynamicMontage를 State Machine 대신 사용
            // → State Machine 전환이 깨짐
            PlaySlotAnimationAsDynamicMontage(RunAnimation, FName(TEXT("DefaultSlot")));
        }
        else if (Speed > 10)
        {
            PlaySlotAnimationAsDynamicMontage(WalkAnimation, FName(TEXT("DefaultSlot")));
        }
        else
        {
            PlaySlotAnimationAsDynamicMontage(IdleAnimation, FName(TEXT("DefaultSlot")));
        }
    }
};
```

**문제점:**
1. State Machine 전환 로직이 무시됨
2. 블렌딩이 부자연스러움
3. 디버깅 불가능 (현재 상태 추적 안 됨)

**올바른 방법:**

```cpp
// ✅ State Machine 활용
UCLASS()
class UGoodAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    float Speed;

protected:
    virtual void NativeUpdateAnimation(float DeltaSeconds) override
    {
        Super::NativeUpdateAnimation(DeltaSeconds);

        APawn* Pawn = TryGetPawnOwner();
        if (!Pawn) return;

        // ✅ 변수만 업데이트, State Machine이 알아서 전환
        Speed = Pawn->GetVelocity().Size();
    }
};

// State Machine이 자동으로 처리:
// Idle → Walk (Speed > 10)
// Walk → Run (Speed > 300)
// Run → Walk (Speed < 300)
// Walk → Idle (Speed < 10)
```

---

### ❌ 나쁜 예: 전환 조건 과도한 복잡도

```cpp
// ❌ Transition Rule에 복잡한 계산 포함
Transition Rule: Idle → Walk

Blueprint:
┌────────────────────────────────────────┐
│  [Get Speed]                           │
│      ↓                                 │
│  [For Loop 100회]  ← ❌ 매 프레임 실행!│
│      ↓                                 │
│  [복잡한 계산...]                       │
│      ↓                                 │
│  [> 10.0]                              │
│      ↓                                 │
│  [Return]                              │
└────────────────────────────────────────┘
```

**문제점:**
- Transition Rule은 **매 프레임** 평가됨
- 복잡한 계산 시 성능 저하

**올바른 방법:**

```cpp
// ✅ UpdateAnimation에서 미리 계산, Transition Rule은 단순 비교만
UCLASS()
class UGoodAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bShouldWalk;  // ✅ 미리 계산된 결과

protected:
    virtual void NativeUpdateAnimation(float DeltaSeconds) override
    {
        Super::NativeUpdateAnimation(DeltaSeconds);

        APawn* Pawn = TryGetPawnOwner();
        if (!Pawn) return;

        // ✅ 복잡한 계산은 한 번만
        float Speed = Pawn->GetVelocity().Size();
        bool bIsGrounded = !Pawn->GetMovementComponent()->IsFalling();
        bool bHasInput = Pawn->GetLastMovementInputVector().SizeSquared() > 0.01f;

        // ✅ 결과를 변수에 저장
        bShouldWalk = (Speed > 10.0f) && bIsGrounded && bHasInput;
    }
};

// Transition Rule: Idle → Walk
// Blueprint:
// ┌────────────────────────────────────────┐
// │  [Get bShouldWalk]  ← ✅ 단순 변수 읽기│
// │      ↓                                 │
// │  [Return]                              │
// └────────────────────────────────────────┘
```

---

## 📊 성능 최적화 (Performance Optimization)

### ✅ 해야 할 것

**1. Transition Rule 단순화:**

```cpp
// ✅ UpdateAnimation에서 미리 계산
UCLASS()
class UOptimizedAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bCanRun;

    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bCanJump;

protected:
    virtual void NativeUpdateAnimation(float DeltaSeconds) override
    {
        Super::NativeUpdateAnimation(DeltaSeconds);

        APawn* Pawn = TryGetPawnOwner();
        if (!Pawn) return;

        // ✅ 복잡한 조건을 한 번만 계산
        float Speed = Pawn->GetVelocity().Size();
        bool bIsGrounded = !Pawn->GetMovementComponent()->IsFalling();
        bool bHasStamina = GetStamina() > 20.0f;

        bCanRun = (Speed > 300.0f) && bIsGrounded && bHasStamina;
        bCanJump = bIsGrounded && (GetJumpCooldown() <= 0.0f);
    }
};

// Transition Rule에서는 단순 변수만 체크
// Idle → Run:  [Get bCanRun] → [Return]
// Idle → Jump: [Get bCanJump] → [Return]
```

---

**2. MaxTransitionsPerFrame 제한:**

```cpp
// ✅ 프레임당 최대 전환 횟수 제한
// Blueprint State Machine Settings:
//   MaxTransitionsPerFrame: 3  (기본값)
//   → 무한 루프 방지
```

---

**3. 불필요한 State 제거:**

```cpp
// ❌ 나쁜 예: 과도하게 세분화된 상태
// Idle → Walk1 → Walk2 → Walk3 → Run1 → Run2 → Run3
//   → 전환 오버헤드 증가

// ✅ 좋은 예: 합리적인 상태 수
// Idle → Walk → Run
//   → BlendSpace로 세밀한 제어
```

---

**4. Blend Profile 사용 (본별 가중치):**

```cpp
// ✅ 전신 전환 대신 상체만 전환
Transition: Walk → Reload
  - CrossfadeDuration: 0.25f
  - BlendProfile: UpperBodyProfile  ← ✅ 상체만 빠르게 전환
    - Spine 이상: Weight 1.0 (100% 전환)
    - Spine 이하: Weight 0.0 (전환 안 함)
```

---

### ❌ 피해야 할 것

**1. Transition Rule에서 무거운 계산:**

```cpp
// ❌ 매 프레임 실행되는 무거운 계산
Transition Rule: Idle → Walk

Blueprint:
┌────────────────────────────────────────┐
│  [Get All Actors of Class]  ← ❌ 느림! │
│      ↓                                 │
│  [For Each...]                         │
│      ↓                                 │
│  [Distance Check...]                   │
│      ↓                                 │
│  [Return]                              │
└────────────────────────────────────────┘
```

**해결책:** UpdateAnimation에서 미리 계산

---

**2. 과도한 Transition 개수:**

```cpp
// ❌ 모든 상태 간 직접 전환
// Idle ↔ Walk ↔ Run ↔ Jump ↔ Attack ↔ Crouch
//   → N×(N-1) = 30개 전환 (6개 상태)

// ✅ Conduit 사용하여 라우팅
// [Any State] → [AttackConduit] → [Light/Heavy/Special Attack]
//   → 3개 전환으로 단순화
```

---

**3. bSkipFirstUpdateTransition 잘못 사용:**

```cpp
// ❌ 항상 true 설정
StateMachine Settings:
  bSkipFirstUpdateTransition: true  ← ❌ 초기화 로직이 있을 때만!

// 문제: 초기 상태가 즉시 전환 안 됨
// 예: Idle 시작 → Speed가 이미 300 → Run으로 전환 안 됨 (1프레임 지연)
```

**올바른 사용:**

```cpp
// ✅ 초기화가 필요한 경우만
StateMachine Settings:
  bSkipFirstUpdateTransition: true

// 사용 시나리오:
// - NativeInitializeAnimation에서 변수 설정 필요
// - 첫 프레임에 불완전한 데이터로 전환 방지
```

---

## 🔧 디버깅 및 트러블슈팅 (Debugging & Troubleshooting)

### Stat 명령어

```
stat Anim             // 애니메이션 전체 통계
stat AnimNodes        // 개별 노드 비용
```

**주요 지표:**
- **State Machine Update Time**: 전환 조건 평가 시간 (목표: < 0.1ms)
- **State Machine Evaluate Time**: 포즈 블렌딩 시간 (목표: < 0.5ms)
- **Active Transitions**: 활성 전환 개수 (목표: < 3개)

---

### 디버깅 팁

**✅ 현재 상태 확인:**

```cpp
// C++ 코드에서 확인
void UMyAnimInstance::DebugStateMachine()
{
    FName CurrentStateName = GetCurrentStateName();
    float ElapsedTime = GetCurrentStateElapsedTime();

    UE_LOG(LogAnimation, Log, TEXT("Current State: %s, Elapsed: %.2f"),
        *CurrentStateName.ToString(), ElapsedTime);
}
```

**Blueprint:**
```
Event Tick:
  [Get Current State Name] → [Print String]
```

---

**✅ 전환 조건 디버깅:**

```
Transition Rule: Idle → Walk

Blueprint:
┌────────────────────────────────────────┐
│  [Get Speed]                           │
│      ↓                                 │
│  [Print String]  ← ✅ Speed 값 확인    │
│      ↓                                 │
│  [> 10.0]                              │
│      ↓                                 │
│  [Print String]  ← ✅ 결과 확인        │
│      ↓                                 │
│  [Return]                              │
└────────────────────────────────────────┘
```

---

**✅ 전환 이벤트 확인:**

```cpp
// 이벤트가 큐에 들어갔는지 확인
void AMyCharacter::DebugTransitionEvent()
{
    UAnimInstance* AnimInstance = GetMesh()->GetAnimInstance();
    if (!AnimInstance) return;

    // "Attack" 이벤트가 큐에 있는지 확인
    bool bHasEvent = AnimInstance->QueryTransitionEvent(
        AttackTransitionIndex,
        FName(TEXT("Attack"))
    );

    UE_LOG(LogTemp, Log, TEXT("Attack Event Queued: %d"), bHasEvent);
}
```

---

**✅ Pose Watch (에디터 전용):**

**에디터에서 특정 상태의 포즈 시각화:**

1. Animation Blueprint 에디터 열기
2. State Machine Graph에서 상태 노드 우클릭
3. "Toggle Pose Watch" 선택
4. PIE 실행 → 해당 상태의 포즈가 3D 뷰포트에 표시됨

**활용:**
- 전환 블렌딩 확인
- 상태별 포즈 비교
- 애니메이션 오류 검출

---

**✅ 전환이 발생하지 않음:**

```cpp
// 원인 체크:
// 1. Transition Rule 결과 확인
// 2. 현재 상태의 bAlwaysResetOnEntry 확인
// 3. MinTimeBeforeReentry 확인

void DebugTransition()
{
    // Rule 결과 확인
    // Blueprint: Print String in Transition Rule

    // 상태 재진입 시간 확인
    // Transition Settings:
    //   MinTimeBeforeReentry: 0.0f  (즉시 재진입 가능)
}
```

**흔한 원인:**
- Transition Rule 조건 미충족
- MinTimeBeforeReentry 설정 (이전 상태 종료 후 일정 시간 대기)
- bAlwaysResetOnEntry = false (이전 블렌드 완료 전 재진입 금지)

---

**✅ 전환이 너무 빠름:**

```cpp
// CrossfadeDuration 조정
Transition: Walk → Run
  - CrossfadeDuration: 0.05f  ← ❌ 너무 빠름 (부자연스러움)
  - CrossfadeDuration: 0.25f  ← ✅ 적절함
  - CrossfadeDuration: 0.5f   ← 느린 전환 (필요시)
```

---

**✅ 전환 중 다른 전환 발생:**

```cpp
// 전환 중 중간에 끊김 (Idle → Walk → Run)
// Walk가 완전히 블렌드되기 전에 Run으로 전환

// 원인:
// - Transition Rule이 너무 민감
// - CrossfadeDuration이 너무 긺

// 해결책:
// 1. Transition Rule에 쿨다운 추가
// 2. 전환 완료 후에만 다음 전환 허용
void UMyAnimInstance::NativeUpdateAnimation(float DeltaSeconds)
{
    Super::NativeUpdateAnimation(DeltaSeconds);

    // ✅ 현재 상태 경과 시간이 일정 시간 이상일 때만 전환 허용
    if (GetCurrentStateElapsedTime() < 0.2f)
    {
        bCanTransition = false;
    }
    else
    {
        bCanTransition = true;
    }
}

// Transition Rule: Walk → Run
// ┌────────────────────────────────────────┐
// │  [Get Speed] → [> 300]                 │
// │      ↓                                 │
// │  [AND] ← [Get bCanTransition]  ← ✅    │
// │      ↓                                 │
// │  [Return]                              │
// └────────────────────────────────────────┘
```

---

## 🔗 관련 문서 (Related Documents)

- [Overview.md](../Overview.md) - UAF 전체 개요
- [AnimInstance.md](../Core/AnimInstance.md) - 런타임 애니메이션 인스턴스
- [AnimSequence.md](../Core/AnimSequence.md) - 애니메이션 시퀀스 데이터
- [BlendSpace.md](./BlendSpace.md) - 블렌드 스페이스 (다음 문서)
- [AnimMontage.md](./AnimMontage.md) - 몽타주 시스템

---

## 📚 참고 자료 (References)

### 소스 파일
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_StateMachine.h` (367 라인)
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimStateMachineTypes.h` (417 라인)
- `Engine/Source/Runtime/Engine/Private/Animation/AnimNode_StateMachine.cpp`

### 공식 문서
- [Unreal Engine - State Machines](https://docs.unrealengine.com/5.7/en-US/state-machines-in-unreal-engine/)
- [Animation Blueprint](https://docs.unrealengine.com/5.7/en-US/animation-blueprints-in-unreal-engine/)
- [Transition Rules](https://docs.unrealengine.com/5.7/en-US/transition-rules-in-unreal-engine/)

### 주요 API
```cpp
// 상태 쿼리
int32 GetCurrentState() const;
FName GetCurrentStateName() const;
float GetCurrentStateElapsedTime() const;
float GetStateWeight(int32 StateIndex) const;
float GetRelevantAnimTimeRemaining(int32 StateIndex) const;

// 전환 이벤트
bool RequestTransitionEvent(const FTransitionEvent& InTransitionEvent);
void ClearTransitionEvents(const FName& EventName);
void ClearAllTransitionEvents();
bool QueryTransitionEvent(const int32 TransitionIndex, const FName& EventName) const;

// 핵심 인터페이스
virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
virtual void Evaluate_AnyThread(FPoseContext& Output) override;
```

---

> 🔄 **작성일**: 2025-11-07
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7.0
> 📂 **다음 문서**: [BlendSpace.md](./BlendSpace.md)
