---
title: "Camera System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Gameplay"
tags: ["unreal", "Gameplay"]
---
# Camera System Deep Dive

## 🧭 개요

**Camera System**은 플레이어 시점을 관리합니다.

---

## 📷 Camera Component

```cpp
UCLASS()
class AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    UPROPERTY(VisibleAnywhere)
    USpringArmComponent* SpringArm;

    UPROPERTY(VisibleAnywhere)
    UCameraComponent* Camera;

    AMyCharacter()
    {
        // Spring Arm (3rd Person)
        SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
        SpringArm->SetupAttachment(RootComponent);
        SpringArm->TargetArmLength = 300.0f;  // 거리
        SpringArm->bUsePawnControlRotation = true;  // Mouse로 회전

        // Camera
        Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
        Camera->SetupAttachment(SpringArm);
    }
};
```

---

## 🎥 Camera Shake

```cpp
// Camera Shake Asset
UMatineeCameraShake* ShakeClass = ...;

// Trigger Shake
APlayerController* PC = GetWorld()->GetFirstPlayerController();
PC->ClientStartCameraShake(ShakeClass, 1.0f);  // Intensity
```

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Camera System