---
title: "Nanite DAG 시스템 (Directed Acyclic Graph - 계층 구조 및 LOD)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite DAG 시스템 (Directed Acyclic Graph - 계층 구조 및 LOD)

## 🧭 개요

**DAG (Directed Acyclic Graph, 유향 비순환 그래프)** 는 Nanite의 **자동 LOD 시스템의 핵심**입니다.

### 핵심 개념

**"계층적 클러스터 그룹으로 수백만 폴리곤을 효율적으로 관리"**

- 리프 클러스터 (128 tri) → 그룹 (8-32 클러스터) → 부모 클러스터 → 루트
- 화면 크기에 따라 동적 LOD 선택 (FindCut 알고리즘)
- 비순환 구조로 메모리 공유 (같은 자식을 여러 부모가 참조 가능)
- LOD Error 기반 전환 (시각적 품질 보장)

---

## 🎯 설계 철학

### 왜 DAG인가?

**Brian Karis (2021 발표):** "전통적 LOD 시스템은 **수작업**과 **메모리 중복**이 문제입니다. DAG는 이 두 가지를 동시에 해결합니다."

#### 전통적 LOD vs Nanite DAG

| 특성 | 전통적 LOD 체인 | Nanite DAG |
|------|----------------|------------|
| **제작 방식** | 수작업 (3D 아티스트가 직접) | **자동 생성** (빌드 타임) |
| **메모리** | 각 LOD 독립 저장 (중복) | **공유 가능** (부모가 자식 참조) |
| **전환** | 불연속 (팝핑 발생) | **점진적** (LOD Error 기반) |
| **구조** | 선형 체인 (LOD0→LOD1→LOD2) | **DAG** (다중 부모 가능) |
| **유지보수** | 원본 수정 시 모든 LOD 재작업 | **자동 재생성** |

**DAG의 핵심 장점:**

```
전통적 LOD 체인:
┌────────────────────────────────────────────────────────┐
│  LOD0 (100만 tri)  ─┐                                  │
│  LOD1 (50만 tri)    ├─ 각각 독립 저장                  │
│  LOD2 (25만 tri)    │   (메모리 1.85배)                │
│  LOD3 (10만 tri)   ─┘                                  │
│                                                        │
│  전환: LOD1→LOD2 (불연속, 팝핑 발생)                    │
└────────────────────────────────────────────────────────┘

Nanite DAG:
┌────────────────────────────────────────────────────────┐
│                    Root Group                          │
│           (1 cluster, MaxParentLODError=1e10)          │
│                         │                              │
│         ┌───────────────┴───────────────┐              │
│         │                               │              │
│    Group 1 (16 clusters)           Group 2 (16 clusters)│
│         │                               │              │
│    ┌────┴────┐                     ┌────┴────┐        │
│  Cluster  Cluster  ...          Cluster  Cluster ...   │
│  (128 tri) (128 tri)            (128 tri) (128 tri)    │
│                                                        │
│  메모리: 원본 + 부모 클러스터만 (~1.2배)                │
│  전환: 점진적 (LOD Error 기반, 부드러움)                 │
└────────────────────────────────────────────────────────┘
```

**비순환 (Acyclic) 중요성:**

```
유향 비순환 그래프 (DAG):
          Parent A
         ↙        ↘
    Child 1    Child 2  ← 순환 없음 (Parent A → Child 1 → Parent A 불가능)
         ↘        ↙
          Parent B

장점:
1. 단순한 순회 (재귀 없이 레벨별 처리)
2. 무한 루프 방지
3. 캐시 친화적 메모리 레이아웃
```

---

## 🧱 FClusterGroup 구조

### 클러스터 그룹 정의

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.h:20-34`

```cpp
struct FClusterGroup
{
    FSphere3f   Bounds;              // 그룹의 바운딩 스피어
    FSphere3f   LODBounds;           // LOD 결정용 바운딩 스피어
    float       MinLODError = 0.0f;  // 이 그룹의 최소 LOD 오차
    float       MaxParentLODError = 0.0f;  // 부모 그룹의 최대 LOD 오차
    int32       MipLevel = 0;        // 계층 레벨 (0=리프)
    uint32      MeshIndex = MAX_uint32;
    uint32      AssemblyPartIndex = MAX_uint32;
    bool        bTrimmed = false;

    uint32              PageIndexStart = MAX_uint32;  // 스트리밍 페이지 시작 인덱스
    uint32              PageIndexNum = 0;             // 페이지 개수
    TArray<uint32>      Children;    // 자식 클러스터들 (최대 128개)
};
```

### LOD Error 필드 설명

```
FClusterGroup 구조:
┌─────────────────────────────────────────────────────────────┐
│  MinLODError = 0.5          ← 이 그룹 자식들의 최소 오차    │
│  MaxParentLODError = 2.0    ← 부모 그룹의 최대 오차         │
│                                                             │
│  의미:                                                       │
│  - LOD Error < 0.5: 이 그룹의 자식들을 렌더링              │
│  - LOD Error ∈ [0.5, 2.0]: 이 그룹 자체를 렌더링           │
│  - LOD Error > 2.0: 부모 그룹으로 전환                      │
└─────────────────────────────────────────────────────────────┘

LOD Error 계산:
LODError = (ProjectedError / ScreenSize) * MaxParentLODError

예시:
- 화면 크기 1080p
- 클러스터 바운딩 스피어 반지름 100 units
- 카메라 거리 10000 units
→ LODError ≈ (100 / 10000) * 1080 = 10.8

10.8 > 2.0 → 부모 그룹 선택 (더 낮은 LOD)
```

---

## 🔨 DAG 빌드 프로세스

### 전체 파이프라인

```
원본 메시 (100만 삼각형)
        ↓
┌────────────────────────────────────┐
│ 1. AddMesh - 초기 클러스터 생성     │
│    - METIS 그래프 분할              │
│    - 리프 클러스터 생성 (128 tri)   │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ 2. ReduceMesh - 계층 생성 루프      │
│    - 외부 엣지 찾기                 │
│    - 그룹화 (METIS 재사용)          │
│    - ReduceGroup 호출               │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ 3. ReduceGroup - 부모 클러스터 생성 │
│    - 단순화 or 체소화               │
│    - METIS 분할                     │
│    - LOD Error 계산                 │
└────────────────────────────────────┘
        ↓
    DAG 완성
```

---

### 1. AddMesh - 초기 클러스터 생성

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp:12-200`

```cpp
void FClusterDAG::AddMesh(
    const FConstMeshBuildVertexView& Verts,
    TArrayView< const uint32 > Indexes,
    TArrayView< const int32 > MaterialIndexes,
    const FBounds3f& VertexBounds,
    const FVertexFormat& VertexFormat )
{
    // === STEP 1: 인접성 계산 (Edge Hash) ===
    FAdjacency Adjacency( Indexes.Num() );
    FEdgeHash EdgeHash( Indexes.Num() );

    ParallelFor( Indexes.Num(), 4096,
        [&]( int32 EdgeIndex )
        {
            EdgeHash.Add_Concurrent( EdgeIndex, GetPosition );
        } );

    // === STEP 2: Disjoint Set으로 연결된 삼각형 그룹화 ===
    FDisjointSet DisjointSet( NumTriangles );
    for( uint32 EdgeIndex = 0; EdgeIndex < Indexes.Num(); EdgeIndex++ )
    {
        Adjacency.ForAll( EdgeIndex,
            [&]( int32 EdgeIndex0, int32 EdgeIndex1 )
            {
                if( EdgeIndex0 > EdgeIndex1 )
                    DisjointSet.UnionSequential( EdgeIndex0 / 3, EdgeIndex1 / 3 );
            } );
    }

    // === STEP 3: METIS 그래프 분할 ===
    FGraphPartitioner Partitioner( NumTriangles, FCluster::ClusterSize - 4, FCluster::ClusterSize );

    Partitioner.BuildLocalityLinks( DisjointSet, VertexBounds, MaterialIndexes, GetCenter );

    auto* Graph = Partitioner.NewGraph( NumTriangles * 3 );

    for( uint32 i = 0; i < NumTriangles; i++ )
    {
        // 공유 엣지 추가 (가중치 260)
        Adjacency.ForAll( 3 * TriIndex + k,
            [ &Partitioner, Graph ]( int32 EdgeIndex, int32 AdjIndex )
            {
                Partitioner.AddAdjacency( Graph, AdjIndex / 3, 4 * 65 );  // 260
            } );

        // 지역성 링크 추가 (가중치 1)
        Partitioner.AddLocalityLinks( Graph, TriIndex, 1 );
    }

    Partitioner.PartitionStrict( Graph, !bSingleThreaded );

    // === STEP 4: 리프 클러스터 생성 ===
    const uint32 BaseCluster = Clusters.Num();
    Clusters.AddDefaulted( Partitioner.Ranges.Num() );

    ParallelFor( Partitioner.Ranges.Num(), 1024,
        [&]( int32 Index )
        {
            auto& Range = Partitioner.Ranges[ Index ];

            Clusters[ BaseCluster + Index ] = FCluster(
                Verts, Indexes, MaterialIndexes, VertexFormat,
                Range.Begin, Range.End,
                Partitioner.Indexes, Partitioner.SortedTo, Adjacency );

            // 음수는 리프 노드 표시
            Clusters[ BaseCluster + Index ].EdgeLength *= -1.0f;
        });
}
```

**AddMesh 시각화:**

```
원본 메시 (10,000 삼각형)
        ↓
    Edge Hash 생성
        ↓
  Disjoint Set 연결
        ↓
┌────────────────────────────────────┐
│  METIS 그래프 분할                  │
│  - 목표: 124-128 tri/cluster       │
│  - 공유 엣지 가중치: 260            │
│  - 지역성 가중치: 1                 │
└────────────────────────────────────┘
        ↓
  78개 클러스터 생성
  (10,000 tri / 128 = 78.125)
```

---

### 2. ReduceMesh - 계층 생성 루프

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp:205-586`

```cpp
void FClusterDAG::ReduceMesh( uint32 ClusterRangeStart, uint32 ClusterRangeNum, uint32 MeshIndex )
{
    uint32 LevelOffset = ClusterRangeStart;
    bool bFirstLevel = true;

    while( true )
    {
        TArrayView< FCluster > LevelClusters( &Clusters[ LevelOffset ], ... );

        // === 종료 조건: 2개 이하 클러스터 ===
        if( LevelClusters.Num() <= MaxGroupSize )
        {
            // 최종 그룹 생성
            TArray< uint32 > Children;
            for( FCluster& Cluster : LevelClusters )
                Children.Add( LevelOffset++ );

            ReduceGroup( RayTracingScene.Get(), NumClusters, Children, MaxClusterSize, MaxParents, Groups.Num() - 1, MeshIndex );
            break;
        }

        // === STEP 1: 외부 엣지 찾기 (클러스터 간 연결) ===
        TArray< FExternalEdge > ExternalEdges;
        FHashTable ExternalEdgeHash;

        // 외부 엣지 해싱
        ParallelFor( LevelClusters.Num(), 32,
            [&]( uint32 ClusterIndex )
            {
                for( int32 EdgeIndex : Cluster.ExternalEdges )
                {
                    uint32 Hash = Murmur32( { HashPosition(Pos0), HashPosition(Pos1) } );
                    ExternalEdges[ ExternalEdgeOffset++ ] = { ClusterIndex, EdgeIndex };
                    ExternalEdgeHash.Add_Concurrent( Hash, ExternalEdgeIndex );
                }
            });

        // 매칭 엣지 찾기 → AdjacentClusters 맵 구축
        ParallelFor( LevelClusters.Num(), 32,
            [&]( uint32 ClusterIndex )
            {
                for( uint32 ExternalEdgeIndex : ExternalEdgeHash )
                {
                    if( Position0 == OtherPos1 && Position1 == OtherPos0 )
                    {
                        Cluster.AdjacentClusters.FindOrAdd( ExternalEdge.ClusterIndex, 0 )++;
                    }
                }
            });

        // === STEP 2: Disjoint Set으로 연결된 클러스터 그룹화 ===
        FDisjointSet DisjointSet( LevelClusters.Num() );

        for( uint32 ClusterIndex = 0; ClusterIndex < LevelClusters.Num(); ClusterIndex++ )
        {
            for( auto& Pair : LevelClusters[ ClusterIndex ].AdjacentClusters )
            {
                if( ClusterIndex > Pair.Key )
                    DisjointSet.UnionSequential( ClusterIndex, Pair.Key );
            }
        }

        // === STEP 3: METIS 그래프 분할 (8-32 클러스터 그룹) ===
        FGraphPartitioner Partitioner( LevelClusters.Num(), MinGroupSize, MaxGroupSize );

        Partitioner.BuildLocalityLinks( DisjointSet, TotalBounds, TArrayView<int32>(), GetCenter );

        auto* Graph = Partitioner.NewGraph( NumAdjacency );

        for( int32 i = 0; i < LevelClusters.Num(); i++ )
        {
            for( auto& Pair : LevelClusters[ ClusterIndex ].AdjacentClusters )
            {
                bool bSiblings = Cluster0.GroupIndex == Cluster1.GroupIndex;

                // 형제 클러스터면 가중치 낮춤 (같은 그룹 선호)
                Partitioner.AddAdjacency( Graph, OtherClusterIndex, NumSharedEdges * ( bSiblings ? 1 : 16 ) + 4 );
            }

            Partitioner.AddLocalityLinks( Graph, ClusterIndex, 1 );
        }

        Partitioner.PartitionStrict( Graph, !bSingleThreaded );

        // === STEP 4: 각 그룹에 대해 ReduceGroup 호출 ===
        Clusters.AddDefaulted( MaxParents );
        Groups.AddDefaulted( Partitioner.Ranges.Num() );

        ParallelFor( Partitioner.Ranges.Num(), 1,
            [&]( int32 PartitionIndex )
            {
                TArrayView< uint32 > Children( &Partitioner.Indexes[ Range.Begin ], ... );
                ReduceGroup( RayTracingScene.Get(), NumClusters, Children, MaxClusterSize, MaxParents, ClusterGroupIndex, MeshIndex );
            } );

        // 다음 레벨로 이동
        LevelOffset = Clusters.Num();
    }

    // === STEP 5: 루트 그룹 생성 ===
    FClusterGroup RootClusterGroup;
    RootClusterGroup.Children.Add( RootIndex );
    RootClusterGroup.Bounds = Clusters[ RootIndex ].SphereBounds;
    RootClusterGroup.LODBounds = FSphere3f( 0 );
    RootClusterGroup.MaxParentLODError = 1e10f;  // 무한대 (항상 보임)
    RootClusterGroup.MinLODError = -1.0f;
    RootClusterGroup.MipLevel = Clusters[ RootIndex ].MipLevel + 1;
    Groups.Add( RootClusterGroup );
}
```

**ReduceMesh 시각화:**

```
Level 0: 78 클러스터 (리프)
        ↓
    외부 엣지 찾기
    (클러스터 간 연결 해싱)
        ↓
    METIS 그룹화
    (8-32 클러스터/그룹)
        ↓
Level 1: 8개 그룹 (각 그룹당 ~10 클러스터)
        ↓
    각 그룹에 대해 ReduceGroup 호출
    → 부모 클러스터 생성 (단순화)
        ↓
Level 2: 8 클러스터
        ↓
    다시 METIS 그룹화
        ↓
Level 3: 1 그룹
        ↓
    ReduceGroup
        ↓
Level 4: 1 클러스터 (루트)
```

**MinGroupSize / MaxGroupSize:**

**📂 소스:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp:202-203`

```cpp
static const uint32 MinGroupSize = 8;
static const uint32 MaxGroupSize = 32;
```

---

### 3. ReduceGroup - 부모 클러스터 생성

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp:750-950` (이미 읽은 내용)

```cpp
void FClusterDAG::ReduceGroup(
    FRayTracingScene* RayTracingScene,
    TAtomic< uint32 >& NumClusters,
    TArrayView< uint32 > Children,
    uint32 MaxClusterSize,
    uint32 MaxParents,
    uint32 GroupIndex,
    uint32 MeshIndex )
{
    // === STEP 1: 자식 클러스터들의 바운드 수집 ===
    TArray< FSphere3f > Children_LODBounds;
    for( uint32 ChildIndex : Children )
    {
        Children_LODBounds.Add( Clusters[ ChildIndex ].SphereBounds );
    }

    // === STEP 2: 단순화 vs 체소화 결정 ===
    bool bVoxels = !bAllTriangles || Settings.bPreserveArea;

    if( bAllTriangles )
    {
        // 경로 A: 삼각형 메시 단순화
        FCluster Merged( *this, Children );  // 자식들을 하나로 병합

        SimplifyError = Merged.Simplify( *this, TargetNumTris );
    }

    #if NANITE_VOXEL_DATA
    if( bVoxels )
    {
        // 경로 B: 체소화 (실험적)
        float VoxelSize = SimplifyError;

        // 적응적 VoxelSize 조정
        while( VoxelSize < SimplifyError )
        {
            Voxelized.Voxelize( *this, *RayTracingScene, Children, VoxelSize );

            if( Voxelized.NumVerts < TargetNumVoxels )
                break;

            VoxelSize *= 1.1f;  // 10% 증가
        }
    }
    #endif

    // === STEP 3: METIS 그래프 분할로 부모 클러스터 생성 ===
    TArray< FCluster > Clusters;

    SplitCluster<FGraphPartitioner>( Merged, Clusters, MaxClusterSize, ... );

    // === STEP 4: 부모 LOD 데이터 설정 ===
    float ParentMaxLODError = 0.0f;
    for( FCluster& Cluster : Clusters )
    {
        // LOD Error 계산
        Cluster.LODError = SimplifyError;
        ParentMaxLODError = FMath::Max( ParentMaxLODError, Cluster.LODError );
    }

    // === STEP 5: FClusterGroup 구성 ===
    Groups[GroupIndex].MaxParentLODError = ParentMaxLODError;
    Groups[GroupIndex].MinLODError = /* 자식들의 최소 오차 */;
    Groups[GroupIndex].Bounds = /* 병합된 바운드 */;
    Groups[GroupIndex].MipLevel = /* 자식들의 MipLevel + 1 */;

    // 자식 클러스터들에게 GroupIndex 설정
    for( uint32 ChildIndex : Children )
    {
        Clusters[ ChildIndex ].GroupIndex = GroupIndex;
    }
}
```

**ReduceGroup 프로세스:**

```
그룹 (16개 자식 클러스터, 각 128 tri)
        ↓
┌────────────────────────────────────┐
│  자식들을 하나로 병합                │
│  - 2,048 삼각형                     │
│  - 중복 버텍스 제거                 │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│  단순화 (FMeshSimplifier)           │
│  - 목표: 1,024 tri (50% 단순화)     │
│  - SimplifyError = 0.5 (달성 오차)  │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│  METIS 그래프 분할                  │
│  - 1,024 tri → 8개 클러스터         │
│  - 각 클러스터 128 tri              │
└────────────────────────────────────┘
        ↓
    8개 부모 클러스터
    (MaxParentLODError = 0.5)
```

---

## 🔍 FindCut - LOD 선택 알고리즘

### Binary Heap 기반 컷 찾기

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp:949-1063` (이미 읽은 내용)

```cpp
FBinaryHeap<float> FClusterDAG::FindCut(
    uint32 TargetNumTris,
    float  TargetError,
    uint32 TargetOvershoot,
    TBitArray<>* SelectedGroupsMask) const
{
    FBinaryHeap<float> Heap;

    // 루트 클러스터를 힙에 추가
    Heap.Add(-RootCluster.LODError, RootGroup.Children[0]);

    uint32 CurNumTris = RootCluster.NumTris;
    float MinError = RootCluster.LODError;

    while( true )
    {
        // 가장 높은 에러의 클러스터 선택 (Min Heap이므로 음수)
        const uint32 ClusterIndex = Heap.Top();
        const FCluster& Cluster = Clusters[ClusterIndex];

        MinError = FMath::Min( MinError, -Heap.TopKey() );

        // 목표 달성 확인
        bool bHitTarget = CurNumTris > TargetNumTris || MinError < TargetError;

        if( bHitTarget && Cluster.LODError < MinError )
            break;  // Cut 완성

        // 자식들로 대체
        Heap.Pop();
        CurNumTris -= Cluster.NumTris;

        const FClusterGroup& NextGroup = Groups[ Cluster.GroupIndex ];

        for( uint32 Child : NextGroup.Children )
        {
            const FCluster& ChildCluster = Clusters[ Child ];
            Heap.Add( -ChildCluster.LODError, Child );
            CurNumTris += ChildCluster.NumTris;
        }
    }

    return Heap;  // Cut = remaining clusters in heap
}
```

### FindCut 시각화

```
초기 상태:
Heap = [ Root (LODError=10.0, 128 tri) ]
CurNumTris = 128

목표: TargetNumTris = 5000

Iteration 1:
  Pop Root → Push 자식들 (Group 0)
  Heap = [ Cluster 0 (8.0, 128), Cluster 1 (7.5, 128), Cluster 2 (7.0, 128), ... ]
  CurNumTris = 128 * 16 = 2,048

Iteration 2:
  CurNumTris < TargetNumTris → Continue
  Pop Cluster 0 (highest error) → Push 자식들 (Group 1)
  Heap = [ Cluster 1 (7.5, 128), Cluster 2 (7.0, 128), Child 0 (5.0, 128), ... ]
  CurNumTris = 2,048 - 128 + (128 * 8) = 2,944

Iteration 3:
  Pop Cluster 1 → Push 자식들
  CurNumTris = 5,168

Iteration 4:
  CurNumTris > TargetNumTris (5,168 > 5,000)
  MinError = 5.0
  Cluster 2.LODError (7.0) > MinError → Continue
  Pop Cluster 2 → Push 자식들
  CurNumTris = 5,040

Iteration 5:
  CurNumTris > TargetNumTris && TopCluster.LODError < MinError
  → Cut 완성

Final Cut (Heap의 남은 클러스터들):
  [ Cluster A, Cluster B, Cluster C, ... ]
  Total: ~5,040 triangles
```

**핵심 알고리즘:**

```
Binary Heap (Min Heap, 음수 LODError 사용):
┌─────────────────────────────────────────────────────────┐
│  Top: -8.0 (Cluster 0)                                  │
│         ↙            ↘                                   │
│   -7.5 (Cluster 1)   -7.0 (Cluster 2)                   │
│     ↙      ↘           ↙      ↘                          │
│  -6.0     -5.5      -6.5     -5.0                       │
└─────────────────────────────────────────────────────────┘

동작:
1. Pop Top (가장 높은 에러) → 자식들로 대체
2. CurNumTris 업데이트
3. 목표 달성 확인 (삼각형 수 or 에러 임계값)
4. 반복
```

---

## 🧩 DAG 계층 구조 예시

### 실제 메시 (100만 삼각형)의 DAG

```
Level 6 (Root):
┌─────────────────────────────────────────────────────────────┐
│  1 클러스터 (128 tri, LODError=10.0)                        │
│  MaxParentLODError = 1e10 (무한대)                          │
└─────────────────────────────────────────────────────────────┘
                         │
           ┌─────────────┴─────────────┐
           │                           │
Level 5: 8 클러스터 (각 128 tri, LODError=8.0-9.0)
           │
    ┌──────┴──────┐
    │             │
Level 4: 64 클러스터 (각 128 tri, LODError=6.0-7.0)
           │
    ┌──────┴──────┐
    │             │
Level 3: 512 클러스터 (각 128 tri, LODError=4.0-5.0)
           │
    ┌──────┴──────┐
    │             │
Level 2: 4,096 클러스터 (각 128 tri, LODError=2.0-3.0)
           │
    ┌──────┴──────┐
    │             │
Level 1: 32,768 클러스터 (각 128 tri, LODError=0.5-1.0)
           │
    ┌──────┴──────┐
    │             │
Level 0 (Leaves): 262,144 클러스터 (각 128 tri, LODError=0.0)
```

**총 삼각형 수 계산:**
- Level 0: 262,144 × 128 = 33,554,432 tri (원본의 약 33배 - 이는 오버헤드 아님, 원본 1M이 Level 0에 저장)
- 실제 Level 0 클러스터 수: 1,000,000 / 128 = 7,812.5 → 7,813 클러스터
- Level 1: 7,813 / 8 = 976.6 → 977 클러스터
- Level 2: 977 / 8 = 122 클러스터
- Level 3: 122 / 8 = 15 클러스터
- Level 4: 15 / 8 = 2 클러스터
- Level 5: 1 클러스터 (Root)

**메모리 오버헤드:**
- 원본 메시: 1,000,000 tri
- Level 0 (리프): 7,813 클러스터 × 128 tri = 1,000,064 tri (거의 동일)
- Level 1~5 (부모들): 977 + 122 + 15 + 2 + 1 = 1,117 클러스터 × 128 tri = 142,976 tri
- 총합: ~1,143,040 tri (원본의 1.14배)

**전통적 LOD vs Nanite:**
- 전통적 LOD (LOD0~LOD3): 1.85배 메모리
- Nanite DAG: 1.14배 메모리 (38% 절감)

---

## 💡 성능 특성

### DAG 순회 비용

**런타임 DAG 순회 (FindCut):**
- CPU에서 실행 (빌드 타임에 생성된 DAG 사용)
- Binary Heap 연산: O(log N)
- 평균 순회 깊이: ~6-8 레벨
- 프레임당 비용: ~0.1-0.5ms (복잡도에 따라)

**GPU Persistent Thread Culling:**
- DAG 순회는 CPU에서 Cut 찾기만 수행
- 실제 클러스터 컬링은 GPU에서 (BVH 순회 + Frustum/HZB 테스트)
- CPU-GPU 분리로 병렬 실행 가능

### 메모리 효율

**페이지 기반 스트리밍:**
```cpp
// FClusterGroup 구조 (ClusterDAG.h:30-31)
uint32 PageIndexStart = MAX_uint32;  // 128 KB 페이지 시작
uint32 PageIndexNum = 0;             // 페이지 개수
```

**스트리밍 동작:**
- FindCut 결과 클러스터들의 페이지 요청
- GPU 메모리에 필요한 페이지만 로드
- 카메라 이동 시 동적 페이지 교체

**예시:**
- 전체 DAG 크기: 10 GB (원본 데이터)
- 보이는 클러스터: ~5,000개
- 페이지 크기: 128 KB
- 실제 GPU 메모리: ~500 MB (5% 상주)

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Cluster.md](./Cluster.md) - 클러스터 생성 및 METIS 분할
- [Culling.md](./Culling.md) - Persistent Threads 컬링
- [Rasterization.md](./Rasterization.md) - HW/SW 래스터화
- [Streaming.md](./Streaming.md) - 페이지 기반 스트리밍 (예정)

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
