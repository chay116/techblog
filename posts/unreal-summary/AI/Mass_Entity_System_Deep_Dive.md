---
title: "Mass Entity System (ECS) Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "AI"
tags: ["unreal", "AI"]
engine_version: "Unreal Engine 5.7"
---
# Mass Entity System (ECS) Deep Dive

## 🧭 개요

**Mass Entity**는 UE5의 ECS (Entity Component System)로, 수천~수만 개의 Entity를 효율적으로 처리합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Entity** | 고유 ID (단순 uint32) |
| **Fragment** | Data Component (위치, 속도, HP 등) |
| **Processor** | System (Movement, Combat, etc.) |
| **Archetype** | Fragment 조합 (같은 Archetype은 메모리 연속 배치) |

---

## 🏗️ ECS Architecture

```
Entity = uint32 ID

Fragments (Data-Oriented):
  - FTransformFragment { FTransform Transform; }
  - FVelocityFragment { FVector Velocity; }
  - FHealthFragment { float Health; }

Processor (System):
  - UMassMovementProcessor: Update Transform by Velocity
  - UMassCombatProcessor: Apply Damage
```

---

## 🔧 구현 예시

### Fragment 정의

```cpp
USTRUCT()
struct FTransformFragment : public FMassFragment
{
    GENERATED_BODY()
    FTransform Transform;
};

USTRUCT()
struct FVelocityFragment : public FMassFragment
{
    GENERATED_BODY()
    FVector Velocity;
};
```

### Processor 정의

```cpp
UCLASS()
class UMassMovementProcessor : public UMassProcessor
{
    GENERATED_BODY()

    virtual void ConfigureQueries() override
    {
        // Query: Entities with Transform + Velocity
        EntityQuery.AddRequirement<FTransformFragment>(EMassFragmentAccess::ReadWrite);
        EntityQuery.AddRequirement<FVelocityFragment>(EMassFragmentAccess::ReadOnly);
    }

    virtual void Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) override
    {
        // Process all matching entities
        EntityQuery.ForEachEntityChunk(EntityManager, Context, [](FMassExecutionContext& Context)
        {
            auto Transforms = Context.GetMutableFragmentView<FTransformFragment>();
            auto Velocities = Context.GetFragmentView<FVelocityFragment>();
            float DeltaTime = Context.GetDeltaTimeSeconds();

            // SIMD-friendly loop (contiguous memory)
            for (int32 i = 0; i < Context.GetNumEntities(); ++i)
            {
                Transforms[i].Transform.AddToTranslation(Velocities[i].Velocity * DeltaTime);
            }
        });
    }
};
```

---

## 🎮 사용 예시

```cpp
// Entity Spawning
FMassEntityManager& EntityManager = ...;

// Create 10,000 Entities
for (int32 i = 0; i < 10000; ++i)
{
    FMassEntityHandle Entity = EntityManager.CreateEntity(
        {FTransformFragment{}, FVelocityFragment{}, FHealthFragment{}});

    // Set Fragment Data
    EntityManager.SetFragmentValue<FTransformFragment>(Entity, FTransform(...));
    EntityManager.SetFragmentValue<FVelocityFragment>(Entity, FVector(100, 0, 0));
    EntityManager.SetFragmentValue<FHealthFragment>(Entity, 100.0f);
}

// Processors execute automatically every frame
```

---

## 📊 성능

**Mass Entity (10,000 Entities):**
- Movement Update: ~1ms (SIMD optimized)
- Traditional Tick: ~50ms

**10배+ 성능 향상!**

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Mass Entity ECS