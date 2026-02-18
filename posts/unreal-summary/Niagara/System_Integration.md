---
title: "System Integration (시스템 통합)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# System Integration (시스템 통합)

## 🧭 개요

Niagara는 Unreal Engine의 다양한 시스템과 **깊은 통합**을 제공하여 복잡한 게임플레이 이펙트를 구현합니다.

**핵심 통합 영역:**
- **Chaos Physics**: 물리 시뮬레이션과 상호작용
- **SkeletalMesh**: 캐릭터 애니메이션 기반 이펙트
- **Landscape**: 지형 데이터 활용
- **World Partition**: 대규모 오픈월드 지원
- **Sequencer**: 시네마틱 통합
- **MetaHuman**: 페이셜 이펙트

---

## 🧱 Chaos Physics 통합

### 1. **Chaos Field System**

**개념:**

Chaos Field는 Niagara 파티클에 물리 힘(Force Field)을 적용합니다.

**구조:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Chaos Field System                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Field Actor (레벨 배치)                                                 │
│    │                                                                     │
│    ├─ Field Component                                                   │
│    │    ├─ FieldType: Force (힘)                                        │
│    │    ├─ FieldType: LinearVelocity (속도)                             │
│    │    └─ FieldType: AngularVelocity (회전)                            │
│    │                                                                     │
│    ▼                                                                     │
│  DataInterface: NiagaraDataInterfaceFieldSystem                         │
│    │                                                                     │
│    ├─ SampleFieldVector(Position) → Force                               │
│    ├─ SampleFieldFloat(Position) → Magnitude                            │
│    └─ ApplyToParticle(Velocity, Force, DeltaTime)                       │
│                                                                         │
│  Niagara System                                                         │
│    └─ Module: Apply Field Force                                         │
│         └─ Particles.Velocity += FieldForce * DeltaTime                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**사용 예시:**

```cpp
// Niagara Script: Apply Chaos Field
Map Get {
    // Field Force 샘플링
    float3 FieldForce = FieldSystemDI.SampleFieldVector(Particles.Position,
                                                         EFieldPhysicsType::Field_LinearForce);

    // 파티클 속도에 적용
    Particles.Velocity += FieldForce * DeltaTime * FieldStrength;
}
```

### 2. **Rigid Body Collision**

**NiagaraDataInterfacePhysicsAsset:**

```cpp
// PhysicsAsset에서 충돌 감지
UPROPERTY(EditAnywhere, Category = "Physics")
UPhysicsAsset* PhysicsAsset;

// Module: Collide with PhysicsAsset
Map Get {
    // Capsule/Sphere/Box Primitive와 충돌 검사
    FNiagaraCollisionEventPayload CollisionInfo =
        PhysicsAssetDI.PerformCollisionQuery(Particles.Position,
                                              Particles.Velocity,
                                              ParticleRadius);

    if (CollisionInfo.bIsValid)
    {
        // 충돌 응답
        Particles.Velocity = reflect(Particles.Velocity, CollisionInfo.Normal) * Restitution;
        Particles.Position = CollisionInfo.HitPosition;
    }
}
```

---

## 💡 SkeletalMesh 통합

### 1. **Skeletal Mesh DataInterface**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceSkeletalMesh.h`

**기능:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│              UNiagaraDataInterfaceSkeletalMesh                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Sampling Modes:                                                        │
│    ├─ Vertices: 버텍스 위치/노멀 샘플링                                  │
│    ├─ Triangles: 삼각형 표면 샘플링                                     │
│    ├─ Bones: 본 Transform 가져오기                                      │
│    └─ Sockets: Socket 위치/회전 가져오기                                 │
│                                                                         │
│  주요 함수:                                                              │
│    + GetSkinnedVertexPosition(VertexID) → FVector                       │
│    + GetSkinnedTrianglePosition(TriID, BaryCoord) → FVector            │
│    + GetSkinnedBoneTransform(BoneID) → FTransform                       │
│    + GetSocketTransform(SocketName) → FTransform                        │
│                                                                         │
│  GPU Support:                                                           │
│    - GPU Skinning Data Buffer (Read-Only)                              │
│    - Bone Matrix Buffer                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**실전 예시: 검격 Trail**

```cpp
// Emitter: Sword Trail
// DataInterface: SkeletalMeshDI → 캐릭터 메시 참조

// Spawn Script: Socket 위치에서 Spawn
Map Get {
    // Socket "Weapon_Tip" 위치
    FVector TipPosition = SkeletalMeshDI.GetSocketPosition("Weapon_Tip");
    FVector BasePosition = SkeletalMeshDI.GetSocketPosition("Weapon_Base");

    // Trail 파티클 Spawn
    Particles.Position = lerp(BasePosition, TipPosition, SpawnAlpha);
    Particles.PreviousPosition = Particles.Position;  // 이전 프레임
}

// Update Script: Ribbon 연결
Map Get {
    // Ribbon Renderer가 자동으로 연결
}
```

### 2. **Vertex Animation Texture (VAT)**

캐릭터 애니메이션을 Texture에 Bake하여 GPU에서 재생:

```cpp
// Module: Sample VAT
Map Get {
    // Animation Texture 샘플링
    float AnimTime = Particles.NormalizedAge;
    float2 UV = float2(VertexID / NumVertices, AnimTime);

    FVector VertexPosition = VATTexture.SampleLevel(UV, 0).xyz;

    // 파티클 위치에 적용
    Particles.Position = MeshToWorld.TransformPosition(VertexPosition);
}
```

---

## 🧩 Landscape 통합

### 1. **Landscape DataInterface**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceLandscape.h`

```cpp
UCLASS()
class UNiagaraDataInterfaceLandscape : public UNiagaraDataInterface
{
public:
    // Height Map 샘플링
    NIAGARA_API float GetHeight(FVector2D Position);

    // Normal 가져오기
    NIAGARA_API FVector GetNormal(FVector2D Position);

    // Physical Material
    NIAGARA_API UPhysicalMaterial* GetPhysicalMaterial(FVector2D Position);
};
```

**사용 예시: 지형 기반 먼지 이펙트**

```cpp
// Module: Spawn on Landscape
Map Get {
    // 랜덤 2D 위치
    float2 RandomPos = float2(rand(), rand()) * LandscapeSize;

    // Height 가져오기
    float Height = LandscapeDI.GetHeight(RandomPos);

    // 3D 위치 생성
    Particles.Position = float3(RandomPos.x, RandomPos.y, Height);

    // Normal 방향으로 Offset
    float3 Normal = LandscapeDI.GetNormal(RandomPos);
    Particles.Position += Normal * SpawnOffset;

    // Physical Material에 따라 색상 변경
    UPhysicalMaterial* PhysMat = LandscapeDI.GetPhysicalMaterial(RandomPos);
    if (PhysMat->SurfaceType == SurfaceType_Grass)
    {
        Particles.Color = GreenColor;
    }
    else if (PhysMat->SurfaceType == SurfaceType_Sand)
    {
        Particles.Color = YellowColor;
    }
}
```

---

## 🔗 World Partition 통합

### 대규모 오픈월드 지원

**문제:**

- 거대한 맵에서 모든 Niagara System 활성화 → 메모리/성능 문제
- Streaming Level에 배치된 System 관리

**해결:**

```cpp
// UNiagaraComponent::UpdateComponentToWorld
// World Partition Grid에 따라 자동 Activation/Deactivation

if (bAutoActivate && WorldPartition->IsLocationInLoadedCell(GetComponentLocation()))
{
    Activate();
}
else
{
    Deactivate();
}

// Significance Manager 통합
FNiagaraSignificanceHandler::Update(Component, ViewLocation, ViewDirection);
```

**설정:**

```cpp
// NiagaraSystem Settings
UPROPERTY(EditAnywhere, Category = "Scalability")
float MaxSignificance = 1.0f;  // 0 = 먼, 1 = 가까움

// Significance에 따라 LOD/Culling 자동 조정
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. SkeletalMesh DI 과다 사용:**
```cpp
// ❌ 100개 파티클이 각각 Skinned Mesh 샘플링
Map Get {
    for (int i = 0; i < 100; ++i)
    {
        Position[i] = SkeletalMeshDI.GetSkinnedVertexPosition(i);
    }
}
// → CPU 병목 (Skinning은 비쌈)
```

**2. 매 프레임 Landscape 샘플링:**
```cpp
// ❌ 모든 파티클이 매 프레임 Landscape 쿼리
Map Get {
    Height = LandscapeDI.GetHeight(Particles.Position.xy);
}
// → Landscape Lookup 오버헤드
```

**3. World Partition 없이 대규모 맵:**
```cpp
// ❌ 10km × 10km 맵에 수백 개 System 항상 활성화
// → 메모리 수 GB, FPS < 10
```

### ✅ 올바른 방법

**1. GPU Skinning 활용:**
```cpp
// ✅ GPU에서 SkeletalMesh 샘플링
// Emitter Settings: SimulationTarget = GPUComputeSim
// SkeletalMeshDI는 GPU Bone Buffer 제공
```

**2. Height 캐싱:**
```cpp
// ✅ Spawn 시 한 번만 샘플링
Map Spawn {
    Particles.GroundHeight = LandscapeDI.GetHeight(Particles.Position.xy);
}

// Update에서는 캐시된 값 사용
Map Update {
    Particles.Position.z = Particles.GroundHeight;
}
```

**3. World Partition + Significance:**
```cpp
// ✅ World Partition 활성화
// ✅ Significance Manager로 거리별 LOD
// ✅ Culling Distance 설정
```

---

## 🔗 참조 자료

**소스 파일:**
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceSkeletalMesh.h` - SkeletalMesh DI
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceLandscape.h` - Landscape DI
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraDataInterfacePhysicsAsset.h` - PhysicsAsset DI

**관련 문서:**
- [Collision_System.md](Collision_System.md) - 충돌 시스템 상세
- [EffectType_and_Scalability.md](EffectType_and_Scalability.md) - Significance Manager
- [DataInterface_System.md](DataInterface_System.md) - DataInterface 개요

**외부 자료:**
- Chaos Physics Documentation
- World Partition User Guide
- Sequencer Integration Guide

---

> 🔄 작성: 2025-11-22 — Niagara 시스템 통합 가이드
