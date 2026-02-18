---
title: "Mover Plugin & Mass AI Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "AI"
tags: ["unreal", "AI"]
---
# Mover Plugin & Mass AI Deep Dive

## 🧭 개요

**Mover Plugin**과 **Mass Framework**는 UE 5.6+에서 **수백 명의 NPC를 60 FPS로 구동**하는 시스템입니다.

### The Witcher 4 Demo NPC 통계

| 항목 | 수치 |
|------|------|
| **동시 NPC 수** | 300명 (발드레스트 마을) |
| **총 본(Bone) 수** | 45,000개 이상 |
| **Skeletal Mesh** | ~800개 |
| **애니메이션 비용** | 52ms (12 워커 스레드 분산) |
| **AI 시스템** | Motion Matching + 루트 모션 |
| **목표 FPS** | 60 FPS (현세대 콘솔) |

**핵심 특징:**
> NPC는 VAT(Vertex Animation Texture)나 빌보드가 **아닌** 실제 캐릭터이며, 모션 매칭이 적용된 네이티브 캐릭터입니다.

---

## 🏗️ 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                      NPC 구동 계층 구조                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  High-Level AI (Behavior)                             │      │
│  │  - State Tree (상태 관리)                              │      │
│  │  - Smart Object (동적 이벤트 처리)                     │      │
│  └─────────────────────┬─────────────────────────────────┘      │
│                        ▼                                         │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Movement (이동)                                       │      │
│  │  - Mover Plugin 2.0 (경로 탐색 + 이동)                 │      │
│  │  - NavMesh (내비게이션 메시)                           │      │
│  │  - Line Trace (바닥 높이 보정)                         │      │
│  └─────────────────────┬─────────────────────────────────┘      │
│                        ▼                                         │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Animation (애니메이션)                                │      │
│  │  - Motion Matching (자연스러운 동작)                   │      │
│  │  - Root Motion (위치 정확도)                           │      │
│  │  - 점진적 루트 모션 정렬 (신규!)                       │      │
│  └─────────────────────┬─────────────────────────────────┘      │
│                        ▼                                         │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Mass Framework (병렬 처리)                            │      │
│  │  - ECS (Entity Component System)                      │      │
│  │  - 워커 스레드 분산 (12 threads)                       │      │
│  │  - 효율적 데이터 관리                                  │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚶 Mover Plugin 2.0

### 개요

**Mover Plugin**은 기존 **Character Movement Component를 대체**하기 위해 개발된 차세대 이동 시스템입니다.

**📂 위치**: `Engine/Plugins/Experimental/Mover/Source/Mover/`

### 기존 vs Mover 2.0

| 특징 | Character Movement Component | Mover Plugin 2.0 |
|------|------------------------------|------------------|
| **아키텍처** | 단일 Component (거대한 클래스) | 모듈식 (Mode 기반) |
| **확장성** | 상속 필요 (C++ 전문 지식) | Mode 추가로 확장 |
| **병렬 처리** | 게임 스레드 전용 | 워커 스레드 분산 가능 |
| **Network** | Built-in Replication | 선택적 (필요 시만) |
| **용도** | 플레이어 캐릭터 중심 | NPC + 플레이어 모두 |

### Movement Mode (이동 모드)

**핵심 개념**: 상황별로 다른 Movement Mode 사용

```cpp
// Movement Modes
enum class EMoverMode
{
    Walking,      // 걷기 (지면)
    Falling,      // 낙하 (공중)
    Flying,       // 비행
    Swimming,     // 수영
    Custom        // 커스텀 (예: 말 타기)
};
```

**예시: NPC 이동**

```cpp
UCLASS()
class ANPCCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    UPROPERTY(VisibleAnywhere)
    UMoverComponent* MoverComponent;

    ANPCCharacter()
    {
        // Mover Component 생성
        MoverComponent = CreateDefaultSubobject<UMoverComponent>(TEXT("Mover"));

        // Walking Mode 추가
        UWalkingMode* WalkMode = NewObject<UWalkingMode>();
        WalkMode->MaxSpeed = 400.0f;        // cm/s
        WalkMode->Acceleration = 2000.0f;
        MoverComponent->AddMovementMode(WalkMode);

        // Custom Mode: 달리기
        URunningMode* RunMode = NewObject<URunningMode>();
        RunMode->MaxSpeed = 800.0f;
        MoverComponent->AddMovementMode(RunMode);
    }
};
```

### 비동기 업데이트

**핵심 최적화**: Mover는 **워커 스레드에서 병렬 실행** 가능

```cpp
// 기존 (게임 스레드 전용)
void ACharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    MovementComponent->TickComponent(DeltaTime, ...);  // 게임 스레드
}

// Mover 2.0 (워커 스레드 분산)
void UMoverComponent::TickAsync(float DeltaTime)
{
    // 각 NPC의 Mover가 서로 다른 스레드에서 실행
    AsyncTask(ENamedThreads::AnyBackgroundThreadNormalTask, [this, DeltaTime]()
    {
        UpdateMovement(DeltaTime);  // 병렬 실행!
    });
}
```

**The Witcher 4 Demo 실측:**

```
300 NPCs × Mover Update:
  - 기존 (순차): ~18ms (게임 스레드)
  - Mover 2.0 (병렬): ~3ms (12 워커 스레드 분산)

→ 6배 빠름!
```

---

## 🧠 Mass Framework

### 개요

**Mass Framework**는 **ECS (Entity Component System)** 기반으로 수천 개의 엔티티를 효율적으로 관리합니다.

**📂 위치**: `Engine/Plugins/Runtime/MassGameplay/Source/MassActors/`

### ECS 패턴

**전통적인 방식 (Object-Oriented):**

```cpp
// 각 NPC = AActor 인스턴스
AActor* NPC1 = SpawnActor<ANPCCharacter>();
AActor* NPC2 = SpawnActor<ANPCCharacter>();
...
// 300개 = 300개의 독립된 객체 (메모리 분산, 캐시 미스 많음)
```

**Mass Framework (ECS):**

```cpp
// 데이터 중심 설계
struct FMassEntity
{
    int32 EntityID;  // 단순 ID
};

// Component는 별도 배열에 저장
TArray<FTransformFragment> Transforms;      // 위치 데이터
TArray<FMoverFragment> MovementData;        // 이동 데이터
TArray<FAnimationFragment> AnimationData;   // 애니메이션 데이터

// 같은 타입의 데이터가 연속된 메모리에 배치 → 캐시 효율 ↑
```

### Processor (시스템)

**Processor**: 특정 Component를 가진 엔티티들을 일괄 처리

```cpp
// 이동 Processor
UCLASS()
class UMassMovementProcessor : public UMassProcessor
{
    GENERATED_BODY()

public:
    virtual void Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) override
    {
        // 모든 NPC의 이동을 한 번에 처리
        EntityQuery.ForEachEntityChunk(EntityManager, Context, [](FMassExecutionContext& Context)
        {
            // Chunk = 연속된 메모리 블록 (예: 100개 엔티티)
            auto Transforms = Context.GetMutableFragmentView<FTransformFragment>();
            auto Movements = Context.GetFragmentView<FMoverFragment>();

            for (int32 i = 0; i < Context.GetNumEntities(); ++i)
            {
                // SIMD 연산 가능 (벡터화)
                Transforms[i].Position += Movements[i].Velocity * DeltaTime;
            }
        });
    }
};
```

**장점:**
- 캐시 친화적 (연속 메모리)
- SIMD 최적화 가능
- 병렬 처리 용이

---

## 🎯 경로 탐색 (NavMesh + Line Trace)

### NavMesh 기반 이동

**문제**: NavMesh는 2.5D (높이 정보 부정확)

```
        실제 지형 (굴곡)
          /\    /\
         /  \__/  \
NavMesh: ──────────  ← 평평하게 단순화됨
```

**The Witcher 4 해결책:**

```cpp
// 주기적으로 Line Trace로 바닥 높이 보정
void UMoverComponent::UpdateGroundHeight()
{
    if (FrameCount % LineTraceInterval == 0)  // 예: 5프레임마다
    {
        // Line Trace로 실제 바닥 높이 측정
        FHitResult Hit;
        GetWorld()->LineTraceSingleByChannel(Hit, StartPos, EndPos, ECC_WorldStatic);

        if (Hit.bBlockingHit)
        {
            GroundHeight = Hit.Location.Z;
        }
    }
    else
    {
        // 중간 프레임: NavMesh Normal로 추측
        GroundHeight += NavMeshNormal.Z * EstimatedSlope;
    }

    // 최종 위치에 높이 적용
    FinalPosition.Z = GroundHeight;
}
```

**최적화:**
- **주기적 Line Trace** (5~10 프레임마다) → CPU 부담 낮춤
- **중간 프레임**: NavMesh 정보로 추측 → 정확도 유지

### 좁은 틈: Smart Object 활용

**문제**: 좁은 통로 (예: 문, 좁은 길)에서 NavMesh 셀 크기 줄이면 성능 저하

**해결:**

```cpp
// Smart Object: 특정 위치에서 애니메이션 트리거
UCLASS()
class UDoorSmartObject : public USmartObjectComponent
{
    GENERATED_BODY()

public:
    // NPC가 문 앞 도착 시
    virtual void OnClaim(AActor* User) override
    {
        // 1. 문 열기 애니메이션 재생
        User->PlayAnimation("Door_Open");

        // 2. NavLink로 이동 경로 제공
        User->FollowNavLink(DoorNavLink);

        // 3. 문 통과 후 닫기
        User->OnNavLinkComplete.AddDynamic(this, &UDoorSmartObject::CloseDoor);
    }
};
```

**효과:**
- NavMesh 셀 크기 유지 (성능 유지)
- 좁은 틈도 자연스럽게 통과
- 애니메이션 자동 재생

---

## 🎬 Motion Matching & Root Motion

### Motion Matching

**개념**: 거대한 애니메이션 데이터베이스에서 현재 상황에 맞는 프레임을 실시간 검색

```cpp
// Motion Matching Database
TArray<FMotionFrame> AnimationDatabase;  // 수천~수만 프레임

// 매 프레임 최적 애니메이션 검색
FMotionFrame FindBestMatch(FVector CurrentVelocity, FVector DesiredVelocity)
{
    float BestScore = FLT_MAX;
    FMotionFrame BestFrame;

    for (auto& Frame : AnimationDatabase)
    {
        // 현재 속도 + 미래 궤적과의 유사도 계산
        float Score = CalculateSimilarity(CurrentVelocity, DesiredVelocity, Frame);

        if (Score < BestScore)
        {
            BestScore = Score;
            BestFrame = Frame;
        }
    }

    return BestFrame;  // 가장 자연스러운 프레임
}
```

**장점:**
- 자연스러운 움직임 (애니메이션 블렌딩 불필요)
- 복잡한 상황 대응 (급정지, 방향 전환 등)

### Root Motion (루트 모션)

**문제**: 기존에는 루트 모션 평가가 **게임 스레드 전용**

**UE 5.6+ 개선:**

```cpp
// 기존 (게임 스레드)
void ACharacter::Tick(float DeltaTime)
{
    // 크리티컬 패스에서 실행
    FTransform RootMotion = AnimInstance->ExtractRootMotion();
    AddMovementInput(RootMotion.GetTranslation());
}

// UE 5.6+ (워커 스레드)
void UMassAnimationProcessor::Execute(...)
{
    // 워커 스레드에서 병렬 실행
    ParallelFor(Entities.Num(), [&](int32 Index)
    {
        FTransform RootMotion = ExtractRootMotionAsync(Entities[Index]);
        ApplyRootMotion(Entities[Index], RootMotion);
    });
}
```

**The Witcher 4 실측:**

```
300 NPCs × Root Motion 평가:
  - 기존 (게임 스레드): ~12ms
  - UE 5.6 (워커 스레드): ~2ms (12 스레드 분산)

→ 6배 빠름!
```

### 점진적 루트 모션 정렬 (신규!)

**용도**: 특정 위치에 정확히 도달해야 할 때 (예: 벽 잡고 지나가기)

```cpp
// Animation Blueprint
UCLASS()
class UMyAnimInstance : public UAnimInstance
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere)
    FVector TargetLocation;  // 목표 위치

    virtual void NativeUpdateAnimation(float DeltaTime) override
    {
        // 점진적으로 루트 모션 보정
        FTransform RootMotion = ExtractRootMotion();

        // 현재 위치와 목표 위치 차이 계산
        FVector Error = TargetLocation - GetOwningActor()->GetActorLocation();

        // 매 프레임 보정 (부드럽게)
        FVector Correction = Error * CorrectionSpeed * DeltaTime;
        RootMotion.AddToTranslation(Correction);

        ApplyRootMotion(RootMotion);
    }
};
```

**효과:**
- 목표 위치에 정확히 도달 (오차 거의 없음)
- 자연스러운 움직임 유지 (급격한 워프 없음)
- **The Witcher 4 예시**: 벽을 잡고 지나가는 장면

---

## 🎭 Smart Object System

### 개요

**Smart Object**는 **동적 이벤트 처리** 시스템입니다.

**📂 위치**: `Engine/Plugins/Runtime/SmartObjects/`

### 예시 1: 상자 들기/내리기

**시나리오**: 상인이 상자를 들었다가 내려놓음

```cpp
// Smart Object Definition
UCLASS()
class UBoxSmartObject : public USmartObjectComponent
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere)
    UAnimSequence* PickUpAnimation;

    UPROPERTY(EditAnywhere)
    UAnimSequence* PutDownAnimation;

    // NPC가 상호작용 시작
    virtual void OnClaim(AActor* User) override
    {
        // 1. 상자 들기 애니메이션
        User->PlayAnimation(PickUpAnimation);

        // 2. 애니메이션 중간에 Notify 발동
        // → 상자를 손에 붙임 (Attach)
    }

    // 애니메이션 노티파이: 상자 붙이기
    UFUNCTION()
    void OnPickUpNotify()
    {
        BoxMesh->AttachToComponent(User->GetMesh(), "hand_r");
    }

    // 애니메이션 노티파이: 상자 떼기
    UFUNCTION()
    void OnPutDownNotify()
    {
        BoxMesh->DetachFromComponent(FDetachmentTransformRules::KeepWorldTransform);
    }
};
```

**핵심**: 미리 만들어진 시퀀스가 **아님** → 런타임에 동적으로 결정

### 예시 2: 곰에 놀라는 반응

**시나리오**: 곰이 나타나면 주변 NPC들이 놀람

```cpp
// 곰의 애니메이션 노티파이
UFUNCTION()
void ABear::OnRoarNotify()
{
    // Smart Object 시스템에 시그널 전송
    USmartObjectSubsystem* SOSubsystem = GetWorld()->GetSubsystem<USmartObjectSubsystem>();
    SOSubsystem->SendSignal("ScaryEvent", GetActorLocation(), 1000.0f);  // 10m 반경
}

// 주변 NPC의 Smart Object
UCLASS()
class UScaredReactionSmartObject : public USmartObjectComponent
{
    GENERATED_BODY()

public:
    virtual void OnSignalReceived(FName Signal, FVector Location) override
    {
        if (Signal == "ScaryEvent")
        {
            // 거리 계산
            float Distance = FVector::Dist(GetOwner()->GetActorLocation(), Location);

            if (Distance < 300.0f)  // 가까우면
            {
                PlayAnimation("Scared_Run");  // 도망
            }
            else if (Distance < 1000.0f)  // 중간 거리면
            {
                PlayAnimation("Scared_LookAt");  // 쳐다봄
            }
        }
    }
};
```

**효과:**
- 플레이할 때마다 다른 반응
- 시네마틱이 아닌 동적 이벤트

---

## 📊 성능 측정

### The Witcher 4 Demo - 발드레스트 마을

**시나리오**: 300명 NPC, 페스티벌 씬

```
총 리소스:
  - NPC: 300명
  - Bone: 45,000개
  - Skeletal Mesh: 800개
  - Motion Matching Database: ~50,000 프레임

성능 (PS5):
  - 게임 스레드: ~8ms
    → Mover Update: ~1ms (워커 스레드 분산)
    → AI Logic (State Tree): ~2ms
    → Smart Object: ~1ms
    → 기타: ~4ms

  - 워커 스레드 (12 threads):
    → Animation Evaluation: 52ms 총합
    → 스레드당 평균: ~4.3ms
    → Root Motion 평가: 병렬 처리

  - 렌더링:
    → Skeletal Mesh: ~5ms (Nanite LOD)
    → Shadow: ~3ms (VSM)

총 프레임 시간: ~16.2ms (61 FPS)
```

### Mass Framework 효율

**메모리 비교:**

| 방식 | 메모리 (300 NPCs) |
|------|------------------|
| **전통적 AActor** | ~450 MB |
| **Mass Framework** | ~120 MB |

**차이 이유:**
- Mass는 데이터만 저장 (Transform, Movement, Animation)
- AActor는 전체 객체 (UObject 오버헤드 큼)

---

## 💡 실전 예시: 페스티벌 씬

### 구성

```cpp
// 페스티벌 트리거
UCLASS()
class AFestivalTrigger : public AActor
{
    GENERATED_BODY()

public:
    virtual void BeginPlay() override
    {
        // Smart Object 시그널: 페스티벌 시작
        USmartObjectSubsystem* SOSubsystem = GetWorld()->GetSubsystem<USmartObjectSubsystem>();
        SOSubsystem->SendSignal("FestivalStart", GetActorLocation(), 5000.0f);
    }
};

// NPC 반응 (각자 다른 행동)
UCLASS()
class UFestivalReactionSO : public USmartObjectComponent
{
    GENERATED_BODY()

public:
    virtual void OnSignalReceived(FName Signal, FVector Location) override
    {
        if (Signal == "FestivalStart")
        {
            // 랜덤 행동 선택
            int32 Action = FMath::RandRange(0, 2);

            switch (Action)
            {
            case 0:
                PlayAnimation("Dance");  // 춤추기
                break;
            case 1:
                PlayAnimation("Clap");   // 박수치기
                break;
            case 2:
                PlayAnimation("Watch");  // 구경하기
                break;
            }
        }
    }
};
```

**결과:**
- 300명 NPC가 각자 다른 반응
- 플레이할 때마다 다른 장면
- CPU 부담: ~2ms (Smart Object 시그널 처리)

---

## 🔗 References

- **GDC Talk**: "The Witcher 4: Mass AI and Animation at Scale" (에픽게임즈 코리아)
- **Official Docs**: [Mover 2.0 (UE 5.6+)](https://docs.unrealengine.com/5.6/en-US/mover-plugin/)
- **Official Docs**: [Mass Framework](https://docs.unrealengine.com/5.6/en-US/mass-entity-in-unreal-engine/)
- **Source Code**: `Engine/Plugins/Experimental/Mover/`, `Engine/Plugins/Runtime/MassGameplay/`

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Mover Plugin & Mass AI (UE 5.6/5.7, The Witcher 4 Tech Demo)