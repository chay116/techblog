---
title: "스켈레톤 (Skeleton)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "Core"]
---
# 스켈레톤 (Skeleton)

## 🧭 개요 (Overview)

**USkeleton**은 언리얼 엔진의 애니메이션 시스템에서 골격 구조와 움직임을 정의하는 핵심 자산입니다. 이는 다음과 같은 중요한 역할을 수행합니다:

### 핵심 특징
- 본(Bone) 계층 구조 관리
- 애니메이션과 스켈레탈 메시 간의 연결 고리
- 리타게팅 (Retargeting) 지원
- 애니메이션 곡선 및 메타데이터 관리

### 시스템 내 위치
```
┌─────────────────────────────────┐
│           Animation             │
├─────────────────────────────────┤
│ SkeletalMesh ─┬─ Skeleton       │
│               ├─ AnimSequence   │
│               └─ Rig            │
└─────────────────────────────────┘
```

### 설계 철학
USkeleton은 애니메이션 데이터의 **이식성**과 **재사용성**을 극대화하도록 설계되었습니다. 단일 스켈레톤으로 여러 메시와 애니메이션을 공유할 수 있어, 리소스 관리와 애니메이션 제작의 효율성을 높입니다.

### 주요 특징
- 뼈대(Bone) 계층 구조 정의
- 애니메이션 리타게팅 지원
- 가상 본(Virtual Bone) 생성 기능
- 소켓(Socket) 관리
- 곡선(Curve) 및 메타데이터 관리

## 🏗️ 설계 철학 및 동기

### 왜 별도의 스켈레톤 에셋인가?

#### 1. 애니메이션 재사용성
- 동일한 스켈레톤을 공유하는 여러 메시에 대해 애니메이션을 쉽게 재사용 가능
- 예: 인간형 캐릭터의 걷기, 달리기 애니메이션을 다양한 메시에 적용

#### 2. 리타게팅 지원
- 서로 다른 비율의 캐릭터 간 애니메이션 공유
- 다양한 리타게팅 모드 제공
  - 애니메이션 기준
  - 스켈레톤 기준
  - 확장/압축 지원

#### 3. 계층적 본 구조 관리
- 복잡한 골격 구조의 추상화
- 부모-자식 본 관계 명확한 정의
- 계층 구조를 통한 변형 전파

### 본 계층 구조 관리 전략
```
     Root
    /    \
  Spine  Neck
   |      |
Pelvis   Head
   |
Legs
```

### 리타게팅 모드 설계 원리
- **Animation**: 원본 애니메이션 데이터 그대로 사용
- **Skeleton**: 스켈레톤의 고정된 변환 사용
- **AnimationScaled**: 골격 비율에 따라 길이 조정
- **AnimationRelative**: 기준 포즈와의 상대적 차이 고려
- **OrientAndScale**: 방향과 스케일 조정

## 🧩 클래스 구조

### USkeleton (주요 클래스)
```cpp
UCLASS(hidecategories=Object, MinimalAPI, BlueprintType)
class USkeleton : public UObject
{
    // 본 트리
    UPROPERTY()
    TArray<struct FBoneNode> BoneTree;

    // 참조 스켈레톤
    FReferenceSkeleton ReferenceSkeleton;

    // 가상 본
    UPROPERTY()
    TArray<FVirtualBone> VirtualBones;

    // 호환 가능한 스켈레톤들
    UPROPERTY()
    TArray<TSoftObjectPtr<USkeleton>> CompatibleSkeletons;
};
```

### FReferenceSkeleton (본 계층)
```cpp
struct FReferenceSkeleton
{
    // 본 이름들
    TArray<FName> BoneNames;

    // 본 부모 인덱스
    TArray<int32> BoneParents;

    // 참조 포즈 변환
    TArray<FTransform> RefBonePose;
};
```

### FSkeletonToMeshLinkup (메시 매핑)
```cpp
struct FSkeletonToMeshLinkup
{
    // 스켈레톤에서 메시로의 매핑
    TArray<int32> SkeletonToMeshTable;

    // 메시에서 스켈레톤으로의 매핑
    TArray<int32> MeshToSkeletonTable;
};
```

### FBoneNode (본 노드 정보)
```cpp
struct FBoneNode
{
    // 리타게팅 모드
    TEnumAsByte<EBoneTranslationRetargetingMode::Type>
        TranslationRetargetingMode;
};
```

### FVirtualBone (가상 본)
```cpp
struct FVirtualBone
{
    FName SourceBoneName;     // 원본 본
    FName TargetBoneName;     // 대상 본
    FName VirtualBoneName;    // 가상 본 이름
};
```

## 🛠️ 핵심 기능

### 본 계층 관리
- 복잡한 골격 구조 표현
- 부모-자식 관계 정의
- 계층적 변형 전파

### 리타게팅 모드
- `Animation`: 원본 애니메이션 사용
- `Skeleton`: 고정된 스켈레톤 변환
- `AnimationScaled`: 길이 비율 조정
- `AnimationRelative`: 상대적 차이 고려
- `OrientAndScale`: 방향/스케일 조정

### 호환 가능한 스켈레톤
- 애니메이션 교환 지원
- 유연한 캐릭터 애니메이션 시스템

### 가상 본
- 기존 본 사이에 새로운 본 생성
- 애니메이션 제작 유연성 증대

### 소켓
- 본에 추가 참조점 생성
- 아이템, 무기 등 장착 지원

### 곡선 메타데이터
- 애니메이션 곡선에 대한 추가 정보 관리
- 머티리얼, 모프 타겟 제어

### 슬롯 그룹
- 애니메이션 슬롯 논리적 그룹화
- 애니메이션 블렌딩 및 우선순위 관리

## 🚀 실전 예시 및 성능 고려사항

### 가상 본 생성 예시
```cpp
// 왼쪽 손목과 왼쪽 팔꿈치 사이에 가상 본 추가
Skeleton->AddNewVirtualBone(
    FName("LeftForearm"),
    FName("LeftHand")
);
```

### 리타게팅 모드 설정
```cpp
// 특정 본의 리타게팅 모드 변경
Skeleton->SetBoneTranslationRetargetingMode(
    BoneIndex,
    EBoneTranslationRetargetingMode::AnimationScaled
);
```

### 성능 최적화 팁
- 가능한 한 적은 수의 본 사용
- 가상 본 생성은 최소화
- 호환 가능한 스켈레톤 수 제한

### 디버깅 포인트
- 본 계층 일치 여부 확인
- 리타게팅 모드 테스트
- 가상 본 정확성 검증

## 💡 참조 및 추가 자료

### 소스 참조
- 파일 위치: `Engine/Source/Runtime/Engine/Classes/Animation/Skeleton.h`
- 라인: 293-1037 (USkeleton 클래스)

### 공식 문서
- [언리얼 엔진 스켈레톤 문서](https://docs.unrealengine.com/skeleton)

## 버전 정보
> 업데이트: 2025-11-07 — 스켈레톤 시스템 심층 분석 및 문서화