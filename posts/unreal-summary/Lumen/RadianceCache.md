---
title: "Radiance Cache"
date: "2025-12-03"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Radiance Cache

> Updated: 2025-12-03 — Radiance Cache 심층 분석 문서 작성 + Screen Probe 상호작용 섹션 추가

## 🧭 Overview

**Radiance Cache**는 Lumen Global Illumination의 핵심 구성 요소로, 월드 공간에서 저해상도 간접광 정보를 캐시하여 효율적인 조명 계산을 가능하게 합니다. Screen Probe가 화면 공간 기반인 반면, Radiance Cache는 **월드 공간 Clipmap** 구조를 사용하여 카메라 독립적인 조명 정보를 저장합니다.

### 핵심 특징

| 특성 | 값 | 설명 |
|------|-----|------|
| **최대 Clipmap 수** | 6 | 다양한 거리 범위 커버 |
| **최소 Probe 해상도** | 8 | 가장 작은 Probe 그리드 크기 |
| **Invalid Probe Index** | 0xFFFFFFFF | 유효하지 않은 Probe 표시 |
| **프로브 형태** | Octahedral | 방향 정보를 2D로 인코딩 |

### 시스템 위치

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Lumen Global Illumination                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    │
│  │  Screen Probe   │───>│  Radiance Cache │<───│  Surface Cache  │    │
│  │   (화면 공간)    │    │   (월드 공간)    │    │   (메시 표면)    │    │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────┘    │
│           │                      │                                      │
│           └──────────┬───────────┘                                      │
│                      ↓                                                  │
│           ┌─────────────────────┐                                       │
│           │   Final Integration │                                       │
│           │   (최종 조명 합성)   │                                       │
│           └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 Architecture

### Clipmap 기반 계층 구조

Radiance Cache는 **Clipmap** 방식으로 월드 공간을 계층적으로 분할합니다. 카메라에 가까울수록 고해상도, 멀수록 저해상도 프로브를 사용합니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Radiance Cache Clipmap 구조                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│    Clipmap 0 (가장 상세)                                                │
│    ┌───────────────────┐                                                │
│    │ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ │  Cell Size: 작음                              │
│    │ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ │  범위: 카메라 근처                             │
│    │ ▪ ▪ ▪[C]▪ ▪ ▪ ▪ │  [C] = Camera                                  │
│    │ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ │                                                │
│    └───────────────────┘                                                │
│                                                                         │
│    Clipmap 1                                                            │
│    ┌───────────────────────────┐                                        │
│    │  ▪   ▪   ▪   ▪   ▪   ▪  │  Cell Size: 2x                          │
│    │  ▪   ▪  [C]  ▪   ▪   ▪  │  범위: 중간 거리                        │
│    │  ▪   ▪   ▪   ▪   ▪   ▪  │                                         │
│    └───────────────────────────┘                                        │
│                                                                         │
│    Clipmap 5 (가장 넓음)                                                │
│    ┌───────────────────────────────────────────────────┐                │
│    │    ▪       ▪       ▪       ▪       ▪       ▪    │  Cell Size: 32x │
│    │    ▪       ▪      [C]      ▪       ▪       ▪    │  범위: 원거리   │
│    │    ▪       ▪       ▪       ▪       ▪       ▪    │                 │
│    └───────────────────────────────────────────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 클래스 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    LumenRadianceCache                                   │
│  (네임스페이스 - Radiance Cache 업데이트 인터페이스)                     │
├─────────────────────────────────────────────────────────────────────────┤
│  struct FRadianceCacheConfiguration                                     │
│    - bFarField: bool              // Far Field 모드 여부                │
│                                                                         │
│  struct FUpdateInputs                                                   │
│    - Scene: FScene*               // 씬 참조                            │
│    - ViewOrigin: FVector3f        // 뷰 원점                            │
│    - CameraVelocity: FVector3f    // 카메라 속도                        │
│                                                                         │
│  struct FUpdateOutputs                                                  │
│    - RadianceCacheState: void*    // 캐시 상태 출력                     │
│                                                                         │
│  Functions:                                                             │
│    + GetInterpolationParameters() : FRadianceCacheInterpolationParams  │
│    + RenderRadianceCache()        : void                                │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 사용
                                      ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              FRadianceCacheInterpolationParameters                      │
│  (셰이더에 전달되는 보간 파라미터)                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - ProbeWorldOffset: FVector3f        // 프로브 월드 오프셋           │
│    - ClipmapWorldExtent: float          // Clipmap 월드 범위            │
│    - ClipmapDistributionBase: float     // 분포 기준값                  │
│    - InvClipmapFadeSize: float          // Clipmap 페이드 역수          │
│    - RadianceProbeClipmapResolution: int32  // Clipmap 해상도           │
│    - NumRadianceProbeClipmaps: uint32   // Clipmap 개수                 │
│                                                                         │
│  Texture Resources:                                                     │
│    - RadianceProbeIndirectionTexture    // Probe Indirection Texture    │
│    - RadianceCacheProbeAtlasTexture     // Irradiance Atlas             │
│    - RadianceCacheProbeOcclusionAtlas   // Occlusion Atlas              │
│    - RadianceCacheDepthAtlas            // Depth Atlas                  │
│                                                                         │
│  Sky Visibility:                                                        │
│    - bSkyVisibilityAtlas: bool          // Sky Visibility 사용 여부     │
│    - SkyVisibilityAtlas: Texture        // Sky Visibility 텍스처        │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenRadianceCacheInterpolation.h:18-55`

---

## 🧩 Core Components

### 1. Radiance Cache Inputs

Radiance Cache 입력 설정을 정의합니다:

```cpp
// LumenRadianceCacheInterpolation.h:18
namespace LumenRadianceCache
{
    constexpr int32 MaxClipmaps = 6;
    constexpr int32 MinRadianceProbeResolution = 8;
}

class FRadianceCacheInputs
{
public:
    bool bCalculateIrradiance = false;

    float ReprojectionRadiusScale = 1.5f;
    float ClipmapWorldExtent = 0.0f;
    float ClipmapDistributionBase = 0.0f;

    int32 RadianceProbeClipmapResolution = 0;
    int32 ProbeAtlasResolutionInProbes = 0;
    int32 NumRadianceProbeClipmaps = 0;
    int32 FinalProbeResolution = 0;
    int32 FinalRadianceAtlasMaxMip = 0;
    int32 CalculateIrradianceProbeResolution = 0;
    int32 OcclusionProbeResolution = 0;

    FIntVector ProbeAtlasResolutionModuloMask = FIntVector::ZeroValue;
    FIntVector ProbeAtlasResolutionDivideShift = FIntVector::ZeroValue;

    bool bPersistentCache = false;
};
```

**핵심 파라미터:**

| 파라미터 | 설명 |
|----------|------|
| `MaxClipmaps` | 최대 6개의 Clipmap 레벨 지원 |
| `MinRadianceProbeResolution` | 프로브 최소 해상도 8 |
| `ClipmapWorldExtent` | 월드 공간에서 Clipmap이 커버하는 범위 |
| `ReprojectionRadiusScale` | Temporal Reprojection 반경 스케일 |
| `bPersistentCache` | 영구 캐시 사용 여부 |

### 2. Radiance Cache Coverage

셰이더에서 Radiance Cache 커버리지를 확인하는 구조체:

```hlsl
// LumenRadianceCacheCommon.ush:12
struct FRadianceCacheCoverage
{
    bool bValid;        // 유효한 커버리지인지
    uint ClipmapIndex;  // 사용할 Clipmap 인덱스
};

// Coverage 확인 함수
FRadianceCacheCoverage GetRadianceCacheCoverage(
    float3 WorldSpacePosition,
    float3 WorldSpaceDirection,
    float InterpVisibilityWeight)
{
    FRadianceCacheCoverage Coverage;
    Coverage.bValid = false;
    Coverage.ClipmapIndex = 0;

    // Clipmap 레벨 선택
    // 월드 위치에 따라 적절한 Clipmap 결정

    return Coverage;
}
```

### 3. Probe Indirection Texture

프로브 위치에서 실제 Atlas 좌표로 매핑하는 간접 참조 텍스처:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Probe Indirection System                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   월드 위치 (X, Y, Z)                                                   │
│         │                                                               │
│         ↓                                                               │
│   ┌─────────────────────┐                                               │
│   │  Clipmap 선택       │  → ClipmapIndex (0-5)                        │
│   │  (거리 기반)         │                                              │
│   └──────────┬──────────┘                                               │
│              ↓                                                          │
│   ┌─────────────────────┐                                               │
│   │  Grid Cell 계산     │  → ProbeGridCoord (X, Y, Z)                  │
│   │  (위치 → 셀 좌표)    │                                              │
│   └──────────┬──────────┘                                               │
│              ↓                                                          │
│   ┌─────────────────────────────────────────────┐                       │
│   │  Probe Indirection Texture 샘플링           │                       │
│   │  RadianceProbeIndirectionTexture[GridCoord] │                       │
│   └──────────┬──────────────────────────────────┘                       │
│              ↓                                                          │
│         ProbeIndex                                                      │
│         (INVALID_PROBE_INDEX = 0xFFFFFFFF 일 수 있음)                   │
│              │                                                          │
│              ↓                                                          │
│   ┌─────────────────────┐                                               │
│   │  Atlas 좌표 계산    │  → ProbeAtlasCoord                           │
│   │  (Index → UV)       │                                              │
│   └──────────┬──────────┘                                               │
│              ↓                                                          │
│   ┌─────────────────────┐                                               │
│   │  Irradiance Atlas   │  → 최종 Radiance 값                          │
│   │  샘플링             │                                              │
│   └─────────────────────┘                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 Interpolation System

### Clipmap 선택 및 페이드

월드 위치에서 적절한 Clipmap을 선택하고 경계에서 페이드를 적용합니다:

```hlsl
// LumenRadianceCacheInterpolation.ush:89
float GetRadianceProbeClipmapForMark(
    float3 ProbeWorldPosition,
    out float OutDistanceFromClipmap)
{
    float CellSize = RadianceProbeClipmapResolutionForMark /
                     (2 * GetRadianceProbeClipmapExtent(0));
    float3 BiasedPositionRelativeToCamera =
        ProbeWorldPosition - GetRadianceProbeCoordToWorldPosition(float3(0, 0, 0), 0);

    float DistanceFromCenter = max3(
        abs(BiasedPositionRelativeToCamera.x),
        abs(BiasedPositionRelativeToCamera.y),
        abs(BiasedPositionRelativeToCamera.z));

    // Clipmap 인덱스 계산
    float LogDistanceFromCenter = max(log2(DistanceFromCenter * CellSize), 0);
    float ClipmapIndex = LogDistanceFromCenter;

    // 경계 페이드를 위한 거리 계산
    OutDistanceFromClipmap = DistanceFromCenter -
        GetRadianceProbeClipmapTMin(floor(ClipmapIndex));

    return ClipmapIndex;
}
```

### Sphere Parallax Correction

프로브 샘플링 시 시차 보정을 적용하여 정확한 방향 조회를 수행합니다:

```hlsl
// LumenRadianceCacheInterpolation.ush:312
float3 SampleRadianceCacheProbeWithParallaxCorrection(
    float3 WorldPosition,
    float3 Direction,
    float ConeHalfAngle,
    float3 ProbeWorldPosition,
    uint ProbeIndex)
{
    // 프로브 중심에서 샘플링 위치까지의 오프셋
    float3 ProbeToSamplePosition = WorldPosition - ProbeWorldPosition;

    // Sphere Parallax 보정
    // 프로브가 무한히 먼 곳에 있다고 가정하지 않고,
    // 실제 프로브 위치를 고려하여 방향을 조정
    float3 CorrectedDirection = CorrectDirectionForSphereParallax(
        Direction,
        ProbeToSamplePosition,
        GetProbeRadius());

    // 보정된 방향으로 프로브 샘플링
    return SampleRadianceCacheProbe(CorrectedDirection, ConeHalfAngle, ProbeIndex);
}
```

**Parallax Correction 원리:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Sphere Parallax Correction                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   보정 없음 (기존 방식):                                                 │
│   ─────────────────────                                                 │
│              ↑ 원래 방향                                                │
│              │                                                          │
│         S ───┘  (샘플링 위치)                                           │
│         │                                                               │
│         │ ← 프로브와 샘플 위치 사이 거리 무시                            │
│         │                                                               │
│        (P)  프로브 위치                                                 │
│                                                                         │
│   Parallax 보정 적용:                                                   │
│   ────────────────────                                                  │
│              ↗ 보정된 방향                                              │
│             /                                                           │
│         S ─┘   (샘플링 위치)                                            │
│         │\                                                              │
│         │ \ ← 프로브 중심으로부터의 오프셋 고려                         │
│         │  \                                                            │
│        (P)──→ 가상의 구 표면                                           │
│                                                                         │
│   결과: 더 정확한 방향에서 Radiance 샘플링                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Trilinear Interpolation

8개 이웃 프로브에서 삼선형 보간을 수행합니다:

```hlsl
// LumenRadianceCacheInterpolation.ush:400
FRadianceCacheSample SampleRadianceCacheInterpolated(
    FRadianceCacheCoverage Coverage,
    float3 WorldSpacePosition,
    float3 WorldSpaceDirection,
    float ConeHalfAngle,
    float RandomScalarForStochasticInterpolation)
{
    uint ClipmapIndex = Coverage.ClipmapIndex;

    // 월드 위치를 Probe 그리드 좌표로 변환
    float3 ProbeCoordFloat = GetRadianceProbeCoord(WorldSpacePosition, ClipmapIndex);
    int3 ProbeMinCoord = floor(ProbeCoordFloat);
    float3 ProbeCoordFrac = frac(ProbeCoordFloat);

    // 8개 이웃 프로브 수집
    float3 Samples[8];
    float Weights[8];

    UNROLL
    for (uint i = 0; i < 8; i++)
    {
        int3 Offset = int3(i & 1, (i >> 1) & 1, (i >> 2) & 1);
        int3 ProbeCoord = ProbeMinCoord + Offset;

        uint ProbeIndex = GetProbeIndex(ProbeCoord, ClipmapIndex);

        if (ProbeIndex != INVALID_PROBE_INDEX)
        {
            float3 ProbeWorldPos = GetProbeWorldPosition(ProbeCoord, ClipmapIndex);

            Samples[i] = SampleRadianceCacheProbeWithParallaxCorrection(
                WorldSpacePosition,
                WorldSpaceDirection,
                ConeHalfAngle,
                ProbeWorldPos,
                ProbeIndex);

            // 삼선형 가중치 계산
            float3 WeightXYZ = lerp(1 - ProbeCoordFrac, ProbeCoordFrac, float3(Offset));
            Weights[i] = WeightXYZ.x * WeightXYZ.y * WeightXYZ.z;
        }
        else
        {
            Samples[i] = 0;
            Weights[i] = 0;
        }
    }

    // 가중치 합산 및 정규화
    float TotalWeight = 0;
    float3 Result = 0;

    UNROLL
    for (uint j = 0; j < 8; j++)
    {
        Result += Samples[j] * Weights[j];
        TotalWeight += Weights[j];
    }

    if (TotalWeight > 0)
    {
        Result /= TotalWeight;
    }

    FRadianceCacheSample OutSample;
    OutSample.Radiance = Result;
    return OutSample;
}
```

### Stochastic Interpolation

성능을 위해 8개 프로브 대신 확률적으로 1개 프로브만 샘플링하는 옵션:

```hlsl
// LumenRadianceCacheInterpolation.ush:480
FRadianceCacheSample SampleRadianceCacheStochastic(
    FRadianceCacheCoverage Coverage,
    float3 WorldSpacePosition,
    float3 WorldSpaceDirection,
    float ConeHalfAngle,
    float Random)
{
    uint ClipmapIndex = Coverage.ClipmapIndex;
    float3 ProbeCoordFloat = GetRadianceProbeCoord(WorldSpacePosition, ClipmapIndex);
    int3 ProbeMinCoord = floor(ProbeCoordFloat);
    float3 ProbeCoordFrac = frac(ProbeCoordFloat);

    // 확률적으로 하나의 프로브 선택
    // Random 값에 따라 8개 중 하나를 선택
    int3 SelectedOffset;
    SelectedOffset.x = (Random < ProbeCoordFrac.x) ? 1 : 0;

    // Y, Z 축에 대해서도 동일하게 처리
    float RandomY = frac(Random * 7.31);
    float RandomZ = frac(Random * 13.17);
    SelectedOffset.y = (RandomY < ProbeCoordFrac.y) ? 1 : 0;
    SelectedOffset.z = (RandomZ < ProbeCoordFrac.z) ? 1 : 0;

    int3 ProbeCoord = ProbeMinCoord + SelectedOffset;
    uint ProbeIndex = GetProbeIndex(ProbeCoord, ClipmapIndex);

    FRadianceCacheSample OutSample;

    if (ProbeIndex != INVALID_PROBE_INDEX)
    {
        float3 ProbeWorldPos = GetProbeWorldPosition(ProbeCoord, ClipmapIndex);
        OutSample.Radiance = SampleRadianceCacheProbeWithParallaxCorrection(
            WorldSpacePosition,
            WorldSpaceDirection,
            ConeHalfAngle,
            ProbeWorldPos,
            ProbeIndex);
    }
    else
    {
        OutSample.Radiance = 0;
    }

    return OutSample;
}
```

**Stochastic vs Full Interpolation:**

| 특성 | Stochastic | Full Trilinear |
|------|------------|----------------|
| **샘플 수** | 1개 프로브 | 8개 프로브 |
| **성능** | 빠름 | 느림 |
| **품질** | 노이즈 있음 | 부드러움 |
| **용도** | Temporal 누적 가능 시 | 단일 프레임 품질 필요 시 |

---

## 🎨 Atlas System

### Irradiance Atlas

프로브의 Irradiance 정보를 저장하는 아틀라스:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Radiance Cache Atlas Layout                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   RadianceCacheProbeAtlasTexture (Irradiance)                          │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐     │    │
│   │ │ P0  │ │ P1  │ │ P2  │ │ P3  │ │ P4  │ │ P5  │ │ ... │     │    │
│   │ │     │ │     │ │     │ │     │ │     │ │     │ │     │     │    │
│   │ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘     │    │
│   │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐     │    │
│   │ │ Pn  │ │Pn+1 │ │Pn+2 │ │Pn+3 │ │Pn+4 │ │Pn+5 │ │ ... │     │    │
│   │ │     │ │     │ │     │ │     │ │     │ │     │ │     │     │    │
│   │ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘     │    │
│   └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   각 프로브 타일 (Px):                                                  │
│   ┌─────────────────┐                                                   │
│   │  ╭───────────╮  │  ← Octahedral Mapping                            │
│   │ ╱             ╲ │    (구 방향 → 2D UV)                              │
│   │╱   Radiance    ╲│                                                   │
│   │╲   (RGB)       ╱│    해상도: FinalProbeResolution                  │
│   │ ╲             ╱ │    (일반적으로 16~32)                             │
│   │  ╰───────────╯  │                                                   │
│   └─────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Occlusion Atlas

프로브 occlusion 정보를 별도 아틀라스에 저장:

```hlsl
// Occlusion 샘플링
float SampleRadianceCacheOcclusion(
    float3 Direction,
    uint ProbeIndex)
{
    float2 OctahedralUV = UnitVectorToOctahedron(Direction) * 0.5 + 0.5;

    // Atlas에서 프로브 위치 계산
    uint2 ProbeAtlasCoord = GetProbeAtlasCoord(ProbeIndex);
    float2 AtlasUV = (ProbeAtlasCoord + OctahedralUV * OcclusionProbeResolution) /
                      ProbeAtlasResolution;

    return RadianceCacheProbeOcclusionAtlas.SampleLevel(
        GlobalBilinearClampedSampler,
        AtlasUV,
        0).x;
}
```

### Sky Visibility Atlas

하늘 가시성 정보를 저장하여 스카이라이트와 통합:

```hlsl
// LumenRadianceCacheInterpolation.ush:250
float3 GetRadianceCacheSkyVisibility(
    float3 Direction,
    uint ProbeIndex)
{
    if (!bSkyVisibilityAtlas)
    {
        return 1.0f;  // Sky Visibility 비활성화 시 전체 가시
    }

    float2 OctahedralUV = UnitVectorToOctahedron(Direction) * 0.5 + 0.5;
    uint2 ProbeAtlasCoord = GetProbeAtlasCoord(ProbeIndex);

    float2 AtlasUV = (ProbeAtlasCoord + OctahedralUV * SkyVisibilityProbeResolution) /
                      SkyVisibilityAtlasResolution;

    return SkyVisibilityAtlas.SampleLevel(
        GlobalBilinearClampedSampler,
        AtlasUV,
        0).rgb;
}
```

---

## 📊 Update Pipeline

### 프레임별 업데이트 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Radiance Cache Update Pipeline                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Frame N                                                               │
│   ────────                                                              │
│                                                                         │
│   1. Mark Probes for Update                                             │
│      ┌────────────────────────────────────────────────────┐            │
│      │  Screen Probe에서 Radiance Cache 필요 위치 마킹    │            │
│      │  → 어떤 프로브가 업데이트 필요한지 결정            │            │
│      └────────────────────────┬───────────────────────────┘            │
│                               ↓                                         │
│   2. Allocate Probes                                                    │
│      ┌────────────────────────────────────────────────────┐            │
│      │  새로운 프로브 할당 또는 기존 프로브 재사용         │            │
│      │  → Probe Indirection Texture 업데이트              │            │
│      └────────────────────────┬───────────────────────────┘            │
│                               ↓                                         │
│   3. Trace Probes                                                       │
│      ┌────────────────────────────────────────────────────┐            │
│      │  업데이트가 필요한 프로브에 대해 Ray Tracing       │            │
│      │  → Surface Cache 또는 Scene 직접 샘플링           │            │
│      └────────────────────────┬───────────────────────────┘            │
│                               ↓                                         │
│   4. Filter & Integrate                                                 │
│      ┌────────────────────────────────────────────────────┐            │
│      │  Temporal 필터링 및 이전 프레임 결과와 통합        │            │
│      │  → Atlas 텍스처 업데이트                          │            │
│      └────────────────────────┬───────────────────────────┘            │
│                               ↓                                         │
│   5. Ready for Sampling                                                 │
│      ┌────────────────────────────────────────────────────┐            │
│      │  Screen Probe 및 다른 시스템에서 샘플링 가능       │            │
│      └────────────────────────────────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### C++ Update Interface

```cpp
// LumenRadianceCache.h:28
namespace LumenRadianceCache
{
    struct FUpdateInputs
    {
        FScene* Scene;
        FViewInfo* View;
        FLumenSceneFrameTemporaries* FrameTemporaries;
        FLumenCardTracingParameters* TracingParameters;

        FVector3f ViewOrigin;
        FVector3f CameraVelocity;

        FRadianceCacheConfiguration Configuration;
    };

    struct FUpdateOutputs
    {
        FRadianceCacheState* RadianceCacheState;
        FRadianceCacheInterpolationParameters InterpolationParameters;
    };

    void RenderRadianceCache(
        FRDGBuilder& GraphBuilder,
        const FUpdateInputs& Inputs,
        FUpdateOutputs& Outputs,
        const LumenRadianceCache::FRadianceCacheInputs& RadianceCacheInputs,
        ERDGPassFlags ComputePassFlags);
}
```

---

## 🔧 Console Variables

### 주요 CVars

```cpp
// Radiance Cache 활성화
r.Lumen.RadianceCache 1

// Clipmap 설정
r.Lumen.RadianceCache.NumClipmaps 6
r.Lumen.RadianceCache.ClipmapWorldExtent 10000
r.Lumen.RadianceCache.ClipmapDistributionBase 2

// 프로브 해상도
r.Lumen.RadianceCache.ProbeResolution 32
r.Lumen.RadianceCache.ProbeAtlasResolution 128

// 보간 설정
r.Lumen.RadianceCache.StochasticInterpolation 0  // 0=Full, 1=Stochastic
r.Lumen.RadianceCache.ReprojectionRadiusScale 1.5

// Sky Visibility
r.Lumen.RadianceCache.SkyVisibility 1
```

---

## 💡 Performance Optimization

### 최적화 전략

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Performance Considerations                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ✅ 효율적인 방법:                                                     │
│   ─────────────────                                                     │
│                                                                         │
│   1. Stochastic Interpolation 사용                                      │
│      - 8개 → 1개 프로브 샘플링                                          │
│      - Temporal 누적으로 품질 보상                                      │
│                                                                         │
│   2. Clipmap 수 최적화                                                  │
│      - 필요한 거리만 커버하도록 조정                                    │
│      - 실내 씬: 3-4 Clipmap                                             │
│      - 대규모 야외: 5-6 Clipmap                                         │
│                                                                         │
│   3. Probe Resolution 조정                                              │
│      - 낮은 해상도로도 충분한 경우 16 사용                              │
│      - 고품질 필요 시 32 사용                                           │
│                                                                         │
│   ❌ 피해야 할 것:                                                      │
│   ────────────────                                                      │
│                                                                         │
│   1. 과도한 Clipmap 수                                                  │
│      - 메모리 사용량 급증                                               │
│      - 업데이트 비용 증가                                               │
│                                                                         │
│   2. 높은 해상도에서 Full Interpolation                                 │
│      - 매 픽셀 8개 프로브 샘플링                                        │
│      - 텍스처 대역폭 병목                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 메모리 사용량

```
Radiance Cache 메모리 ≈
    NumClipmaps × ClipmapResolution³ × ProbeSize ×
    (Irradiance + Occlusion + SkyVisibility)

예시 (기본 설정):
- 6 Clipmaps
- 32³ = 32,768 probes per clipmap (max)
- 32 × 32 × 3 bytes (RGB) per probe

실제 할당은 희소(Sparse)하므로 훨씬 적음
```

---

## 🔗 Screen Probe와의 상호작용

Radiance Cache는 Screen Probe의 **원거리 Fallback**으로 동작합니다. 두 시스템이 협력하여 전체 거리 범위의 GI를 커버합니다.

### 역할 분담

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Screen Probe ↔ Radiance Cache 역할 분담                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Screen Probe (화면 공간)              Radiance Cache (월드 공간)      │
│   ────────────────────────              ──────────────────────────      │
│                                                                         │
│   ┌─────────────────────┐               ┌─────────────────────┐        │
│   │ 담당 영역:          │               │ 담당 영역:          │        │
│   │ • 근거리~중거리     │               │ • 중거리~원거리     │        │
│   │ • 화면에 보이는 곳  │      ───>     │ • 화면 밖 포함      │        │
│   │ • 빠른 변화 추적    │               │ • 느린 변화 캐시    │        │
│   └─────────────────────┘               └─────────────────────┘        │
│                                                                         │
│   배치 방식:                            배치 방식:                      │
│   • 16x16 픽셀 Grid                    • 6-level Clipmap               │
│   • Adaptive (깊이 경계)               • 필요한 Cell만 활성화          │
│   • 프레임별 Jitter                    • Persistent Cache 가능         │
│                                                                         │
│   장점:                                 장점:                           │
│   • 카메라 뷰 최적화                   • 카메라 독립적                  │
│   • 고해상도 근거리                    • Temporal 안정성                │
│   • 빠른 동적 변화                     • 재사용 가능                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Screen Probe에서 Radiance Cache 호출

Screen Probe의 레이가 `RadianceCacheMaxTraceDistance`를 초과하면 Radiance Cache로 전환됩니다:

**📂 위치:** `LumenScreenProbeTracing.usf`

```hlsl
// Screen Probe 트레이싱 중 원거리 처리
void ProcessScreenProbeRayFallback(
    float3 WorldPosition,
    float3 Direction,
    float ConeHalfAngle,
    float TraceDistance,
    float RadianceCacheMaxTraceDistance,
    inout FConeTraceResult TraceResult,
    inout bool bReachedRadianceCache)
{
    // 트레이싱 거리가 Radiance Cache 전환점을 넘으면
    if (RadianceCacheMaxTraceDistance < TraceDistance * 0.99f)
    {
        // Radiance Cache Coverage 확인
        FRadianceCacheCoverage Coverage = GetRadianceCacheCoverage(
            WorldPosition,
            Direction,
            BlueNoise);

        if (Coverage.bValid)
        {
            // Radiance Cache에서 보간된 Radiance 샘플링
            FRadianceCacheSample Sample = SampleRadianceCacheInterpolated(
                Coverage,
                WorldPosition,
                Direction,
                ConeHalfAngle,
                RandomForStochastic);

            // 기존 결과와 블렌딩
            TraceResult.Lighting += Sample.Radiance * TraceResult.Transparency;
            TraceResult.Transparency *= Sample.Transparency;

            bReachedRadianceCache = true;
        }
    }
}
```

### Radiance Cache Mark 단계

Screen Probe가 어디서 Radiance Cache를 필요로 하는지 **마킹**합니다:

**📂 위치:** `LumenRadianceCacheMarkCS.usf`

```hlsl
// Screen Probe에서 Radiance Cache 필요 위치 마킹
[numthreads(THREADGROUP_SIZE, 1, 1)]
void MarkUsedRadianceCacheProbesCS(...)
{
    // Screen Probe의 레이 방향에서 원거리 위치 계산
    float3 WorldPosition = ScreenProbeWorldPosition +
        RayDirection * RadianceCacheMaxTraceDistance;

    // 해당 위치의 Clipmap 인덱스 결정
    float DistanceFromClipmap;
    float ClipmapIndexFloat = GetRadianceProbeClipmapForMark(
        WorldPosition, DistanceFromClipmap);

    uint ClipmapIndex = (uint)ClipmapIndexFloat;

    if (ClipmapIndex < NumRadianceProbeClipmapsForMark)
    {
        // 3D Indirection Texture에 마킹
        int3 ProbeCoord = GetRadianceProbeCoordForMark(WorldPosition, ClipmapIndex);

        // Atomic으로 해당 위치에 프로브 필요 표시
        InterlockedOr(RWRadianceProbeIndirectionTexture[ProbeCoord], PROBE_NEEDED_FLAG);
    }
}
```

### 전환 거리 설정

```cpp
// LumenScreenProbeGather.cpp

// Screen Probe가 직접 트레이싱하는 거리 비율
// 0.5 = MaxTraceDistance의 50%까지 직접 트레이싱, 나머지는 Radiance Cache
float GLumenScreenProbeRadianceCacheTraceDistanceScale = 0.5f;

// 설정 가능한 CVar
r.Lumen.ScreenProbeGather.RadianceCacheTraceDistanceScale
```

### 왜 두 시스템을 분리하는가?

| 문제 | Screen Probe만 | Radiance Cache만 | 둘 다 사용 |
|------|---------------|------------------|-----------|
| 근거리 정밀도 | ✅ 높음 | ❌ 낮음 (Grid 간격) | ✅ 높음 |
| 원거리 안정성 | ❌ 노이즈 | ✅ 안정 | ✅ 안정 |
| 카메라 이동 | ❌ 전체 재계산 | ✅ 캐시 유지 | ✅ 캐시 유지 |
| 동적 오브젝트 | ✅ 빠른 반응 | ❌ 느린 갱신 | ✅ 적절한 반응 |
| 메모리 | ✅ 적음 | ❌ 월드 전체 | ⚠️ 중간 |

### 데이터 흐름 요약

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    두 시스템의 협력 흐름                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. Screen Probe Mark → Radiance Cache Mark                           │
│      Screen Probe가 원거리에서 필요한 Radiance Cache 위치 마킹          │
│                                                                         │
│   2. Radiance Cache Update                                              │
│      마킹된 위치에 프로브 할당 및 트레이싱                              │
│      (Surface Cache, Global SDF 활용)                                  │
│                                                                         │
│   3. Screen Probe Tracing                                               │
│      근거리: 직접 트레이싱 (Screen/MeshSDF/GlobalSDF)                  │
│      원거리: Radiance Cache 조회                                        │
│                                                                         │
│   4. Final Integration                                                  │
│      Screen Probe 결과 = 직접 트레이싱 + Radiance Cache Fallback       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 관련 CVar

```cpp
// Screen Probe에서 Radiance Cache 사용
r.Lumen.ScreenProbeGather.RadianceCache 1

// 트레이싱 거리 분할 비율
r.Lumen.ScreenProbeGather.RadianceCacheTraceDistanceScale 0.5

// Radiance Cache 자체 설정
r.Lumen.RadianceCache 1
r.Lumen.RadianceCache.NumClipmaps 6
```

---

## 🔗 Surface Cache와의 연동

### Surface Cache → Radiance Cache Tracing

Radiance Cache 프로브 트레이싱 시 Surface Cache를 활용:

```
Radiance Cache Probe Tracing 시:
    1. Short-range: Surface Cache 샘플링 (빠름)
    2. Mid-range: Mesh SDF Tracing
    3. Long-range: Global SDF Tracing
    4. Far Field: Sky Light
```

---

## 🐛 Debugging

### 디버깅 시각화

```cpp
// Radiance Cache 디버깅 시각화
r.Lumen.RadianceCache.Visualize 1      // 프로브 위치 시각화
r.Lumen.RadianceCache.VisualizeClipmaps 1  // Clipmap 경계 시각화
r.Lumen.RadianceCache.ShowStats 1      // 통계 표시
```

### 일반적인 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| 갑작스러운 조명 변화 | Clipmap 경계 전환 | `InvClipmapFadeSize` 증가 |
| 조명 누락 | Probe Coverage 부족 | Clipmap 수 또는 해상도 증가 |
| 노이즈 | Stochastic 샘플링 | Temporal 필터링 강화 또는 Full 보간 |
| 느린 업데이트 | 과도한 프로브 수 | 해상도 낮추기 또는 Clipmap 감소 |

---

## 🔗 References

- **소스 파일:**
  - `Engine/Source/Runtime/Renderer/Private/Lumen/LumenRadianceCache.h`
  - `Engine/Source/Runtime/Renderer/Private/Lumen/LumenRadianceCacheInterpolation.h`
  - `Engine/Shaders/Private/Lumen/LumenRadianceCacheCommon.ush`
  - `Engine/Shaders/Private/Lumen/LumenRadianceCacheInterpolation.ush`

- **관련 문서:**
  - [Screen Probe Gather](./ScreenProbe.md)
  - [Surface Cache](./SurfaceCache.md)
  - [Global Distance Field](./GlobalDistanceField.md)
