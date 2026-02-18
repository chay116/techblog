---
title: "Nanite 머티리얼 시스템 (Material System)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 머티리얼 시스템 (Material System)

## 🧭 개요

Nanite는 **Visibility Buffer 기반 Deferred Material Evaluation**을 사용하여 효율적인 머티리얼 처리를 제공합니다.

### 핵심 개념

**"래스터화와 셰이딩 분리 + 머티리얼 배칭"**

- Visibility Buffer: 픽셀당 Triangle ID만 저장
- Deferred Shading: 보이는 픽셀만 셰이딩
- Material Binning: 같은 머티리얼 픽셀 그룹화
- Overdraw 제거: 5x → 1x 셰이딩 비용 절감

---

## 🎯 설계 철학

### 왜 Deferred Material Evaluation인가?

**Brian Karis (2021 발표):** "Forward Rendering에서 마이크로폴리곤은 **Overdraw**로 인해 **5-10배 중복 셰이딩**이 발생합니다. Visibility Buffer는 이를 완전히 제거합니다."

#### Forward vs Deferred 비교

```
Forward Rendering (전통적):
┌─────────────────────────────────────────────┐
│  Rasterize Triangle 1 → Pixel Shader        │
│  Rasterize Triangle 2 → Pixel Shader        │
│  Rasterize Triangle 3 → Pixel Shader        │
│  Rasterize Triangle 4 → Pixel Shader        │
│  Rasterize Triangle 5 → Pixel Shader (보임) │
│                                             │
│  Overdraw 5x → 모든 삼각형 셰이딩           │
└─────────────────────────────────────────────┘
  Shading Cost: 5x

Nanite Visibility Buffer:
┌─────────────────────────────────────────────┐
│  Rasterize All (ID만 쓰기) → VisBuffer      │
│  VisBuffer = { TriangleID: 5, Depth: 0.8 }  │
│         ↓                                   │
│  Shade 픽셀 (Triangle 5만)                  │
└─────────────────────────────────────────────┘
  Shading Cost: 1x (5배 절감)
```

---

## 🧱 Visibility Buffer 구조

### 64-bit VisBuffer 포맷

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteDataDecode.ush`

```cpp
// 64-bit per pixel
struct FVisBufferPixel
{
    uint VisibleClusterIndex : 25;  // 클러스터 인덱스 (0-33M)
    uint TriangleIndex       : 7;   // 삼각형 인덱스 (0-127)
    uint Depth               : 32;  // Depth 값
};

// 또는 32-bit 압축 모드
struct FVisBufferPixelCompact
{
    uint VisibleClusterIndex : 25;
    uint TriangleIndex       : 7;
};
```

### VisBuffer 쓰기 프로세스

```
Rasterize Pass:
    ↓
┌────────────────────────────────────────────┐
│  각 픽셀에 대해:                            │
│  - ClusterIndex 인코딩                      │
│  - TriangleIndex 인코딩                     │
│  - Depth 쓰기                              │
│                                            │
│  InterlockedMin(DepthBuffer, NewDepth)     │
│  if (NewDepth < OldDepth):                 │
│      VisBuffer[XY] = PackedClusterTri      │
└────────────────────────────────────────────┘

결과 VisBuffer:
┌───┬───┬───┬───┬───┐
│C1 │C1 │C2 │C3 │C3 │  ← 각 픽셀은 보이는 Triangle ID 저장
├───┼───┼───┼───┼───┤
│C1 │C2 │C2 │C3 │Sky│
└───┴───┴───┴───┴───┘
```

---

## 🎨 Material Shading Pass

### Shading 프로세스

```
VisBuffer 읽기
    ↓
┌────────────────────────────────────────────┐
│  1. Unpack Cluster + Triangle ID           │
│  2. Fetch 버텍스 데이터                     │
│  3. Barycentric 보간                       │
│  4. 머티리얼 평가 (텍스처, 라이팅)          │
│  5. 최종 색상 출력                          │
└────────────────────────────────────────────┘
```

**📂 위치(개념도):** `Engine/Shaders/Private/Nanite/NaniteExportGBuffer.usf`

```hlsl
[numthreads(8, 8, 1)]
void EmitMaterialDepthPS(uint2 PixelPos : SV_DispatchThreadID)
{
    // === STEP 1: VisBuffer 읽기 ===
    uint VisBufferData = VisBuffer[PixelPos];
    uint ClusterIndex = (VisBufferData >> 7) & 0x1FFFFFF;
    uint TriangleIndex = VisBufferData & 0x7F;

    if (ClusterIndex == 0)
        return;  // 빈 픽셀

    // === STEP 2: 클러스터 데이터 로드 ===
    FVisibleCluster VisibleCluster = GetVisibleCluster(ClusterIndex);
    FCluster Cluster = GetCluster(VisibleCluster.PageIndex, VisibleCluster.ClusterIndex);

    // === STEP 3: 삼각형 버텍스 가져오기 ===
    uint3 VertexIndices = DecodeTriangleIndices(Cluster, TriangleIndex);

    float3 Pos0, Pos1, Pos2;
    float2 UV0, UV1, UV2;
    float3 Normal0, Normal1, Normal2;

    // 버텍스 데이터 디코딩
    DecodeVertex(Cluster, VertexIndices.x, Pos0, UV0, Normal0, ...);
    DecodeVertex(Cluster, VertexIndices.y, Pos1, UV1, Normal1, ...);
    DecodeVertex(Cluster, VertexIndices.z, Pos2, UV2, Normal2, ...);

    // === STEP 4: Barycentric 보간 ===
    float3 Barycentrics = ComputeBarycentrics(PixelPos, Pos0, Pos1, Pos2);

    float2 UV = Barycentrics.x * UV0 + Barycentrics.y * UV1 + Barycentrics.z * UV2;
    float3 Normal = normalize(Barycentrics.x * Normal0 + Barycentrics.y * Normal1 + Barycentrics.z * Normal2);

    // === STEP 5: 머티리얼 평가 ===
    FMaterialPixelParameters MaterialParameters = GetMaterialPixelParameters(UV, Normal, ...);
    FPixelMaterialInputs MaterialInputs = CalcMaterialParameters(MaterialParameters);

    float3 BaseColor = MaterialInputs.BaseColor;
    float Metallic = MaterialInputs.Metallic;
    float Roughness = MaterialInputs.Roughness;

    // === STEP 6: 라이팅 계산 ===
    float3 FinalColor = EvaluateLighting(BaseColor, Normal, Metallic, Roughness, ...);

    // === STEP 7: 출력 ===
    OutColor[PixelPos] = float4(FinalColor, 1.0f);
}
```

---

## 🔀 Material Binning

### 왜 Material Binning인가?

**문제:** 픽셀별로 다른 머티리얼을 평가하면 **Divergent Execution**이 발생합니다.

```
Divergent Execution (비효율):
Warp (32 threads):
  Thread 0-7:   Material A (복잡한 셰이더)
  Thread 8-15:  Material B (간단한 셰이더)
  Thread 16-31: Material C (중간 셰이더)

→ 모든 스레드가 가장 긴 셰이더 대기 (직렬화)
```

**해결책: Material Binning**

```
Material Binning (효율):
Pass 1: Material A 픽셀만 (Thread 일관성)
Pass 2: Material B 픽셀만 (Thread 일관성)
Pass 3: Material C 픽셀만 (Thread 일관성)

→ 각 Pass에서 모든 스레드가 같은 셰이더 실행
```

### Binning 프로세스

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Nanite/NaniteShading.cpp`

```cpp
void EmitShadingCommands(/* ... */)
{
    // === STEP 1: VisBuffer에서 Material ID 수집 ===
    TArray<uint32> MaterialCounts;
    for (uint32 PixelIndex = 0; PixelIndex < NumPixels; PixelIndex++)
    {
        uint32 ClusterIndex = VisBuffer[PixelIndex].ClusterIndex;
        uint32 MaterialID = ClusterMaterials[ClusterIndex];
        MaterialCounts[MaterialID]++;
    }

    // === STEP 2: Material별 Dispatch 생성 ===
    for (uint32 MaterialID = 0; MaterialID < NumMaterials; MaterialID++)
    {
        if (MaterialCounts[MaterialID] == 0)
            continue;

        // Material별 Pixel 리스트 생성
        FRDGBufferRef MaterialPixelBuffer = CreateMaterialPixelList(MaterialID);

        // Dispatch
        FEmitMaterialDepthPS::FParameters* PassParameters = GraphBuilder.AllocParameters<FEmitMaterialDepthPS::FParameters>();
        PassParameters->MaterialID = MaterialID;
        PassParameters->MaterialPixels = MaterialPixelBuffer;

        TShaderMapRef<FEmitMaterialDepthPS> PixelShader(ShaderMap);
        GraphBuilder.AddPass(
            RDG_EVENT_NAME("Nanite::EmitMaterialDepth (Mat %d)", MaterialID),
            PassParameters,
            ERDGPassFlags::Raster,
            [PixelShader, PassParameters](FRHICommandList& RHICmdList)
            {
                RHICmdList.SetGlobalShaderParameter(/* ... */);
                RHICmdList.DrawPrimitive(/* ... */);
            });
    }
}
```

---

## 📊 성능 특성

### Overdraw 제거 효과

**측정 (Brian Karis 벤치마크):**

| 시나리오 | Forward (Overdraw) | Visibility Buffer | 절감율 |
|---------|-------------------|-------------------|--------|
| **근거리 (많은 디테일)** | 8.5ms | 1.2ms | 85.9% |
| **중거리 (중간 디테일)** | 5.0ms | 1.0ms | 80.0% |
| **원거리 (낮은 디테일)** | 2.0ms | 0.8ms | 60.0% |

### Material Binning 효과

```
Binning 없음 (Divergent):
Material A: 40% pixels, 10ms shader
Material B: 30% pixels,  5ms shader
Material C: 30% pixels,  8ms shader
→ Total: 10ms (worst case serialization)

Binning 적용 (Coherent):
Pass A: 40% pixels × 10ms = 4.0ms
Pass B: 30% pixels ×  5ms = 1.5ms
Pass C: 30% pixels ×  8ms = 2.4ms
→ Total: 7.9ms (21% 절감)
```

---

## 💡 최적화 팁

### ✅ 효율적인 머티리얼 사용

```cpp
// ✅ 좋은 예: 적은 머티리얼 종류
Mesh: 3개 머티리얼 (Base, Trim, Detail)
→ 3 Passes, 높은 Thread 일관성

// ❌ 나쁜 예: 과도한 머티리얼
Mesh: 50개 머티리얼 (각 삼각형마다 다름)
→ 50 Passes, 낮은 Thread 일관성, 높은 오버헤드
```

### 디버그 시각화

```cpp
// 머티리얼 복잡도 시각화
r.Nanite.Visualize 10  // Material 복잡도
r.Nanite.ShowStats 1   // Material별 통계
```

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Rasterization.md](./Rasterization.md) - Visibility Buffer 생성
- [Compression.md](./Compression.md) - 버텍스 데이터 압축

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
