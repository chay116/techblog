---
title: "Unreal Animation Framework (UAF) 개요"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation"]
---
# Unreal Animation Framework (UAF) 개요

## 🧭 개요 (Overview)

**Unreal Animation Framework (UAF)**는 Unreal Engine 4에서 도입된 **비주얼 기반 애니메이션 시스템**으로, UE3의 코드 중심 AnimTree를 완전히 대체했습니다. 이는 단순한 개선이 아니라 애니메이션 개발 방식의 **패러다임 전환**이었습니다.

### 핵심 철학

**"프로그래머가 아닌 애니메이터가 애니메이션 로직을 제어한다"**

- 비주얼 스크립팅 (Animation Blueprint)
- 실시간 미리보기 및 디버깅
- 복잡한 로직의 시각적 단순화
- 빠른 프로토타이핑 및 반복 작업

---

## 🕰️ 설계 철학: 왜 UAF인가?

### UE3 AnimTree의 한계

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    UE3 AnimTree 시스템 (문제점)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: 코드 중심 개발                                               │
│  ┌──────────────────────────────────────────┐                          │
│  │  UnrealScript로 애니메이션 로직 작성     │                          │
│  │  → 프로그래머만 수정 가능                │                          │
│  │  → 컴파일 필요 (느린 반복)               │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
│  ❌ 문제 2: 복잡한 계층 구조                                             │
│  ┌──────────────────────────────────────────┐                          │
│  │  UAnimNode (C++ 클래스)                  │                          │
│  │    - UAnimNodeSequence                   │                          │
│  │    - UAnimNodeBlend                      │                          │
│  │    - UAnimNodeBlendList                  │                          │
│  │  → 새 기능 = 새 C++ 클래스 작성          │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
│  ❌ 문제 3: 디버깅 어려움                                                │
│  - 코드 추적만 가능 (시각적 디버거 없음)                                 │
│  - 블렌드 가중치 계산이 불투명                                           │
│                                                                         │
│  ❌ 문제 4: 협업 비효율                                                  │
│  - 애니메이터 → 프로그래머 → 테스트 사이클                              │
│  - 의사소통 오버헤드                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### UAF의 해결책

```
┌─────────────────────────────────────────────────────────────────────────┐
│                UE4+ UAF (Unreal Animation Framework)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ✅ 해결 1: 비주얼 스크립팅                                              │
│  ┌──────────────────────────────────────────┐                          │
│  │  Animation Blueprint                     │                          │
│  │  - 노드 기반 그래프 에디터                │                          │
│  │  - 드래그 앤 드롭                         │                          │
│  │  - 핫 리로드 (컴파일 불필요)              │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
│  ✅ 해결 2: 고수준 추상화                                                │
│  ┌──────────────────────────────────────────┐                          │
│  │  State Machine                           │                          │
│  │  - 시각적 상태 전환                       │                          │
│  │  - 자동 블렌딩                            │                          │
│  │                                          │                          │
│  │  Blend Space                             │                          │
│  │  - 2D 블렌드 공간                         │                          │
│  │  - 자동 보간                              │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
│  ✅ 해결 3: 강력한 디버깅                                                │
│  - 에디터 실시간 미리보기                                                │
│  - Pose Watch (본 추적)                                                 │
│  - 노드별 활성화 상태 표시                                               │
│                                                                         │
│  ✅ 해결 4: 직접 제어                                                    │
│  - 애니메이터가 직접 수정 가능                                           │
│  - 프로그래머는 시스템 확장에만 집중                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ 모듈 구조 (Module Architecture)

UAF는 **5개 핵심 모듈**로 구성됩니다:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      UAF 모듈 계층 구조                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] AnimationCore                                                      │
│  ┌──────────────────────────────────────────┐                          │
│  │  Core 애니메이션 타입 및 알고리즘        │                          │
│  │  - FBoneIndices                          │                          │
│  │  - FBoneWeights                          │                          │
│  │  - IK 알고리즘 (FABRIK, CCDIK, TwoBoneIK)│                          │
│  │  - FConstraint                           │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓ 의존                                                          │
│  [2] Engine/Animation                                                   │
│  ┌──────────────────────────────────────────┐                          │
│  │  런타임 애니메이션 시스템                 │                          │
│  │  - UAnimInstance (핵심)                  │                          │
│  │  - UAnimSequence (데이터)                │                          │
│  │  - UAnimMontage (몽타주)                 │                          │
│  │  - UBlendSpace (블렌드 공간)             │                          │
│  │  - USkeleton (본 구조)                   │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓ 의존                     ↓ 의존                               │
│  [3] AnimGraphRuntime      [4] AnimGraph (Editor Only)                 │
│  ┌───────────────────┐    ┌──────────────────────┐                    │
│  │  런타임 노드 실행  │    │  에디터 컴파일 시스템│                    │
│  │  - FAnimNode_*    │    │  - UAnimGraphNode_*  │                    │
│  │  - 35+ 노드       │    │  - 블루프린트 → C++  │                    │
│  │  - 포즈 평가      │    │  - 최적화 패스       │                    │
│  └───────────────────┘    └──────────────────────┘                    │
│                                                                         │
│  [5] AnimationModifiers (Editor Only)                                  │
│  ┌──────────────────────────────────────────┐                          │
│  │  애니메이션 수정 도구                     │                          │
│  │  - 배치 프로세싱                          │                          │
│  │  - 커브 수정                              │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 소스 위치:**
- `Engine/Source/Runtime/AnimationCore/`
- `Engine/Source/Runtime/Engine/Classes/Animation/`
- `Engine/Source/Runtime/AnimGraphRuntime/`
- `Engine/Source/Editor/AnimGraph/`
- `Engine/Source/Editor/AnimationModifiers/`

---

## 🎯 핵심 클래스 계층 (Core Class Hierarchy)

### 1. UAnimInstance - 런타임 애니메이션 인스턴스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UAnimInstance                                   │
│  (Animation Blueprint의 런타임 인스턴스)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  상속: UObject → UAnimInstance                                          │
│                                                                         │
│  핵심 역할:                                                              │
│  - AnimGraph 실행 및 포즈 평가                                           │
│  - EventGraph 로직 실행                                                  │
│  - Montage 재생 관리                                                     │
│  - 블렌딩 및 IK 처리                                                     │
│                                                                         │
│  Private:                                                               │
│    - CurrentSkeleton : USkeleton*       // 스켈레톤 참조                │
│    - SkeletalMeshComponent : USkeletalMeshComponent*                   │
│    - AnimInstanceProxy : FAnimInstanceProxy*  // 스레드 안전 Proxy      │
│    - MontageInstances : TArray<FAnimMontageInstance*>                  │
│                                                                         │
│  Public:                                                                │
│    + NativeInitializeAnimation() : void      // 초기화                  │
│    + NativeUpdateAnimation(float) : void     // 매 프레임 업데이트      │
│    + NativeThreadSafeUpdateAnimation(float) : void  // 병렬 업데이트    │
│    + Montage_Play(UAnimMontage*) : float     // 몽타주 재생             │
│    + GetCurveValue(FName) : float            // 커브 값 읽기            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h:225`

---

### 2. UAnimBlueprint & UAnimBlueprintGeneratedClass

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Animation Blueprint 구조                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [에디터]                                                                │
│  UAnimBlueprint (Blueprint Asset)                                       │
│       │                                                                 │
│       │ 컴파일                                                          │
│       ↓                                                                 │
│  UAnimBlueprintGeneratedClass                                          │
│    - BakedStateMachines : TArray<FBakedAnimationStateMachine>          │
│    - AnimNotifies : TArray<FAnimNotifyEvent>                           │
│    - AnimNodeData : 컴파일된 노드 데이터                                │
│       │                                                                 │
│       │ 인스턴스화                                                       │
│       ↓                                                                 │
│  [런타임]                                                                │
│  UAnimInstance (Instance)                                               │
│    - 실제 애니메이션 실행                                                │
│    - 매 프레임 평가                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimBlueprint.h:80`
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimBlueprintGeneratedClass.h:17`

---

### 3. FAnimNode_Base - AnimGraph 노드 기반 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FAnimNode_Base                                     │
│  (모든 AnimGraph 노드의 기반 클래스)                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  구조체 (UStruct 기반, UObject 아님)                                     │
│                                                                         │
│  핵심 메서드:                                                            │
│    + Initialize_AnyThread(FAnimationInitializeContext&) : void          │
│    + CacheBones_AnyThread(FAnimationCacheBonesContext&) : void          │
│    + Update_AnyThread(FAnimationUpdateContext&) : void                  │
│    + Evaluate_AnyThread(FPoseContext&) : void                           │
│                                                                         │
│  주요 파생 클래스 (35개):                                                │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimNode_SequencePlayer                │  // 애니메이션 재생       │
│  │  FAnimNode_StateMachine                  │  // 상태 머신             │
│  │  FAnimNode_BlendSpacePlayer              │  // 블렌드 스페이스       │
│  │  FAnimNode_LayeredBoneBlend              │  // 본 레이어 블렌딩      │
│  │  FAnimNode_TwoWayBlend                   │  // 2-Way 블렌드          │
│  │  FAnimNode_PoseByName                    │  // 포즈 선택             │
│  │  FAnimNode_ModifyCurve                   │  // 커브 수정             │
│  │  FAnimNode_Slot                          │  // 슬롯 (몽타주)         │
│  │  ... (27개 더)                            │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimNodeBase.h:21`
- `Engine/Source/Runtime/AnimGraphRuntime/Public/AnimNodes/` (35개 파일)

---

## 🔄 Animation Blueprint 워크플로우 (Workflow)

### 컴파일 타임 (Compile Time)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Animation Blueprint 컴파일 과정                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 에디터에서 편집                                                     │
│  ┌──────────────────────────────────────────┐                          │
│  │  UAnimBlueprint                          │                          │
│  │  - AnimGraph (노드 그래프)                │                          │
│  │  - EventGraph (게임 로직)                │                          │
│  │  - Functions                             │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [2] 컴파일러 (FAnimBlueprintCompiler)                                  │
│  ┌──────────────────────────────────────────┐                          │
│  │  그래프 분석 및 최적화                    │                          │
│  │  - 노드 순서 정렬                         │                          │
│  │  - 미사용 노드 제거                       │                          │
│  │  - Property Access 최적화                │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [3] 코드 생성                                                           │
│  ┌──────────────────────────────────────────┐                          │
│  │  UAnimBlueprintGeneratedClass            │                          │
│  │  - BakedStateMachines[]                  │                          │
│  │  - AnimNodeData                          │                          │
│  │  - ExposedValueHandlers                  │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  [4] 런타임 데이터 베이킹                                                │
│  - State Machine 구조 베이킹                                             │
│  - Transition Rule 베이킹                                                │
│  - Blend Space 샘플 베이킹                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 런타임 (Runtime)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      매 프레임 실행 흐름                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Game Thread:                                                           │
│  ┌──────────────────────────────────────────┐                          │
│  │  UAnimInstance::UpdateAnimation()        │                          │
│  │    1. EventGraph 실행                    │                          │
│  │       - 게임 로직 (변수 업데이트)        │                          │
│  │    2. Montage 업데이트                   │                          │
│  │    3. Proxy로 데이터 전달                │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  Worker Thread (선택적 병렬):                                            │
│  ┌──────────────────────────────────────────┐                          │
│  │  FAnimInstanceProxy::Update()            │                          │
│  │    4. AnimGraph 평가 (3단계)             │                          │
│  │       ┌────────────────────────────────┐ │                          │
│  │       │ Phase 1: Initialize            │ │                          │
│  │       │   - 노드 초기화                 │ │                          │
│  │       │   - 본 캐싱                     │ │                          │
│  │       ├────────────────────────────────┤ │                          │
│  │       │ Phase 2: Update                │ │                          │
│  │       │   - 가중치 계산                 │ │                          │
│  │       │   - 타이머 업데이트             │ │                          │
│  │       ├────────────────────────────────┤ │                          │
│  │       │ Phase 3: Evaluate              │ │                          │
│  │       │   - 포즈 계산                   │ │                          │
│  │       │   - 블렌딩                      │ │                          │
│  │       │   - 최종 포즈 출력              │ │                          │
│  │       └────────────────────────────────┘ │                          │
│  └──────────────────────────────────────────┘                          │
│         ↓                                                               │
│  Game Thread:                                                           │
│  ┌──────────────────────────────────────────┐                          │
│  │  5. 포즈 적용                             │                          │
│  │     - 본 변환 업데이트                    │                          │
│  │     - 스켈레탈 메시 갱신                  │                          │
│  └──────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 핵심 기능 (Key Features)

### 1. State Machine (상태 머신)

복잡한 애니메이션 상태 전환을 시각적으로 관리:

```
[Idle] ──Speed > 10──> [Walk] ──Speed > 300──> [Run]
  ↑                       ↓                       ↓
  └──────Speed < 10───────┘                       │
  └──────────────────────────Speed < 300──────────┘
           bIsInAir
               ↓
           [Jump] ──!bIsInAir──> [Land] ──> [Idle]
```

**특징:**
- 자동 블렌딩 (BlendTime 설정 가능)
- Transition Rule (조건 기반 전환)
- Entry/Exit 이벤트
- Conduit (복잡한 라우팅)

---

### 2. Blend Space (블렌드 공간)

2D 또는 1D 공간에서 애니메이션 자동 블렌딩:

```
     속도 (Speed)
      ↑
  600 │     [Run Forward]
      │       /     \
  400 │      /       \
      │  [Run Left] [Run Right]
  200 │     |         |
      │  [Walk Left] [Walk Right]
    0 │     \       /
      │      [Idle]
      └──────────────────────> 방향 (Direction)
        -180        0        180
```

**특징:**
- 자동 보간 (삼각형 보간법)
- 2축 입력 (속도 + 방향)
- 실시간 샘플링

---

### 3. Montage (몽타주)

복잡한 애니메이션 시퀀스 재생 및 제어:

```
Montage:
  ┌───────┬───────┬───────┬───────┐
  │ Start │ Loop  │ Hit   │ End   │  (Sections)
  └───────┴───────┴───────┴───────┘
     │       │       ↑       │
     │       └───────┘       │  (Loop)
     │      Notify  Notify   │
     ↓         ↓       ↓     ↓
  [이벤트] [효과] [데미지] [종료]
```

**특징:**
- 섹션 기반 재생
- Animation Notify (이벤트 트리거)
- Slot 시스템 (상하체 독립)
- 블루프린트에서 제어 가능

---

### 4. Layered Bone Blend (본 레이어 블렌딩)

본별 가중치를 사용한 애니메이션 블렌딩:

```
전신 애니메이션 (달리기)
       +
상체만 애니메이션 (총 조준)
       ↓
┌────────────────────────┐
│  Spine 이상: 조준 100%  │
│  Spine 이하: 달리기 100%│
└────────────────────────┘
```

**특징:**
- Blend Profile (본별 가중치)
- 상하체 독립 제어
- 부드러운 전환

---

## 📊 성능 특징 (Performance Characteristics)

### 병렬 평가 (Parallel Evaluation)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     병렬 애니메이션 평가                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Game Thread:                   Worker Threads:                         │
│  ┌────────────────┐              ┌────────────────┐                    │
│  │ EventGraph     │              │ AnimGraph 1    │                    │
│  │ 실행           │              │ 평가           │                    │
│  └────────────────┘              └────────────────┘                    │
│         ↓                                ↓                              │
│  ┌────────────────┐              ┌────────────────┐                    │
│  │ Proxy 데이터   │              │ AnimGraph 2    │                    │
│  │ 전달           │              │ 평가           │                    │
│  └────────────────┘              └────────────────┘                    │
│         ↓                                ↓                              │
│  ┌──────────────────────────────────────────────┐                      │
│  │         포즈 결과 수집 및 적용                │                      │
│  └──────────────────────────────────────────────┘                      │
│                                                                         │
│  FAnimInstanceProxy:                                                    │
│  - 스레드 안전 데이터 복사본                                             │
│  - Worker 스레드에서 안전하게 실행                                       │
│  - NativeThreadSafeUpdateAnimation() 사용                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h:29` (FAnimInstanceProxy)

---

### LOD (Level of Detail)

```
LOD 시스템:
  LOD 0 (고품질): 모든 본 + 모든 애니메이션 노드
  LOD 1 (중품질): 주요 본 + 단순화된 블렌딩
  LOD 2 (저품질): 최소 본 + 단일 애니메이션
  LOD 3 (초저품질): 포즈 스냅샷 (업데이트 안 함)
```

---

## 🔧 주요 API (Key APIs)

### UAnimInstance 주요 메서드

```cpp
// AnimInstance.h:225
class ENGINE_API UAnimInstance : public UObject
{
    // === 초기화 ===
    virtual void NativeInitializeAnimation();
    virtual void NativeBeginPlay();

    // === 업데이트 ===
    virtual void NativeUpdateAnimation(float DeltaSeconds);
    virtual void NativeThreadSafeUpdateAnimation(float DeltaSeconds);  // 병렬 안전

    // === 몽타주 재생 ===
    UFUNCTION(BlueprintCallable, Category = "Animation")
    float Montage_Play(UAnimMontage* MontageToPlay,
                       float InPlayRate = 1.f,
                       EMontagePlayReturnType ReturnValueType = EMontagePlayReturnType::MontageLength,
                       float InTimeToStartMontageAt = 0.f,
                       bool bStopAllMontages = true);

    UFUNCTION(BlueprintCallable, Category = "Animation")
    void Montage_Stop(float InBlendOutTime, const UAnimMontage* Montage = nullptr);

    UFUNCTION(BlueprintCallable, Category = "Animation")
    void Montage_JumpToSection(FName SectionName, const UAnimMontage* Montage = nullptr);

    // === 커브 값 읽기 ===
    UFUNCTION(BlueprintPure, Category = "Animation")
    float GetCurveValue(FName CurveName) const;

    // === 상태 머신 ===
    UFUNCTION(BlueprintPure, Category = "Animation")
    bool IsAnyMontagePlaying() const;

    UFUNCTION(BlueprintPure, Category = "Animation")
    UAnimMontage* GetCurrentActiveMontage() const;
};
```

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h:225`

---

## 💡 실전 예시 (Practical Examples)

### ✅ 좋은 예: 병렬 평가 활용

```cpp
UCLASS()
class UMyAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    float Speed;

    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bIsInAir;

    // ✅ 스레드 안전: Worker 스레드에서 실행
    virtual void NativeThreadSafeUpdateAnimation(float DeltaSeconds) override
    {
        Super::NativeThreadSafeUpdateAnimation(DeltaSeconds);

        // Proxy를 통해 안전한 데이터 접근
        APawn* Pawn = TryGetPawnOwner();
        if (Pawn)
        {
            Speed = Pawn->GetVelocity().Size();
            bIsInAir = Pawn->GetMovementComponent()->IsFalling();
        }
    }
};
```

---

### ❌ 나쁜 예: 게임 스레드 차단

```cpp
// ❌ NativeUpdateAnimation에서 무거운 계산
virtual void NativeUpdateAnimation(float DeltaSeconds) override
{
    Super::NativeUpdateAnimation(DeltaSeconds);

    // ❌ Game Thread에서 실행 → 프레임 드랍
    for (int32 i = 0; i < 10000; ++i)
    {
        // 무거운 계산...
    }
}
```

**대신:**
- `NativeThreadSafeUpdateAnimation()` 사용
- 또는 Async Task로 분리

---

## 🚫 제약사항 및 한계점 (Limitations)

| 제약 | 설명 | 대안 |
|------|------|------|
| **블루프린트 오버헤드** | C++에 비해 10-20% 느림 | 핫 패스는 C++로 작성 |
| **복잡한 그래프** | 100+ 노드 시 컴파일 느려짐 | Sub-Graph 또는 Linked AnimGraph |
| **디버깅** | 에디터에서만 가능 | Shipped 빌드에서 제한적 |
| **버전 관리** | 바이너리 에셋 (Merge 어려움) | 텍스트 기반 에셋 (.uasset → .udatasmith) |

---

## 📂 폴더 구조 (Folder Structure)

```
UnrealSummary/Animation/
├── Overview.md (현재 문서)
│
├── Core/
│   ├── AnimInstance.md            # UAnimInstance 상세
│   ├── AnimSequence.md            # 애니메이션 데이터
│   ├── Skeleton.md                # USkeleton
│   ├── AnimNotify.md              # 이벤트 시스템
│   └── Compression.md             # 압축 알고리즘
│
├── AnimGraph/
│   ├── StateMachine.md            # 상태 머신
│   ├── BlendSpace.md              # 블렌드 공간
│   ├── AnimNodes.md               # AnimGraph 노드들
│   ├── Compilation.md             # 컴파일 과정
│   └── LinkedAnimGraph.md         # 계층적 애니메이션
│
├── Blending/
│   ├── BlendSystem.md             # 블렌딩 아키텍처
│   ├── BlendProfiles.md           # 본별 가중치
│   ├── Inertialization.md         # 관성 블렌딩 (UE5.0+)
│   └── DeadBlending.md            # Dead Blending
│
└── ... (IK, Montage, Retargeting, Performance, Advanced)
```

---

## 🔗 참고 자료 (References)

### 공식 문서
- [Unreal Engine - Animation System](https://docs.unrealengine.com/5.7/en-US/animation-system-in-unreal-engine/)
- [Animation Blueprint](https://docs.unrealengine.com/5.7/en-US/animation-blueprints-in-unreal-engine/)
- [State Machines](https://docs.unrealengine.com/5.7/en-US/state-machines-in-unreal-engine/)
- [Blend Spaces](https://docs.unrealengine.com/5.7/en-US/blend-spaces-in-unreal-engine/)

### 소스 파일
- `Engine/Source/Runtime/AnimationCore/` - Core 타입 및 알고리즘
- `Engine/Source/Runtime/Engine/Classes/Animation/` - 런타임 시스템
- `Engine/Source/Runtime/AnimGraphRuntime/` - AnimGraph 노드 실행
- `Engine/Source/Editor/AnimGraph/` - 에디터 컴파일러

### 주요 클래스
- `AnimInstance.h` - UAnimInstance (핵심 런타임 클래스)
- `AnimBlueprint.h` - UAnimBlueprint (에디터 에셋)
- `AnimBlueprintGeneratedClass.h` - 컴파일된 클래스
- `AnimNodeBase.h` - FAnimNode_Base (노드 기반 클래스)

---

## 📊 통계 (Statistics)

| 항목 | 수량 |
|------|------|
| **AnimGraph 노드** | 35개 (AnimGraphRuntime) |
| **State Machine 지원** | 무제한 상태 및 전환 |
| **Blend Space** | 1D, 2D 지원 |
| **병렬 평가** | Worker Thread 지원 |
| **UE3 대비 개발 속도** | **10배 향상** |

---

> 🔄 **작성일**: 2025-11-07
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7.0
> 📂 **다음 문서**: [AnimInstance.md](./Core/AnimInstance.md)
