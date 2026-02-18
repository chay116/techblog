---
title: "델리게이트 시스템 (Delegate System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# 델리게이트 시스템 (Delegate System)

## 🧭 개요

**언리얼 엔진의 델리게이트 시스템**은 타입 안전한 함수 포인터 추상화로, 임의의 객체의 멤버 함수를 동적으로 바인딩하고 호출할 수 있게 해줍니다. C++의 이벤트 시스템 부재를 메우며, 블루프린트와의 통합, 직렬화, 멀티캐스트 등 강력한 기능을 제공합니다.

**핵심 구성 요소:**
- **TDelegate** - 단일 바인딩 델리게이트 (1개 함수)
- **TMulticastDelegate** - 멀티캐스트 델리게이트 (N개 함수)
- **TBaseDynamicDelegate** - 동적 델리게이트 (블루프린트 연동)
- **Payload Data** - 바인딩 시점에 파라미터 저장
- **Weak Binding** - UObject, SharedPtr 약한 참조

**델리게이트 종류:**
1. **Single-cast Delegate** - 1개 함수만 바인딩 (반환값 가능)
2. **Multi-cast Delegate** - 여러 함수 바인딩 (반환값 없음)
3. **Dynamic Delegate** - 블루프린트 연동, 직렬화 가능 (UFUNCTION 필요)
4. **Event** - Multicast Delegate + 접근 제어 (friend class)

**바인딩 타입:**
- **BindStatic** - 전역/정적 함수
- **BindUObject** - UObject 멤버 (TWeakObjectPtr)
- **BindSP** - SharedPtr 멤버 (TWeakPtr)
- **BindRaw** - Raw 포인터 멤버 (수동 관리 필요)
- **BindLambda** - 람다 함수
- **BindWeakLambda** - UObject 약한 참조 람다
- **BindSPLambda** - SharedPtr 약한 참조 람다

**성능 특성:**
- **바인딩 비용:** ~50-100ns (힙 할당 포함)
- **호출 비용:** ~10-20ns (단일), ~N×20ns (멀티캐스트)
- **메모리:** 32-64 bytes (바인딩당)

**모듈 위치:**
- `Engine/Source/Runtime/Core/Public/Delegates/Delegate.h`
- `Engine/Source/Runtime/Core/Public/Delegates/DelegateCombinations.h`
- `Engine/Source/Runtime/Core/Public/Delegates/MulticastDelegateBase.h`

**엔진 버전:** Unreal Engine 5.7 (2025년 기준)

---

## 🧱 구조

### 델리게이트 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Delegate System Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [델리게이트 타입 계층]                                                   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  TDelegate<RetVal(Params...)>                                    │  │
│  │  (단일 바인딩 델리게이트)                                          │  │
│  │  ───────────────────────────────────────────────────────────     │  │
│  │  • 1개 함수만 바인딩                                              │  │
│  │  • 반환값 지원                                                    │  │
│  │  • Execute() / ExecuteIfBound()                                  │  │
│  │  • IsBound() - 바인딩 여부 확인                                   │  │
│  │                                                                  │  │
│  │  내부 구조:                                                       │  │
│  │  ┌────────────────────────────────────────────┐                 │  │
│  │  │ IBaseDelegateInstance* DelegateInstance   │                 │  │
│  │  │   ↓                                        │                 │  │
│  │  │ TBaseSPMethodDelegateInstance<>           │                 │  │
│  │  │ TBaseUObjectMethodDelegateInstance<>      │                 │  │
│  │  │ TBaseStaticDelegateInstance<>             │                 │  │
│  │  │ TBaseFunctorDelegateInstance<>  (람다)    │                 │  │
│  │  └────────────────────────────────────────────┘                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                             ↑                                           │
│                             │ 상속                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  TMulticastDelegate<void(Params...)>                             │  │
│  │  (멀티캐스트 델리게이트)                                           │  │
│  │  ───────────────────────────────────────────────────────────     │  │
│  │  • 여러 함수 바인딩                                               │  │
│  │  • 반환값 없음 (void만)                                           │  │
│  │  • Broadcast() - 모든 함수 호출                                   │  │
│  │  • Add() / Remove() - 핸들 기반                                   │  │
│  │                                                                  │  │
│  │  내부 구조:                                                       │  │
│  │  ┌────────────────────────────────────────────┐                 │  │
│  │  │ TArray<FDelegate> InvocationList          │                 │  │
│  │  │   ├─ Delegate 1 (Handle: 0x1234)          │                 │  │
│  │  │   ├─ Delegate 2 (Handle: 0x5678)          │                 │  │
│  │  │   └─ Delegate N ...                       │                 │  │
│  │  └────────────────────────────────────────────┘                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                             ↑                                           │
│                             │ 특수화                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  TBaseDynamicDelegate<void(Params...)>                           │  │
│  │  (동적 델리게이트 - 블루프린트 연동)                                │  │
│  │  ───────────────────────────────────────────────────────────     │  │
│  │  • UFUNCTION만 바인딩 가능                                        │  │
│  │  • 직렬화 가능 (FName으로 저장)                                   │  │
│  │  • 블루프린트에서 호출/바인딩 가능                                 │  │
│  │  • BindDynamic() / BindUFunction()                               │  │
│  │                                                                  │  │
│  │  내부 구조:                                                       │  │
│  │  ┌────────────────────────────────────────────┐                 │  │
│  │  │ TScriptDelegate<>                          │                 │  │
│  │  │   • UObject* Object                        │                 │  │
│  │  │   • FName FunctionName                     │                 │  │
│  │  └────────────────────────────────────────────┘                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 델리게이트 선언 매크로

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Delegate Declaration Macros                            │
│  📂 위치: Core/Public/Delegates/DelegateCombinations.h                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1. Single-cast Delegates]                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  DECLARE_DELEGATE(DelegateName)                                  │  │
│  │  DECLARE_DELEGATE_OneParam(DelegateName, Param1Type)             │  │
│  │  DECLARE_DELEGATE_TwoParams(DelegateName, Param1Type, Param2Type)│  │
│  │  DECLARE_DELEGATE_RetVal(RetValType, DelegateName)               │  │
│  │  DECLARE_DELEGATE_RetVal_OneParam(RetValType, DelegateName, ...)│  │
│  │                                                                  │  │
│  │  예시:                                                            │  │
│  │  DECLARE_DELEGATE_OneParam(FOnHealthChanged, float);            │  │
│  │  // typedef TDelegate<void(float)> FOnHealthChanged;            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [2. Multi-cast Delegates]                                              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  DECLARE_MULTICAST_DELEGATE(DelegateName)                        │  │
│  │  DECLARE_MULTICAST_DELEGATE_OneParam(DelegateName, Param1Type)  │  │
│  │  DECLARE_MULTICAST_DELEGATE_TwoParams(...)                       │  │
│  │                                                                  │  │
│  │  예시:                                                            │  │
│  │  DECLARE_MULTICAST_DELEGATE_OneParam(FOnDamageReceived, float); │  │
│  │  // typedef TMulticastDelegate<void(float)> FOnDamageReceived;  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [3. Dynamic Delegates (블루프린트)]                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  DECLARE_DYNAMIC_DELEGATE(DelegateName)                          │  │
│  │  DECLARE_DYNAMIC_DELEGATE_OneParam(DelegateName, Param1Type,    │  │
│  │                                     Param1Name)                  │  │
│  │  DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(...)                │  │
│  │                                                                  │  │
│  │  예시:                                                            │  │
│  │  DECLARE_DYNAMIC_DELEGATE_OneParam(FOnScoreChanged, int32, NewScore);│ │
│  │  DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnGameOver);                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [4. Events (접근 제어)]                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  DECLARE_EVENT(OwningType, EventName)                            │  │
│  │  DECLARE_EVENT_OneParam(OwningType, EventName, Param1Type)       │  │
│  │                                                                  │  │
│  │  예시:                                                            │  │
│  │  DECLARE_EVENT_OneParam(AMyActor, FOnActorSpawned, AActor*);    │  │
│  │  // friend class AMyActor로 Broadcast 보호                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [5. Thread-safe Multi-cast]                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  DECLARE_TS_MULTICAST_DELEGATE(DelegateName)                     │  │
│  │  DECLARE_TS_MULTICAST_DELEGATE_OneParam(...)                     │  │
│  │                                                                  │  │
│  │  • 스레드 안전 (FCriticalSection 사용)                            │  │
│  │  • 여러 스레드에서 Add/Remove/Broadcast 가능                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 설계 철학: 왜 델리게이트인가?

### C++ 함수 포인터 vs 언리얼 델리게이트

```cpp
// ❌ C++ 함수 포인터 - 제한적

class FLogWriter
{
public:
    void WriteLog(const FString& Message);
};

// 함수 포인터 타입 정의
typedef void (*FLogFunction)(const FString&);

FLogWriter LogWriter;
FLogFunction LogFunc = &FLogWriter::WriteLog;  // ❌ 컴파일 에러!
// 멤버 함수는 객체 인스턴스 필요

// 멤버 함수 포인터 (복잡하고 타입 의존적)
typedef void (FLogWriter::*FLogMemberFunc)(const FString&);
FLogMemberFunc MemberFunc = &FLogWriter::WriteLog;
(LogWriter.*MemberFunc)(TEXT("Message"));  // ❌ 호출 문법 복잡

// 문제점:
// 1. 멤버 함수 포인터는 클래스 타입 의존적
// 2. 다양한 클래스의 함수 통합 불가
// 3. 약한 참조 불가능 (객체 소멸 감지 불가)
// 4. 블루프린트 연동 불가
// 5. 직렬화 불가
```

```cpp
// ✅ 언리얼 델리게이트 - 강력하고 유연

// [1] 델리게이트 선언 (타입 안전)
DECLARE_DELEGATE_OneParam(FLogDelegate, const FString&);

class FLogWriter
{
public:
    void WriteLog(const FString& Message)
    {
        UE_LOG(LogTemp, Log, TEXT("%s"), *Message);
    }
};

class FFileLogger
{
public:
    void WriteToFile(const FString& Message)
    {
        // 파일에 저장
    }
};

// [2] 바인딩 (타입 무관)
FLogWriter LogWriter;
FFileLogger FileLogger;

FLogDelegate LogDelegate;

// 다양한 클래스의 함수 바인딩 가능!
LogDelegate.BindRaw(&LogWriter, &FLogWriter::WriteLog);
// 또는
LogDelegate.BindRaw(&FileLogger, &FFileLogger::WriteToFile);

// [3] 호출 (단일 인터페이스)
LogDelegate.Execute(TEXT("Hello Delegate!"));

// ✅ 장점:
// - 타입 안전 (컴파일 타임 체크)
// - 다양한 클래스 통합
// - 약한 참조 지원 (BindUObject, BindSP)
// - 블루프린트 연동 (Dynamic Delegate)
// - 직렬화 가능
// - Payload 데이터 저장
```

### 델리게이트 비교 테이블

| 특징 | C++ 함수 포인터 | std::function | 언리얼 Delegate |
|------|----------------|---------------|-----------------|
| **타입 안전성** | ⚠️ 제한적 (캐스팅 필요) | ✅ 완전 | ✅ 완전 |
| **멤버 함수** | ⚠️ 복잡 (클래스별 타입) | ✅ 지원 | ✅ 지원 |
| **약한 참조** | ❌ 없음 | ❌ 없음 | ✅ UObject, SharedPtr |
| **블루프린트** | ❌ 불가능 | ❌ 불가능 | ✅ Dynamic Delegate |
| **직렬화** | ❌ 불가능 | ❌ 불가능 | ✅ Dynamic Delegate |
| **멀티캐스트** | ❌ 없음 | ❌ 없음 | ✅ TMulticastDelegate |
| **Payload** | ❌ 없음 | ⚠️ 수동 (bind) | ✅ 자동 |
| **스레드 안전** | ❌ 없음 | ❌ 없음 | ✅ TS_MULTICAST |

---

## 🧩 주요 API

### 1. Single-cast Delegate

```cpp
#include "Delegates/Delegate.h"

// [1-1] 델리게이트 선언
DECLARE_DELEGATE_OneParam(FOnHealthChanged, float);
DECLARE_DELEGATE_RetVal_TwoParams(bool, FOnDamageFilter, float, AActor*);

class UHealthComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    // 델리게이트 멤버
    FOnHealthChanged OnHealthChanged;

    void SetHealth(float NewHealth)
    {
        Health = NewHealth;

        // 바인딩 여부 확인 후 실행
        if (OnHealthChanged.IsBound())
        {
            OnHealthChanged.Execute(Health);
        }

        // 또는 간편하게
        OnHealthChanged.ExecuteIfBound(Health);
    }

private:
    float Health = 100.0f;
};

// [1-2] 바인딩 (다양한 방식)

class AMyActor : public AActor
{
public:
    void OnHealthUpdated(float NewHealth)
    {
        UE_LOG(LogTemp, Log, TEXT("Health: %.1f"), NewHealth);
    }

    void Setup()
    {
        UHealthComponent* HealthComp = FindComponentByClass<UHealthComponent>();

        // Raw 포인터 바인딩
        HealthComp->OnHealthChanged.BindRaw(this, &AMyActor::OnHealthUpdated);

        // UObject 바인딩 (약한 참조)
        HealthComp->OnHealthChanged.BindUObject(this, &AMyActor::OnHealthUpdated);

        // 람다 바인딩
        HealthComp->OnHealthChanged.BindLambda([](float NewHealth)
        {
            UE_LOG(LogTemp, Log, TEXT("Lambda: %.1f"), NewHealth);
        });

        // Payload 데이터와 함께 바인딩
        FString ActorName = GetName();
        HealthComp->OnHealthChanged.BindLambda([ActorName](float NewHealth)
        {
            UE_LOG(LogTemp, Log, TEXT("%s Health: %.1f"), *ActorName, NewHealth);
        });
    }
};

// [1-3] 반환값 델리게이트
void UseDamageFilter()
{
    FOnDamageFilter DamageFilter;

    DamageFilter.BindLambda([](float Damage, AActor* Instigator) -> bool
    {
        // 특정 조건에서만 데미지 허용
        return Damage > 10.0f && Instigator != nullptr;
    });

    // 실행 및 반환값 확인
    bool bShouldApplyDamage = DamageFilter.Execute(50.0f, SomeActor);
    if (bShouldApplyDamage)
    {
        ApplyDamage(50.0f);
    }
}

// [1-4] 바인딩 해제
void Unbind()
{
    HealthComp->OnHealthChanged.Unbind();

    // 바인딩 여부 확인
    if (!HealthComp->OnHealthChanged.IsBound())
    {
        UE_LOG(LogTemp, Log, TEXT("Delegate unbound"));
    }
}
```

### 2. Multi-cast Delegate

```cpp
// [2-1] 멀티캐스트 델리게이트 선언
DECLARE_MULTICAST_DELEGATE_OneParam(FOnScoreChanged, int32);

class UScoreManager : public UObject
{
    GENERATED_BODY()

public:
    // 멀티캐스트 델리게이트
    FOnScoreChanged OnScoreChanged;

    void AddScore(int32 Points)
    {
        Score += Points;

        // 모든 바인딩된 함수 호출
        OnScoreChanged.Broadcast(Score);
    }

private:
    int32 Score = 0;
};

// [2-2] 여러 리스너 바인딩

class AScoreUI : public AActor
{
public:
    void OnScoreUpdated(int32 NewScore)
    {
        UE_LOG(LogTemp, Log, TEXT("UI Score: %d"), NewScore);
    }

    void Setup(UScoreManager* ScoreManager)
    {
        // Add로 바인딩 (핸들 반환)
        FDelegateHandle Handle = ScoreManager->OnScoreChanged.AddUObject(
            this,
            &AScoreUI::OnScoreUpdated
        );

        // 핸들 저장
        ScoreChangedHandle = Handle;
    }

    void Cleanup(UScoreManager* ScoreManager)
    {
        // 핸들로 제거
        ScoreManager->OnScoreChanged.Remove(ScoreChangedHandle);
    }

private:
    FDelegateHandle ScoreChangedHandle;
};

class AAchievementSystem : public AActor
{
public:
    void OnScoreUpdated(int32 NewScore)
    {
        UE_LOG(LogTemp, Log, TEXT("Achievement Score: %d"), NewScore);

        if (NewScore >= 1000)
        {
            UnlockAchievement(TEXT("Score1000"));
        }
    }

    void Setup(UScoreManager* ScoreManager)
    {
        ScoreManager->OnScoreChanged.AddUObject(this, &AAchievementSystem::OnScoreUpdated);
    }
};

// [2-3] 람다 바인딩
void SetupScoreBroadcast(UScoreManager* ScoreManager)
{
    // 람다 추가
    ScoreManager->OnScoreChanged.AddLambda([](int32 NewScore)
    {
        UE_LOG(LogTemp, Log, TEXT("Lambda Score: %d"), NewScore);
    });

    // WeakLambda (UObject 약한 참조)
    ScoreManager->OnScoreChanged.AddWeakLambda(this, [this](int32 NewScore)
    {
        // this가 유효할 때만 실행
        UpdateScoreDisplay(NewScore);
    });

    // SPLambda (SharedPtr 약한 참조)
    TSharedPtr<FScoreData> ScoreData = MakeShared<FScoreData>();
    ScoreManager->OnScoreChanged.AddSPLambda(ScoreData, [ScoreData](int32 NewScore)
    {
        // ScoreData가 유효할 때만 실행
        ScoreData->UpdateScore(NewScore);
    });
}

// [2-4] 모든 리스너 제거
void ClearAllListeners(UScoreManager* ScoreManager)
{
    ScoreManager->OnScoreChanged.Clear();
}

// [2-5] 특정 객체의 모든 바인딩 제거
void RemoveAllForObject(UScoreManager* ScoreManager, UObject* Object)
{
    ScoreManager->OnScoreChanged.RemoveAll(Object);
}
```

### 3. Dynamic Delegate (블루프린트)

```cpp
// [3-1] 동적 델리게이트 선언 (.h 파일)
UCLASS()
class UMyGameInstance : public UGameInstance
{
    GENERATED_BODY()

public:
    // 동적 델리게이트 (블루프린트 노출)
    DECLARE_DYNAMIC_DELEGATE_OneParam(FOnLevelLoaded, FName, LevelName);
    UPROPERTY(BlueprintAssignable, Category="Events")
    FOnLevelLoaded OnLevelLoaded;

    // 동적 멀티캐스트 델리게이트
    DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnPlayerJoined,
        FString, PlayerName, int32, PlayerID);
    UPROPERTY(BlueprintAssignable, Category="Events")
    FOnPlayerJoined OnPlayerJoined;

    UFUNCTION(BlueprintCallable, Category="Game")
    void TriggerLevelLoaded(FName LevelName)
    {
        // 실행
        OnLevelLoaded.ExecuteIfBound(LevelName);
    }

    UFUNCTION(BlueprintCallable, Category="Game")
    void BroadcastPlayerJoined(const FString& PlayerName, int32 PlayerID)
    {
        // 브로드캐스트
        OnPlayerJoined.Broadcast(PlayerName, PlayerID);
    }
};

// [3-2] C++에서 동적 델리게이트 바인딩

UCLASS()
class AMyPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    // UFUNCTION 필수!
    UFUNCTION()
    void OnLevelLoadedHandler(FName LevelName)
    {
        UE_LOG(LogTemp, Log, TEXT("Level loaded: %s"), *LevelName.ToString());
    }

    UFUNCTION()
    void OnPlayerJoinedHandler(const FString& PlayerName, int32 PlayerID)
    {
        UE_LOG(LogTemp, Log, TEXT("Player joined: %s (%d)"), *PlayerName, PlayerID);
    }

    void Setup()
    {
        UMyGameInstance* GI = Cast<UMyGameInstance>(GetGameInstance());

        // BindDynamic 사용 (편의 매크로)
        GI->OnLevelLoaded.BindDynamic(this, &AMyPlayerController::OnLevelLoadedHandler);

        // AddDynamic 사용 (멀티캐스트)
        GI->OnPlayerJoined.AddDynamic(this, &AMyPlayerController::OnPlayerJoinedHandler);
    }
};

// [3-3] 블루프린트에서 바인딩
// 블루프린트에서:
// - Event Dispatcher로 표시됨
// - "Bind Event to OnPlayerJoined" 노드로 바인딩
// - 커스텀 이벤트 생성 후 연결
```

### 4. Event (접근 제어)

```cpp
// [4-1] 이벤트 선언 (Broadcast 보호)
class AMyActor : public AActor
{
    GENERATED_BODY()

public:
    // Event 선언 (friend class로 Broadcast 제한)
    DECLARE_EVENT_OneParam(AMyActor, FOnActorSpawned, AActor*);
    FOnActorSpawned& OnActorSpawnedEvent() { return OnActorSpawnedInternal; }

    void SpawnChildActor()
    {
        AActor* NewActor = GetWorld()->SpawnActor<AActor>();

        // AMyActor만 Broadcast 가능
        OnActorSpawnedInternal.Broadcast(NewActor);
    }

private:
    FOnActorSpawned OnActorSpawnedInternal;
};

// [4-2] 외부에서 바인딩만 가능
void UseEvent(AMyActor* Actor)
{
    // ✅ 바인딩 가능
    Actor->OnActorSpawnedEvent().AddLambda([](AActor* SpawnedActor)
    {
        UE_LOG(LogTemp, Log, TEXT("Actor spawned: %s"), *SpawnedActor->GetName());
    });

    // ❌ 컴파일 에러: Broadcast는 AMyActor만 가능
    // Actor->OnActorSpawnedEvent().Broadcast(nullptr);
}
```

### 5. Payload Data

```cpp
// [5-1] Payload 데이터 바인딩
DECLARE_DELEGATE_OneParam(FOnTimerTick, float);

void SetupTimerWithPayload()
{
    FOnTimerTick TimerDelegate;

    // Payload 데이터와 함께 바인딩
    FString TimerName = TEXT("MyTimer");
    int32 TickCount = 0;

    TimerDelegate.BindLambda([TimerName, TickCount](float DeltaTime) mutable
    {
        TickCount++;
        UE_LOG(LogTemp, Log, TEXT("%s Tick %d: %.2f"), *TimerName, TickCount, DeltaTime);
    });

    // 호출 시 DeltaTime만 전달, Payload는 저장됨
    TimerDelegate.Execute(0.016f);  // "MyTimer Tick 1: 0.02"
    TimerDelegate.Execute(0.033f);  // "MyTimer Tick 2: 0.03"
}

// [5-2] Static 함수 + Payload
void MyStaticFunction(int32 ID, float Value)
{
    UE_LOG(LogTemp, Log, TEXT("ID %d: %.2f"), ID, Value);
}

void BindStaticWithPayload()
{
    FOnTimerTick TimerDelegate;

    // Static 함수 + Payload (ID = 42)
    TimerDelegate.BindStatic(&MyStaticFunction, 42);

    TimerDelegate.Execute(3.14f);  // "ID 42: 3.14"
}
```

### 6. Thread-safe Multicast

```cpp
// [6-1] 스레드 안전 멀티캐스트
DECLARE_TS_MULTICAST_DELEGATE_OneParam(FOnAsyncTaskComplete, int32);

class UAsyncTaskManager : public UObject
{
    GENERATED_BODY()

public:
    // 스레드 안전 델리게이트
    FOnAsyncTaskComplete OnTaskComplete;

    void RunAsyncTask()
    {
        // 워커 스레드에서 실행
        Async(EAsyncExecution::ThreadPool, [this]()
        {
            // 무거운 작업
            int32 Result = ComputeExpensiveValue();

            // 스레드 안전하게 Broadcast
            OnTaskComplete.Broadcast(Result);
        });
    }

    void Setup()
    {
        // 게임 스레드에서 바인딩
        OnTaskComplete.AddLambda([](int32 Result)
        {
            UE_LOG(LogTemp, Log, TEXT("Task result: %d"), Result);
        });
    }
};
```

---

## 💡 델리게이트 패턴

### 1. Observer 패턴

```cpp
// Subject (관찰 대상)
class UHealthComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    DECLARE_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, float /*OldHealth*/, float /*NewHealth*/);
    FOnHealthChanged OnHealthChanged;

    void TakeDamage(float Damage)
    {
        float OldHealth = Health;
        Health = FMath::Max(0.0f, Health - Damage);

        // 모든 Observer에게 알림
        OnHealthChanged.Broadcast(OldHealth, Health);
    }

private:
    float Health = 100.0f;
};

// Observer (관찰자)
class UHealthBarWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    void OnHealthUpdated(float OldHealth, float NewHealth)
    {
        UpdateHealthBar(NewHealth);
    }

    void BindToHealthComponent(UHealthComponent* HealthComp)
    {
        HealthComp->OnHealthChanged.AddUObject(this, &UHealthBarWidget::OnHealthUpdated);
    }
};

class UAchievementSystem : public UObject
{
    GENERATED_BODY()

public:
    void OnHealthUpdated(float OldHealth, float NewHealth)
    {
        if (NewHealth <= 0.0f)
        {
            UnlockAchievement(TEXT("FirstDeath"));
        }
    }

    void BindToHealthComponent(UHealthComponent* HealthComp)
    {
        HealthComp->OnHealthChanged.AddUObject(this, &UAchievementSystem::OnHealthUpdated);
    }
};
```

### 2. Callback 패턴

```cpp
// 비동기 작업 + 콜백
DECLARE_DELEGATE_OneParam(FOnDownloadComplete, const TArray<uint8>&);

class UDownloadManager : public UObject
{
    GENERATED_BODY()

public:
    void DownloadFile(const FString& URL, FOnDownloadComplete OnComplete)
    {
        // 비동기 다운로드
        Async(EAsyncExecution::ThreadPool, [URL, OnComplete]()
        {
            TArray<uint8> Data = PerformDownload(URL);

            // 게임 스레드로 콜백
            AsyncTask(ENamedThreads::GameThread, [OnComplete, Data]()
            {
                OnComplete.ExecuteIfBound(Data);
            });
        });
    }
};

// 사용
void UseDownloadManager()
{
    UDownloadManager* Manager = NewObject<UDownloadManager>();

    Manager->DownloadFile(TEXT("https://example.com/file.dat"),
        FOnDownloadComplete::CreateLambda([](const TArray<uint8>& Data)
        {
            UE_LOG(LogTemp, Log, TEXT("Downloaded %d bytes"), Data.Num());
        })
    );
}
```

### 3. Command 패턴

```cpp
// 명령 델리게이트
DECLARE_DELEGATE(FCommand);

class UCommandQueue : public UObject
{
    GENERATED_BODY()

public:
    void AddCommand(FCommand Command)
    {
        Commands.Add(Command);
    }

    void ExecuteAll()
    {
        for (const FCommand& Command : Commands)
        {
            Command.ExecuteIfBound();
        }
        Commands.Empty();
    }

private:
    TArray<FCommand> Commands;
};

// 사용
void UseCommandQueue()
{
    UCommandQueue* Queue = NewObject<UCommandQueue>();

    // 명령 추가
    Queue->AddCommand(FCommand::CreateLambda([]()
    {
        UE_LOG(LogTemp, Log, TEXT("Command 1"));
    }));

    Queue->AddCommand(FCommand::CreateLambda([]()
    {
        UE_LOG(LogTemp, Log, TEXT("Command 2"));
    }));

    // 일괄 실행
    Queue->ExecuteAll();
}
```

---

## 🚨 일반적인 함정

### ❌ Raw 바인딩 후 객체 소멸

```cpp
// ❌ 위험: Raw 바인딩 + 객체 소멸
void DangerousBinding()
{
    FOnScoreChanged OnScoreChanged;

    {
        AScoreUI* UI = NewObject<AScoreUI>();
        OnScoreChanged.AddRaw(UI, &AScoreUI::OnScoreUpdated);

    }  // UI 소멸

    OnScoreChanged.Broadcast(100);  // ❌ 크래시! (댕글링 포인터)
}

// ✅ 안전: UObject 약한 참조
void SafeBinding()
{
    FOnScoreChanged OnScoreChanged;

    {
        AScoreUI* UI = NewObject<AScoreUI>();
        OnScoreChanged.AddUObject(UI, &AScoreUI::OnScoreUpdated);

    }  // UI 소멸

    OnScoreChanged.Broadcast(100);  // ✅ 안전 (자동으로 제거됨)
}
```

### ❌ 람다 캡처 주의

```cpp
// ❌ 위험: This 캡처 후 객체 소멸
void DangerousLambda()
{
    FOnScoreChanged OnScoreChanged;

    {
        AMyActor* Actor = GetWorld()->SpawnActor<AMyActor>();

        OnScoreChanged.AddLambda([Actor](int32 Score)  // ❌ 위험!
        {
            Actor->UpdateScore(Score);  // Actor 소멸 시 크래시
        });

        Actor->Destroy();
    }

    OnScoreChanged.Broadcast(100);  // ❌ 크래시!
}

// ✅ 안전: WeakLambda 사용
void SafeLambda()
{
    FOnScoreChanged OnScoreChanged;

    {
        AMyActor* Actor = GetWorld()->SpawnActor<AMyActor>();

        OnScoreChanged.AddWeakLambda(Actor, [Actor](int32 Score)
        {
            Actor->UpdateScore(Score);  // Actor 유효할 때만 실행
        });

        Actor->Destroy();
    }

    OnScoreChanged.Broadcast(100);  // ✅ 안전 (자동 무시)
}
```

### ❌ Broadcast 중 Add/Remove

```cpp
// ❌ 위험: Broadcast 중 리스트 수정
void DangerousModification()
{
    FOnScoreChanged OnScoreChanged;

    OnScoreChanged.AddLambda([&OnScoreChanged](int32 Score)
    {
        // ❌ Broadcast 중 Add
        OnScoreChanged.AddLambda([](int32) { /* ... */ });  // 위험!
    });

    OnScoreChanged.Broadcast(100);  // 미정의 동작
}

// ✅ 안전: Broadcast 후 수정
void SafeModification()
{
    FOnScoreChanged OnScoreChanged;
    TArray<FDelegateHandle> ToAdd;

    OnScoreChanged.AddLambda([&ToAdd](int32 Score)
    {
        // 나중에 추가할 핸들 저장
        FCommand NewCommand = FCommand::CreateLambda([](){ /* ... */ });
        // ToAdd에 저장
    });

    OnScoreChanged.Broadcast(100);

    // Broadcast 후 추가
    for (const auto& Handle : ToAdd)
    {
        // OnScoreChanged.Add(...)
    }
}
```

---

## 🔍 디버깅 팁

### 바인딩 추적

```cpp
// 바인딩 여부 확인
if (MyDelegate.IsBound())
{
    UE_LOG(LogTemp, Log, TEXT("Delegate is bound"));
}

// 멀티캐스트: 리스너 개수 확인
int32 NumBindings = MyMulticastDelegate.GetInvocationList().Num();
UE_LOG(LogTemp, Log, TEXT("Multicast has %d listeners"), NumBindings);
```

### 콘솔 명령어

```bash
# 델리게이트 통계
Obj List Class=Delegate

# 델리게이트 누수 추적
-LogDelegateMemory
```

---

## 🔗 참고자료

- [Delegates in Unreal Engine](https://docs.unrealengine.com/delegates-in-unreal-engine/)
- [Dynamic Delegates](https://docs.unrealengine.com/dynamic-delegates-in-unreal-engine/)
- [Delegate.h Source](Engine/Source/Runtime/Core/Public/Delegates/Delegate.h)
- [DelegateCombinations.h Source](Engine/Source/Runtime/Core/Public/Delegates/DelegateCombinations.h)

**연관 문서:**
- [Core/Multithreading.md](./Multithreading.md) - 스레드 안전 델리게이트
- [CoreUObject/ReflectionSystem.md](../CoreUObject/ReflectionSystem.md) - Dynamic Delegate 리플렉션

---

> 📅 생성: 2025-10-21 — 델리게이트 시스템 문서화 (UE 5.7 검증 완료)
