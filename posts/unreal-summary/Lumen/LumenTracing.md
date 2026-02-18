---
title: "Lumen Tracing"
date: "2025-12-02"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Lumen Tracing

> Updated: 2025-12-02 — Lumen Tracing 시스템 심층 분석 문서 작성

## 🧭 Overview

**Lumen Tracing**은 Lumen Global Illumination에서 광선 추적(Ray Tracing)을 수행하는 핵심 시스템입니다. Lumen은 **다중 계층 트레이싱 파이프라인**을 사용하여 성능과 품질의 균형을 맞춥니다. Screen Tracing, Mesh SDF Tracing, Global SDF Tracing, 그리고 Hardware Ray Tracing이 계층적으로 결합되어 최종 조명을 계산합니다.

### 트레이싱 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Lumen Multi-Layer Tracing                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Layer 1: Screen Space Tracing (가장 빠름)                              │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │  HZB 기반 Screen Trace                                      │      │
│   │  → 화면 내 가시 픽셀만 활용                                   │      │
│   │  → Miss 시 다음 레이어로                                     │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                              ↓ Miss                                     │
│   Layer 2: Mesh SDF Tracing (중간 거리)                                  │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │  개별 메시의 Signed Distance Field                           │      │
│   │  → 상세한 지오메트리 표현                                     │      │
│   │  → Culling Grid로 최적화                                     │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                              ↓ Miss                                     │
│   Layer 3: Global SDF Tracing (원거리)                                  │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │  Clipmap 기반 병합된 Distance Field                          │      │
│   │  → 빠른 원거리 트레이싱                                       │      │
│   │  → 낮은 디테일                                               │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                              ↓ Miss                                     │
│   Layer 4: Hardware Ray Tracing (선택적)                                │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │  RTX/DXR 하드웨어 가속                                       │      │
│   │  → 정확한 지오메트리 교차                                     │      │
│   │  → 반사, 반투명 등 고품질                                    │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                              ↓ Miss                                     │
│   Fallback: Sky Light / Far Field                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 Core Data Structures

### FConeTraceInput

Cone Tracing을 위한 입력 파라미터:

```hlsl
// LumenSoftwareRayTracing.ush:27
struct FConeTraceInput
{
    float3 ConeOrigin;              // 월드 공간 원점
    float3 ConeTranslatedOrigin;    // 변환된 원점
    float3 ConeDirection;           // 방향 벡터

    float ConeAngle;                // 콘 각도 (View.EyeToPixelSpreadAngle)
    float TanConeAngle;             // tan(ConeAngle)

    float ConeStartRadius;          // 시작 반경
    float MinSampleRadius;          // 최소 샘플 반경
    float MinTraceDistance;         // 최소 트레이스 거리
    float MaxTraceDistance;         // 최대 트레이스 거리

    float StepFactor;               // 스테핑 배율
    float VoxelTraceStartDistance;  // Voxel 트레이싱 시작 거리
    float SDFStepFactor;            // SDF 스텝 팩터
    float MinSDFStepFactor;         // 최소 SDF 스텝 팩터

    bool bExpandSurfaceUsingRayTimeInsteadOfMaxDistance;
    float InitialMaxDistance;

    bool bDitheredTransparency;     // 디더링된 투명도
    uint2 DitherScreenCoord;        // 디더 스크린 좌표

    bool bUseEpsilonTraceForHeightfields;
    bool bHiResSurface;             // 고해상도 Surface Cache 사용
    bool bZeroRadianceIfRayStartsInsideGeometry;
    bool bCalculateHitVelocity;

    // Mesh SDF Culling
    uint NumMeshSDFs;
    uint MeshSDFStartOffset;
    uint MeshSDFBitmaskStartOffset;
    float CardInterpolateInfluenceRadius;

    // Heightfield
    uint NumHeightfields;
    uint HeightfieldStartOffset;
};
```

**📂 위치:** `Engine/Shaders/Private/Lumen/LumenSoftwareRayTracing.ush:27-107`

### FConeTraceResult

Cone Tracing 결과:

```hlsl
// LumenTracingCommon.ush:13
struct FConeTraceResult
{
    float3 Lighting;            // 최종 조명
    float Transparency;         // 투명도
    float NumSteps;             // 총 스텝 수
    float NumOverlaps;          // 오버랩 수
    float OpaqueHitDistance;    // 불투명 히트 거리
    float ExpandSurfaceAmount;  // 표면 확장량
    float3 Debug;               // 디버그 출력
    float3 GeometryWorldNormal; // 지오메트리 월드 노멀
    float3 WorldVelocity;       // 월드 속도
};
```

---

## 🔬 Software Ray Tracing

### Mesh SDF Tracing

개별 메시의 Signed Distance Field를 통한 레이 트레이싱:

```hlsl
// LumenSoftwareRayTracing.ush:124
void RayTraceSingleMeshSDF(
    float3 WorldRayStart,
    float3 WorldRayDirection,
    float TanConeHalfAngle,
    float MinTraceDistance,
    float MaxTraceDistance,
    uint ObjectIndex,
    bool bExpandSurfaceUsingRayTimeInsteadOfMaxDistance,
    float InitialMaxDistance,
    bool bDitheredTransparency,
    float2 DitherScreenCoord,
    inout FTraceMeshSDFResult TraceResult)
{
    FDFObjectData DFObjectData = LoadDFObjectData(ObjectIndex);
    float4x4 WorldToVolume = DFHackToFloat(DFObjectData.WorldToVolume);

    // 월드 → 볼륨 공간 변환
    float3 WorldRayEnd = WorldRayStart + WorldRayDirection * MaxTraceDistance;
    float3 VolumeRayStart = mul(float4(WorldRayStart, 1), WorldToVolume).xyz;
    float3 VolumeRayEnd = mul(float4(WorldRayEnd, 1), WorldToVolume).xyz;

    // AABB 교차 테스트
    float2 VolumeSpaceIntersectionTimes = LineBoxIntersect(
        VolumeRayStart, VolumeRayEnd,
        -DFObjectData.VolumePositionExtent,
        DFObjectData.VolumePositionExtent);

    if (VolumeSpaceIntersectionTimes.x < VolumeSpaceIntersectionTimes.y)
    {
        // Sphere Tracing 루프
        uint MaxSteps = 64;
        float SampleRayTime = VolumeSpaceIntersectionTimes.x;

        for (uint StepIndex = 0; StepIndex < MaxSteps; StepIndex++)
        {
            float3 SampleVolumePosition = VolumeRayStart + VolumeRayDirection * SampleRayTime;
            float DistanceField = SampleSparseMeshSignedDistanceField(
                SampleVolumePosition, DFAssetMipData);

            // 표면 근처 도달 시 히트
            if (DistanceField < ExpandSurfaceAmount)
            {
                TraceResult.HitObject = ObjectIndex;
                TraceResult.HitDistance = /* 계산된 거리 */;
                break;
            }

            // 다음 스텝
            SampleRayTime += max(DistanceField, MinStepSize);
        }
    }
}
```

**Mesh SDF Tracing 흐름:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Mesh SDF Ray Tracing Pipeline                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. Culling Grid Lookup                                                │
│      ┌────────────────────────────────────────┐                        │
│      │  Ray가 통과하는 Grid Cell 찾기         │                        │
│      │  → NumGridCulledMeshSDFObjects         │                        │
│      │  → GridCulledMeshSDFObjectIndicesArray │                        │
│      └──────────────────┬─────────────────────┘                        │
│                         ↓                                               │
│   2. For each Mesh SDF in Cell                                          │
│      ┌────────────────────────────────────────┐                        │
│      │  AABB 교차 테스트                       │                        │
│      │  → VolumeSpaceIntersectionTimes        │                        │
│      └──────────────────┬─────────────────────┘                        │
│                         ↓                                               │
│   3. Sphere Tracing Loop (max 64 steps)                                 │
│      ┌────────────────────────────────────────┐                        │
│      │  SDF 샘플링                             │                        │
│      │  → SampleSparseMeshSignedDistanceField │                        │
│      │  거리만큼 전진 또는 히트                │                        │
│      └──────────────────┬─────────────────────┘                        │
│                         ↓                                               │
│   4. Hit Processing                                                     │
│      ┌────────────────────────────────────────┐                        │
│      │  노멀 계산 (Gradient)                   │                        │
│      │  Surface Cache 샘플링                   │                        │
│      │  → Radiance 반환                        │                        │
│      └────────────────────────────────────────┘                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Global SDF Tracing

전역 Distance Field를 통한 원거리 트레이싱:

```hlsl
// LumenSoftwareRayTracing.ush:775
void RayTraceGlobalDistanceField(
    FConeTraceInput TraceInput,
    inout FConeTraceResult OutResult)
{
    // Global SDF 트레이싱 설정
    FGlobalSDFTraceInput SDFTraceInput = SetupGlobalSDFTraceInput(
        TraceInput.ConeTranslatedOrigin,
        TraceInput.ConeDirection,
        TraceInput.MinTraceDistance,
        TraceInput.MaxTraceDistance,
        TraceInput.SDFStepFactor,
        TraceInput.MinSDFStepFactor);

    SDFTraceInput.bDitheredTransparency = TraceInput.bDitheredTransparency;
    SDFTraceInput.DitherScreenCoord = TraceInput.DitherScreenCoord;

    // Global SDF Ray Tracing
    FGlobalSDFTraceResult SDFTraceResult = RayTraceGlobalDistanceField(SDFTraceInput);

    if (GlobalSDFTraceResultIsHit(SDFTraceResult))
    {
        EvaluateGlobalDistanceFieldHit(TraceInput, SDFTraceResult, OutResult);
    }
}
```

### Hit Point에서 Surface Cache 샘플링

```hlsl
// LumenSoftwareRayTracing.ush:649
void EvaluateGlobalDistanceFieldHit(
    FConeTraceInput TraceInput,
    FGlobalSDFTraceResult SDFTraceResult,
    inout FConeTraceResult ConeTraceResult)
{
    // 히트 위치와 노멀 계산
    const float3 SampleWorldPosition = TraceInput.ConeOrigin +
        TraceInput.ConeDirection * SDFTraceResult.HitTime;
    const float3 SampleWorldNormal = ComputeGlobalDistanceFieldNormal(
        SampleTranslatedWorldPosition,
        SDFTraceResult.HitClipmapIndex,
        -TraceInput.ConeDirection);

    // Object Grid에서 메시 카드 검색
    FGlobalDistanceFieldPage Page = GetGlobalDistanceFieldPage(ClipmapVolumeUV, ClipmapIndex);

    if (Page.bValid)
    {
        // Grid Cell에서 오브젝트 순회
        for (uint ObjectIndexInList = 0; ObjectIndexInList < DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE; ++ObjectIndexInList)
        {
            FObjectGridCellIndex GridCellIndex = UnpackObjectGridCellIndex(
                DistanceFieldObjectGridCell[ObjectIndexInList]);

            if (GridCellIndex.bValid)
            {
                uint MeshCardsIndex = GetMeshCardsIndexFromSceneInstanceIndex(
                    GridCellIndex.GPUSceneInstanceIndex);

                // Surface Cache 샘플링
                SampleLumenMeshCards(
                    MeshCardsIndex,
                    SampleWorldPosition,
                    SampleWorldNormal,
                    SampleRadius,
                    SurfaceCacheBias,
                    TraceInput.bHiResSurface,
                    CardSampleAccumulator);

                if (CardSampleAccumulator.SampleWeightSum >= 0.9f)
                    break;
            }
        }

        // 최종 Radiance 계산
        FSurfaceCacheSample SurfaceCacheSample = EvaluateRayHitFromCardSampleAccumulator(
            TraceInput.DitherScreenCoord,
            SampleWorldPosition,
            SampleWorldNormal,
            CardSampleAccumulator);

        Radiance = RadianceFactor * SurfaceCacheSample.Radiance;
    }

    ConeTraceResult.Lighting = Radiance;
    ConeTraceResult.OpaqueHitDistance = SDFTraceResult.HitTime;
}
```

### Heightfield Tracing

Landscape를 위한 Heightfield 트레이싱:

```hlsl
// LumenSoftwareRayTracing.ush:399
FConeTraceHeightfieldSimpleResult ConeTraceHeightfieldSimple(
    FConeTraceInput TraceInput,
    uint HeightfieldIndex)
{
    // Heightfield 데이터 로드
    FLumenHeightfieldData LumenHeightfield = GetLumenHeightfieldData(HeightfieldIndex);
    FLumenCardData LumenCardData = GetLumenCardData(MeshCardsData.CardOffset + LocalCardIndex);

    // 로컬 공간으로 변환
    float3 LocalConeOrigin = mul(TraceInput.ConeOrigin - LumenCardData.Origin,
        LumenCardData.WorldToLocalRotation);
    float3 LocalConeDirection = mul(TraceInput.ConeDirection,
        LumenCardData.WorldToLocalRotation);

    // Heightfield와 Ray-march
    for (int StepIndex = 0; StepIndex < MaxSteps; ++StepIndex)
    {
        FHeightfieldRayStep Step = HeightfieldRayStep(
            LumenCardData, LocalCardIndex, TraceInput,
            LocalConeOrigin, LocalConeDirection, tValue);

        // Zero-crossing 검출
        if (PrevStep.bAboveHeightfield != Step.bAboveHeightfield)
        {
            EvaluateHeightfieldHit(/* ... */);
        }
    }

    return Result;
}
```

---

## 🖥️ Screen Space Tracing

### HZB (Hierarchical Z-Buffer) Tracing

화면 공간에서 가장 빠른 트레이싱 방법:

```hlsl
// LumenScreenTracing.ush:14
void TraceScreen(
    float3 RayTranslatedWorldOrigin,
    float3 RayWorldDirection,
    float MaxWorldTraceDistance,
    float4 InHZBUvFactorAndInvFactor,
    float MaxIterations,
    float RelativeDepthThickness,
    float NumThicknessStepsToDetermineCertainty,
    uint MinimumTracingThreadOccupancy,
    inout bool bHit,
    inout bool bUncertain,
    inout float3 OutScreenUV,
    inout float3 OutLastVisibleScreenUV,
    inout float OutHitTileZ)
{
    TraceHZB(
        SceneDepthTexture,
        ClosestHZBTexture,
        HZBBaseTexelSize,
        HZBUVToScreenUVScaleBias,
        RayTranslatedWorldOrigin,
        RayWorldDirection,
        MaxWorldTraceDistance,
        InHZBUvFactorAndInvFactor,
        MaxIterations,
        RelativeDepthThickness,
        NumThicknessStepsToDetermineCertainty,
        MinimumTracingThreadOccupancy,
        bHit,
        bUncertain,
        OutScreenUV,
        OutLastVisibleScreenUV,
        OutHitTileZ);
}
```

**Screen Tracing 원리:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Screen Space Ray Tracing                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   HZB (Hierarchical Z-Buffer)                                           │
│   ─────────────────────────────                                         │
│                                                                         │
│   Mip Level 0: Full Resolution Depth                                    │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │ [Z][Z][Z][Z][Z][Z][Z][Z][Z][Z][Z][Z][Z][Z][Z][Z]            │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                                                                         │
│   Mip Level 1: 2x2 Min/Max                                              │
│   ┌─────────────────────────────────────────────┐                      │
│   │    [min]    [min]    [min]    [min]         │                      │
│   └─────────────────────────────────────────────┘                      │
│                                                                         │
│   Mip Level 2: 4x4 Min/Max                                              │
│   ┌───────────────────────┐                                             │
│   │      [min]  [min]     │                                             │
│   └───────────────────────┘                                             │
│                                                                         │
│   트레이싱 알고리즘:                                                      │
│   ─────────────────                                                     │
│   1. 높은 Mip 레벨에서 시작 (빠른 건너뛰기)                              │
│   2. Ray가 HZB 셀과 교차하지 않으면 → 큰 스텝 이동                       │
│   3. 교차 가능성 있으면 → 낮은 Mip 레벨로 이동                           │
│   4. Mip 0에서 실제 깊이와 비교 → Hit 판정                              │
│                                                                         │
│   장점:                                                                  │
│   - 빈 공간을 빠르게 건너뛸 수 있음                                      │
│   - 이미 렌더링된 정보 재활용                                            │
│   - GPU 친화적 (텍스처 샘플링)                                           │
│                                                                         │
│   단점:                                                                  │
│   - 화면에 보이는 것만 트레이스 가능                                     │
│   - 뒤쪽 표면 놓칠 수 있음                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Scene Color 샘플링

Screen Tracing 히트 시 이전 프레임의 Scene Color 재사용:

```hlsl
// LumenScreenTracing.ush:64
bool SampleSceneColorAtHit(
    float3 HitTranslatedWorldPosition,
    float3 HitGeometryWorldNormal,
    uint2 SvPosition,
    float RelativeDepthThickness,
    inout float3 Lighting)
{
    // 월드 → 클립 공간 변환
    float4 HitClipPosition = mul(float4(HitTranslatedWorldPosition, 1.0f),
        View.TranslatedWorldToClip);

    if (HitClipPosition.w > 0)
    {
        float2 HitScreenUV = HitScreenPosition * View.ScreenPositionScaleBias.xy +
            View.ScreenPositionScaleBias.wz;
        float HitDeviceZ = SceneDepthTexture.SampleLevel(GlobalPointClampedSampler, HitScreenUV, 0).r;
        float HitSceneDepth = ConvertFromDeviceZ(HitDeviceZ);

        // 깊이 검증 및 노멀 방향 체크
        float3 PixelToCameraDirection = -GetCameraVectorFromTranslatedWorldPosition(HitTranslatedWorldPosition);

        if (abs(RayHitSceneDepth - HitSceneDepth) < RelativeDepthThickness * HitSceneDepth
            && dot(PixelToCameraDirection, HitGeometryWorldNormal) >= SampleSceneColorNormalTreshold)
        {
            // History Screen Position 계산
            float3 HitHistoryScreenPosition = GetHistoryScreenPosition(
                HitScreenPosition, HitScreenUV, HitDeviceZ);

            // Vignette 및 Temporal 검증
            float Vignette = min(
                ComputeHitVignetteFromScreenPos(HitScreenPosition),
                ComputeHitVignetteFromScreenPos(HitHistoryScreenPosition.xy));

            if (Vignette >= Noise)
            {
                // 이전 프레임 Scene Color 샘플링
                float2 HitHistoryScreenUV = clamp(
                    HitHistoryScreenPosition.xy * PrevScreenPositionScaleBias.xy + PrevScreenPositionScaleBias.zw,
                    PrevSceneColorBilinearUVMin,
                    PrevSceneColorBilinearUVMax);

                Lighting = SampleScreenColor(PrevSceneColorTexture, GlobalPointClampedSampler, HitHistoryScreenUV).xyz
                    * PrevSceneColorPreExposureCorrection * View.OneOverPreExposure;
                return true;
            }
        }
    }
    return false;
}
```

---

## ⚡ Hardware Ray Tracing

### Hardware Ray Tracing Context

```hlsl
// LumenHardwareRayTracingCommon.ush:140
struct FRayTracedLightingContext
{
#if LUMEN_HARDWARE_INLINE_RAYTRACING
    StructuredBuffer<FHitGroupRootConstants> HitGroupData;
    StructuredBuffer<FRayTracingSceneMetadataRecord> RayTracingSceneMetadata;
    RWStructuredBuffer<uint> RWInstanceHitCountBuffer;
#endif

    FRayCone RayCone;
    uint2 TraceCoord;
    uint LinearCoord;
    uint InstanceMask;

    uint MaxTraversalIterations;
    float MinTraceDistanceToSampleSurfaceCache;

    uint MaxReflectionBounces;
    uint MaxRefractionBounces;

    uint CullingMode;

    bool bHiResSurface;
    bool bAcceptFirstHitAndEndSearch;
    bool bIsShadowRay;
    bool bIsFarFieldRay;
    bool bUseBookmark;
    bool bForceOpaque;
    bool bMeshSectionVisibilityTest;
    bool bForceClosestHitShader;

    // Hit-lighting
    float HitLightingShadowMaxTraceDistance;
    uint HitLightingShadowMode;
    uint HitLightingShadowTranslucencyMode;
    bool bHitLightingDirectLighting;
    bool bHitLightingSkylight;
    bool bUseReflectionCaptures;

    uint LightingChannelMask;
};
```

### Minimal Ray Result

```hlsl
// LumenHardwareRayTracingCommon.ush:227
struct FLumenMinimalRayResult
{
    bool bHit;
    bool bCompleted;
    bool bTranslucent;
    bool bTwoSided;
    bool bAlphaMasked;
    bool bFrontFace;

    uint MaterialShaderIndex;
    uint SceneInstanceIndex;
    float HitT;
    float3 HitNormal;

    FLumenRayHitBookmark Bookmark;
};
```

### Surface Cache Ray Tracing

하드웨어 가속 레이 트레이싱 + Surface Cache 조합:

```hlsl
// LumenHardwareRayTracingCommon.ush:1156
FRayTracedLightingResult TraceSurfaceCacheRay(
    in RaytracingAccelerationStructure TLAS,
    FRayDesc Ray,
    FRayTracedLightingContext Context)
{
    // Minimal Ray Tracing (BVH 교차만)
    FLumenMinimalRayResult MinimalRayResult = TraceLumenMinimalRay(TLAS, Ray, Context);

    // Self-Intersection 회피
    #if AVOID_SELF_INTERSECTIONS_MODE == AVOID_SELF_INTERSECTIONS_MODE_RETRACE
    if (MinimalRayResult.bHit)
    {
        if (MinimalRayResult.bTwoSided &&
            MinimalRayResult.HitT < LumenHardwareRayTracingUniformBuffer.SkipTwoSidedHitDistance)
        {
            // 재추적
            Ray.TMin = MinimalRayResult.HitT + 0.01f;
            MinimalRayResult = TraceLumenMinimalRay(TLAS, Ray, Context);
        }
    }
    #endif

    // Surface Cache 샘플링
    FSurfaceCacheSample SurfaceCacheSample = InitSurfaceCacheSample();
    if (MinimalRayResult.bHit && MinimalRayResult.bCompleted)
    {
        SurfaceCacheSample = SampleLumenMinimalRayHit(Ray, Context, MinimalRayResult);
    }

    // Alpha Masking 처리
    #if SURFACE_CACHE_ALPHA_MASKING
    if (SurfaceCacheSample.bValid && SurfaceCacheSample.Opacity < 0.5f)
    {
        Ray.TMin = MinimalRayResult.HitT + 0.01f;
        MinimalRayResult = TraceLumenMinimalRay(TLAS, Ray, Context);
        // 재샘플링...
    }
    #endif

    return CreateRayTracedLightingResult(Ray, Context, MinimalRayResult, SurfaceCacheSample);
}
```

### Hit Lighting (Full Material Evaluation)

고품질 Hit Lighting을 위한 전체 머티리얼 평가:

```hlsl
// LumenHardwareRayTracingCommon.ush:834
float3 CalculateLightingAtHit(
    RaytracingAccelerationStructure TLAS,
    RaytracingAccelerationStructure FarFieldTLAS,
    FRayDesc Ray,
    FRayTracedLightingContext Context,
    FRandomSequence RandSequence,
    FLumenHitLightingMaterial LumenMaterial,
    float NextReflectionRayAlpha,
    inout FPackedMaterialClosestHitPayload Payload)
{
    float3 Radiance = 0;
    float3 RayHitTranslatedWorldPosition = Ray.Origin + Ray.Direction * Payload.HitT;

    // Direct Lighting
    if (Context.bHitLightingDirectLighting)
    {
        Radiance += CalculateDirectLighting(
            TLAS, FarFieldTLAS, Ray, Context, Payload, RandSequence,
            RayHitTranslatedWorldPosition, Payload.GetWorldNormal());
    }

    // Sky Lighting
    if (Context.bHitLightingSkylight)
    {
        // Diffuse
        Radiance += LumenMaterial.DiffuseColor * Payload.GetIndirectIrradiance();

        // Specular (Reflection Captures 사용)
        if (Context.bUseReflectionCaptures && (1.0f - NextReflectionRayAlpha) > 0.0f)
        {
            float3 R = reflect(Ray.Direction, Payload.GetWorldNormal());
            Radiance += LumenMaterial.TopLayerSpecularColor * SpecularOcclusion *
                CompositeReflectionCapturesAndSkylightTWS(/* ... */);
        }
    }
    else
    {
        // Surface Cache Fallback
        FSurfaceCacheSample SurfaceCacheSample = CalculateSurfaceCacheLighting(
            Ray, Context, RayHitTranslatedWorldPosition,
            RayHitGeometryWorldNormal, Payload.HitT,
            Payload.GetSceneInstanceIndex());

        Radiance += Diffuse_Lambert(LumenMaterial.ApproxFullyRoughDiffuseColor) *
            (SurfaceCacheSample.DirectLighting + SurfaceCacheSample.IndirectLighting);
    }

    return Radiance;
}
```

---

## 🎯 Combined Tracing Pipeline

### ConeTraceLumenScene

모든 레이어를 결합한 전체 트레이싱:

```hlsl
// LumenSoftwareRayTracing.ush:889
void ConeTraceLumenScene(
    FConeTraceInput TraceInput,
    inout FConeTraceResult OutResult)
{
    // Layer 1: Mesh SDF Cards
    ConeTraceLumenSceneCards(TraceInput, OutResult);

    // Layer 2: Heightfields
    ConeTraceLumenSceneHeightfields(TraceInput, OutResult);

    // Layer 3: Global SDF Voxels
    ConeTraceLumenSceneVoxels(TraceInput, OutResult);
}

void ConeTraceLumenSceneCards(
    FConeTraceInput TraceInput,
    inout FConeTraceResult OutResult)
{
    OutResult = (FConeTraceResult)0;
    OutResult.Transparency = 1;
    OutResult.OpaqueHitDistance = TraceInput.MaxTraceDistance;

#if SCENE_TRACE_MESH_SDFS
    if (TraceInput.VoxelTraceStartDistance > TraceInput.MinTraceDistance)
    {
        FConeTraceInput CardTraceInput = TraceInput;
        CardTraceInput.MaxTraceDistance = TraceInput.VoxelTraceStartDistance;
        ConeTraceMeshSDFsAndInterpolateFromCards(CardTraceInput, OutResult);
    }
#endif
}

void ConeTraceLumenSceneVoxels(
    FConeTraceInput TraceInput,
    inout FConeTraceResult OutResult)
{
    if (TraceInput.VoxelTraceStartDistance < TraceInput.MaxTraceDistance)
    {
        FConeTraceInput VoxelTraceInput = TraceInput;
        VoxelTraceInput.MinTraceDistance = TraceInput.VoxelTraceStartDistance;

        FConeTraceResult VoxelTraceResult;
        RayTraceGlobalDistanceField(VoxelTraceInput, VoxelTraceResult);

        OutResult.Lighting += VoxelTraceResult.Lighting * OutResult.Transparency;
        OutResult.Transparency *= VoxelTraceResult.Transparency;
        OutResult.OpaqueHitDistance = min(OutResult.OpaqueHitDistance, VoxelTraceResult.OpaqueHitDistance);
    }
}
```

**트레이싱 거리에 따른 레이어 전환:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Distance-Based Layer Selection                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   거리 →                                                                │
│   0           MaxMeshSDFTraceDistance              MaxTraceDistance     │
│   │───────────────────│────────────────────────────────│               │
│   │                   │                                │               │
│   │   Mesh SDF        │       Global SDF               │   Sky/Far     │
│   │   (상세)          │       (빠름)                   │   Field       │
│   │                   │                                │               │
│   └───────────────────┴────────────────────────────────┘               │
│                                                                         │
│   VoxelTraceStartDistance 계산:                                         │
│   ─────────────────────────────                                         │
│   float CalculateVoxelTraceStartDistance(                               │
│       float MinTraceDistance,                                           │
│       float MaxTraceDistance,                                           │
│       float MaxMeshSDFTraceDistance,                                    │
│       bool bContinueCardTracing)                                        │
│   {                                                                     │
│       if (NumGlobalSDFClipmaps > 0)                                     │
│       {                                                                 │
│           if (bContinueCardTracing)                                     │
│               return max(MinTraceDistance, MaxMeshSDFTraceDistance);    │
│           else                                                          │
│               return MinTraceDistance;                                  │
│       }                                                                 │
│       return MaxTraceDistance;  // Global SDF 없으면 전부 Mesh SDF      │
│   }                                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🌥️ Sky & Fog Integration

### Skylight Leaking

지오메트리 틈새로 새어나오는 스카이라이트 처리:

```hlsl
// LumenTracingCommon.ush:64
float3 SkylightLeakingColor;
float SkylightLeakingRoughness;
float InvFullSkylightLeakingDistance;

float CalculateSkylightLeakingDistanceFactor(float HitDistance)
{
    return saturate(HitDistance * InvFullSkylightLeakingDistance);
}

float3 GetSkylightLeaking(float3 ConeDirection, float HitDistance)
{
    float3 Lighting = 0;

    if (ReflectionStruct.SkyLightParameters.y > 0 && any(SkylightLeakingColor > 0.0f))
    {
        float SkyAverageBrightness = 1.0f;
        Lighting = GetSkyLightReflection(ConeDirection, SkylightLeakingRoughness, SkyAverageBrightness)
            * SkylightLeakingColor
            * CalculateSkylightLeakingDistanceFactor(HitDistance);
    }

    return Lighting;
}
```

### Height Fog Integration

트레이싱 결과에 Height Fog 적용:

```hlsl
// LumenTracingCommon.ush:113
float3 GetFogOnLuminance(
    in float3 SurfaceLuminance,
    in float SurfaceCoverage,
    in float3 RayOrigin,
    in float3 RayDir,
    in float HitPosDistance)
{
    const float ExcludeDistance = 0.0f;
    bool bOverrideOrigin = true;

    float4 HeightFogInscatteringAndTransmittance = GetExponentialHeightFog(
        0, ExcludeDistance, 0, GetPrimaryView(),
        bOverrideOrigin, RayOrigin, RayDir, HitPosDistance);

    HeightFogInscatteringAndTransmittance.rgb *= View.PreExposure;

    return SurfaceLuminance * HeightFogInscatteringAndTransmittance.a +
        HeightFogInscatteringAndTransmittance.rgb * SurfaceCoverage;
}
```

---

## 🔧 C++ Setup Functions

### Card Tracing Parameters 설정

```cpp
// LumenTracingUtils.cpp:29
void GetLumenCardTracingParameters(
    FRDGBuilder& GraphBuilder,
    const FViewInfo& View,
    const FLumenSceneData& LumenSceneData,
    const FLumenSceneFrameTemporaries& FrameTemporaries,
    bool bSurfaceCacheFeedback,
    FLumenCardTracingParameters& TracingParameters)
{
    // View 및 Scene 버퍼
    TracingParameters.View = View.ViewUniformBuffer;
    TracingParameters.Scene = View.GetSceneUniforms().GetBuffer(GraphBuilder);
    TracingParameters.LumenCardScene = FrameTemporaries.LumenCardSceneUniformBuffer;
    TracingParameters.ReflectionStruct = CreateReflectionUniformBuffer(GraphBuilder, View);

    // Skylight Leaking 파라미터
    TracingParameters.DiffuseColorBoost = 1.0f / FMath::Max(
        View.FinalPostProcessSettings.LumenDiffuseColorBoost, 1.0f);
    TracingParameters.SkylightLeakingColor = FMath::Max(
        View.FinalPostProcessSettings.LumenSkylightLeaking, 0.0f) *
        FVector3f(View.FinalPostProcessSettings.LumenSkylightLeakingTint);
    TracingParameters.SkylightLeakingRoughness = CVarLumenSkylightLeakingRoughness.GetValueOnRenderThread();
    TracingParameters.InvFullSkylightLeakingDistance = 1.0f / FMath::Clamp<float>(
        View.FinalPostProcessSettings.LumenFullSkylightLeakingDistance,
        .1f, Lumen::GetMaxTraceDistance(View));

    // Surface Cache Atlas
    TracingParameters.DirectLightingAtlas = FrameTemporaries.DirectLightingAtlas;
    TracingParameters.IndirectLightingAtlas = FrameTemporaries.IndirectLightingAtlas;
    TracingParameters.FinalLightingAtlas = FrameTemporaries.FinalLightingAtlas;
    TracingParameters.AlbedoAtlas = FrameTemporaries.AlbedoAtlas;
    TracingParameters.NormalAtlas = FrameTemporaries.NormalAtlas;
    TracingParameters.DepthAtlas = FrameTemporaries.DepthAtlas;

    // Global Distance Field
    TracingParameters.NumGlobalSDFClipmaps = View.GlobalDistanceFieldInfo.Clipmaps.Num();
}
```

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenTracingUtils.cpp:29-120`

---

## 📊 Console Variables

```cpp
// Skylight Leaking
r.Lumen.SkylightLeaking.Roughness 0.3        // 스카이라이트 러프니스
r.Lumen.SkylightLeaking.ReflectionAverageAlbedo 0.25  // 반사 평균 알베도

// Fog
r.Lumen.SampleFog 0                          // 안개 샘플링 (비활성화됨)

// Tracing Quality
r.Lumen.TraceMeshSDFs 1                      // Mesh SDF 트레이싱
r.Lumen.TraceGlobalSDF 1                     // Global SDF 트레이싱
r.Lumen.HardwareRayTracing 1                 // 하드웨어 레이 트레이싱

// Performance
r.Lumen.ScreenProbeTracing.MaxIterations 64  // 최대 반복 횟수
r.Lumen.Reflections.MaxIterations 16         // 반사 최대 반복
```

---

## 💡 Performance Tips

### 최적화 전략

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Performance Optimization                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ✅ 효율적인 방법:                                                     │
│   ─────────────────                                                     │
│                                                                         │
│   1. Screen Tracing 우선 활용                                           │
│      - 화면에 이미 렌더링된 정보 재사용                                  │
│      - HZB로 빈 공간 빠르게 건너뛰기                                    │
│                                                                         │
│   2. 거리 기반 레이어 전환                                              │
│      - 가까운 거리: 상세한 Mesh SDF                                     │
│      - 먼 거리: 빠른 Global SDF                                         │
│                                                                         │
│   3. Cone Tracing 활용                                                  │
│      - 디퓨즈: 넓은 콘 → 적은 샘플                                      │
│      - 스페큘러: 좁은 콘 → 정밀 트레이싱                                │
│                                                                         │
│   4. Surface Cache 재사용                                               │
│      - 히트 포인트에서 사전 계산된 조명 조회                            │
│      - 셰이딩 재계산 회피                                               │
│                                                                         │
│   ❌ 피해야 할 것:                                                      │
│   ────────────────                                                      │
│                                                                         │
│   1. 불필요한 Hardware Ray Tracing                                      │
│      - Software Tracing으로 충분한 경우                                 │
│      - 먼 거리 트레이싱에 HWRT 사용                                     │
│                                                                         │
│   2. 과도한 MaxTraceDistance                                            │
│      - 스텝 수 증가 → 성능 저하                                         │
│                                                                         │
│   3. MinStepSize 너무 작게 설정                                         │
│      - 반복 횟수 급증                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 디버깅 시각화

```cpp
// 트레이싱 디버깅
r.Lumen.ScreenProbeTracing.Visualize 1       // Screen Probe 트레이싱 시각화
r.Lumen.Reflections.Visualize 1              // 반사 트레이싱 시각화
r.Lumen.Visualize.CardTraces 1               // Card 트레이싱 시각화
```

---

## 🔗 References

- **소스 파일:**
  - `Engine/Shaders/Private/Lumen/LumenTracingCommon.ush`
  - `Engine/Shaders/Private/Lumen/LumenSoftwareRayTracing.ush`
  - `Engine/Shaders/Private/Lumen/LumenHardwareRayTracingCommon.ush`
  - `Engine/Shaders/Private/Lumen/LumenScreenTracing.ush`
  - `Engine/Source/Runtime/Renderer/Private/Lumen/LumenTracingUtils.cpp`

- **관련 문서:**
  - [Surface Cache](./SurfaceCache.md)
  - [Global Distance Field](./GlobalDistanceField.md)
  - [Mesh Distance Field](./MeshDistanceField.md)
  - [Screen Probe Gather](./ScreenProbe.md)
