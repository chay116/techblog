---
title: "Gameplay Ability System (GAS) Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Gameplay"
tags: ["unreal", "Gameplay"]
engine_version: "Unreal Engine 5.7"
---
# Gameplay Ability System (GAS) Deep Dive

## 🧭 개요

**Gameplay Ability System (GAS)** 는 능력 기반 게임플레이 프레임워크로, RPG/MOBA/Action 게임에 최적화되어 있습니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Ability System Component (ASC)** | Actor의 GAS 관리자 |
| **Gameplay Ability** | 스킬/능력 (Fireball, Dash, Heal 등) |
| **Gameplay Attribute** | 수치 (Health, Mana, Damage) |
| **Gameplay Effect** | Attribute 변경 (Instant/Duration/Infinite) |
| **Gameplay Tag** | 계층적 태그 (Ability.Magic.Fire) |
| **Prediction** | Client-side Prediction (Multiplayer) |

---

## 🏗️ GAS Architecture

```
┌─────────────────────────────────────────────────────────┐
│              UAbilitySystemComponent (ASC)              │
├─────────────────────────────────────────────────────────┤
│  - Granted Abilities (Fireball, Dash, etc.)            │
│  - Active Gameplay Effects (Burn DoT, Speed Buff)      │
│  - Attribute Set (Health=100, Mana=50)                 │
│  - Gameplay Tags (Status.Stunned, Ability.OnCooldown)  │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│                 Ability Activation                      │
├─────────────────────────────────────────────────────────┤
│  1. TryActivateAbility()                               │
│  2. CanActivateAbility() (Check Tags, Cost, Cooldown)  │
│  3. ActivateAbility() (Spawn Projectile, etc.)         │
│  4. ApplyGameplayEffectToSelf() (Cooldown, Cost)       │
│  5. EndAbility()                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 핵심 구성 요소

### 1. Gameplay Ability

```cpp
// Fireball Ability
UCLASS()
class UGA_Fireball : public UGameplayAbility
{
    GENERATED_BODY()

    virtual void ActivateAbility(...) override
    {
        // Cost (Mana -10)
        ApplyGameplayEffectToOwner(ManaCostEffect);

        // Spawn Fireball
        AFireballProjectile* Fireball = SpawnProjectile();

        // Cooldown (3초)
        ApplyGameplayEffectToOwner(CooldownEffect);

        EndAbility();
    }

    virtual bool CanActivateAbility(...) override
    {
        // Check Mana
        if (GetMana() < 10) return false;

        // Check Cooldown Tag
        if (HasMatchingGameplayTag("Ability.Fireball.Cooldown"))
            return false;

        return true;
    }
};
```

### 2. Gameplay Effect

```cpp
// Burn DoT (Duration Effect)
UCLASS()
class UGE_Burn : public UGameplayEffect
{
    GENERATED_BODY()

    // -5 HP per second, 10초간
    DurationPolicy = EGameplayEffectDurationType::HasDuration;
    Duration = 10.0f;
    Period = 1.0f;  // Every 1 second

    Modifiers = {
        { Attribute: Health, Magnitude: -5.0f }
    };

    GameplayTags.Added = { "Status.Burning" };
};
```

### 3. Attribute Set

```cpp
UCLASS()
class UMyAttributeSet : public UAttributeSet
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, ReplicatedUsing=OnRep_Health)
    FGameplayAttributeData Health;

    UPROPERTY(BlueprintReadOnly, ReplicatedUsing=OnRep_Mana)
    FGameplayAttributeData Mana;

    // Clamping (0 ~ MaxHealth)
    virtual void PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data) override
    {
        if (Data.EvaluatedData.Attribute == GetHealthAttribute())
        {
            SetHealth(FMath::Clamp(GetHealth(), 0.0f, GetMaxHealth()));
        }
    }
};
```

---

## 🎮 실전 예시

### 예시: Dash Ability

```cpp
// Grant Ability
ASC->GiveAbility(FGameplayAbilitySpec(UGA_Dash::StaticClass(), 1, 0));

// Activate
ASC->TryActivateAbilityByClass(UGA_Dash::StaticClass());

// UGA_Dash Implementation:
void UGA_Dash::ActivateAbility()
{
    // Apply Velocity Boost
    GetCharacter()->LaunchCharacter(ForwardVector * 2000.0f);

    // Apply Cooldown (5초)
    ApplyGameplayEffectToOwner(CooldownEffect);

    // Add Tag (Immune During Dash)
    ASC->AddLooseGameplayTag("Status.DashImmune");

    // Wait 0.5s
    FTimerHandle Timer;
    GetWorld()->GetTimerManager().SetTimer(Timer, [this]() {
        ASC->RemoveLooseGameplayTag("Status.DashImmune");
        EndAbility();
    }, 0.5f, false);
}
```

---

## 🌐 Multiplayer Prediction

```cpp
// Client Prediction
bool bPrediction = true;
ASC->TryActivateAbility(AbilitySpec, bPrediction);

// Server Correction (Misprediction 시)
// - Client: "I dashed!"
// - Server: "Not enough mana, roll back"
// → Client UI flickers (corrected)
```

---

## 📊 성능

**GAS Overhead:**
- Attribute Change: ~0.01ms
- Ability Activation: ~0.05ms
- Effect Application: ~0.02ms

**복잡한 Character (10 Active Effects):**
- Frame Cost: ~0.2ms

---

## 🔗 참고 자료

**소스:**
- `GameplayAbilities/Public/AbilitySystemComponent.h`
- `GameplayAbilities/Public/GameplayAbility.h`
- `GameplayAbilities/Public/GameplayEffect.h`

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - GAS
  - ASC, Ability, Effect, Attribute
  - Gameplay Tags
  - Client Prediction