---
title: "Global Distance Field 심층 분석"
date: "2025-12-02"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Global Distance Field 심층 분석

> Updated: 2025-12-02 — Lumen 엔진 코드 기반 심층 분석 문서 최초 작성

## 🧭 Overview

Global Distance Field (Global SDF)는 카메라 주변의 모든 Mesh SDF를 합성하여 생성하는 **Clipmap 기반 저해상도 SDF**입니다. 개별 Mesh SDF가 정밀한 근거리 트레이싱에 사용되는 반면, Global SDF는 원거리 트레이싱과 대규모 씬의 빠른 오클루전 계산에 최적화되어 있습니다.

### 핵심 개념

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Clipmap 기반 Global Distance Field                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Clipmap 구조: 카메라 중심으로 동심원 형태의 볼륨들                        │
│                                                                         │
│           ┌───────────────────────────────────────────┐                │
│           │              Clipmap 3 (가장 멀리)         │                │
│           │    ┌───────────────────────────────┐     │                │
│           │    │        Clipmap 2              │     │                │
│           │    │    ┌───────────────────┐     │     │                │
│           │    │    │    Clipmap 1      │     │     │                │
│           │    │    │   ┌─────────┐    │     │     │                │
│           │    │    │   │Clipmap 0│    │     │     │                │
│           │    │    │   │[Camera] │    │     │     │                │
│           │    │    │   └─────────┘    │     │     │                │
│           │    │    └───────────────────┘     │     │                │
│           │    └───────────────────────────────┘     │                │
│           └───────────────────────────────────────────┘                │
│                                                                         │
│  특징:                                                                  │
│  • 모든 Clipmap이 동일한 해상도 (예: 128³)                               │
│  • 외부 Clipmap일수록 복셀 크기가 큼 (저해상도)                           │
│  • 카메라 이동 시 점진적 업데이트 (Wraparound Addressing)                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 데이터 구조

### 1. 핵심 상수 및 설정

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/GlobalDistanceField.cpp:23-198`

```cpp
// 기본 Clipmap 수 (DFAO용: 4, Lumen은 View Distance에 따라 6까지 확장)
int32 GAOGlobalDistanceFieldNumClipmaps = 4;

// 기본 해상도 (한 차원당 복셀 수)
int32 GAOGlobalDFResolution = 128;

// Clipmap 크기 증가 지수 (각 Clipmap이 2배씩 커짐)
float GAOGlobalDFClipmapDistanceExponent = 2;

// Mesh SDF → Global SDF 전환 거리
float GAOGlobalDFStartDistance = 100;

// MostlyStatic/Movable 분리 캐싱 (메모리 +12MB, 업데이트 비용 감소)
int32 GAOGlobalDistanceFieldCacheMostlyStaticSeparately = 1;

// 부분 업데이트 활성화 (카메라 이동 시 영역별 업데이트)
int32 GAOGlobalDistanceFieldPartialUpdates = 1;

// 프레임당 Clipmap 업데이트 수
int32 GAOGlobalDistanceFieldClipmapUpdatesPerFrame = 2;

// Mip 다운샘플 팩터
int32 GAOGlobalDistanceFieldMipFactor = 4;
```

### 2. Page 기반 Sparse 저장

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldShared.ush:88-102`

```hlsl
// Page Atlas 상수
#define GLOBAL_DISTANCE_FIELD_PAGE_BORDER 0.5f
#define GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS 8  // 필터 마진 포함
#define GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION 7            // 유효 데이터
#define GLOBAL_DISTANCE_FIELD_PAGE_ATLAS_SIZE_IN_PAGES_X 128
#define GLOBAL_DISTANCE_FIELD_PAGE_ATLAS_SIZE_IN_PAGES_Y 128
#define GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS 4
#define GLOBAL_DISTANCE_FIELD_INVALID_PAGE_ID 0xFFFFFFFF

// Coverage Atlas (Two-Sided 머티리얼 처리용)
#define GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS 4
#define GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION 3
#define GLOBAL_DISTANCE_FIELD_COVERAGE_DOWNSAMPLE_FACTOR 2
```

### 3. 계층적 저장 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Page-based Sparse Storage                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Page Table Texture                           │   │
│  │  (각 Clipmap의 가상 공간 → Page Index 매핑)                      │   │
│  │                                                                 │   │
│  │   ┌───┬───┬───┬───┐  Clipmap 0                                 │   │
│  │   │ 5 │INV│INV│ 2 │  (가장 가까움)                              │   │
│  │   ├───┼───┼───┼───┤                                            │   │
│  │   │INV│ 7 │INV│INV│                                            │   │
│  │   └───┴───┴───┴───┘                                            │   │
│  │        ...                                                      │   │
│  │   Clipmap N (가장 멈)                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Page Atlas (3D Texture)                      │   │
│  │  • 크기: 128 × 128 × Z (필요에 따라 Z 확장)                      │   │
│  │  • 각 Page: 8³ 복셀 (7³ 유효 + 필터 마진)                        │   │
│  │  • 포맷: R8 (정규화된 거리 값)                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Coverage Atlas (3D Texture)                  │   │
│  │  • Page Atlas의 1/2 해상도                                       │   │
│  │  • Two-Sided 메쉬 영역 표시                                      │   │
│  │  • Surface Expansion 제어용                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Mip Texture                                  │   │
│  │  • Page Atlas의 저해상도 버전 (1/4)                              │   │
│  │  • 빠른 초기 Ray March용                                         │   │
│  │  • Page 유효성 체크 없이 직접 샘플링                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Clipmap 시스템

### 1. Clipmap 구성

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/GlobalDistanceField.cpp:383-404`

```cpp
int32 GlobalDistanceField::GetNumGlobalDistanceFieldClipmaps(
    bool bLumenEnabled, float LumenSceneViewDistance)
{
    int32 WantedClipmaps = GAOGlobalDistanceFieldNumClipmaps; // 기본: 4

    if (bLumenEnabled)
    {
        // Lumen View Distance에 따라 Clipmap 추가
        if (GetClipmapExtent(WantedClipmaps + 1, nullptr, true) <= LumenSceneViewDistance)
        {
            WantedClipmaps += 2;  // 6개로 확장
        }
        else if (GetClipmapExtent(WantedClipmaps, nullptr, true) <= LumenSceneViewDistance)
        {
            WantedClipmaps += 1;  // 5개로 확장
        }
    }

    return FMath::Clamp(WantedClipmaps, 0, GlobalDistanceField::MaxClipmaps);
}
```

### 2. Clipmap Extent 계산

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/GlobalDistanceField.cpp:446-457`

```cpp
float GlobalDistanceField::GetClipmapExtent(int32 ClipmapIndex, const FScene* Scene,
                                            bool bLumenEnabled)
{
    if (bLumenEnabled)
    {
        return Lumen::GetGlobalDFClipmapExtent(ClipmapIndex);
    }
    else
    {
        // DFAO용: 지수적 확장
        const float InnerClipmapDistance = Scene->GlobalDistanceFieldViewDistance
            / FMath::Pow(GAOGlobalDFClipmapDistanceExponent, 3);
        return InnerClipmapDistance
            * FMath::Pow(GAOGlobalDFClipmapDistanceExponent, ClipmapIndex);
    }
}
```

### 3. MostlyStatic/Full 분리 캐싱

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Dual Cache System                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    GDF_MostlyStatic Cache                       │   │
│  │                                                                 │   │
│  │  • 정적 오브젝트만 포함                                          │   │
│  │  • 거의 변경되지 않음                                            │   │
│  │  • 카메라 이동 시 새 영역만 업데이트                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              +                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    GDF_Full Cache                               │   │
│  │                                                                 │   │
│  │  • MostlyStatic + Movable 오브젝트                              │   │
│  │  • Movable 변경 시 해당 영역만 업데이트                          │   │
│  │  • MostlyStatic에서 데이터 복사 후 Movable 합성                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│                    최종 Global SDF 출력                                 │
│                                                                         │
│  장점:                                                                  │
│  • Movable 오브젝트 변경 시 Static 데이터 재계산 불필요                 │
│  • 메모리 +12MB, 업데이트 비용 대폭 감소                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📡 샘플링 알고리즘

### 1. Page 로드 및 UV 계산

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldShared.ush:146-172`

```hlsl
// Page Table에서 Page 정보 로드
FGlobalDistanceFieldPage GetGlobalDistanceFieldPage(float3 VolumeUV, uint ClipmapIndex)
{
    // Page Table 좌표 계산
    int4 PageTableCoord = int4(
        saturate(VolumeUV) * GlobalDistanceFieldClipmapSizeInPages
        + int3(0, 0, ClipmapIndex * GlobalDistanceFieldClipmapSizeInPages),
        0);

    uint PackedPage = GlobalDistanceFieldPageTableTexture.Load(PageTableCoord);
    return UnpackGlobalDistanceFieldPage(PackedPage);
}

// Page Atlas UV 계산
float3 ComputeGlobalDistanceFieldPageUV(float3 VolumeUV, FGlobalDistanceFieldPage Page)
{
    // Page Index → 3D Atlas 좌표
    uint3 PageAtlasOffset = GlobalDistanceFieldPageLinearIndexToPageAtlasOffset(Page);

    // Page 내 로컬 UV
    float3 VolumePageUV = frac(VolumeUV * GlobalDistanceFieldClipmapSizeInPages);

    // Atlas 텍스처 좌표
    float3 PageAtlasCoord = PageAtlasOffset * GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS
        + VolumePageUV * GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION
        + 0.5f;  // 반복셀 보더

    return PageAtlasCoord * GlobalDistanceFieldInvPageAtlasSize;
}
```

### 2. 거리 디코딩

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldShared.ush:183-191`

```hlsl
// 거리 인코딩: [-InfluenceRange, +InfluenceRange] → [0, 1]
float EncodeGlobalDistanceFieldPageDistance(float Distance, float ClipmapInfluenceRange)
{
    return saturate(Distance / (2.0f * ClipmapInfluenceRange) + 0.5f);
}

// 거리 디코딩: [0, 1] → [-InfluenceRange, +InfluenceRange]
float DecodeGlobalDistanceFieldPageDistance(float EncodedDistance, float ClipmapInfluenceRange)
{
    return (EncodedDistance * 2.0f - 1.0f) * ClipmapInfluenceRange;
}
```

### 3. Wraparound Addressing

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldShared.ush:193-200`

```hlsl
float3 ComputeGlobalUV(float3 TranslatedWorldPosition, uint ClipmapIndex)
{
    float4 TranslatedWorldToUVAddAndMul = GlobalVolumeTranslatedWorldToUVAddAndMul[ClipmapIndex];

    // Wraparound addressing: frac()로 순환
    float3 UV = frac(TranslatedWorldPosition * TranslatedWorldToUVAddAndMul.www
                   + TranslatedWorldToUVAddAndMul.xyz);

    // UV == 1.0 방지 (frac(-0.00...001f) = 1.0f 이슈)
    UV = frac(UV);

    return UV;
}
```

---

## 🎯 Ray Tracing 알고리즘

### 1. 트레이스 입력 구조체

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldUtils.ush:33-55`

```hlsl
struct FGlobalSDFTraceInput
{
    float3 TranslatedWorldRayStart;
    float3 WorldRayDirection;
    float MinTraceDistance;
    float MaxTraceDistance;
    float StepFactor;
    float MinStepFactor;

    // Surface Expansion 방식 선택
    // true: RayTime 기반 (Diffuse GI용 - 과도한 오클루전 허용)
    // false: MaxDistance 기반 (Reflections용 - 셀프 인터섹션 최소화)
    bool bExpandSurfaceUsingRayTimeInsteadOfMaxDistance;
    float InitialMaxDistance;

    // 복셀 크기 기준 바이어스
    float VoxelSizeRelativeBias;
    float VoxelSizeRelativeRayEndBias;

    // Dithered Semi-Transparency
    bool bDitheredTransparency;
    float2 DitherScreenCoord;
};
```

### 2. Sphere Tracing 구현

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldUtils.ush:90-200`

```hlsl
FGlobalSDFTraceResult RayTraceGlobalDistanceField(FGlobalSDFTraceInput TraceInput)
{
    FGlobalSDFTraceResult TraceResult;
    TraceResult.HitTime = -1.0f;  // 히트 없음을 나타냄
    TraceResult.HitClipmapIndex = 0;
    TraceResult.TotalStepsTaken = 0;
    TraceResult.ExpandSurfaceAmount = 0;

    // 트레이스 시작 Clipmap 결정
    uint MinClipmapIndex = ComputeGlobalDistanceFieldClipmapIndex(
        TraceInput.TranslatedWorldRayStart
        + TraceInput.MinTraceDistance * TraceInput.WorldRayDirection);

    float MaxDistance = TraceInput.InitialMaxDistance;
    float MinRayTime = TraceInput.MinTraceDistance;

    // 내부 Clipmap → 외부 Clipmap 순으로 트레이스
    for (uint ClipmapIndex = MinClipmapIndex;
         ClipmapIndex < NumGlobalSDFClipmaps && TraceResult.HitTime < 0.0f;
         ++ClipmapIndex)
    {
        float ClipmapVoxelExtent = GlobalVolumeTranslatedCenterAndExtent[ClipmapIndex].w
            * GlobalVolumeTexelSize;
        float MinStepSize = TraceInput.MinStepFactor * ClipmapVoxelExtent;
        float ExpandSurfaceDistance = ClipmapVoxelExtent;

        // Clipmap 박스와 레이 교차 계산
        float2 IntersectionTimes = LineBoxIntersect(
            TraceInput.TranslatedWorldRayStart, TranslatedWorldRayEnd,
            GlobalVolumeTranslatedCenter - GlobalVolumeExtent.xxx,
            GlobalVolumeTranslatedCenter + GlobalVolumeExtent.xxx);

        if (IntersectionTimes.x < IntersectionTimes.y)
        {
            float SampleRayTime = IntersectionTimes.x;
            const uint MaxSteps = 256;

            // Sphere Tracing 루프
            for (uint StepIndex = 0; StepIndex < MaxSteps; ++StepIndex)
            {
                float3 SampleTranslatedWorldPosition =
                    TraceInput.TranslatedWorldRayStart
                    + TraceInput.WorldRayDirection * SampleRayTime;

                float3 ClipmapVolumeUV = ComputeGlobalUV(
                    SampleTranslatedWorldPosition, ClipmapIndex);
                float3 MipUV = ComputeGlobalMipUV(
                    SampleTranslatedWorldPosition, ClipmapIndex);

                // 1. 먼저 Mip에서 대략적 거리 샘플링
                float DistanceFieldMipValue = Texture3DSampleLevel(
                    GlobalDistanceFieldMipTexture,
                    GlobalDistanceFieldMipTextureSampler, MipUV, 0).x;
                float DistanceField = DecodeGlobalDistanceFieldPageDistance(
                    DistanceFieldMipValue,
                    GlobalDistanceFieldMipFactor * ClipmapInfluenceRange);

                // 2. Page가 유효하고 표면 근처면 정밀 샘플링
                FGlobalDistanceFieldPage Page = GetGlobalDistanceFieldPage(
                    ClipmapVolumeUV, ClipmapIndex);

                if (Page.bValid && DistanceFieldMipValue < GlobalDistanceFieldMipTransition)
                {
                    float3 PageUV = ComputeGlobalDistanceFieldPageUV(
                        ClipmapVolumeUV, Page);

                    // Coverage 샘플링 (Two-Sided 처리용)
                    float Coverage = 1;
                    if (Page.bCoverage)
                    {
                        float3 CoveragePageUV;
                        ComputeGlobalDistanceFieldPageUV(
                            ClipmapVolumeUV, Page, PageUV, CoveragePageUV);
                        Coverage = Texture3DSampleLevel(
                            GlobalDistanceFieldCoverageAtlasTexture,
                            GlobalDistanceFieldCoverageAtlasTextureSampler,
                            CoveragePageUV, 0).x;
                    }

                    // 정밀 거리 샘플링
                    float DistanceFieldValue = Texture3DSampleLevel(
                        GlobalDistanceFieldPageAtlasTexture,
                        GlobalDistanceFieldPageAtlasTextureSampler, PageUV, 0).x;
                    DistanceField = DecodeGlobalDistanceFieldPageDistance(
                        DistanceFieldValue, ClipmapInfluenceRange);
                }

                // Surface Expansion 계산 (얇은 표면 누수 방지)
                float ExpandSurfaceScale = lerp(
                    NotCoveredExpandSurfaceScale,
                    CoveredExpandSurfaceScale, Coverage);
                float ExpandSurfaceAmount = ExpandSurfaceDistance
                    * saturate(ExpandSurfaceTime / ExpandSurfaceFalloff)
                    * ExpandSurfaceScale;

                // 히트 판정
                if (DistanceField < ExpandSurfaceAmount)
                {
                    TraceResult.HitTime = max(
                        SampleRayTime + DistanceField - ExpandSurfaceAmount, 0.0f);
                    TraceResult.HitClipmapIndex = ClipmapIndex;
                    TraceResult.ExpandSurfaceAmount = ExpandSurfaceAmount;
                    break;
                }

                // 스텝 크기 계산 (Coverage에 따른 최소 스텝 조정)
                float LocalMinStepSize = MinStepSize
                    * lerp(NotCoveredMinStepScale, 1.0f, Coverage);
                float StepDistance = max(
                    DistanceField * TraceInput.StepFactor, LocalMinStepSize);
                SampleRayTime += StepDistance;

                if (SampleRayTime > IntersectionTimes.y)
                    break;
            }
        }
    }

    return TraceResult;
}
```

---

## 📊 GPU 텍스처 구조

### 1. 텍스처 리소스

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldShared.ush:49-69`

```hlsl
// Page Atlas: 실제 거리 값 저장
Texture3D GlobalDistanceFieldPageAtlasTexture;

// Coverage Atlas: Two-Sided 메쉬 커버리지
Texture3D GlobalDistanceFieldCoverageAtlasTexture;

// Page Table: Volume UV → Page Index 매핑
Texture3D<uint> GlobalDistanceFieldPageTableTexture;

// Mip Texture: 빠른 초기 트레이싱용 저해상도 버전
Texture3D GlobalDistanceFieldMipTexture;

// Clipmap별 변환 파라미터
float4 GlobalVolumeTranslatedCenterAndExtent[MAX_GLOBAL_DF_CLIPMAPS];
float4 GlobalVolumeTranslatedWorldToUVAddAndMul[MAX_GLOBAL_DF_CLIPMAPS];
float4 GlobalDistanceFieldMipTranslatedWorldToUVScale[MAX_GLOBAL_DF_CLIPMAPS];
float4 GlobalDistanceFieldMipTranslatedWorldToUVBias[MAX_GLOBAL_DF_CLIPMAPS];

// 공용 파라미터
float GlobalDistanceFieldMipFactor;
float GlobalDistanceFieldMipTransition;
float3 GlobalDistanceFieldInvPageAtlasSize;
float3 GlobalDistanceFieldInvCoverageAtlasSize;
uint GlobalDistanceFieldClipmapSizeInPages;
float GlobalVolumeDimension;
float GlobalVolumeTexelSize;
uint NumGlobalSDFClipmaps;
```

### 2. Page 패킹/언패킹

**📂 위치:** `Engine/Shaders/Private/DistanceField/GlobalDistanceFieldShared.ush:104-144`

```hlsl
struct FGlobalDistanceFieldPage
{
    uint PageIndex;   // Page Atlas 내 선형 인덱스
    bool bValid;      // 유효한 Page인지
    bool bCoverage;   // Coverage 데이터 있는지
};

// Page Index → 3D Atlas 좌표 변환
uint3 GlobalDistanceFieldPageLinearIndexToPageAtlasOffset(FGlobalDistanceFieldPage Page)
{
    uint3 PageAtlasOffset;
    // 비트 연산으로 분해 (128 × 128 × Z 구조)
    PageAtlasOffset.x = Page.PageIndex & 0x7F;          // 하위 7비트
    PageAtlasOffset.y = (Page.PageIndex >> 7) & 0x7F;   // 중간 7비트
    PageAtlasOffset.z = Page.PageIndex >> 14;           // 상위 비트

    return PageAtlasOffset;
}

// Page 패킹 (저장용)
uint PackGlobalDistanceFieldPage(FGlobalDistanceFieldPage Page)
{
    uint PackedPage = GLOBAL_DISTANCE_FIELD_INVALID_PAGE_ID;
    if (Page.bValid)
    {
        PackedPage = Page.PageIndex & 0x00FFFFFF;  // 24비트 인덱스
        PackedPage |= Page.bCoverage ? GLOBAL_DISTANCE_FIELD_PAGE_COVERAGE_BIT : 0;
    }
    return PackedPage;
}

// Page 언패킹 (로드용)
FGlobalDistanceFieldPage UnpackGlobalDistanceFieldPage(uint PackedPage)
{
    FGlobalDistanceFieldPage Page;
    Page.PageIndex = PackedPage & 0x00FFFFFF;
    Page.bCoverage = PackedPage & GLOBAL_DISTANCE_FIELD_PAGE_COVERAGE_BIT;  // 최상위 비트
    Page.bValid = PackedPage < GLOBAL_DISTANCE_FIELD_INVALID_PAGE_ID;
    return Page;
}
```

---

## 🔧 업데이트 시스템

### 1. 점진적 업데이트 전략

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Incremental Update Strategy                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 카메라 이동 감지                                                     │
│     └─ 복셀 단위로 스냅된 이동량 계산                                    │
│                                                                         │
│  2. 새로 노출된 영역 식별                                                │
│     ┌────────────────────┐                                             │
│     │                    │                                             │
│     │    이전 프레임     │ ───→ ┌────────────────────┐                 │
│     │                    │      │█████│             │                 │
│     └────────────────────┘      │█████│  현재 프레임│                 │
│                                 │█████│             │                 │
│                                 └────────────────────┘                 │
│                                 █████ = 새로 노출된 영역               │
│                                                                         │
│  3. Staggered Updates                                                  │
│     • Clipmap 0: 매 프레임 업데이트                                     │
│     • Clipmap 1: 매 프레임 업데이트                                     │
│     • Clipmap 2-N: 2-4 프레임마다 업데이트                              │
│                                                                         │
│  4. 업데이트 순서                                                       │
│     a) Page Table 재할당 (필요 시)                                      │
│     b) MostlyStatic 캐시 업데이트                                       │
│     c) Movable 오브젝트 합성                                            │
│     d) Mip 생성                                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Full Recapture 조건

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/GlobalDistanceField.cpp:351-368`

```cpp
enum class EGlobalSDFFullRecaptureReason
{
    None,
    TooManyUpdateBounds,        // 업데이트 영역이 너무 많음
    HeightfieldStreaming,       // Heightfield 스트리밍 변경
    MeshSDFStreaming,           // Mesh SDF 스트리밍 변경
    NoViewState                 // View State 없음 (첫 프레임)
};
```

---

## 💡 Tips & 최적화

### CVar 설정 가이드

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    권장 CVar 설정                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  해상도 (메모리 ↔ 품질 트레이드오프):                                    │
│  • r.AOGlobalDFResolution 128   (기본, 균형)                            │
│  • r.AOGlobalDFResolution 256   (고품질, 메모리 4배)                    │
│  • r.AOGlobalDFResolution 64    (저품질, 모바일용)                      │
│                                                                         │
│  Clipmap 수:                                                            │
│  • r.AOGlobalDistanceField.NumClipmaps 4  (기본)                        │
│  • Lumen은 View Distance에 따라 자동 확장 (최대 6)                      │
│                                                                         │
│  업데이트 최적화:                                                        │
│  • r.AOGlobalDistanceFieldCacheMostlyStaticSeparately 1                 │
│    └─ Movable 오브젝트 많은 씬에서 필수                                 │
│  • r.AOGlobalDistanceFieldPartialUpdates 1                              │
│    └─ 대부분 상황에서 활성화                                            │
│  • r.AOGlobalDistanceFieldClipmapUpdatesPerFrame 2                      │
│    └─ 빠른 카메라 이동 시 증가 가능                                     │
│                                                                         │
│  메모리 절약:                                                           │
│  • r.AOGlobalDistanceField.OccupancyRatio 0.3 (기본)                    │
│    └─ 씬이 밀집되지 않으면 0.2로 감소 가능                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 디버깅 팁

```cpp
// 시각화 명령어
ShowFlag.VisualizeGlobalDistanceField 1
ShowFlag.DistanceFieldAO 1

// 통계 출력
r.GlobalDistanceField.Debug.ShowStats 1

// 강제 전체 업데이트 (프로파일링용)
r.AOGlobalDistanceFieldForceFullUpdate 1

// 수정된 프리미티브 로깅
r.GlobalDistanceField.Debug.LogModifiedPrimitives 1  // 모든 수정
r.GlobalDistanceField.Debug.LogModifiedPrimitives 2  // Static만
```

### 일반적인 문제 해결

```
문제: Global SDF에 구멍이나 누수 발생
원인: 얇은 표면이 복셀 해상도보다 얇음
해결:
  • r.LumenScene.GlobalSDF.CoveredExpandSurfaceScale 증가 (기본: 1.0)
  • 메쉬에 Generate Distance Field As If Two Sided 활성화

문제: 카메라 이동 시 팝인/팝아웃
원인: 스트리밍 지연 또는 업데이트 부족
해결:
  • r.AOGlobalDistanceFieldClipmapUpdatesPerFrame 증가
  • r.AOGlobalDistanceField.RecacheClipmapsWithPendingStreaming 1

문제: 메모리 사용량 과다
해결:
  • r.AOGlobalDFResolution 감소
  • r.AOGlobalDistanceField.OccupancyRatio 감소
  • r.AOGlobalDistanceFieldCacheMostlyStaticSeparately 0 (12MB 절약)
```

---

## 🔗 References

### 소스 파일 위치

| 파일 | 위치 | 설명 |
|------|------|------|
| **GlobalDistanceField.h** | Engine/Source/Runtime/Renderer/Private/ | C++ 인터페이스 |
| **GlobalDistanceField.cpp** | Engine/Source/Runtime/Renderer/Private/ | C++ 구현 |
| **GlobalDistanceFieldShared.ush** | Engine/Shaders/Private/DistanceField/ | 공용 셰이더 구조체 |
| **GlobalDistanceFieldUtils.ush** | Engine/Shaders/Private/DistanceField/ | 트레이싱 유틸리티 |
| **GlobalDistanceField.usf** | Engine/Shaders/Private/DistanceField/ | 업데이트 셰이더 |
| **GlobalDistanceFieldCompositeObjects.usf** | Engine/Shaders/Private/DistanceField/ | 오브젝트 합성 |
| **GlobalDistanceFieldMip.usf** | Engine/Shaders/Private/DistanceField/ | Mip 생성 |

### 관련 문서

- [MeshDistanceField.md](./MeshDistanceField.md) - 개별 Mesh SDF 시스템
- [LumenTracing.md](./LumenTracing.md) - Lumen의 계층적 트레이싱
- [Overview.md](./Overview.md) - Lumen 전체 아키텍처
