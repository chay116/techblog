---
title: "AnimGraph Compilation & Execution Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation"]
engine_version: "Unreal Engine 5.7"
---
# AnimGraph Compilation & Execution Deep Dive

## 🧭 개요 (Overview)

**AnimGraph**는 Unreal Engine의 **Animation Blueprint** 시스템에서 애니메이션 로직을 시각적으로 구성하는 노드 기반 그래프입니다. 이 문서는 에디터에서 작성한 AnimGraph가 **어떻게 컴파일되고 런타임에서 실행되는지** 분석합니다.

### 핵심 개념

| 개념 | 설명 | 효과 |
|------|------|------|
| **Visual Node (Editor)** | 에디터에서 보이는 비주얼 노드 (UAnimGraphNode_Base) | Blueprint 편집, 프로퍼티 설정 |
| **Runtime Node (FAnimNode_Base)** | 실제로 실행되는 런타임 노드 (컴파일된 결과) | 애니메이션 평가, Pose 생성 |
| **Property Folding** | 상수 프로퍼티를 별도 구조체로 분리 | 메모리 절약, Cache 효율성 |
| **Node Index** | 각 노드에 부여되는 고유 인덱스 | 빠른 노드 접근, Debugging |
| **Pose Link** | 노드 간 Pose 데이터 흐름 연결 | 애니메이션 파이프라인 구성 |

**핵심 철학:**
> 에디터의 비주얼 노드는 "설계도(Blueprint)",
> 런타임 노드는 "실행 바이너리"

---

## 🏗️ 아키텍처 계층 구조 (Architecture Layers)

AnimGraph 시스템은 **3계층**으로 구성됩니다:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 1: Editor (Authoring)                       │
│  에디터에서 Blueprint 작성                                             │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐  ┌───────────────────────┐              │
│  │ UAnimGraphNode_Base    │  │ UAnimBlueprint        │              │
│  │ - Visual Node          │  │ - Graph Container     │              │
│  │ - Pin Connections      │  │ - Asset               │              │
│  │ - Property UI          │  │ - Compiler Settings   │              │
│  └───────────┬───────────┘  └───────────┬───────────┘              │
│              └───────────┬──────────────┘                           │
│                          ↓                                           │
│              [Serialize to .uasset]                                 │
└──────────────────────────┼──────────────────────────────────────────┘
                           ↓ 컴파일
┌─────────────────────────────────────────────────────────────────────┐
│                Layer 2: Compilation (Cook Time)                      │
│  FAnimBlueprintCompilerContext에서 변환                               │
├─────────────────────────────────────────────────────────────────────┤
│  Process 1: CreateClassVariablesFromBlueprint                       │
│    - Visual Node → Runtime Node Property 생성                        │
│    - FAnimNode_* 구조체를 Generated Class에 추가                      │
│                                                                      │
│  Process 2: ProcessAnimationNodes                                   │
│    - 노드 그래프 순회 (Root → Leaf)                                  │
│    - AllocatedAnimNodes Map 생성                                    │
│    - Node Index 할당 (AllocateNodeIndexCounter)                     │
│                                                                      │
│  Process 3: Property Folding                                        │
│    - Constant Properties → AnimBlueprintConstants struct            │
│    - Mutable Properties → AnimBlueprintMutables struct               │
│                                                                      │
│  Output: UAnimBlueprintGeneratedClass (Compiled Asset)              │
└──────────────────────────┼──────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                  Layer 3: Runtime Execution                          │
│  게임 실행 중 - FAnimInstanceProxy에서 평가                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐                  │
│  │ UAnimInstance       │  │ FAnimInstanceProxy  │                  │
│  │ (Game Thread)       │  │ (Worker Thread)     │                  │
│  │ - UObject Wrapper   │  │ - Actual Execution  │                  │
│  │ - Blueprint VM      │  │ - Update/Evaluate   │                  │
│  └──────────┬──────────┘  └──────────┬──────────┘                  │
│             └────────┬───────────────┘                              │
│                      ↓                                               │
│  Update Phase: FAnimNode_Base::Update()                             │
│    - DeltaTime 전파                                                  │
│    - Sync Group 구성                                                 │
│                      ↓                                               │
│  Evaluate Phase: FAnimNode_Base::Evaluate_AnyThread()               │
│    - Pose 계산 (Bone Transforms)                                     │
│    - Curve 평가                                                      │
│                      ↓                                               │
│  Output: FCompactPose (Bone Transforms + Curves)                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📐 계층별 상세 분석 (Detailed Layer Analysis)

### Layer 1: Editor Authoring (에디터 작성)

#### 1.1 **UAnimGraphNode_Base - 비주얼 노드**

**📂 위치:** `Engine/Source/Editor/AnimGraph/Public/AnimGraphNode_Base.h`

에디터에서 보이는 모든 애니메이션 노드는 `UAnimGraphNode_Base`를 상속합니다.

```cpp
// AnimGraphNode_Base.h (simplified)
UCLASS(Abstract)
class UAnimGraphNode_Base : public UK2Node
{
    GENERATED_UCLASS_BODY()

    /** Visual representation in editor */
    FText NodeTitle;
    FLinearColor NodeColor;

    /** The actual runtime node embedded within */
    // 예시: FAnimNode_BlendListByInt, FAnimNode_StateMachine 등
    // 각 서브클래스에서 UPROPERTY()로 정의

    /** Pin connections */
    TArray<UEdGraphPin*> Pins;

    /** Customization for property display */
    virtual void CustomizePinData(UEdGraphPin* Pin, ...);
    virtual FText GetNodeTitle(...);
};
```

**주요 서브클래스:**
- `UAnimGraphNode_StateMachine` - State Machine 노드
- `UAnimGraphNode_BlendSpacePlayer` - BlendSpace 재생 노드
- `UAnimGraphNode_SequencePlayer` - Animation Sequence 재생 노드
- `UAnimGraphNode_LayeredBoneBlend` - Layered Bone Blend 노드

**특징:**
- 에디터 전용 (`WITH_EDITOR` 매크로로 보호)
- UObject 기반 - Serialization 지원
- Pin 연결 정보 저장 (Pose Link, Boolean, Float 등)

#### 1.2 **런타임 노드 임베딩**

각 비주얼 노드는 **런타임 노드 (FAnimNode_*)를 내부에 포함**합니다:

```cpp
// UAnimGraphNode_BlendSpacePlayer.h
UCLASS()
class UAnimGraphNode_BlendSpacePlayer : public UAnimGraphNode_AssetPlayerBase
{
    GENERATED_BODY()

    /** The actual runtime node that will execute */
    UPROPERTY(EditAnywhere, Category = Settings)
    FAnimNode_BlendSpacePlayer Node;  // 🔑 Runtime Node 임베딩

    // ... Editor-only methods ...
};
```

**임베딩 패턴:**
```
UAnimGraphNode_XXX (Editor)
    ↓ contains
FAnimNode_XXX (Runtime)
```

### Layer 2: Compilation (컴파일 프로세스)

#### 2.1 **FAnimBlueprintCompilerContext - 컴파일러 핵심**

**📂 위치:** `Engine/Source/Editor/AnimGraph/Private/AnimBlueprintCompiler.h:42`

```cpp
// AnimBlueprintCompiler.h:42
class FAnimBlueprintCompilerContext : public FKismetCompilerContext
{
protected:
    // 컴파일된 상수/가변 구조체
    UScriptStruct* NewAnimBlueprintConstants;  // 불변 프로퍼티
    UScriptStruct* NewAnimBlueprintMutables;   // 가변 프로퍼티
    FStructProperty* NewMutablesProperty;

    UAnimBlueprint* AnimBlueprint;
    UAnimationGraphSchema* AnimSchema;

    // 노드 매핑
    TMap<UAnimGraphNode_Base*, FProperty*> AllocatedAnimNodes;         // 비주얼 노드 → 런타임 프로퍼티
    TMap<FProperty*, UAnimGraphNode_Base*> AllocatedNodePropertiesToNodes;
    TMap<UAnimGraphNode_Base*, int32> AllocatedAnimNodeIndices;       // 노드 → 인덱스

    // 노드 인덱스 카운터
    int32 AllocateNodeIndexCounter;

    // Pose Link 검증
    TArray<FPoseLinkMappingRecord> ValidPoseLinkList;
};
```

**핵심 멤버 변수:**

| 변수 | 타입 | 역할 |
|------|------|------|
| `AllocatedAnimNodes` | `TMap<UAnimGraphNode_Base*, FProperty*>` | 비주얼 노드를 런타임 프로퍼티로 매핑 |
| `AllocatedAnimNodeIndices` | `TMap<UAnimGraphNode_Base*, int32>` | 각 노드에 고유 인덱스 부여 |
| `NewAnimBlueprintConstants` | `UScriptStruct*` | 컴파일타임 상수 저장 (Folded) |
| `NewAnimBlueprintMutables` | `UScriptStruct*` | 런타임 가변 데이터 저장 |

#### 2.2 **컴파일 단계 (Compilation Phases)**

**프로세스 순서 (전체 8단계):**

```
1. CreateClassVariablesFromBlueprint()     [Phase 1: Pre-Processing]
   ↓
2. MergeUbergraphPagesIn(Ubergraph)        [Phase 2: Graph Expansion]
   ↓
3. ProcessAllAnimationNodes()              [Phase 3: Animation Graph Processing]
   ↓
4. PruneIsolatedAnimationNodes()           [Phase 4: Graph Pruning]
   ↓
5. BakeStateMachines()                     [Phase 5: State Machine Baking]
   ↓
6. ProcessFoldedPropertyRecords()          [Phase 6: Property Folding + Access Optimization]
   ↓
7. CopyTermDefaultsToDefaultObject()       [Phase 7: CDO Construction]
   ↓
8. PostCompile()                           [Phase 8: Post-Compilation]
```

**단계별 상세:**

##### Phase 1: CreateClassVariablesFromBlueprint()

**📂 위치:** `AnimBlueprintCompiler.cpp` (구현)

```cpp
// 의사코드
void FAnimBlueprintCompilerContext::CreateClassVariablesFromBlueprint()
{
    // 1. 새로운 Constants/Mutables 구조체 생성
    RecreateMutables();

    // 2. 각 비주얼 노드를 순회
    for (UAnimGraphNode_Base* VisualNode : AllAnimGraphNodes)
    {
        // 3. 런타임 노드 타입 추출
        UScriptStruct* NodeType = VisualNode->GetFNodeType();  // e.g., FAnimNode_BlendSpacePlayer

        // 4. Generated Class에 프로퍼티 생성
        FProperty* RuntimeProperty = CreateUniqueVariable(VisualNode, NodeType);

        // 5. 매핑 등록
        AllocatedAnimNodes.Add(VisualNode, RuntimeProperty);
        AllocatedNodePropertiesToNodes.Add(RuntimeProperty, VisualNode);
    }
}
```

**생성되는 클래스 구조:**

```cpp
// 컴파일 전 (Editor)
UAnimBlueprint
    └─ UEdGraph (AnimGraph)
        ├─ UAnimGraphNode_SequencePlayer (Visual)
        └─ UAnimGraphNode_BlendListByInt (Visual)

// 컴파일 후 (Generated Class)
UAnimBlueprintGeneratedClass_C
    ├─ FAnimNode_SequencePlayer AnimGraphNode_12;    // 🔑 런타임 노드 프로퍼티
    ├─ FAnimNode_BlendListByInt AnimGraphNode_34;    // 🔑 런타임 노드 프로퍼티
    ├─ FAnimBlueprintConstants Constants;            // 🔑 상수 데이터
    └─ FAnimBlueprintMutables Mutables;              // 🔑 가변 데이터
```

##### Phase 2: ProcessAllAnimationNodes()

**📂 위치:** `AnimBlueprintCompiler.h:156`

```cpp
// AnimBlueprintCompiler.h:156
void FAnimBlueprintCompilerContext::ProcessAllAnimationNodes()
{
    // 1. Root 노드 찾기 (Output Pose)
    TArray<UAnimGraphNode_Base*> RootSet;
    FindRootNodes(RootSet);  // e.g., UAnimGraphNode_Root

    // 2. Root에서 시작하여 연결된 모든 노드 수집
    TArray<UAnimGraphNode_Base*> GraphNodes;
    GetLinkedAnimNodes(RootSet[0], GraphNodes);

    // 3. 고립된 노드 제거 (Pruning)
    PruneIsolatedAnimationNodes(RootSet, GraphNodes);

    // 4. 각 노드 처리
    ProcessAnimationNodes(GraphNodes);
}
```

**노드 처리 과정:**

```cpp
// AnimBlueprintCompiler.h:150
void FAnimBlueprintCompilerContext::ProcessAnimationNode(UAnimGraphNode_Base* VisualAnimNode)
{
    // 1. 노드 인덱스 할당
    int32 NodeIndex = AllocateNodeIndexCounter++;
    AllocatedAnimNodeIndices.Add(VisualAnimNode, NodeIndex);

    // 2. Pose Link 검증 및 등록
    ValidatePoseLinks(VisualAnimNode);

    // 3. Property Folding 레코드 생성
    GatherFoldRecordsForAnimationNode(VisualAnimNode);
}
```

**Node Index 할당 규칙:**

```
Root Node = Index 0
├─ Child Node 1 = Index 1
│   └─ Grandchild Node 2 = Index 2
└─ Child Node 3 = Index 3
```

**중요:** 인덱스 순서는 **Property Chain 순서**와 일치해야 합니다 (런타임 탐색 때문).

##### Phase 3: Property Folding (프로퍼티 분리)

**📂 위치:** `AnimBlueprintCompiler.h:206`

**목적:** **메모리 최적화** - 상수 데이터를 별도 구조체로 분리하여 Cache 효율성 향상

```cpp
// AnimBlueprintCompiler.h:206
void FAnimBlueprintCompilerContext::ProcessFoldedPropertyRecords()
{
    for (auto& Record : ConstantPropertyRecords)
    {
        // Constants 구조체에 프로퍼티 추가
        FProperty* NewProperty = CreateStructVariable(
            NewAnimBlueprintConstants,
            Record->PropertyName,
            Record->PropertyType
        );

        // 기본값 복사
        CopyPropertyValue(Record->SourceProperty, NewProperty);
    }

    for (auto& Record : MutablePropertyRecords)
    {
        // Mutables 구조체에 프로퍼티 추가
        FProperty* NewProperty = CreateStructVariable(
            NewAnimBlueprintMutables,
            Record->PropertyName,
            Record->PropertyType
        );
    }
}
```

**분리 기준:**

```cpp
// FAnimNode_SequencePlayer 예시
struct FAnimNode_SequencePlayer
{
    // ===== Constants (Folded) =====
    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    UAnimSequence* Sequence;  // 🔸 상수 - 게임 중 변경 안 함

    UPROPERTY(EditAnywhere)
    float PlayRate;           // 🔸 상수 (Pin에 연결 안 됨)

    // ===== Mutables (Not Folded) =====
    UPROPERTY()
    float InternalTimeAccumulator;  // 🔹 가변 - 매 프레임 업데이트

    UPROPERTY()
    float CurrentBlendWeight;       // 🔹 가변 - 런타임 계산
};
```

**메모리 레이아웃 비교:**

```
[Before Folding - All in One Struct]
┌─────────────────────────────────────────────┐
│  FAnimNode_SequencePlayer (96 bytes)        │
│  ┌─────────────────────────────────────────┐│
│  │ Sequence*          (8 bytes)            ││ ← 상수
│  │ PlayRate           (4 bytes)            ││ ← 상수
│  │ bLooping           (1 byte)             ││ ← 상수
│  │ InternalTime       (4 bytes)            ││ ← 가변
│  │ CurrentWeight      (4 bytes)            ││ ← 가변
│  │ ... (다른 필드들)                         ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
   ↑ 모든 데이터가 섞여 있음 - Cache Miss 증가


[After Folding - Separated]
┌─────────────────────────────────────────────┐
│  AnimBlueprintConstants (16 bytes)          │
│  ┌─────────────────────────────────────────┐│
│  │ Node12_Sequence*   (8 bytes)            ││ ← 상수만
│  │ Node12_PlayRate    (4 bytes)            ││ ← 상수만
│  │ Node12_bLooping    (1 byte)             ││ ← 상수만
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
   ↑ 한 번만 로드, 읽기 전용

┌─────────────────────────────────────────────┐
│  AnimBlueprintMutables (8 bytes)            │
│  ┌─────────────────────────────────────────┐│
│  │ Node12_InternalTime  (4 bytes)          ││ ← 가변만
│  │ Node12_CurrentWeight (4 bytes)          ││ ← 가변만
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
   ↑ 매 프레임 업데이트, Hot Cache
```

**성능 이점:**
- ✅ **Cache 효율성**: 가변 데이터만 자주 접근 → L1 Cache Hit Rate ↑
- ✅ **메모리 절약**: Constants는 모든 인스턴스가 공유
- ✅ **Copy 성능**: Mutables만 복사하면 됨 (Linked Anim Instance)

##### Phase 4: Graph Pruning (고립된 노드 제거)

**📂 위치:** `AnimBlueprintCompiler.h:147`

컴파일 시 Root 노드에서 도달할 수 없는 고립된 노드는 제거됩니다:

```cpp
// AnimBlueprintCompiler.h:147
void FAnimBlueprintCompilerContext::PruneIsolatedAnimationNodes(
    const TArray<UAnimGraphNode_Base*>& RootSet,
    TArray<UAnimGraphNode_Base*>& GraphNodes)
{
    // 1. Root 노드부터 BFS/DFS 트래버스
    TSet<UAnimGraphNode_Base*> ReachableNodes;
    for (UAnimGraphNode_Base* Root : RootSet)
    {
        TraverseAnimGraph(Root, ReachableNodes);
    }

    // 2. 도달 불가능한 노드 제거
    for (int32 i = GraphNodes.Num() - 1; i >= 0; --i)
    {
        if (!ReachableNodes.Contains(GraphNodes[i]))
        {
            GraphNodes.RemoveAt(i);  // 제거
        }
    }
}
```

**Pruning 예시:**
```
컴파일 전:
[Root] → [BlendSpace] → [Final Pose]
             ↑
[StateMachine] (연결 안 됨)  ← 제거됨!
[IK Node] (연결 안 됨)        ← 제거됨!

컴파일 후:
[Root] → [BlendSpace] → [Final Pose]
// 고립된 노드는 컴파일되지 않음
```

##### Phase 5: State Machine Baking

**📂 위치:** `AnimBlueprintCompiler.cpp`

State Machine 그래프는 런타임용 `FBakedAnimationStateMachine`으로 베이킹됩니다:

```
Editor Graph:
┌────────────────────────────────────────┐
│  State Machine Graph                   │
│  - [Idle] → [Walk] → [Run]             │
│  - Transition Rules (BP 노드 그래프)   │
│  - Conduit                             │
└────────────────────────────────────────┘
        ↓ Baking
Runtime Data:
┌────────────────────────────────────────┐
│  FBakedAnimationStateMachine           │
│  ┌──────────────────────────────────┐  │
│  │ States[]                         │  │
│  │   [0] Idle                       │  │
│  │   [1] Walk                       │  │
│  │   [2] Run                        │  │
│  │                                  │  │
│  │ Transitions[]                    │  │
│  │   [0] Idle→Walk (Rule 베이킹)    │  │
│  │   [1] Walk→Run (Rule 베이킹)     │  │
│  │                                  │  │
│  │ InitialState: 0 (Idle)           │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**Transition Rule Baking:**
```
Editor: Transition Rule (BP Graph)
┌────────────────────────────────────────┐
│  [Get Speed] → [> 300.0] → [Return]    │
└────────────────────────────────────────┘
        ↓ 컴파일
Runtime: Baked Rule (Native Function)
┌────────────────────────────────────────┐
│  bool EvaluateRule_IdleToWalk()        │
│  {                                     │
│      return (Speed > 300.0f);          │
│  }                                     │
└────────────────────────────────────────┘
```

##### Phase 6: Property Access Optimization

컴파일 시 Blueprint의 함수 호출을 직접 메모리 접근으로 최적화합니다:

**Naive 방식 (Blueprint):**
```cpp
// ❌ Blueprint에서 매 프레임:
float Speed = GetOwningComponent()->GetVelocity().Size();
// → UFunction 호출 오버헤드
```

**Optimized 방식 (Property Access):**
```cpp
// ✅ 컴파일 시 최적화:
// Direct memory offset access
float Speed = *(float*)(InstancePtr + SpeedPropertyOffset);
// → 직접 메모리 접근 (10-100배 빠름)
```

**Property Access Library:**
```
FPropertyAccessLibrary
┌────────────────────────────────────────┐
│  PropertyPaths[]                       │
│    [0] "Speed" → offset 0x120          │
│    [1] "Direction" → offset 0x124      │
│    [2] "bIsInAir" → offset 0x128       │
└────────────────────────────────────────┘
런타임에 offset 기반 직접 접근
```

##### 컴파일 결과물: UAnimBlueprintGeneratedClass

**📂 소스 검증:** `AnimBlueprintGeneratedClass.h:364-400`

```
UAnimBlueprint (Editor Asset)
       ↓ 컴파일
UAnimBlueprintGeneratedClass (Runtime Class)
┌─────────────────────────────────────────────────────────────────────────┐
│  BakedStateMachines[] : TArray<FBakedAnimationStateMachine>            │
│    - State Machine 구조가 베이킹됨                                       │
│  AnimNotifies[] : TArray<FAnimNotifyEvent>                             │
│    - 모든 Notify 이벤트 배열                                            │
│  OrderedSavedPoseIndicesMap : TMap<FName, FCachedPoseIndices>         │
│    - Cached Pose 업데이트 순서                                          │
│  AnimNodeProperties[] : TArray<FStructProperty*>                       │
│    - 모든 AnimNode 프로퍼티 배열 (런타임)                                │
│  TargetSkeleton : USkeleton*                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layer 3: Runtime Execution (런타임 실행)

#### 3.1 **UAnimInstance vs FAnimInstanceProxy**

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h:352`
- `Engine/Source/Runtime/Engine/Public/Animation/AnimInstanceProxy.h:143`

**분리 이유:** **Multi-Threading**

```cpp
// AnimInstance.h:352
UCLASS(transient, Blueprintable)
class UAnimInstance : public UObject  // 🔸 Game Thread
{
    GENERATED_UCLASS_BODY()

    /** Proxy object for multi-threaded execution */
    FAnimInstanceProxy* GetProxyOnAnyThread()
    {
        return &AnimInstanceProxy;  // 실제 실행은 Proxy에서
    }

    /** Blueprint-callable functions (Game Thread) */
    UFUNCTION(BlueprintCallable)
    void PlayMontage(UAnimMontage* Montage);

protected:
    /** The actual proxy that does the work */
    FAnimInstanceProxy AnimInstanceProxy;  // 🔑 Worker Thread에서 실행
};
```

**역할 분담:**

| 클래스 | 스레드 | 역할 |
|--------|--------|------|
| **UAnimInstance** | Game Thread | UObject Wrapper, Blueprint VM, Montage 제어 |
| **FAnimInstanceProxy** | Worker Thread | 실제 Update/Evaluate, Pose 계산 |

**멀티스레딩 흐름:**

```
Game Thread (UAnimInstance)
    │
    ├─ NativeUpdateAnimation() → Blueprint Event Graph 실행
    │
    └─ PreUpdateAnimation()
        │
        ↓ Dispatch to Worker Thread
        ┌─────────────────────────────────────────────┐
        │ Worker Thread (FAnimInstanceProxy)          │
        │                                             │
        │  UpdateAnimation()                          │
        │    ↓                                        │
        │  EvaluateAnimationNode()                    │
        │    ↓                                        │
        │  FCompactPose 생성                          │
        └─────────────────────────────────────────────┘
        ↑ Sync Point
    PostUpdateAnimation() → 결과 수집
```

#### 3.2 **FAnimInstanceProxy 구조**

**📂 위치:** `Engine/Source/Runtime/Engine/Public/Animation/AnimInstanceProxy.h:143`

```cpp
// AnimInstanceProxy.h:143
USTRUCT(meta = (DisplayName = "Native Variables"))
struct FAnimInstanceProxy
{
    GENERATED_USTRUCT_BODY()

    // === 핵심 데이터 ===
    IAnimClassInterface* AnimClassInterface;        // Generated Class 인터페이스
    UObject* AnimInstanceObject;                     // UAnimInstance 참조
    USkeleton* Skeleton;                            // 현재 스켈레톤
    USkeletalMeshComponent* SkeletalMeshComponent;  // 메시 컴포넌트

    // === Bone 관련 ===
    FBoneContainer* RequiredBones;                  // LOD별 필요 본 목록
    int32 LODLevel;                                 // 현재 LOD

    // === Update/Evaluate Counters ===
    FGraphTraversalCounter InitializationCounter;   // 초기화 추적
    FGraphTraversalCounter UpdateCounter;           // Update 추적
    FGraphTraversalCounter EvaluationCounter;       // Evaluate 추적

    // === Sync Groups (동기화) ===
    UE::Anim::FAnimSync Sync;                       // Sync Group 관리

    // === Root Motion ===
    FRootMotionMovementParams ExtractedRootMotion;  // 추출된 Root Motion

    // === 주요 메서드 ===
    void UpdateAnimation();
    void EvaluateAnimation(FPoseContext& Output);

    // 노드 접근 (Index 기반)
    template<class NodeType>
    NodeType* GetMutableNodeFromIndex(int32 NodeIdx);
};
```

**핵심 멤버 해설:**

- `AnimClassInterface`: 컴파일된 클래스의 AnimNode 배열에 접근
- `RequiredBones`: LOD에 따라 필요한 본만 계산 (최적화)
- `UpdateCounter/EvaluationCounter`: 그래프 순환 탐지 방지
- `Sync`: 여러 애니메이션 동기화 (예: 걷기 + 상체 총 겨누기)

#### 3.3 **노드 실행 인터페이스 (FAnimNode_Base)**

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNodeBase.h:21`

모든 런타임 노드는 `FAnimNode_Base`를 상속합니다:

```cpp
// AnimNodeBase.h (simplified)
USTRUCT()
struct FAnimNode_Base
{
    GENERATED_USTRUCT_BODY()

    /** Called once when the node is initialized */
    virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context);

    /** Called when cached bones need refreshing (LOD change) */
    virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context);

    /** Update phase - propagate DeltaTime, build sync groups */
    virtual void Update_AnyThread(const FAnimationUpdateContext& Context);

    /** Evaluate phase - calculate final pose */
    virtual void Evaluate_AnyThread(FPoseContext& Output);

    /** Get pose links for graph traversal */
    virtual void GatherDebugData(FNodeDebugData& DebugData);
};
```

**실행 단계:**

```
1. Initialize_AnyThread()
   - 노드 초기화 (한 번만 호출)
   - 내부 상태 설정

2. CacheBones_AnyThread()
   - LOD 변경 시 호출
   - Bone Index 캐싱

3. Update_AnyThread(DeltaTime)
   - 시간 진행
   - Sync Group 구성
   - Asset Player 틱

4. Evaluate_AnyThread(Output)
   - 최종 Pose 계산
   - Bone Transform 생성
```

#### 3.4 **Update Phase 상세**

**프로세스:**

```cpp
// 의사코드
void FAnimNode_StateMachine::Update_AnyThread(const FAnimationUpdateContext& Context)
{
    // 1. 현재 State 확인
    int32 CurrentState = GetCurrentState();

    // 2. Transition 체크
    if (CheckTransitionConditions())
    {
        CurrentState = TransitionToNewState();
    }

    // 3. 현재 State의 노드들 Update
    FAnimationUpdateContext StateContext = Context.FractionalWeight(GetStateWeight());
    StatePoseLinks[CurrentState].Update(StateContext);
}
```

**FAnimationUpdateContext 전파:**

```
Root Node (Weight = 1.0)
    ↓
BlendListByInt Node
    ├─ Child 0 (Weight = 0.3)  ← Context.FractionalWeight(0.3)
    ├─ Child 1 (Weight = 0.5)  ← Context.FractionalWeight(0.5)
    └─ Child 2 (Weight = 0.2)  ← Context.FractionalWeight(0.2)
```

#### 3.5 **Evaluate Phase 상세**

**FPoseContext 구조:**

```cpp
// PoseContext.h (simplified)
struct FPoseContext
{
    FCompactPose Pose;              // Bone Transforms (Local Space)
    FBlendedCurve Curve;            // Animation Curves
    UE::Anim::FHeapAttributeContainer CustomAttributes;  // Custom Attributes

    FAnimInstanceProxy* AnimInstanceProxy;  // Proxy 참조
};
```

**FCompactPose:**

```cpp
struct FCompactPose
{
    TArray<FTransform> Bones;  // Bone Transforms (Compact Index로 접근)
    FBoneContainer& BoneContainer;

    // Compact Index = LOD에 맞게 압축된 인덱스
    // 예: LOD 0에서 150개 본 → LOD 2에서 50개 본으로 압축
};
```

**Evaluate 예시 (BlendListByInt):**

```cpp
void FAnimNode_BlendListByInt::Evaluate_AnyThread(FPoseContext& Output)
{
    // 1. 활성 자식 노드들의 Pose 평가
    TArray<FPoseContext> ChildPoses;
    for (int32 i = 0; i < BlendPose.Num(); ++i)
    {
        if (BlendWeights[i] > ZERO_ANIMWEIGHT_THRESH)
        {
            FPoseContext ChildPose(Output);
            BlendPose[i].Evaluate(ChildPose);
            ChildPoses.Add(ChildPose);
        }
    }

    // 2. Blend
    Output.Pose.BlendPoses(ChildPoses, BlendWeights);
    Output.Curve.Blend(ChildCurves, BlendWeights);
}
```

---

## 🔧 노드 접근 메커니즘 (Node Access Mechanism)

### Index 기반 접근

**📂 위치:** `AnimInstanceProxy.h:296`

```cpp
// AnimInstanceProxy.h:296
template<class NodeType>
NodeType* FAnimInstanceProxy::GetMutableNodeFromIndex(int32 NodeIdx)
{
    // 1. AnimClassInterface에서 노드 배열 가져오기
    const TArray<FStructProperty*>& AnimNodeProperties =
        AnimClassInterface->GetAnimNodeProperties();

    // 2. Index 범위 체크
    if (NodeIdx >= 0 && NodeIdx < AnimNodeProperties.Num())
    {
        FStructProperty* Property = AnimNodeProperties[NodeIdx];

        // 3. Property에서 노드 포인터 추출
        void* NodePtr = Property->ContainerPtrToValuePtr<void>(AnimInstanceObject);

        return static_cast<NodeType*>(NodePtr);
    }

    return nullptr;
}
```

**사용 예시:**

```cpp
// State Machine 노드 가져오기
FAnimNode_StateMachine* StateMachine =
    AnimInstanceProxy->GetMutableNodeFromIndex<FAnimNode_StateMachine>(5);

if (StateMachine)
{
    int32 CurrentState = StateMachine->GetCurrentState();
}
```

### Property Chain 탐색

**컴파일러가 생성하는 순서:**

```cpp
// Generated Class
UCLASS()
class UMyAnimInstance_C : public UAnimInstance
{
    GENERATED_BODY()

    // Index 0
    UPROPERTY()
    FAnimNode_Root AnimGraphNode_Root;

    // Index 1
    UPROPERTY()
    FAnimNode_StateMachine AnimGraphNode_StateMachine_1;

    // Index 2
    UPROPERTY()
    FAnimNode_SequencePlayer AnimGraphNode_SequencePlayer_2;

    // Index 3
    UPROPERTY()
    FAnimNode_BlendListByInt AnimGraphNode_BlendListByInt_3;
};
```

**중요:** Property 선언 순서 = Node Index 순서

---

## 🧪 실전 예시 (Practical Examples)

### 예시 1: Simple AnimGraph 컴파일 과정

**에디터에서 작성:**

```
[AnimGraph]
    SequencePlayer (Walk Animation)
        ↓ (Pose Link)
    Output Pose
```

**컴파일 후 Generated Class:**

```cpp
UCLASS()
class UWalkAnimBP_C : public UAnimInstance
{
    // Index 0 - Root
    UPROPERTY()
    FAnimNode_Root AnimGraphNode_Root_0;

    // Index 1 - Sequence Player
    UPROPERTY()
    FAnimNode_SequencePlayer AnimGraphNode_SequencePlayer_1;

    // Constants (Folded)
    UPROPERTY()
    FMyAnimBPConstants Constants;
        // Constants.Node1_Sequence = WalkAnimation_Asset
        // Constants.Node1_PlayRate = 1.0f
};
```

**런타임 실행:**

```cpp
// Update Phase
void UWalkAnimBP_C::UpdateAnimation(float DeltaTime)
{
    // 1. Get Proxy
    FAnimInstanceProxy* Proxy = GetProxyOnAnyThread();

    // 2. Update Root Node
    FAnimNode_Root* RootNode = Proxy->GetMutableNodeFromIndex<FAnimNode_Root>(0);
    RootNode->Update_AnyThread(Context);
        // → 내부적으로 SequencePlayer Update 호출

    // 3. SequencePlayer가 시간 누적
    FAnimNode_SequencePlayer* SeqPlayer = Proxy->GetMutableNodeFromIndex<FAnimNode_SequencePlayer>(1);
    // SeqPlayer->InternalTimeAccumulator += DeltaTime * PlayRate;
}

// Evaluate Phase
void UWalkAnimBP_C::EvaluateAnimationNode(FPoseContext& Output)
{
    // 1. Root Node Evaluate
    FAnimNode_Root* RootNode = Proxy->GetMutableNodeFromIndex<FAnimNode_Root>(0);
    RootNode->Evaluate_AnyThread(Output);
        // → 내부적으로 SequencePlayer Evaluate 호출

    // 2. SequencePlayer가 Pose 생성
    // Output.Pose.Bones[0..N] = WalkAnimation->GetBoneTransform(Time);
}
```

### 예시 2: State Machine 실행

**에디터:**

```
[State Machine]
    Idle State
        ├─ Transition to Walk (Speed > 0.1)
        └─ Idle Animation Sequence

    Walk State
        ├─ Transition to Idle (Speed < 0.1)
        └─ Walk Animation Sequence
```

**컴파일 후:**

```cpp
UCLASS()
class UCharacterAnimBP_C : public UAnimInstance
{
    // Index 0 - Root
    FAnimNode_Root AnimGraphNode_Root_0;

    // Index 1 - State Machine
    FAnimNode_StateMachine AnimGraphNode_StateMachine_1;

    // Index 2 - Idle Sequence Player
    FAnimNode_SequencePlayer AnimGraphNode_IdleSeq_2;

    // Index 3 - Walk Sequence Player
    FAnimNode_SequencePlayer AnimGraphNode_WalkSeq_3;

    // Blueprint Variable (Transition에서 사용)
    UPROPERTY(BlueprintReadWrite)
    float Speed;
};
```

**Transition 체크 (Update):**

```cpp
void FAnimNode_StateMachine::Update_AnyThread(const FAnimationUpdateContext& Context)
{
    // 1. 현재 State: Idle (Index 0)
    int32 CurrentStateIndex = 0;

    // 2. Transition 조건 평가
    // Compiled Transition Rule: Speed > 0.1
    UAnimInstance* AnimInstance = Context.AnimInstanceProxy->GetAnimInstanceObject();
    UCharacterAnimBP_C* TypedInstance = Cast<UCharacterAnimBP_C>(AnimInstance);

    if (TypedInstance->Speed > 0.1f)
    {
        // 3. Transition to Walk State
        CurrentStateIndex = 1;
        TransitionToState(1);
    }

    // 4. Update Current State's nodes
    StatePoseLinks[CurrentStateIndex].Update(Context);
}
```

### 예시 3: Layered Blend (상체/하체 분리)

**에디터:**

```
[AnimGraph]
    Walk Animation (Full Body)
        ↓
    Layered Bone Blend
        ├─ Base Pose (Walk)
        └─ Blend Pose (Aim Offset - Upper Body Only)
            ↓
    Output Pose
```

**Evaluate:**

```cpp
void FAnimNode_LayeredBoneBlend::Evaluate_AnyThread(FPoseContext& Output)
{
    // 1. Base Pose 평가
    FPoseContext BasePose(Output);
    BasePoseLinkID.Evaluate(BasePose);

    // 2. Blend Pose 평가
    FPoseContext BlendPose(Output);
    BlendPoseLinkID.Evaluate(BlendPose);

    // 3. Per-Bone Blending
    for (int32 BoneIndex = 0; BoneIndex < Output.Pose.GetNumBones(); ++BoneIndex)
    {
        FName BoneName = RequiredBones.GetReferenceSkeleton().GetBoneName(BoneIndex);

        // Upper Body인지 확인 (Spine, Arm 본들)
        if (IsUpperBodyBone(BoneName))
        {
            // Blend Pose 사용
            Output.Pose[BoneIndex] = BlendPose.Pose[BoneIndex];
        }
        else
        {
            // Base Pose 사용 (Lower Body)
            Output.Pose[BoneIndex] = BasePose.Pose[BoneIndex];
        }
    }
}
```

---

## ⚡ 성능 최적화 (Performance Optimization)

### 최적화 1: Property Folding 활용

**✅ 해야 할 것:**

```cpp
// AnimGraph Node에서
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = Settings)
UAnimSequence* IdleAnimation;  // ← Pin에 연결 안 함, 상수로 설정

// 결과: Constants 구조체로 Folding됨
// → 모든 인스턴스가 공유, 메모리 절약
```

**❌ 피해야 할 것:**

```cpp
// Pin에 연결하면 Folding 안 됨
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = Settings, meta=(PinShownByDefault))
UAnimSequence* IdleAnimation;  // ← 매 프레임 다른 값 가능

// 결과: Mutables에 포함, 인스턴스마다 별도 저장
```

### 최적화 2: Cached Pose 활용

**✅ 해야 할 것:**
```
// ✅ 동일 포즈 여러 곳에서 사용 시
[SaveCachedPose: "BasePose"] → [Use 1], [Use 2], [Use 3]
// 1번 평가, 3번 재사용
```

**❌ 나쁜 예: 중복된 계산:**
```
[BlendSpace A] → [Blend 1]
        ↓
[BlendSpace A (동일)] → [Blend 2]  ← ❌ 중복!
```

**해결책:**
```
[SaveCachedPose: "BlendSpaceResult"]
        ↓
[UseCachedPose] → [Blend 1]
        ↓
[UseCachedPose] → [Blend 2]
```

### 최적화 3: LOD에 따른 노드 비활성화

```cpp
// LODThreshold 설정
FAnimNode_TwoBoneIK
  - LODThreshold: 2  // LOD 2 이상에서 비활성화
```

### 최적화 4: Pin 노출 최소화 (Property Folding 극대화)

**❌ 나쁜 예:**
```cpp
// 모든 프로퍼티를 Pin으로 노출
FAnimNode_BlendSpace
  - BlendSpace (Pin)          ← 상수인데 Pin 노출 → Folding 불가
  - PlayRate (Pin)            ← 상수인데 Pin 노출 → Folding 불가
  - X (Pin)                   ← 필요
  - Y (Pin)                   ← 필요
```

**✅ 올바른 방법:**
```cpp
// 필요한 Pin만 노출
FAnimNode_BlendSpace
  - BlendSpace (Details Panel) ← 상수, Folding됨
  - PlayRate (Details Panel)   ← 상수, Folding됨
  - X (Pin)                    ← 변수, 필요
  - Y (Pin)                    ← 변수, 필요
```

### 최적화 5: State Machine 최적화

**❌ 피해야 할 것:**
```cpp
// 100개 이상 상태 → 컴파일 시간 증가, 메모리 증가

// ✅ 계층적 State Machine
// Root State Machine
//   ├─ Locomotion (Sub State Machine)
//   └─ Combat (Sub State Machine)
```

**❌ 복잡한 Transition Rule:**
```cpp
// ❌ Transition Rule에서 무거운 계산
// Rule Graph: [For Loop 1000번] → [복잡한 계산] → [Return]

// ✅ UpdateAnimation에서 미리 계산
// Rule Graph: [Get bShouldTransition] → [Return]
```

### 최적화 6: Multi-Threading

**✅ 해야 할 것:**

```cpp
// AnimBlueprint 설정
bUseMultiThreadedAnimationUpdate = true;

// 프로젝트 설정
[SystemSettings]
a.AllowMultiThreadedAnimationUpdate = 1
```

**요구사항:**
- `Update_AnyThread()` 사용 (NOT `Update()`)
- Thread-Safe 코드 (No UObject 접근)
- Read-Only 데이터만 참조

**성능 이득:**
- Single Thread: ~5ms (복잡한 AnimGraph)
- Multi Thread: ~1.5ms (3배 빠름)

### 최적화 3: LOD에 따른 Bone 최적화

**✅ 해야 할 것:**

```cpp
// SkeletalMesh LOD 설정
LOD 0: 150 bones (Full Detail)
LOD 1: 80 bones  (Medium)
LOD 2: 40 bones  (Low)

// RequiredBones가 자동으로 필터링
// → Evaluate 시간 감소
```

**측정 결과:**

| LOD | Bone 수 | Evaluate 시간 |
|-----|---------|--------------|
| 0 | 150 | 2.5ms |
| 1 | 80  | 1.3ms (48% ↓) |
| 2 | 40  | 0.7ms (72% ↓) |

### 최적화 4: Update Rate Optimization

**✅ 해야 할 것:**

```cpp
// 먼 거리 캐릭터는 Update 빈도 감소
USkeletalMeshComponent::SetAnimationUpdateRate(ERateOptimizationMode::ExternalRateControl);

// 거리별 Update Rate 설정
if (DistanceToCamera > 5000.0f)
{
    SkeletalMeshComponent->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::OnlyTickPoseWhenRendered;
}
```

**효과:**
- 60 FPS → 15 FPS Update (먼 거리)
- CPU 부하 75% 감소

---

## 🐛 디버깅 및 트러블슈팅 (Debugging & Troubleshooting)

### 디버깅 도구

#### 1. AnimGraph Debugger

```cpp
// 에디터에서
Window → Animation Debugger

// 실시간 확인:
// - 현재 활성 노드 (녹색)
// - Blend Weights
// - State Machine 상태
// - Pose Watch (특정 노드의 Pose 시각화)
```

#### 2. Anim Log

```cpp
// 코드에서 로그 출력
UE_LOG(LogAnimation, Warning, TEXT("Current State: %d"), CurrentStateIndex);

// 프로젝트 설정에서 Verbose 로그 활성화
LogAnimation VeryVerbose
```

#### 3. ShowDebug Animation

```
콘솔 명령어:
showdebug animation

출력 정보:
- Active Montages
- Current State Machine States
- Sync Groups
- Root Motion
- LOD Level
```

### 컴파일 에러 디버깅

**일반적인 컴파일 에러:**

**1. "Node is not connected to root"**
- 원인: 노드가 고립됨 (Root에서 도달 불가)
- 해결: 포즈 링크 연결 확인

**2. "Invalid Skeleton"**
- 원인: TargetSkeleton 불일치
- 해결: 애니메이션 에셋 Skeleton 확인

**3. "Property binding failed"**
- 원인: 바인딩된 변수가 삭제됨
- 해결: Property Binding 재설정

**컴파일 로그 예시:**
```
Compiler Log:
  Error: Node 'FAnimNode_BlendSpace' has invalid BlendSpace
  Warning: Node 'FAnimNode_StateMachine' has no transitions from state 'Idle'
  Note: Property 'Speed' was folded to constant data
```

**디버깅 팁:**
- `AllocatedAnimNodeIndices` 확인: 각 노드가 올바른 인덱스를 받았는지 검증
- `IsAnimGraphNodeFolded(Node)` 체크: Constant vs Mutable 분류 확인
- `ValidPoseLinkList` 검사: 모든 FPoseLink가 올바르게 연결되었는지 확인

### 일반적인 함정

**❌ 하지 말아야 할 것 1: UObject 접근 (Worker Thread)**

```cpp
// 위험한 코드 (Crash 위험)
void FAnimNode_Custom::Update_AnyThread(const FAnimationUpdateContext& Context)
{
    UMyGameInstance* GameInstance = GetWorld()->GetGameInstance();  // ❌ UObject 접근
    float Speed = GameInstance->PlayerSpeed;  // ❌ Thread-Safe 아님
}
```

**✅ 올바른 방법:**

```cpp
// AnimInstance (Game Thread)에서 복사
UFUNCTION(BlueprintCallable)
void UMyAnimInstance::NativeUpdateAnimation(float DeltaTime)
{
    // Game Thread에서 안전하게 읽기
    UMyGameInstance* GameInstance = GetWorld()->GetGameInstance();
    CachedPlayerSpeed = GameInstance->PlayerSpeed;  // ← Member 변수에 복사
}

// Worker Thread에서 사용
void FAnimNode_Custom::Update_AnyThread(const FAnimationUpdateContext& Context)
{
    UMyAnimInstance* AnimInstance = Cast<UMyAnimInstance>(Context.AnimInstanceProxy->GetAnimInstanceObject());
    float Speed = AnimInstance->CachedPlayerSpeed;  // ✅ 복사된 값 사용
}
```

**❌ 하지 말아야 할 것 2: 순환 Pose Link**

```cpp
// 에디터에서 이런 연결은 불가능 (컴파일 에러)
BlendNode_A
    ↓
BlendNode_B
    ↓
BlendNode_A  // ❌ 순환 참조!
```

**증상:**
- 컴파일 에러: "Cycle detected in animation graph"
- 무한 루프로 인한 크래시

**❌ 하지 말아야 할 것 3: 과도한 Bone 계산**

```cpp
// 나쁜 예: 모든 본을 매 프레임 계산
FAnimNode_ModifyBone::Evaluate_AnyThread(FPoseContext& Output)
{
    for (int32 i = 0; i < 150; ++i)  // ❌ 모든 본 순회
    {
        Output.Pose[i].SetLocation(...);
    }
}
```

**✅ 올바른 방법:**

```cpp
// 필요한 본만 계산
FAnimNode_ModifyBone::Evaluate_AnyThread(FPoseContext& Output)
{
    FCompactPoseBoneIndex BoneIndex = BoneToModify.GetCompactPoseIndex(BoneContainer);
    if (BoneIndex != INDEX_NONE)
    {
        Output.Pose[BoneIndex].SetLocation(...);  // ✅ 하나의 본만
    }
}
```

---

## 📊 성능 특성 (Performance Characteristics)

### 컴파일 시간

**전형적인 AnimBlueprint (Medium Complexity):**

```
Visual Nodes: 20개
State Machines: 2개
Total Nodes: ~40개 (State Machine 내부 포함)

컴파일 시간:
- Full Compile: ~500ms
- Fast Compile (Data Only): ~50ms
```

### 런타임 성능

**복잡한 AnimGraph (60 FPS 기준):**

```
Update Phase:        0.5ms
Evaluate Phase:      2.0ms
Blend Tree Depth:    5 levels
Active Nodes:        15개

총 애니메이션 비용:  2.5ms / 16.67ms (15% of frame)
```

### 메모리 사용량

**AnimBlueprintGeneratedClass:**

```
Constants Struct:    2 KB  (모든 인스턴스 공유)
Mutables Struct:     4 KB  (인스턴스당)
Node Properties:     8 KB  (인스턴스당)

총 메모리 (10 인스턴스):
- Without Folding: 140 KB (14 KB × 10)
- With Folding:    122 KB (2 KB + 12 KB × 10)
절약: ~13%
```

---

## 🔗 참고 자료 (References)

### 공식 문서

- [Animation Blueprint Overview](https://docs.unrealengine.com/5.7/en-US/animation-blueprints-in-unreal-engine/)
- [AnimGraph Nodes Reference](https://docs.unrealengine.com/5.7/en-US/animation-blueprint-node-reference/)

### 소스 파일 참조

**컴파일러:**
- `Engine/Source/Editor/AnimGraph/Private/AnimBlueprintCompiler.h` - 컴파일러 핵심 (217+ 라인)
- `Engine/Source/Editor/AnimGraph/Private/AnimBlueprintCompiler.cpp` - 구현
- `Engine/Source/Editor/AnimGraph/Private/AnimBlueprintCompilationContext.h` - 컴파일 컨텍스트 (178 라인)
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimBlueprintGeneratedClass.h` - 컴파일 결과 클래스 (400+ 라인)

**런타임:**
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h` - UAnimInstance
- `Engine/Source/Runtime/Engine/Public/Animation/AnimInstanceProxy.h` - FAnimInstanceProxy
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimNodeBase.h` - FAnimNode_Base

**Visual Nodes:**
- `Engine/Source/Editor/AnimGraph/Public/AnimGraphNode_Base.h` - 비주얼 노드 베이스
- `Engine/Source/Editor/AnimGraph/Public/AnimGraphNode_StateMachine.h` - State Machine 노드

### 관련 시스템

- **Skeletal Mesh Skinning** → `UnrealSummary/Animation/Skeletal_Mesh_Skinning_Deep_Dive.md` (다음 문서)
- **Animation Montage System** → 추후 작성 예정
- **Animation Compression** → 추후 작성 예정

---

## 📝 버전 이력 (Version History)

- **v1.0** (2025-01-22): 초기 작성 - AnimGraph Compilation & Execution 전체 분석
  - 3계층 아키텍처 (Editor / Compilation / Runtime)
  - FAnimBlueprintCompilerContext 상세 분석
  - Property Folding 메커니즘
  - UAnimInstance vs FAnimInstanceProxy 분리
  - Update/Evaluate 실행 흐름
  - 실전 예시 및 최적화 가이드
- **v1.1** (2026-02-18): AnimGraph/Compilation.md 내용 통합
  - 전체 8단계 컴파일 파이프라인 (Graph Pruning, State Machine Baking, Property Access Optimization 추가)
  - UAnimBlueprintGeneratedClass 컴파일 결과물 구조 추가
  - Cached Pose, LOD, Pin 노출 최소화, State Machine 최적화 가이드 추가
  - 컴파일 에러 디버깅 섹션 추가

## Merged Notes (from Animation/AnimGraph/Compilation.md)

### AnimGraph 컴파일
> 이 문서는 [AnimGraph_Compilation_And_Execution_Deep_Dive.md](../AnimGraph_Compilation_And_Execution_Deep_Dive.md)로 통합되었습니다.
> 상세한 컴파일 및 실행 파이프라인 분석은 해당 문서를 참조하세요.

> 🔄 Updated: 2026-02-18 — 심층 분석 문서로 통합
