---
title: "Actor (액터 시스템)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# Actor (액터 시스템)

## 🧭 개요

**AActor**는 언리얼 엔진의 **게임 월드에 배치할 수 있는 모든 오브젝트의 기반 클래스**입니다. 레벨에 스폰되고, Transform을 가지며, 컴포넌트를 소유하고, Tick을 받으며, 네트워크 복제가 가능한 모든 것은 Actor입니다.

**핵심 철학:**
> **Actor**는 "게임 월드의 개체" (위치, 회전, 스케일),
> **Component**는 "Actor의 기능" (렌더링, 물리, 사운드),
> **Spawn/Destroy**는 "생명주기 관리"를 담당한다.

**주요 특징:**
- **Transform**: 월드 공간에서의 위치/회전/스케일
- **Component 소유**: 기능을 컴포넌트로 모듈화
- **Tick**: 매 프레임 업데이트
- **Replication**: 네트워크 복제
- **Collision**: 충돌 및 Overlap 이벤트

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h`
- `Engine/Source/Runtime/Engine/Private/Actor.cpp`

---

## 🧱 Actor 계층 구조

### 주요 Actor 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UObject                                       │
│  (모든 UE 오브젝트의 기반)                                                │
└────────────────┬────────────────────────────────────────────────────────┘
                 ↓ 상속
┌─────────────────────────────────────────────────────────────────────────┐
│                           AActor                                        │
│  (게임 월드 배치 가능 오브젝트)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - RootComponent : USceneComponent*    // 컴포넌트 트리의 루트         │
│    - PrimaryActorTick : FActorTickFunction  // Tick 설정                │
│    - bReplicates : bool                  // 네트워크 복제 여부           │
│    - Role : ENetRole                     // 네트워크 역할               │
│                                                                         │
│  Key Methods:                                                           │
│    + BeginPlay() : void                  // 게임 시작 시 호출           │
│    + Tick(float DeltaTime) : void        // 매 프레임 호출              │
│    + Destroy() : bool                    // 액터 파괴                   │
│    + SetActorLocation(...) : bool        // 위치 설정                   │
└────────────────┬────────────────────────────────────────────────────────┘
                 ↓ 상속
         ┌───────┴───────┬───────────┬─────────────┬──────────────┐
         ↓               ↓           ↓             ↓              ↓
┌─────────────┐  ┌─────────────┐  ┌──────┐  ┌──────────┐  ┌─────────┐
│   AInfo     │  │ AGameMode   │  │ APawn│  │  AVolume │  │ ALight  │
│  (비물리적)  │  │ (게임 규칙)  │  │(빙의)│  │ (영역)    │  │ (조명)  │
└─────────────┘  └─────────────┘  └───┬──┘  └──────────┘  └─────────┘
                                       ↓
                              ┌─────────────────┐
                              │   ACharacter    │
                              │  (캐릭터 이동)   │
                              └─────────────────┘
```

---

## 🧩 핵심 구성 요소

### 1. **FActorTickFunction - Tick 시스템**

**📂 위치:** `Actor.h:24` (External/Foundation)

```cpp
struct FActorTickFunction : public FTickFunction
{
    // 매 프레임 실행
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
                // AActor::Tick 호출
                Target->TickActor(DeltaTime * Target->CustomTimeDilation, TickType, *this);
            }
        }
    }

    AActor* Target;  // 대상 액터
};
```

**PrimaryActorTick 설정:**
```cpp
// Actor.h 내부
class AActor : public UObject
{
public:
    // Tick 함수
    FActorTickFunction PrimaryActorTick;

    // 생성자에서 설정
    AActor(const FObjectInitializer& ObjectInitializer)
    {
        PrimaryActorTick.bCanEverTick = true;        // Tick 활성화
        PrimaryActorTick.bStartWithTickEnabled = true;  // 시작 시 활성화
        PrimaryActorTick.TickGroup = TG_PrePhysics;  // Tick 그룹
    }
};
```

---

### 2. **Component 시스템**

**컴포넌트 소유:**
```cpp
class AActor
{
    // 루트 컴포넌트 (Transform 계층의 최상위)
    USceneComponent* RootComponent;

    // 소유한 모든 컴포넌트
    TSet<UActorComponent*> OwnedComponents;

    // 블루프린트로 생성된 컴포넌트
    TArray<UActorComponent*> BlueprintCreatedComponents;
};
```

**컴포넌트 계층 구조:**
```
Actor
  └─ RootComponent (USceneComponent)
       ├─ StaticMeshComponent (UStaticMeshComponent)
       │    └─ ChildMeshComponent
       ├─ CameraComponent (UCameraComponent)
       └─ AudioComponent (UAudioComponent)
```

**컴포넌트 접근:**
```cpp
// 특정 타입의 컴포넌트 찾기
UStaticMeshComponent* MeshComp = Actor->FindComponentByClass<UStaticMeshComponent>();

// 모든 컴포넌트 가져오기
TInlineComponentArray<UActorComponent*> Components;
Actor->GetComponents(Components);

// 특정 타입 모든 컴포넌트
TArray<UStaticMeshComponent*> MeshComponents;
Actor->GetComponents<UStaticMeshComponent>(MeshComponents);
```

---

### 3. **FActorThreadContext - 스레드 로컬 컨텍스트**

**📂 위치:** `External/Foundation/Actor.h:9`

```cpp
// TLS (Thread-Local Storage) 사용
class FActorThreadContext : public TThreadSingleton<FActorThreadContext>
{
    FActorThreadContext()
        : TestRegisterTickFunctions(nullptr)
    {}

    // Tick 함수 등록 테스트용
    AActor* TestRegisterTickFunctions;
};
```

**TLS 사용 이유:**
- **스레드 안전성**: 각 스레드마다 독립된 컨텍스트
- **병렬 처리**: 게임 스레드와 렌더 스레드 분리
- **성능**: 락 없이 빠른 접근

---

## 🔄 Actor 생명주기

### Spawn → Destroy 흐름

```
    World::SpawnActor()
           │
           ↓
    1. PreInitializeComponents()
           │ (컴포넌트 초기화 전)
           ↓
    2. InitializeComponents()
           │ (각 컴포넌트 등록)
           ↓
    3. PostInitializeComponents()
           │ (초기화 완료)
           ↓
    4. BeginPlay()
           │ (게임 시작)
           ↓
    5. Tick() (매 프레임)
           │
           ↓
    6. EndPlay()
           │ (게임 종료 또는 Destroy)
           ↓
    7. Destroyed()
           │ (파괴 직전)
           ↓
    8. ~AActor() (소멸자)
```

**주요 이벤트 설명:**

| 이벤트 | 호출 시점 | 용도 |
|--------|----------|------|
| **PreInitializeComponents** | 컴포넌트 등록 전 | 컴포넌트 동적 생성 |
| **PostInitializeComponents** | 컴포넌트 등록 후 | 컴포넌트 간 참조 설정 |
| **BeginPlay** | 게임 시작 또는 스폰 직후 | 초기 로직 실행 |
| **Tick** | 매 프레임 | 지속적 업데이트 |
| **EndPlay** | 파괴 전 또는 레벨 언로드 | 정리 작업 |
| **Destroyed** | Destroy() 호출 시 | 리소스 해제 |

---

## 🎮 Actor 스폰 (Spawn)

### SpawnActor 기본 사용

**📂 위치:** `External/Foundation/Actor.h:4` (DispatchOnComponentsCreated)

```cpp
// 기본 스폰
AActor* SpawnedActor = GetWorld()->SpawnActor<AMyActor>();

// Transform 지정
FVector Location(100, 200, 300);
FRotator Rotation(0, 90, 0);
FActorSpawnParameters SpawnParams;
SpawnParams.Owner = this;
SpawnParams.Instigator = GetInstigator();

AActor* SpawnedActor = GetWorld()->SpawnActor<AMyActor>(
    AMyActor::StaticClass(),
    Location,
    Rotation,
    SpawnParams
);
```

### Deferred Spawn (지연 스폰)

**📂 위치:** `External/Foundation/Actor.h:101` (GSpawnActorDeferredTransformCache)

```cpp
// 1단계: BeginDeferredActorSpawnFromClass
AActor* PendingActor = GetWorld()->SpawnActorDeferred<AMyActor>(
    AMyActor::StaticClass(),
    InitialTransform,
    Owner,
    Pawn,
    ESpawnActorCollisionHandlingMethod::AlwaysSpawn
);

// 2단계: 스폰된 액터 설정
if (PendingActor)
{
    PendingActor->SetSomeProperty(Value);
    PendingActor->InitializeCustomData();
}

// 3단계: FinishSpawningActor (실제 스폰 완료)
PendingActor->FinishSpawning(FinalTransform);
```

**Deferred Spawn의 장점:**
- **설정 후 스폰**: 스폰 전에 프로퍼티 설정 가능
- **충돌 회피**: Transform 조정으로 충돌 방지
- **초기화 제어**: BeginPlay 호출 타이밍 제어

---

## 🌍 Transform 관리

### Actor Transform API

```cpp
// 위치
FVector Location = Actor->GetActorLocation();
Actor->SetActorLocation(NewLocation);
Actor->AddActorWorldOffset(DeltaLocation);

// 회전
FRotator Rotation = Actor->GetActorRotation();
Actor->SetActorRotation(NewRotation);
Actor->AddActorWorldRotation(DeltaRotation);

// 스케일
FVector Scale = Actor->GetActorScale3D();
Actor->SetActorScale3D(NewScale);

// 전체 Transform
FTransform Transform = Actor->GetActorTransform();
Actor->SetActorTransform(NewTransform);

// 상대 Transform (루트 컴포넌트 기준)
FVector RelativeLocation = Actor->GetActorRelativeLocation();
Actor->SetActorRelativeLocation(RelativeLocation);
```

### Sweep (충돌 체크와 함께 이동)

```cpp
FVector NewLocation(100, 200, 300);
bool bSweep = true;  // 이동 경로 충돌 체크
FHitResult HitResult;

bool bSuccess = Actor->SetActorLocation(
    NewLocation,
    bSweep,
    &HitResult,
    ETeleportType::None
);

if (!bSuccess)
{
    // 충돌 발생
    UE_LOG(LogTemp, Warning, TEXT("Hit: %s"), *HitResult.Actor->GetName());
}
```

---

## 🔧 Component 등록/해제

### Component Registration

**📂 위치:** `External/Foundation/Actor.h:58` (GetUnregisteredParent)

```cpp
// 컴포넌트 등록 (렌더링/물리 활성화)
UActorComponent* Component = NewObject<UStaticMeshComponent>(Actor);
Component->RegisterComponent();

// 액터의 모든 컴포넌트 등록
Actor->RegisterAllComponents();

// 등록 해제
Component->UnregisterComponent();
```

**등록되지 않은 부모 찾기:**
```cpp
// External/Foundation/Actor.h:58 참조
static USceneComponent* GetUnregisteredParent(UActorComponent* Component)
{
    USceneComponent* ParentComponent = nullptr;
    USceneComponent* SceneComponent = Cast<USceneComponent>(Component);

    // AttachParent를 따라 올라가며 등록되지 않은 부모 검색
    while (SceneComponent
        && SceneComponent->GetAttachParent()
        && SceneComponent->GetAttachParent()->GetOwner() == Component->GetOwner()
        && !SceneComponent->GetAttachParent()->IsRegistered())
    {
        SceneComponent = SceneComponent->GetAttachParent();
        if (SceneComponent->bAutoRegister && IsValidChecked(SceneComponent))
        {
            ParentComponent = SceneComponent;
        }
    }

    return ParentComponent;
}
```

---

## 🌐 네트워킹

### Replication 설정

```cpp
class AMyActor : public AActor
{
public:
    AMyActor()
    {
        // 복제 활성화
        bReplicates = true;
        bAlwaysRelevant = true;  // 항상 관련성 있음
        NetUpdateFrequency = 10.0f;  // 초당 10회 업데이트
    }

    // 복제할 프로퍼티 등록
    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override
    {
        Super::GetLifetimeReplicatedProps(OutLifetimeProps);

        DOREPLIFETIME(AMyActor, Health);
        DOREPLIFETIME_CONDITION(AMyActor, Score, COND_OwnerOnly);
    }

    UPROPERTY(Replicated)
    float Health;

    UPROPERTY(Replicated)
    int32 Score;
};
```

### Network Role

**📂 위치:** `External/Foundation/Actor.h:119` (ENetRole)

```cpp
enum ENetRole : int32
{
    ROLE_None,              // 네트워크 역할 없음
    ROLE_SimulatedProxy,    // 시뮬레이션된 프록시
    ROLE_AutonomousProxy,   // 자율 프록시 (플레이어 제어)
    ROLE_Authority,         // 서버 권한
};

// Role 확인
if (Actor->GetLocalRole() == ROLE_Authority)
{
    // 서버에서만 실행
}

if (Actor->GetRemoteRole() == ROLE_AutonomousProxy)
{
    // 클라이언트가 자율 제어
}
```

---

## 💡 실전 패턴

### 패턴 1: 동적 컴포넌트 추가

```cpp
void AMyActor::PostInitializeComponents()
{
    Super::PostInitializeComponents();

    // 컴포넌트 동적 생성
    UStaticMeshComponent* NewMesh = NewObject<UStaticMeshComponent>(this, TEXT("DynamicMesh"));
    NewMesh->SetupAttachment(RootComponent);
    NewMesh->RegisterComponent();

    // Static Mesh 설정
    static ConstructorHelpers::FObjectFinder<UStaticMesh> MeshAsset(TEXT("/Game/Meshes/MyMesh"));
    if (MeshAsset.Succeeded())
    {
        NewMesh->SetStaticMesh(MeshAsset.Object);
    }
}
```

### 패턴 2: Tick 조건부 활성화

```cpp
class AMyActor : public AActor
{
public:
    AMyActor()
    {
        // Tick 비활성화 (성능)
        PrimaryActorTick.bCanEverTick = false;
    }

    void StartMoving()
    {
        // 필요할 때만 Tick 활성화
        SetActorTickEnabled(true);
    }

    void StopMoving()
    {
        SetActorTickEnabled(false);
    }

    virtual void Tick(float DeltaTime) override
    {
        Super::Tick(DeltaTime);
        // 이동 로직
    }
};
```

### 패턴 3: Unique Name 생성

**📂 위치:** `External/Foundation/Actor.h:143` (FindFirstFreeName)

```cpp
// 고유한 이름 찾기 (이진 탐색 최적화)
static FName FindFirstFreeName(UObject* Outer, FName BaseName)
{
    int32 Lower = 0;
    FName Ret = FName(BaseName, Lower);

    // 100개 이상 사용된 경우 이진 탐색
    if (FindObjectFast<UObject>(Outer, FName(BaseName, 100)))
    {
        int32 Upper = INT_MAX;
        while (true)
        {
            int32 Next = (Upper - Lower) / 2 + Lower;
            if (FindObjectFast<UObject>(Outer, FName(BaseName, Next)))
            {
                Lower = Next + 1;
            }
            else
            {
                Upper = Next;
            }

            if (Upper == Lower)
            {
                Ret = FName(BaseName, Lower);
                break;
            }
        }
    }
    else
    {
        // 선형 탐색
        while (FindObjectFast<UObject>(Outer, Ret))
        {
            Ret = FName(BaseName, ++Lower);
        }
    }

    return Ret;
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Actors](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/GameplayArchitecture/Actors/)
- Unreal Engine Docs: [Actor Lifecycle](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Actors/ActorLifecycle/)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h` - AActor 선언
- `Engine/Source/Runtime/Engine/Private/Actor.cpp` - AActor 구현
- `UnrealSummary/External/Foundation/Actor.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/Component.md` - 컴포넌트 시스템
- `UnrealSummary/GameFramework/World.md` - UWorld와 스폰
- `UnrealSummary/GameFramework/TickSystem.md` - Tick 관리
- `UnrealSummary/CoreUObject/UObject.md` - UObject 기반

---

## 🔗 관련 문서
- [Actor 생명주기 및 리플리케이션 심층 분석](Actor_Lifecycle_And_Replication_Deep_Dive.md)

---

> 🔄 Created: 2025-01-XX — Initial documentation for Actor System (AActor) in UE 5.7
> 🔄 Updated: 2026-02-18 — README.md를 Overview.md에 통합, 관련 문서 교차 참조 추가
