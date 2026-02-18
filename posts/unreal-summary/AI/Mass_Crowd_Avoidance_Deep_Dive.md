---
title: "Mass Crowd Avoidance Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "AI"
tags: ["unreal", "AI"]
---
# Mass Crowd Avoidance Deep Dive

## 🧭 개요

**Mass Crowd Avoidance**는 **수백~수천 명의 NPC가 서로 겹치지 않고** 자연스럽게 이동하도록 하는 시스템입니다.

### 핵심 과제

| 문제 | 기존 방법 | Mass Avoidance |
|------|----------|---------------|
| **300명 NPC 충돌 회피** | 300 × 299 = 89,700 쌍 체크! | Spatial Hash로 O(n) |
| **자연스러운 움직임** | 급격한 방향 전환 | 점진적 회피 |
| **성능** | CPU 병목 | 워커 스레드 병렬 |

**핵심 철학:**
> "가까운 이웃만 체크하고, 미래를 예측하며, 부드럽게 회피한다"

---

## 🏗️ Crowd Avoidance 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│              Mass Crowd Avoidance 파이프라인                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1️⃣ Spatial Hashing (공간 분할)                                  │
│     ↓                                                            │
│     모든 엔티티를 Grid Cell에 배치                               │
│     Cell Size = 2m × 2m                                         │
│                                                                  │
│  2️⃣ Neighbor Search (이웃 검색)                                  │
│     ↓                                                            │
│     각 엔티티의 주변 8개 Cell 내 이웃 찾기                       │
│     Max Neighbors = 16                                          │
│                                                                  │
│  3️⃣ RVO (Reciprocal Velocity Obstacles)                         │
│     ↓                                                            │
│     이웃과의 미래 충돌 예측                                      │
│     회피 속도 계산                                               │
│                                                                  │
│  4️⃣ Steering (조향)                                              │
│     ↓                                                            │
│     회피 속도를 부드럽게 적용                                    │
│     Desired Velocity → Current Velocity                         │
│                                                                  │
│  5️⃣ Integration (통합)                                           │
│     ↓                                                            │
│     최종 속도로 위치 업데이트                                    │
│     Position += Velocity × DeltaTime                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📐 Spatial Hashing (공간 해싱)

### FMassNavigationGrid

**📂 위치**: `Engine/Plugins/AI/MassAI/Source/MassNavigation/Public/MassNavigationTypes.h`

```cpp
// Spatial Hash Grid
class FMassNavigationGrid
{
public:
    // Grid Cell 크기 (2m × 2m)
    static constexpr float CellSize = 200.0f;  // cm

    // Grid 데이터 (Cell Index → Entity List)
    TMap<FIntVector2, TArray<FMassEntityHandle>> Grid;

    // 엔티티를 Grid에 추가
    void AddEntity(const FVector& Location, FMassEntityHandle Entity)
    {
        FIntVector2 CellCoord = WorldToCell(Location);
        Grid.FindOrAdd(CellCoord).Add(Entity);
    }

    // 월드 좌표 → Cell 좌표
    FIntVector2 WorldToCell(const FVector& WorldLocation) const
    {
        return FIntVector2(
            FMath::FloorToInt(WorldLocation.X / CellSize),
            FMath::FloorToInt(WorldLocation.Y / CellSize)
        );
    }

    // 주변 9개 Cell의 이웃 찾기
    void FindNeighbors(
        const FVector& Location,
        float SearchRadius,
        TArray<FMassEntityHandle>& OutNeighbors
    ) const
    {
        FIntVector2 CenterCell = WorldToCell(Location);

        // 3×3 Grid 순회
        for (int32 dy = -1; dy <= 1; ++dy)
        for (int32 dx = -1; dx <= 1; ++dx)
        {
            FIntVector2 CellCoord = CenterCell + FIntVector2(dx, dy);

            if (const TArray<FMassEntityHandle>* CellEntities = Grid.Find(CellCoord))
            {
                OutNeighbors.Append(*CellEntities);
            }
        }
    }
};
```

**시각화:**

```
Grid (2m × 2m Cell):

  ┌────┬────┬────┬────┬────┐
  │    │    │  3 │    │    │
  ├────┼────┼────┼────┼────┤
  │  1 │ 12 │ 8  │  5 │    │  ← 각 Cell에 엔티티 수
  ├────┼────┼────┼────┼────┤
  │    │  7 │ 15 │  9 │  2 │
  ├────┼────┼────┼────┼────┤
  │    │  4 │  6 │ 11 │    │
  └────┴────┴────┴────┴────┘

엔티티 A가 중앙 Cell에 있으면:
  - 주변 8개 Cell 검색
  - 최대 12+7+15+... 개 이웃 (전체 탐색보다 훨씬 적음)
```

---

## 🚶 RVO (Reciprocal Velocity Obstacles)

### 핵심 개념

**RVO**: 두 엔티티가 **서로 책임을 나눠** 회피

```
A와 B가 정면 충돌 예정:
  기존: A만 회피 → 부자연스러움
  RVO: A와 B가 각각 50%씩 회피 → 자연스러움
```

### Velocity Obstacle (속도 장애물)

```cpp
// 엔티티 A가 B를 피하기 위한 금지 속도 영역
struct FVelocityObstacle
{
    FVector2D Apex;        // VO 꼭지점 (B의 현재 위치)
    FVector2D LeftBound;   // 왼쪽 경계
    FVector2D RightBound;  // 오른쪽 경계
    float TimeHorizon;     // 예측 시간 (기본 2초)
};

// VO 계산
FVelocityObstacle CalculateVO(
    const FVector2D& PosA,
    const FVector2D& PosB,
    const FVector2D& VelB,
    float RadiusA,
    float RadiusB,
    float TimeHorizon = 2.0f
)
{
    FVelocityObstacle VO;

    // 상대 위치
    FVector2D RelativePos = PosB - PosA;
    float Distance = RelativePos.Size();

    // VO Apex (B의 상대 속도)
    VO.Apex = VelB;

    // 결합 반지름
    float CombinedRadius = RadiusA + RadiusB;

    // VO 각도 계산
    float Angle = FMath::Asin(CombinedRadius / Distance);

    // 좌우 경계 방향
    FVector2D Direction = RelativePos.GetSafeNormal();
    VO.LeftBound = Direction.GetRotated(-Angle) * (Distance / TimeHorizon);
    VO.RightBound = Direction.GetRotated(Angle) * (Distance / TimeHorizon);

    return VO;
}
```

### RVO 회피 속도 계산

```cpp
// A의 선호 속도가 VO 내부에 있으면 회피 필요
FVector2D CalculateRVOVelocity(
    const FVector2D& PreferredVelocity,
    const TArray<FVelocityObstacle>& VOs
)
{
    FVector2D BestVelocity = PreferredVelocity;
    float MinPenalty = 0.0f;

    // 후보 속도들 평가 (샘플링)
    for (float angle = 0; angle < 360.0f; angle += 15.0f)
    for (float speed = 0.0f; speed <= MaxSpeed; speed += 50.0f)
    {
        FVector2D CandidateVel = FVector2D(
            FMath::Cos(FMath::DegreesToRadians(angle)) * speed,
            FMath::Sin(FMath::DegreesToRadians(angle)) * speed
        );

        float Penalty = 0.0f;

        // 선호 속도와의 차이
        Penalty += (CandidateVel - PreferredVelocity).SizeSquared() * 0.5f;

        // 모든 VO와의 충돌 체크
        for (const FVelocityObstacle& VO : VOs)
        {
            if (IsInsideVO(CandidateVel, VO))
            {
                Penalty += 10000.0f;  // 충돌 가능 → 높은 페널티
            }
        }

        // 가장 낮은 페널티의 속도 선택
        if (Penalty < MinPenalty || angle == 0.0f)
        {
            MinPenalty = Penalty;
            BestVelocity = CandidateVel;
        }
    }

    return BestVelocity;
}
```

---

## 🎯 Mass Avoidance Processor

### UMassAvoidanceProcessor

**📂 위치**: `Engine/Plugins/AI/MassAI/Source/MassNavigation/Private/MassAvoidanceProcessors.cpp`

```cpp
UCLASS()
class UMassAvoidanceProcessor : public UMassProcessor
{
    GENERATED_BODY()

public:
    virtual void Execute(
        FMassEntityManager& EntityManager,
        FMassExecutionContext& Context
    ) override
    {
        // 1. Spatial Hash 빌드
        FMassNavigationGrid SpatialHash;
        BuildSpatialHash(EntityManager, SpatialHash);

        // 2. 모든 엔티티 병렬 처리
        EntityQuery.ForEachEntityChunk(EntityManager, Context,
            [&](FMassExecutionContext& Context)
        {
            auto Transforms = Context.GetFragmentView<FTransformFragment>();
            auto Velocities = Context.GetMutableFragmentView<FMassVelocityFragment>();
            auto Movements = Context.GetFragmentView<FMassMoveTargetFragment>();

            // 병렬 처리
            ParallelFor(Context.GetNumEntities(), [&](int32 Index)
            {
                FVector Location = Transforms[Index].GetTransform().GetLocation();
                FVector CurrentVel = Velocities[Index].Value;
                FVector TargetVel = Movements[Index].DesiredVelocity;

                // 3. 이웃 찾기
                TArray<FNeighborInfo> Neighbors;
                FindNeighbors(SpatialHash, Location, 500.0f, Neighbors);

                // 4. RVO 회피 속도 계산
                FVector AvoidanceVel = CalculateRVOAvoidance(
                    Location,
                    CurrentVel,
                    TargetVel,
                    Neighbors
                );

                // 5. 부드럽게 적용 (Steering)
                FVector SteerVel = FMath::VInterpTo(
                    CurrentVel,
                    AvoidanceVel,
                    DeltaTime,
                    SteeringSpeed
                );

                Velocities[Index].Value = SteerVel;
            });
        });
    }
};
```

---

## 🌊 Additional Avoidance Techniques

### 1. Dynamic Avoidance Weight

**상황에 따라 회피 강도 조절**

```cpp
float CalculateAvoidanceWeight(const FNeighborInfo& Neighbor)
{
    // 거리 기반 가중치 (가까울수록 높음)
    float DistanceWeight = 1.0f - (Neighbor.Distance / MaxAvoidanceRadius);

    // 접근 속도 기반 가중치 (빠르게 접근할수록 높음)
    FVector RelativeVel = MyVelocity - Neighbor.Velocity;
    FVector ToNeighbor = Neighbor.Position - MyPosition;
    float ApproachSpeed = -FVector::DotProduct(RelativeVel, ToNeighbor.GetSafeNormal());
    float SpeedWeight = FMath::Clamp(ApproachSpeed / MaxSpeed, 0.0f, 1.0f);

    // 최종 가중치
    return DistanceWeight * SpeedWeight;
}
```

### 2. Formation Preservation

**집단 대형 유지**

```cpp
// 리더를 따르는 그룹
struct FFormationGroup
{
    FMassEntityHandle Leader;
    TArray<FMassEntityHandle> Followers;
    FVector FormationOffset;  // 대형 오프셋
};

// Follower의 목표 위치
FVector CalculateFormationTarget(
    const FFormationGroup& Group,
    int32 FollowerIndex
)
{
    FVector LeaderPos = GetEntityPosition(Group.Leader);
    FVector LeaderDir = GetEntityForward(Group.Leader);

    // 대형 오프셋 적용 (예: V자 대형)
    FVector Offset = LeaderDir.RotateAngleAxis(30.0f * FollowerIndex, FVector::UpVector);
    return LeaderPos + Offset * 200.0f;
}
```

### 3. Priority-Based Avoidance

**우선순위에 따라 회피 책임 분배**

```cpp
enum class EAvoidancePriority : uint8
{
    VeryLow = 0,   // 100% 회피 (일반 NPC)
    Low = 1,       // 75% 회피
    Medium = 2,    // 50% 회피 (상호)
    High = 3,      // 25% 회피
    VeryHigh = 4   // 0% 회피 (플레이어, 중요 NPC)
};

// 우선순위 차이에 따른 회피 비율
float CalculateAvoidanceRatio(
    EAvoidancePriority MyPriority,
    EAvoidancePriority OtherPriority
)
{
    int32 PriorityDiff = (int32)MyPriority - (int32)OtherPriority;

    if (PriorityDiff > 0)
        return 0.2f;  // 우선순위 높음 → 20%만 회피
    else if (PriorityDiff < 0)
        return 0.8f;  // 우선순위 낮음 → 80% 회피
    else
        return 0.5f;  // 동일 → 50% 상호 회피
}
```

---

## 🎮 The Witcher 4 Demo - Crowd Avoidance

### 페스티벌 씬 (300명 NPC)

**시나리오**: 좁은 광장에 300명 밀집

```cpp
// Witcher 4 Avoidance Configuration
struct FWitcherAvoidanceConfig
{
    float CellSize = 200.0f;              // 2m Grid
    float MaxAvoidanceRadius = 500.0f;    // 5m 반경 이웃 체크
    int32 MaxNeighbors = 16;              // 최대 16명 이웃
    float TimeHorizon = 2.0f;             // 2초 미래 예측
    float SteeringSpeed = 5.0f;           // 부드러운 조향
};
```

### LOD별 Avoidance 전략

**High LOD (0 ~ 30m): 50~100명**

```cpp
✅ Full RVO Avoidance
✅ 16 Neighbors
✅ 2초 TimeHorizon
✅ Priority-Based Avoidance

비용: ~2ms (워커 스레드)
```

**Medium LOD (30 ~ 100m): 100~150명**

```cpp
✅ Simplified RVO
⚠️ 8 Neighbors (절반)
⚠️ 1초 TimeHorizon
❌ Priority (동일 우선순위)

비용: ~1ms
```

**Low LOD (100 ~ 500m): 50~100명**

```cpp
⚠️ Simple Separation (RVO 없음)
  - 이웃과 일정 거리 유지만
⚠️ 4 Neighbors
❌ TimeHorizon (반응형)

비용: ~0.2ms
```

### 성능 측정

```
300 NPCs Avoidance:
  - 기존 (전체 쌍 체크): 300 × 299 / 2 = 44,850 쌍
    → ~50ms (게임 스레드)

  - Mass Avoidance (Spatial Hash):
    → High: 100 × 16 = 1,600 쌍
    → Medium: 150 × 8 = 1,200 쌍
    → Low: 100 × 4 = 400 쌍
    → Total: 3,200 쌍 (~14배 감소)
    → ~3.2ms (12 워커 스레드 분산)

결론: ~15배 빠름!
```

---

## 💡 실전 예시

### 예시 1: 기본 Avoidance 설정

```cpp
// Mass Entity Config
UCLASS()
class UMyMassEntityConfig : public UMassEntityConfigAsset
{
    GENERATED_BODY()

public:
    UMyMassEntityConfig()
    {
        // Avoidance Fragment 추가
        GetConfig().AddFragment<FMassVelocityFragment>();
        GetConfig().AddFragment<FMassAvoidanceFragment>();

        // Avoidance Trait
        FMassAvoidanceParameters AvoidanceParams;
        AvoidanceParams.AvoidanceRadius = 500.0f;  // 5m
        AvoidanceParams.MaxNeighbors = 16;
        AvoidanceParams.TimeHorizon = 2.0f;

        GetConfig().AddTrait<UMassAvoidanceTrait>(AvoidanceParams);
    }
};
```

### 예시 2: 커스텀 Avoidance Processor

```cpp
UCLASS()
class UMyAvoidanceProcessor : public UMassProcessor
{
    GENERATED_BODY()

public:
    virtual void Execute(...) override
    {
        // 1. Spatial Hash
        FMassNavigationGrid Grid;
        BuildSpatialHash(EntityManager, Grid);

        // 2. Avoidance 계산
        EntityQuery.ForEachEntityChunk(..., [&](FMassExecutionContext& Context)
        {
            auto Transforms = Context.GetFragmentView<FTransformFragment>();
            auto Velocities = Context.GetMutableFragmentView<FMassVelocityFragment>();

            for (int32 i = 0; i < Context.GetNumEntities(); ++i)
            {
                // 이웃 찾기
                TArray<FNeighborInfo> Neighbors;
                Grid.FindNeighbors(Transforms[i].GetLocation(), 500.0f, Neighbors);

                // RVO 회피
                FVector AvoidVel = CalculateRVOVelocity(
                    Velocities[i].Value,
                    Neighbors
                );

                // 적용
                Velocities[i].Value = AvoidVel;
            }
        });
    }
};
```

---

## 🎯 Best Practices

### ✅ 해야 할 것

```cpp
// 1. LOD별 Avoidance 차별화
High LOD:   Full Avoidance (16 Neighbors)
Medium LOD: Simplified (8 Neighbors)
Low LOD:    Simple Separation (4 Neighbors)

// 2. Spatial Hash 사용
// → O(n²) → O(n)

// 3. TimeHorizon 조절
근거리 회피: 1~2초
원거리 회피: 0.5초 (반응형)
```

### ❌ 피해야 할 것

```cpp
// 1. 모든 엔티티 쌍 체크
// → Spatial Hash 필수!

// 2. 너무 많은 Neighbors
MaxNeighbors = 32;  // 너무 많음!
// → 16개면 충분

// 3. 매 프레임 전체 Avoidance
// → LOD에 따라 Update Frequency 조절
```

---

## 📊 성능 비교

| 방법 | 엔티티 수 | 시간 (ms) | 스케일링 |
|------|----------|----------|---------|
| **Brute Force** | 100 | 2ms | O(n²) |
| **Brute Force** | 500 | 50ms | O(n²) |
| **Spatial Hash** | 100 | 0.5ms | O(n) |
| **Spatial Hash** | 500 | 2.5ms | O(n) |
| **Spatial Hash** | 1000 | 5ms | O(n) |

---

## 🔗 References

- **Official Docs**: [Mass Movement](https://docs.unrealengine.com/5.7/en-US/mass-entity-in-unreal-engine/)
- **Source Code**: `Engine/Plugins/Runtime/MassGameplay/Source/MassMovement/`
- **Paper**: "Reciprocal Velocity Obstacles" (Van den Berg et al., 2008)
- **GDC Talk**: "The Witcher 4: Crowd Simulation at Scale"

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Mass Crowd Avoidance Deep Dive