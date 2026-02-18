---
title: "Nanite 래스터화 시스템 (Rasterization System)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 래스터화 시스템 (Rasterization System)

## 🧭 개요

Nanite의 래스터화 시스템은 **하드웨어 (HW)와 소프트웨어 (SW) 혼합 래스터라이저**를 사용하여 극도로 작은 삼각형(~1 픽셀)을 효율적으로 처리합니다.

### 핵심 개념

**"삼각형 크기에 따라 최적의 래스터라이저 선택"**

- 큰 삼각형 (≥ 2px) → **하드웨어 래스터라이저** (고정 기능 파이프라인)
- 작은 삼각형 (< 2px) → **소프트웨어 래스터라이저** (Compute Shader)
- Visibility Buffer 기반 지연 쉐이딩 (Deferred Shading)
- 분석적 파생변수 (Analytical Derivatives) for 텍스처 LOD

---

## 🎯 설계 철학

### 왜 혼합 래스터라이저인가?

**Brian Karis (2021 발표):** "마이크로폴리곤(~1 픽셀 삼각형)은 하드웨어 래스터라이저에서 비효율적입니다. 고정 기능 유닛의 오버헤드가 삼각형 면적보다 큽니다."

#### 하드웨어 래스터라이저의 한계

| 문제 | 설명 | 영향 |
|------|------|------|
| **고정 오버헤드** | Triangle Setup, Binning, Tile Sorting | 작은 삼각형일수록 오버헤드 비율 증가 |
| **Quad Overdraw** | 2×2 픽셀 Quad 단위 처리 | 1px 삼각형 → 4px 처리 (4배 낭비) |
| **파이프라인 레이턴시** | Vertex Fetch → Rasterize → Pixel Shader | 각 스테이지마다 지연 발생 |
| **낮은 점유율** | 작은 삼각형 → Warp/Wave 일부만 활성화 | GPU 활용률 저하 |

```
하드웨어 래스터라이저 (큰 삼각형):
┌─────────────────────────────────────┐
│  100px 삼각형                        │
│  ████████████████████████████        │
│  ████████████████████████████        │
│  ████████████████████████████        │
│  ████████████████████████            │
│  ████████████████████                │
└─────────────────────────────────────┘
  효율: ~95% (오버헤드 무시 가능)

하드웨어 래스터라이저 (작은 삼각형):
┌─────────────────────────────────────┐
│  1px 삼각형                          │
│  ██ (2×2 Quad 처리)                  │
│  ▓▓                                  │
└─────────────────────────────────────┘
  효율: ~25% (3픽셀 낭비, 오버헤드 큼)
```

#### 소프트웨어 래스터라이저 장점

```
Compute Shader 기반 SW 래스터라이저:
┌─────────────────────────────────────┐
│  128개 삼각형 (클러스터)             │
│  ┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐                   │
│  └┘└┘└┘└┘└┘└┘└┘└┘ ...               │
│                                     │
│  64개 스레드가 병렬 처리              │
│  Triangle Setup 없음                │
│  Quad 낭비 없음                      │
└─────────────────────────────────────┘
  효율: ~95% (배치 처리로 오버헤드 분산)
```

**핵심 트레이드오프:**
- **HW 래스터라이저**: 고정 기능 + 빠름 (큰 삼각형)
- **SW 래스터라이저**: 유연성 + 효율 (작은 삼각형)

---

## 🧱 혼합 래스터라이저 아키텍처

### ERasterScheduling - 실행 모드

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Nanite/NaniteCullRaster.h:25-35`

```cpp
enum class ERasterScheduling : uint8
{
    // HW 래스터라이저만 사용
    HardwareOnly = 0,

    // HW 먼저 실행, 완료 후 SW 실행 (순차)
    HardwareThenSoftware = 1,

    // HW와 SW 동시 실행 (병렬, 최대 성능)
    HardwareAndSoftwareOverlap = 2,
};
```

### 래스터라이저 선택 기준

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf:750-780`

```cpp
// 클러스터 컬링 단계에서 결정
void ProcessCluster(uint4 PackedCluster)
{
    FCluster Cluster = GetCluster(/* ... */);

    // 화면 투영 크기 계산
    float PixelEstRadius = /* Screen Space Bounding Sphere Radius */;

    // 분류 기준: GNaniteMaxPixelsPerEdge (기본 2.0)
    const bool bUseHWRaster = (PixelEstRadius >= GNaniteMaxPixelsPerEdge);

    if (bUseHWRaster)
    {
        // HW 래스터화 큐에 추가
        EmitVisibleCluster(true, /* ... */);
    }
    else
    {
        // SW 래스터화 큐에 추가
        EmitVisibleCluster(false, /* ... */);
    }
}
```

**GNaniteMaxPixelsPerEdge:**
- 기본값: 2.0 픽셀
- 의미: 클러스터 바운딩 스피어 반지름이 2픽셀 이상이면 HW
- 조정 가능: `r.Nanite.MaxPixelsPerEdge`

### 분류 프로세스 시각화

```
컬링 완료 후 가시 클러스터
            ↓
    Screen Size 계산
            ↓
     ┌──────────────┐
     │ PixelRadius? │
     └──────┬───────┘
            │
    ┌───────┴───────┐
    │               │
 ≥ 2px           < 2px
    ↓               ↓
┌─────────┐   ┌──────────┐
│   HW    │   │   SW     │
│  Queue  │   │  Queue   │
└────┬────┘   └────┬─────┘
     │             │
     ├─────────────┤
     ↓             ↓
Hardware      Software
Rasterizer    Rasterizer
     │             │
     └──────┬──────┘
            ↓
    Visibility Buffer
```

---

## 🔩 하드웨어 래스터라이저 (HW Raster)

### Vertex Shader + Pixel Shader

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf:1932-1967`

```cpp
struct VSOut
{
    float4 Position : SV_Position;  // 클립 공간 좌표

#if NANITE_HW_RASTER_INTERPOLATE_DEPTH
    float2 ClipZW : TEXCOORD0;      // Depth 보간용
#endif

    PrimitiveAttributesPacked PrimitivePacked;  // VisibleCluster Index

#if BARYCENTRIC_MODE_SV_BARYCENTRICS
    float3 Barycentrics : SV_Barycentrics;  // 하드웨어 무게중심 좌표
#elif BARYCENTRIC_MODE_EXPORT
    float2 BarycentricsUV : TEXCOORD4;      // 수동 무게중심 좌표
#endif

#if NANITE_PIXEL_PROGRAMMABLE
    float4 TexCoords : TEXCOORD5;           // UV 좌표
#endif
};
```

### HW 래스터라이저 파이프라인

```
Visible Cluster (HW Queue)
        ↓
┌─────────────────────────┐
│  Vertex Shader          │
│  - 버텍스 변환          │
│  - 클립 공간 투영       │
│  - UV 계산              │
└──────────┬──────────────┘
           ↓
┌─────────────────────────┐
│  Hardware Rasterizer    │  ← 고정 기능 유닛
│  - Triangle Setup       │
│  - Tile Binning         │
│  - Edge Equations       │
│  - Coverage Test        │
└──────────┬──────────────┘
           ↓
┌─────────────────────────┐
│  Pixel Shader           │
│  - VisibleCluster ID    │
│  - Depth Write          │
│  - (Material Eval)      │
└──────────┬──────────────┘
           ↓
   Visibility Buffer
   (또는 GBuffer)
```

**장점:**
- ✅ 하드웨어 가속 (고정 기능 유닛)
- ✅ 큰 삼각형 효율적 처리
- ✅ Early-Z, Hi-Z 최적화 자동 활용

**단점:**
- ❌ Quad Overdraw (2×2 픽셀 낭비)
- ❌ 작은 삼각형에서 오버헤드 큼
- ❌ GPU 점유율 저하 (작은 삼각형)

---

## 💻 소프트웨어 래스터라이저 (SW Raster)

### Compute Shader 기반 래스터라이저

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf:380-679`

```cpp
// 메인 진입점
[numthreads(THREADGROUP_SIZE, 1, 1)]  // 일반적으로 64 또는 128
void MicropolyRasterize(
    uint DispatchThreadID : SV_DispatchThreadID,
    uint GroupID          : SV_GroupID,
    uint GroupIndex       : SV_GroupIndex)
{
    ClusterRasterize(GroupID, GroupIndex);
}

void ClusterRasterize(uint VisibleIndex, uint GroupThreadIndex)
{
    // === STEP 1: 클러스터 데이터 로드 ===
    FVisibleCluster VisibleCluster = GetVisibleCluster(VisibleIndex, VIRTUAL_TEXTURE_TARGET);
    FCluster Cluster = GetCluster(VisibleCluster.PageIndex, VisibleCluster.ClusterIndex);

    FTriRange TriRange = GetIndexAndTriRangeSW(VisibleIndex);
    if (TriRange.Num == 0)
        TriRange.Num = Cluster.NumTris;  // 최대 128개 삼각형

    // === STEP 2: 변환 행렬 준비 ===
    FMaterialShader MaterialShader;
    MaterialShader.NaniteView = GetNaniteView(VisibleCluster.ViewId);
    MaterialShader.Cluster = Cluster;
    MaterialShader.VertTransforms = CalculateNaniteVertexTransforms(/* ... */);

    FRaster Raster = CreateRaster(NaniteView, VisibleCluster);

    // === STEP 3: 삼각형 배치 처리 (32개씩) ===
    FCachedVertex TriangleVerts[3];
    uint NumCachedVerts = 0;

    for (uint FirstTriIndex = 0; FirstTriIndex < TriRange.Num; FirstTriIndex += 32)
    {
        const uint LocalTriIndex = FirstTriIndex + GroupThreadIndex;
        const uint TriIndex = TriRange.Start + LocalTriIndex;
        const bool bTriValid = LocalTriIndex < TriRange.Num;

        // === STEP 4: 버텍스 인덱스 디코딩 ===
        uint3 VertIndexes = 0;
        if (bTriValid)
        {
            VertIndexes = DecodeTriangleIndices(Cluster, TriIndex);
            if (bReverseWindingOrder)
                VertIndexes.yz = VertIndexes.zy;
        }

        // === STEP 5: 버텍스 변환 (Wave 활용) ===
        UNROLL
        for (uint k = 0; k < 3; k++)
        {
            const uint Index = VertIndexes[k];

            // LDS 캐시 또는 Wave Intrinsics로 재사용
            TriangleVerts[k] = LoadVertexFromLDS(Index);
        }

        // === STEP 6: 버텍스 캐시 리필 ===
        const uint MaxVertIndex = max(VertIndexes.y, VertIndexes.z);

        while (WaveActiveAnyTrue(MaxVertIndex >= NumCachedVerts))
        {
            const uint LaneVertIndex = NumCachedVerts + GroupThreadIndex;

            FCachedVertex Vert;
            if (LaneVertIndex < Cluster.NumVerts)
            {
                Vert.TransformedVert = FetchTransformedNaniteVertex(/* ... */);
                Vert.PointSubpixelClip = CalculateSubpixelCoordinates(Raster, Vert.TransformedVert.PointClip);
            }

            StoreVertexToLDS(LaneVertIndex, Vert);
            NumCachedVerts += 32;
        }

        // === STEP 7: 삼각형 설정 ===
        float4 Verts[3];
        UNROLL
        for (uint k = 0; k < 3; k++)
        {
            MaterialShader.TransformedTri.Verts[k] = TriangleVerts[k].TransformedVert;
            Verts[k] = TriangleVerts[k].PointSubpixelClip;
        }

        // === STEP 8: 삼각형 래스터화 ===
        FRasterTri Tri = SetupTriangle<NANITE_SUBPIXEL_SAMPLES, !NANITE_TWO_SIDED>(Raster.ScissorRect, Verts);

        if (Tri.bIsValid && bTriValid)
        {
            uint PixelValue = (VisibleIndex + 1) << 7;
            PixelValue |= TriIndex;

            // Visibility Buffer에 쓰기
            RasterizeTriangle(Raster, Tri, PixelValue, /* ... */);
        }
    }
}
```

### 소프트웨어 래스터화 프로세스

```
Visible Cluster (SW Queue)
        ↓
┌────────────────────────────────────────┐
│  Compute Shader (64-128 Threads)       │
├────────────────────────────────────────┤
│  클러스터당 128개 삼각형 처리           │
│                                        │
│  STEP 1: 클러스터 데이터 로드          │
│  ┌────────────────────────────┐        │
│  │ Cluster, VisibleCluster    │        │
│  └────────────────────────────┘        │
│                ↓                       │
│  STEP 2: 버텍스 변환 (배치)            │
│  ┌────────────────────────────┐        │
│  │ 32개 버텍스 → LDS 캐시      │        │
│  │ Wave Intrinsics 활용        │        │
│  └────────────────────────────┘        │
│                ↓                       │
│  STEP 3: 삼각형 설정                   │
│  ┌────────────────────────────┐        │
│  │ Edge Equations 계산         │        │
│  │ Bounding Box 클리핑         │        │
│  └────────────────────────────┘        │
│                ↓                       │
│  STEP 4: 픽셀 순회 (Scanline)          │
│  ┌────────────────────────────┐        │
│  │ for (y = MinY; y <= MaxY)  │        │
│  │   for (x = MinX; x <= MaxX)│        │
│  │     if (InsideTriangle)    │        │
│  │       WriteVisBuffer()     │        │
│  └────────────────────────────┘        │
└────────────────────────────────────────┘
                ↓
        Visibility Buffer
```

### 핵심 최적화 기법

#### 1. **LDS (Local Data Share) 버텍스 캐싱**

```cpp
// 그룹 공유 메모리에 버텍스 캐시
groupshared FNaniteTransformedVert VertexCache_TransformedVerts[MAX_CLUSTER_VERTICES];
groupshared float4 VertexCache_PointSubpixelClip[MAX_CLUSTER_VERTICES];

// 버텍스 재사용 (평균 2-3배)
TriangleVerts[k] = LoadVertexFromLDS(Index);
```

#### 2. **Wave Intrinsics 활용**

```cpp
// 같은 Wave 내 스레드 간 데이터 공유
const FNaniteTransformedVert A = WaveReadLaneAt(CachedTransformedVerts[0], Index & 31);
const FNaniteTransformedVert B = WaveReadLaneAt(CachedTransformedVerts[1], Index & 31);
```

#### 3. **배치 처리 (32개 삼각형)**

```cpp
for (uint FirstTriIndex = 0; FirstTriIndex < TriRange.Num; FirstTriIndex += 32)
{
    // 32개 삼각형 병렬 처리 → 오버헤드 분산
}
```

#### 4. **서브픽셀 정밀도**

```cpp
// 고정 소수점 연산 (16.8 비트)
#define NANITE_SUBPIXEL_SAMPLES 256  // 1/256 픽셀 정밀도

float4 PointSubpixelClip = CalculateSubpixelCoordinates(Raster, PointClip);
// (x, y) → (x * 256, y * 256) 정수 연산
```

---

## 📊 분석적 파생변수 (Analytical Derivatives)

### 문제: 마이크로폴리곤에서 ddx/ddy

**Brian Karis (2021 발표):** "1픽셀 삼각형에서 하드웨어 ddx/ddy는 부정확합니다. 인접 픽셀이 다른 삼각형일 수 있습니다."

```
전통적 ddx/ddy (2×2 Quad):
┌─────┬─────┐
│ Tri │ Tri │  ← 같은 삼각형
│  A  │  A  │
├─────┼─────┤
│ Tri │ Tri │  ← ddx/ddy 정확
│  A  │  A  │
└─────┴─────┘

Nanite 마이크로폴리곤 (1px Tri):
┌─────┬─────┐
│ Tri │ Tri │  ← 다른 삼각형!
│  A  │  B  │
├─────┼─────┤
│ Tri │ Tri │  ← ddx/ddy 부정확
│  C  │  D  │
└─────┴─────┘
```

### 해결책: 해석적 미분 (Analytical Derivatives)

삼각형 내 UV 좌표를 스크린 공간 위치로부터 **직접 계산**합니다.

#### 수학적 배경

삼각형 3개 정점:
- P0, P1, P2 (Screen Space)
- UV0, UV1, UV2 (Texture Space)

무게중심 좌표 (Barycentric):
```
P = w0 * P0 + w1 * P1 + w2 * P2
UV = w0 * UV0 + w1 * UV1 + w2 * UV2

where: w0 + w1 + w2 = 1
```

Screen Space 미분:
```
dUV/dx = (UV1 - UV0) * dw1/dx + (UV2 - UV0) * dw2/dx
dUV/dy = (UV1 - UV0) * dw1/dy + (UV2 - UV0) * dw2/dy
```

무게중심 미분 (상수):
```
dw/dx, dw/dy는 삼각형당 한 번 계산
→ 모든 픽셀에서 재사용
```

#### 구현 (의사 코드)

```cpp
// 삼각형 설정 단계 (한 번만)
float3 P0 = Verts[0].xy;
float3 P1 = Verts[1].xy;
float3 P2 = Verts[2].xy;

float2 UV0 = TexCoords[0];
float2 UV1 = TexCoords[1];
float2 UV2 = TexCoords[2];

// 엣지 벡터
float2 E01 = P1 - P0;
float2 E02 = P2 - P0;

// 역행렬 (상수)
float InvDet = 1.0f / (E01.x * E02.y - E01.y * E02.x);

float2x2 InvMatrix;
InvMatrix[0][0] =  E02.y * InvDet;
InvMatrix[0][1] = -E02.x * InvDet;
InvMatrix[1][0] = -E01.y * InvDet;
InvMatrix[1][1] =  E01.x * InvDet;

// UV 미분 (삼각형당 상수)
float2 dUVdx = mul(InvMatrix, float2(1, 0)) * (UV1 - UV0) + mul(InvMatrix, float2(0, 0)) * (UV2 - UV0);
float2 dUVdy = mul(InvMatrix, float2(0, 1)) * (UV1 - UV0) + mul(InvMatrix, float2(0, 0)) * (UV2 - UV0);

// 픽셀 셰이더에서 사용
// (하드웨어 ddx/ddy 대신)
MaterialParameters.TexCoords_DDX[0] = dUVdx;
MaterialParameters.TexCoords_DDY[0] = dUVdy;

// 텍스처 LOD 계산
float LOD = 0.5f * log2(max(dot(dUVdx, dUVdx), dot(dUVdy, dUVdy)) * TextureSize * TextureSize);
```

### 장점

| 특성 | 하드웨어 ddx/ddy | 분석적 파생변수 |
|------|-----------------|----------------|
| **정확도** | 2×2 Quad 필요 | 단일 픽셀 정확 |
| **마이크로폴리곤** | 부정확 (다른 삼각형) | 정확 (삼각형 내부) |
| **연산 비용** | 하드웨어 (무료) | 추가 계산 필요 |
| **일관성** | Quad 경계에서 불연속 | 삼각형 전체 일관 |
| **텍스처 LOD** | 부정확 (깜빡임) | 정확 (안정적) |

**Brian Karis 결론:**
> "분석적 파생변수는 약간의 추가 비용이 있지만, 마이크로폴리곤에서 정확한 텍스처 샘플링을 보장합니다. 이는 Nanite의 품질에 필수적입니다."

---

## 🔀 Visibility Buffer

### Deferred Material Evaluation

**전통적 Forward Rendering:**
```
Rasterize Triangle
    ↓
Pixel Shader (즉시 실행)
    ↓
Material Evaluation (모든 픽셀)
    ↓
Lighting Calculation
    ↓
Final Color
```

**Nanite Visibility Buffer:**
```
Rasterize Triangle
    ↓
Write VisBuffer (Cluster + Triangle ID만)
    ↓
(모든 삼각형 래스터화 완료)
    ↓
VisBuffer 읽기 (보이는 픽셀만)
    ↓
Material Evaluation (중복 없음)
    ↓
Lighting Calculation
    ↓
Final Color
```

### VisBuffer 구조

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteDataDecode.ush`

```cpp
// 64-bit per pixel (일반)
struct FVisBufferPixel
{
    uint VisibleClusterIndex : 25;  // 클러스터 인덱스 (0-33M)
    uint TriangleIndex       : 7;   // 삼각형 인덱스 (0-127)
    uint Depth               : 32;  // Depth 값
};

// 32-bit per pixel (최적화 모드)
struct FVisBufferPixelCompact
{
    uint VisibleClusterIndex : 25;
    uint TriangleIndex       : 7;
};
```

### Visibility Buffer 장점

```
Forward Rendering (전통적):
┌──────────────────────────────────────┐
│  Overdraw 5x                         │
│  ████████ (삼각형 1)                 │
│  ████████ (삼각형 2) ← 5번 Shading  │
│  ████████ (삼각형 3)                 │
│  ████████ (삼각형 4)                 │
│  ████████ (삼각형 5) ← 최종 보임     │
└──────────────────────────────────────┘
  Shading Cost: 5x

Visibility Buffer (Nanite):
┌──────────────────────────────────────┐
│  Rasterize 5x (저렴)                 │
│  ████████ (ID만 쓰기)                │
│  ████████                            │
│  ████████                            │
│  ████████                            │
│  ████████ (최종 ID: 5)               │
│          ↓                           │
│  Shading 1x (비싼 연산)              │
│  ████████ (삼각형 5만)               │
└──────────────────────────────────────┘
  Shading Cost: 1x (5배 절감)
```

**핵심 이점:**
1. ✅ **Overdraw 제거** - Shading은 보이는 픽셀만
2. ✅ **Decoupling** - Rasterization과 Shading 분리
3. ✅ **캐시 효율** - Shading 단계에서 클러스터 단위 처리
4. ✅ **유연성** - 다양한 Shading Path (Base, VSM, Material Depth 등)

---

## 💡 성능 최적화

### ✅ 권장 사항

```cpp
// ✅ 좋은 예: 혼합 래스터라이저 활용
r.Nanite.MaxPixelsPerEdge 2  // 기본값, 균형

// ✅ 좋은 예: SW 래스터라이저 우선 (마이크로폴리곤 많은 장면)
r.Nanite.MaxPixelsPerEdge 10  // SW 래스터라이저 더 많이 사용

// ✅ 좋은 예: Visibility Buffer 최적화
r.Nanite.CompressedVisBuffer 1  // 32-bit VisBuffer (메모리 절약)
```

### ❌ 피해야 할 설정

```cpp
// ❌ 나쁜 예: HW만 사용 (마이크로폴리곤 비효율)
r.Nanite.MaxPixelsPerEdge 0  // 모든 클러스터 HW 사용

// ❌ 나쁜 예: SW만 사용 (큰 삼각형 비효율)
r.Nanite.MaxPixelsPerEdge 999  // 모든 클러스터 SW 사용
```

### 성능 프로파일링

```cpp
// 콘솔 명령어 (에디터)
r.Nanite.ShowStats 1              // Nanite 통계 표시
r.Nanite.Visualize 1              // Overdraw 시각화
r.Nanite.Visualize 7              // HW vs SW 분류 시각화

stat GPU                          // GPU 타이밍
stat Nanite                       // Nanite 세부 통계
```

**통계 해석:**
- `HW Clusters` vs `SW Clusters` 비율 → 분류 효율
- `Rasterize Time` → 래스터화 병목
- `Shading Time` → Material 복잡도
- `Overdraw` → Visibility Buffer 효과

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Cluster.md](./Cluster.md) - 클러스터 생성 및 구조
- [Culling.md](./Culling.md) - Persistent Threads 컬링

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
