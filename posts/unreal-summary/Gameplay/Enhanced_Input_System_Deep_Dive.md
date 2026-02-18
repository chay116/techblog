---
title: "Enhanced Input System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Gameplay"
tags: ["unreal", "Gameplay"]
engine_version: "Unreal Engine 5.7"
---
# Enhanced Input System Deep Dive

## 🧭 개요

**Enhanced Input**은 UE5의 표준 입력 시스템으로, 유연한 키 매핑과 Modifier/Trigger를 제공합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Input Action** | 논리적 입력 (Jump, Fire, Move) |
| **Input Mapping Context** | 상황별 키 매핑 (OnFoot, InCar, InMenu) |
| **Modifiers** | 입력 변환 (Negate, Deadzone, Sensitivity) |
| **Triggers** | 입력 조건 (Pressed, Held, Double Tap) |

---

## 🏗️ Enhanced Input Pipeline

```
Raw Input (Keyboard/Gamepad/Mouse)
    ↓
Input Mapping Context (Active Context만)
    ↓
Modifiers (Deadzone, Negate, Scale)
    ↓
Triggers (Pressed? Held? Released?)
    ↓
Input Action Callback
```

---

## 🎮 설정 예시

### 1. Input Action 생성

```cpp
// IA_Jump (Digital Input)
UCLASS()
class UInputAction_Jump : public UInputAction
{
    ValueType = EInputActionValueType::Boolean;
};

// IA_Move (2D Vector Input)
UCLASS()
class UInputAction_Move : public UInputAction
{
    ValueType = EInputActionValueType::Axis2D;
};
```

### 2. Input Mapping Context

```cpp
// IMC_Default (On Foot)
UCLASS()
class UInputMappingContext_Default : public UInputMappingContext
{
    Mappings = {
        // Jump: Space or Gamepad A
        { Action: IA_Jump, Key: EKeys::SpaceBar, Triggers: [Pressed] },
        { Action: IA_Jump, Key: EKeys::Gamepad_FaceButton_Bottom, Triggers: [Pressed] },

        // Move: WASD or Left Stick
        { Action: IA_Move, Key: EKeys::W/A/S/D, Modifiers: [Swizzle(Y,X,Z)] },
        { Action: IA_Move, Key: EKeys::Gamepad_LeftStick_X/Y, Modifiers: [Deadzone(0.25)] },
    };
};
```

### 3. Blueprint/C++ Binding

```cpp
// C++ Setup
void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);

    // Bind Jump
    EIC->BindAction(IA_Jump, ETriggerEvent::Triggered, this, &AMyCharacter::Jump);

    // Bind Move
    EIC->BindAction(IA_Move, ETriggerEvent::Triggered, this, &AMyCharacter::Move);
}

void AMyCharacter::Move(const FInputActionValue& Value)
{
    FVector2D MoveVector = Value.Get<FVector2D>();
    AddMovementInput(GetActorForwardVector(), MoveVector.Y);
    AddMovementInput(GetActorRightVector(), MoveVector.X);
}
```

---

## 🔧 Modifiers

```cpp
// Negate (반전)
Modifier: Negate(X=true, Y=false, Z=false)

// Deadzone (데드존)
Modifier: Deadzone(LowerThreshold=0.25, UpperThreshold=0.95)

// Smooth (스무딩)
Modifier: Smooth(SmoothTime=0.1f)

// Sensitivity (민감도)
Modifier: ScalarAxisModifier(Scalar=2.0f)
```

---

## 🎯 Triggers

```cpp
// Pressed (눌렀을 때)
Trigger: Pressed

// Held (홀드)
Trigger: Hold(HoldTimeThreshold=0.5f)

// Double Tap
Trigger: Tap(TapReleaseTimeThreshold=0.2f, TapCount=2)

// Chorded (조합 키: Ctrl+S)
Trigger: Chorded(ChordAction=IA_Ctrl)
```

---

## 🌐 Context Switching

```cpp
// On Foot → In Car
UEnhancedInputLocalPlayerSubsystem* Subsystem = ...;

// Remove OnFoot Context
Subsystem->RemoveMappingContext(IMC_OnFoot);

// Add InCar Context
Subsystem->AddMappingContext(IMC_InCar, Priority=1);
```

---

## 📊 성능

**Input Processing:**
- Per-Frame Cost: ~0.01ms
- 100 Active Bindings: ~0.1ms

---

## 🔗 참고 자료

**소스:**
- `EnhancedInput/Public/InputAction.h`
- `EnhancedInput/Public/InputMappingContext.h`

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Enhanced Input