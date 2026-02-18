---
title: "Lumen Reflections"
date: "2025-12-02"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Lumen Reflections

> Updated: 2025-12-02 — Lumen Reflections 심층 분석 문서 작성

## 🧭 Overview

**Lumen Reflections**는 Lumen Global Illumination 시스템의 반사 계산을 담당하는 서브시스템입니다. Screen Space Reflections (SSR)을 시작으로 Mesh SDF, Global SDF, 그리고 Hardware Ray Tracing까지 다중 계층 트레이싱을 수행하여 고품질 반사를 생성합니다.

### 핵심 특징

| 특성 | 값 | 설명 |
|------|-----|------|
| **Threadgroup Size** | 8x8 (2D) / 64 (1D) | Compute Shader 그룹 크기 |
| **최대 Reflection Bounces** | 설정 가능 | 다중 반사 지원 |
| **최대 Refraction Bounces** | 설정 가능 | 굴절 트레이싱 지원 |
| **Downsample Factor** | 설정 가능 | 품질/성능 트레이드오프 |
| **Reflection Passes** | 3 | Opaque, SingleLayerWater, FrontLayerTranslucency |

### 반사 렌더링 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Lumen Reflections Pipeline                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. Tile Classification & Ray Generation                               │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - 반사가 필요한 픽셀 분류                          │            │
│      │  - 러프니스 기반 콘 각도 계산                       │            │
│      │  - Importance Sampling으로 Ray 방향 결정           │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓                                               │
│   2. Screen Space Tracing                                               │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - HZB 기반 계층적 트레이싱                         │            │
│      │  - History Scene Color 재사용                       │            │
│      │  - Hair Strands Screen Trace (선택적)              │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓ Miss                                          │
│   3. Trace Compaction                                                   │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - Screen Trace Miss된 Ray 수집                    │            │
│      │  - Wave Ops로 효율적 압축                          │            │
│      │  - Material ID 정렬 (선택적)                       │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓                                               │
│   4. Mesh SDF / Global SDF Tracing                                      │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - Mesh SDF Cards 트레이싱                         │            │
│      │  - Heightfield 트레이싱                            │            │
│      │  - Global SDF Voxel 트레이싱                       │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓ Miss                                          │
│   5. Far Field / Radiance Cache / Sky                                   │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - Far Field Hardware Ray Tracing (선택적)         │            │
│      │  - Radiance Cache 보간 (선택적)                    │            │
│      │  - Skylight Fallback                               │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓                                               │
│   6. Denoising & Resolve                                                │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - Temporal Denoising                              │            │
│      │  - Spatial Filtering                               │            │
│      │  - Final Composition                               │            │
│      └────────────────────────────────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 Core Data Structures

### FReflectionTracingParameters

반사 트레이싱을 위한 주요 파라미터:

```cpp
// LumenReflections.h:48
BEGIN_SHADER_PARAMETER_STRUCT(FLumenReflectionTracingParameters, )
    SHADER_PARAMETER(FIntPoint, ReflectionDownsampleFactorXY)
    SHADER_PARAMETER(FIntPoint, ReflectionTracingViewMin)
    SHADER_PARAMETER(FIntPoint, ReflectionTracingViewSize)
    SHADER_PARAMETER(FIntPoint, ReflectionTracingBufferSize)
    SHADER_PARAMETER(FVector2f, ReflectionTracingBufferInvSize)
    SHADER_PARAMETER(float, MaxRayIntensity)

    SHADER_PARAMETER(uint32, ReflectionPass)
    SHADER_PARAMETER(uint32, UseJitter)
    SHADER_PARAMETER(uint32, UseHighResSurface)
    SHADER_PARAMETER(uint32, MaxReflectionBounces)
    SHADER_PARAMETER(uint32, MaxRefractionBounces)

    SHADER_PARAMETER(uint32, ReflectionsStateFrameIndex)
    SHADER_PARAMETER(uint32, ReflectionsStateFrameIndexMod8)
    SHADER_PARAMETER(uint32, ReflectionsRayDirectionFrameIndex)

    SHADER_PARAMETER(float, NearFieldMaxTraceDistance)
    SHADER_PARAMETER(float, NearFieldMaxTraceDistanceDitherScale)
    SHADER_PARAMETER(float, NearFieldSceneRadius)
    SHADER_PARAMETER(float, FarFieldMaxTraceDistance)

    SHADER_PARAMETER_RDG_TEXTURE(Texture2D<float4>, RayBuffer)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D<uint>, RayTraceDistance)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, DownsampledDepth)

    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, TraceHit)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, TraceRadiance)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, TraceMaterialId)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, TraceBookmark)

    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float3>, RWTraceRadiance)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float>, RWTraceHit)

    SHADER_PARAMETER_STRUCT_REF(FBlueNoise, BlueNoise)
END_SHADER_PARAMETER_STRUCT()
```

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenReflections.h:48-91`

### FRayData

레이 트레이싱을 위한 레이 데이터:

```hlsl
// LumenReflectionCommon.ush:105
struct FRayData
{
    float3 Direction;           // Ray 방향 벡터
    float PDF;                  // Probability Density Function
    float ConeHalfAngle;        // 콘 반각 (러프니스 기반)

    // Radiance Cache 관련
    float RadianceCacheMaxTraceDistance;
    bool bUseRadianceCache;
    bool bIsFirstPersonPixel;
};
```

### Reflection Pass 타입

```hlsl
// LumenReflectionCommon.ush:26
// ReflectionPass 값:
// 0: Opaque (불투명)
// 1: SingleLayerWater (단일 레이어 물)
// 2: FrontLayerTranslucency (전면 레이어 반투명)
uint ReflectionPass;
```

---

## 🔬 Ray Generation

### Screen Tile Jittering

시간에 따른 지터링으로 다운샘플링된 반사 품질 향상:

```hlsl
// LumenReflectionCommon.ush:47
float2 GetScreenTileJitter(uint2 DownsampledScreenCoord)
{
    if (ReflectionDownsampleFactorXY.x > 1)
    {
        if (ReflectionDownsampleFactorXY.y > 1)
        {
            // 2x2 다운샘플 - 4 Rooks 샘플링 패턴
            uint2 CellIndex = DownsampledScreenCoord % 2;
            uint LinearIndex = CellIndex.x + CellIndex.y * 2;
            LinearIndex = (LinearIndex + ReflectionsStateFrameIndex) % 4;

            uint2 Jitter;
            Jitter.x = LinearIndex & 0x02 ? 1 : 0;
            Jitter.y = LinearIndex & 0x01 ? 0 : 1;

            return Jitter;
        }
        else
        {
            // 2x1 다운샘플
            return float2((DownsampledScreenCoord.y + ReflectionsStateFrameIndex) % 2, 0);
        }
    }
    return 0;
}
```

**Jittering 패턴:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    4 Rooks Sampling Pattern                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Frame 0:              Frame 1:              Frame 2:              ... │
│   ┌───┬───┐             ┌───┬───┐             ┌───┬───┐                │
│   │ X │   │             │   │ X │             │   │   │                │
│   ├───┼───┤             ├───┼───┤             ├───┼───┤                │
│   │   │ X │             │ X │   │             │ X │   │                │
│   └───┴───┘             └───┴───┘             └───┴───┘                │
│                                                                         │
│   4프레임에 걸쳐 2x2 영역의 모든 픽셀 커버                              │
│   → Temporal Accumulation으로 풀 해상도 반사 복원                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Ray Distance Encoding

히트 거리와 히트 여부를 단일 float에 인코딩:

```hlsl
// LumenReflectionCommon.ush:88
float EncodeRayDistance(float HitDistance, bool bHit)
{
    HitDistance = max(HitDistance, 0.0f);
    return HitDistance * (bHit ? -1.0f : 1.0f);  // 부호로 히트 여부 표시
}

float DecodeRayDistance(float Encoded, out bool bHit)
{
    bHit = asuint(Encoded) & 0x80000000;  // MSB로 히트 여부 확인
    return abs(Encoded);
}
```

### Smooth Bias 적용

낮은 러프니스에서 Specular 품질 향상:

```hlsl
// LumenReflectionCommon.ush:232
float ApplySmoothBias(float Roughness)
{
    float NewRoughness = Roughness;

    if (ReflectionSmoothBias > 0)
    {
        // SmoothBias까지 SmoothStep 함수, 그 위는 원래 값
        float X = saturate(Roughness / ReflectionSmoothBias);
        NewRoughness = Roughness * X * X * (3.0 - 2.0 * X);
    }

    // Opaque와 Translucent만 Denoiser 적용, 나머지는 Mirror
    return ReflectionPass == 0 || ReflectionPass == 2 ? NewRoughness : 0.0f;
}
```

---

## 🖥️ Screen Space Tracing

### HZB Screen Trace

화면 공간에서의 계층적 트레이싱:

```hlsl
// LumenReflectionTracing.usf:67
[numthreads(REFLECTION_THREADGROUP_SIZE_1D, 1, 1)]
void ReflectionTraceScreenTexturesCS(
    uint GroupId : SV_GroupID,
    uint GroupThreadId : SV_GroupThreadID)
{
    FReflectionTileData TileData;
    const uint2 TmpReflectionTracingCoord = GetReflectionTracingScreenCoord(
        GroupId, GroupThreadId, TileData).xy;
    const FReflectionTracingCoord ReflectionTracingCoord =
        GetReflectionTracingCoord(TmpReflectionTracingCoord, TileData.ClosureIndex);

    if (all(ReflectionTracingCoord.Coord < ReflectionTracingViewMin + ReflectionTracingViewSize))
    {
        float2 ScreenUV = GetScreenUVFromReflectionTracingCoord(ReflectionTracingCoord.Coord);
        float SceneDepth = DownsampledDepth.Load(int4(ReflectionTracingCoord.CoordFlatten, 0)).x;

        if (SceneDepth > 0.0f)
        {
            float3 TranslatedWorldPosition = GetTranslatedWorldPositionFromScreenUV(ScreenUV, SceneDepth);
            FRayData RayData = GetRayData(ReflectionTracingCoord.CoordFlatten);

            // Normal bias로 self-intersection 방지
            float3 TranslatedRayOrigin = TranslatedWorldPosition;
            {
                float2 CornerScreenUV = ScreenUV + .5f * View.BufferSizeAndInvSize.zw;
                const float3 WorldNormal = GetGBufferData(ScreenUV).WorldNormal;
                float NormalBias = abs(dot(CornerPosition - TranslatedWorldPosition, WorldNormal)) * 2.0f;
                TranslatedRayOrigin += NormalBias * WorldNormal;
            }

            bool bHit, bUncertain;
            float3 HitUVz, LastVisibleHitUVz;
            float HitTileZ;

            // HZB 트레이싱
            TraceScreen(
                TranslatedRayOrigin,
                RayData.Direction,
                RayData.RadianceCacheMaxTraceDistance,
                HZBUvFactorAndInvFactor,
                MaxHierarchicalScreenTraceIterations,
                RelativeDepthThickness,
                0,
                MinimumTracingThreadOccupancy,
                bHit, bUncertain, HitUVz, LastVisibleHitUVz, HitTileZ);

            bHit = bHit && !bUncertain;

            if (bHit)
            {
                // Temporal 검증
                float3 HitHistoryScreenPosition = GetHistoryScreenPosition(HitScreenPosition, HitScreenUV, HitDeviceZ);
                float Vignette = min(
                    ComputeHitVignetteFromScreenPos(HitScreenPosition),
                    ComputeHitVignetteFromScreenPos(HitHistoryScreenPosition.xy));

                if (Vignette < Noise)
                {
                    bHit = false;  // 화면 가장자리 히트 무시
                }

                if (bHit)
                {
                    // History Scene Color 샘플링
                    float2 HitHistoryScreenUV = clamp(
                        HitHistoryScreenPosition.xy * PrevScreenPositionScaleBias.xy + PrevScreenPositionScaleBias.zw,
                        PrevSceneColorBilinearUVMin, PrevSceneColorBilinearUVMax);
                    float3 Lighting = SampleScreenColor(PrevSceneColorTexture, GlobalPointClampedSampler, HitHistoryScreenUV).xyz
                        * PrevSceneColorPreExposureCorrection;

                    // Clamp 강도
                    float MaxLighting = max3(Lighting.x, Lighting.y, Lighting.z);
                    if (MaxLighting > MaxRayIntensity)
                    {
                        Lighting *= MaxRayIntensity / MaxLighting;
                    }

                    RWTraceRadiance[ReflectionTracingCoord.CoordFlatten] = Lighting;
                }
            }

            // Hit 거리 기록
            RWTraceHit[ReflectionTracingCoord.CoordFlatten] = EncodeRayDistance(HitDistance, bHit);
        }
    }
}
```

---

## 📦 Trace Compaction

### Wave Operations 기반 압축

Screen Trace에서 Miss된 Ray들을 효율적으로 수집:

```hlsl
// LumenReflectionTracing.usf:294
#if WAVE_OPS
groupshared uint SharedGroupSum;
#else
groupshared uint SharedTraceTexelAllocator;
groupshared uint SharedTraceTexels[THREADGROUP_SIZE];
#endif

[numthreads(THREADGROUP_SIZE, 1, 1)]
void ReflectionCompactTracesCS(
    uint GroupId : SV_GroupID,
    uint GroupThreadId : SV_GroupThreadID)
{
    if (GroupThreadId == 0)
    {
#if WAVE_OPS
        SharedGroupSum = 0;
#else
        SharedTraceTexelAllocator = 0;
#endif
    }

    GroupMemoryBarrierWithGroupSync();

    // Screen Trace 결과 확인
    uint TraceTexelForThisThread = 0;
    bool bTraceValid = false;

    if (ReflectionTileIndex < ReflectionTracingTileIndirectArgs[0])
    {
        FReflectionTracingCoord ReflectionTracingCoord = /* ... */;
        float SceneDepth = DownsampledDepth.Load(/* ... */).x;

        bool bHit;
        float TraceHitDistance = DecodeRayDistance(TraceHit[ReflectionTracingCoord.CoordFlatten].x, bHit);

        // Compaction 조건
        #if TRACE_COMPACTION_MODE == TRACE_COMPACTION_MODE_HIT_LIGHTING
            // Hit Lighting 필요한 경우
            const FTraceMaterialId MaterialId = UnpackTraceMaterialId(TraceMaterialId[ReflectionTracingCoord.CoordFlatten]);
            bAcceptTrace = bHit && MaterialId.bNeedsHitLightingPass;
        #elif TRACE_COMPACTION_MODE == TRACE_COMPACTION_MODE_FAR_FIELD
            bAcceptTrace = !bHit;  // Far Field 트레이싱 필요
        #else
            bAcceptTrace = !bHit;  // 일반 SDF 트레이싱 필요
        #endif

        if (SceneDepth > 0 && bAcceptTrace && TraceHitDistance <= CompactionMaxTraceDistance)
        {
#if WAVE_OPS
            bTraceValid = true;
            TraceTexelForThisThread = EncodeTraceTexel(ReflectionTracingCoord.Coord, ReflectionTracingCoord.ClosureIndex);
#else
            uint SharedTexelOffset;
            InterlockedAdd(SharedTraceTexelAllocator, 1, SharedTexelOffset);
            SharedTraceTexels[SharedTexelOffset] = EncodeTraceTexel(ReflectionTracingCoord.Coord, ReflectionTracingCoord.ClosureIndex);
#endif
        }
    }

    GroupMemoryBarrierWithGroupSync();

#if WAVE_OPS
    // Wave Operations로 효율적 압축
    const uint LaneIndex = WaveGetLaneIndex();
    const uint OffsetInWave = WavePrefixCountBits(bTraceValid);
    uint OffsetInGroup = 0;

    if (LaneIndex == WaveGetLaneCount() - 1)
    {
        const uint ThisWaveSum = OffsetInWave + (bTraceValid ? 1 : 0);
        InterlockedAdd(SharedGroupSum, ThisWaveSum, OffsetInGroup);
    }
    OffsetInGroup = WaveReadLaneAt(OffsetInGroup, WaveGetLaneCount() - 1) + OffsetInWave;

    GroupMemoryBarrierWithGroupSync();

    if (GroupThreadId == 0)
    {
        InterlockedAdd(RWCompactedTraceTexelAllocator[0], SharedGroupSum, SharedGlobalTraceTexelStartOffset);
    }

    GroupMemoryBarrierWithGroupSync();

    if (bTraceValid)
    {
        RWCompactedTraceTexelData[SharedGlobalTraceTexelStartOffset + OffsetInGroup] = TraceTexelForThisThread;
    }
#endif
}
```

**Compaction 흐름:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Trace Compaction Pipeline                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Before Compaction:                                                    │
│   ┌───┬───┬───┬───┬───┬───┬───┬───┐                                   │
│   │ H │ M │ M │ H │ M │ H │ H │ M │  H=Hit, M=Miss                    │
│   └───┴───┴───┴───┴───┴───┴───┴───┘                                   │
│     0   1   2   3   4   5   6   7                                       │
│                                                                         │
│   After Compaction (Miss만 수집):                                       │
│   ┌───┬───┬───┬───┐                                                    │
│   │ 1 │ 2 │ 4 │ 7 │  ← 압축된 인덱스                                  │
│   └───┴───┴───┴───┘                                                    │
│     0   1   2   3                                                       │
│                                                                         │
│   장점:                                                                  │
│   - 빈 Work 제거 → GPU Occupancy 향상                                  │
│   - Material별 정렬 가능 → Coherent 메모리 접근                         │
│   - Indirect Dispatch로 동적 워크로드 처리                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Software Tracing (Mesh SDF / Global SDF)

### Mesh SDF Tracing

압축된 Ray들에 대해 Mesh SDF 트레이싱:

```hlsl
// LumenReflectionTracing.usf:600
void TraceMeshSDFs(FReflectionTracingCoord ReflectionTracingCoord, float TraceHitDistance)
{
    float2 ScreenUV = GetScreenUVFromReflectionTracingCoord(ReflectionTracingCoord.Coord);
    float SceneDepth = DownsampledDepth.Load(int4(ReflectionTracingCoord.CoordFlatten, 0)).x;

    float3 WorldPosition = GetWorldPositionFromScreenUV(ScreenUV, SceneDepth);
    float3 TranslatedWorldPosition = GetTranslatedWorldPositionFromScreenUV(ScreenUV, SceneDepth);
    FRayData RayData = GetRayData(ReflectionTracingCoord.CoordFlatten);

    // Surface Bias 적용
    float3 SamplePosition = WorldPosition + SurfaceBias * RayData.Direction;

    // Ray Cone 설정
    FRayCone RayCone = (FRayCone)0;
    RayCone.SpreadAngle = View.EyeToPixelSpreadAngle;
    RayCone = PropagateRayCone(RayCone, RayData.ConeHalfAngle, SceneDepth);

    // Cone Trace 입력 설정
    FConeTraceInput TraceInput;
    TraceInput.Setup(SamplePosition, SampleTranslatedPosition, RayData.Direction,
        RayCone.SpreadAngle, 0.0f, max(TraceHitDistance - PullbackForSurfaceExpand, 0.0f),
        RayData.RadianceCacheMaxTraceDistance, 1.0f);
    TraceInput.bHiResSurface = UseHighResSurface != 0;
    TraceInput.VoxelTraceStartDistance = MaxMeshSDFTraceDistance;

    // Culling Grid에서 오브젝트 가져오기
    uint CardGridCellIndex = ComputeCardGridCellIndex(
        ReflectionTracingCoord.Coord * ReflectionDownsampleFactorXY, SceneDepth);
    TraceInput.NumMeshSDFs = NumGridCulledMeshSDFObjects[CardGridCellIndex];
    TraceInput.MeshSDFStartOffset = GridCulledMeshSDFObjectStartOffsetArray[CardGridCellIndex];

    // Mesh SDF Cards 트레이싱
    FConeTraceResult TraceResult;
    ConeTraceLumenSceneCards(TraceInput, TraceResult);

    // Heightfield 트레이싱
    TraceInput.NumHeightfields = NumGridCulledHeightfieldObjects[CardGridCellIndex];
    TraceInput.HeightfieldStartOffset = GridCulledHeightfieldObjectStartOffsetArray[CardGridCellIndex];
    ConeTraceLumenSceneHeightfields(TraceInput, TraceResult);

    // Hair Voxel 트레이싱 (선택적)
    #if USE_HAIRSTRANDS_VOXEL
    TraceHairVoxels(/* ... */);
    #endif

    // Skylight Leaking 추가
    Lighting += GetSkylightLeakingForReflections(RayData.Direction,
        TraceResult.GeometryWorldNormal, OpaqueHitDistance) * View.PreExposure;

    // 결과 기록
    RWTraceRadiance[ReflectionTracingCoord.CoordFlatten] = Lighting;
    RWTraceHit[ReflectionTracingCoord.CoordFlatten] = EncodeRayDistance(OpaqueHitDistance, bHit);
}
```

### Global SDF Voxel Tracing

원거리를 위한 Global SDF 트레이싱:

```hlsl
// LumenReflectionTracing.usf:735
void TraceVoxels(FReflectionTracingCoord ReflectionTracingCoord, float TraceHitDistance)
{
    float3 WorldPosition = GetWorldPositionFromScreenUV(ScreenUV, SceneDepth);
    FRayData RayData = GetRayData(ReflectionTracingCoord.CoordFlatten);

    FConeTraceInput TraceInput;
    TraceInput.Setup(SamplePosition, SampleTranslatedPosition, RayData.Direction,
        RayCone.SpreadAngle, 0.0f, 0.0f, RayData.RadianceCacheMaxTraceDistance, 1.0f);

    // Surface Expand를 위한 Pullback
    uint ClipmapForSurfaceExpand = ComputeGlobalDistanceFieldClipmapIndex(
        TranslatedWorldPosition + TraceHitDistance * RayData.Direction);
    float PullbackForSurfaceExpand = GlobalVolumeTranslatedCenterAndExtent[ClipmapForSurfaceExpand].w *
        GlobalVolumeTexelSize * 4.0f;
    TraceInput.VoxelTraceStartDistance = max(TraceHitDistance - PullbackForSurfaceExpand, 0.0f);

    // Dithered Step Factor (mirror 반사에서 계단 현상 방지)
    float StepFactorNoise = lerp(.95f, 1.0f / .95f,
        InterleavedGradientNoise(ReflectionTracingCoord.Coord, ReflectionsStateFrameIndexMod8));
    TraceInput.SDFStepFactor = lerp(StepFactorNoise, 1.0f,
        saturate(RayData.ConeHalfAngle / (PI / 256.0f)));

    // Global SDF 트레이싱
    FConeTraceResult TraceResult = (FConeTraceResult)0;
    TraceResult.Transparency = 1;
    TraceResult.OpaqueHitDistance = TraceInput.MaxTraceDistance;

    #if TRACE_GLOBAL_SDF
    ConeTraceLumenSceneVoxels(TraceInput, TraceResult);
    #endif

    bool bHit = TraceResult.Transparency <= .5f;

    if (!bHit)
    {
        // Radiance Cache Fallback
        #if RADIANCE_CACHE
        if (RayData.RadianceCacheMaxTraceDistance < MaxTraceDistance * .99f)
        {
            FRadianceCacheCoverage Coverage = GetRadianceCacheCoverage(
                WorldPosition, RayData.Direction, Noise);
            SampleRadianceCacheAndApply(Coverage, WorldPosition, RayData.Direction,
                RayData.ConeHalfAngle, 0.5f, TraceResult.Lighting, TraceResult.Transparency);
        }
        else
        #endif
        {
            // Sky Fallback
            ApplySkylightToTraceResult(RayData.Direction, TraceResult);
        }
    }

    // 결과 기록
    RWTraceRadiance[ReflectionTracingCoord.CoordFlatten] = TraceResult.Lighting;
    RWTraceHit[ReflectionTracingCoord.CoordFlatten] = EncodeRayDistance(TraceHitDistance, bHit);
}
```

---

## ⚡ Hardware Ray Tracing

### Hit Lighting

정확한 머티리얼 평가를 위한 Hardware Ray Tracing:

```cpp
// LumenReflections.h:175
extern void RenderLumenHardwareRayTracingReflections(
    FRDGBuilder& GraphBuilder,
    const FSceneTextures& SceneTextures,
    const FSceneTextureParameters& SceneTextureParameters,
    const FScene* Scene,
    const FViewInfo& View,
    const FLumenCardTracingParameters& TracingParameters,
    const FLumenReflectionTracingParameters& ReflectionTracingParameters,
    const FLumenReflectionTileParameters& ReflectionTileParameters,
    float MaxTraceDistance,
    bool bUseRadianceCache,
    const LumenRadianceCache::FRadianceCacheInterpolationParameters& RadianceCacheParameters,
    bool bSampleSceneColorAtHit,
    EDiffuseIndirectMethod DiffuseIndirectMethod,
    ERDGPassFlags ComputePassFlags);
```

### Trace Compaction Modes

```cpp
// LumenReflections.h:134
enum ETraceCompactionMode
{
    Default,        // 일반 SDF 트레이싱 용
    FarField,       // Far Field HWRT 용
    HitLighting,    // Hit Lighting Pass 용

    MAX
};
```

---

## 🎨 Denoising & Resolve

### Temporal Denoising

시간에 따른 누적으로 노이즈 감소:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Reflection Denoising Pipeline                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. Temporal Filter                                                    │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - Motion Vectors 기반 Reprojection               │            │
│      │  - History Buffer와 블렌딩                         │            │
│      │  - Disocclusion 검출 및 처리                       │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓                                               │
│   2. Spatial Filter                                                     │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - Edge-Aware Bilateral Filter                    │            │
│      │  - Roughness 기반 필터 크기 조절                   │            │
│      │  - Normal/Depth 가중치                             │            │
│      └──────────────────┬─────────────────────────────────┘            │
│                         ↓                                               │
│   3. Resolve                                                            │
│      ┌────────────────────────────────────────────────────┐            │
│      │  - BRDF 적용                                       │            │
│      │  - Fresnel 계산                                    │            │
│      │  - Final Composition                              │            │
│      └────────────────────────────────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Composite Parameters

```cpp
// LumenReflections.h:30
namespace LumenReflections
{
    BEGIN_SHADER_PARAMETER_STRUCT(FCompositeParameters, )
        SHADER_PARAMETER(float, MaxRoughnessToTrace)
        SHADER_PARAMETER(float, MaxRoughnessToTraceForFoliage)
        SHADER_PARAMETER(float, InvRoughnessFadeLength)
        SHADER_PARAMETER(float, ReflectionSmoothBias)
    END_SHADER_PARAMETER_STRUCT()
}
```

---

## 🔧 Configuration

### 주요 설정 함수

```cpp
// LumenReflections.h:112
namespace LumenReflections
{
    bool UseFarField(const FSceneViewFamily& ViewFamily);
    bool UseHitLighting(const FViewInfo& View, EDiffuseIndirectMethod DiffuseIndirectMethod);
    bool UseTranslucentRayTracing(const FViewInfo& View);
    bool IsHitLightingForceEnabled(const FViewInfo& View, EDiffuseIndirectMethod DiffuseIndirectMethod);
    bool UseSurfaceCacheFeedback();
    bool UseScreenTraces(const FViewInfo& View);
    bool UseDistantScreenTraces(const FViewInfo& View, bool bUseFarField, bool bUseRadianceCache);
    float GetDistantScreenTraceStepOffsetBias();
    bool UseRadianceCache();
    bool UseRadianceCacheSkyVisibility();
    bool UseRadianceCacheStochasticInterpolation();

    float GetSampleSceneColorDepthTreshold();
    float GetSampleSceneColorNormalTreshold();
    float GetFarFieldSampleSceneColorDepthTreshold();
    float GetFarFieldSampleSceneColorNormalTreshold();

    uint32 GetMaxReflectionBounces(const FViewInfo& View);
    uint32 GetMaxRefractionBounces(const FViewInfo& View);
}
```

### Console Variables

```cpp
// Reflection Quality
r.Lumen.Reflections.ScreenTraces 1           // Screen Space Tracing 활성화
r.Lumen.Reflections.HardwareRayTracing 1     // HWRT 활성화
r.Lumen.Reflections.MaxBounces 1             // 최대 반사 횟수
r.Lumen.Reflections.DownsampleFactor 1       // 다운샘플 팩터

// Roughness
r.Lumen.Reflections.MaxRoughnessToTrace 0.4  // 트레이싱 최대 러프니스
r.Lumen.Reflections.SmoothBias 0.2           // Smooth Bias 값

// Radiance Cache
r.Lumen.Reflections.RadianceCache 1          // Radiance Cache 사용
r.Lumen.Reflections.RadianceCache.Stochastic 0  // 확률적 보간

// Denoising
r.Lumen.Reflections.Temporal 1               // Temporal Filter
r.Lumen.Reflections.Spatial 1                // Spatial Filter
```

---

## 💡 Performance Tips

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Performance Optimization                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ✅ 효율적인 방법:                                                     │
│   ─────────────────                                                     │
│                                                                         │
│   1. Downsample Factor 활용                                             │
│      - 2x Downsample = 4x 적은 Ray                                     │
│      - Temporal Jittering으로 품질 보상                                 │
│                                                                         │
│   2. MaxRoughnessToTrace 조절                                           │
│      - 높은 러프니스는 Screen Probe GI로 충분                           │
│      - 반사 필요한 영역만 트레이싱                                      │
│                                                                         │
│   3. Trace Compaction 활용                                              │
│      - 빈 Work 제거                                                     │
│      - Material 정렬로 Coherent Access                                 │
│                                                                         │
│   4. Screen Tracing 우선                                                │
│      - 가장 저렴한 트레이싱                                             │
│      - 많은 경우 충분한 품질                                            │
│                                                                         │
│   ❌ 피해야 할 것:                                                      │
│   ────────────────                                                      │
│                                                                         │
│   1. 과도한 MaxBounces                                                  │
│      - 각 Bounce마다 비용 누적                                          │
│      - 대부분 1 Bounce로 충분                                           │
│                                                                         │
│   2. 모든 픽셀에 HWRT                                                   │
│      - Surface Cache로 대부분 처리                                      │
│      - Hit Lighting은 필요한 경우만                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 References

- **소스 파일:**
  - `Engine/Source/Runtime/Renderer/Private/Lumen/LumenReflections.h`
  - `Engine/Source/Runtime/Renderer/Private/Lumen/LumenReflections.cpp`
  - `Engine/Source/Runtime/Renderer/Private/Lumen/LumenReflectionTracing.cpp`
  - `Engine/Shaders/Private/Lumen/LumenReflectionCommon.ush`
  - `Engine/Shaders/Private/Lumen/LumenReflectionTracing.usf`
  - `Engine/Shaders/Private/Lumen/LumenReflectionHardwareRayTracing.usf`

- **관련 문서:**
  - [Lumen Tracing](./LumenTracing.md)
  - [Surface Cache](./SurfaceCache.md)
  - [Radiance Cache](./RadianceCache.md)
  - [Screen Probe Gather](./ScreenProbe.md)
