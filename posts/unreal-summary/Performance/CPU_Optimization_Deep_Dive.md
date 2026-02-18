---
title: "CPU Optimization Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Performance"
tags: ["unreal", "Performance"]
---
# CPU Optimization Deep Dive

## 🧭 개요

**CPU 최적화**는 Game Thread 병목을 제거하여 프레임레이트를 향상시킵니다.

---

## ⚡ Tick 최적화

### ✅ Tick Interval 사용

```cpp
// ❌ 나쁜 예: 매 프레임 Tick (60 FPS = 60회/초)
void AAIController::Tick(float DeltaTime)
{
    UpdatePerception();  // Heavy!
}

// ✅ 좋은 예: Tick Interval (1초에 2회만)
AAIController::AAIController()
{
    PrimaryActorTick.TickInterval = 0.5f;  // 0.5초마다
}
```

### Tick 비활성화

```cpp
// Tick 필요 없으면 비활성화
PrimaryActorTick.bCanEverTick = false;

// Runtime에 Toggle
SetActorTickEnabled(false);
```

---

## 🎯 Blueprint 최적화

### Nativization (C++ 변환)

```ini
[/Script/Engine.ProjectPackagingSettings]
BlueprintNativizationMethod=Inclusive

// Blueprint → C++ 변환 (10~100배 빠름)
```

### Pure Function 사용

```cpp
// ❌ 나쁜 예: Exec Pin (매번 실행)
UFUNCTION(BlueprintCallable)
float GetHealth();

// ✅ 좋은 예: Pure (Cached, 필요할 때만)
UFUNCTION(BlueprintPure)
float GetHealth() const;
```

---

## 🏗️ Actor 관리

### Object Pooling

```cpp
// ❌ Spawn/Destroy 반복 (느림)
for (int32 i = 0; i < 100; ++i)
{
    AActor* Bullet = GetWorld()->SpawnActor<ABullet>();
    // ...
    Bullet->Destroy();
}

// ✅ Object Pool
TArray<ABullet*> BulletPool;

ABullet* GetPooledBullet()
{
    if (BulletPool.Num() > 0)
    {
        return BulletPool.Pop();  // 재사용
    }
    return GetWorld()->SpawnActor<ABullet>();
}

void ReturnToPool(ABullet* Bullet)
{
    Bullet->SetActorHiddenInGame(true);
    BulletPool.Add(Bullet);
}
```

---

## 📊 성능 비교

| 최적화 | Before | After | 향상 |
|--------|--------|-------|------|
| **Tick Interval (0.5s)** | 10ms | 1ms | 10x |
| **Blueprint Nativization** | 5ms | 0.05ms | 100x |
| **Object Pooling** | 2ms | 0.1ms | 20x |

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - CPU Optimization