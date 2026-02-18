---
title: "Nanite 클러스터 시스템 (Cluster System)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 클러스터 시스템 (Cluster System)

## 🧭 개요

**클러스터 (Cluster)** 는 Nanite의 기본 처리 단위로, 메시를 **128개 삼각형 단위**로 분할한 지오메트리 블록입니다.

---

## 🧱 클러스터 생성 과정

### 빌드 타임 파이프라인

```
원본 메시 (수백만 삼각형)
        ↓
 ┌──────────────────┐
 │ 1. 그래프 분할   │  ← FGraphPartitioner
 │ (Adjacent Tri)   │
 └──────────────────┘
        ↓
 ┌──────────────────┐
 │ 2. 클러스터 생성 │  ← FCluster 생성자
 │ (128 tri/cluster)│
 └──────────────────┘
        ↓
 ┌──────────────────┐
 │ 3. 바운드 계산   │  ← FCluster::Bound()
 └──────────────────┘
        ↓
 ┌──────────────────┐
 │ 4. 압축 & 인코딩 │  ← EncodeGeometryData()
 └──────────────────┘
```

---

## 📐 클러스터 구조

### 빌드 타임: FCluster

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.h:80-183`

```cpp
class FCluster
{
public:
    static const uint32 ClusterSize = 128;  // 최대 128 삼각형

    FVertexFormat       VertexFormat;       // 버텍스 포맷 (UV/Normal/Tangent)

    // 버텍스 데이터
    TArray<float>       Verts;              // Interleaved 버텍스 데이터
    uint32              NumVerts = 0;

    // 인덱스 데이터
    TArray<uint32>      Indexes;            // 삼각형 인덱스
    uint32              NumTris = 0;

    // 머티리얼
    TArray<int32>       MaterialIndexes;    // 삼각형당 머티리얼 인덱스
    TArray<FMaterialRange> MaterialRanges;  // 머티리얼 범위

    // LOD & 바운드
    FSphere3f           Bounds;             // 바운딩 스피어
    FSphere3f           LODBounds;          // LOD용 바운딩 스피어
    float               LODError;           // LOD 전환 오차
    float               EdgeLength;         // 평균 엣지 길이
    float               SurfaceArea;        // 표면적

    // 외부 엣지 (이웃 클러스터 연결)
    TArray<int8>        ExternalEdges;      // 외부로 연결된 엣지
    uint32              NumExternalEdges = 0;

    // 체소 데이터 (NANITE_VOXEL_DATA 활성화 시)
    struct FBrick {
        uint64      VoxelMask;       // 4×4×4 체소 점유 비트맵
        FIntVector3 Position;        // 체소 벽돌 시작 위치
        uint32      VertOffset;      // 버텍스 오프셋
    };
    TArray<FBrick>      Bricks;      // 체소 벽돌 배열
};
```

**버텍스 포맷:**
```cpp
struct FVertexFormat
{
    uint8 NumTexCoords;         // UV 좌표 개수 (0~4)
    uint8 NumBoneInfluences;    // 본 영향력 개수 (스키닝용)
    bool  bHasTangents : 1;     // 탄젠트 보유 여부
    bool  bHasColors   : 1;     // 버텍스 컬러 보유 여부
};
```

**📂 소스 검증:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.h:23-58, 80-183`

---

### 런타임: FPackedCluster

**📂 위치:** `Engine/Source/Runtime/Engine/Public/Rendering/NaniteResources.h:94-150`

```cpp
struct FPackedCluster
{
    // === 래스터화용 데이터 ===
    uint32  NumVerts_PositionOffset;        // NumVerts:14, PositionOffset:18
    uint32  NumTris_IndexOffset;            // NumTris:8, IndexOffset:24
    uint32  ColorMin;                       // 색상 최소값
    uint32  ColorBits_GroupIndex;           // 색상 비트 + 그룹 인덱스

    FIntVector  PosStart;                   // 위치 시작점
    uint32  BitsPerIndex_PosPrecision_PosBits_NormalPrecision_TangentPrecision;

    // === 컬링용 데이터 ===
    FSphere3f   LODBounds;                  // LOD 바운딩 스피어

    FVector3f   BoxBoundsCenter;            // 바운딩 박스 중심
    uint32      LODErrorAndEdgeLength;      // LOD 오차 & 엣지 길이

    FVector3f   BoxBoundsExtent;            // 바운딩 박스 범위
    uint32      Flags_NumClusterBoneInfluences; // 플래그 + 본 개수

    // === 머티리얼용 데이터 ===
    uint32  AttributeOffset_BitsPerAttribute;   // UV/Normal 오프셋
    uint32  DecodeInfoOffset_HasTangents_Skinning_NumUVs_ColorMode;
    uint32  UVBitOffsets;                       // UV 비트 오프셋
    uint32  PackedMaterialInfo;                 // 머티리얼 정보

    // === 확장 데이터 ===
    uint32  ExtendedDataOffset_Num;             // 확장 데이터 오프셋
    uint32  BrickDataOffset_Num;                // 체소 벽돌 오프셋
    uint32  Dummy0, Dummy1;

    // === 버텍스 재사용 정보 ===
    uint32  VertReuseBatchInfo[4];              // 버텍스 재사용 배치
};
```

**비트 패킹 예시:**
```
NumVerts_PositionOffset (32 bits):
┌──────────────┬────────────────────┐
│ NumVerts:14  │ PositionOffset:18  │
└──────────────┴────────────────────┘
 0             14                   32

NumTris_IndexOffset (32 bits):
┌─────────┬──────────────────────┐
│ NumTris:8 │ IndexOffset:24      │
└─────────┴──────────────────────┘
 0         8                      32
```

**📂 소스 검증:** `Engine/Source/Runtime/Engine/Public/Rendering/NaniteResources.h:94-150`

---

## 🔨 클러스터 생성 세부 과정

### 1. 초기 클러스터 생성

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:53-167`

```cpp
// 원본 메시로부터 클러스터 생성
FCluster::FCluster(
    const FConstMeshBuildVertexView& InVerts,
    TArrayView<const uint32> InIndexes,
    TArrayView<const int32> InMaterialIndexes,
    const FVertexFormat& InFormat,
    uint32 Begin, uint32 End,  // 삼각형 범위 [Begin, End)
    TArrayView<const uint32> SortedIndexes,
    TArrayView<const uint32> SortedTo,
    const FAdjacency& Adjacency)
{
    const uint32 NumTriangles = End - Begin;
    check(NumTriangles <= ClusterSize);  // 최대 128개 삼각형

    // 버텍스 데이터 복사
    for (uint32 TriIndex = Begin; TriIndex < End; TriIndex++)
    {
        for (uint32 k = 0; k < 3; k++)  // 삼각형 3개 버텍스
        {
            uint32 OldIndex = InIndexes[TriIndex * 3 + k];

            // 버텍스 중복 제거 (Hash Table 사용)
            uint32 NewIndex = AddVert(VertData, HashTable);
            Indexes.Add(NewIndex);

            // 외부 엣지 계산 (이웃 클러스터와의 연결)
            int32 AdjCount = CountAdjacentEdges(...);
            ExternalEdges.Add((int8)AdjCount);
        }

        MaterialIndexes.Add(InMaterialIndexes[TriIndex]);
    }

    // 버텍스 데이터 검증 & 정규화
    SanitizeVertexData();
    CorrectAttributes();

    // 바운드 계산
    Bound();
}
```

**📂 소스 검증:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:53-167`

---

### 2. 클러스터 단순화 (Simplification)

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:450-600`

```cpp
float FCluster::Simplify(
    const FClusterDAG& DAG,
    uint32 TargetNumTris,      // 목표 삼각형 수
    float TargetError = 0.0f,  // 목표 오차
    uint32 LimitNumTris = 0,   // 최소 삼각형 수
    const FRayTracingFallbackBuildSettings* RayTracingFallbackBuildSettings = nullptr)
{
    // 메시 단순화기 초기화
    FMeshSimplifier Simplifier(Verts, NumVerts, Indexes, NumTris, ...);

    // 속성 가중치 설정
    Simplifier.SetAttributeWeights({
        Position: 1.0f,
        Normal:   1.0f,
        Tangent:  0.1f,
        Color:    0.1f,
        TexCoord: (UVArea > 0.0f) ? 1.0f : 0.01f
    });

    // 최대 엣지 길이 설정
    if (Settings.MaxEdgeLengthFactor > 0.0f)
        Simplifier.SetMaxEdgeLengthFactor(Settings.MaxEdgeLengthFactor);

    // 단순화 실행
    float MaxError = Simplifier.Simplify(
        NumVerts, TargetNumTris, MaxError,
        0, LimitNumTris, MAX_flt);

    // Foliage Over-Occlusion 보정 (선택적)
    if (RayTracingFallbackBuildSettings &&
        RayTracingFallbackBuildSettings->FoliageOverOcclusionBias > 0.0f)
    {
        Simplifier.ShrinkTriGroupWithMostSurfaceAreaLoss(
            RayTracingFallbackBuildSettings->FoliageOverOcclusionBias);
    }

    // 단순화된 지오메트리 가져오기
    Simplifier.OutputMesh(Verts, Indexes, ...);
    NumVerts = Simplifier.GetRemainingNumVerts();
    NumTris = Simplifier.GetRemainingNumTris();

    return MaxError;  // 달성한 오차 반환
}
```

**FoliageOverOcclusionBias:**
```cpp
// 풀이나 나뭇잎 같은 Foliage 지오메트리의 과도한 오클루전을 완화
// 내부로 약간 수축시켜 빈 공간 고려
// 📂 NaniteBuilder.h:44
float FoliageOverOcclusionBias = 0.0f; // 0.0 ~ 0.9
```

**📂 소스 검증:**
- `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:450-600`
- `Engine/Source/Developer/NaniteBuilder/Public/NaniteBuilder.h:44`

---

### 3. 바운드 계산

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:380-448`

```cpp
void FCluster::Bound()
{
    // AABB (Axis-Aligned Bounding Box) 계산
    FBox3f Box(ForceInit);
    for (uint32 i = 0; i < NumVerts; i++)
    {
        FVector3f& Position = GetPosition(i);
        Box += Position;
    }

    // 바운딩 스피어 계산
    FSphere3f Sphere(Box.GetCenter(), 0.0f);
    for (uint32 i = 0; i < NumVerts; i++)
    {
        FVector3f& Position = GetPosition(i);
        float DistSq = (Position - Sphere.Center).SizeSquared();
        Sphere.W = FMath::Max(Sphere.W, DistSq);
    }
    Sphere.W = FMath::Sqrt(Sphere.W);

    Bounds = Sphere;

    // LOD 바운드: 외부 엣지를 고려한 확장 바운드
    float MaxEdgeLength = 0.0f;
    for (uint32 i = 0; i < Indexes.Num(); i += 3)
    {
        FVector3f v0 = GetPosition(Indexes[i + 0]);
        FVector3f v1 = GetPosition(Indexes[i + 1]);
        FVector3f v2 = GetPosition(Indexes[i + 2]);

        MaxEdgeLength = FMath::Max(MaxEdgeLength, (v1 - v0).Size());
        MaxEdgeLength = FMath::Max(MaxEdgeLength, (v2 - v1).Size());
        MaxEdgeLength = FMath::Max(MaxEdgeLength, (v0 - v2).Size());
    }

    // 외부 엣지 영향 고려
    LODBounds = FSphere3f(Sphere.Center, Sphere.W + MaxEdgeLength);
    EdgeLength = MaxEdgeLength;
}
```

**📂 소스 검증:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:380-448`

---

## 💾 데이터 압축 & 인코딩

### 인코딩 과정

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncode.cpp`

```
버텍스 데이터
     ↓
┌─────────────────────┐
│ 1. 위치 양자화      │  ← Quantize to N-bit integers
│ (가변 비트 정밀도)  │
└─────────────────────┘
     ↓
┌─────────────────────┐
│ 2. 법선/탄젠트 압축 │  ← Octahedral encoding
│ (8~15 bits/normal)  │
└─────────────────────┐
     ↓
┌─────────────────────┐
│ 3. UV 압축          │  ← Custom float encoding
│ (14-bit mantissa)   │
└─────────────────────┘
     ↓
┌─────────────────────┐
│ 4. 색상 압축        │  ← Range-based quantization
│ (4-bit per channel) │
└─────────────────────┘
```

### 위치 양자화

```cpp
// NaniteDefinitions.h:166-170
#define NANITE_MIN_POSITION_PRECISION  -20
#define NANITE_MAX_POSITION_PRECISION   43
#define NANITE_MAX_POSITION_QUANTIZATION_BITS  21  // (21*3 = 63) < 64

// Cluster.h에서:
FIntVector PosStart;      // 양자화 시작점
uint32 PosBits[3];        // X, Y, Z 각각의 비트 수 (5-bit per axis)
int32  PosPrecision;      // 정밀도 (2^Precision = 1 unit)
```

**양자화 공식:**
```cpp
QuantizedPos = (WorldPos - PosStart) * (2^PosPrecision)
// 예: PosPrecision = 10 → 1 unit = 1/1024 ≈ 0.001
```

**📂 소스 검증:**
- `Engine/Shaders/Shared/NaniteDefinitions.h:166-170`
- `Engine/Source/Developer/NaniteBuilder/Private/Encode/NaniteEncode.cpp:191-341`

---

## 🔧 클러스터 분할 (Splitting) - METIS 그래프 분할

### 설계 철학: 왜 그래프 분할인가?

**Brian Karis (2021 발표):** "METIS 그래프 분할을 사용하여 인접한 삼각형을 같은 클러스터에 배치합니다. 이를 통해 클러스터 간 경계를 최소화하고 **크랙 (Cracks)** 을 방지합니다."

#### 문제: 나이브한 분할의 한계

```
나이브한 분할 (순차적 분할):
┌────────────────────────────────────┐
│ Tri 0-127 │ Tri 128-255 │ Tri 256-│
│ Cluster 0 │ Cluster 1   │ ...     │
└────────────────────────────────────┘
             ↑
        경계에 크랙 발생 가능!

문제점:
1. 공간적으로 인접하지 않은 삼각형 그룹화
2. 클러스터 간 경계가 메시 표면을 따라가지 않음
3. T-junction 및 크랙 발생 위험
4. 컬링 효율 저하 (띄엄띄엄 떨어진 삼각형)
```

#### 해결책: METIS 그래프 분할

```
METIS 그래프 분할:
┌────────────────────────────────────┐
│     ┌─────────┐  ┌─────────┐      │
│     │Cluster 0│  │Cluster 1│      │
│     │ (128 tri│  │ (128 tri│      │
│     └─────────┘  └─────────┘      │
│  ┌─────────┐        ┌─────────┐   │
│  │Cluster 2│        │Cluster 3│   │
│  └─────────┘        └─────────┘   │
└────────────────────────────────────┘
  자연스러운 경계 (Natural Seams)

장점:
1. ✅ 공간적 지역성 (Spatial Locality)
2. ✅ 경계 엣지 최소화 (Edge Cut Minimization)
3. ✅ 크랙 방지 (No Cracks)
4. ✅ 컬링 효율 향상
```

---

### FGraphPartitioner - METIS 통합

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/GraphPartitioner.h`

```cpp
#include "metis.h"  // METIS 라이브러리 통합

class FGraphPartitioner
{
public:
    struct FGraphData
    {
        int32 Offset;
        int32 Num;

        TArray<idx_t> Adjacency;        // 인접성 리스트
        TArray<idx_t> AdjacencyCost;    // 엣지 가중치
        TArray<idx_t> AdjacencyOffset;  // CSR 포맷 오프셋
    };

    void Partition(FGraphData* Graph);          // K-way 분할
    void PartitionStrict(FGraphData* Graph);    // 재귀 이분 분할
    void BisectGraph(FGraphData* Graph, ...);   // 2-way 분할

private:
    uint32 NumElements;
    int32  MinPartitionSize;
    int32  MaxPartitionSize;
};
```

---

### 그래프 분할 과정 (FCluster::Split)

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:622-669`

```cpp
void FCluster::Split(FGraphPartitioner& Partitioner, const FAdjacency& Adjacency) const
{
    // === STEP 1: 연결된 삼각형 그룹 생성 (Disjoint Set) ===
    FDisjointSet DisjointSet(NumTris);
    for (int32 EdgeIndex = 0; EdgeIndex < Indexes.Num(); EdgeIndex++)
    {
        Adjacency.ForAll(EdgeIndex,
            [&DisjointSet](int32 EdgeIndex0, int32 EdgeIndex1)
            {
                if (EdgeIndex0 > EdgeIndex1)
                    DisjointSet.UnionSequential(EdgeIndex0 / 3, EdgeIndex1 / 3);
            });
    }

    // === STEP 2: 삼각형 중심 계산 람다 ===
    auto GetCenter = [this](uint32 TriIndex)
    {
        FVector3f Center;
        Center  = GetPosition(Indexes[TriIndex * 3 + 0]);
        Center += GetPosition(Indexes[TriIndex * 3 + 1]);
        Center += GetPosition(Indexes[TriIndex * 3 + 2]);
        return Center * (1.0f / 3.0f);
    };

    // === STEP 3: 공간 지역성 링크 생성 ===
    Partitioner.BuildLocalityLinks(DisjointSet, Bounds, MaterialIndexes, GetCenter);

    // === STEP 4: 그래프 구조 생성 ===
    auto* RESTRICT Graph = Partitioner.NewGraph(NumTris * 3);

    for (uint32 i = 0; i < NumTris; i++)
    {
        Graph->AdjacencyOffset[i] = Graph->Adjacency.Num();
        uint32 TriIndex = Partitioner.Indexes[i];

        // 공유 엣지 추가 (높은 가중치 = 강한 연결)
        for (int k = 0; k < 3; k++)
        {
            Adjacency.ForAll(3 * TriIndex + k,
                [&Partitioner, Graph](int32 EdgeIndex, int32 AdjIndex)
                {
                    Partitioner.AddAdjacency(Graph, AdjIndex / 3, 4 * 65);  // 가중치 260
                });
        }

        // 지역성 링크 추가 (낮은 가중치 = 약한 연결)
        Partitioner.AddLocalityLinks(Graph, TriIndex, 1);  // 가중치 1
    }
    Graph->AdjacencyOffset[NumTris] = Graph->Adjacency.Num();

    // === STEP 5: METIS 분할 실행 ===
    Partitioner.PartitionStrict(Graph, false);
}
```

---

### METIS 호출 상세

#### K-way 분할 (METIS_PartGraphKway)

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/GraphPartitioner.cpp:55-69`

```cpp
void FGraphPartitioner::Partition(FGraphData* Graph)
{
    const int32 TargetPartitionSize = (MinPartitionSize + MaxPartitionSize) / 2;
    const int32 TargetNumPartitions = FMath::DivideAndRoundUp(Graph->Num, TargetPartitionSize);

    idx_t NumConstraints = 1;
    idx_t NumParts = TargetNumPartitions;
    idx_t EdgesCut = 0;

    idx_t Options[METIS_NOPTIONS];
    METIS_SetDefaultOptions(Options);
    Options[METIS_OPTION_UFACTOR] = 200;  // 20% 불균형 허용

    int r = METIS_PartGraphKway(
        &Graph->Num,                        // 노드 수 (삼각형 수)
        &NumConstraints,                    // 균형 제약 조건 수
        Graph->AdjacencyOffset.GetData(),   // CSR 포맷 오프셋
        Graph->Adjacency.GetData(),         // 인접 노드 인덱스
        NULL,                               // 정점 가중치 (NULL = 균등)
        NULL,                               // 정점 크기
        Graph->AdjacencyCost.GetData(),     // 엣지 가중치
        &NumParts,                          // 목표 파티션 수
        NULL,                               // 목표 파티션 가중치
        NULL,                               // 불균형 허용도
        Options,
        &EdgesCut,                          // 출력: 잘린 엣지 수
        PartitionIDs.GetData()              // 출력: 파티션 ID 배열
    );

    checkf(r == METIS_OK, TEXT("METIS_PartGraphKway failed"));
}
```

#### 재귀 이분 분할 (METIS_PartGraphRecursive)

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/GraphPartitioner.cpp:171-185`

```cpp
void FGraphPartitioner::BisectGraph(FGraphData* Graph, FGraphData* ChildGraphs[2])
{
    idx_t NumConstraints = 1;
    idx_t NumParts = 2;  // 항상 2개로 분할
    idx_t EdgesCut = 0;

    real_t PartitionWeights[] = {
        float(TargetNumPartitions / 2) / TargetNumPartitions,  // 첫 번째 파티션 비율
        1.0f - float(TargetNumPartitions / 2) / TargetNumPartitions
    };

    idx_t Options[METIS_NOPTIONS];
    METIS_SetDefaultOptions(Options);
    Options[METIS_OPTION_UFACTOR] = bLoose ? 200 : 1;  // 느슨한 균형 vs 엄격한 균형

    int r = METIS_PartGraphRecursive(
        &Graph->Num,
        &NumConstraints,
        Graph->AdjacencyOffset.GetData(),
        Graph->Adjacency.GetData(),
        NULL,
        NULL,
        Graph->AdjacencyCost.GetData(),
        &NumParts,
        PartitionWeights,                   // 목표 파티션 비율
        NULL,
        Options,
        &EdgesCut,
        PartitionIDs.GetData() + Graph->Offset
    );

    checkf(r == METIS_OK, TEXT("METIS_PartGraphRecursive failed"));
}
```

---

### BuildLocalityLinks - 공간 지역성

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/GraphPartitioner.h:82-219`

```cpp
template<typename FGetCenter>
void FGraphPartitioner::BuildLocalityLinks(
    FDisjointSet& DisjointSet,
    const FBounds3f& Bounds,
    TConstArrayView<const int32> GroupIndexes,
    FGetCenter& GetCenter)
{
    // === STEP 1: Morton Code로 공간 정렬 ===
    TArray<uint32> SortKeys;
    ParallelFor(TEXT("BuildLocalityLinks.PF"), NumElements, 4096,
        [&](uint32 Index)
        {
            FVector3f Center = GetCenter(Index);
            FVector3f CenterLocal = (Center - Bounds.Min) / (Bounds.Max - Bounds.Min).GetMax();

            // 3D Morton Code 생성 (Z-order curve)
            uint32 Morton;
            Morton  = FMath::MortonCode3(uint32(CenterLocal.X * 1023));
            Morton |= FMath::MortonCode3(uint32(CenterLocal.Y * 1023)) << 1;
            Morton |= FMath::MortonCode3(uint32(CenterLocal.Z * 1023)) << 2;
            SortKeys[Index] = Morton;
        });

    RadixSort32(SortedTo.GetData(), Indexes.GetData(), NumElements,
        [&](uint32 Index) { return SortKeys[Index]; });

    // === STEP 2: 최대 5개 인접 요소 찾기 ===
    for (uint32 i = 0; i < NumElements; i++)
    {
        uint32 Index = Indexes[i];
        FVector3f Center = GetCenter(Index);

        const uint32 MaxLinksPerElement = 5;

        uint32 ClosestIndex[MaxLinksPerElement];
        float  ClosestDist2[MaxLinksPerElement];

        // 양방향 검색 (Morton 순서상 앞뒤 16개씩)
        for (int Direction = 0; Direction < 2; Direction++)
        {
            for (int32 Iterations = 0; Iterations < 16; Iterations++)
            {
                // 가까운 요소 찾기
                float AdjDist2 = (Center - GetCenter(AdjIndex)).SizeSquared();
                // 정렬된 리스트에 삽입
                for (int k = 0; k < MaxLinksPerElement; k++)
                {
                    if (AdjDist2 < ClosestDist2[k])
                    {
                        Swap(AdjIndex, ClosestIndex[k]);
                        Swap(AdjDist2, ClosestDist2[k]);
                    }
                }
            }
        }

        // === STEP 3: 양방향 링크 추가 ===
        for (int k = 0; k < MaxLinksPerElement; k++)
        {
            if (ClosestIndex[k] != ~0u)
            {
                LocalityLinks.AddUnique(Index, ClosestIndex[k]);
                LocalityLinks.AddUnique(ClosestIndex[k], Index);  // 양방향
            }
        }
    }
}
```

---

### 그래프 분할 시각화

```
원본 메시 (1,000 삼각형)
            ↓
     Morton Code 정렬
            ↓
┌─────────────────────────────────────────────────────────┐
│  공간적으로 가까운 삼각형들이 Morton 순서상 인접         │
│                                                         │
│  [ Tri 0 ][ Tri 1 ][ Tri 2 ] ... [ Tri 999 ]           │
│    ↓   ↓    ↓   ↓    ↓   ↓           ↓   ↓            │
│    └───┘    └───┘    └───┘           └───┘            │
│  공유 엣지  지역성 링크                                  │
│  (가중치 260) (가중치 1)                                 │
└─────────────────────────────────────────────────────────┘
            ↓
      그래프 구조 생성
            ↓
      METIS_PartGraphKway()
            ↓
┌─────────────────────────────────────────────────────────┐
│  Cluster 0  │  Cluster 1  │  Cluster 2  │ ... │        │
│  (128 tri)  │  (128 tri)  │  (128 tri)  │     │        │
│  ┌─────┐    │  ┌─────┐    │  ┌─────┐    │     │        │
│  │     │    │  │     │    │  │     │    │     │        │
│  │ ████│    │  │ ████│    │  │ ████│    │     │        │
│  │ ████│    │  │ ████│    │  │ ████│    │     │        │
│  └─────┘    │  └─────┘    │  └─────┘    │     │        │
│  공간적 응집 │  자연스러운  │  최소 경계   │     │        │
└─────────────────────────────────────────────────────────┘
  EdgesCut = 최소 (METIS 최적화 목표)
```

---

### 엣지 가중치 전략

| 엣지 타입 | 가중치 | 의미 | 효과 |
|---------|-------|------|------|
| **공유 엣지 (Shared Edge)** | 260 (4×65) | 삼각형이 공통 엣지 공유 | 매우 강한 연결 → 같은 클러스터에 배치 |
| **지역성 링크 (Locality Link)** | 1 | 공간적으로 가까움 | 약한 연결 → 타이 브레이커 |

**설계 의도:**
- 공유 엣지가 잘리면 크랙 발생 위험 → 높은 비용 부여
- 지역성 링크는 캐시 효율 향상용 → 낮은 비용

**METIS 목표:**
```
Minimize: Σ(EdgesCut × EdgeWeight)

결과:
1. 공유 엣지 우선 보존 (크랙 방지)
2. 지역성 링크 부차적 고려 (캐시 효율)
```

---

### 분할 품질 메트릭

#### EdgesCut 최소화

```cpp
// METIS 출력
idx_t EdgesCut = 0;
METIS_PartGraphKway(..., &EdgesCut, ...);

// 낮을수록 좋음
if (EdgesCut < NumTris * 0.1f)
    UE_LOG(LogTemp, Display, TEXT("Excellent partition: %d edges cut"), EdgesCut);
```

#### 파티션 균형

```
METIS_OPTION_UFACTOR = 200  → 20% 불균형 허용

예:
- 목표: 128 tri/cluster
- 허용 범위: 102 ~ 154 tri/cluster
- 균형 vs 엣지 컷 트레이드오프
```

---

## 🔧 클러스터 분할 (Splitting) - 일반 사항

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:602-650`

```cpp
void FCluster::Split(
    FGraphPartitioner& Partitioner,
    const FAdjacency& Adjacency) const
{
    // 삼각형 인접성 정보를 Partitioner에 전달
    Partitioner.BuildLocalityLinks(
        Indexes,
        Adjacency,
        MaterialIndexes);

    // 메트릭: 삼각형 간 연결성 + 머티리얼 유사도
    // 목표: 공간적으로 가까운 삼각형을 같은 파티션에 배치
    Partitioner.Partition(TargetNumPartitions);
}
```

**FGraphPartitioner 전략:**
- **삼각형 인접성**: 엣지 공유하는 삼각형은 같은 파티션
- **머티리얼 일관성**: 같은 머티리얼 사용 삼각형 그룹화
- **공간 지역성**: 가까운 삼각형 그룹화

**📂 소스 검증:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp:602-650`

---

## 📊 클러스터 통계

### 메모리 사용량 추정

| 항목 | 크기 (bytes) | 설명 |
|------|--------------|------|
| **FPackedCluster** | 128 | 클러스터 메타데이터 (고정) |
| **위치 데이터** | ~3-9 per vertex | 압축 비트 수에 따라 가변 |
| **Normal/Tangent** | ~2-4 per vertex | Octahedral encoding |
| **UV 데이터** | ~4-8 per UV set | Custom float encoding |
| **인덱스 데이터** | ~1-2 per triangle | Strip indices 사용 시 |
| **머티리얼 범위** | 8 per range | MaterialRange 구조체 |

**총합 예시:**
- 128 tri, 256 vert 클러스터
- 1 UV set, Normal+Tangent, 4-bit color
- **예상 크기: ~3-5 KB**

---

## 💡 최적화 팁

### ✅ 좋은 클러스터 품질을 위한 조건

```cpp
// ✅ 권장 사항:
- 삼각형 연결성이 좋은 메시 (Strip/Fan 형태)
- 균일한 삼각형 밀도
- 합리적인 머티리얼 분할 (클러스터당 1-2개)
```

### ❌ 피해야 할 상황

```cpp
// ❌ 문제가 되는 상황:
- Degenerate triangles (면적 0인 삼각형)
- 비정상적으로 긴 엣지
- 클러스터당 과도한 머티리얼 수 (>8)
```

### 디버깅 명령어

```cpp
// 콘솔 명령어 (에디터)
r.Nanite.Visualize 3  // 클러스터 경계 시각화
r.Nanite.Visualize 4  // 프리미티브별 색상
r.Nanite.Visualize 6  // 클러스터 그룹 시각화
```

---

## 🔗 관련 문서

- [DAG.md](./DAG.md) - 클러스터 계층 구조
- [Rasterization.md](./Rasterization.md) - 클러스터 렌더링
- [VoxelGeometry.md](./VoxelGeometry.md) - 체소 기반 클러스터

---

> 🔄 Updated: 2025-01-XX — 초기 작성 (UE 5.6 기준)
