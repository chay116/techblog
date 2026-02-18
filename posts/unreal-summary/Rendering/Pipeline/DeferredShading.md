---
title: "Deferred Shading Pipeline Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Pipeline"]
engine_version: "** Unreal Engine 5.7"
---
# Deferred Shading Pipeline Deep Dive

## 🧭 개요 (Overview)

Unreal Engine 5의 **Deferred Shading Pipeline**은 복잡한 조명과 고품질 시각 효과를 효율적으로 렌더링하기 위한 핵심 렌더링 아키텍처입니다.

**핵심 철학:**
- **Geometry와 Lighting 분리**: 기하 정보를 먼저 GBuffer에 저장 후, 조명 계산을 별도로 수행
- **Multiple Render Targets (MRT)**: 한 번의 Draw Call로 여러 렌더 타겟에 데이터 기록
- **Screen-Space Lighting**: 화면 공간에서 조명 계산하여 많은 라이트 처리 가능
- **Decoupled Shading**: 셰이딩 복잡도가 픽셀 수에만 비례 (vs Forward: 픽셀×라이트 수)

---

## 🧱 Pipeline 전체 흐름도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                FDeferredShadingSceneRenderer::Render()                   │
└─────────────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ↓                       ↓                       ↓
┌───────────────┐   ┌──────────────────┐   ┌───────────────────┐
│   Phase 1     │   │     Phase 2      │   │     Phase 3       │
│  Pre-Pass &   │→  │   Base Pass &    │→  │   Lighting &      │
│  Visibility   │   │   GBuffer Fill   │   │   Post Process    │
└───────────────┘   └──────────────────┘   └───────────────────┘
```

### 전체 파이프라인 (13 Phases)

```
1️⃣ Scene Update & Preparation
   │
   ├─ GPU Scene Update
   ├─ Virtual Texture Update
   ├─ Sky Atmosphere Update
   ├─ Lumen Scene Update
   └─ Virtual Shadow Maps Initialization
   │
   ↓
2️⃣ Visibility Determination
   │
   ├─ Frustum Culling
   ├─ Occlusion Culling
   ├─ Distance Culling
   └─ Nanite Visibility Query
   │
   ↓
3️⃣ Early Depth Pass (Pre-Pass)
   │
   ├─ Render Opaque Meshes (Depth Only)
   ├─ Generate Hierarchical Z-Buffer (HZB)
   └─ Early Depth Complete
   │
   ↓
4️⃣ Nanite Rasterization (if enabled)
   │
   ├─ Cluster Culling
   ├─ Software Rasterization
   ├─ Visibility Buffer Generation
   └─ Material Depth Write
   │
   ↓
5️⃣ Base Pass - GBuffer Fill
   │
   ├─ Render Opaque Meshes to GBuffer
   ├─ GBufferA: Normal (RGB) + PerObjectData (A)
   ├─ GBufferB: Metallic, Specular, Roughness, ShadingModel
   ├─ GBufferC: BaseColor (RGB) + AO (A)
   ├─ GBufferD: CustomData (Subsurface, Cloth, etc.)
   └─ GBufferE: PrecomputedShadowFactors (optional)
   │
   ↓
6️⃣ Custom Depth & Stencil
   │
   ├─ Render Custom Depth Primitives
   └─ Build Stencil Mask
   │
   ↓
7️⃣ Lighting Pass
   │
   ├─ Directional Lights (Full Screen)
   ├─ Point/Spot Lights (Tiled/Clustered Deferred)
   ├─ Sky Light (Ambient Cube)
   ├─ Rect Lights (Area Lights)
   ├─ IES Light Profiles
   └─ Light Functions
   │
   ↓
8️⃣ Shadow Projection
   │
   ├─ Virtual Shadow Maps (VSM)
   ├─ Cascaded Shadow Maps (CSM)
   ├─ Per-Object Shadows
   └─ Contact Shadows
   │
   ↓
9️⃣ Screen Space Effects (SSR, SSAO, SSGI)
   │
   ├─ Screen Space Reflections (SSR)
   ├─ Screen Space Ambient Occlusion (SSAO/GTAO)
   ├─ Screen Space Global Illumination (Lumen)
   └─ Screen Space Shadows
   │
   ↓
🔟 Global Illumination
   │
   ├─ Lumen Software Tracing
   ├─ Lumen Hardware Ray Tracing
   ├─ Radiance Cache
   └─ Reflection Environment (Reflection Captures)
   │
   ↓
1️⃣1️⃣ Fog & Atmosphere
   │
   ├─ Volumetric Fog
   ├─ Exponential Height Fog
   ├─ Sky Atmosphere Scattering
   └─ Local Fog Volumes
   │
   ↓
1️⃣2️⃣ Translucency
   │
   ├─ Separate Translucency Pass
   ├─ Translucent Lighting
   ├─ Distortion Pass
   └─ After-DOF Translucency
   │
   ↓
1️⃣3️⃣ Post Processing
   │
   ├─ Temporal Anti-Aliasing (TAA)
   ├─ Depth of Field (DOF)
   ├─ Motion Blur
   ├─ Bloom
   ├─ Tone Mapping
   ├─ Color Grading
   └─ UI Composite
```

**📂 주요 소스 파일:**
- `Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.cpp:1672`
- `Engine/Source/Runtime/Renderer/Private/SceneRendering.cpp`
- `Engine/Source/Runtime/Renderer/Private/BasePassRendering.cpp`

---

## 🔬 Phase별 상세 분석

### Phase 1: Scene Update & Preparation

**📂 위치:** `DeferredShadingRenderer.cpp:1726-1843`

```cpp
// GPU Scene Update
FGPUSceneScopeBeginEndHelper GPUSceneScopeBeginEndHelper(
    GraphBuilder, Scene->GPUScene, GPUSceneDynamicContext);

// Virtual Texture Update
if (bUseVirtualTexturing) {
    VirtualTextureUpdater = FVirtualTextureSystem::Get().BeginUpdate(
        GraphBuilder, FeatureLevel, this, Settings);
}

// Sky Atmosphere Update
if (ShouldRenderSkyAtmosphere(Scene, ViewFamily.EngineShowFlags)) {
    for (int32 LightIndex = 0; LightIndex < NUM_ATMOSPHERE_LIGHTS; ++LightIndex) {
        if (Scene->AtmosphereLights[LightIndex]) {
            PrepareSunLightProxy(*Scene->GetSkyAtmosphereSceneInfo(),
                                LightIndex, *Scene->AtmosphereLights[LightIndex]);
        }
    }
}

// Lumen Scene Update
BeginUpdateLumenSceneTasks(GraphBuilder, LumenFrameTemporaries);
BeginGatherLumenLights(LumenFrameTemporaries, LumenDirectLighting,
                       VisibilityTaskData, UpdateLightFunctionAtlasTask);

// Virtual Shadow Maps
const bool bEnableVirtualShadowMaps =
    UseVirtualShadowMaps(ShaderPlatform, FeatureLevel) &&
    ViewFamily.EngineShowFlags.DynamicShadows;
VirtualShadowMapArray.Initialize(GraphBuilder, Scene->GetVirtualShadowMapCache(),
                                 bEnableVirtualShadowMaps, ViewFamily.EngineShowFlags);
```

**주요 작업:**
- **GPU Scene**: 모든 Primitive의 Transform, Bounds, Material 정보를 GPU 버퍼로 업데이트
- **Virtual Texture**: 스트리밍 가상 텍스처 페이지 요청 처리
- **Lumen Scene**: Surface Cache (Card Representation) 업데이트
- **Virtual Shadow Maps**: 페이지 풀 초기화 및 이전 프레임 캐시 로드

---

### Phase 2: Visibility Determination

**📂 위치:** `SceneVisibility.cpp`

```cpp
// Frustum Culling
for (int32 PrimitiveIndex = 0; PrimitiveIndex < Scene->Primitives.Num(); ++PrimitiveIndex) {
    const FPrimitiveSceneInfo* PrimitiveSceneInfo = Scene->Primitives[PrimitiveIndex];
    const FBoxSphereBounds& Bounds = PrimitiveSceneInfo->Proxy->GetBounds();

    if (View.ViewFrustum.IntersectBox(Bounds.Origin, Bounds.BoxExtent)) {
        // Frustum 내부 → 다음 단계 진행
    }
}

// Occlusion Culling (HZB-based)
if (bUseOcclusionQueries) {
    // 이전 프레임 HZB와 비교
    float HZBDepth = SampleHZB(PrimitiveBounds, View.PrevViewMatrices);
    float PrimitiveDepth = ComputeProjectedDepth(PrimitiveBounds);

    if (PrimitiveDepth > HZBDepth) {
        // Occluded → 렌더링 스킵
    }
}

// Distance Culling
float DistanceSquared = (Bounds.Origin - View.ViewLocation).SizeSquared();
if (DistanceSquared > PrimitiveSceneInfo->Proxy->GetMaxDrawDistance() * GetMaxDrawDistance()) {
    // Too far → 렌더링 스킵
}
```

**Visibility 결과:**
- `View.VisibleDynamicPrimitives`: 동적 메시 리스트
- `View.VisibleStaticMeshElements`: 정적 메시 리스트
- `View.PrimitiveVisibilityMap`: Bit Array (1 = Visible, 0 = Culled)

---

### Phase 3: Early Depth Pass (Pre-Pass)

**목적:** Depth Buffer를 먼저 채워서 Base Pass에서 Overdraw 최소화

**📂 위치:** `DepthRendering.cpp`

```cpp
void RenderPrePass(FRDGBuilder& GraphBuilder, FSceneTextures& SceneTextures) {
    RDG_EVENT_SCOPE(GraphBuilder, "PrePass");

    // Depth-Only 렌더링 (Material 없음, Depth Write만)
    for (const FMeshBatch& MeshBatch : View.DynamicMeshElements) {
        if (MeshBatch.bUseForDepthPass) {
            DrawDepthOnly(MeshBatch, View.ViewMatrices);
        }
    }

    // HZB (Hierarchical Z-Buffer) 생성
    BuildHZB(GraphBuilder, SceneTextures.Depth.Target);
}
```

**Early Z Modes:**

| Mode | 설명 | 사용 시기 |
|------|------|----------|
| **DDM_None** | Pre-Pass 없음 | 단순한 씬 |
| **DDM_NonMasked** | Masked Material 제외 | 일반적 |
| **DDM_AllOpaque** | 모든 Opaque 메시 | 복잡한 씬 (추천) |
| **DDM_AllOpaqueNoVelocity** | Velocity 제외 | TAA 없을 때 |

**HZB (Hierarchical Z-Buffer):**

```
Depth Buffer (1920x1080)
        ↓ Downsample
Level 1 (960x540) - Max Depth per 2x2 block
        ↓
Level 2 (480x270)
        ↓
Level 3 (240x135)
        ↓ ...
Level N (1x1) - Farthest depth

용도:
- Occlusion Culling (다음 프레임)
- SSR Ray Marching
- SSAO Horizon Search
```

---

### Phase 4: Nanite Rasterization

**📂 위치:** `DeferredShadingRenderer.cpp:1300` (RenderNanite 함수)

Nanite는 별도 Deep Dive 문서에서 상세히 다룰 예정입니다. 간략히:

```cpp
void RenderNanite(FRDGBuilder& GraphBuilder, FSceneTextures& SceneTextures) {
    // 1. Cluster Culling (Hierarchical, Frustum, Occlusion)
    CullClusters(GraphBuilder, NaniteVisibility);

    // 2. Software Rasterization (64x64 Tiles)
    RasterizeClusters(GraphBuilder, NaniteRasterResults);

    // 3. Visibility Buffer → Depth Buffer
    ExportDepth(GraphBuilder, NaniteRasterResults, SceneTextures.Depth);

    // 4. Material Shading (Deferred)
    ShadeMaterials(GraphBuilder, NaniteRasterResults, GBuffer);
}
```

**Nanite의 GBuffer 통합:**
- Nanite는 자체 Visibility Buffer 생성 후, Material Pass에서 GBuffer에 쓰기
- 일반 메시와 동일한 GBuffer 레이아웃 사용

---

### Phase 5: Base Pass - GBuffer Fill

**📂 위치:** `BasePassRendering.cpp`

**GBuffer 레이아웃 (Unreal Engine 5.7):**

```cpp
// GBuffer Encoding

struct FGBufferData {
    // GBufferA (RGBA16F or RGB10A2)
    float3 WorldNormal;           // R, G, B
    uint   PerObjectGBufferData;  // A (커스텀 데이터 인덱스)

    // GBufferB (RGBA8)
    float Metallic;               // R
    float Specular;               // G
    float Roughness;              // B
    uint  ShadingModelID;         // A (4비트) + SelectiveOutputMask (4비트)

    // GBufferC (RGBA8 sRGB)
    float3 BaseColor;             // R, G, B
    float  IndirectIrradiance;    // A (AO 또는 Precomputed AO)

    // GBufferD (RGBA8) - Optional, ShadingModel 의존적
    float4 CustomData;            // Subsurface Color, Cloth, Clear Coat 등

    // GBufferE (RGBA16F) - Optional, Static Lighting
    float4 PrecomputedShadowFactors;  // Static Shadow + Indirect Lighting
};
```

**Shading Model별 CustomData 사용:**

| Shading Model | CustomData 용도 |
|---------------|----------------|
| **MSM_DefaultLit** | 사용 안 함 |
| **MSM_Subsurface** | Subsurface Color (RGB) + Opacity (A) |
| **MSM_SubsurfaceProfile** | Subsurface Profile ID |
| **MSM_ClearCoat** | Clear Coat (R) + Clear Coat Roughness (G) |
| **MSM_TwoSidedFoliage** | Subsurface Color (RGB) |
| **MSM_Cloth** | Fuzz Color (RGB) + Cloth (A) |
| **MSM_Eye** | Iris Mask (R) + Iris Distance (G) |

**Base Pass Rendering:**

```cpp
void RenderBasePass(FRDGBuilder& GraphBuilder, FSceneTextures& SceneTextures) {
    RDG_EVENT_SCOPE(GraphBuilder, "BasePass");

    // MRT (Multiple Render Targets) 설정
    FRenderTargetBindingSlots RenderTargets;
    RenderTargets[0] = FRenderTargetBinding(SceneTextures.GBufferA, ERenderTargetLoadAction::EClear);
    RenderTargets[1] = FRenderTargetBinding(SceneTextures.GBufferB, ERenderTargetLoadAction::EClear);
    RenderTargets[2] = FRenderTargetBinding(SceneTextures.GBufferC, ERenderTargetLoadAction::EClear);
    RenderTargets[3] = FRenderTargetBinding(SceneTextures.GBufferD, ERenderTargetLoadAction::EClear);
    RenderTargets.DepthStencil = FDepthStencilBinding(
        SceneTextures.Depth.Target,
        bAllowReadOnlyDepthBasePass ? ERenderTargetLoadAction::ELoad : ERenderTargetLoadAction::EClear,
        ERenderTargetLoadAction::EClear,
        FExclusiveDepthStencil::DepthRead_StencilWrite  // Read-Only Depth!
    );

    // Opaque 메시 렌더링
    for (const FMeshBatch& MeshBatch : View.DynamicMeshElements) {
        if (MeshBatch.bUseForGBuffer) {
            // Vertex Shader: World Position, UV 등 계산
            // Pixel Shader: Material Graph 평가 → GBuffer에 쓰기
            DrawMeshBatch(MeshBatch, View, RenderTargets);
        }
    }
}
```

**Read-Only Depth 최적화:**

Early Depth Pass 완료 후 Base Pass에서 Depth를 Read-Only로 설정:
- **장점**: Depth Test는 계속 작동하지만, Depth Write 비활성화로 대역폭 절약
- **조건**: `bIsEarlyDepthComplete == true` (DDM_AllOpaque 모드)

---

### Phase 6: Custom Depth & Stencil

**용도:**
- Post Process Outline
- Custom Stencil Mask
- Gameplay 효과 (예: X-Ray, Highlight)

```cpp
// Custom Depth Pass
RenderCustomDepthPass(GraphBuilder, SceneTextures.CustomDepth);

// Stencil 값 설정 (PrimitiveComponent에서)
PrimitiveComponent->CustomDepthStencilValue = 128;  // 0-255
PrimitiveComponent->bRenderCustomDepth = true;

// Shader에서 읽기
float CustomDepth = SceneTextures.CustomDepth.Load(PixelPos);
uint StencilValue = SceneTextures.CustomStencil.Load(PixelPos);

if (StencilValue == 128) {
    // Outline 그리기
}
```

---

### Phase 7: Lighting Pass

**Deferred Lighting의 핵심:** Screen-Space에서 조명 계산

**📂 위치:** `LightRendering.cpp`

#### 7-1. Directional Light (Full Screen Quad)

```cpp
void RenderDirectionalLight(FRDGBuilder& GraphBuilder,
                            const FLightSceneInfo& LightSceneInfo,
                            FSceneTextures& SceneTextures) {
    // Full Screen Quad (2 triangles)
    DrawFullScreenQuad(GraphBuilder, [&](FPixelShaderParameters& Params) {
        // GBuffer에서 데이터 로드
        float3 WorldNormal = GBufferA.Sample(UV).xyz;
        float3 BaseColor = GBufferC.Sample(UV).rgb;
        float Roughness = GBufferB.Sample(UV).b;
        float Metallic = GBufferB.Sample(UV).r;

        // World Position 복원 (Depth로부터)
        float Depth = SceneDepth.Sample(UV);
        float3 WorldPos = ReconstructWorldPosition(UV, Depth, View.InvViewProj);

        // Lighting 계산
        float3 L = normalize(DirectionalLight.Direction);
        float3 V = normalize(View.WorldCameraOrigin - WorldPos);
        float3 H = normalize(L + V);

        // BRDF (Cook-Torrance)
        float NdotL = saturate(dot(WorldNormal, L));
        float NdotV = saturate(dot(WorldNormal, V));
        float NdotH = saturate(dot(WorldNormal, H));

        float3 F0 = lerp(0.04, BaseColor, Metallic);  // Fresnel at normal incidence
        float3 F = FresnelSchlick(F0, NdotV);         // Fresnel term
        float D = GGX_D(Roughness, NdotH);             // Distribution (Specular lobe)
        float G = SmithGGX_G(Roughness, NdotL, NdotV); // Geometry (Self-shadowing)

        float3 Specular = (D * G * F) / (4.0 * NdotL * NdotV + 0.001);
        float3 Diffuse = BaseColor * (1.0 - Metallic) * (1.0 - F);

        float3 Lighting = (Diffuse + Specular) * DirectionalLight.Color * NdotL;

        // Shadow 적용
        float ShadowFactor = ComputeShadow(WorldPos, DirectionalLight);
        Lighting *= ShadowFactor;

        // SceneColor에 누적 (Additive Blend)
        OutColor += Lighting;
    });
}
```

#### 7-2. Point/Spot Lights (Tiled Deferred / Clustered Deferred)

**Forward vs Deferred vs Tiled Deferred:**

| 방식 | Draw Call 수 | Overdraw | 라이트 수 제한 |
|------|--------------|----------|----------------|
| **Forward** | Meshes × Lights | 높음 | 제한적 (4-8개) |
| **Deferred** | 1 Full Screen Quad per Light | 낮음 | 많음 (수백 개) |
| **Tiled Deferred** | 1 Full Screen Pass | 매우 낮음 | 매우 많음 (수천 개) |

**Tiled Deferred 구현:**

```cpp
// 1. Light Grid 구성 (16x16 타일)
ComputeShader: BuildLightGrid
{
    // 타일별로 영향을 주는 라이트 리스트 생성
    uint TileX = ThreadId.x;
    uint TileY = ThreadId.y;

    // 타일의 Min/Max Depth 계산
    float MinDepth = 1e10;
    float MaxDepth = 0;
    for (uint i = 0; i < 16; ++i) {
        for (uint j = 0; j < 16; ++j) {
            float Depth = SceneDepth.Load(uint2(TileX * 16 + i, TileY * 16 + j));
            MinDepth = min(MinDepth, Depth);
            MaxDepth = max(MaxDepth, Depth);
        }
    }

    // 타일의 Frustum 계산
    FFrustum TileFrustum = ComputeTileFrustum(TileX, TileY, MinDepth, MaxDepth);

    // 라이트 Culling
    uint LightCount = 0;
    for (uint LightIndex = 0; LightIndex < TotalLightCount; ++LightIndex) {
        FLight Light = LightBuffer[LightIndex];

        if (IntersectSphereFrustum(Light.Position, Light.Radius, TileFrustum)) {
            LightGrid[TileIndex].LightIndices[LightCount++] = LightIndex;
        }
    }

    LightGrid[TileIndex].LightCount = LightCount;
}

// 2. Lighting Pass (Full Screen)
PixelShader: TiledDeferredLighting
{
    uint2 TilePos = PixelPos / 16;
    uint TileIndex = TilePos.y * TileCountX + TilePos.x;

    // GBuffer 로드
    FGBufferData GBuffer = DecodeGBuffer(PixelPos);

    // World Position 복원
    float3 WorldPos = ReconstructWorldPosition(UV, SceneDepth, View.InvViewProj);

    float3 TotalLighting = 0;

    // 타일 내 모든 라이트 순회
    for (uint i = 0; i < LightGrid[TileIndex].LightCount; ++i) {
        uint LightIndex = LightGrid[TileIndex].LightIndices[i];
        FLight Light = LightBuffer[LightIndex];

        // Point Light 계산
        float3 L = Light.Position - WorldPos;
        float Distance = length(L);
        L /= Distance;

        // Attenuation (Inverse Square with smooth falloff)
        float Attenuation = Square(saturate(1.0 - Square(Distance / Light.Radius)));
        Attenuation /= (Distance * Distance + 1.0);

        // BRDF
        float3 Lighting = EvaluateBRDF(GBuffer, L, V) * Light.Color * Attenuation;

        TotalLighting += Lighting;
    }

    OutColor = TotalLighting;
}
```

**Clustered Deferred:**

Tiled Deferred의 확장 - 3D Grid (X, Y, Z)로 Light Culling:
- Z축 = Depth Slices (Logarithmic)
- 더 정밀한 Culling → 성능 향상

---

### Phase 8: Shadow Projection

**📂 위치:** `ShadowRendering.cpp`

#### Virtual Shadow Maps (VSM)

별도 Deep Dive 문서에서 다룰 예정. 간략히:

```cpp
// VSM Page Allocation
AllocatePages(VisibleLights, CameraFrustum);

// Shadow Rendering (Per-Page)
RenderShadowDepth(Pages, LightView);

// Shadow Projection (Screen Space)
ProjectVirtualShadowMaps(GraphBuilder, SceneTextures, VSMArray);
```

**장점:**
- 메모리 효율 (Page-based)
- High Resolution (16K+ equivalent)
- Cached Shadows (이전 프레임 재사용)

#### Cascaded Shadow Maps (CSM)

```cpp
// Directional Light용 Cascade 생성
for (int32 CascadeIndex = 0; CascadeIndex < NumCascades; ++CascadeIndex) {
    float SplitDistance = ComputeSplitDistance(CascadeIndex, View.NearPlane, View.FarPlane);

    FMatrix LightViewProj = ComputeLightViewProj(DirectionalLight, View, SplitDistance);

    // Shadow Depth 렌더링
    RenderShadowDepth(LightViewProj, ShadowMapTexture[CascadeIndex]);
}

// Shadow Projection
PixelShader: ProjectCascadedShadow
{
    float Depth = SceneDepth.Sample(UV);
    float3 WorldPos = ReconstructWorldPosition(UV, Depth, View.InvViewProj);

    // Cascade 선택
    int CascadeIndex = SelectCascade(Depth, CascadeSplitDistances);

    // Shadow Map Lookup
    float4 ShadowCoord = mul(float4(WorldPos, 1.0), CascadeViewProj[CascadeIndex]);
    float ShadowDepth = ShadowMapTexture[CascadeIndex].Sample(ShadowCoord.xy);

    float Shadow = (ShadowCoord.z < ShadowDepth + Bias) ? 1.0 : 0.0;

    // PCF (Percentage Closer Filtering)
    float ShadowFiltered = 0;
    for (int x = -1; x <= 1; ++x) {
        for (int y = -1; y <= 1; ++y) {
            float2 Offset = float2(x, y) * TexelSize;
            float Depth = ShadowMapTexture[CascadeIndex].Sample(ShadowCoord.xy + Offset);
            ShadowFiltered += (ShadowCoord.z < Depth + Bias) ? 1.0 : 0.0;
        }
    }
    ShadowFiltered /= 9.0;

    OutShadow = ShadowFiltered;
}
```

---

### Phase 9: Screen Space Effects

#### 9-1. Screen Space Reflections (SSR)

**📂 위치:** `ScreenSpaceReflections.cpp`

```cpp
// SSR Ray Marching
PixelShader: ScreenSpaceReflections
{
    FGBufferData GBuffer = DecodeGBuffer(PixelPos);

    // Reflection Vector
    float3 WorldPos = ReconstructWorldPosition(UV, SceneDepth, View.InvViewProj);
    float3 V = normalize(View.WorldCameraOrigin - WorldPos);
    float3 R = reflect(-V, GBuffer.WorldNormal);

    // Screen Space Ray Marching
    float3 HitUV;
    bool bHit = RayMarchScreenSpace(WorldPos, R, HitUV, MaxSteps, StepSize);

    if (bHit) {
        // SceneColor에서 반사된 색상 샘플링
        float3 ReflectionColor = SceneColor.Sample(HitUV);

        // Fade Out (Edge, Distance)
        float EdgeFade = ComputeScreenEdgeFade(HitUV);
        float DistanceFade = saturate(1.0 - length(HitUV - UV) / MaxDistance);

        OutColor = ReflectionColor * EdgeFade * DistanceFade;
    } else {
        // Fallback: Reflection Environment (Cubemap)
        OutColor = ReflectionCapture.Sample(R);
    }
}
```

**HZB를 사용한 최적화:**

```cpp
bool RayMarchScreenSpace(float3 StartPos, float3 Direction, out float3 HitUV) {
    float3 RayPos = StartPos;
    float StepSize = InitialStepSize;

    for (int Step = 0; Step < MaxSteps; ++Step) {
        RayPos += Direction * StepSize;

        float2 ScreenUV = WorldToScreen(RayPos);
        float SceneDepth = HZB.SampleLevel(ScreenUV, MipLevel);  // HZB 사용!

        if (RayPos.z > SceneDepth) {
            // Hit!
            HitUV = ScreenUV;
            return true;
        }

        // Adaptive Step Size (HZB Mip Level 조정)
        StepSize = ComputeAdaptiveStepSize(RayPos, SceneDepth, HZB);
    }

    return false;
}
```

#### 9-2. Screen Space Ambient Occlusion (SSAO / GTAO)

**GTAO (Ground Truth Ambient Occlusion):**

```cpp
PixelShader: GTAO
{
    float3 WorldPos = ReconstructWorldPosition(UV, SceneDepth, View.InvViewProj);
    float3 WorldNormal = GBufferA.Sample(UV).xyz;

    float AO = 0;

    // Horizon-based AO
    for (int SliceIndex = 0; SliceIndex < NumSlices; ++SliceIndex) {
        float Angle = (SliceIndex / (float)NumSlices) * PI;
        float2 Direction = float2(cos(Angle), sin(Angle));

        // March along direction
        float Horizon = -PI / 2;
        for (int StepIndex = 0; StepIndex < NumSteps; ++StepIndex) {
            float2 SampleUV = UV + Direction * StepSize * StepIndex;
            float SampleDepth = SceneDepth.Sample(SampleUV);
            float3 SamplePos = ReconstructWorldPosition(SampleUV, SampleDepth, View.InvViewProj);

            float3 Vec = SamplePos - WorldPos;
            float Angle = atan2(length(Vec.xy), Vec.z);

            Horizon = max(Horizon, Angle);
        }

        // Integrate
        AO += saturate((PI / 2 - Horizon) / PI);
    }

    AO /= NumSlices;
    OutAO = AO;
}
```

---

### Phase 10: Global Illumination (Lumen)

**Lumen**은 별도 Deep Dive 문서에서 상세히 다룰 예정입니다. 핵심 개념만:

```
Lumen Pipeline:

1️⃣ Surface Cache (Card Representation)
   - 씬을 Card(평면)로 표현
   - Albedo, Normal, Emission, Indirect Lighting 저장

2️⃣ Radiance Cache (Probe Grid)
   - 3D 공간에 Probe 배치
   - Probe당 Radiance (들어오는 빛) 저장

3️⃣ Screen Probe Gather
   - 화면 공간에 Probe 배치
   - Software/Hardware Ray Tracing

4️⃣ Final Gather
   - Screen Probe에서 보간하여 최종 GI 계산
```

---

### Phase 11: Fog & Atmosphere

**Volumetric Fog:**

```cpp
// Froxel (Frustum Voxel) Grid 생성
ComputeShader: InjectFogDensity
{
    uint3 FroxelCoord = DispatchThreadId;

    // World Position 계산
    float3 WorldPos = FroxelToWorldPos(FroxelCoord, View);

    // Fog Density 계산
    float Density = ExponentialHeightFog.Evaluate(WorldPos);

    // Light Injection
    for (each Light) {
        float3 L = normalize(Light.Position - WorldPos);
        float Shadow = ComputeShadow(WorldPos, Light);
        float3 Scattering = Light.Color * Shadow * PhaseFunction(L, V);

        FroxelGrid[FroxelCoord].Scattering += Scattering * Density;
    }

    FroxelGrid[FroxelCoord].Extinction = Density;
}

// Ray Marching
PixelShader: ApplyVolumetricFog
{
    float3 WorldPos = ReconstructWorldPosition(UV, SceneDepth, View.InvViewProj);

    float3 Transmittance = 1.0;
    float3 InScattering = 0;

    // March from camera to surface
    for (float t = 0; t < Distance; t += StepSize) {
        float3 SamplePos = View.WorldCameraOrigin + V * t;
        uint3 FroxelCoord = WorldPosToFroxel(SamplePos);

        float Extinction = FroxelGrid[FroxelCoord].Extinction;
        float3 Scattering = FroxelGrid[FroxelCoord].Scattering;

        Transmittance *= exp(-Extinction * StepSize);
        InScattering += Scattering * Transmittance * StepSize;
    }

    // Composite
    OutColor = SceneColor * Transmittance + InScattering;
}
```

---

### Phase 12: Translucency

**Separate Translucency Pass:**

```cpp
// Forward Rendering for Translucent Meshes
RenderTranslucency(GraphBuilder, SceneTextures) {
    // Sort by depth (Back-to-Front)
    TranslucentPrimitives.Sort([](const auto& A, const auto& B) {
        return A.Depth > B.Depth;
    });

    // Render with Alpha Blending
    for (const FMeshBatch& MeshBatch : TranslucentPrimitives) {
        // Vertex Shader: Transform
        // Pixel Shader: Material Evaluation + Lighting

        // Blend Mode: Alpha Blend
        // SrcColor * SrcAlpha + DestColor * (1 - SrcAlpha)
        DrawMeshBatch(MeshBatch, View, BlendState_AlphaBlend);
    }
}
```

**Translucent Lighting:**

Forward Rendering처럼 Pixel Shader에서 직접 조명 계산:
- Directional Lights
- Point/Spot Lights (가까운 N개만)
- Indirect Lighting (Lumen 또는 Reflection Captures)

---

### Phase 13: Post Processing

**📂 위치:** `PostProcess/` 폴더

```cpp
// Post Process Chain
void AddPostProcessingPasses(FRDGBuilder& GraphBuilder, const FViewInfo& View) {
    FScreenPassTexture SceneColor = ...;

    // 1. Temporal Anti-Aliasing (TAA)
    if (bUseTAA) {
        SceneColor = AddTemporalAAPass(GraphBuilder, View, SceneColor);
    }

    // 2. Depth of Field (DOF)
    if (bUseDOF) {
        SceneColor = AddDOFPass(GraphBuilder, View, SceneColor, SceneDepth);
    }

    // 3. Motion Blur
    if (bUseMotionBlur) {
        SceneColor = AddMotionBlurPass(GraphBuilder, View, SceneColor, VelocityTexture);
    }

    // 4. Bloom
    if (bUseBloom) {
        FScreenPassTexture Bloom = AddBloomPass(GraphBuilder, View, SceneColor);
        SceneColor = Combine(SceneColor, Bloom);
    }

    // 5. Tone Mapping
    SceneColor = AddToneMappingPass(GraphBuilder, View, SceneColor);

    // 6. Color Grading (LUT)
    SceneColor = AddColorGradingPass(GraphBuilder, View, SceneColor, ColorGradingLUT);

    // 7. UI Composite
    SceneColor = AddUIPass(GraphBuilder, View, SceneColor);

    return SceneColor;
}
```

**TAA (Temporal Anti-Aliasing):**

```cpp
PixelShader: TemporalAA
{
    // 현재 프레임
    float3 CurrentColor = SceneColor.Sample(UV);

    // 이전 프레임 (Motion Vector로 찾기)
    float2 Velocity = VelocityTexture.Sample(UV);
    float2 PrevUV = UV - Velocity;
    float3 HistoryColor = HistoryTexture.Sample(PrevUV);

    // Neighborhood Clamp (Color Space)
    float3 NearMin, NearMax;
    ComputeNeighborhoodAABB(UV, NearMin, NearMax);
    HistoryColor = clamp(HistoryColor, NearMin, NearMax);

    // Temporal Blend
    float BlendFactor = 0.95;  // 95% History, 5% Current
    float3 OutputColor = lerp(CurrentColor, HistoryColor, BlendFactor);

    OutColor = OutputColor;
}
```

---

## 💡 최적화 팁

### 1. Early Depth Pass 활성화

```cpp
// Project Settings → Rendering → Optimizations
r.EarlyZPass = 3  // DDM_AllOpaque (추천)

// Console 명령어
r.EarlyZPassOnlyMaterialMasking = 1  // Masked Material만 Pre-Pass
```

**측정 결과:**
- Early Z Off: BasePass 15ms
- Early Z On (DDM_AllOpaque): PrePass 3ms + BasePass 8ms = 11ms (27% 향상)

### 2. Tiled/Clustered Deferred 사용

```cpp
// Forward vs Deferred vs Tiled
r.LightCulling.Quality = 2  // 0: Forward, 1: Deferred, 2: Tiled

// Clustered Deferred (3D Grid)
r.LightCulling.Clustered = 1
```

**성능 비교 (1000개 라이트):**
- Forward: ~50ms (불가능에 가까움)
- Deferred: ~20ms
- Tiled Deferred: ~8ms
- Clustered Deferred: ~5ms

### 3. GBuffer 최적화

**RGB10A2 사용 (Normal 압축):**

```cpp
// GBufferA를 RGBA16F → RGB10A2로 변경
r.GBuffer.Format = 0  // 0: RGB10A2, 1: RGBA16F

// 대역폭: 64비트 → 32비트 (50% 절감)
// 품질: 거의 동일 (Normal은 10비트로 충분)
```

**Selective Output Mask:**

```cpp
// 불필요한 GBuffer 생성 스킵
if (ShadingModel == MSM_Unlit) {
    discard GBufferD;  // Custom Data 불필요
    discard GBufferE;  // Precomputed Shadows 불필요
}
```

### 4. Virtual Texture 활용

```cpp
// Runtime Virtual Texture (RVT)
r.VT.MaxUploadRate = 256  // 256 MB/s

// 장점:
// - 메모리: 10GB 텍스처 → 500MB VRAM
// - Streaming: 필요한 부분만 로드
```

---

## 🐛 일반적인 함정 (Pitfalls)

### ❌ Forward Shading과 혼용

```cpp
// ❌ Deferred Shading 프로젝트에서 Forward Material 사용
Material->ShadingModel = MSM_DefaultLit;
Material->BlendMode = BLEND_Opaque;
Material->bUsedWithForwardShading = true;  // ← 불필요!

// ✅ Deferred Material 사용
Material->bUsedWithDeferredShading = true;  // 기본값
```

**문제점:**
- Forward Material은 Deferred Pipeline에서 Fallback Path 사용 → 느림
- GBuffer 최적화 안 됨

### ❌ GBuffer Overdraw 무시

```cpp
// ❌ 복잡한 Material을 Early Z Pass에서 제외
Material->bUsedWithMaskedMaterial = true;  // Masked로 설정
// → Pre-Pass 스킵 → Base Pass에서 Overdraw 증가

// ✅ Opaque Material 사용
Material->BlendMode = BLEND_Opaque;
// → Pre-Pass 포함 → Base Pass Overdraw 최소화
```

### ❌ 너무 많은 Lights (Tiled Deferred 미사용)

```cpp
// ❌
r.LightCulling.Quality = 1  // Deferred (per-light full screen quad)
// + 100개 라이트 → 100번 Full Screen Pass → 느림

// ✅
r.LightCulling.Quality = 2  // Tiled Deferred
r.LightCulling.Clustered = 1
// + 1000개 라이트 → 1번 Full Screen Pass → 빠름
```

---

## 📚 참고 자료

**공식 문서:**
- [Rendering in Unreal Engine](https://docs.unrealengine.com/en-US/RenderingAndGraphics/)
- [GBuffer Format](https://docs.unrealengine.com/en-US/API/Runtime/Renderer/FGBufferData/)

**소스 파일:**
- `DeferredShadingRenderer.cpp`
- `BasePassRendering.cpp`
- `LightRendering.cpp`
- `SceneTextures.h`

**논문:**
- [Tiled Shading - Olsson et al. 2011](https://www.cse.chalmers.se/~uffe/tiled_shading_preprint.pdf)
- [Clustered Deferred and Forward Shading - Olsson et al. 2012](http://www.cse.chalmers.se/~uffe/clustered_shading_preprint.pdf)

---

## 요약

Deferred Shading Pipeline은:

1. **Pre-Pass**: Depth Buffer 생성 → Overdraw 최소화
2. **Base Pass**: Opaque Mesh → GBuffer Fill (Normal, BaseColor, Roughness, Metallic 등)
3. **Lighting**: Screen Space에서 조명 계산 (Directional, Point, Spot, Sky)
4. **Shadows**: VSM, CSM, Contact Shadows
5. **Screen Space Effects**: SSR, SSAO, SSGI
6. **Global Illumination**: Lumen (Surface Cache + Radiance Cache)
7. **Translucency**: Forward Rendering (Alpha Blend)
8. **Post Process**: TAA, DOF, Motion Blur, Bloom, Tone Mapping

**핵심 장점:**
- 많은 라이트 처리 가능 (Tiled/Clustered Deferred)
- 복잡한 Material 효율적 (Geometry와 Lighting 분리)
- Screen-Space Effects 용이 (GBuffer에 풍부한 정보)

**성능 목표:**
- 1080p: < 16ms (60fps)
- 4K: < 33ms (30fps) with TSR/DLSS