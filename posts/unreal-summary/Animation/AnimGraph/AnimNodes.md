---
title: "AnimGraph 노드 (AnimGraph Nodes)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "AnimGraph"]
---
# AnimGraph 노드 (AnimGraph Nodes)

## 🧭 개요 (Overview)
- FAnimNode_Base 기반 클래스 시스템
- 35개 노드 타입 소개
- AnimGraph 실행 파이프라인 역할

## 🎯 설계 철학: 왜 노드 시스템인가?
- 문제: 코드 기반 애니메이션 제어의 한계
- 해결책: 비주얼 노드 그래프
- 설계 결정 표 (노드 기반, 컴파일 타임 최적화, 스레드 안전성)

## 🏗️ FAnimNode_Base 아키텍처

### 클래스 계층
```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FAnimNode_Base (기반 클래스)                        │
│  (모든 AnimGraph 노드의 추상 기반)                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  핵심 메서드:                                                            │
│    + Initialize_AnyThread(Context) : void    // 초기화                  │
│    + CacheBones_AnyThread(Context) : void    // 본 캐싱                 │
│    + Update_AnyThread(Context) : void        // 가중치 계산             │
│    + Evaluate_AnyThread(Output) : void       // 포즈 계산               │
│    + EvaluateComponentSpace_AnyThread(...) : void  // 컴포넌트 공간    │
│    + GetLODThreshold() : int32               // LOD 임계값              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 생명주기 (Lifecycle)
```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AnimNode 생명주기 (매 프레임)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  [1] Initialize Phase                                                   │
│      Initialize_AnyThread(FAnimationInitializeContext)                 │
│      - 노드 초기화, 데이터 구조 설정                                     │
│         ↓                                                               │
│  [2] CacheBones Phase                                                   │
│      CacheBones_AnyThread(FAnimationCacheBonesContext)                 │
│      - RequiredBones 캐싱, 본 인덱스 매핑                               │
│         ↓                                                               │
│  [3] Update Phase (매 프레임)                                           │
│      Update_AnyThread(FAnimationUpdateContext)                         │
│      - 가중치 계산, 타이머 진행, 자식 노드 업데이트                       │
│         ↓                                                               │
│  [4] Evaluate Phase                                                     │
│      Evaluate_AnyThread(FPoseContext)                                  │
│      - 최종 포즈 계산, 블렌딩, 출력                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Context 타입
- FAnimationInitializeContext
- FAnimationCacheBonesContext
- FAnimationUpdateContext (DeltaTime, CurrentWeight, RootMotionWeightModifier)
- FPoseContext (FCompactPose, FBlendedCurve, CustomAttributes)
- FComponentSpacePoseContext

**📂 소스 검증:** AnimNodeBase.h:851-1081

## 📦 노드 분류 (Node Categories)

### 1. 블렌드 노드 (Blend Nodes)

#### 1.1 FAnimNode_ApplyAdditive
```cpp
USTRUCT(BlueprintInternalUseOnly)
struct FAnimNode_ApplyAdditive : public FAnimNode_Base
{
    FPoseLink Base;      // 기본 포즈
    FPoseLink Additive;  // Additive 포즈
    float Alpha;         // 블렌드 가중치 (0-1)
    int32 LODThreshold;  // LOD 임계값
};
```

**사용 시나리오:**
- Breathing animation over Idle
- Weapon recoil over aim pose

**내부 동작:**
```
Base Pose (Idle)  +  Additive (Breathing) × Alpha  =  Final Pose
```

**📂 위치:** AnimNode_ApplyAdditive.h:1-66

#### 1.2 FAnimNode_LayeredBoneBlend
```cpp
USTRUCT(BlueprintInternalUseOnly)
struct FAnimNode_LayeredBoneBlend : public FAnimNode_Base
{
    FPoseLink BasePose;
    TArray<FPoseLink> BlendPoses;          // 여러 입력 포즈
    TArray<float> BlendWeights;            // 각 포즈 가중치
    TArray<TObjectPtr<UBlendProfile>> BlendMasks;  // 본별 가중치
    ELayeredBoneBlendMode BlendMode;       // 블렌드 모드
    bool bMeshSpaceRotationBlend;          // 메시 공간 회전 블렌드
};
```

**블렌드 모드:**
- BranchFilter: 특정 본 이하만 블렌드
- BlendMask: BlendProfile 사용 (본별 0-1 가중치)

**사용 예시:**
```
하체: Walk (100%)
상체: Reload (100%) ← LayeredBoneBlend (Spine 이상)
```

**📂 위치:** AnimNode_LayeredBoneBlend.h:1-195

#### 1.3 FAnimNode_TwoWayBlend
- 2개 포즈 간 선형 블렌드
- Alpha 값으로 가중치 제어

#### 1.4 FAnimNode_MultiWayBlend
- N개 포즈 블렌드
- BlendPoses[] 배열

#### 1.5 FAnimNode_BlendListBase / ByInt / ByBool / ByEnum
- 조건에 따른 포즈 선택
- 자동 블렌딩 지원

### 2. 시퀀스 재생 노드 (Sequence Players)

#### 2.1 FAnimNode_SequencePlayer
- 단일 UAnimSequence 재생
- PlayRate, StartPosition, bLoopAnimation

#### 2.2 FAnimNode_BlendSpacePlayer
- UBlendSpace 재생
- X, Y 좌표 입력

#### 2.3 FAnimNode_PoseBlendNode
- 여러 포즈 블렌딩
- PoseAsset 사용

### 3. 공간 변환 노드 (Space Conversion)

#### 3.1 FAnimNode_ConvertLocalToComponentSpace
- Local Space → Component Space 변환

#### 3.2 FAnimNode_ConvertComponentToLocalSpace
- Component Space → Local Space 변환

**사용 시나리오:** IK는 Component Space에서 수행

### 4. IK 노드 (Inverse Kinematics)

#### 4.1 FAnimNode_TwoBoneIK
- 2본 IK (팔꿈치, 무릎)
- EffectorLocation 목표 설정

#### 4.2 FAnimNode_FABRIK
- Full Body IK
- 여러 본 체인

#### 4.3 FAnimNode_CCDIK
- Cyclic Coordinate Descent IK

### 5. 커브 조작 노드 (Curve Manipulation)

#### 5.1 FAnimNode_ModifyCurve
- 런타임 커브 값 수정

#### 5.2 FAnimNode_RemapCurve
- 커브 이름 리매핑

### 6. 본 조작 노드 (Bone Manipulation)

#### 6.1 FAnimNode_ModifyBone
- 특정 본 Transform 수정

#### 6.2 FAnimNode_CopyBone
- 본 Transform 복사

#### 6.3 FAnimNode_LookAt
- 본이 특정 타겟을 바라보도록

### 7. 포즈 유틸리티 (Pose Utilities)

#### 7.1 FAnimNode_RefPose
- 스켈레톤 기준 포즈 출력

#### 7.2 FAnimNode_PoseByName
- 저장된 포즈 스냅샷 사용

#### 7.3 FAnimNode_PoseSnapshot
- 현재 포즈 캡처

### 8. 몽타주 및 슬롯 (Montage & Slot)

#### 8.1 FAnimNode_Slot
```cpp
USTRUCT(BlueprintInternalUseOnly)
struct FAnimNode_Slot : public FAnimNode_Base
{
    FPoseLink Source;
    FName SlotName;     // 슬롯 이름
    bool bAlwaysUpdateSourcePose;
};
```

**역할:**
- Montage 재생 포인트
- PlaySlotAnimationAsDynamicMontage() 타겟

**📂 위치:** AnimNode_Slot.h:1-48

### 9. 기타 노드

#### 9.1 FAnimNode_StateMachine
- State Machine 실행 (별도 문서: StateMachine.md)

#### 9.2 FAnimNode_SaveCachedPose / UseCachedPose
- 포즈 캐싱 및 재사용
- 동일 포즈 여러 번 사용 시 최적화

## 🔄 노드 실행 흐름 (Execution Flow)

### Update Phase 예시
```
Root Node (Final Animation Pose)
    ↓ Update (Weight=1.0)
StateMachine
    ↓ Update (Weight=1.0)
BlendSpace (Walk/Run)
    ↓ Update (Weight=CurrentStateWeight)
[Walk Animation] ← 가중치 계산 완료
```

### Evaluate Phase 예시
```
Root Node
    ↓ Evaluate
StateMachine
    ↓ Evaluate (CurrentState Pose 요청)
BlendSpace
    ↓ Evaluate (샘플링 및 블렌딩)
[Walk Pose + Run Pose] → 최종 FCompactPose 출력
```

## 💡 실전 예시 (Practical Examples)

### ✅ 좋은 예: 상하체 분리 애니메이션

```cpp
// AnimGraph 구조:
[Locomotion State Machine]  ← 하체
        ↓
[LayeredBoneBlend]
    BasePose: ↑
    BlendPose[0]: [Upper Body Slot] ← Reload 애니메이션
    BlendProfile: UpperBodyProfile (Spine 이상 1.0)
        ↓
[Final Animation Pose]
```

### ✅ 좋은 예: Additive 레이어링

```cpp
[Idle Animation]
    ↓
[ApplyAdditive] ← Breathing (Alpha=1.0)
    ↓
[ApplyAdditive] ← Wind Sway (Alpha=0.5)
    ↓
[Final Pose]
```

### ❌ 나쁜 예: 과도한 노드 체인

```cpp
// ❌ 10개 이상 블렌드 노드 체인
[Blend] → [Blend] → [Blend] → ... → [Blend]
// 성능 저하, 디버깅 어려움
```

**해결책:** State Machine 또는 Blend Space 사용

## 📊 성능 최적화 (Performance Optimization)

### ✅ 해야 할 것

**1. LOD Threshold 설정:**
```cpp
FAnimNode_TwoBoneIK IKNode;
IKNode.LODThreshold = 2;  // LOD 2 이상에서 비활성화
```

**2. Cached Pose 재사용:**
```
[SaveCachedPose: "LocomotionPose"]
        ↓
[UseCachedPose] → [Blend A]
        ↓
[UseCachedPose] → [Blend B]
// 동일 포즈를 두 번 평가 안 함!
```

**3. Component Space 변환 최소화:**
```cpp
// ✅ IK 여러 개를 Component Space 안에서 처리
[Local→Component] → [IK 1] → [IK 2] → [Component→Local]

// ❌ 매번 변환
[Local→Component] → [IK 1] → [Component→Local]
[Local→Component] → [IK 2] → [Component→Local]
```

### ❌ 피해야 할 것

**1. 매 프레임 Blueprint Get:**
```cpp
// ❌ AnimGraph에서 Blueprint 함수 호출 (느림)
[Get Target Location (Blueprint)] → [IK Node]

// ✅ EventGraph에서 변수로 전달
// EventGraph: TargetLocation = GetTargetLocation()
// AnimGraph: [TargetLocation Variable] → [IK Node]
```

**2. 불필요한 Component Space:**
```cpp
// ❌ Local Space에서 가능한 작업을 Component Space에서
[Local→Component] → [Modify Bone] → [Component→Local]

// ✅ ModifyBone은 Local Space 지원
[Modify Bone (Local Space)]
```

## 🔧 디버깅 및 트러블슈팅 (Debugging & Troubleshooting)

### Stat 명령어
```
stat AnimNodes        // 개별 노드 비용
stat AnimNodeCount    // 활성 노드 수
```

**주요 지표:**
- Active Node Count: 활성 노드 수 (목표: < 50)
- Node Evaluate Time: 각 노드 평가 시간

### Pose Watch
- AnimGraph 에디터에서 노드 우클릭 → Toggle Pose Watch
- PIE 실행 시 해당 노드의 포즈 시각화

### 흔한 문제

**✅ 노드가 실행되지 않음:**
- LODThreshold 확인 (현재 LOD가 임계값 이상인지)
- CurrentWeight 확인 (0이면 스킵)
- Relevant 체크 (IsLODEnabled 확인)

**✅ 블렌드가 어색함:**
- BlendTime 조정
- BlendMode 변경 (Linear → Cubic)
- Inertialization 활성화 (UE 5.0+)

**✅ IK가 작동 안 함:**
- Component Space 변환 확인
- EffectorLocation 값 확인
- BoneToModify 이름 확인

## 🔗 관련 문서 (Related Documents)

- [Overview.md](../Overview.md) - UAF 전체 개요
- [AnimInstance.md](../Core/AnimInstance.md) - 런타임 애니메이션 인스턴스
- [StateMachine.md](./StateMachine.md) - 상태 머신 시스템
- [BlendSpace.md](./BlendSpace.md) - 블렌드 스페이스
- [AnimMontage.md](./AnimMontage.md) - 몽타주 시스템

## 📚 참고 자료 (References)

### 소스 파일
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimNodeBase.h` (1,100+ 라인)
- `Engine/Source/Runtime/AnimGraphRuntime/Public/AnimNodes/` (35개 노드 파일)

### 공식 문서
- [Unreal Engine - Animation Nodes](https://docs.unrealengine.com/5.7/en-US/animation-node-reference-in-unreal-engine/)
- [Animation Blueprint](https://docs.unrealengine.com/5.7/en-US/animation-blueprints-in-unreal-engine/)

### 주요 API
```cpp
// FAnimNode_Base 핵심 인터페이스
virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context);
virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context);
virtual void Update_AnyThread(const FAnimationUpdateContext& Context);
virtual void Evaluate_AnyThread(FPoseContext& Output);
virtual void EvaluateComponentSpace_AnyThread(FComponentSpacePoseContext& Output);
virtual int32 GetLODThreshold() const { return INDEX_NONE; }
virtual bool CanUpdateInWorkerThread() const { return true; }
```

---

> 🔄 **작성일**: 2025-11-07
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7.0
> 📂 **다음 문서**: [Compilation.md](./Compilation.md)