---
title: "Lumen Surface Cache 심층 분석"
date: "2025-12-02"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Lumen Surface Cache 심층 분석

> Updated: 2025-12-02 — Surface Cache 시스템 전체 문서화

## 🧭 Overview

**Surface Cache**는 Lumen의 핵심 데이터 구조로, 씬의 모든 표면에 대한 머티리얼 속성과 라이팅 정보를 GPU에서 효율적으로 샘플링할 수 있도록 **아틀라스 텍스처** 형태로 저장하는 시스템입니다.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Surface Cache Architecture                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Mesh      │    │   Card      │    │   Page      │    │   Atlas     │  │
│  │   Cards     │───>│   Data      │───>│   Table     │───>│   Textures  │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│       ↑                   ↑                   ↑                   ↑         │
│   6 방향 OBB         Card별 변환          가상→물리 매핑      실제 데이터    │
│   프로젝션           및 메타데이터         (LOD 레벨별)        저장소        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Mesh Cards** | 메시를 6방향 OBB로 감싸는 "카드" 집합 |
| **Card** | 단일 방향에 대한 2D 프로젝션 평면 |
| **Card Page** | Card의 LOD 레벨별 해상도 타일 |
| **Physical Atlas** | 실제 텍스처 데이터가 저장되는 아틀라스 |
| **Virtual Page Table** | 가상 페이지 → 물리 아틀라스 좌표 매핑 |

---

## 🧱 데이터 구조

### 계층적 구조

```
                    FLumenSceneData
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        FLumenMeshCards          FLumenCard
        (메시별 카드 집합)         (개별 카드)
              │                       │
              │                       ▼
              │              FLumenSurfaceMipMap[]
              │              (LOD 레벨별 Surface)
              │                       │
              └───────────┬───────────┘
                          ▼
                  FLumenPageTableEntry
                  (가상→물리 페이지 매핑)
                          │
                          ▼
                  Physical Atlas Textures
                  (Albedo, Normal, Depth, etc.)
```

### 1. FLumenMeshCards - 메시 카드 컨테이너

**📂 위치:** `LumenMeshCards.h:28`

```cpp
class FLumenMeshCards
{
public:
    FMatrix LocalToWorld = FMatrix::Identity;
    FVector3f LocalToWorldScale = FVector3f(1.0f, 1.0f, 1.0f);
    FMatrix WorldToLocalRotation = FMatrix::Identity;
    FBox LocalBounds = FBox(FVector(-1.0f), FVector(-1.0f));

    int32 PrimitiveGroupIndex = -1;
    bool bFarField = false;
    bool bHeightfield = false;
    bool bMostlyTwoSided = false;
    bool bEmissiveLightSource = false;

    uint32 FirstCardIndex = 0;
    uint32 NumCards = 0;
    uint32 CardLookup[6];  // 6방향 카드 인덱스 룩업

    TArray<int32, TInlineAllocator<1>> ScenePrimitiveIndices;
};
```

**CardLookup 인덱스 매핑:**
```
Index 0: -X 방향
Index 1: +X 방향
Index 2: -Y 방향
Index 3: +Y 방향
Index 4: -Z 방향 (아래)
Index 5: +Z 방향 (위)
```

### 2. FLumenCard - 개별 카드

**📂 위치:** `LumenSceneData.h:273`

```cpp
class FLumenCard
{
public:
    FLumenCardOBBf LocalOBB;       // 로컬 공간 OBB
    FLumenCardOBBd WorldOBB;       // 월드 공간 OBB
    FLumenCardOBBf MeshCardsOBB;   // MeshCards 공간 OBB

    bool bVisible = false;
    bool bHeightfield = false;
    bool bAxisXFlipped = false;
    ELumenCardDilationMode DilationMode = ELumenCardDilationMode::Disabled;

    // Mip Map 할당 범위
    uint8 MinAllocatedResLevel = UINT8_MAX;
    uint8 MaxAllocatedResLevel = 0;
    uint8 DesiredLockedResLevel = 0;  // 거리 기반 요청 레벨

    // 각 LOD 레벨별 Surface 할당 정보
    FLumenSurfaceMipMap SurfaceMipMaps[Lumen::NumResLevels];

    int32 MeshCardsIndex = -1;
    uint8 AxisAlignedDirectionIndex = UINT8_MAX;
    float ResolutionScale = 1.0f;
    float CardAspect = 1.0f;  // WorldOBB.Extent.X / WorldOBB.Extent.Y
};
```

### 3. FLumenSurfaceMipMap - LOD 레벨 할당 정보

**📂 위치:** `LumenSceneData.h:236`

```cpp
struct FLumenSurfaceMipMap
{
    uint8 SizeInPagesX = 0;
    uint8 SizeInPagesY = 0;
    uint8 ResLevelX = 0;
    uint8 ResLevelY = 0;

    int32 PageTableSpanOffset = -1;
    uint16 PageTableSpanSize = 0;
    bool bLocked = false;  // 항상 resident (최저 LOD)

    bool IsAllocated() const { return PageTableSpanSize > 0; }
};
```

---

## 📊 GPU 데이터 구조 (셰이더)

### FLumenCardData (GPU)

**📂 위치:** `LumenCardCommon.ush:7`

```hlsl
struct FLumenCardData
{
    // MeshCards 공간 OBB
    float3x3 MeshCardsToLocalRotation;
    float3 MeshCardsOrigin;
    float3 MeshCardsExtent;

    // 월드 공간 OBB
    float3x3 WorldToLocalRotation;
    float3 Origin;
    float3 LocalExtent;

    // 페이지 테이블 정보
    uint2 SizeInPages;
    uint PageTableOffset;
    uint2 HiResSizeInPages;
    uint HiResPageTableOffset;
    uint2 ResLevelToResLevelXYBias;

    // 플래그
    bool bVisible;
    bool bHeightfield;
    uint AxisAlignedDirection;
    uint LightingChannelMask;

    float TexelSize;  // 항상 resident 페이지의 평균 월드 텍셀 크기
};

#define LUMEN_CARD_DATA_STRIDE 10  // float4 10개 = 160 bytes
```

### FLumenCardPageData (GPU)

**📂 위치:** `LumenCardCommon.ush:103`

```hlsl
struct FLumenCardPageData
{
    uint CardIndex;
    bool bMapped;

    uint ResLevelPageTableOffset;
    uint2 ResLevelSizeInTiles;

    float2 SizeInTexels;
    float2 PhysicalAtlasCoord;

    float4 CardUVRect;
    float4 PhysicalAtlasUVRect;
    float2 CardUVTexelScale;
    float2 PhysicalAtlasUVTexelScale;

    // 업데이트 추적
    uint LastDirectLightingUpdateFrameIndex;
    uint LastIndirectLightingUpdateFrameIndex;
    uint IndirectLightingTemporalIndex;
    uint DirectLightingTemporalIndex;
};

#define LUMEN_CARD_PAGE_DATA_STRIDE 5  // float4 5개 = 80 bytes
```

### FLumenMeshCardsData (GPU)

**📂 위치:** `LumenCardCommon.ush:199`

```hlsl
struct FLumenMeshCardsData
{
    float3 WorldOrigin;
    float3x3 WorldToLocalRotation;

    uint NumCards;
    uint CardOffset;

    bool bHeightfield;
    bool bMostlyTwoSided;

    uint CardLookup[6];  // 6방향 카드 비트마스크
};

#define LUMEN_MESH_CARDS_DATA_STRIDE 6
```

---

## 🎨 Atlas 텍스처 시스템

### Atlas 레이어 구성

**📂 위치:** `LumenSurfaceCache.cpp:80`

```cpp
enum class ELumenSurfaceCacheLayer : uint8
{
    Depth,      // PF_G16 (비압축) / PF_BC4 (압축)
    Albedo,     // PF_R8G8B8A8 (비압축) / PF_BC7 (압축)
    Opacity,    // PF_G8 (비압축)
    Normal,     // PF_R8G8 (비압축) / PF_BC5 (압축)
    Emissive,   // PF_FloatR11G11B10 (비압축) / PF_BC6H (압축)
    MAX
};
```

### Atlas 텍스처 생성

```cpp
// LumenSurfaceCache.cpp:238
void FLumenSceneData::AllocateCardAtlases(FRDGBuilder& GraphBuilder, ...)
{
    const FIntPoint PageAtlasSize = GetPhysicalAtlasSize();

    // Material Property Atlases
    FrameTemporaries.AlbedoAtlas = CreateCardAtlas(..., ELumenSurfaceCacheLayer::Albedo);
    FrameTemporaries.OpacityAtlas = CreateCardAtlas(..., ELumenSurfaceCacheLayer::Opacity);
    FrameTemporaries.DepthAtlas = CreateCardAtlas(..., ELumenSurfaceCacheLayer::Depth);
    FrameTemporaries.NormalAtlas = CreateCardAtlas(..., ELumenSurfaceCacheLayer::Normal);
    FrameTemporaries.EmissiveAtlas = CreateCardAtlas(..., ELumenSurfaceCacheLayer::Emissive);

    // Lighting Atlases
    FrameTemporaries.DirectLightingAtlas = ...;  // 직접 조명
    FrameTemporaries.IndirectLightingAtlas = ...;  // 간접 조명 (Radiosity)
    FrameTemporaries.FinalLightingAtlas = ...;  // 최종 합성 조명
}
```

### 압축 모드

**📂 위치:** `LumenSurfaceCache.cpp:57`

```cpp
ESurfaceCacheCompression GetSurfaceCacheCompression()
{
    // 1. UAV Aliasing - BC 포맷으로 직접 쓰기 (가장 효율적)
    if (GRHISupportsUAVFormatAliasing && bSupportsBCTextureCompression)
        return ESurfaceCacheCompression::UAVAliasing;

    // 2. Framebuffer Compression - 하드웨어 압축
    if (GRHISupportsLossyFramebufferCompression)
        return ESurfaceCacheCompression::FramebufferCompression;

    // 3. CopyTextureRegion - 소프트웨어 복사 압축
    if (bSupportsBCTextureCompression)
        return ESurfaceCacheCompression::CopyTextureRegion;

    // 4. Disabled - 비압축
    return ESurfaceCacheCompression::Disabled;
}
```

---

## 📸 Card Capture 파이프라인

### Card Page Render Data

**📂 위치:** `LumenSceneCardCapture.h:34`

```cpp
class FCardPageRenderData
{
public:
    int32 PrimitiveGroupIndex = INDEX_NONE;

    const int32 CardIndex = INDEX_NONE;
    const int32 PageTableIndex = INDEX_NONE;
    FVector4f CardUVRect;
    FIntRect CardCaptureAtlasRect;
    FIntRect SurfaceCacheAtlasRect;

    FLumenCardOBBd CardWorldOBB;
    FViewMatrices ViewMatrices;
    FMatrix ProjectionMatrixUnadjustedForRHI;

    // 렌더링 커맨드
    int32 StartMeshDrawCommandIndex = 0;
    int32 NumMeshDrawCommands = 0;

    // Nanite 지원
    TArray<uint32, SceneRenderingAllocator> NaniteInstanceIds;
    TArray<FNaniteShadingBin, SceneRenderingAllocator> NaniteShadingBins;

    bool bResampleLastLighting = false;
    ELumenCardDilationMode DilationMode = ELumenCardDilationMode::Disabled;
};
```

### Capture Atlas 구조

```cpp
struct FCardCaptureAtlas
{
    FIntPoint Size;
    FRDGTextureRef Albedo = nullptr;
    FRDGTextureRef Normal = nullptr;
    FRDGTextureRef Emissive = nullptr;
    FRDGTextureRef DepthStencil = nullptr;
};

struct FResampledCardCaptureAtlas
{
    FIntPoint Size;
    FRDGTextureRef DirectLighting = nullptr;
    FRDGTextureRef IndirectLighting = nullptr;
    FRDGTextureRef NumFramesAccumulated = nullptr;
    FRDGBufferRef TileShadowDownsampleFactor = nullptr;
};
```

### Capture 프로세스

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Card Capture Pipeline                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Page Selection                                                           │
│     ┌─────────────┐                                                         │
│     │ Feedback    │───> 어떤 페이지가 보이는지 추적                          │
│     │ Buffer      │                                                         │
│     └─────────────┘                                                         │
│            │                                                                 │
│            ▼                                                                 │
│  2. View Setup (각 Card Page에 대해)                                         │
│     ┌─────────────────────────────────────────────────────────────┐        │
│     │ • Orthographic 프로젝션 생성                                  │        │
│     │ • Card OBB 기반 View/Projection Matrix 계산                   │        │
│     │ • Near/Far plane = LocalExtent.Z 기반                        │        │
│     └─────────────────────────────────────────────────────────────┘        │
│            │                                                                 │
│            ▼                                                                 │
│  3. Mesh Rendering (Capture Atlas에)                                        │
│     ┌─────────────────────────────────────────────────────────────┐        │
│     │ • 기존 G-Buffer 셰이더 재사용                                  │        │
│     │ • Albedo, Normal, Emissive, Depth 출력                        │        │
│     │ • Nanite: 전용 Lumen Shading Bin 사용                         │        │
│     └─────────────────────────────────────────────────────────────┘        │
│            │                                                                 │
│            ▼                                                                 │
│  4. Copy/Compress to Surface Cache Atlas                                    │
│     ┌─────────────────────────────────────────────────────────────┐        │
│     │ • LumenCardCopyPS: 개별 레이어 복사                           │        │
│     │ • BC 압축 (선택적)                                            │        │
│     │ • Dilation (foliage 등)                                       │        │
│     └─────────────────────────────────────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Surface Cache 샘플링

### 샘플링 알고리즘

**📂 위치:** `LumenSurfaceCacheSampling.ush:98`

```hlsl
FLumenCardSample ComputeSurfaceCacheSample(
    FLumenCardData Card,
    uint CardIndex,
    float2 LocalSamplePosition,
    float SampleRadius,
    bool bHiResSurface)
{
    // 1. CardUV 계산 [0, 1)
    float2 CardUV = min(SamplePositonToCardUV(Card, LocalSamplePosition), 0.999999f);

    // 2. 페이지 좌표 계산
    uint2 SizeInPages = bHiResSurface ? Card.HiResSizeInPages : Card.SizeInPages;
    uint PageTableOffset = bHiResSurface ? Card.HiResPageTableOffset : Card.PageTableOffset;

    uint2 PageCoord = CardUV * SizeInPages;
    uint LinearPageCoord = PageCoord.x + PageCoord.y * SizeInPages.x;

    // 3. 페이지 테이블에서 물리 좌표 조회
    const uint PageTableIndex = PageTableOffset + LinearPageCoord;
    const uint2 PageTableValue = LumenCardScene.PageTableBuffer.Load2(8 * PageTableIndex);

    uint2 AtlasBias;
    AtlasBias.x = ((PageTableValue.x >> 0) & 0xFFF) * MIN_CARD_RESOLUTION;
    AtlasBias.y = ((PageTableValue.x >> 12) & 0xFFF) * MIN_CARD_RESOLUTION;

    // 4. 해상도 레벨 추출
    uint2 ResLevelXY;
    ResLevelXY.x = (PageTableValue.x >> 24) & 0xF;
    ResLevelXY.y = (PageTableValue.x >> 28) & 0xF;

    // 5. 페이지 내 UV 계산
    float2 PageUV = frac(CardUV * SizeInPages);
    uint2 AtlasScale = select(ResLevelXY > SUB_ALLOCATION_RES_LEVEL,
                              PHYSICAL_PAGE_SIZE, (1u << ResLevelXY));

    // 6. 바이리니어 필터링을 위한 border 처리
    float2 MinUVBorder = select(PageCoord.xy == 0, 0.0f, 0.5f);
    float2 MaxUVBorder = select(PageCoord.xy + 1 == SizeInPages.xy, 0.0f, 0.5f);
    float2 CoordInPage = (PageUV * (AtlasScale - MinUVBorder - MaxUVBorder)) + MinUVBorder;

    // 7. 최종 Physical Atlas UV
    float2 PhysicalAtlasUV = (CoordInPage + AtlasBias) * LumenCardScene.InvPhysicalAtlasSize;

    // ... 결과 반환
}
```

### MeshCards 샘플링

**📂 위치:** `LumenSurfaceCacheSampling.ush:438`

```hlsl
void SampleLumenMeshCards(
    uint MeshCardsIndex,
    float3 WorldSpacePosition,
    float3 WorldSpaceNormal,
    float SampleRadius,
    float SurfaceCacheBias,
    bool bHiResSurface,
    inout FCardSampleAccumulator CardSampleAccumulator)
{
    FLumenMeshCardsData MeshCardsData = GetLumenMeshCardsData(MeshCardsIndex);

    // 월드 → MeshCards 공간 변환
    float3 MeshCardsSpacePosition = mul(WorldSpacePosition - MeshCardsData.WorldOrigin,
                                         MeshCardsData.WorldToLocalRotation);
    float3 MeshCardsSpaceNormal = mul(WorldSpaceNormal, MeshCardsData.WorldToLocalRotation);

    // 노멀 방향 기반 가중치 계산
    float3 AxisWeights = MeshCardsSpaceNormal * MeshCardsSpaceNormal;

    // 각 축 방향에 대해 적절한 카드 선택
    uint CardMask = 0;
    if (AxisWeights.x > 0.0f)
        CardMask |= MeshCardsData.CardLookup[MeshCardsSpaceNormal.x < 0.0f ? 0 : 1];
    if (AxisWeights.y > 0.0f)
        CardMask |= MeshCardsData.CardLookup[MeshCardsSpaceNormal.y < 0.0f ? 2 : 3];
    if (AxisWeights.z > 0.0f)
        CardMask |= MeshCardsData.CardLookup[MeshCardsSpaceNormal.z < 0.0f ? 4 : 5];

    // AABB 컬링
    // ...

    // 선택된 카드들 샘플링
    while (CardMask != 0)
    {
        const uint NextBitIndex = firstbitlow(CardMask);
        CardMask ^= 1u << NextBitIndex;

        uint CardIndex = MeshCardsData.CardOffset + NextBitIndex;
        SampleLumenCard(MeshCardsSpacePosition, MeshCardsSpaceNormal,
                        SampleRadius, SurfaceCacheBias, CardIndex,
                        AxisWeights, bHiResSurface, MeshCardsData.bHeightfield,
                        CardSampleAccumulator);
    }
}
```

### 카드 샘플링 깊이 테스트

```hlsl
void SampleLumenCard(...)
{
    // ...

    float4 TexelDepths = DepthAtlas.Gather(GlobalPointClampedSampler, CardSample.PhysicalAtlasUV);

    float NormalizedHitDistance = -(CardSpacePosition.z / LumenCardData.LocalExtent.z) * 0.5f + 0.5f;
    float BiasTreshold = SurfaceCacheBias / LumenCardData.LocalExtent.z;
    float BiasFalloff = 0.25f * BiasTreshold;

    float4 TexelVisibility = 0.0f;
    for (uint TexelIndex = 0; TexelIndex < 4; ++TexelIndex)
    {
        if (IsSurfaceCacheDepthValid(TexelDepths[TexelIndex]))
        {
            if (bHeightfield)
            {
                // Heightfield는 항상 유효
                TexelVisibility[TexelIndex] = 1.0f;
            }
            else
            {
                // 깊이 기반 가시성 (soft falloff)
                TexelVisibility[TexelIndex] = 1.0f - saturate(
                    (abs(NormalizedHitDistance - TexelDepths[TexelIndex]) - BiasTreshold)
                    / BiasFalloff);
            }
        }
    }

    float4 TexelWeights = CardSample.TexelBilinearWeights * TexelVisibility;
    // ...
}
```

---

## 📋 Feedback 시스템

### 목적

Feedback 시스템은 GPU에서 실제로 샘플링되는 페이지를 추적하여:
1. 필요한 고해상도 페이지 할당
2. 사용되지 않는 페이지 해제
3. LOD 레벨 결정

**📂 위치:** `LumenSurfaceCacheFeedback.h:19`

```cpp
class FLumenSurfaceCacheFeedback : public FRenderResource
{
public:
    class FFeedbackResources
    {
    public:
        FRDGBufferUAV* BufferAllocatorUAV = nullptr;  // 할당 카운터
        FRDGBufferSRV* BufferAllocatorSRV = nullptr;
        FRDGBufferUAV* BufferUAV = nullptr;           // 피드백 데이터
        FRDGBufferSRV* BufferSRV = nullptr;
        uint32 BufferSize = 0;
    };

    void AllocateFeedbackResources(...);
    void SubmitFeedbackBuffer(...);
    FRHIGPUBufferReadback* GetLatestReadbackBuffer();
    FIntPoint GetFeedbackBufferTileJitter() const;

private:
    uint32 FrameIndex = 0;
    const int32 MaxReadbackBuffers = 4;  // 멀티버퍼링
    TArray<FRHIGPUBufferReadback*> ReadbackBuffers;
};
```

### Feedback 셰이더 로직

**📂 위치:** `LumenSurfaceCacheSampling.ush:593`

```hlsl
#if SURFACE_CACHE_FEEDBACK
{
    // 모든 픽셀이 아닌 타일당 하나만 기록 (성능 최적화)
    if (all((DitherScreenCoord & SurfaceCacheFeedbackBufferTileWrapMask)
            == SurfaceCacheFeedbackBufferTileJitter)
        && SurfaceCacheFeedbackBufferSize > 0
        && CardSampleAccumulator.SampleWeightSum > 0.1f)
    {
        #if SURFACE_CACHE_HIGH_RES_PAGES
        {
            uint WriteOffset = 0;
            InterlockedAdd(RWSurfaceCacheFeedbackBufferAllocator[0], 1, WriteOffset);

            if (WriteOffset < SurfaceCacheFeedbackBufferSize)
            {
                // 피드백 데이터: CardIndex, DesiredResLevel, PageCoord
                RWSurfaceCacheFeedbackBuffer[WriteOffset] =
                    CardSampleAccumulator.CardSample.PackedFeedback;
            }

            // 고해상도 페이지 "last used" 마킹
            RWCardPageHighResLastUsedBuffer[CardSampleAccumulator.CardSample.CardPageIndex]
                = SurfaceCacheUpdateFrameIndex;
        }
        #else
        {
            RWCardPageLastUsedBuffer[CardSampleAccumulator.CardSample.CardPageIndex]
                = SurfaceCacheUpdateFrameIndex;
        }
        #endif
    }
}
#endif
```

---

## 🌟 Radiosity (간접 조명)

### Radiosity Frame Temporaries

**📂 위치:** `LumenRadiosity.h:8`

```cpp
namespace LumenRadiosity
{
    struct FFrameTemporaries
    {
        bool bIndirectLightingHistoryValid = false;
        bool bUseProbeOcclusion = false;

        int32 ProbeSpacing = 0;
        int32 HemisphereProbeResolution = 0;
        FIntPoint ProbeAtlasSize = FIntPoint(0, 0);
        FIntPoint ProbeTracingAtlasSize = FIntPoint(0, 0);

        // 프로브 트레이싱 결과
        FRDGTextureRef TraceRadianceAtlas = nullptr;
        FRDGTextureRef TraceHitDistanceAtlas = nullptr;

        // SH 프로브 데이터
        FRDGTextureRef ProbeSHRedAtlas = nullptr;
        FRDGTextureRef ProbeSHGreenAtlas = nullptr;
        FRDGTextureRef ProbeSHBlueAtlas = nullptr;
    };
}
```

### Final Lighting 합성

**📂 위치:** `LumenSurfaceCache.ush:50`

```hlsl
float3 CombineFinalLighting(float3 Albedo, float3 Emissive,
                            float3 DirectLighting, float3 IndirectLighting)
{
    Albedo = DecodeSurfaceCacheAlbedo(Albedo);

    float3 DiffuseLambert = Albedo * (1 / PI);
    float3 FinalLighting = (DirectLighting + IndirectLighting) * DiffuseLambert + Emissive;

    // NaN/Inf 방지 (피드백 루프에서 중요)
    FinalLighting = max(MakeFinite(FinalLighting), float3(0.0f, 0.0f, 0.0f));

    return FinalLighting;
}
```

---

## 🔧 Dilation (확장)

### 목적

Foliage나 thin geometry에서 Surface Cache 커버리지가 불완전할 때, 주변 텍셀에서 데이터를 확장하여 빈 영역을 채웁니다.

**📂 위치:** `LumenSurfaceCache.usf:341`

```hlsl
[numthreads(THREADGROUP_SIZE, THREADGROUP_SIZE, 1)]
void CopyCapturedCardPageCS(...)
{
#if DILATE_ONE_TEXEL
    // 주변 텍셀 로드 (3x3 영역)
    for (int OffsetY = 0; OffsetY < TILE_SIZE_WITH_BORDER; OffsetY += THREADGROUP_SIZE)
    {
        for (int OffsetX = 0; OffsetX < TILE_SIZE_WITH_BORDER; OffsetX += THREADGROUP_SIZE)
        {
            // ... 그룹 공유 메모리에 저장
            StoreGroupAlbedo(SharedCoord, Albedo);
            StoreGroupNormal(SharedCoord, Normal);
            GroupDepthStorage[SharedCoord.y][SharedCoord.x] = Depth;
        }
    }

    GroupMemoryBarrierWithGroupSync();

    float4 Albedo = LoadGroupAlbedo(GroupThreadId.xy + BORDER_SIZE);
    float4 Normal = LoadGroupNormal(GroupThreadId.xy + BORDER_SIZE);
    bool bValid = Normal.w > 0.5f;

    if (!bValid)
    {
        // 8방향 이웃에서 유효한 데이터 수집
        for (uint OffsetY = 0; OffsetY < 3; ++OffsetY)
        {
            for (uint OffsetX = 0; OffsetX < 3; ++OffsetX)
            {
                if (OffsetX != 1u || OffsetY != 1u)
                {
                    float4 NeighborNormal = LoadGroupNormal(NeighborCoord);
                    if (NeighborNormal.w > 0.5f)
                    {
                        Normal += float4(NeighborNormal.xyz, 1.0f);
                        Albedo += LoadGroupAlbedo(NeighborCoord);
                        Depth += GroupDepthStorage[...];
                    }
                }
            }
        }

        // 평균화
        if (WeightSum > 0.0f)
        {
            bValid = true;
            Albedo /= WeightSum;
            Depth /= WeightSum;
            Normal.xyz = normalize(Normal.xyz);
        }
    }
#endif
}
```

### Dilation 모드

```cpp
// CVarLumenSurfaceCacheDilationMode
// 0 - Disabled (기본값)
// 1 - Two-Sided만 (foliage 등)
// 2 - 모든 메시
```

---

## 🎨 데이터 인코딩/디코딩

### Depth 인코딩

**📂 위치:** `LumenSurfaceCache.ush:13`

```hlsl
float EncodeSurfaceCacheDepth(float Depth, bool bValid)
{
    // 1.0f를 invalid 마커로 예약
    float MaxValidDepth = float(0xFFFF - 1 - 0.5f) / float(0xFFFF);
    Depth = min(Depth, MaxValidDepth);
    return bValid ? Depth : 1.0f;
}

bool IsSurfaceCacheDepthValid(float Depth)
{
    return Depth < 1.0f;
}
```

### Normal 인코딩

**📂 위치:** `LumenSurfaceCache.ush:26`

```hlsl
float3 DecodeSurfaceCacheCardSpaceNormal(float2 EncodedNormal)
{
    float3 CardSpaceNormal;
    CardSpaceNormal.xy = EncodedNormal.xy * 2.0f - 1.0f;
    CardSpaceNormal.z = sqrt(max(1.0f - length2(CardSpaceNormal.xy), 0.0001f));
    return CardSpaceNormal;
}

float3 DecodeSurfaceCacheNormal(FLumenCardData Card, float2 EncodedNormal)
{
    float3 CardSpaceNormal = DecodeSurfaceCacheCardSpaceNormal(EncodedNormal);
    return normalize(mul(Card.WorldToLocalRotation, CardSpaceNormal));
}
```

### Albedo 인코딩 (Diffuse Color Boost)

```hlsl
float3 DecodeSurfaceCacheAlbedo(float3 EncodedAlbedo)
{
    // sRGB → Linear 변환
    float3 Albedo = ApplyDiffuseColorBoost(EncodedAlbedo * EncodedAlbedo, DiffuseColorBoost);
    return Albedo;
}
```

---

## 📊 상수 및 해상도 레벨

**📂 위치:** `LumenSurfaceCacheSampling.ush:79`

```hlsl
#define VIRTUAL_PAGE_SIZE         127   // 가상 페이지 크기
#define PHYSICAL_PAGE_SIZE        128   // 물리 페이지 크기 (1 border)
#define MIN_CARD_RESOLUTION       8     // 최소 카드 해상도
#define MIN_RES_LEVEL             3     // 2^3 = 8
#define MAX_RES_LEVEL             11    // 2^11 = 2048
#define SUB_ALLOCATION_RES_LEVEL  7     // log2(128), 페이지 경계
```

### 해상도 레벨 → 페이지 수 변환

```hlsl
uint2 ResLevelXYToSizeInPages(uint2 ResLevelXY)
{
    // ResLevel <= 7: 1페이지 내 sub-allocation
    // ResLevel > 7: 여러 페이지로 분할
    return select(ResLevelXY > SUB_ALLOCATION_RES_LEVEL,
                  1u << (ResLevelXY - SUB_ALLOCATION_RES_LEVEL),
                  1);
}
```

---

## 💡 성능 최적화 팁

### ✅ Best Practices

```cpp
// 1. 적절한 카드 해상도 설정
// 멀리 있는 오브젝트는 낮은 해상도로 충분
r.LumenScene.SurfaceCache.Resolution = 0.5  // 기본값에서 줄이기

// 2. 압축 활성화
r.LumenScene.SurfaceCache.Compress = 1  // UAV Aliasing (권장)

// 3. Feedback 버퍼 크기 조정
r.LumenScene.SurfaceCache.FeedbackBufferSize = 4096
```

### ❌ 피해야 할 것

```cpp
// 1. 너무 높은 해상도 요청
// - 메모리 부족으로 페이지 thrashing 발생

// 2. Dilation 과도한 사용
// - 잘못된 조명 데이터 전파 가능
r.LumenScene.SurfaceCache.DilationMode = 2  // 모든 메시에 적용 - 주의

// 3. 과도한 동적 오브젝트
// - 매 프레임 Surface Cache 재캡처 필요
```

---

## 🔍 디버깅 및 시각화

### Visualization 모드

**📂 위치:** `LumenSurfaceCacheSampling.ush:24`

```hlsl
#define VISUALIZE_MODE_SURFACE_CACHE        5
#define VISUALIZE_MODE_GEOMETRY_NORMALS     6
#define VISUALIZE_MODE_ALBEDO               8
#define VISUALIZE_MODE_NORMALS              9
#define VISUALIZE_MODE_EMISSIVE             10
#define VISUALIZE_MODE_OPACITY              11
#define VISUALIZE_MODE_CARD_WEIGHTS         12
#define VISUALIZE_MODE_DIRECT_LIGHTING      13
#define VISUALIZE_MODE_INDIRECT_LIGHTING    14
#define VISUALIZE_MODE_DIRECT_LIGHTING_UPDATES   17
#define VISUALIZE_MODE_INDIRECT_LIGHTING_UPDATES 18
#define VISUALIZE_MODE_LAST_USED_PAGE       19
#define VISUALIZE_MODE_CARD_SHARING_ID      22
```

### 콘솔 명령

```
r.LumenScene.Visualize 1          // Surface Cache 시각화 활성화
r.LumenScene.Visualize.Mode 5     // 모드 선택

// 유용한 디버깅 변수
r.LumenScene.SurfaceCache.DilationMode
r.LumenScene.SurfaceCache.Compress
r.LumenScene.SurfaceCache.Resolution
```

---

## 🔗 관련 파일 참조

| 파일 | 설명 |
|------|------|
| `LumenSceneData.h` | FLumenCard, FLumenMeshCards 등 핵심 데이터 구조 |
| `LumenMeshCards.h/cpp` | Mesh Cards 관리 |
| `LumenSurfaceCache.cpp` | Atlas 생성 및 캡처 로직 |
| `LumenSurfaceCacheFeedback.h/cpp` | GPU Feedback 시스템 |
| `LumenSceneCardCapture.h/cpp` | Card 렌더링 |
| `LumenRadiosity.h/cpp` | 간접 조명 (Radiosity) |
| `LumenCardCommon.ush` | GPU 데이터 구조 및 함수 |
| `LumenSurfaceCache.ush` | Surface Cache 인코딩/디코딩 |
| `LumenSurfaceCacheSampling.ush` | 샘플링 알고리즘 |
| `LumenSurfaceCache.usf` | 캡처 및 복사 셰이더 |

---

## 🎯 핵심 철학

> **Surface Cache는 "전처리된 GI 데이터"를 저장하는 씬 전역 캐시다.**
>
> - **Mesh Cards**: 메시를 6방향 OBB로 단순화하여 효율적 프로젝션
> - **Page Table**: 가상→물리 매핑으로 LOD 시스템 지원
> - **Feedback**: GPU-driven 방식으로 필요한 해상도 동적 결정
> - **Radiosity**: 표면 간 간접 조명 전파를 사전 계산
