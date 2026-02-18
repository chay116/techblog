---
title: "Lumen Radiance Cache Deep Dive"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Lumen"]
---
# Lumen Radiance Cache Deep Dive

> 🔄 Created: 2025-11-22
>
> Lumen Radiance Cache의 내부 구현과 Probe 시스템에 대한 상세 분석

---

## 🧭 개요

**Radiance Cache**는 Lumen의 핵심 캐싱 시스템으로, 월드 공간에 배치된 Probe들이 주변의 Radiance를 저장하여 간접광 계산을 가속화합니다. Surface Cache가 표면 기반 캐싱이라면, Radiance Cache는 **볼륨 기반 캐싱**입니다.

### 핵심 특징

- **Clipmap 구조**: 카메라 주변을 6단계의 Clipmap으로 분할
- **동적 Probe 배치**: 필요한 위치에만 Probe 할당 (스파스 구조)
- **Octahedral Mapping**: 각 Probe는 전방향 Radiance 저장
- **Temporal Caching**: 8프레임 동안 미사용 Probe는 유지 후 재사용
- **Trilinear 보간**: 인접 8개 Probe로부터 부드러운 보간

---

## 🏗️ 계층별 상세 분석

### Clipmap 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Radiance Cache Clipmap 계층                            │
│                                                                         │
│   Clipmap 0 (가장 세밀)                                                  │
│   ┌─────────────┐   CellSize = ClipmapWorldExtent * (Base^0)           │
│   │   Camera    │   Resolution = 64³ 그리드                             │
│   │      ●      │   커버리지: ~수 미터                                  │
│   └─────────────┘                                                       │
│         ↓                                                               │
│   Clipmap 1                                                             │
│   ┌─────────────────────┐   CellSize = ClipmapWorldExtent * (Base^1)   │
│   │   Clipmap 0         │   Base = 2.0 (기본값)                        │
│   │   ┌─────────────┐   │   커버리지: ~수십 미터                       │
│   │   │             │   │                                              │
│   │   └─────────────┘   │                                              │
│   └─────────────────────┘                                               │
│         ↓                                                               │
│   Clipmap 2 ~ 5 (더 넓은 범위)                                           │
│   최대 6개 Clipmap (LumenRadianceCache::MaxClipmaps = 6)                │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenViewState.h:230`

```cpp
class FRadianceCacheClipmap
{
public:
    /** World space bounds. */
    FVector Center;            // Clipmap 중심 (카메라 위치)
    float Extent;              // 한 변의 반 길이

    FVector3d CornerWorldSpace;           // 월드 공간 코너 위치
    FVector3f CornerTranslatedWorldSpace;  // 번역된 월드 공간 코너 (PreViewTranslation 적용)

    float ProbeTMin;           // Probe 최소 추적 거리 (자기 차폐 방지)

    /** Offset applied to UVs so that only new or dirty areas have to be updated. */
    FVector VolumeUVOffset;    // Clipmap 이동 시 UV 오프셋 (재사용 최적화)

    /* Distance between two probes. */
    float CellSize;            // Probe 간 거리
};
```

### Clipmap 크기 계산

```cpp
// Clipmap 0 (가장 세밀)
CellSize[0] = ClipmapWorldExtent / RadianceProbeClipmapResolution
            = 2500.0f / 64  // 기본값
            = 39.06 cm

// Clipmap 1
CellSize[1] = CellSize[0] * ClipmapDistributionBase
            = 39.06 * 2.0
            = 78.12 cm

// Clipmap N
CellSize[N] = CellSize[0] * pow(ClipmapDistributionBase, N)
```

**설계 의도:**
- 카메라 근처는 높은 해상도 (Clipmap 0)
- 먼 거리는 낮은 해상도 (Clipmap 5)
- Base=2.0 → 기하급수적 확장으로 넓은 범위 커버

---

### FRadianceCacheState - 전체 시스템 상태

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenViewState.h:249`

```cpp
class FRadianceCacheState
{
public:
    TArray<FRadianceCacheClipmap> Clipmaps;  // 최대 6개 Clipmap

    float ClipmapWorldExtent = 0.0f;         // 기본 Clipmap 범위 (2500.0f)
    float ClipmapDistributionBase = 0.0f;    // Clipmap 간 크기 배율 (2.0f)
    float CachedLightingPreExposure = 0.0f;  // 사전 노출값 (HDR)

    // Probe 인덱스 조회 텍스처 (3D Texture)
    TRefCountPtr<IPooledRenderTarget> RadianceProbeIndirectionTexture;

    // Probe Atlas 텍스처들
    TRefCountPtr<IPooledRenderTarget> RadianceProbeAtlasTexture;       // 추적된 Radiance (RGB16F)
    TRefCountPtr<IPooledRenderTarget> FinalRadianceAtlas;              // 필터링된 최종 Radiance
    TRefCountPtr<IPooledRenderTarget> FinalIrradianceAtlas;            // Irradiance (SH or Lambert)
    TRefCountPtr<IPooledRenderTarget> ProbeOcclusionAtlas;             // Occlusion 데이터
    TRefCountPtr<IPooledRenderTarget> DepthProbeAtlasTexture;          // Depth 정보

    // Probe 할당 관리 버퍼들
    TRefCountPtr<FRDGPooledBuffer> ProbeAllocator;         // 현재 할당된 Probe 수
    TRefCountPtr<FRDGPooledBuffer> ProbeFreeListAllocator; // Free list 크기
    TRefCountPtr<FRDGPooledBuffer> ProbeFreeList;          // 재사용 가능한 Probe 인덱스들
    TRefCountPtr<FRDGPooledBuffer> ProbeLastUsedFrame;     // Probe가 마지막 사용된 프레임
    TRefCountPtr<FRDGPooledBuffer> ProbeLastTracedFrame;   // Probe가 마지막 추적된 프레임
    TRefCountPtr<FRDGPooledBuffer> ProbeWorldOffset;       // Probe 위치 오프셋 (FVector4f)
};
```

---

### Probe 배치 및 인덱싱 시스템

#### 3D Indirection Texture

```
┌─────────────────────────────────────────────────────────────────────────┐
│        RadianceProbeIndirectionTexture (3D Texture, R32_UINT)            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  각 Clipmap의 3D 그리드 → Probe Index 매핑                              │
│                                                                         │
│  Clipmap 0     Clipmap 1     Clipmap 2    ...    Clipmap 5             │
│  64×64×64      64×64×64      64×64×64            64×64×64              │
│  ┌──────┐     ┌──────┐     ┌──────┐           ┌──────┐               │
│  │ 0001 │     │ FFFF │     │ 0042 │           │ 0123 │               │
│  │ FFFF │     │ 0002 │     │ FFFF │           │ FFFF │               │
│  │ 0003 │     │ 0004 │     │ 0005 │           │ 0200 │               │
│  └──────┘     └──────┘     └──────┘           └──────┘               │
│     ↑            ↑            ↑                   ↑                    │
│   Probe        Empty       Probe               Probe                  │
│   Index       (FFFF)       Index               Index                  │
│                                                                         │
│  텍스처 좌표: (ProbeCoord.x + ClipmapIndex * 64, ProbeCoord.y, ProbeCoord.z) │
│                                                                         │
│  INVALID_PROBE_INDEX = 0xFFFFFFFF (할당되지 않음)                       │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Shaders/Private/Lumen/LumenRadianceCacheInterpolation.ush:271`

```cpp
uint GetProbeIndexFromIndirectionTexture(uint3 ProbeCoord, uint ClipmapIndex)
{
    // X 좌표에 Clipmap Index 인코딩 (모든 Clipmap을 한 텍스처에 저장)
    uint3 ProbeIndirectionTextureCoord = uint3(
        ProbeCoord.x + ClipmapIndex * RadianceProbeClipmapResolution,
        ProbeCoord.yz
    );

    return RadianceProbeIndirectionTexture.Load(uint4(ProbeIndirectionTextureCoord, 0));
}
```

#### 월드 좌표 → Probe 좌표 변환

**📂 위치:** `Engine/Shaders/Private/Lumen/LumenRadianceCacheInterpolation.ush:114`

```cpp
float3 GetRadianceProbeCoordFloat(float3 ProbeWorldPosition, uint ClipmapIndex)
{
    // 1. 월드 좌표를 Translated 좌표로 변환 (카메라 위치 보정)
    const float3 ProbeTranslatedWorldPosition = ProbeWorldPosition + PrimaryView.PreViewTranslation;

    // 2. Clipmap 코너로부터의 상대 위치
    const float3 CornerTranslatedWorldPosition = GetRadianceProbeClipmapCornerTWS(ClipmapIndex);
    const float3 CornerToProbe = ProbeTranslatedWorldPosition - CornerTranslatedWorldPosition;

    // 3. CellSize로 나누어 그리드 좌표로 변환
    const float CellSize = GetRadianceProbeClipmapCellSize(ClipmapIndex);
    return CornerToProbe / CellSize;  // Float 그리드 좌표
}

int3 GetRadianceProbeCoord(float3 ProbeWorldPosition, uint ClipmapIndex)
{
    // floor()로 정수 그리드 좌표 계산 (음수도 올바르게 처리)
    return floor(GetRadianceProbeCoordFloat(ProbeWorldPosition, ClipmapIndex));
}
```

#### Clipmap 선택 알고리즘

**📂 위치:** `Engine/Shaders/Private/Lumen/LumenRadianceCacheInterpolation.ush:154`

```cpp
uint GetRadianceProbeClipmap(float3 WorldSpacePosition, float ClipmapDitherRandom)
{
    uint ClipmapIndex = 0;

    // 모든 Clipmap을 순회 (가장 세밀한 것부터)
    for (; ClipmapIndex < NumRadianceProbeClipmaps; ++ClipmapIndex)
    {
        float3 ProbeCoordFloat = GetRadianceProbeCoordFloat(WorldSpacePosition, ClipmapIndex);

        // Clipmap 경계로부터의 페이드 계산 (0~1)
        float3 BottomEdgeFades = saturate((ProbeCoordFloat - 0.5f) * InvClipmapFadeSize);
        float3 TopEdgeFades = saturate(((float3)RadianceProbeClipmapResolution - 0.5f - ProbeCoordFloat) * InvClipmapFadeSize);

        // 가장 작은 페이드 값 선택 (경계에 가까울수록 작음)
        float EdgeFade = min(
            min3(BottomEdgeFades.x, BottomEdgeFades.y, BottomEdgeFades.z),
            min3(TopEdgeFades.x, TopEdgeFades.y, TopEdgeFades.z)
        );

        // 디더링된 임계값 비교 (Clipmap 간 부드러운 전환)
        if (EdgeFade > ClipmapDitherRandom)
        {
            return ClipmapIndex;  // 이 Clipmap 사용
        }
    }

    return NumRadianceProbeClipmaps;  // 범위 밖 = 유효하지 않음
}
```

**핵심 아이디어:**
- 가장 세밀한 Clipmap부터 검사
- 경계 근처는 상위 Clipmap으로 전환 (디더링 적용)
- 각 위치는 정확히 하나의 Clipmap에 속함

---

### Probe Atlas 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Probe Atlas Texture Layout (2D Texture)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ProbeAtlasResolutionInProbes = (128, 128) → 16,384 Probes 최대         │
│  RadianceProbeResolution = 16 (Octahedral mapping)                     │
│  전체 해상도: 2048×2048 (128 * 16)                                      │
│                                                                         │
│  ┌────┬────┬────┬────┬────┬────┐                                       │
│  │ P0 │ P1 │ P2 │ P3 │ ...│P127│  ← 첫 번째 행 (Probe 0~127)          │
│  ├────┼────┼────┼────┼────┼────┤                                       │
│  │P128│P129│ ...│    │    │    │  ← 두 번째 행 (Probe 128~255)        │
│  ├────┼────┼────┼────┼────┼────┤                                       │
│  │    │    │    │    │    │    │                                       │
│  │                  ...          │                                       │
│  │                               │                                       │
│  └────────────────────────────────┘                                     │
│                                                                         │
│  각 Probe (16×16 픽셀):                                                 │
│  ┌────────────────┐                                                    │
│  │  ╱╲  ← +Z      │  Octahedral Mapping:                              │
│  │ ╱  ╲           │  - 구의 모든 방향을 정사각형에 매핑                │
│  │▕    ▏← ±X,±Y  │  - 각 픽셀 = 특정 방향의 Radiance                 │
│  │ ╲  ╱           │  - 샘플링: InverseEquiAreaSphericalMapping()      │
│  │  ╲╱   ← -Z     │                                                    │
│  └────────────────┘                                                    │
│                                                                         │
│  Probe Index → Atlas UV 계산:                                          │
│  ProbeX = ProbeIndex % 128 (ProbeAtlasResolutionModuloMask)           │
│  ProbeY = ProbeIndex / 128 (ProbeAtlasResolutionDivideShift)          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Atlas 타입별 용도

| Atlas 이름 | 포맷 | 해상도 | 용도 |
|-----------|------|--------|------|
| **RadianceProbeAtlasTexture** | RGB16F | 16×16 per probe | 추적된 원본 Radiance (필터 전) |
| **FinalRadianceAtlas** | RGB16F | 16×16 + Mip | 공간 필터링 후 최종 Radiance |
| **FinalIrradianceAtlas** | RGB16F | 6×6 per probe | 디퓨즈용 Irradiance (SH 또는 Lambert) |
| **ProbeOcclusionAtlas** | RG16F | 16×16 per probe | 방향별 Occlusion (AO 용도) |
| **DepthProbeAtlasTexture** | R32F | 16×16 per probe | 각 방향의 Hit Distance |

---

### Trilinear 보간 알고리즘

**📂 위치:** `Engine/Shaders/Private/Lumen/LumenRadianceCacheCommon.ush:11`

```cpp
FRadianceCacheCoverage GetRadianceCacheCoverageWithUncertainCoverage(
    float3 RayOrigin,
    float3 RayDirection,
    float ClipmapDitherRandom)
{
    FRadianceCacheCoverage Coverage;
    Coverage.bValid = false;
    Coverage.MinTraceDistanceBeforeInterpolation = 10000000.0f;

    // 1. Clipmap 선택
    uint ClipmapIndex = GetRadianceProbeClipmap(RayOrigin, ClipmapDitherRandom);

    if (ClipmapIndex < NumRadianceProbeClipmaps)
    {
        // 2. 보간을 위한 8개 코너 Probe 찾기
        float3 ProbeCoordFloat = GetRadianceProbeCoordFloat(RayOrigin, ClipmapIndex);
        float3 CornerProbeCoordFloat = ProbeCoordFloat - 0.5f;  // 셀 중심 → 코너
        int3 CornerProbeCoord = floor(CornerProbeCoordFloat);

        Coverage.bValid = true;

        // 3. 8개 Probe 모두 유효한지 검사 (2×2×2)
        UNROLL
        for (int Z = 0; Z < 2; Z++)
        {
            UNROLL
            for (int Y = 0; Y < 2; Y++)
            {
                UNROLL
                for (int X = 0; X < 2; X++)
                {
                    int3 ProbeCoord = CornerProbeCoord + int3(X, Y, Z);
                    uint ProbeIndex = GetProbeIndexFromIndirectionTexture(ProbeCoord, ClipmapIndex);

                    if (ProbeIndex == INVALID_PROBE_INDEX)
                    {
                        Coverage.bValid = false;  // 하나라도 없으면 무효
                    }
                }
            }
        }

        // 4. 최소 추적 거리 계산 (자기 차폐 방지)
        float CellOcclusionDistance = GetRadianceProbeClipmapCellSize(ClipmapIndex) * sqrt(3.0f);
        Coverage.MinTraceDistanceBeforeInterpolation = GetRadianceProbeTMin(ClipmapIndex) + CellOcclusionDistance;
    }

    return Coverage;
}
```

#### Trilinear 가중치 계산

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  8-Probe Trilinear 보간                                 │
│                                                                         │
│        P011 ●────────────● P111                                         │
│           ╱│            ╱│                                              │
│          ╱ │           ╱ │                                              │
│     P001●────────────● P101                                             │
│         │  │         │  │                                               │
│         │ P010●──────┼──● P110                                          │
│         │ ╱          │ ╱                                                │
│         │╱           │╱                                                 │
│     P000●────────────● P100                                             │
│             ↑                                                           │
│          Sample Point (보간 위치)                                        │
│                                                                         │
│  보간 가중치:                                                            │
│  float3 Frac = frac(ProbeCoordFloat - 0.5f);  // 0~1 범위               │
│                                                                         │
│  P000 weight = (1-Frac.x) * (1-Frac.y) * (1-Frac.z)                    │
│  P100 weight =    Frac.x  * (1-Frac.y) * (1-Frac.z)                    │
│  P010 weight = (1-Frac.x) *    Frac.y  * (1-Frac.z)                    │
│  ...                                                                    │
│                                                                         │
│  최종 Radiance = Σ(ProbeRadiance[i] * Weight[i])  (i = 0~7)            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Sphere Parallax Correction

**📂 위치:** `Engine/Shaders/Private/Lumen/LumenRadianceCacheInterpolation.ush:277`

```cpp
FRadianceCacheSample SampleRadianceCacheProbeWithParallaxCorrection(
    uint3 ProbeCoord,
    uint ProbeClipmapIndex,
    float3 WorldSpacePosition,    // 샘플 위치
    float3 WorldSpaceDirection,   // 샘플 방향
    float MipLevel)
{
    float ProbeTMin = GetRadianceProbeTMin(ProbeClipmapIndex);
    uint ProbeIndex = GetProbeIndexFromIndirectionTexture(ProbeCoord, ProbeClipmapIndex);
    float3 ProbeWorldPosition = GetProbeWorldPosition(ProbeCoord, ProbeClipmapIndex, ProbeIndex);

    float3 ReprojectedDirection = WorldSpaceDirection;
    float CorrectionFactor = 1.0f;

#if SIMPLE_SPHERE_PARALLAX
    // Parallax Correction을 통한 누수 감소
    float ReprojectionRadius = ReprojectionRadiusScale * ProbeTMin;

    // 1. 샘플 위치에서 Probe 주변 구와의 교차점 계산
    float T = RayIntersectSphere(
        WorldSpacePosition,
        WorldSpaceDirection,
        float4(ProbeWorldPosition, ReprojectionRadius)
    ).y;

    // 2. 교차점 → Probe 중심 방향으로 Reprojection
    float3 IntersectionPosition = WorldSpacePosition + WorldSpaceDirection * T;
    ReprojectedDirection = IntersectionPosition - ProbeWorldPosition;

    // 3. 거리 감쇠 보정 (그리드 패턴 완화)
    CorrectionFactor = T * T / (ReprojectionRadius * dot(ReprojectedDirection, WorldSpaceDirection));
#endif

    // 4. Reprojected 방향으로 Probe 샘플링
    FRadianceCacheSample RadianceCacheSample = SampleRadianceCacheProbe(ProbeIndex, ReprojectedDirection, MipLevel);
    RadianceCacheSample.Radiance *= CorrectionFactor;

    return RadianceCacheSample;
}
```

**설계 의도:**
- **문제**: Probe는 이산적 위치에만 존재 → 실제 지오메트리와 불일치
- **해결**: 샘플 위치에서 Probe 중심으로 방향 재투영
- **효과**: 누수 감소, 그리드 패턴 완화

---

## 🎯 Probe 업데이트 전략

### 점진적 업데이트 (Incremental Update)

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenRadianceCache.cpp:31`

```cpp
static TAutoConsoleVariable<int32> CVarRadianceCacheNumFramesToKeepCachedProbes(
    TEXT("r.Lumen.RadianceCache.NumFramesToKeepCachedProbes"),
    8,  // 기본값: 8 프레임
    TEXT("Number of frames to keep unused probes in cache."),
    ECVF_Scalability | ECVF_RenderThreadSafe
);
```

### 업데이트 예산 (Budget)

```cpp
FRadianceCacheInputs::NumProbesToTraceBudget
```

- 매 프레임 추적할 최대 Probe 수 제한
- Priority 기반 선택:
  1. **새로 배치된 Probe** (우선순위 최고)
  2. **오래된 Probe** (LastTracedFrame이 오래된 것)
  3. **변경된 영역의 Probe** (조명/지오메트리 변화)

### Probe 재사용 메커니즘

```
프레임 N:
  Probe 100 사용됨 → ProbeLastUsedFrame[100] = N

프레임 N+1 ~ N+7:
  Probe 100 사용 안 됨 → 캐시에 유지

프레임 N+8:
  Probe 100 여전히 미사용 → ProbeFreeList에 추가
  다음 할당 시 재사용 가능
```

**메모리 최적화:**
- 동적 할당으로 필요한 Probe만 생성
- 미사용 Probe는 자동 회수
- 최대 16,384 Probes (128×128 Atlas)

---

## 🔧 실전 예시

### Probe 샘플링 코드

```cpp
// 1. 위치에서 사용할 Clipmap 결정
float ClipmapDitherRandom = InterleavedGradientNoise(PixelPos, FrameIndex);
uint ClipmapIndex = GetRadianceProbeClipmap(WorldPosition, ClipmapDitherRandom);

// 2. 8개 코너 Probe 인덱스 가져오기
float3 ProbeCoordFloat = GetRadianceProbeCoordFloat(WorldPosition, ClipmapIndex);
int3 BottomCorner = floor(ProbeCoordFloat - 0.5f);
float3 TrilinearWeights = frac(ProbeCoordFloat - 0.5f);

float3 TotalRadiance = 0;
float TotalWeight = 0;

// 3. Trilinear 보간
for (int Z = 0; Z < 2; Z++)
{
    for (int Y = 0; Y < 2; Y++)
    {
        for (int X = 0; X < 2; X++)
        {
            int3 ProbeCoord = BottomCorner + int3(X, Y, Z);
            uint ProbeIndex = GetProbeIndexFromIndirectionTexture(ProbeCoord, ClipmapIndex);

            if (ProbeIndex != INVALID_PROBE_INDEX)
            {
                // Parallax 보정 적용
                FRadianceCacheSample Sample = SampleRadianceCacheProbeWithParallaxCorrection(
                    ProbeCoord, ClipmapIndex, WorldPosition, ViewDirection, 0
                );

                // 가중치 계산
                float3 Weight3D = lerp(1.0f - TrilinearWeights, TrilinearWeights, float3(X, Y, Z));
                float Weight = Weight3D.x * Weight3D.y * Weight3D.z;

                TotalRadiance += Sample.Radiance * Weight;
                TotalWeight += Weight;
            }
        }
    }
}

// 4. 정규화
float3 InterpolatedRadiance = TotalRadiance / max(TotalWeight, 0.0001f);
```

---

## ⚡ 성능 특성

### VRAM 사용량 (기본 설정)

| 리소스 | 크기 | 계산 |
|--------|------|------|
| **RadianceProbeIndirectionTexture** | ~48 MB | 6 Clipmaps × 64³ × 4 bytes (R32_UINT) |
| **FinalRadianceAtlas** | ~32 MB | 2048×2048 × RGB16F + Mips |
| **DepthProbeAtlasTexture** | ~16 MB | 2048×2048 × R32F |
| **ProbeOcclusionAtlas** | ~16 MB | 2048×2048 × RG16F |
| **총계** | **~112 MB** | (16,384 Probes 최대) |

### 프레임당 비용

```
Probe Marking:     ~0.05ms  (스크린 공간 마킹)
Probe Allocation:  ~0.1ms   (새 Probe 생성/재사용)
Probe Tracing:     ~1-3ms   (예산 기반, ~1000 Probes)
Spatial Filter:    ~0.2ms   (이웃 Probe 필터링)
──────────────────────────
총 비용:           ~1.5-3.5ms (1080p 기준)
```

---

## ⚠️ 최적화 팁

### ✅ 해야 할 것

**1. Clipmap 범위 조정**
```cpp
r.Lumen.RadianceCache.ClipmapWorldExtent 2500  // 기본값
// 작은 씬: 1500
// 큰 오픈 월드: 5000
```

**2. Probe 업데이트 예산 조정**
```cpp
r.Lumen.RadianceCache.NumProbesToTraceBudget 1000  // 프레임당 추적할 Probe 수
// 높음: 부드러운 업데이트, 높은 비용
// 낮음: 떨림 발생 가능, 낮은 비용
```

**3. Spatial Filtering 활성화**
```cpp
r.Lumen.RadianceCache.SpatialFilterProbes 1  // 이웃 Probe 필터링으로 노이즈 감소
```

### ❌ 피해야 할 것

**1. 너무 많은 Clipmap 사용**
```cpp
r.Lumen.RadianceCache.NumClipmaps 4  // 기본값
// 6 이상: VRAM 낭비 (먼 거리는 어차피 보이지 않음)
```

**2. Probe 해상도 과다**
```cpp
r.Lumen.RadianceCache.ProbeResolution 16  // 기본값
// 32+: VRAM 4배 증가, 성능 저하
```

**3. 불필요한 Forced Update**
```cpp
r.Lumen.RadianceCache.ForceFullUpdate 0  // 디버깅 전용
// 1로 설정 시: 매 프레임 모든 Probe 추적 → 극심한 성능 저하
```

---

## 🐛 디버깅 팁

### 비주얼라이제이션

```cpp
// Probe 위치 시각화
r.Lumen.Visualize 1
r.Lumen.Visualize.Mode 4  // Radiance Cache Probes

// Indirection Texture 검사
r.Lumen.Visualize.Mode 5  // Probe Indirection

// Probe Radiance 확인
r.Lumen.Visualize.Mode 6  // Probe Radiance
```

### 일반적인 문제

**문제: Probe가 배치되지 않음**
- **원인**: MarkUsedRadianceCacheProbes 호출 누락
- **해결**: Screen Probe Gather 단계에서 올바르게 마킹 확인

**문제: 그리드 패턴 보임**
- **원인**: Parallax Correction 비활성화
- **해결**: `ReprojectionRadiusScale` 기본값(1.0) 사용

**문제: 느린 업데이트**
- **원인**: `NumProbesToTraceBudget` 너무 낮음
- **해결**: 예산 증가 또는 `ForceFullUpdate` 일시 활성화

---

## 📚 참조 자료

### 소스 파일

| 파일 | 설명 |
|------|------|
| `LumenRadianceCache.h:11` | 핵심 구조체 및 함수 선언 |
| `LumenRadianceCacheInterpolation.h:12` | Clipmap 상수 및 보간 파라미터 |
| `LumenViewState.h:230` | FRadianceCacheClipmap/State 정의 |
| `LumenRadianceCacheInterpolation.ush:8` | Shader 상수 및 샘플링 함수 |
| `LumenRadianceCacheCommon.ush:11` | Coverage 검사 및 보간 로직 |

### 콘솔 변수

```cpp
r.Lumen.RadianceCache.Update 1                        // 업데이트 활성화
r.Lumen.RadianceCache.ClipmapWorldExtent 2500        // Clipmap 0 범위
r.Lumen.RadianceCache.ClipmapDistributionBase 2.0    // Clipmap 배율
r.Lumen.RadianceCache.NumProbesToTraceBudget 1000    // 프레임당 추적 예산
r.Lumen.RadianceCache.NumFramesToKeepCachedProbes 8  // Probe 캐시 수명
r.Lumen.RadianceCache.SpatialFilterProbes 1          // 공간 필터링
r.Lumen.RadianceCache.SupersampleTileBRDFThreshold 0.1  // BRDF 기반 슈퍼샘플링
```

### 관련 문서

- **Lumen Overview**: Surface Cache와 함께 동작하는 전체 파이프라인
- **Lumen Advanced**: Screen Probe Gather에서 Radiance Cache 사용
- **Lumen Optimization**: Radiance Cache 최적화 전략

---

> **핵심 요약:**
> - Radiance Cache는 **월드 공간 볼륨 캐싱** 시스템
> - **6단계 Clipmap**으로 카메라 주변 효율적 커버
> - **동적 Probe 할당**과 **8프레임 재사용**으로 메모리 절약
> - **Trilinear 보간** + **Sphere Parallax Correction**으로 부드러운 간접광
> - 프레임당 ~1.5-3.5ms 비용으로 실시간 전역 조명 구현
