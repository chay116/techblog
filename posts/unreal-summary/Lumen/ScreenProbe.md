---
title: "Lumen Screen Probe Gather 심층 분석"
date: "2025-12-03"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Lumen Screen Probe Gather 심층 분석

> Updated: 2025-12-03 — Screen Probe Gather 시스템 전체 문서화 + Radiance Cache 상호작용 섹션 추가

## 🧭 Overview

**Screen Probe Gather**는 Lumen의 핵심 Final Gather 기법으로, 화면 공간에 **다운샘플된 프로브 그리드**를 배치하고 각 프로브에서 반구 방향으로 레이를 트레이싱하여 Diffuse Global Illumination을 계산합니다.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Screen Probe Gather Pipeline                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Probe Placement (16x16 픽셀당 1개 프로브)                                │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │  Uniform Grid + Adaptive Probes (depth discontinuity)      │         │
│     │  + Temporal Jitter (Hammersley)                             │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                               ↓                                              │
│  2. Ray Tracing per Probe (8x8 = 64 rays)                                   │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │  Screen Traces → Mesh SDF → Global SDF → Radiance Cache   │         │
│     │  Octahedral mapping for hemisphere directions               │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                               ↓                                              │
│  3. Filtering & Integration                                                  │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │  Spatial Filter → Temporal Filter → SH/Octahedral → BRDF  │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                               ↓                                              │
│  4. Upsample & Composite                                                    │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │  Bilinear/Stochastic Interpolation → Full Resolution       │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Screen Probe** | 화면 공간 16x16 픽셀 타일당 1개 배치되는 조명 수집 프로브 |
| **Octahedral Mapping** | 반구/구체 방향을 2D 텍스처로 매핑하는 방식 |
| **Adaptive Probes** | 깊이 불연속 영역에 추가 배치되는 프로브 |
| **Importance Sampling** | BRDF 기반 중요 방향 집중 샘플링 |
| **Radiance Cache** | 먼 거리 레이를 위한 월드 공간 캐시 |

---

## 🧱 핵심 상수 및 데이터 구조

### 셰이더 상수

**📂 위치:** `LumenScreenProbeCommon.ush:12`

```hlsl
#define PROBE_THREADGROUP_SIZE_2D 8
#define PROBE_THREADGROUP_SIZE_1D 64

// Irradiance 포맷
#define PROBE_IRRADIANCE_FORMAT_SH3 0   // 3차 SH
#define PROBE_IRRADIANCE_FORMAT_OCT 1   // Octahedral (기본)
#define IRRADIANCE_PROBE_RES 6          // Irradiance 해상도
#define IRRADIANCE_PROBE_WITH_BORDER_RES 8  // Border 포함
```

### 프로브 그리드 파라미터

**📂 위치:** `LumenScreenProbeCommon.ush:21`

```hlsl
// 트레이싱 해상도 (8 = 8x8 = 64 rays/probe)
uint ScreenProbeTracingOctahedronResolution;

// 필터링 후 Gather 해상도
uint ScreenProbeGatherOctahedronResolution;
uint ScreenProbeGatherOctahedronResolutionWithBorder;

// 다운샘플된 뷰포트 크기 (프로브 단위)
uint2 ScreenProbeViewSize;

// 프로브 아틀라스 크기
uint2 ScreenProbeAtlasViewSize;
uint2 ScreenProbeAtlasBufferSize;

// 다운샘플 팩터 (기본 16)
uint ScreenProbeDownsampleFactor;

// Uniform 프로브 개수
uint NumUniformScreenProbes;
uint MaxNumAdaptiveProbes;
```

### C++ CVars

**📂 위치:** `LumenScreenProbeGather.cpp`

```cpp
// 다운샘플 팩터 (픽셀 크기)
int32 GLumenScreenProbeDownsampleFactor = 16;  // r.Lumen.ScreenProbeGather.DownsampleFactor

// 트레이싱 해상도
int32 GLumenScreenProbeTracingOctahedronResolution = 8;  // 8x8 = 64 rays

// Adaptive 프로브 설정
int32 NumAdaptiveProbes = 8;  // Uniform 프로브당 adaptive 개수
float AdaptiveProbeAllocationFraction = 0.5f;  // 허용 비율

// 템포럴 필터
float MaxFramesAccumulated = 10.0f;  // 누적 프레임 수

// Importance Sampling
int32 GLumenScreenProbeDiffuseIntegralMethod = 0;  // 0=Preintegrated, 1=IS BRDF
```

---

## 📍 프로브 배치 시스템

### Uniform Grid + Jitter

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Probe Placement Grid                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ScreenProbeDownsampleFactor = 16                                          │
│                                                                              │
│   ┌────┬────┬────┬────┐    각 타일(16x16)에 1개 프로브                       │
│   │ P  │ P  │ P  │ P  │    P = Probe 위치                                   │
│   │ ·  │ ·  │ ·  │ ·  │    · = 타일 내 jitter 오프셋                        │
│   ├────┼────┼────┼────┤                                                     │
│   │ P  │ P  │ P  │ P  │    Jitter: Hammersley sequence                      │
│   │ ·  │ ·  │ ·  │ ·  │    프레임마다 다른 위치 → 템포럴 안정성              │
│   ├────┼────┼────┼────┤                                                     │
│   │ P  │ P  │ P  │ P  │    ScreenProbeViewSize = ViewSize / 16              │
│   │ ·  │ ·  │ ·  │ ·  │                                                     │
│   └────┴────┴────┴────┘                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Jitter 계산

**📂 위치:** `LumenScreenProbeCommon.ush:72`

```hlsl
uint2 GetScreenTileJitter(uint TemporalIndex)
{
    // Hammersley 시퀀스로 8프레임 주기 jitter
    return Hammersley16(TemporalIndex, 8, 0) * ScreenProbeDownsampleFactor;
}
```

### Adaptive Probe 배치

**📂 위치:** `LumenScreenProbeGather.usf:213`

```hlsl
float GetAdaptiveProbeInterpolationWeight(
    float2 ScreenCoord,
    float4 ScenePlane,
    float SceneDepth,
    bool bFoliage,
    uint2 AdaptiveProbeScreenPosition,
    float AdaptiveProbeDepth)
{
    // 평면 기반 가중치 계산
    float3 ProbePosition = GetWorldPositionFromScreenUV(..., AdaptiveProbeDepth);
    float PlaneDistance = abs(dot(float4(ProbePosition, -1), ScenePlane));
    float RelativeDepthDifference = abs(PlaneDistance / SceneDepth);

    float NewDepthWeight = exp2(
        (bFoliage ? ScreenProbeInterpolationDepthWeightForFoliage
                  : ScreenProbeInterpolationDepthWeight) * RelativeDepthDifference);

    // 거리 기반 가중치
    float2 DistanceToScreenProbe = abs(AdaptiveProbeScreenPosition - ScreenCoord);
    float NewCornerWeight = 1.0f - saturate(
        min(DistanceToScreenProbe.x, DistanceToScreenProbe.y) / ScreenProbeDownsampleFactor);

    return NewDepthWeight * NewCornerWeight;
}
```

---

## 🎯 프로브 레이 트레이싱

### 트레이싱 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Ray Tracing Cascade                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Screen Space Traces (HZB)                                               │
│     ├─ 가장 빠름, 화면 내 가시 표면만                                        │
│     └─ 불확실한 경우 다음 단계로                                            │
│                     ↓                                                        │
│  2. Mesh SDF Traces (선택적)                                                │
│     ├─ 개별 메시의 Signed Distance Field                                    │
│     └─ 중간 거리, 높은 품질                                                 │
│                     ↓                                                        │
│  3. Global SDF Traces                                                       │
│     ├─ 씬 전체 Clipmap 구조                                                 │
│     └─ 먼 거리까지 커버                                                     │
│                     ↓                                                        │
│  4. Radiance Cache                                                          │
│     ├─ 월드 공간 영구 캐시                                                  │
│     └─ 매우 먼 거리 또는 복잡한 영역                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Screen Space Trace

**📂 위치:** `LumenScreenProbeTracing.usf:55`

```hlsl
[numthreads(PROBE_THREADGROUP_SIZE_2D, PROBE_THREADGROUP_SIZE_2D, 1)]
void ScreenProbeTraceScreenTexturesCS(...)
{
    uint ProbeTracingResolution = ScreenProbeTracingOctahedronResolution;
    uint2 ScreenProbeAtlasCoord = DispatchThreadId.xy / ProbeTracingResolution;
    uint2 TraceTexelCoord = DispatchThreadId.xy - ScreenProbeAtlasCoord * ProbeTracingResolution;

    // 프로브 위치 및 방향 계산
    float2 ScreenUV = GetScreenUVFromScreenProbePosition(ScreenProbeScreenPosition);
    float SceneDepth = GetScreenProbeDepth(ScreenProbeAtlasCoord);
    float3 TranslatedWorldPosition = GetTranslatedWorldPositionFromScreenUV(ScreenUV, SceneDepth);

    float3 RayWorldDirection = 0;
    float TraceDistance = MaxTraceDistance;
    float ConeHalfAngle = 0;

    GetScreenProbeTexelRay(TraceBufferCoord, TraceTexelCoord, ScreenTileCoord,
                           TranslatedWorldPosition, RayWorldDirection,
                           TraceDistance, ConeHalfAngle);

    // Normal bias for self-intersection 방지
    float NormalBias = ...;
    float3 TranslatedRayOrigin = TranslatedWorldPosition + NormalBias * ScreenProbeNormal;

    // HZB 트레이싱
    #if HIERARCHICAL_SCREEN_TRACING
        TraceScreen(TranslatedRayOrigin, RayWorldDirection, TraceDistance,
                    HZBUvFactorAndInvFactor, MaxHierarchicalScreenTraceIterations,
                    RelativeDepthThickness * DepthThresholdScale,
                    /* out */ bHit, bUncertain, HitUVz, ...);
    #endif

    // 히트 시 Surface Cache에서 radiance 샘플링
    if (bHit)
    {
        // Surface Cache lighting 조회
        ...
    }
}
```

### 레이 방향 인코딩 (Octahedral)

```hlsl
// Octahedral 좌표를 반구 방향으로 변환
float3 OctahedronToHemisphereLocal(float2 Oct)
{
    float3 N;
    N.x = Oct.x - Oct.y;
    N.y = Oct.x + Oct.y - 1.0f;
    N.z = 1.0f - abs(N.x) - abs(N.y);
    return normalize(N);
}
```

### Ray Distance 인코딩

**📂 위치:** `LumenScreenProbeCommon.ush:239`

```hlsl
uint EncodeProbeRayDistance(float HitDistance, bool bHit, bool bMoving, bool bReachedRadianceCache)
{
    HitDistance = max(HitDistance, 0.0f);

    uint EncodedRay = 0;

    // Sign bit와 mantissa LSB에 추가 정보 인코딩
    EncodedRay = asuint(HitDistance) & 0x7FFFFFFC;
    EncodedRay |= bHit ? (1 << 0) : 0;
    EncodedRay |= bMoving ? (1 << 1) : 0;
    EncodedRay |= bReachedRadianceCache ? (1 << 31) : 0;

    return EncodedRay;
}

struct FProbeRayDistance
{
    float HitDistance;
    bool bHit;
    bool bMoving;
    bool bReachedRadianceCache;
};

FProbeRayDistance DecodeProbeRayDistance(uint Encoded)
{
    FProbeRayDistance Result;
    Result.bHit = (Encoded & (1 << 0)) != 0;
    Result.bMoving = (Encoded & (1 << 1)) != 0;
    Result.bReachedRadianceCache = (Encoded & (1 << 31)) != 0;
    Result.HitDistance = asfloat(Encoded & 0x7FFFFFFC);
    return Result;
}
```

---

## 🔄 필터링 시스템

### Composite Traces with Scatter

**📂 위치:** `LumenScreenProbeFiltering.usf:30`

```hlsl
groupshared uint SharedAccumulators[THREADGROUP_SIZE * THREADGROUP_SIZE][6];

[numthreads(THREADGROUP_SIZE, THREADGROUP_SIZE, 1)]
void ScreenProbeCompositeTracesWithScatterCS(...)
{
    uint2 ScreenProbeAtlasCoord = GroupId.xy;

    if (SceneDepth > 0)
    {
        uint ThreadIndex = ProbeTexelCoord.y * ScreenProbeGatherOctahedronResolution
                          + ProbeTexelCoord.x;

        // 공유 메모리 초기화
        SharedAccumulators[ThreadIndex][0] = 0;  // R
        SharedAccumulators[ThreadIndex][1] = 0;  // G
        SharedAccumulators[ThreadIndex][2] = 0;  // B
        SharedAccumulators[ThreadIndex][3] = 0;  // ValidSample 플래그
        SharedAccumulators[ThreadIndex][4] = 0;  // Moving 가중치
        SharedAccumulators[ThreadIndex][5] = asuint(GetProbeMaxHitDistance());  // MinHitDistance

        GroupMemoryBarrierWithGroupSync();

        // Importance Sampling된 방향에서 원래 gather 텍셀로 scatter
        #if STRUCTURED_IMPORTANCE_SAMPLING
            uint RayInfo = StructuredImportanceSampledRayInfosForTracing[TraceBufferCoord];
            uint2 RayTexelCoord;
            uint RayLevel;
            UnpackRayInfo(RayInfo, RayTexelCoord, RayLevel);
            uint MipSize = MaxImportanceSamplingOctahedronResolution >> RayLevel;
        #else
            uint2 RayTexelCoord = TracingTexelCoord;
            uint MipSize = ScreenProbeTracingOctahedronResolution;
        #endif

        float SampleWeight = (float)ScreenProbeGatherOctahedronResolution / MipSize * ...;

        // Radiance 클램핑 및 양자화
        float3 Lighting = TraceRadiance.Load(...).xyz * SampleWeight;
        if (max3(Lighting) > MaxRayIntensity)
            Lighting *= MaxRayIntensity / max3(Lighting);

        uint3 QuantizedLighting = Lighting * LightingQuantizeScale;

        // Atomic 누적
        InterlockedAdd(SharedAccumulators[ThreadIndex][0], QuantizedLighting.x);
        InterlockedAdd(SharedAccumulators[ThreadIndex][1], QuantizedLighting.y);
        InterlockedAdd(SharedAccumulators[ThreadIndex][2], QuantizedLighting.z);
        SharedAccumulators[ThreadIndex][3] = 1;

        // Moving 및 HitDistance
        InterlockedAdd(SharedAccumulators[ThreadIndex][4], MovingWeight);
        InterlockedMin(SharedAccumulators[ThreadIndex][5], asuint(HitDistance));

        GroupMemoryBarrierWithGroupSync();

        // 최종 결과 출력
        float3 FinalLighting = float3(SharedAccumulators[...]) * InvLightingQuantizeScale;
        RWScreenProbeRadiance[GatherTexelCoord] = FinalLighting;
        RWScreenProbeHitDistance[GatherTexelCoord] = EncodeProbeHitDistanceForFiltering(MinHitDistance);
        RWScreenProbeTraceMoving[GatherTexelCoord] = TexelMoving;
    }
}
```

### Spatial Filter

**📂 위치:** `LumenScreenProbeFiltering.cpp`

```cpp
// CVar
int32 GLumenScreenProbeSpatialFilter = 1;  // r.Lumen.ScreenProbeGather.SpatialFilterProbes

// 인접 프로브에서 radiance를 공간적으로 필터링
// 노이즈 감소 목적
```

### Temporal Filter

**📂 위치:** `LumenScreenProbeFiltering.usf:190`

```hlsl
float4 HistoryScreenPositionScaleBias;
float4 HistoryUVMinMax;
float ProbeTemporalFilterHistoryWeight;
float HistoryDistanceThreshold;

Texture2D<uint> HistoryScreenProbeSceneDepth;
Texture2D<float3> HistoryScreenProbeRadiance;
Texture2D<float3> HistoryScreenProbeTranslatedWorldPosition;

// 이전 프레임 프로브와 현재 프레임 blend
// MaxFramesAccumulated 기반 exponential moving average
```

---

## 🌐 Irradiance 포맷

### SH3 (3차 Spherical Harmonics)

```cpp
// GLumenScreenProbeIrradianceFormat = 0

// 장점:
// - 방향 정보 보존
// - Bent Normal과 잘 동작

// 단점:
// - 더 많은 메모리 및 연산
// - 약간 느림
```

### Octahedral (기본)

```cpp
// GLumenScreenProbeIrradianceFormat = 1

// 장점:
// - 더 빠름
// - 메모리 효율적

// 단점:
// - ShortRangeAO + BentNormal 조합 시 SH3로 폴백

constexpr uint32 IrradianceProbeRes = 6;
constexpr uint32 IrradianceProbeWithBorderRes = 8;  // 6 + 2 border
```

---

## 📊 프로브 G-Buffer

### 프로브 머티리얼 데이터

**📂 위치:** `LumenScreenProbeGather.usf:54`

```hlsl
struct FScreenProbeMaterial
{
    float3 WorldNormal;
    float SceneDepth;
    bool bIsValid;
    bool bHasBackfaceDiffuse;  // Two-sided foliage
    bool bHair;
};
```

### 다운샘플된 프로브 데이터

```hlsl
RWTexture2D<uint> RWScreenProbeSceneDepth;       // 깊이 (sign bit = unlit)
RWTexture2D<UNORM float2> RWScreenProbeWorldNormal;  // 노멀 (octahedral)
RWTexture2D<uint> RWScreenProbeWorldSpeed;       // 속도 + 플래그
RWTexture2D<float4> RWScreenProbeTranslatedWorldPosition;  // 월드 위치
```

### Speed 인코딩

**📂 위치:** `LumenScreenProbeCommon.ush:165`

```hlsl
uint EncodeScreenProbeSpeed(float ProbeSpeed, bool bTwoSidedFoliage, bool bHair)
{
    // f16으로 저장, sign bit와 mantissa LSB에 플래그
    // 0111 1111 1111 1110
    return (f32tof16(ProbeSpeed) & 0x7FFE)
         | (bTwoSidedFoliage ? 0x8000 : 0)
         | (bHair ? 0x1 : 0);
}

bool GetScreenProbeIsTwoSidedFoliage(uint2 ScreenProbeAtlasCoord)
{
    uint Encoded = ScreenProbeWorldSpeed.Load(...);
    return (Encoded & 0x8000) != 0;
}

bool GetScreenProbeIsHair(uint2 ScreenProbeAtlasCoord)
{
    uint Encoded = ScreenProbeWorldSpeed.Load(...);
    return (Encoded & 0x1) != 0;
}
```

---

## 🔝 업샘플링

### Interpolation Weight 계산

**📂 위치:** `LumenScreenProbeGather.usf:142`

```hlsl
void CalculateUniformUpsampleInterpolationWeights(
    float2 ScreenCoord,
    float2 NoiseOffset,
    float3 WorldPosition,
    float SceneDepth,
    float3 WorldNormal,
    uniform bool bIsUpsamplePass,
    bool bFoliage,
    out uint2 ScreenTileCoord00,
    out float4 InterpolationWeights)
{
    // 스크린 타일 좌표 계산
    uint2 ScreenProbeFullResScreenCoord = clamp(
        ScreenCoord.xy - View.ViewRectMin.xy - GetScreenTileJitter(SCREEN_TEMPORAL_INDEX) + NoiseOffset,
        0.0f, View.ViewSizeAndInvSize.xy - 1.0f);
    ScreenTileCoord00 = min(ScreenProbeFullResScreenCoord / ScreenProbeDownsampleFactor,
                            (uint2)ScreenProbeViewSize - 2);

    // Bilinear 가중치
    uint BilinearExpand = 1;
    float2 BilinearWeights = (ScreenProbeFullResScreenCoord - ScreenTileCoord00 * ScreenProbeDownsampleFactor + BilinearExpand)
                           / (float)(ScreenProbeDownsampleFactor + 2 * BilinearExpand);

    // 4 코너 깊이 로드
    float4 CornerDepths;
    CornerDepths.x = GetScreenProbeDepth(ScreenTileCoord00);
    CornerDepths.y = GetScreenProbeDepth(ScreenTileCoord00 + int2(1, 0));
    CornerDepths.z = GetScreenProbeDepth(ScreenTileCoord00 + int2(0, 1));
    CornerDepths.w = GetScreenProbeDepth(ScreenTileCoord00 + int2(1, 1));

    InterpolationWeights = float4(
        (1 - BilinearWeights.y) * (1 - BilinearWeights.x),
        (1 - BilinearWeights.y) * BilinearWeights.x,
        BilinearWeights.y * (1 - BilinearWeights.x),
        BilinearWeights.y * BilinearWeights.x);

    // Plane-based 깊이 가중치
    #if PLANE_WEIGHTING
    {
        float4 ScenePlane = float4(WorldNormal, dot(WorldPosition, WorldNormal));

        float4 PlaneDistances;
        PlaneDistances.x = abs(dot(float4(Position00, -1), ScenePlane));
        // ...

        float4 RelativeDepthDifference = abs(PlaneDistances / SceneDepth);
        DepthWeights = select(CornerDepths > 0,
            exp2((bFoliage ? ScreenProbeInterpolationDepthWeightForFoliage
                           : ScreenProbeInterpolationDepthWeight) * RelativeDepthDifference),
            0.0);
    }
    #endif

    InterpolationWeights *= DepthWeights;
}
```

### Stochastic vs Bilinear Interpolation

```cpp
// r.Lumen.ScreenProbeGather.StochasticInterpolation
int32 GLumenScreenProbeStochasticInterpolation = 1;

// Stochastic: 1 샘플 (빠름, 노이즈 있음)
// Bilinear: 4 샘플 (느림, 부드러움)
```

---

## ⚡ 성능 최적화

### Tile Classification

**📂 위치:** `LumenScreenProbeTileClassication.ush`

```cpp
// r.Lumen.ScreenProbeGather.IntegrationTileClassification = 1

// 타일을 복잡도에 따라 분류:
// - SimpleDiffuse: 단순 diffuse만
// - SupportImportanceSampleBRDF: IS 지원
// - SupportAll: 모든 기능

// VGPR 사용량에 따라 다른 compute dispatch
// → 더 나은 GPU occupancy
```

### Wave Ops

```cpp
// r.Lumen.ScreenProbeGather.WaveOps = 1

// 지원 시 wave-level 연산으로 성능 향상
// - Reduction 최적화
// - 동기화 비용 감소
```

### Reference Mode

```cpp
// r.Lumen.ScreenProbeGather.ReferenceMode = 1

// 디버깅용: 프로브당 1024개 uniform rays
// 필터링, IS, Radiance Cache 없음
// 품질 비교 기준으로 사용
```

---

## 🔧 주요 CVar 설정

### 품질 관련

```cpp
// 다운샘플 팩터 (작을수록 고품질, 느림)
r.Lumen.ScreenProbeGather.DownsampleFactor = 16  // 8, 16, 32

// 트레이싱 해상도 (높을수록 고품질)
r.Lumen.ScreenProbeGather.TracingOctahedronResolution = 8  // 4, 8, 16

// Adaptive 프로브
r.Lumen.ScreenProbeGather.NumAdaptiveProbes = 8
r.Lumen.ScreenProbeGather.AdaptiveProbeAllocationFraction = 0.5

// 템포럴 필터
r.Lumen.ScreenProbeGather.Temporal = 1
r.Lumen.ScreenProbeGather.Temporal.MaxFramesAccumulated = 10
```

### 성능 관련

```cpp
// Mesh SDF 트레이싱 (비활성화하면 Global SDF만 사용)
r.Lumen.ScreenProbeGather.TraceMeshSDFs = 1

// Radiance Cache
r.Lumen.ScreenProbeGather.RadianceCache = 1

// 공간 필터
r.Lumen.ScreenProbeGather.SpatialFilterProbes = 1

// Importance Sampling
r.Lumen.ScreenProbeGather.DiffuseIntegralMethod = 0  // 0=Preintegrated
```

### 특수 기능

```cpp
// Short Range AO (contact shadows)
r.Lumen.ScreenProbeGather.ShortRangeAO = 1

// Extra AO (non-physical art direction)
r.Lumen.ScreenProbeGather.ExtraAmbientOcclusion = 0

// Two-Sided Foliage backface diffuse
r.Lumen.ScreenProbeGather.TwoSidedFoliageBackfaceDiffuse = 1
```

---

## 💡 디버깅 및 시각화

### Debug Mode

```cpp
// r.Lumen.ScreenProbeGather.Debug = 1
// 셰이더에서 추가 디버그 정보 출력

// r.Lumen.ScreenProbeGather.Debug.ProbePlacement = 1
// 프로브 배치 시각화

// r.Lumen.ScreenProbeGather.TileDebugMode = 1
// 타일 분류 시각화
```

### Fixed Jitter

```cpp
// r.Lumen.ScreenProbeGather.FixedJitterIndex = 0
// 템포럴 jitter를 고정하여 디버깅
// -1 = 정상 동작 (프레임별 변경)
```

---

## 🔗 관련 파일 참조

| 파일 | 설명 |
|------|------|
| `LumenScreenProbeGather.h` | 헤더 및 파라미터 구조체 |
| `LumenScreenProbeGather.cpp` | 메인 파이프라인 |
| `LumenScreenProbeTracing.cpp` | 레이 트레이싱 dispatch |
| `LumenScreenProbeFiltering.cpp` | 필터링 패스 |
| `LumenScreenProbeImportanceSampling.cpp` | IS 구현 |
| `LumenScreenProbeCommon.ush` | 공통 셰이더 함수 |
| `LumenScreenProbeTracing.usf` | 트레이싱 셰이더 |
| `LumenScreenProbeFiltering.usf` | 필터링 셰이더 |
| `LumenScreenProbeGather.usf` | 최종 Gather 셰이더 |
| `LumenScreenProbeTileClassication.ush` | 타일 분류 |

---

## 🔗 Radiance Cache와의 상호작용

Screen Probe와 Radiance Cache는 **거리 기반 계층**으로 협력합니다. Screen Probe는 근거리를, Radiance Cache는 원거리를 담당합니다.

### 역할 분담

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Screen Probe ↔ Radiance Cache 상호작용                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   거리 →  0                MaxMeshSDFTraceDistance          MaxTrace    │
│           │────────────────────────│──────────────────────────│        │
│           │                        │                          │        │
│           │   Screen Probe가       │    Radiance Cache가      │        │
│           │   직접 트레이싱        │    Fallback으로 제공     │        │
│           │   (Screen/MeshSDF/     │    (World Space Probe)   │        │
│           │    GlobalSDF)          │                          │        │
│           │                        │                          │        │
│           └────────────────────────┴──────────────────────────┘        │
│                                                                         │
│   Screen Probe:                   Radiance Cache:                      │
│   ┌─────────────────────┐         ┌─────────────────────┐              │
│   │ • 화면 공간 배치     │         │ • 월드 공간 Clipmap │              │
│   │ • 16px 간격         │         │ • 카메라 중심 6레벨  │              │
│   │ • ~8,000 프로브     │    →    │ • 필요한 곳만 할당  │              │
│   │ • 프레임별 갱신     │         │ • 영구 캐시 가능    │              │
│   └─────────────────────┘         └─────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Fallback 로직

Screen Probe의 레이가 `RadianceCacheMaxTraceDistance`를 초과하면 Radiance Cache로 전환:

**📂 위치:** `LumenScreenProbeTracing.usf:180`

```hlsl
// Screen Probe 트레이싱 중 Radiance Cache Fallback
void TraceScreenProbeRay(...)
{
    // 1. Screen Space Tracing
    // 2. Mesh SDF Tracing
    // 3. Global SDF Tracing

    // 4. 트레이싱 거리 초과 시 Radiance Cache 사용
    if (RayData.RadianceCacheMaxTraceDistance < MaxTraceDistance * 0.99f)
    {
        FRadianceCacheCoverage Coverage = GetRadianceCacheCoverage(
            WorldPosition,
            RayData.Direction,
            Noise);

        if (Coverage.bValid)
        {
            // Radiance Cache에서 보간된 값 사용
            SampleRadianceCacheAndApply(
                Coverage,
                WorldPosition,
                RayData.Direction,
                RayData.ConeHalfAngle,
                0.5f,  // Transparency
                /* inout */ TraceResult.Lighting,
                /* inout */ TraceResult.Transparency);

            bReachedRadianceCache = true;
        }
    }

    // Ray Distance에 Radiance Cache 도달 여부 인코딩
    RWTraceHit[Coord] = EncodeProbeRayDistance(
        HitDistance,
        bHit,
        bMoving,
        bReachedRadianceCache);  // ← 이 플래그로 추적
}
```

### 트레이싱 거리 설정

**📂 위치:** `LumenScreenProbeGather.cpp:89`

```cpp
// Radiance Cache 전환 거리 계산
float GetRadianceCacheMaxTraceDistance(const FViewInfo& View)
{
    float MaxTraceDistance = Lumen::GetMaxTraceDistance(View);

    if (LumenScreenProbeGather::UseRadianceCache())
    {
        // Radiance Cache 사용 시 Screen Probe 트레이싱 거리 제한
        // → 원거리는 Radiance Cache가 담당
        return MaxTraceDistance * GLumenScreenProbeRadianceCacheTraceDistanceScale;
    }

    return MaxTraceDistance;
}

// CVar: 기본 0.5 → 전체 거리의 50%까지만 직접 트레이싱
float GLumenScreenProbeRadianceCacheTraceDistanceScale = 0.5f;
```

### 왜 이렇게 분리하는가?

| 측면 | Screen Probe만 사용 | Screen Probe + Radiance Cache |
|------|---------------------|-------------------------------|
| **원거리 품질** | 노이즈 많음 (샘플 부족) | 안정적 (캐시된 값) |
| **성능** | 긴 레이 = 비용 증가 | 짧은 레이 + 캐시 조회 |
| **Temporal 안정성** | 프레임별 변동 | 월드 공간 캐시로 안정 |
| **카메라 이동** | 모든 것 재계산 | 캐시 재사용 가능 |

### 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Screen Probe → Radiance Cache 흐름                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Frame N                                                               │
│   ────────                                                              │
│                                                                         │
│   1. Screen Probe 트레이싱                                              │
│      │                                                                  │
│      ├─ 근거리 Hit → Surface Cache에서 Radiance 조회                   │
│      │                                                                  │
│      └─ 원거리 Miss (> RadianceCacheMaxTraceDistance)                  │
│         │                                                               │
│         ↓                                                               │
│   2. Radiance Cache Coverage 확인                                       │
│      │                                                                  │
│      ├─ Coverage.bValid == true                                        │
│      │   └─ Clipmap 인덱스 결정                                         │
│      │   └─ 8개 프로브에서 Trilinear 보간 (또는 Stochastic 1개)        │
│      │   └─ Parallax Correction 적용                                   │
│      │   └─ 결과를 TraceResult.Lighting에 누적                         │
│      │                                                                  │
│      └─ Coverage.bValid == false                                       │
│          └─ Sky Light Fallback                                         │
│                                                                         │
│   3. 결과 저장                                                          │
│      └─ EncodeProbeRayDistance(..., bReachedRadianceCache)             │
│         → Temporal 필터에서 가중치 조절에 사용                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 관련 CVar

```cpp
// Radiance Cache 활성화
r.Lumen.ScreenProbeGather.RadianceCache 1

// 트레이싱 거리 비율 (0.5 = 50%까지 직접 트레이싱)
r.Lumen.ScreenProbeGather.RadianceCacheTraceDistanceScale 0.5

// Radiance Cache에서 Sky Visibility 사용
r.Lumen.ScreenProbeGather.RadianceCache.SkyVisibility 1

// Stochastic 보간 (1개 프로브만 샘플링)
r.Lumen.ScreenProbeGather.RadianceCache.StochasticInterpolation 0
```

---

## 🎯 핵심 철학

> **Screen Probe Gather는 "화면 공간 프로브 기반 Final Gather"로 효율적인 Diffuse GI를 제공한다.**
>
> - **다운샘플링**: 16x16 타일당 1 프로브로 비용 절감
> - **Adaptive 배치**: 깊이 불연속 영역에 추가 프로브
> - **다단계 트레이싱**: Screen → Mesh SDF → Global SDF → Radiance Cache
> - **템포럴 누적**: 프레임 간 평균화로 노이즈 감소
> - **Importance Sampling**: BRDF 기반 중요 방향 집중
> - **Radiance Cache 협력**: 원거리는 월드 공간 캐시에 위임
