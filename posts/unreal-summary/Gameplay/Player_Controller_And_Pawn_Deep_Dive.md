---
title: "Player Controller & Pawn Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Gameplay"
tags: ["unreal", "Gameplay"]
---
# Player Controller & Pawn Deep Dive

## 🧭 개요

**PlayerController**는 입력을 받고, **Pawn**은 실제로 조종되는 객체입니다.

---

## 🎮 PlayerController

```cpp
UCLASS()
class AMyPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    virtual void SetupInputComponent() override
    {
        Super::SetupInputComponent();

        // Bind Input
        InputComponent->BindAction("Jump", IE_Pressed, this, &AMyPlayerController::OnJump);
        InputComponent->BindAxis("MoveForward", this, &AMyPlayerController::MoveForward);
    }

    void OnJump()
    {
        if (APawn* ControlledPawn = GetPawn())
        {
            ControlledPawn->Jump();
        }
    }

    void MoveForward(float Value)
    {
        if (APawn* ControlledPawn = GetPawn())
        {
            FVector Direction = ControlledPawn->GetActorForwardVector();
            ControlledPawn->AddMovementInput(Direction, Value);
        }
    }
};
```

---

## 🏃 Character (Pawn + Movement)

```cpp
UCLASS()
class AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    // Movement Component (자동 생성)
    UCharacterMovementComponent* GetCharacterMovement();

    virtual void Jump() override
    {
        if (CanJump())
        {
            LaunchCharacter(FVector(0, 0, 600), false, true);
        }
    }
};
```

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - PlayerController & Pawn