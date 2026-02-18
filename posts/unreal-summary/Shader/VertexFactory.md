---
title: "Vertex Factory 시스템"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Vertex Factory 시스템

## 🧭 개요 (Overview)

**Vertex Factory**는 다양한 메시 타입(Static Mesh, Skeletal Mesh, Particle 등)의 **버텍스 데이터를 추상화**하는 시스템입니다. 이를 통해 동일한 Material Shader가 다양한 메시 타입에서 작동할 수 있습니다.

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/VertexFactory.h`

---

## 🧱 구조 (Structure)

### Vertex Factory 계층 구조

```
FVertexFactoryType (추상 인터페이스)
         ▲
         │
    ┌────┴────┬────────────┬─────────────┐
    │         │            │             │
FLocalVF  FGPUSkinVF  FNiagaraSpriteVF  FLandscapeVF
(Static)  (Skeletal)  (Particle)        (Terrain)
```

**소스 검증:**

```cpp
// VertexFactory.h:134-149
enum class EVertexFactoryFlags : uint32
{
    None                                  = 0u,
    UsedWithMaterials                     = 1u << 1,
    SupportsStaticLighting                = 1u << 2,
    SupportsDynamicLighting               = 1u << 3,
    SupportsPrecisePrevWorldPos           = 1u << 4,
    SupportsPositionOnly                  = 1u << 5,
    SupportsCachingMeshDrawCommands       = 1u << 6,
    SupportsPrimitiveIdStream             = 1u << 7,
    SupportsNaniteRendering               = 1u << 8,
    SupportsRayTracing                    = 1u << 9,
    // ...
};
```

---

## 💡 주요 Vertex Factory 타입

| Vertex Factory            | 메시 타입        | 버텍스 데이터                         |
|--------------------------|---------------- |-------------------------------------|
| **FLocalVertexFactory**  | Static Mesh     | Position, Normal, Tangent, UV, Color |
| **FGPUSkinVertexFactory**| Skeletal Mesh   | + Bone Index[4], Bone Weight[4]     |
| **FNiagaraSpriteVF**     | Particle System | Position, Size, Rotation, Color     |
| **FLandscapeVertexFactory** | Landscape    | Height Map, LOD Data                |

---

## 🔗 참고 자료 (References)

### 소스 코드
- `Engine/Source/Runtime/RenderCore/Public/VertexFactory.h`
- `Engine/Source/Runtime/Engine/Public/LocalVertexFactory.h`
- `Engine/Source/Runtime/Engine/Public/GPUSkinVertexFactory.h`

---

> 🔄 **작성일**: 2025-01-04
> 📝 **문서 버전**: v1.0 (간략 버전)
> ✅ **소스 검증**: UE 5.6 Release
