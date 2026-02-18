---
title: "Linked Animation Graph (연결된 애니메이션 그래프)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "AnimGraph"]
---
# Linked Animation Graph (연결된 애니메이션 그래프)

## 🧭 개요 (Overview)

**Linked Animation Graph(연결된 애니메이션 그래프)는 언리얼 엔진의 애니메이션 시스템에서 모듈화와 재사용성을 극대화하는 고급 기능입니다.** 이 시스템은 애니메이션 블루프린트 간 동적이고 유연한 상호작용을 가능하게 하여, 복잡한 애니메이션 로직을 더욱 효율적으로 관리할 수 있게 합니다.

### 🎯 핵심 목표

1. **애니메이션 모듈화**: 애니메이션 로직을 독립적이고 재사용 가능한 컴포넌트로 분리
2. **동적 연결**: 런타임에 애니메이션 그래프 연결 및 변경
3. **계층적 애니메이션 제어**: 상속 및 레이어 오버라이딩 지원

## 🏗️ 시스템 아키텍처

```
[Base Animation BP]
         │
         ├─ [Linked Anim Graph Node]
         │    ├─ Target Class: WeaponAnimBP
         │    ├─ Input Poses
         │    └─ Dynamic Linking
         │
         └─ [Blend/Process Nodes]
```

## 🧩 주요 구성 요소

### 1. FAnimNode_LinkedAnimGraph

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_LinkedAnimGraph.h:21`

#### 주요 멤버:

```cpp
struct FAnimNode_LinkedAnimGraph : public FAnimNode_CustomProperty
{
    // 입력 포즈 배열
    UPROPERTY()
    TArray<FPoseLink> InputPoses;

    // 입력 포즈 이름 배열
    UPROPERTY()
    TArray<FName> InputPoseNames;

    // 인스턴스화할 AnimInstance 클래스
    UPROPERTY(EditAnywhere, Category = Settings)
    TSubclassOf<UAnimInstance> InstanceClass;

    // 연결된 그래프의 루트 노드
    FAnimNode_Base* LinkedRoot;
};
```

### 2. FAnimNode_LinkedAnimLayer

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_LinkedAnimLayer.h:21`

#### 주요 멤버:

```cpp
struct FAnimNode_LinkedAnimLayer : public FAnimNode_LinkedAnimGraph
{
    // 인터페이스 제한 (선택적)
    UPROPERTY()
    TSubclassOf<UAnimLayerInterface> Interface;

    // 사용할 레이어 이름
    UPROPERTY(EditAnywhere, Category = Settings)
    FName Layer;
};
```

## 🔄 작동 원리 (Workflow)

### 1. 컴파일 타임 준비

```
[컴파일러]
    │
    ├─ LinkedAnimGraph 노드 감지
    ├─ InputPoses 배열 생성
    └─ InstanceClass 설정
```

### 2. 런타임 초기화

```
[Main AnimBP]        [Linked AnimBP]
    │                    │
    │ Initialize         │
    ├─────────────────>  │
    │                    │ 인스턴스 생성
    │                    │ 속성 초기화
    │                    │ 포즈 연결
    │<─────────────────  │
```

### 3. 프레임 업데이트

```
[Main AnimBP]        [Linked AnimBP]
    │                    │
    │ Update             │
    ├─────────────────>  │
    │                    │ 포즈 평가
    │                    │ 속성 전파
    │<─────────────────  │
```

## 🎨 실전 예시

### 예시 1: 무기별 상체 애니메이션

```cpp
// 무기 레이어 인터페이스
UINTERFACE(BlueprintType)
class UWeaponLayerInterface : public UAnimLayerInterface
{
    GENERATED_BODY()
};

class IWeaponLayerInterface
{
    GENERATED_BODY()

    // 무기별 상체 포즈 레이어
    UFUNCTION(BlueprintImplementableEvent)
    void UpperBodyPose(const FPoseLink& BasePose, FPoseLink& OutPose);
};

// 메인 캐릭터 AnimBP
void AMyCharacter::EquipWeapon(EWeaponType WeaponType)
{
    UAnimInstance* AnimInstance = GetMesh()->GetAnimInstance();

    switch (WeaponType)
    {
    case EWeaponType::Rifle:
        AnimInstance->LinkAnimClassLayers(URifleLayersAnimBP::StaticClass());
        break;
    case EWeaponType::Pistol:
        AnimInstance->LinkAnimClassLayers(UPistolLayersAnimBP::StaticClass());
        break;
    }
}
```

### 예시 2: 재사용 가능한 IK 모듈

```
AnimGraph:
  [Base Pose] ──> [Linked Anim Graph: IK_AnimBP]
                       │
                       ├─ Two Bone IK (Left Hand)
                       ├─ Two Bone IK (Right Hand)
                       ├─ Foot IK (Left)
                       ├─ Foot IK (Right)
                       │
                       └─ [Output Pose]
```

## 🚨 주의사항

### ❌ 피해야 할 패턴

1. **과도한 중첩 피하기**
```
❌ 깊이 5단계 Linked Graph
[Main] → [A] → [B] → [C] → [D] → [E]

✅ 권장: 2-3단계 이하로 제한
```

2. **빈번한 클래스 변경 피하기**
```cpp
❌ 매 프레임 SetAnimClass
void Tick(float DeltaTime)
{
    LinkedNode->Node.SetAnimClass(GetCurrentWeaponClass(), this);  // 비효율적
}

✅ 무기 교체 시에만 변경
void OnWeaponChanged()
{
    LinkedNode->Node.SetAnimClass(NewWeaponClass, this);  // 효율적
}
```

## 📊 성능 최적화

### ✅ 권장 사항

1. **인스턴스 공유**
2. **필요한 레이어만 오버라이드**
3. **최소한의 속성 전파**

## 🔗 참고 문서

- [AnimInstance.md](../Core/AnimInstance.md)
- [AnimNodes.md](./AnimNodes.md)
- [Compilation.md](./Compilation.md)

---

> 🔄 **작성일**: 2025-11-07
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7.0