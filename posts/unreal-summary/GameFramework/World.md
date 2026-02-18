---
title: "World (월드 시스템)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# World (월드 시스템)

## 🧭 개요

**UWorld**는 언리얼 엔진의 **게임 월드를 나타내는 최상위 컨테이너**입니다. 모든 Actor, Level, Subsystem을 소유하며 게임의 시뮬레이션과 렌더링을 관리합니다.

**핵심 철학:**
> **UWorld**는 "게임 월드 컨테이너" (Actor 스폰, Tick 관리),
> **ULevel**은 "배치된 오브젝트 집합" (PersistentLevel, StreamingLevels),
> **Subsystem**은 "월드 생명주기를 따르는 시스템"을 담당한다.

**주요 특징:**
- **Actor 스폰**: SpawnActor() - Actor 생성 및 초기화
- **Level 관리**: PersistentLevel + StreamingLevels
- **Tick 시스템**: 모든 Actor와 Component의 업데이트 관리
- **Subsystem**: UWorldSubsystem - 월드와 생명주기를 공유
- **Worlds**: GameWorld, RenderWorld (FScene), PhysicsWorld (FPhysScene)

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/Engine/World.h`
- `Engine/Source/Runtime/Engine/Private/World.cpp`
- `Engine/Source/Runtime/Engine/Classes/Engine/Level.h`

---

## 🧱 World 계층 구조

### UWorld와 ULevel의 관계

```
┌─────────────────────────────────────────────────────────────────────────┐
│                               UWorld                                    │
│  (게임 월드 - 모든 것의 컨테이너)                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - PersistentLevel : ULevel*           // 메인 레벨                    │
│    - StreamingLevels : TArray<...>       // 스트리밍 레벨 배열            │
│    - Levels : TArray<ULevel*>            // 모든 로드된 레벨             │
│    - SubsystemCollection : ...           // 월드 서브시스템              │
│    - TickManager : FTickTaskManager      // Tick 관리자                 │
│    - Scene : FSceneInterface*            // 렌더 월드                   │
│    - PhysicsScene : FPhysScene*          // 물리 월드                   │
│                                                                         │
│  Key Methods:                                                           │
│    + SpawnActor<T>() : T*                // Actor 생성                  │
│    + DestroyActor(AActor*) : bool        // Actor 파괴                  │
│    + AddToWorld(ULevel*) : void          // 레벨 추가                   │
│    + Tick(float DeltaTime) : void        // 월드 업데이트               │
└───────────┬─────────────────────────────────────────────────────────────┘
            │ 소유
            ↓
   ┌────────┴────────────────┬───────────────────┬────────────────┐
   ↓                         ↓                   ↓                ↓
┌──────────────┐    ┌──────────────┐    ┌──────────────┐  ┌─────────────┐
│PersistentLevel│    │StreamingLevel1│    │StreamingLevel2│  │...더 많은...│
│ (항상 로드됨) │    │ (동적 로드)    │    │ (동적 로드)    │  │StreamingLvl │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘  └──────┬──────┘
       │                   │                   │                 │
       ↓                   ↓                   ↓                 ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                            ULevel                                        │
│  (배치된 Actor들의 집합)                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                            │
│    - OwningWorld : UWorld*               // 소유 월드                    │
│    - Actors : TArray<AActor*>            // 레벨의 모든 Actor            │
│    - Model : UModel*                     // BSP 지오메트리               │
│    - bIsVisible : bool                   // 가시성                      │
│                                                                          │
│  Key Methods:                                                            │
│    + RouteActorInitialize(AActor*) : void  // Actor 초기화              │
│    + AddToWorld(bool bAsync) : void      // 월드에 추가                 │
│    + RemoveFromWorld() : void            // 월드에서 제거               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 World 초기화

### FWorldInitializationValues

**📂 위치:** `World.h:3-18` (External/Foundation)

```cpp
struct FWorldInitializationValues
{
    /** 씬(물리, 렌더링) 생성 여부 */
    uint32 bInitializeScenes:1;

    /** 물리 씬 생성 여부 (bInitializeScenes = true 필요) */
    uint32 bCreatePhysicsScene:1;

    /** 충돌 추적 활성화 여부 */
    uint32 bEnableTraceCollision:1;

    /** 월드 타입 (Game, Editor, PIE 등) */
    EWorldType::Type WorldType;

    /** 피처 레벨 (ES3_1, SM5, SM6 등) */
    ERHIFeatureLevel::Type FeatureLevel;
};
```

**World 생성 예시:**
```cpp
// PIE (Play In Editor) 월드 생성
FWorldInitializationValues InitValues;
InitValues.bInitializeScenes = true;
InitValues.bCreatePhysicsScene = true;
InitValues.bEnableTraceCollision = true;
InitValues.WorldType = EWorldType::PIE;
InitValues.FeatureLevel = ERHIFeatureLevel::SM5;

UWorld* World = UWorld::CreateWorld(InitValues);
World->InitWorld(InitValues);
```

---

## 🔧 Subsystem 시스템

### UWorldSubsystem

**📂 위치:** `World.h:318-325` (External/Foundation)

```cpp
/** UWorld의 생명주기를 따르는 자동 인스턴스화 시스템 */
class UWorldSubsystem : public USubsystem
{
    /** 월드 컴포넌트 업데이트 후 호출 */
    virtual void OnWorldComponentsUpdated(UWorld& World) {}
};
```

**사용 예시:**
```cpp
// Subsystem 정의
UCLASS()
class UMyWorldSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override
    {
        Super::Initialize(Collection);
        UE_LOG(LogTemp, Log, TEXT("MyWorldSubsystem Initialized"));
    }

    virtual void Deinitialize() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyWorldSubsystem Deinitialized"));
        Super::Deinitialize();
    }

    void DoSomething()
    {
        UE_LOG(LogTemp, Log, TEXT("Subsystem doing work"));
    }
};

// Subsystem 접근
UWorld* World = GetWorld();
UMyWorldSubsystem* MySubsystem = World->GetSubsystem<UMyWorldSubsystem>();
if (MySubsystem)
{
    MySubsystem->DoSomething();
}
```

**Subsystem 생명주기:**
```
UWorld 생성
     │
     ↓
FSubsystemCollectionBase::Initialize()
     │ - GetDerivedClasses(UWorldSubsystem)
     │ - 모든 UWorldSubsystem 파생 클래스 수집
     ↓
각 Subsystem별:
     │
     ├─ CDO->ShouldCreateSubsystem() 확인
     │   └─ true이면 계속
     ↓
     ├─ NewObject<USubsystem>() 생성
     ├─ SubsystemMap에 추가
     └─ Subsystem->Initialize() 호출
     ↓
월드 사용 중...
     ↓
UWorld 파괴
     │
     └─ 모든 Subsystem->Deinitialize() 호출
```

---

## 🌐 Level Collection 시스템

### ELevelCollectionType

**📂 위치:** `World.h:327-349` (External/Foundation)

```cpp
enum class ELevelCollectionType : uint8
{
    /**
     * 동적 소스 레벨
     * - 일반 게임플레이용 동적 레벨
     * - 복제 및 동적 게임플레이 Actor 포함
     */
    DynamicSourceLevels,

    /**
     * 동적 복제 레벨
     * - DynamicSourceLevels에서 복제됨
     * - 게임 요청 시 생성
     */
    DynamicDuplicatedLevels,

    /**
     * 정적 레벨
     * - 소스 레벨과 복제 레벨 간 공유
     * - 정적 지오메트리와 시각 요소만 포함
     * - 메모리 절약을 위해 복제하지 않음
     */
    StaticLevels,
};
```

### FLevelCollection

**📂 위치:** `World.h:355-382` (External/Foundation)

```cpp
struct FLevelCollection
{
    /** 컬렉션 타입 */
    ELevelCollectionType CollectionType;

    /** 이 컬렉션의 PersistentLevel */
    TObjectPtr<ULevel> PersistentLevel;

    /** 이 컬렉션의 모든 레벨 */
    TSet<TObjectPtr<ULevel>> Levels;

    const TSet<TObjectPtr<ULevel>>& GetLevels() const { return Levels; }
    ULevel* GetPersistentLevel() const { return PersistentLevel; }
};
```

**Level Collection 구조:**
```
UWorld
  │
  ├─ LevelCollections[0]: DynamicSourceLevels
  │    ├─ PersistentLevel
  │    ├─ DynamicLevel1 (gameplay actors)
  │    └─ DynamicLevel2 (gameplay actors)
  │
  ├─ LevelCollections[1]: StaticLevels
  │    ├─ EnvironmentLevel (static geometry)
  │    └─ LightingLevel (static lights)
  │
  └─ LevelCollections[2]: DynamicDuplicatedLevels (optional)
       ├─ PersistentLevel_Duplicated
       └─ DynamicLevel1_Duplicated
```

---

## 🎭 Actor 스폰 시스템

### FActorSpawnParameters

**📂 위치:** `World.h:48-89` (External/Foundation)

```cpp
struct FActorSpawnParameters
{
    /** Actor 이름 (없으면 자동 생성: [Class]_[Number]) */
    FName Name;

    /** 템플릿 Actor (nullptr이면 CDO 사용) */
    AActor* Template;

    /** 이 Actor를 생성한 Owner */
    AActor* Owner;

    /** 데미지 책임자 */
    APawn* Instigator;

    /** 충돌 처리 방법 */
    ESpawnActorCollisionHandlingMethod SpawnCollisionHandlingOverride;

    /** Transform 스케일 방법 */
    ESpawnActorScaleMethod TransformScaleMethod = ESpawnActorScaleMethod::MultiplyWithRoot;

    /** 스폰할 ULevel (nullptr이면 Owner의 Level 또는 PersistentLevel) */
    ULevel* OverrideLevel;

    /** Construction Script 중 스폰 허용 여부 */
    uint8 bAllowDuringConstructionScript : 1;

    /** Construction Script 실행 연기 */
    uint8 bDeferConstruction : 1;
};
```

### ESpawnActorCollisionHandlingMethod

**📂 위치:** `World.h:20-36` (External/Foundation)

```cpp
enum class ESpawnActorCollisionHandlingMethod : uint8
{
    /** 기본 설정 사용 */
    Undefined,

    /** 충돌 무시하고 항상 스폰 */
    AlwaysSpawn,

    /** 가능하면 위치 조정, 실패해도 스폰 */
    AdjustIfPossibleButAlwaysSpawn,

    /** 가능하면 위치 조정, 실패하면 스폰 안 함 */
    AdjustIfPossibleButDontSpawnIfColliding,

    /** 충돌 시 스폰 실패 */
    DontSpawnIfColliding,
};
```

### SpawnActor 사용 예시

```cpp
// 1. 기본 스폰
AActor* Actor = GetWorld()->SpawnActor<AMyActor>();

// 2. Transform과 파라미터 지정
FVector Location(100, 200, 300);
FRotator Rotation(0, 90, 0);
FActorSpawnParameters SpawnParams;
SpawnParams.Name = TEXT("MyCustomActor");
SpawnParams.Owner = this;
SpawnParams.Instigator = GetInstigator();
SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

AMyActor* Actor = GetWorld()->SpawnActor<AMyActor>(
    AMyActor::StaticClass(),
    Location,
    Rotation,
    SpawnParams
);

// 3. Deferred Spawn (설정 후 스폰)
FActorSpawnParameters DeferredParams;
DeferredParams.bDeferConstruction = true;

AMyActor* PendingActor = GetWorld()->SpawnActorDeferred<AMyActor>(
    AMyActor::StaticClass(),
    InitialTransform,
    Owner,
    Pawn
);

// 설정 변경
if (PendingActor)
{
    PendingActor->SetSomeProperty(Value);
    PendingActor->InitializeData();
}

// 실제 스폰 완료
PendingActor->FinishSpawning(FinalTransform);
```

### 고유 Actor 이름 생성

**📂 위치:** `World.h:468-496` (External/Foundation)

```cpp
static FName MakeUniqueActorName(ULevel* Level, const UClass* Class, FName BaseName, bool bGloballyUnique)
{
    if (bGloballyUnique)
    {
        // 네트워크 환경: MAC 주소 + 타임스탬프로 전역 고유 이름
        // 예: StaticMeshActor_UAID_001122334455667788
        static FActorGUIDGenerator ActorGUIDGenerator;
        do
        {
            NewActorName = ActorGUIDGenerator.NewActorGUID(BaseName);
        } while (StaticFindObjectFast(nullptr, Level, NewActorName));
    }
    else
    {
        // 로컬 환경: 순차 번호
        // 예: StaticMeshActor_0, StaticMeshActor_1, ...
        NewActorName = MakeUniqueObjectName(Level, Class, BaseName);
    }
    return NewActorName;
}
```

---

## ⏱️ World Tick 시스템

### FScopedLevelCollectionContextSwitch

**📂 위치:** `World.h:576-599` (External/Foundation)

```cpp
/** RAII 패턴으로 LevelCollection 컨텍스트 전환 */
class FScopedLevelCollectionContextSwitch
{
public:
    FScopedLevelCollectionContextSwitch(int32 InLevelCollectionIndex, UWorld* InWorld)
        : World(InWorld)
        , SavedTickingCollectionIndex(InWorld ? InWorld->GetActiveLevelCollectionIndex() : INDEX_NONE)
    {
        if (World)
        {
            World->SetActiveLevelCollection(InLevelCollectionIndex);
        }
    }

    ~FScopedLevelCollectionContextSwitch()
    {
        if (World)
        {
            World->SetActiveLevelCollection(SavedTickingCollectionIndex);
        }
    }

private:
    UWorld* World;
    int32 SavedTickingCollectionIndex;
};
```

**Tick 흐름:**
```cpp
void UWorld::Tick(float DeltaSeconds)
{
    // 1. Dynamic 레벨 Tick
    {
        FScopedLevelCollectionContextSwitch Context(DynamicSourceLevelsIndex, this);
        TickGroup(TG_PrePhysics, DeltaSeconds);
        TickGroup(TG_StartPhysics, DeltaSeconds);
        TickGroup(TG_DuringPhysics, DeltaSeconds);
        TickGroup(TG_EndPhysics, DeltaSeconds);
        TickGroup(TG_PostPhysics, DeltaSeconds);
        TickGroup(TG_PostUpdateWork, DeltaSeconds);
    }

    // 2. Static 레벨은 필요 시에만 Tick
    // (대부분 정적이므로 Tick 불필요)
}
```

---

## 💡 실전 패턴

### 패턴 1: 월드 컨텍스트 얻기

```cpp
// UObject 기반 클래스에서
UWorld* World = GetWorld();

// Actor에서
UWorld* World = GetWorld();

// Component에서
UWorld* World = GetOwner()->GetWorld();

// GameInstance에서
UWorld* World = GetWorld();

// PlayerController에서
UWorld* World = GetWorld();

// 정적 함수에서 (UObject 필요)
UWorld* World = GEngine->GetWorldFromContextObject(ContextObject, EGetWorldErrorMode::LogAndReturnNull);
```

### 패턴 2: 월드의 모든 Actor 순회

```cpp
// 특정 클래스의 모든 Actor
for (TActorIterator<AMyActor> It(GetWorld()); It; ++It)
{
    AMyActor* Actor = *It;
    Actor->DoSomething();
}

// 모든 Actor
for (FActorIterator It(GetWorld()); It; ++It)
{
    AActor* Actor = *It;
    UE_LOG(LogTemp, Log, TEXT("Actor: %s"), *Actor->GetName());
}

// Level의 Actors 배열 직접 접근
ULevel* Level = GetWorld()->PersistentLevel;
for (AActor* Actor : Level->Actors)
{
    if (Actor && !Actor->IsPendingKill())
    {
        // 처리
    }
}
```

### 패턴 3: 레벨 스트리밍

```cpp
void AMyActor::LoadStreamingLevel(FName LevelName)
{
    // 레벨 스트리밍 요청
    FLatentActionInfo LatentInfo;
    LatentInfo.CallbackTarget = this;
    LatentInfo.ExecutionFunction = TEXT("OnLevelLoaded");
    LatentInfo.UUID = GetUniqueID();
    LatentInfo.Linkage = 0;

    UGameplayStatics::LoadStreamLevel(
        this,
        LevelName,
        true,  // bMakeVisibleAfterLoad
        true,  // bShouldBlockOnLoad
        LatentInfo
    );
}

void AMyActor::OnLevelLoaded()
{
    UE_LOG(LogTemp, Log, TEXT("Level loaded successfully"));
}
```

### 패턴 4: Subsystem 커스터마이징

```cpp
// 특정 조건에서만 생성되는 Subsystem
UCLASS()
class UMyConditionalSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual bool ShouldCreateSubsystem(UObject* Outer) const override
    {
        UWorld* World = Cast<UWorld>(Outer);

        // Game 월드에서만 생성
        if (World && World->WorldType == EWorldType::Game)
        {
            return true;
        }

        return false;
    }

    virtual void Initialize(FSubsystemCollectionBase& Collection) override
    {
        Super::Initialize(Collection);

        // 초기화 로직
        UWorld* World = GetWorld();
        UE_LOG(LogTemp, Log, TEXT("MyConditionalSubsystem created for world: %s"), *World->GetName());
    }
};
```

### 패턴 5: 프레임 끝 업데이트

```cpp
void AMyActor::MarkComponentForEndOfFrameUpdate(UActorComponent* Component)
{
    // 프레임 끝에 렌더 Transform 업데이트 예약
    UWorld* World = GetWorld();
    if (World)
    {
        World->MarkActorComponentForNeededEndOfFrameUpdate(Component, false);
    }
}
```

---

## 🏗️ World 타입

```cpp
namespace EWorldType
{
    enum Type
    {
        /** 일반 게임 월드 (실제 게임플레이) */
        Game,

        /** 에디터 월드 (에디터에서 편집 중) */
        Editor,

        /** PIE 월드 (Play In Editor) */
        PIE,

        /** 에디터 프리뷰 (머티리얼, 메시 등) */
        EditorPreview,

        /** 게임 프리뷰 (독립 실행형 에디터 프리뷰) */
        GamePreview,

        /** 레벨 프리뷰 (썸네일 렌더링 등) */
        Inactive,
    };
}
```

**WorldType 확인:**
```cpp
UWorld* World = GetWorld();

if (World->WorldType == EWorldType::Game)
{
    // 실제 게임 중
}
else if (World->WorldType == EWorldType::PIE)
{
    // 에디터에서 플레이 테스트 중
}
else if (World->WorldType == EWorldType::Editor)
{
    // 에디터 편집 중
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [World](https://docs.unrealengine.com/en-US/API/Runtime/Engine/Engine/UWorld/)
- Unreal Engine Docs: [Level Streaming](https://docs.unrealengine.com/en-US/BuildingWorlds/LevelStreaming/)
- Unreal Engine Docs: [Programming Subsystems](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/Subsystems/)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/Engine/World.h` - UWorld 선언
- `Engine/Source/Runtime/Engine/Private/World.cpp` - UWorld 구현
- `Engine/Source/Runtime/Engine/Classes/Engine/Level.h` - ULevel 선언
- `UnrealSummary/External/Foundation/World.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/Actor.md` - Actor 스폰과 생명주기
- `UnrealSummary/GameFramework/Component.md` - Component 등록
- `UnrealSummary/GameFramework/TickSystem.md` - Tick 관리
- `UnrealSummary/GameFramework/GameMode.md` - 게임 모드와 월드

---

## 🔗 관련 문서
- [World Tick 파이프라인 심층 분석](World_Tick_Pipeline_Deep_Dive.md)

---

> 🔄 Created: 2025-01-XX — Initial documentation for World System (UWorld, ULevel, Subsystems) in UE 5.7
> 🔄 Updated: 2026-02-18 — README.md를 Overview.md에 통합, 관련 문서 교차 참조 추가
