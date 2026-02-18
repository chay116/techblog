---
title: "Component (컴포넌트 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# Component (컴포넌트 시스템)

## 🧭 개요

**UActorComponent**는 언리얼 엔진의 **재사용 가능한 행동을 정의하는 기본 클래스**입니다. Actor는 Component를 소유하여 기능을 모듈화합니다.

**핵심 철학:**
> **UActorComponent**는 "기능 단위" (로직, 데이터),
> **USceneComponent**는 "Transform 계층" (위치, 회전, 스케일),
> **UPrimitiveComponent**는 "물리와 렌더링" (충돌, 시각화)을 담당한다.

**주요 특징:**
- **Tick**: 매 프레임 업데이트 (FActorComponentTickFunction)
- **Lifecycle**: OnComponentCreated → OnRegister → Activate → InitializeComponent → BeginPlay
- **Replication**: 네트워크 복제 지원
- **Creation Method**: Native, SimpleConstructionScript, UserConstructionScript, Instance

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/Components/ActorComponent.h`
- `Engine/Source/Runtime/Engine/Private/Components/ActorComponent.cpp`
- `Engine/Source/Runtime/Engine/Classes/Components/SceneComponent.h`

---

## 🧱 Component 계층 구조

### 주요 Component 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UObject                                       │
│  (모든 UE 오브젝트의 기반)                                                │
└────────────────┬────────────────────────────────────────────────────────┘
                 ↓ 상속
┌─────────────────────────────────────────────────────────────────────────┐
│                       UActorComponent                                   │
│  (재사용 가능한 행동 정의)                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - PrimaryComponentTick : FActorComponentTickFunction                 │
│    - bRegistered : uint8 : 1          // 등록 여부                       │
│    - bRenderStateCreated : uint8 : 1  // 렌더 스테이트 생성 여부          │
│    - bAutoRegister : uint8 : 1        // 자동 등록                       │
│    - bAutoActivate : uint8 : 1        // 자동 활성화                      │
│    - OwnerPrivate : AActor*           // 소유 액터                       │
│    - WorldPrivate : UWorld*           // 월드                           │
│                                                                         │
│  Key Methods:                                                           │
│    + RegisterComponent() : void       // 컴포넌트 등록                   │
│    + UnregisterComponent() : void     // 컴포넌트 해제                   │
│    + Activate() : void                // 활성화                         │
│    + InitializeComponent() : void     // 초기화                         │
│    + BeginPlay() : void               // 게임 시작                       │
└────────────────┬────────────────────────────────────────────────────────┘
                 ↓ 상속
┌─────────────────────────────────────────────────────────────────────────┐
│                       USceneComponent                                   │
│  (Transform 지원 - 위치, 회전, 스케일)                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - ComponentToWorld : FTransform    // 월드 Transform                │
│    - RelativeLocation : FVector       // 상대 위치                       │
│    - RelativeRotation : FRotator      // 상대 회전                       │
│    - RelativeScale3D : FVector        // 상대 스케일                     │
│    - AttachParent : USceneComponent*  // 부모 컴포넌트                   │
│    - AttachChildren : TArray<...>     // 자식 컴포넌트 배열               │
│    - Mobility : EComponentMobility    // Static/Stationary/Movable     │
│                                                                         │
│  Key Methods:                                                           │
│    + UpdateComponentToWorld() : void  // Transform 업데이트             │
│    + AttachToComponent() : bool       // 부모에 연결                     │
│    + DetachFromComponent() : void     // 부모에서 분리                   │
│    + GetComponentLocation() : FVector // 월드 위치                      │
└────────────────┬────────────────────────────────────────────────────────┘
                 ↓ 상속
         ┌───────┴───────┬──────────────┬───────────────┐
         ↓               ↓              ↓               ↓
┌─────────────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐
│UPrimitiveComp   │ │ULightComp│ │UCameraComp│ │UAudioComponent │
│(렌더링+충돌)     │ │(조명)     │ │(카메라)    │ │(사운드)         │
└─────────────────┘ └──────────┘ └──────────┘ └────────────────┘
         │
         └─────┬─────────┬──────────────┐
               ↓         ↓              ↓
     ┌──────────────┐ ┌─────────┐ ┌────────────┐
     │UStaticMeshComp│ │UShapeComp│ │UDecalComp  │
     │(메시 렌더링)   │ │(충돌 형상)│ │(데칼)       │
     └──────────────┘ └─────────┘ └────────────┘
```

---

## 🧩 Component 생성 방법

### EComponentCreationMethod

**📂 위치:** `ActorComponent.h:11-22` (External/Foundation)

```cpp
enum class EComponentCreationMethod : uint8
{
    /** C++ 클래스에 정의된 Native 컴포넌트 */
    Native,

    /** Blueprint의 Component 섹션에서 생성 (SCS) */
    SimpleConstructionScript,

    /** UserConstructionScript 또는 BP Event Graph의 Add Component 노드 */
    UserConstructionScript,

    /** Details 패널에서 개별 Actor 인스턴스에 추가 */
    Instance,
};
```

**사용 예시:**
```cpp
// Native 컴포넌트
AMyActor::AMyActor()
{
    // Native 방식으로 생성
    MeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    MeshComponent->CreationMethod = EComponentCreationMethod::Native;
}

// SimpleConstructionScript (Blueprint에서 자동 설정)
// - BP 뷰포트에서 컴포넌트 추가 시 SCS 노드 생성
// - CreationMethod = SimpleConstructionScript

// UserConstructionScript (Blueprint Event Graph)
void AMyActor::UserConstructionScript()
{
    UStaticMeshComponent* DynamicMesh = NewObject<UStaticMeshComponent>(this);
    DynamicMesh->CreationMethod = EComponentCreationMethod::UserConstructionScript;
    DynamicMesh->RegisterComponent();
}
```

---

## 🔄 Component 생명주기

### 전체 흐름

```
    Actor 생성
         │
         ↓
    1. OnComponentCreated()
         │ (컴포넌트 생성 직후, 한 번만 호출)
         ↓
    2. OnRegister()
         │ (월드에 등록, bRegistered = true)
         │ - UpdateComponentToWorld() 호출
         │ - 렌더/물리 스테이트 생성 준비
         ↓
    3. CreateRenderState_Concurrent()
         │ (렌더 스테이트 생성, bRenderStateCreated = true)
         ↓
    4. Activate()
         │ (활성화, bIsActive = true)
         │ - Tick 활성화
         ↓
    5. InitializeComponent()
         │ (초기화, bHasBeenInitialized = true)
         │ - bWantsInitializeComponent = true 필요
         ↓
    6. BeginPlay()
         │ (게임 시작, bHasBegunPlay = true)
         │ - RegisterAllComponentTickFunctions()
         ↓
    7. Tick() (매 프레임)
         │
         ↓
    8. EndPlay()
         │ (게임 종료)
         ↓
    9. OnUnregister()
         │ (월드에서 해제)
         │ - DestroyRenderState_Concurrent()
         ↓
    10. DestroyComponent()
```

**주요 이벤트 설명:**

| 이벤트 | 호출 시점 | 용도 |
|--------|----------|------|
| **OnComponentCreated** | 컴포넌트 생성 직후 | 초기 설정 |
| **OnRegister** | 월드 등록 시 | Transform 업데이트, 렌더/물리 스테이트 생성 |
| **Activate** | bAutoActivate = true 시 | Tick 활성화 |
| **InitializeComponent** | 초기화 필요 시 | 컴포넌트별 초기화 로직 |
| **BeginPlay** | 게임 시작 시 | 게임 로직 시작 |

---

## ⏱️ Component Tick 시스템

### FActorComponentTickFunction

**📂 위치:** `ActorComponent.h:2-7` (External/Foundation)

```cpp
struct FActorComponentTickFunction : public FTickFunction
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
                // UActorComponent::Tick 호출
                Target->ConditionalTickComponent(DeltaTime, TickType, *this);
            }
        }
    }

    UActorComponent* Target;  // 대상 컴포넌트
};
```

**Tick 설정:**
```cpp
class UMyComponent : public UActorComponent
{
public:
    UMyComponent()
    {
        // Tick 활성화
        PrimaryComponentTick.bCanEverTick = true;
        PrimaryComponentTick.bStartWithTickEnabled = true;
        PrimaryComponentTick.TickGroup = TG_PrePhysics;
    }

    virtual void TickComponent(float DeltaTime, ELevelTick TickType,
                               FActorComponentTickFunction* ThisTickFunction) override
    {
        Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

        // 컴포넌트 업데이트 로직
    }
};
```

---

## 🎨 Render State 관리

### CreateRenderState_Concurrent

**📂 위치:** `ActorComponent.h:156-169` (External/Foundation)

```cpp
virtual void CreateRenderState_Concurrent(FRegisterComponentContext* Context)
{
    // 렌더 스테이트 생성 완료 표시
    bRenderStateCreated = true;

    // Dirty 플래그 초기화
    bRenderStateDirty = false;
    bRenderTransformDirty = false;

    // 실제 렌더 스테이트는 UPrimitiveComponent에서 생성
    // (UActorComponent는 렌더링 없음)
}
```

**렌더 업데이트 플로우:**
```cpp
// 1. Transform 변경
SetRelativeLocation(NewLocation);
    │
    ↓
// 2. Transform 업데이트
UpdateComponentToWorld()
    │
    ↓
// 3. Render Transform Dirty 마킹
MarkRenderTransformDirty()
    │ - bRenderTransformDirty = true
    │ - MarkForNeededEndOfFrameUpdate() 호출
    ↓
// 4. 프레임 끝에서 일괄 처리
DoDeferredRenderUpdates_Concurrent()
    │
    ├─ bRenderStateDirty == true
    │   └─ RecreateRenderState_Concurrent()
    │
    └─ bRenderTransformDirty == true
        └─ SendRenderTransform_Concurrent()
```

---

## 🔗 SceneComponent - Attachment 시스템

### AttachToComponent

**📂 위치:** `SceneComponent.h:2562-2878` (External/Foundation)

```cpp
bool AttachToComponent(
    USceneComponent* Parent,
    const FAttachmentTransformRules& AttachmentRules,
    FName SocketName = NAME_None
)
{
    // 1. 유효성 검사
    if (Parent == this) return false;  // 자기 자신에게 붙일 수 없음
    if (Parent->IsAttachedTo(this)) return false;  // 순환 참조 방지

    // 2. 기존 부모에서 분리
    DetachFromComponent(FDetachmentTransformRules(AttachmentRules, true));

    // 3. Tick 의존성 설정 (부모 Tick 후 자식 Tick)
    PrimaryComponentTick.AddPrerequisite(Parent, Parent->PrimaryComponentTick);

    // 4. 부모-자식 관계 설정
    SetAttachParent(Parent);
    SetAttachSocketName(SocketName);
    Parent->AttachChildren.Add(this);

    // 5. Transform 규칙 적용
    FTransform SocketTransform = Parent->GetSocketTransform(SocketName);
    FTransform RelativeTM = GetComponentTransform().GetRelativeTransform(SocketTransform);

    switch (AttachmentRules.LocationRule)
    {
    case EAttachmentRule::KeepRelative:
        // 현재 RelativeLocation 유지
        break;
    case EAttachmentRule::KeepWorld:
        // 월드 위치 유지하도록 RelativeLocation 계산
        SetRelativeLocation_Direct(RelativeTM.GetTranslation());
        break;
    case EAttachmentRule::SnapToTarget:
        // 부모 위치로 스냅
        SetRelativeLocation_Direct(FVector::ZeroVector);
        break;
    }

    // 6. ComponentToWorld 업데이트
    UpdateComponentToWorld(EUpdateTransformFlags::None, ETeleportType::TeleportPhysics);

    // 7. Overlap 업데이트
    if (IsRegistered())
    {
        UpdateOverlaps();
    }

    return true;
}
```

### Attachment Transform 규칙

**📂 위치:** `SceneComponent.h:964-976, 979-1096` (External/Foundation)

```cpp
enum class EAttachmentRule : uint8
{
    /** 현재 상대 Transform 유지 */
    KeepRelative,

    /** 월드 Transform 유지 (자동 계산) */
    KeepWorld,

    /** 부모 위치로 스냅 */
    SnapToTarget,
};

struct FAttachmentTransformRules
{
    EAttachmentRule LocationRule;     // 위치 규칙
    EAttachmentRule RotationRule;     // 회전 규칙
    EAttachmentRule ScaleRule;        // 스케일 규칙
    bool bWeldSimulatedBodies;        // 물리 바디 용접 여부
};
```

**사용 예시:**
```cpp
// KeepRelative: 상대 오프셋 유지
FAttachmentTransformRules Rules = FAttachmentTransformRules::KeepRelativeTransform;
ChildComponent->AttachToComponent(ParentComponent, Rules);

// KeepWorld: 월드 위치 유지
Rules = FAttachmentTransformRules::KeepWorldTransform;
ChildComponent->AttachToComponent(ParentComponent, Rules);

// SnapToTarget: 부모에 정확히 붙이기
Rules = FAttachmentTransformRules::SnapToTargetIncludingScale;
ChildComponent->AttachToComponent(ParentComponent, Rules, TEXT("WeaponSocket"));
```

**Attachment 다이어그램:**
```
[KeepRelative 예시]
        A (Parent)                         A (Parent)
       ┌──────┐                           ┌──────┐
       │      │                           │      │
       │  x   │                           │  x   │
       │      │                           │      ├─────┐
       └──────┘     B (Child)             └──────┘     B
 Y                  ┌──────┐                           ┌┴─────┐
  ▲                 │      │         Attach            │      │
  │                 │  x   │        ────────►          │  x   │
  │                 │      │        (Relative +5,0)    │      │
  │                 └──────┘                           └──────┘
  └──────►X

[KeepWorld 예시]
        A (Parent)                         A (Parent)
       ┌──────┐                           ┌──────┐
       │      │                           │      │
       │  x   │                           │  x   │
       │      │                           │      │
       └──────┘     B (Child)             └──────┘     B (Child)
 Y                  ┌──────┐                           ┌──────┐
  ▲                 │      │         Attach            │      │
  │                 │  x   │        ────────►          │  x   │
  │                 │      │        (World 유지)       │      │
  │                 └──────┘                           └──────┘
  └──────►X
  * B의 RelativeLocation은 자동 계산됨
```

---

## 🌍 Transform 업데이트 시스템

### UpdateComponentToWorld

**📂 위치:** `SceneComponent.h:1666-2172` (External/Foundation)

```cpp
virtual void UpdateComponentToWorld(
    EUpdateTransformFlags UpdateTransformFlags = EUpdateTransformFlags::None,
    ETeleportType Teleport = ETeleportType::None
) override final
{
    UpdateComponentToWorldWithParent(
        GetAttachParent(),
        GetAttachSocketName(),
        UpdateTransformFlags,
        RelativeRotationCache.RotatorToQuat(GetRelativeRotation()),
        Teleport
    );
}
```

**업데이트 흐름:**
```cpp
void UpdateComponentToWorldWithParent(...)
{
    // 1. 부모가 아직 업데이트 안 됐으면 먼저 업데이트
    if (Parent && !Parent->bComponentToWorldUpdated)
    {
        Parent->UpdateComponentToWorld();
        if (bComponentToWorldUpdated) return;  // 이미 업데이트됨
    }

    // 2. 업데이트 완료 표시
    bComponentToWorldUpdated = true;

    // 3. 새 Transform 계산
    FTransform RelativeTransform(RelativeRotationQuat, GetRelativeLocation(), GetRelativeScale3D());
    FTransform NewTransform = CalcNewComponentToWorld(RelativeTransform, Parent, SocketName);

    // 4. Transform 변경 확인
    bool bHasChanged = !GetComponentTransform().Equals(NewTransform, UE_SMALL_NUMBER);

    // 5. Transform 적용 및 전파
    if (bHasChanged || Teleport != ETeleportType::None)
    {
        ComponentToWorld = NewTransform;
        PropagateTransformUpdate(true, UpdateTransformFlags, Teleport);
    }
    else
    {
        PropagateTransformUpdate(false);
    }
}
```

**PropagateTransformUpdate 흐름:**
```cpp
void PropagateTransformUpdate(bool bTransformChanged, ...)
{
    if (bTransformChanged)
    {
        // 1. Bounds 업데이트
        UpdateBounds();

        // 2. Render Transform Dirty 마킹
        if (bRegistered)
        {
            if (bWantsOnUpdateTransform)
            {
                OnUpdateTransform(UpdateTransformFlags, Teleport);
            }
            TransformUpdated.Broadcast(this, UpdateTransformFlags, Teleport);

            // 렌더 월드에 Transform 변경 통지
            MarkRenderTransformDirty();
        }

        // 3. 자식 컴포넌트 업데이트
        if (AttachChildren.Num() > 0)
        {
            UpdateChildTransforms(ChildrenFlagNoPhysics, Teleport);
        }
    }
    else
    {
        // Transform은 안 바뀌었지만 자식은 업데이트
        UpdateBounds();
        if (AttachChildren.Num() > 0)
        {
            UpdateChildTransforms();
        }
        if (bRegistered)
        {
            MarkRenderTransformDirty();
        }
    }
}
```

---

## ⚙️ Component Mobility

**📂 위치:** `SceneComponent.h:1100-1131` (External/Foundation)

```cpp
namespace EComponentMobility
{
    enum Type : int32
    {
        /** 정적 - 움직이지 않음, 라이트맵 베이킹 가능, 가장 빠름 */
        Static,

        /** 준정적 - 위치 고정, 방향/색상 변경 가능 (주로 라이트) */
        Stationary,

        /** 동적 - 자유롭게 이동 가능, 동적 섀도우, 가장 느림 */
        Movable,
    };
}
```

**사용 예시:**
```cpp
// Static 컴포넌트 (건물, 지형)
UStaticMeshComponent* BuildingMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Building"));
BuildingMesh->Mobility = EComponentMobility::Static;  // 라이트맵 베이킹
BuildingMesh->SetStaticMesh(BuildingAsset);

// Stationary 라이트 (태양, 가로등)
UDirectionalLightComponent* Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
Sun->Mobility = EComponentMobility::Stationary;  // 방향/색상만 변경 가능
Sun->SetIntensity(5.0f);

// Movable 컴포넌트 (캐릭터, 차량)
USkeletalMeshComponent* Character = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Mesh"));
Character->Mobility = EComponentMobility::Movable;  // 완전히 동적
```

---

## 💡 실전 패턴

### 패턴 1: 동적 컴포넌트 생성

```cpp
void AMyActor::PostInitializeComponents()
{
    Super::PostInitializeComponents();

    // 컴포넌트 동적 생성
    UStaticMeshComponent* DynamicMesh = NewObject<UStaticMeshComponent>(this, TEXT("DynamicMesh"));
    DynamicMesh->SetupAttachment(RootComponent);
    DynamicMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Meshes/MyMesh.MyMesh")));
    DynamicMesh->RegisterComponent();  // 즉시 등록

    // CreationMethod 설정
    DynamicMesh->CreationMethod = EComponentCreationMethod::Instance;
}
```

### 패턴 2: Attachment 체인

```cpp
// 무기 부착 예시
AWeapon::AWeapon()
{
    // Root
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));

    // 무기 메시
    WeaponMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WeaponMesh"));
    WeaponMesh->SetupAttachment(RootComponent);

    // 조준경
    ScopeMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ScopeMesh"));
    ScopeMesh->SetupAttachment(WeaponMesh, TEXT("ScopeSocket"));

    // 총구 화염 이펙트
    MuzzleFlash = CreateDefaultSubobject<UParticleSystemComponent>(TEXT("MuzzleFlash"));
    MuzzleFlash->SetupAttachment(WeaponMesh, TEXT("MuzzleSocket"));
    MuzzleFlash->bAutoActivate = false;
}

void AWeapon::Fire()
{
    // 총구 화염 활성화
    MuzzleFlash->Activate(true);
}
```

### 패턴 3: Transform 동기화

```cpp
void AFollowerActor::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (TargetActor)
    {
        // 타겟 위치 추적 (오프셋 포함)
        FVector TargetLocation = TargetActor->GetActorLocation() + Offset;
        FRotator TargetRotation = TargetActor->GetActorRotation();

        // 부드럽게 이동
        FVector NewLocation = FMath::VInterpTo(
            GetActorLocation(),
            TargetLocation,
            DeltaTime,
            InterpSpeed
        );

        SetActorLocation(NewLocation);
    }
}
```

### 패턴 4: Component 재등록 (설정 변경)

```cpp
void AMyActor::ChangeCollisionSettings()
{
    // FComponentReregisterContext: RAII 패턴
    // - 생성 시 UnregisterComponent
    // - 소멸 시 RegisterComponent
    {
        FComponentReregisterContext ReregisterContext(MeshComponent);

        // 충돌 설정 변경
        MeshComponent->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
        MeshComponent->SetCollisionProfileName(TEXT("BlockAll"));

    }  // 여기서 자동 재등록
}
```

### 패턴 5: Welding (물리 바디 병합)

```cpp
void ACompoundActor::BeginPlay()
{
    Super::BeginPlay();

    // 자식 컴포넌트들을 Root에 Weld
    for (UPrimitiveComponent* Child : ChildComponents)
    {
        FAttachmentTransformRules Rules(
            EAttachmentRule::KeepWorld,
            EAttachmentRule::KeepWorld,
            EAttachmentRule::KeepWorld,
            true  // bWeldSimulatedBodies = true
        );

        Child->AttachToComponent(RootComponent, Rules);
        // 이제 모든 자식의 물리가 Root의 물리 바디로 병합됨
    }
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Components](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/GameplayArchitecture/Components/)
- Unreal Engine Docs: [SceneComponent](https://docs.unrealengine.com/en-US/API/Runtime/Engine/Components/USceneComponent/)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/Components/ActorComponent.h` - UActorComponent 선언
- `Engine/Source/Runtime/Engine/Private/Components/ActorComponent.cpp` - UActorComponent 구현
- `Engine/Source/Runtime/Engine/Classes/Components/SceneComponent.h` - USceneComponent 선언
- `UnrealSummary/External/Foundation/ActorComponent.h` - 주석 달린 핵심 코드
- `UnrealSummary/External/Foundation/SceneComponent.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/Actor.md` - Actor 시스템
- `UnrealSummary/GameFramework/TickSystem.md` - Tick 관리
- `UnrealSummary/Core/SmartPointers.md` - TObjectPtr

---

> 🔄 Created: 2025-01-XX — Initial documentation for Component System (UActorComponent, USceneComponent) in UE 5.7
