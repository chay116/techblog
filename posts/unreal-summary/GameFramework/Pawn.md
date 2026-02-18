---
title: "Pawn (폰과 캐릭터)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# Pawn (폰과 캐릭터)

## 🧭 개요

**APawn**은 언리얼 엔진의 **플레이어나 AI가 제어할 수 있는 물리적 표현**입니다. Controller가 Possess하여 제어할 수 있으며, 입력을 받아 움직임과 행동을 수행합니다.

**핵심 철학:**
> **Pawn**은 "제어 가능한 개체" (Possess 대상, 물리적 존재),
> **Character**는 "이족 보행 캐릭터" (CharacterMovementComponent),
> **Controller**는 "제어 주체" (Possess/UnPossess 권한)를 담당한다.

**주요 특징:**
- **Possession**: Controller가 Possess하여 제어
- **입력 처리**: InputComponent - 입력 이벤트 수신
- **이동**: MovementComponent - 물리 기반 이동
- **회전 제어**: bUseControllerRotation* - Controller의 회전 적용 여부
- **Restart**: Possession 변경 시 초기화

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Pawn.h`
- `Engine/Source/Runtime/Engine/Private/Pawn.cpp`
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Character.h`

---

## 🧱 Pawn 계층 구조

### Pawn vs Character

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            APawn                                        │
│  (제어 가능한 기본 개체)                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - Controller : AController*                // 소유 Controller        │
│    - PlayerState : APlayerState*              // 플레이어 상태           │
│    - InputComponent : UInputComponent*        // 입력 컴포넌트           │
│    - ControlInputVector : FVector             // 누적 입력 벡터          │
│    - bUseControllerRotation* : bool           // 회전 제어 설정          │
│                                                                         │
│  Key Methods:                                                           │
│    + PossessedBy(AController*) : void         // Possess 이벤트         │
│    + UnPossessed() : void                     // UnPossess 이벤트       │
│    + Restart() : void                         // Possession 후 초기화   │
│    + AddMovementInput(FVector, float) : void  // 입력 누적              │
│    + ConsumeMovementInputVector() : FVector   // 입력 소비              │
│    + FaceRotation(FRotator) : void            // 회전 적용              │
└────────────────┬────────────────────────────────────────────────────────┘
                 ↓ 상속
┌─────────────────────────────────────────────────────────────────────────┐
│                         ACharacter                                      │
│  (이족 보행 캐릭터)                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - CharacterMovementComponent : UCharacter...   // 캐릭터 이동        │
│    - CapsuleComponent : UCapsuleComponent*        // 충돌 캡슐          │
│    - Mesh : USkeletalMeshComponent*               // 스켈레탈 메시      │
│                                                                         │
│  Key Methods:                                                           │
│    + Jump() : void                                // 점프               │
│    + Crouch() : void                              // 앉기               │
│    + CanJumpInternal() : bool                     // 점프 가능 여부     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 👤 Possession 시스템

### PossessedBy() - Pawn 관점

**📂 위치:** `Pawn.h:176-201` (External/Foundation)

```cpp
void APawn::PossessedBy(AController* NewController)
{
    // 1. Owner 설정 (네트워크 복제용)
    SetOwner(NewController);

    // 2. Controller 설정
    AController* OldController = Controller;
    Controller = NewController;
    ForceNetUpdate();  // 즉시 네트워크 업데이트

    // 3. PlayerState 연결
    if (Controller->PlayerState)
    {
        SetPlayerState(Controller->PlayerState);
    }

    // 4. Blueprint 이벤트 알림
    if (OldController != NewController)
    {
        ReceivePossessed(Controller);
        NotifyControllerChanged();
    }
}
```

### SetPlayerState() - PlayerState 양방향 연결

**📂 위치:** `Pawn.h:204-227` (External/Foundation)

```cpp
void APawn::SetPlayerState(APlayerState* NewPlayerState)
{
    APlayerState* OldPlayerState = PlayerState;

    // 기존 PlayerState 연결 해제
    if (PlayerState && PlayerState->GetPawn() == this)
    {
        FSetPlayerStatePawn(PlayerState, nullptr);
    }

    // 새 PlayerState 연결
    PlayerState = NewPlayerState;
    if (PlayerState)
    {
        FSetPlayerStatePawn(PlayerState, this);
        // PlayerState->OnPawnSet.Broadcast() 호출됨
    }

    OnPlayerStateChanged(NewPlayerState, OldPlayerState);
}
```

**FSetPlayerStatePawn 구조체:**
```cpp
struct FSetPlayerStatePawn
{
    FSetPlayerStatePawn(APlayerState* PlayerState, APawn* Pawn)
    {
        APawn* OldPawn = PlayerState->PawnPrivate;
        PlayerState->SetPawnPrivate(Pawn);

        // Delegate 브로드캐스트
        PlayerState->OnPawnSet.Broadcast(PlayerState, Pawn, OldPawn);
    }
};
```

**양방향 연결:**
```
PlayerController
     │
     ├─ PlayerState ◄────────┐
     │                       │ 양방향 연결
     └─ Pawn ────────────────┘
          │
          └─ PlayerState (캐시)
```

---

## 🔄 Restart 시스템

### DispatchRestart() - Possession 후 초기화

**📂 위치:** `Pawn.h:152-169` (External/Foundation)

```cpp
void APawn::DispatchRestart(bool bCallClientRestart)
{
    if (bCallClientRestart)
    {
        // 로컬 플레이어: 클라이언트 전용 로직 포함
        PawnClientRestart();
    }
    else
    {
        // AI 또는 원격 플레이어: 기본 Restart만
        Restart();
    }

    // Blueprint 알림
    NotifyRestarted();
}
```

### PawnClientRestart() - 클라이언트 초기화

**📂 위치:** `Pawn.h:96-135` (External/Foundation)

```cpp
void APawn::PawnClientRestart()
{
    // 1. 기본 Restart (MovementComponent 초기화)
    Restart();

    APlayerController* PC = Cast<APlayerController>(Controller);
    if (PC && PC->IsLocallyControlled())
    {
        // 2. 카메라 타겟 업데이트
        if (PC->bAutoManageActiveCameraTarget)
        {
            PC->AutoManageActiveCameraTarget(this);
        }

        // 3. InputComponent 생성 및 등록
        if (InputComponent == nullptr)
        {
            InputComponent = CreatePlayerInputComponent();
            if (InputComponent)
            {
                SetupPlayerInputComponent(InputComponent);
                InputComponent->RegisterComponent();

                // PlayerController의 입력 스택에 추가
                PC->PushInputComponent(InputComponent);
            }
        }
    }
}
```

### Restart() - 기본 초기화

**📂 위치:** `Pawn.h:62-80` (External/Foundation)

```cpp
void APawn::Restart()
{
    // 1. 이동 중지
    UPawnMovementComponent* MovementComponent = GetMovementComponent();
    if (MovementComponent)
    {
        MovementComponent->StopMovementImmediately();
    }

    // 2. 입력 벡터 초기화
    ConsumeMovementInputVector();

    // 3. 눈높이 재계산
    RecalculateBaseEyeHeight();
}
```

**Restart 다이어그램:**
```
Possession 변경
     │
     ↓
DispatchRestart()
     │
     ├─ Restart()
     │    ├─ MovementComponent->StopMovementImmediately()
     │    ├─ ConsumeMovementInputVector()
     │    └─ RecalculateBaseEyeHeight()
     │
     └─ PawnClientRestart() (로컬 플레이어만)
          ├─ Restart() 호출
          ├─ AutoManageActiveCameraTarget() - 카메라 업데이트
          └─ SetupPlayerInputComponent() - 입력 설정
```

---

## 🎮 입력 처리

### AddMovementInput() - 입력 누적

```cpp
void APawn::AddMovementInput(FVector WorldDirection, float ScaleValue, bool bForce)
{
    if (Controller && (bForce || !Controller->IsLocalPlayerController()))
    {
        // ControlInputVector에 누적
        ControlInputVector += WorldDirection * ScaleValue;
    }
}
```

### ConsumeMovementInputVector() - 입력 소비

**📂 위치:** `Pawn.h:276-291` (External/Foundation)

```cpp
FVector APawn::ConsumeMovementInputVector()
{
    UPawnMovementComponent* MovementComponent = GetMovementComponent();
    if (MovementComponent)
    {
        // MovementComponent가 소비
        return MovementComponent->ConsumeInputVector();
    }
    else
    {
        // 직접 소비
        return Internal_ConsumeMovementInputVector();
    }
}

FVector APawn::Internal_ConsumeMovementInputVector()
{
    // 누적 벡터를 저장하고 초기화
    LastControlInputVector = ControlInputVector;
    ControlInputVector = FVector::ZeroVector;
    return LastControlInputVector;
}
```

**입력 흐름:**
```
프레임 N:
    PlayerController::Tick()
         │
         ├─ ProcessPlayerInput()
         │       │
         │       └─ Pawn->AddMovementInput(Forward, 1.0f)
         │            └─ ControlInputVector += FVector(1, 0, 0)
         │
         └─ Pawn->Tick()
                 │
                 └─ MovementComponent->TickComponent()
                          │
                          ├─ ConsumeMovementInputVector()
                          │    └─ ControlInputVector 가져오고 초기화
                          │
                          └─ CalcVelocity(InputVector)

프레임 N+1: (ControlInputVector = ZeroVector로 시작)
```

---

## 🔄 회전 제어

### FaceRotation() - Controller 회전 적용

**📂 위치:** `Pawn.h:27-59` (External/Foundation)

```cpp
void APawn::FaceRotation(FRotator NewControlRotation, float DeltaTime)
{
    // bUseControllerRotation* 설정 확인
    if (bUseControllerRotationPitch ||
        bUseControllerRotationYaw ||
        bUseControllerRotationRoll)
    {
        FRotator CurrentRotation = GetActorRotation();

        // 각 축별로 적용 여부 결정
        if (!bUseControllerRotationPitch)
        {
            NewControlRotation.Pitch = CurrentRotation.Pitch;
        }

        if (!bUseControllerRotationYaw)
        {
            NewControlRotation.Yaw = CurrentRotation.Yaw;
        }

        if (!bUseControllerRotationRoll)
        {
            NewControlRotation.Roll = CurrentRotation.Roll;
        }

        // 회전 적용
        SetActorRotation(NewControlRotation);
    }
}
```

**회전 제어 설정:**
```cpp
class AMyCharacter : public ACharacter
{
public:
    AMyCharacter()
    {
        // 1인칭 슈터: Yaw만 Pawn에 적용
        bUseControllerRotationPitch = false;
        bUseControllerRotationYaw = true;
        bUseControllerRotationRoll = false;

        // CharacterMovement는 OrientRotationToMovement 사용
        GetCharacterMovement()->bOrientRotationToMovement = false;
    }
};

class ATopDownCharacter : public ACharacter
{
public:
    ATopDownCharacter()
    {
        // 탑다운: Controller 회전 무시, 이동 방향으로 회전
        bUseControllerRotationPitch = false;
        bUseControllerRotationYaw = false;
        bUseControllerRotationRoll = false;

        GetCharacterMovement()->bOrientRotationToMovement = true;
    }
};
```

---

## 💡 실전 패턴

### 패턴 1: 커스텀 입력 설정

```cpp
void AMyPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    // 이동
    PlayerInputComponent->BindAxis("MoveForward", this, &AMyPawn::MoveForward);
    PlayerInputComponent->BindAxis("MoveRight", this, &AMyPawn::MoveRight);

    // 액션
    PlayerInputComponent->BindAction("Jump", IE_Pressed, this, &AMyPawn::StartJump);
    PlayerInputComponent->BindAction("Jump", IE_Released, this, &AMyPawn::StopJump);
}

void AMyPawn::MoveForward(float Value)
{
    if (Value != 0.0f)
    {
        // 전방 벡터 계산
        FVector Forward = GetActorForwardVector();
        AddMovementInput(Forward, Value);
    }
}
```

### 패턴 2: Possession 이벤트 처리

```cpp
void AMyPawn::PossessedBy(AController* NewController)
{
    Super::PossessedBy(NewController);

    // AI에서 플레이어로 전환
    if (APlayerController* PC = Cast<APlayerController>(NewController))
    {
        // 플레이어 전용 설정
        bUseControllerRotationYaw = true;
        EnablePlayerUI();
    }
    // 플레이어에서 AI로 전환
    else if (AAIController* AI = Cast<AAIController>(NewController))
    {
        // AI 전용 설정
        bUseControllerRotationYaw = false;
        DisablePlayerUI();
    }
}

void AMyPawn::UnPossessed()
{
    // 정리 작업
    if (InputComponent)
    {
        InputComponent->DestroyComponent();
        InputComponent = nullptr;
    }

    Super::UnPossessed();
}
```

### 패턴 3: 동적 Pawn 전환

```cpp
void AMyPlayerController::SwitchToVehicle(AVehiclePawn* Vehicle)
{
    APawn* OldPawn = GetPawn();

    // 기존 Pawn UnPossess
    if (OldPawn)
    {
        UnPossess();
    }

    // 새 Pawn Possess
    Possess(Vehicle);

    // 카메라 전환
    if (PlayerCameraManager)
    {
        PlayerCameraManager->SetViewTarget(Vehicle);
    }
}
```

### 패턴 4: 입력 버퍼링

```cpp
class AMyCharacter : public ACharacter
{
    UPROPERTY()
    TArray<FVector> InputBuffer;

    UPROPERTY()
    float BufferDuration = 0.1f;

    void Tick(float DeltaTime)
    {
        Super::Tick(DeltaTime);

        // 버퍼링된 입력 소비
        if (InputBuffer.Num() > 0)
        {
            FVector AverageInput = FVector::ZeroVector;
            for (const FVector& Input : InputBuffer)
            {
                AverageInput += Input;
            }
            AverageInput /= InputBuffer.Num();

            AddMovementInput(AverageInput);
            InputBuffer.Empty();
        }
    }

    void BufferInput(FVector Input)
    {
        InputBuffer.Add(Input);
    }
};
```

### 패턴 5: 상태 기반 이동

```cpp
void AMyCharacter::MoveForward(float Value)
{
    if (Value == 0.0f) return;

    // 상태에 따라 다른 이동
    switch (CurrentMovementState)
    {
    case EMovementState::Walking:
        AddMovementInput(GetActorForwardVector(), Value);
        break;

    case EMovementState::Sprinting:
        AddMovementInput(GetActorForwardVector(), Value * 2.0f);
        break;

    case EMovementState::Crouching:
        AddMovementInput(GetActorForwardVector(), Value * 0.5f);
        break;

    case EMovementState::Swimming:
        {
            FVector Forward = GetActorForwardVector();
            FVector Up = FVector::UpVector;
            FVector Direction = (Forward + Up * 0.3f).GetSafeNormal();
            AddMovementInput(Direction, Value);
        }
        break;
    }
}
```

---

## 🏃 Character 특화 기능

### CharacterMovementComponent

```cpp
class ACharacter : public APawn
{
    // 캐릭터 전용 이동 컴포넌트
    UPROPERTY()
    UCharacterMovementComponent* CharacterMovement;

    // 충돌 캡슐
    UPROPERTY()
    UCapsuleComponent* CapsuleComponent;

    // 스켈레탈 메시
    UPROPERTY()
    USkeletalMeshComponent* Mesh;
};
```

**이동 모드:**
```cpp
enum EMovementMode
{
    MOVE_None,          // 이동 없음
    MOVE_Walking,       // 걷기
    MOVE_NavWalking,    // NavMesh 걷기
    MOVE_Falling,       // 낙하
    MOVE_Swimming,      // 수영
    MOVE_Flying,        // 비행
    MOVE_Custom,        // 커스텀
};
```

**점프:**
```cpp
void ACharacter::Jump()
{
    bPressedJump = true;
    JumpKeyHoldTime = 0.0f;
}

bool ACharacter::CanJumpInternal_Implementation() const
{
    return !bIsCrouched &&
           CharacterMovement &&
           CharacterMovement->IsMovingOnGround() &&
           !CharacterMovement->bWantsToCrouch;
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Pawn](https://docs.unrealengine.com/en-US/InteractiveExperiences/Framework/Pawn/)
- Unreal Engine Docs: [Character](https://docs.unrealengine.com/en-US/InteractiveExperiences/Framework/Pawn/Character/)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Pawn.h` - APawn 선언
- `Engine/Source/Runtime/Engine/Private/Pawn.cpp` - 구현
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Character.h` - ACharacter
- `UnrealSummary/External/Foundation/Pawn.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/PlayerController.md` - Possession 시스템
- `UnrealSummary/GameFramework/GameMode.md` - Pawn 스폰
- `UnrealSummary/GameFramework/Component.md` - MovementComponent

---

> 🔄 Created: 2025-01-XX — Initial documentation for Pawn System (APawn, ACharacter, Possession, Input, Movement) in UE 5.7
