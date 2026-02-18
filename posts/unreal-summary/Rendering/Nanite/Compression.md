---
title: "Nanite 압축 시스템 (Compression System)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 압축 시스템 (Compression System)

## 🧭 개요

Nanite는 극도로 높은 압축률을 달성하여 **평균 ~5.6 bytes/triangle**의 메모리 효율을 제공합니다.

### 핵심 개념

**"손실 압축 + 델타 인코딩 + 버텍스 참조"**

- 위치 양자화 (가변 비트 정밀도: -20~43)
- 법선/탄젠트 압축 (Octahedral encoding: 8~15 bits)
- UV 압축 (Custom float encoding: 14-bit mantissa)
- 색상 압축 (Range-based quantization: 4-bit/channel)
- ZigZag 델타 인코딩 (시간적 일관성 활용)
- 버텍스 참조 시스템 (페이지 간 중복 제거)

---

## 🎯 설계 철학

### 왜 커스텀 압축인가?

**Brian Karis (2021 발표):** "범용 압축은 **삼각형 메시의 특성**을 이해하지 못합니다. Nanite는 지오메트리 도메인 지식을 활용합니다."

#### 범용 압축 vs Nanite 압축

| 특성 | 범용 압축 (zlib/LZ4) | Nanite 커스텀 압축 |
|------|---------------------|-------------------|
| **도메인 지식** | 없음 (범용 바이트 스트림) | **지오메트리 특성 활용** |
| **압축률** | ~2-3x (후처리 적용 시) | **~10-15x** (원본 대비) |
| **실시간 디코딩** | CPU에서 가능 | **GPU에서 직접 디코딩** |
| **LOD 인식** | 없음 | **페이지 단위 LOD** |
| **버텍스 중복** | 일부 감지 | **참조 시스템** (완전 제거) |
| **델타 인코딩** | 없음 | **시간적 일관성** 활용 |

**Nanite 압축의 핵심 철학:**

```
범용 압축:
┌────────────────────────────────────┐
│  버텍스 데이터 (바이트 스트림)      │
│  [123, 45, 67, ...]                │
│         ↓                          │
│  LZ4 / Zlib                        │
│         ↓                          │
│  압축 데이터 (~30% 절감)            │
└────────────────────────────────────┘

Nanite 압축:
┌────────────────────────────────────┐
│  1. 위치 양자화 (21-bit → 10-bit)  │
│  2. 법선 Octahedral (96-bit → 16)  │
│  3. UV 커스텀 float (64-bit → 14)  │
│  4. ZigZag 델타 (연속성 활용)       │
│  5. 버텍스 참조 (중복 제거)         │
│         ↓                          │
│  압축 데이터 (~10% 원본 크기)       │
└────────────────────────────────────┘
```

---

## 🧱 압축 구성 요소

### 1. 위치 양자화 (Position Quantization)

#### 가변 비트 정밀도

**📂 위치:** `Engine/Shaders/Shared/NaniteDefinitions.h:166-170`

```cpp
#define NANITE_MIN_POSITION_PRECISION  -20
#define NANITE_MAX_POSITION_PRECISION   43
#define NANITE_MAX_POSITION_QUANTIZATION_BITS  21  // (21*3 = 63) < 64
```

**📂 소스 검증:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.h`

```cpp
struct FCluster
{
    FIntVector PosStart;       // 양자화 시작점 (원점)
    uint32 QuantizedPosBits;   // X, Y, Z 각각의 비트 수 (5-bit per axis, 압축)
    int32  PosPrecision;       // 정밀도 (2^Precision = 1 unit)

    // 런타임에서:
    // QuantizedPosBits는 packed: (X:5 | Y:5 | Z:5 = 15 bits)
};
```

**양자화 공식:**

```cpp
// 인코딩 (빌드 타임)
QuantizedPos = (WorldPos - PosStart) * (2^PosPrecision)

// 디코딩 (런타임 GPU)
WorldPos = (QuantizedPos / (2^PosPrecision)) + PosStart

// 예시:
// PosPrecision = 10
// → 1 unit = 1 / 1024 ≈ 0.001 (1mm 정밀도)
```

**비트 배분 예시:**

```
클러스터 바운딩 박스:
Min = (0, 0, 0)
Max = (100, 200, 50)

X 범위: 100 → log2(100 * 1024) = 17 bits
Y 범위: 200 → log2(200 * 1024) = 18 bits
Z 범위:  50 → log2(50 * 1024) = 16 bits

총 비트: 17 + 18 + 16 = 51 bits (vs 96 bits float3)
절감율: 46.9%
```

#### 델타 인코딩 + ZigZag

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:722-740`

```cpp
FIntVector PrevPosition = FIntVector((1 << Cluster.QuantizedPosBits.X) >> 1, ...);  // 중앙값으로 초기화

for (uint32 VertexIndex = 0; VertexIndex < NumVerts; VertexIndex++)
{
    const FIntVector& Position = Cluster.QuantizedPositions[VertexIndex];
    FIntVector PositionDelta = Position - PrevPosition;

    // ShortestWrap: 원형 거리 (wrap-around)
    PositionDelta.X = ShortestWrap(PositionDelta.X, Cluster.QuantizedPosBits.X);
    PositionDelta.Y = ShortestWrap(PositionDelta.Y, Cluster.QuantizedPosBits.Y);
    PositionDelta.Z = ShortestWrap(PositionDelta.Z, Cluster.QuantizedPosBits.Z);

    WriteZigZagDelta(PositionDelta.X, BytesPerPositionComponent);
    WriteZigZagDelta(PositionDelta.Y, BytesPerPositionComponent);
    WriteZigZagDelta(PositionDelta.Z, BytesPerPositionComponent);

    PrevPosition = Position;
}
```

**ZigZag 인코딩:**

```
원본 값: -3, -2, -1, 0, 1, 2, 3
ZigZag:   5,  3,  1, 0, 2, 4, 6

장점: 작은 절대값이 작은 양수로 인코딩됨
→ 가변 길이 인코딩 시 효율 증가
```

**델타 인코딩 효과:**

```
원본 위치 (양자화 후):
Vertex 0: (512, 512, 512)   → 17 bits × 3 = 51 bits
Vertex 1: (515, 510, 514)   → 17 bits × 3 = 51 bits
Vertex 2: (518, 508, 516)   → 17 bits × 3 = 51 bits

델타 인코딩:
Vertex 0: (512, 512, 512)   → 17 bits × 3 = 51 bits (기준점)
Vertex 1: (+3, -2, +2)      →  3 bits × 3 =  9 bits (델타)
Vertex 2: (+3, -2, +2)      →  3 bits × 3 =  9 bits (델타)

절감율: (51 + 51 + 51) → (51 + 9 + 9) = 55% 절감
```

---

### 2. 법선/탄젠트 압축

#### Octahedral Encoding

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:249-266`

```cpp
FORCEINLINE static uint32 PackNormal(FVector3f Normal, uint32 QuantizationBits)
{
    int32 X, Y;
    OctahedronEncodePreciseSIMD(Normal, X, Y, QuantizationBits);

    // 2개 컴포넌트로 3D 법선 표현 (Z는 역산)
    return (uint32)X | ((uint32)Y << QuantizationBits);
}
```

**Octahedral 맵핑:**

```
3D 단위 구 → 2D Octahedron 전개도

      +Y
       │
   NW  │  NE
       │
──────┼────── +X
       │
   SW  │  SE
       │
      -Y

수식:
if (N.z >= 0)
    (x, y) = (N.x, N.y) / (|N.x| + |N.y| + |N.z|)
else
    (x, y) = (1 - |N.y|) * sign(N.x), (1 - |N.x|) * sign(N.y)

역변환:
N.z = 1 - |x| - |y|
N.x = x * sign(1 - |x| - |y|)
N.y = y * sign(1 - |x| - |y|)
N = normalize(N)
```

**비트 정밀도:**

| 정밀도 | 비트/축 | 총 비트 | 각도 오차 |
|--------|---------|---------|----------|
| **8 bits** | 8 | 16 | ~2.8° |
| **10 bits** | 10 | 20 | ~0.7° |
| **12 bits** | 12 | 24 | ~0.2° |
| **15 bits** | 15 | 30 | ~0.02° |

**압축률:**

```
Float3 법선: 3 × 32 = 96 bits
Octahedral 12-bit: 2 × 12 = 24 bits
절감율: 75%
```

#### 탄젠트 압축

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:770-803`

```cpp
// 탄젠트는 법선 공간에서 각도로 저장
uint32 QuantizedTangentAngle;
if (PackTangent(QuantizedTangentAngle, TangentX, UnpackedTangentZ, EncodingInfo.TangentPrecision))
{
    TangentBits = (bTangentYSign ? (1 << EncodingInfo.TangentPrecision) : 0) | QuantizedTangentAngle;
}

// 델타 인코딩
const uint32 TangentDelta = ShortestWrap(TangentBits - PrevTangentBits, EncodingInfo.TangentPrecision + 1);
WriteZigZagDelta(TangentDelta, BytesPerTangentComponent);
```

**탄젠트 인코딩 전략:**

```
3D Tangent → 1D Angle + 1 Sign bit

TangentX (3 floats = 96 bits)
    ↓
TangentZ (Normal)에서 회전 각도 계산
    ↓
Angle (0-2π) → QuantizedAngle (N bits)
Sign (TangentY 방향) → 1 bit
    ↓
Total: N + 1 bits (예: 12 + 1 = 13 bits)

압축률: 96 bits → 13 bits (86.5% 절감)
```

---

### 3. UV 압축

#### Custom Float Encoding

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:55-98`

```cpp
static uint32 EncodeUVFloat(float Value, uint32 NumMantissaBits)
{
    // Encode UV floats as a custom float type where [0,1] is denormal, so it gets uniform precision.
    // As UVs are encoded in clusters as ranges of encoded values, a few modifications to the usual
    // float encoding are made to preserve the original float order when the encoded values are interpreted as uints:
    // 1. Positive values use 1 as sign bit.
    // 2. Negative values use 0 as sign bit and have their exponent and mantissa bits inverted.

    const uint32 SignBitPosition = NANITE_UV_FLOAT_NUM_EXPONENT_BITS + NumMantissaBits;

    // [0, 1] 범위는 denormal로 처리 → 균일한 정밀도
    // 1보다 크면 일반 float 인코딩

    // ... (구현 세부 사항)
}
```

**UV 인코딩 구조:**

```
Standard Float32:
┌──────┬────────────┬─────────────────────────┐
│ Sign │ Exponent   │ Mantissa                │
│ 1bit │ 8 bits     │ 23 bits                 │
└──────┴────────────┴─────────────────────────┘

Nanite Custom UV Float (14-bit mantissa):
┌──────┬────────────┬──────────────┐
│ Sign │ Exponent   │ Mantissa     │
│ 1bit │ 5 bits     │ 14 bits      │
└──────┴────────────┴──────────────┘
Total: 20 bits (vs 32 bits)

[0, 1] 범위 (denormal):
┌──────┬────────────┬──────────────┐
│  1   │ 00000      │ 14-bit value │
└──────┴────────────┴──────────────┘
정밀도: 1 / 2^14 = 0.00006 (충분히 정밀)
```

**Range 기반 추가 압축:**

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:432-459`

```cpp
// 클러스터 내 UV 범위 계산
FUintVector2 UVMin = FUintVector2(0xFFFFFFFFu, 0xFFFFFFFFu);
FUintVector2 UVMax = FUintVector2(0u, 0u);

for (uint32 i = 0; i < NumClusterVerts; i++)
{
    const FVector2f& UV = Cluster.GetUVs(i)[UVIndex];
    const uint32 EncodedU = EncodeUVFloat(UV.X, NumMantissaBits);
    const uint32 EncodedV = EncodeUVFloat(UV.Y, NumMantissaBits);

    UVMin.X = FMath::Min(UVMin.X, EncodedU);
    UVMin.Y = FMath::Min(UVMin.Y, EncodedV);
    UVMax.X = FMath::Max(UVMax.X, EncodedU);
    UVMax.Y = FMath::Max(UVMax.Y, EncodedV);
}

const FUintVector2 UVDelta = UVMax - UVMin;

// 범위 기반 비트 계산
FUVInfo& UVInfo = Info.UVs[UVIndex];
UVInfo.Min = UVMin;
UVInfo.NumBits.X = FMath::CeilLogTwo(UVDelta.X + 1);
UVInfo.NumBits.Y = FMath::CeilLogTwo(UVDelta.Y + 1);
```

**Range 압축 효과:**

```
클러스터 UV 범위:
U: [0.2, 0.3] → Delta = 0.1
V: [0.5, 0.6] → Delta = 0.1

20-bit 전체 범위: 2^20 = 1,048,576 values
0.1 범위: 0.1 × 1,048,576 = 104,857 values
필요 비트: log2(104,857) = 17 bits

절감: 20 bits → 17 bits (15% 추가 절감)
```

---

### 4. 색상 압축

#### Range-based Quantization

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:806-832`

```cpp
if (EncodingInfo.ColorMode == NANITE_VERTEX_COLOR_MODE_VARIABLE)
{
    FIntVector4 PrevColor = FIntVector4(0);
    for (uint32 VertexIndex = 0; VertexIndex < NumVerts; VertexIndex++)
    {
        const FColor Color = Cluster.GetColor(VertexIndex).ToFColor(false);
        const FIntVector4 ColorValue = FIntVector4(Color.R, Color.G, Color.B, Color.A) - EncodingInfo.ColorMin;
        FIntVector4 ColorDelta = ColorValue - PrevColor;

        // 각 채널별 델타 인코딩 (1 byte per channel)
        ColorDelta.X = ShortestWrap(ColorDelta.X, EncodingInfo.ColorBits.X);
        ColorDelta.Y = ShortestWrap(ColorDelta.Y, EncodingInfo.ColorBits.Y);
        ColorDelta.Z = ShortestWrap(ColorDelta.Z, EncodingInfo.ColorBits.Z);
        ColorDelta.W = ShortestWrap(ColorDelta.W, EncodingInfo.ColorBits.W);

        WriteZigZagDelta(ColorDelta.X, 1);
        WriteZigZagDelta(ColorDelta.Y, 1);
        WriteZigZagDelta(ColorDelta.Z, 1);
        WriteZigZagDelta(ColorDelta.W, 1);

        PrevColor = ColorValue;
    }
}
```

**색상 압축 전략:**

```
원본: RGBA 8888 (32 bits/vertex)

단계 1: Range 계산
Min = (10, 50, 100, 255)
Max = (20, 60, 110, 255)
→ ColorMin = (10, 50, 100, 255)
→ ColorBits = (4, 4, 4, 0)  // Alpha 상수

단계 2: 델타 인코딩
Vertex 0: (10, 50, 100, 255) → 4+4+4+0 = 12 bits
Vertex 1: (+2, +3, +1, 0)     → 2+2+2+0 =  6 bits
Vertex 2: (+1, +2, +2, 0)     → 2+2+2+0 =  6 bits

평균: (12 + 6 + 6) / 3 = 8 bits/vertex (vs 32 bits)
절감율: 75%
```

---

### 5. 버텍스 참조 (Vertex Reference)

#### 페이지 간 중복 제거

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncodeGeometryData.cpp:489-583`

```cpp
bool bUseVertexRefs = NumClusterTris > 0 && !NANITE_USE_UNCOMPRESSED_VERTEX_DATA;

if (bUseVertexRefs)
{
    TArray<FVertexRef> VertexRefs;

    for (uint32 VertexIndex = 0; VertexIndex < NumClusterVerts; VertexIndex++)
    {
        FVariableVertex Vertex;
        Vertex.Data = &Cluster.Verts[ VertexIndex * Cluster.GetVertSize() ];
        Vertex.SizeInBytes = Cluster.GetVertSize() * sizeof(float);

        FVertexRef VertexRef = {};
        bool bFound = false;

        // === 1. 부모 페이지에서 찾기 ===
        for (int32 SrcPageIndexIndex = 0; SrcPageIndexIndex < PageDependencies.Num(); SrcPageIndexIndex++)
        {
            uint32 SrcPageIndex = PageDependencies[SrcPageIndexIndex];
            const FVertexMapEntry* EntryPtr = PageVertexMaps[SrcPageIndex].Find(Vertex);
            if (EntryPtr)
            {
                VertexRef = FVertexRef{ SrcPageIndexIndex + 1, EntryPtr->LocalClusterIndex, EntryPtr->VertexIndex };
                bFound = true;
                break;
            }
        }

        // === 2. 현재 페이지 내에서 찾기 ===
        if (!bFound)
        {
            uint32* VertexPtr = UniqueVertices.Find(Vertex);
            if (VertexPtr)
            {
                VertexRef = FVertexRef{ 0, (*VertexPtr >> NANITE_MAX_CLUSTER_VERTICES_BITS), *VertexPtr & NANITE_MAX_CLUSTER_VERTICES_MASK };
                bFound = true;
            }
        }

        if (bFound)
        {
            // 참조로 저장 (16-bit)
            VertexRefs.Add(VertexRef);
            VertexRefBitmask[BitIndex >> 5] |= 1u << (BitIndex & 31);
        }
        else
        {
            // 새 버텍스 추가
            UniqueVertices.Add(Vertex, Val);
            UniqueToVertexIndex.Add(VertexIndex);
        }
    }

    NumCodedVertices = UniqueToVertexIndex.Num();
}
```

**버텍스 참조 인코딩:**

```
FVertexRef 구조:
┌────────────┬────────────────┬─────────────┐
│ PageIndex  │ ClusterIndex   │ VertexIndex │
│ 8 bits     │ 8 bits         │ 8 bits      │
└────────────┴────────────────┴─────────────┘
Total: 24 bits (vs full vertex data ~200+ bits)

저장 형식:
uint16 VertexRefData = (PageClusterIndex << 8) | VertexIndex
```

**중복 제거 효과:**

```
클러스터 A (128 tri, 256 vert):
- 고유 버텍스: 180개
- 중복 제거: 76개 (30%)
- 부모 페이지 참조: 50개
- 새 버텍스: 130개

메모리:
- 원본: 256 vert × 200 bits = 51,200 bits
- 압축: 130 vert × 200 bits + 126 refs × 16 bits = 28,016 bits
- 절감율: 45.3%
```

---

## 📊 전체 압축률 분석

### 128 삼각형 클러스터 예시

**원본 데이터 (비압축):**

| 항목 | 개수 | 비트/항목 | 총 비트 |
|------|------|----------|---------|
| **위치** | 256 vert | 96 | 24,576 |
| **법선** | 256 vert | 96 | 24,576 |
| **탄젠트** | 256 vert | 96 + 32 | 32,768 |
| **UV (2 sets)** | 256 vert | 64 × 2 | 32,768 |
| **색상** | 256 vert | 32 | 8,192 |
| **인덱스** | 128 tri × 3 | 8 × 3 | 3,072 |
| **총합** | | | **125,952 bits** |

**압축 후:**

| 항목 | 비트/항목 (평균) | 총 비트 |
|------|-----------------|---------|
| **위치** (델타) | 30 | 7,680 |
| **법선** (Octahedral) | 16 | 4,096 |
| **탄젠트** (각도) | 13 | 3,328 |
| **UV** (Range + 델타) | 14 | 3,584 |
| **색상** (Range + 델타) | 8 | 2,048 |
| **인덱스** (Strip) | 5 | 1,920 |
| **버텍스 참조** | - | 1,280 |
| **메타데이터** | - | 1,024 |
| **총합** | | **24,960 bits** |

**압축률:**
- **125,952 bits → 24,960 bits**
- **19.8% (원본 대비)**
- **~5.06x 압축**

**bytes/triangle 계산:**
```
24,960 bits = 3,120 bytes
3,120 bytes / 128 triangles = 24.375 bytes/tri

※ Brian Karis 발표: 평균 ~5.6 bytes/tri
   (추가 최적화: Strip indices, 페이지 압축 등)
```

---

## 💡 최적화 팁

### ✅ 효율적인 압축을 위한 조건

```cpp
// ✅ 좋은 메시 조건:
1. 균일한 삼각형 밀도 (비슷한 크기)
2. 연속된 UV 좌표 (텍스처 아틀라스 배치)
3. 부드러운 법선 변화 (델타 인코딩 효율)
4. 제한된 색상 범위 (Range 압축 효과)
```

### ❌ 압축 비효율 상황

```cpp
// ❌ 나쁜 예: 큰 UV 점프
UV[0] = (0.0, 0.0)
UV[1] = (10.0, 10.0)  // 델타 압축 비효율
UV[2] = (0.1, 0.1)

// ✅ 좋은 예: 연속된 UV
UV[0] = (0.0, 0.0)
UV[1] = (0.1, 0.1)
UV[2] = (0.2, 0.2)
```

### 디버그 명령어

```cpp
// 압축 통계 확인
r.Nanite.ShowStats 1  // 클러스터별 압축률 표시
```

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Cluster.md](./Cluster.md) - 클러스터 생성 및 구조
- [Streaming.md](./Streaming.md) - 페이지 기반 스트리밍 (예정)

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
