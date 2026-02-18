---
title: "PlayerController (플레이어 컨트롤러)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# PlayerController (플레이어 컨트롤러)

## 🧭 개요

**APlayerController**는 언리얼 엔진의 **플레이어 입력과 Pawn을 연결하는 브릿지**입니다. 사람 플레이어가 Pawn을 제어할 수 있도록 입력 처리, 카메라 관리, HUD 표시를 담당합니다.

**핵심 철학:**
> **PlayerController**는 "비월드 ↔ 월드 브릿지" (GameInstance ↔ Pawn),
> **AController**는 "Possession 관리" (Possess/UnPossess),
> **PlayerState**는 "복제된 플레이어 정보" (이름, 점수 등)를 담당한다.

**주요 특징:**
- **입력 처리**: UPlayerInput - 키/마우스/게임패드 이벤트
- **카메라 관리**: APlayerCameraManager - ViewTarget, FOV, PostProcess
- **HUD**: AHUD - UI 렌더링
- **Possession**: Possess() - Pawn 제어 시작, UnPossess() - 제어 종료
- **Tick 순서**: PlayerController → Pawn (최소 입력 지연)

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/GameFramework/PlayerController.h`
- `Engine/Source/Runtime/Engine/Private/PlayerController.cpp`
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Controller.h`

---

## 🧱 PlayerController 아키텍처

### 비월드 ↔ 월드 브릿지

**📂 위치:** `PlayerController.h:126-225` (External/Foundation)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        비월드 (Non-World)                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  UGameInstance                                                          │
│    │                                                                     │
│    └─ TArray<ULocalPlayer>                                              │
│         │                                                               │
│         └─ LocalPlayer0                                                 │
│              │                                                          │
│              ├─ PlayerController ───────────────┐                       │
│              │    │                             │ 브릿지                 │
│              │    ├─ PlayerInput (입력)         │                       │
│              │    ├─ PlayerCameraManager        │                       │
│              │    └─ HUD                        │                       │
│              │                                  │                       │
└──────────────┼──────────────────────────────────┼───────────────────────┘
               │                                  │
               │                                  │ Possess()
               │                                  ↓
┌──────────────┼──────────────────────────────────────────────────────────┐
│              │                 월드 (World)                             │
├──────────────┼──────────────────────────────────────────────────────────┤
│              │                                                          │
│              └─ UWorld                                                  │
│                   │                                                     │
│                   └─ PersistentLevel                                    │
│                        │                                                │
│                        ├─ PlayerController (RootComponent)              │
│                        │    │                                           │
│                        │    └─ RootComponent ──────┐                    │
│                        │                           │ Attached           │
│                        └─ Pawn                     │                    │
│                             │                      │                    │
│                             └─ RootComponent ◄─────┘                    │
│                                  │                                      │
│                                  ├─ PlayerController::RootComponent     │
│                                  ├─ InputComponent (입력 수신)           │
│                                  └─ CameraComponent (카메라 제공)        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 네트워크 환경의 PlayerState

**📂 위치:** `PlayerController.h:7-62` (External/Foundation)

```
[Standalone]
    PlayerController0
         └─ PlayerState0

[Networked - Client0]
    PlayerController0 (로컬)
         └─ PlayerState0 (자신)

    PlayerState1 (복제됨, 다른 플레이어)

[Networked - Server]
    PlayerController0
         └─ PlayerState0

    PlayerController1
         └─ PlayerState1
```

**특징:**
- **PlayerController**: 각 클라이언트는 자신의 것만 소유
- **PlayerState**: 모든 플레이어의 것이 모든 클라이언트에 복제됨

---

## 🎮 Possession 시스템

### Possess() - Pawn 제어 시작

**📂 위치:** `PlayerController.h:268-333` (External/Foundation)

```cpp
void AController::Possess(APawn* InPawn)
{
    // 1. 권한 확인 (서버만 실행)
    if (!HasAuthority())
    {
        return;
    }

    APawn* CurrentPawn = GetPawn();

    // 2. 파생 클래스에 알림 (커스터마이징 포인트)
    OnPossess(InPawn);

    // 3. 변경 감지 및 브로드캐스트
    APawn* NewPawn = GetPawn();
    if (NewPawn != CurrentPawn)
    {
        ReceivePossess(NewPawn);  // Blueprint 이벤트
        OnNewPawn.Broadcast(NewPawn);  // Delegate
        OnPossessedPawnChanged.Broadcast(CurrentPawn, NewPawn);
    }
}
```

**Possession 다이어그램:**
```
                   ***Possess NewPawn0
PlayerController ────────────────────────────► NewPawn0
 │                                               │
 ├─ RootComponent ────────────────────────►      └─ RootComponent
 │                  1.AttachToPawn()                │
 │                    (Transform 동기화)            ├─ PC::RootComponent
 │                                                  │
 ├─ PlayerCameraManager ──────────────────►        ├─ CameraComponent
 │                    2.Update ViewTarget           │
 │                      (카메라 타겟 설정)           │
 └─ PlayerInput ◄────────────────────────          └─ InputComponent
                     3.Register InputComponent
                       (입력 이벤트 수신)
                               │
                               └──► ***APawn::Restart()
                                    - 입력 바인딩
                                    - 카메라 초기화
```

### SetPawn() - 내부 연결 설정

**📂 위치:** `PlayerController.h:475-532` (External/Foundation)

```cpp
void AController::SetPawn(APawn* InPawn)
{
    // 1. 기존 Pawn Tick 의존성 제거
    RemovePawnTickDependency(Pawn);

    // 2. 새 Pawn 설정
    Pawn = InPawn;
    Character = Cast<ACharacter>(Pawn);

    // 3. RootComponent를 Pawn에 부착
    AttachToPawn(Pawn);

    // 4. Tick 순서 조정 (PC → Pawn)
    AddPawnTickDependency(Pawn);
}
```

**AttachToPawn() 구현:**
```cpp
void AController::AttachToPawn(APawn* InPawn)
{
    if (bAttachToPawn && RootComponent && InPawn)
    {
        // 기존 부착 해제
        RootComponent->DetachFromComponent(FDetachmentTransformRules::KeepRelativeTransform);

        // 상대 Transform 초기화 (Pawn과 정확히 일치)
        RootComponent->SetRelativeLocationAndRotation(
            FVector::ZeroVector,
            FRotator::ZeroRotator
        );

        // Pawn의 RootComponent에 부착
        RootComponent->AttachToComponent(
            InPawn->GetRootComponent(),
            FAttachmentTransformRules::KeepRelativeTransform
        );
    }
}
```

---

## ⏱️ Tick 의존성 관리

### AddPawnTickDependency()

**📂 위치:** `PlayerController.h:380-424` (External/Foundation)

```cpp
void AddPawnTickDependency(APawn* NewPawn)
{
    if (NewPawn)
    {
        bool bNeedsPawnPrereq = true;
        UPawnMovementComponent* PawnMovement = NewPawn->GetMovementComponent();

        // MovementComponent가 있으면 우선순위 설정
        if (PawnMovement && PawnMovement->PrimaryComponentTick.bCanEverTick)
        {
            // PC → MovementComponent
            PawnMovement->PrimaryComponentTick.AddPrerequisite(
                this,
                this->PrimaryActorTick
            );

            // Pawn이 이미 MovementComponent에 의존하면 Pawn 우선순위 불필요
            if (PawnMovement->bTickBeforeOwner ||
                NewPawn->PrimaryActorTick.GetPrerequisites().Contains(
                    FTickPrerequisite(PawnMovement, PawnMovement->PrimaryComponentTick)))
            {
                bNeedsPawnPrereq = false;
            }
        }

        // 필요하면 PC → Pawn 우선순위 추가
        if (bNeedsPawnPrereq)
        {
            NewPawn->PrimaryActorTick.AddPrerequisite(this, this->PrimaryActorTick);
        }
    }
}
```

**Tick 실행 순서:**
```
케이스 1: MovementComponent 없음
    PlayerController → Pawn

케이스 2: MovementComponent 있음 (bTickBeforeOwner = true)
    PlayerController → MovementComponent → Pawn

케이스 3: Pawn이 MovementComponent에 의존
    PlayerController → MovementComponent → Pawn
                                ▲            │
                                └────────────┘
                                   Prerequisite
```

**목적:** 입력 지연 최소화
- 입력 처리 (PC) → 이동 계산 (MovementComponent) → 시각 업데이트 (Pawn)

---

## 📷 카메라 시스템

### PlayerCameraManager

**📂 위치:** `PlayerController.h` (참조)

```cpp
class APlayerCameraManager
{
    /** 현재 ViewTarget (카메라가 바라보는 대상) */
    FTViewTarget ViewTarget;

    /** FOV 설정 */
    float DefaultFOV;
    float DefaultOrthoWidth;

    /** PostProcess 설정 */
    FPostProcessSettings CamPostProcessSettings;
};
```

**ViewTarget 구조:**
```cpp
struct FTViewTarget
{
    /** 타겟 Actor (보통 Pawn 또는 CameraActor) */
    TObjectPtr<AActor> Target;

    /** 계산된 Point of View */
    FMinimalViewInfo POV;  // Location, Rotation, FOV
};
```

**카메라 업데이트 흐름:**
```
PlayerController::UpdateRotation()
     │
     ↓
PlayerCameraManager->UpdateCamera()
     │
     ├─ ViewTarget->GetActorLocation() - 위치
     ├─ ViewTarget->GetActorRotation() - 회전
     └─ Calculate FOV, PostProcess
     ↓
FMinimalViewInfo (렌더러로 전달)
```

---

## 🎹 입력 시스템

### 입력 전파 경로

**📂 위치:** `PlayerController.h:211-223` (External/Foundation)

```
Platforms (PC, Console, Mobile)
        │
        ↓
UGameViewportClient::InputKey()
        │
        ↓
GameInstance
        │
        ↓
LocalPlayer
        │
        ↓
PlayerController::InputKey()
        │
        ↓
PlayerInput (키 바인딩 처리)
        │
        ↓
InputComponent (Pawn 또는 Controller)
        │
        ↓
Bound Functions (축 이벤트, 액션 이벤트)
```

### 입력 스택

```cpp
// PlayerController가 InputComponent 스택 관리
TArray<TWeakObjectPtr<UInputComponent>> CurrentInputStack;

// 우선순위: 위에서 아래로 처리
CurrentInputStack
    [0] - UI InputComponent (가장 높은 우선순위)
    [1] - PlayerController InputComponent
    [2] - Pawn InputComponent (가장 낮은 우선순위)
```

**입력 차단:**
```cpp
// UI가 활성화되면 게임 입력 차단
UInputComponent* UIInputComponent = NewObject<UInputComponent>();
UIInputComponent->bBlockInput = true;  // 아래 스택 차단
PlayerController->PushInputComponent(UIInputComponent);
```

---

## 💡 실전 패턴

### 패턴 1: Pawn 전환

```cpp
void AMyPlayerController::SwitchToPawn(APawn* NewPawn)
{
    if (GetPawn())
    {
        // 기존 Pawn UnPossess
        UnPossess();
    }

    // 새 Pawn Possess
    Possess(NewPawn);
}
```

### 패턴 2: 카메라 전환

```cpp
void AMyPlayerController::SetViewTargetToActor(AActor* NewViewTarget)
{
    if (PlayerCameraManager)
    {
        PlayerCameraManager->SetViewTarget(
            NewViewTarget,
            FViewTargetTransitionParams()  // 부드러운 전환
        );
    }
}

// 다시 Pawn으로 복귀
void AMyPlayerController::ResetViewTarget()
{
    SetViewTargetWithBlend(GetPawn(), 1.0f);  // 1초 블렌드
}
```

### 패턴 3: 입력 모드 전환

```cpp
// 게임 모드 (게임에만 입력)
void AMyPlayerController::SetGameOnlyInputMode()
{
    FInputModeGameOnly InputMode;
    SetInputMode(InputMode);
    bShowMouseCursor = false;
}

// UI 모드 (UI에만 입력)
void AMyPlayerController::SetUIOnlyInputMode(UUserWidget* Widget)
{
    FInputModeUIOnly InputMode;
    InputMode.SetWidgetToFocus(Widget->TakeWidget());
    SetInputMode(InputMode);
    bShowMouseCursor = true;
}

// 게임 + UI 모드
void AMyPlayerController::SetGameAndUIInputMode()
{
    FInputModeGameAndUI InputMode;
    InputMode.SetHideCursorDuringCapture(false);
    SetInputMode(InputMode);
    bShowMouseCursor = true;
}
```

### 패턴 4: 커스텀 입력 처리

```cpp
void AMyPlayerController::SetupInputComponent()
{
    Super::SetupInputComponent();

    // 축 바인딩
    InputComponent->BindAxis("MoveForward", this, &AMyPlayerController::MoveForward);
    InputComponent->BindAxis("MoveRight", this, &AMyPlayerController::MoveRight);
    InputComponent->BindAxis("Turn", this, &AMyPlayerController::AddYawInput);
    InputComponent->BindAxis("LookUp", this, &AMyPlayerController::AddPitchInput);

    // 액션 바인딩
    InputComponent->BindAction("Jump", IE_Pressed, this, &AMyPlayerController::Jump);
    InputComponent->BindAction("Fire", IE_Pressed, this, &AMyPlayerController::Fire);
}

void AMyPlayerController::MoveForward(float Value)
{
    if (APawn* ControlledPawn = GetPawn())
    {
        FVector Forward = ControlledPawn->GetActorForwardVector();
        ControlledPawn->AddMovementInput(Forward, Value);
    }
}
```

### 패턴 5: ControlRotation vs ActorRotation

```cpp
// ControlRotation: 카메라/조준 방향 (PlayerController)
FRotator ControlRot = GetControlRotation();

// ActorRotation: Pawn의 실제 회전 (Pawn)
FRotator PawnRot = GetPawn()->GetActorRotation();

// SetControlRotation: 카메라만 회전
SetControlRotation(FRotator(NewPitch, NewYaw, 0));

// ClientSetRotation: Pawn도 함께 회전
ClientSetRotation(NewRotation, true);  // bResetCamera
```

---

## 🌐 네트워크 복제

### PlayerState 사용

```cpp
UCLASS()
class AMyPlayerState : public APlayerState
{
    GENERATED_BODY()

public:
    // 복제할 변수
    UPROPERTY(Replicated)
    int32 Kills;

    UPROPERTY(Replicated)
    int32 Deaths;

    UPROPERTY(Replicated)
    int32 TeamID;

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override
    {
        Super::GetLifetimeReplicatedProps(OutLifetimeProps);

        DOREPLIFETIME(AMyPlayerState, Kills);
        DOREPLIFETIME(AMyPlayerState, Deaths);
        DOREPLIFETIME(AMyPlayerState, TeamID);
    }
};

// PlayerController에서 접근
AMyPlayerState* PS = GetPlayerState<AMyPlayerState>();
if (PS)
{
    int32 KDRatio = PS->Kills / FMath::Max(1, PS->Deaths);
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [PlayerController](https://docs.unrealengine.com/en-US/InteractiveExperiences/Framework/Controller/PlayerController/)
- Unreal Engine Docs: [Input](https://docs.unrealengine.com/en-US/InteractiveExperiences/Input/)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/GameFramework/PlayerController.h` - APlayerController 선언
- `Engine/Source/Runtime/Engine/Private/PlayerController.cpp` - 구현
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Controller.h` - AController 기반
- `UnrealSummary/External/Foundation/PlayerController.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/Pawn.md` - Pawn과 Possession
- `UnrealSummary/GameFramework/GameMode.md` - PlayerController 생성
- `UnrealSummary/GameFramework/World.md` - World에서의 Controller 관리

---

> 🔄 Created: 2025-01-XX — Initial documentation for PlayerController System (Possession, Input, Camera, Tick Dependencies) in UE 5.7
