---
title: "Ray Tracing Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "RayTracing"]
engine_version: "Unreal Engine 5.7"
---
# Ray Tracing Deep Dive

## 🧭 개요

**Hardware Ray Tracing**은 GPU의 RT Core를 사용하여 사실적인 반사, 그림자, GI를 제공합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **DXR** | DirectX Raytracing (Windows/Xbox) |
| **BVH** | Bounding Volume Hierarchy (가속 구조) |
| **Ray Generation Shader** | 광선 생성 (Primary/Secondary Rays) |
| **Hit Shader** | 광선 충돌 시 실행 |
| **Miss Shader** | 광선이 아무것도 안 맞을 때 |
| **Denoising** | 노이즈 제거 (적은 SPP 보정) |

---

## 🏗️ Ray Tracing Pipeline

```
┌─────────────────────────────────────────────────────────┐
│          Phase 1: BVH Build (Acceleration Structure)    │
├─────────────────────────────────────────────────────────┤
│  Scene Geometry → Bottom-Level AS (Per Mesh)            │
│    → Top-Level AS (Instance Transforms)                │
│                                                         │
│  GPU-driven BVH construction (Fast, 1-2ms)             │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│         Phase 2: Ray Generation (RGS)                   │
├─────────────────────────────────────────────────────────┤
│  For Each Pixel:                                        │
│    Ray = Camera → Pixel Direction                       │
│    TraceRay(Scene, Ray, Payload)                        │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│            Phase 3: Hit/Miss Shaders                    │
├─────────────────────────────────────────────────────────┤
│  Hit Shader (Closest Hit):                              │
│    - Calculate Lighting (Diffuse, Specular)             │
│    - Trace Secondary Rays (Reflection, Shadow)          │
│                                                         │
│  Miss Shader:                                           │
│    - Return Sky Color                                   │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│              Phase 4: Denoising                         │
├─────────────────────────────────────────────────────────┤
│  SVGF / Temporal Denoising:                             │
│    - 1 SPP (Sample Per Pixel) → Denoise → Clean Image  │
│    - Without Denoising: 64+ SPP needed                 │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Ray Tracing Features

### 1. Ray Traced Reflections

```cpp
// Enable RT Reflections
r.RayTracing.Reflections 1
r.RayTracing.Reflections.MaxBounces 1  ; Reflection depth
r.RayTracing.Reflections.SamplesPerPixel 1

// C++ API
FRayTracingPipelineStateInitializer Initializer;
Initializer.MaxPayloadSizeInBytes = sizeof(FReflectionPayload);
Initializer.bAllowHitGroup = true;

// Shader: Ray Generation
[shader("raygeneration")]
void ReflectionRGS()
{
    Ray = GenerateCameraRay(DispatchRaysIndex());
    FReflectionPayload Payload;
    TraceRay(SceneBVH, Ray, Payload);
    OutputTexture[DispatchRaysIndex()] = Payload.Color;
}

// Shader: Closest Hit
[shader("closesthit")]
void ReflectionCHS(inout FReflectionPayload Payload, in FRayIntersectionAttributes Attrib)
{
    // Get Material
    FMaterialData Material = GetMaterial(PrimitiveIndex);

    // Calculate Reflection
    float3 Normal = GetNormal(Attrib);
    float3 ReflectedDir = reflect(WorldRayDirection(), Normal);

    // Trace Reflection Ray
    FReflectionPayload ReflectionPayload;
    TraceRay(SceneBVH, ReflectedRay, ReflectionPayload);

    Payload.Color = Material.BaseColor * 0.5 + ReflectionPayload.Color * 0.5;
}
```

### 2. Ray Traced Shadows

```cpp
// Enable RT Shadows
r.RayTracing.Shadows 1
r.RayTracing.Shadows.SamplesPerPixel 1

// Hard Shadow (1 SPP)
bool CastShadowRay(float3 Origin, float3 LightDirection, float MaxDistance)
{
    RayDesc Ray;
    Ray.Origin = Origin + Normal * 0.01;  // Bias
    Ray.Direction = LightDirection;
    Ray.TMin = 0.0;
    Ray.TMax = MaxDistance;

    FShadowPayload Payload;
    Payload.bHit = false;

    TraceRay(SceneBVH, RAY_FLAG_ACCEPT_FIRST_HIT_AND_END_SEARCH, Ray, Payload);

    return Payload.bHit;  // true = shadowed
}

// Soft Shadow (Area Light, 4+ SPP)
float SoftShadow(float3 Origin, float3 LightPosition, float LightRadius)
{
    float Shadow = 0.0;
    const int SampleCount = 4;

    for (int i = 0; i < SampleCount; ++i)
    {
        float3 RandomOffset = RandomInUnitDisk() * LightRadius;
        float3 LightSamplePos = LightPosition + RandomOffset;

        if (!CastShadowRay(Origin, normalize(LightSamplePos - Origin), length(LightSamplePos - Origin)))
        {
            Shadow += 1.0 / SampleCount;
        }
    }

    return Shadow;
}
```

### 3. Ray Traced Global Illumination

```cpp
// Enable RT GI (Lumen with Ray Tracing)
r.Lumen.HardwareRayTracing 1
r.Lumen.HardwareRayTracing.LightingMode 2  ; Hit Lighting

// RTGI - Diffuse Indirect
float3 TraceDiffuseIndirect(float3 Origin, float3 Normal)
{
    float3 IndirectLight = 0;
    const int BounceCount = 1;

    for (int i = 0; i < BounceCount; ++i)
    {
        // Cosine-weighted Hemisphere Sampling
        float3 RandomDir = CosineSampleHemisphere(Normal);

        FGIPayload Payload;
        TraceRay(SceneBVH, Ray(Origin, RandomDir), Payload);

        IndirectLight += Payload.Radiance * Payload.Albedo;
    }

    return IndirectLight / BounceCount;
}
```

---

## 🚀 성능 최적화

### BVH Optimization

```cpp
// Static Meshes: Build once
UStaticMeshComponent* Mesh = ...;
Mesh->SetMobility(EComponentMobility::Static);  // BVH cached

// Dynamic Meshes: Rebuild every frame (expensive!)
Mesh->SetMobility(EComponentMobility::Movable);  // +2ms per mesh
```

### Ray Count Reduction

```ini
; Fewer Rays = Better Performance
r.RayTracing.Reflections.SamplesPerPixel=1  ; Instead of 4
r.RayTracing.Shadows.SamplesPerPixel=1
r.RayTracing.GlobalIllumination.SamplesPerPixel=1

; Denoising compensates for low SPP
r.RayTracing.Reflections.Denoiser=1
```

---

## 📊 성능 비교

**4K Resolution, RTX 4090:**

| Feature | Raster | Ray Tracing | Cost |
|---------|--------|-------------|------|
| **Reflections** | SSR (2ms) | RT (5ms) | +3ms |
| **Shadows** | Shadow Maps (3ms) | RT (8ms) | +5ms |
| **GI** | Lumen Software (10ms) | Lumen HW RT (6ms) | -4ms (faster!) |

---

## 🔗 참고 자료

**소스:**
- `Renderer/Private/RayTracing/`
- `Shaders/Private/RayTracing/`

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Ray Tracing
  - DXR Pipeline (BVH/RGS/Hit/Miss)
  - RT Reflections, Shadows, GI
  - Denoising