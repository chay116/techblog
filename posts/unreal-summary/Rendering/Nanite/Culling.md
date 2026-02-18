---
title: "Nanite 컬링 시스템 (Culling System)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 컬링 시스템 (Culling System)

## 🧭 개요

Nanite의 컬링 시스템은 **Persistent Threads 아키텍처**를 사용하여 GPU에서 계층 구조 순회, LOD 선택, 가시성 판단을 통합 수행합니다.

### 핵심 개념

**"GPU를 채울 만큼의 워커 스레드만 생성하고, 작업 큐를 통해 동적으로 작업을 분배"**

- 트리 순회와 클러스터 컬링을 단일 셰이더에서 처리
- MPMC (Multi-Producer Multi-Consumer) 작업 큐 사용
- Critical Path 최적화로 의존성 레이턴시 최소화
- 유휴 시간 제거 (노드 없을 때 클러스터 처리)

---

## 🎯 설계 철학

### 왜 Persistent Threads인가?

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversal.ush:209-240`

```cpp
// Mapping tree-culling to the GPU is awkward as the number of leaf nodes that need to be accepted
// is dynamic and can be anywhere from none to hundreds of thousands. Mapping threads 1:1 to trees can result in
// extremely long serial processing that severely underutilizes the GPU. Conversely, mapping threads 1:1 to
// leaf nodes can end up leaving most threads idle.

// What we really need is the ability to dynamically spawn threads for children as they are determined
// to be visible during the traversal. This is unfortunately not possible (yet), so instead we use
// persistent threads. We spawn just enough worker threads to fill the GPU, keep them running and manually
// distribute work to them.
```

### 전통적 방법의 문제점

| 방법 | 문제점 | 결과 |
|------|--------|------|
| **스레드 1:1 트리 매핑** | 극도로 긴 직렬 처리 | GPU 심각한 저사용 |
| **스레드 1:1 리프 노드 매핑** | 대부분 스레드 유휴 | 낭비된 연산력 |
| **동적 스레드 생성** | GPU 하드웨어 미지원 | 불가능 |

### Persistent Threads 해결책

```
전통적 방법 (Thread per Tree):
┌────────┐ ┌────────┐ ┌────────┐
│ Tree 1 │ │ Tree 2 │ │ Tree 3 │  ← 각 트리마다 전용 스레드
│████████│ │██      │ │█       │  ← 작업량 불균형
└────────┘ └────────┘ └────────┘
   100ms      20ms      10ms        → 최대 레이턴시 100ms

Persistent Threads (Work Queue):
┌─────────────────────────────────┐
│   Worker Thread Pool (고정)      │
│  [T1][T2][T3][T4]...[T64]       │  ← GPU를 채우는 고정 워커들
└─────────────┬───────────────────┘
              ↓
┌─────────────────────────────────┐
│  Work Queue (MPMC)               │
│  [Tree1.Node] [Tree2.Node]...   │  ← 동적 작업 분배
└─────────────────────────────────┘
   → 레이턴시 ~25ms (25배 빠름, Brian Karis 발표)
```

**핵심 장점:**
1. **동적 부하 분산** - 모든 워커가 균등하게 작업
2. **Critical Path 최적화** - 노드 처리 우선 (의존성 체인)
3. **유휴 제거** - 노드 없을 때 클러스터 처리
4. **확장성** - 장면 복잡도와 무관한 일정한 성능

---

## 🧱 시스템 아키텍처

### 전체 컬링 파이프라인

```
                 ┌─────────────────────────────────────────────────┐
                 │  Phase 1: 인스턴스 컬링                          │
                 │  (Instance Culling)                             │
                 ├─────────────────────────────────────────────────┤
                 │  - Frustum culling (인스턴스 단위)               │
                 │  - Distance culling                             │
                 │  - Occlusion culling (이전 프레임 HZB)          │
                 │                                                 │
                 │  Output: 보이는 인스턴스의 루트 노드들          │
                 └──────────────────┬──────────────────────────────┘
                                    ↓
                 ┌─────────────────────────────────────────────────┐
                 │  Phase 2: 계층 순회 및 노드 컬링                 │
                 │  (Persistent Thread - Node Traversal)          │
                 ├─────────────────────────────────────────────────┤
                 │                                                 │
                 │  ┌──────────────────────────┐                  │
                 │  │ Work Queue (MPMC)        │                  │
                 │  │ ┌─────┬─────┬─────┐      │                  │
                 │  │ │Node1│Node2│Node3│ ...  │  ← 노드 큐       │
                 │  │ └─────┴─────┴─────┘      │                  │
                 │  └──────────┬───────────────┘                  │
                 │             ↓                                   │
                 │  ┌──────────────────────────┐                  │
                 │  │ Worker Threads (64개)    │                  │
                 │  │ [T1][T2][T3]...[T64]     │                  │
                 │  └──────────┬───────────────┘                  │
                 │             ↓                                   │
                 │  - BVH 노드 순회                                │
                 │  - Frustum + HZB 오클루전 테스트                │
                 │  - LOD 선택 (Screen Size)                       │
                 │                                                 │
                 │  Output: 가시적인 클러스터 후보들                │
                 └──────────────────┬──────────────────────────────┘
                                    ↓
                 ┌─────────────────────────────────────────────────┐
                 │  Phase 3: 클러스터 컬링                          │
                 │  (Persistent Thread - Cluster Culling)         │
                 ├─────────────────────────────────────────────────┤
                 │  - 클러스터 단위 Frustum culling                 │
                 │  - HZB Occlusion testing                        │
                 │  - HW/SW 래스터라이저 분류 (Screen Size)         │
                 │                                                 │
                 │  Output: SW/HW 래스터화 클러스터 리스트          │
                 └─────────────────────────────────────────────────┘
```

**📂 소스 검증:**
- `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf:885-895` - 메인 진입점
- `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversal.ush:244-358` - Persistent Thread 루프

---

## 📊 큐 구조

### FQueueState - MPMC 작업 큐

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversalCommon.ush:7-20`

```cpp
struct FQueuePassState
{
    uint ClusterBatchReadOffset;   // 배치 단위 읽기 오프셋 (64개 단위)
    uint ClusterWriteOffset;       // 개별 클러스터 단위 쓰기 오프셋
    uint NodeReadOffset;           // 노드 읽기 오프셋
    uint NodeWriteOffset;          // 노드 쓰기 오프셋
    int  NodeCount;                // 노드 개수 (보수적, 일시적으로 더 클 수 있음)
};

struct FQueueState
{
    uint TotalClusters;            // 총 클러스터 수
    FQueuePassState PassState[2];  // [0]=Main Pass, [1]=Post Pass
};
```

### 큐 운영 원리

```
┌─────────────────────────────────────────────────────────────────────┐
│                      노드 큐 (Node Queue)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  NodeWriteOffset (Producer)                                        │
│         ↓                                                          │
│  [Node][Node][Node][Node][    ][    ][    ][    ]                 │
│                             ↑                                      │
│                   NodeReadOffset (Consumer)                        │
│                                                                     │
│  NodeCount = WriteOffset - ReadOffset (진행 중인 노드 수)           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│               클러스터 배치 큐 (Cluster Batch Queue)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ClusterWriteOffset (Individual Clusters)                          │
│         ↓                                                          │
│  [C0..C63][C64..C127][C128..C191][        ][        ]             │
│  └Batch0─┘└─Batch1──┘└─Batch2───┘                                 │
│                                 ↑                                  │
│                 ClusterBatchReadOffset (Consumer)                  │
│                 (배치 단위: 64개씩)                                  │
│                                                                     │
│  배치 크기: NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE = 64      │
└─────────────────────────────────────────────────────────────────────┘
```

**📂 소스 검증:** `Engine/Shaders/Shared/NaniteDefinitions.h:105`

```cpp
#define NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE 64
```

---

## 🔄 Persistent Thread 메인 루프

### 워커 스레드 생명주기

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversal.ush:244-358`

```cpp
[numthreads(NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE, 1, 1)]
void NodeAndClusterCull(uint GroupID : SV_GroupID, uint GroupIndex : SV_GroupIndex)
{
    PersistentNodeAndClusterCull<FNaniteTraversalClusterCullCallback>(GroupIndex, QueueStateIndex);
}

template<typename FNaniteTraversalCallback>
void PersistentNodeAndClusterCull(uint GroupIndex, uint QueueStateIndex)
{
    bool bProcessNodes = true;                      // 노드 처리 가능 여부
    uint NodeBatchReadyOffset = NANITE_MAX_BVH_NODES_PER_GROUP;
    uint NodeBatchStartIndex = 0;
    uint ClusterBatchStartIndex = 0xFFFFFFFFu;

    while(true)
    {
        // === STEP 1: 노드 배치 가져오기 (우선순위) ===
        if (bProcessNodes && NodeBatchReadyOffset == NANITE_MAX_BVH_NODES_PER_GROUP)
        {
            // 16개 노드 배치 가져오기
            if (GroupIndex == 0)
                InterlockedAdd(QueueState[0].PassState[QueueStateIndex].NodeReadOffset,
                               NANITE_MAX_BVH_NODES_PER_GROUP, GroupNodeBatchStartIndex);

            NodeBatchReadyOffset = 0;
            NodeBatchStartIndex = GroupNodeBatchStartIndex;
        }

        // === STEP 2: 노드 준비 상태 확인 ===
        const uint NodeIndex = NodeBatchStartIndex + NodeBatchReadyOffset + GroupIndex;
        bool bNodeReady = TraversalCallback.LoadCandidateNodeDataToGroup(NodeIndex, GroupIndex);

        if (bNodeReady)
            InterlockedOr(GroupNodeMask, 1u << GroupIndex);

        AllMemoryBarrierWithGroupSync();
        NodeReadyMask = GroupNodeMask;

        // === STEP 3: 노드 처리 (첫 번째 노드 준비되면 실행) ===
        if (NodeReadyMask & 1u)
        {
            uint BatchSize = firstbitlow(~NodeReadyMask);  // 연속된 준비 노드 개수
            ProcessNodeBatch<FNaniteTraversalCallback>(BatchSize, GroupIndex, QueueStateIndex);
            NodeBatchReadyOffset += BatchSize;
            continue;  // 노드 처리 후 다시 시작
        }

        // === STEP 4: 노드 없으면 클러스터 처리 ===
        if (ClusterBatchStartIndex == 0xFFFFFFFFu)
        {
            // 클러스터 배치 가져오기
            if (GroupIndex == 0)
                InterlockedAdd(QueueState[0].PassState[QueueStateIndex].ClusterBatchReadOffset,
                               1, GroupClusterBatchStartIndex);
            ClusterBatchStartIndex = GroupClusterBatchStartIndex;
        }

        // === STEP 5: 종료 조건 확인 ===
        if (!bProcessNodes && GroupClusterBatchStartIndex >= GetMaxClusterBatches())
            break;  // 모든 작업 완료

        // === STEP 6: 클러스터 배치 처리 ===
        uint ClusterBatchReadySize = TraversalCallback.LoadClusterBatch(ClusterBatchStartIndex);

        if ((bProcessNodes && ClusterBatchReadySize == NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE) ||
            (!bProcessNodes && ClusterBatchReadySize > 0))
        {
            ProcessClusterBatch<FNaniteTraversalCallback>(ClusterBatchStartIndex, ClusterBatchReadySize, GroupIndex);
            ClusterBatchStartIndex = 0xFFFFFFFFu;  // 다음 배치 가져오기 위해 리셋
        }

        // === STEP 7: 노드 개수 확인 ===
        if (bProcessNodes && GroupNodeCount == 0)
            bProcessNodes = false;  // 더 이상 노드 없음
    }
}
```

### 실행 흐름 다이어그램

```
워커 스레드 (64개 동시 실행)
         │
         ├─────► 노드 처리 우선?
         │       ├─ Yes ──► 16개 노드 배치 가져오기
         │       │          ↓
         │       │          준비된 노드 확인 (비트마스크)
         │       │          ↓
         │       │          첫 노드 준비됨? ──Yes──► ProcessNodeBatch()
         │       │          │                       ↓
         │       │          │                       자식 노드를 큐에 추가
         │       │          │                       리프 노드면 클러스터 추가
         │       │          │                       ↓
         │       │          └────────────────► continue (다시 노드 확인)
         │       │
         │       └─ No ──► 클러스터 배치 가져오기 (64개)
         │                 ↓
         │                 ProcessClusterBatch()
         │                 ↓
         │                 각 클러스터 Frustum + HZB 테스트
         │                 ↓
         │                 보이는 클러스터 → 래스터화 큐
         │                 ↓
         ├─────────────► NodeCount == 0?
         │                 ├─ No ──► continue (노드 우선 계속)
         │                 └─ Yes ──► bProcessNodes = false
         │
         └─────────────► 클러스터도 끝? ──Yes──► break (종료)
                           └─ No ──► 클러스터만 처리
```

**핵심 로직:**
1. **노드 우선** - 항상 노드 처리 먼저 시도 (Critical Path)
2. **배치 처리** - 16개 노드 또는 64개 클러스터 단위
3. **동적 전환** - 노드 없으면 클러스터 처리 (유휴 방지)
4. **종료 조건** - NodeCount == 0 && 모든 클러스터 처리 완료

---

## 🔬 노드 처리 (ProcessNodeBatch)

### BVH 노드 순회 및 컬링

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversal.ush:62-182`

```cpp
template<typename FNaniteTraversalCallback>
void ProcessNodeBatch(uint BatchSize, uint GroupIndex, uint QueueStateIndex)
{
    const uint LocalNodeIndex = (GroupIndex >> NANITE_MAX_BVH_NODE_FANOUT_BITS);  // /4
    const uint ChildIndex = GroupIndex & NANITE_MAX_BVH_NODE_FANOUT_MASK;         // %4

    // === STEP 1: 계층 노드 슬라이스 가져오기 ===
    const FHierarchyNodeSlice HierarchyNodeSlice = GetHierarchyNodeSlice(
        TraversalCallback.GetHierarchyNodeOffset(), ChildIndex);

    bool bVisible = HierarchyNodeSlice.bEnabled;
    bool bLoaded = HierarchyNodeSlice.bLoaded;

    // === STEP 2: 가시성 판단 ===
    bVisible = TraversalCallback.ShouldVisitChild(HierarchyNodeSlice, bVisible);

    // === STEP 3: 자식 노드 큐에 추가 ===
    const bool bOutputChild = bVisible && bLoaded;
    if (bOutputChild && !HierarchyNodeSlice.bLeaf)
    {
        // 비-리프 노드 → 노드 큐에 추가
        WaveInterlockedAddScalar_(GroupNumCandidateNodes, 1, CandidateNodesOffset);

        // ... (GroupSync)

        TraversalCallback.StoreChildNode(CandidateNodesOffset, HierarchyNodeSlice);
    }

    // === STEP 4: 리프 노드 → 클러스터 추가 ===
    if (bOutputChild && HierarchyNodeSlice.bLeaf)
    {
        uint NumClusters = HierarchyNodeSlice.NumChildren;

        WaveInterlockedAdd_(QueueState[0].PassState[QueueStateIndex].ClusterWriteOffset,
                            NumClusters, CandidateClustersOffset);

        // 클러스터 인덱스 저장
        for (uint Index = StartIndex; Index < EndIndex; Index++)
        {
            TraversalCallback.StoreCluster(Index, HierarchyNodeSlice, BaseClusterIndex + (Index - StartIndex));
        }

        // 클러스터 배치 카운터 업데이트 (64개 단위)
        for (uint Index = StartIndex; Index < EndIndex;)
        {
            const uint BatchIndex = Index / NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE;
            const uint NextIndex = (Index & ~63u) + 64;  // 다음 배치 경계
            const uint MaxIndex = min(NextIndex, EndIndex);
            const uint Num = MaxIndex - Index;
            TraversalCallback.AddToClusterBatch(BatchIndex, Num);
            Index = NextIndex;
        }
    }
}
```

### BVH 노드 구조

**📂 소스:** `Engine/Shaders/Shared/NaniteDefinitions.h:100-103`

```cpp
#define NANITE_MAX_BVH_NODE_FANOUT_BITS  2
#define NANITE_MAX_BVH_NODE_FANOUT       4  // 최대 4개 자식
#define NANITE_MAX_BVH_NODES_PER_GROUP   16 // 배치당 16개 노드
```

**노드 배치 구조:**
```
16개 노드 배치 (NANITE_MAX_BVH_NODES_PER_GROUP)
┌────────────────────────────────────────────────────────────┐
│  Node 0: 4 Children  │  Node 1: 4 Children  │ Node 2 ...  │
│  [C0][C1][C2][C3]    │  [C0][C1][C2][C3]    │             │
└────────────────────────────────────────────────────────────┘
     ↓     ↓     ↓     ↓
  Thread Thread Thread Thread
  0-15  16-31  32-47  48-63    ← 64개 스레드가 동시 처리

GroupIndex:    0   1   2   3   4   5   6   7 ...
LocalNodeIndex: 0   0   0   0   1   1   1   1 ...  (GroupIndex / 4)
ChildIndex:     0   1   2   3   0   1   2   3 ...  (GroupIndex % 4)
```

---

## 🎯 클러스터 처리 (ProcessClusterBatch)

### 클러스터 컬링 및 분류

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversal.ush:188-205`

```cpp
template<typename FNaniteTraversalCallback>
void ProcessClusterBatch(uint BatchStartIndex, uint BatchSize, uint GroupIndex)
{
    FNaniteTraversalCallback TraversalCallback;

    if (GroupIndex < BatchSize)
    {
        // 클러스터 인덱스 계산
        const uint CandidateIndex = BatchStartIndex * NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE + GroupIndex;

        // 압축된 클러스터 데이터 로드
        const uint4 PackedCluster = TraversalCallback.LoadPackedCluster(CandidateIndex);

        // 컬링 및 래스터라이저 분류
        TraversalCallback.ProcessCluster(PackedCluster);
    }

    // 배치 클리어 (다음 프레임 준비)
    TraversalCallback.ClearClusterBatch(BatchStartIndex);
}
```

### ProcessCluster 내부 동작

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf:600-882`

```cpp
void ProcessCluster(uint4 PackedCluster)
{
    // 1. 클러스터 데이터 언팩
    FVisibleCluster VisibleCluster = UnpackVisibleCluster(PackedCluster, false);
    FCluster Cluster = GetCluster(VisibleCluster.PageIndex, VisibleCluster.ClusterIndex);

    // 2. Frustum Culling
    FBoxCull Cull;
    Cull.Init(/* ... */);
    Cull.Distance();      // 거리 컬링
    Cull.GlobalClipPlane();  // 글로벌 클립 플레인

    if (!Cull.bIsVisible)
        return;  // 컬링됨

    // 3. HZB Occlusion Testing
    if (Cull.bViewHZB)
    {
        bool bVisible = TestHZBOcclusion(/* ... */);
        if (!bVisible)
        {
            // Main Pass에서 가려짐 → Post Pass로 이동
            uint OccludedClusterOffset = 0;
            WaveInterlockedAddScalar_(QueueState[0].PassState[1].ClusterWriteOffset, 1, OccludedClusterOffset);
            StoreCandidateCluster(MainAndPostCandidateClusters, (MaxCandidateClusters - 1) - OccludedClusterOffset, VisibleCluster);
            return;
        }
    }

    // 4. HW/SW 래스터라이저 분류
    const float PixelEstRadius = /* Screen Size 계산 */;
    const bool bUseHWRaster = (PixelEstRadius >= GNaniteMaxPixelsPerEdge);

    // 5. 보이는 클러스터 저장
    EmitVisibleCluster(bUseHWRaster, TotalPrevDrawClusters, HWClusterCounterIndex, VisibleCluster);
}
```

**클러스터 처리 흐름:**
```
PackedCluster (압축 데이터)
        ↓
  ┌──────────────┐
  │  Unpack      │
  └──────────────┘
        ↓
  ┌──────────────┐
  │  Frustum     │  ─No→ 컬링
  │  Culling     │
  └──────────────┘
        ↓ Yes
  ┌──────────────┐
  │  HZB         │  ─Occluded→ Post Pass 큐
  │  Occlusion   │
  └──────────────┘
        ↓ Visible
  ┌──────────────┐
  │  Screen Size │
  │  계산         │
  └──────────────┘
        ↓
     Screen Size
        ↓
    ┌───┴───┐
    │   ?   │
    └───┬───┘
        ├─ 크다 (≥ 2px) → HW 래스터라이저 큐
        └─ 작다 (< 2px) → SW 래스터라이저 큐
```

---

## 🔗 메모리 일관성 (Coherent 버퍼)

### Coherent 버퍼 사용 이유

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf:70-76`

```cpp
#if CULLING_TYPE == NANITE_CULLING_TYPE_PERSISTENT_NODES_AND_CLUSTERS
RWCoherentByteAddressBuffer MainAndPostNodesAndClusterBatches;
RWCoherentByteAddressBuffer MainAndPostCandidateClusters;
#else
RWByteAddressBuffer MainAndPostNodesAndClusterBatches;
RWByteAddressBuffer MainAndPostCandidateClusters;
#endif
```

### Coherent vs Non-Coherent

| 특성 | RWByteAddressBuffer | RWCoherentByteAddressBuffer |
|------|---------------------|-----------------------------|
| **읽기 일관성** | 보장 안 됨 | 모든 스레드에서 최신 데이터 보장 |
| **쓰기 가시성** | 명시적 배리어 필요 | 자동 동기화 |
| **성능** | 빠름 | 약간 느림 (일관성 비용) |
| **사용 사례** | 독립적 작업 | Producer-Consumer 패턴 |

### Persistent Threads에서 필수인 이유

```cpp
// Producer 스레드 (노드 처리):
StoreCandidateClusterCoherent(CandidateClusters, Index, Cluster);  // 쓰기
DeviceMemoryBarrier();  // 메모리 배리어 (모든 스레드에게 보장)
AddToClusterBatchCoherent(ClusterBatches, BatchIndex, 1, true);    // 배치 카운터 증가

// Consumer 스레드 (클러스터 처리):
uint BatchSize = LoadClusterBatchCoherent(ClusterBatches, BatchIndex, false);  // 읽기
if (BatchSize == 64)  // 배치 준비 완료 확인
{
    // 클러스터 데이터 읽기 (항상 최신 데이터)
    uint4 Cluster = LoadPackedClusterCoherent(CandidateClusters, Index);
}
```

**일관성 없으면 발생하는 문제:**
1. **Race Condition** - 배치 카운터는 증가했지만 클러스터 데이터 미작성
2. **Stale Read** - 오래된 데이터 읽기
3. **Missing Clusters** - 일부 클러스터 누락

**📂 소스 검증:** `Engine/Shaders/Private/Nanite/NaniteHierarchyTraversal.ush:109, 126, 157, 173`

```cpp
#if NANITE_HIERARCHY_TRAVERSAL_TYPE == NANITE_CULLING_TYPE_PERSISTENT_NODES_AND_CLUSTERS
    AllMemoryBarrierWithGroupSync();  // 라인 109
#else
    GroupMemoryBarrierWithGroupSync();
#endif

DeviceMemoryBarrierWithGroupSync();  // 라인 126, 173
DeviceMemoryBarrier();               // 라인 157
```

---

## 📈 성능 특성

### Persistent Threads 성능 이점

**Brian Karis (2021 발표) 벤치마크:**

| 방법 | 프레임 시간 | 상대 성능 |
|------|------------|----------|
| **CPU 계층 순회** | ~5ms | 1x (기준) |
| **GPU 레벨별 순회** | ~3ms | 1.67x |
| **Persistent Threads** | **~0.2ms** | **25x** |

### 성능 향상 이유

1. **동적 부하 분산**
   ```
   레벨별 순회 (비효율):
   Level 0:  [████████████████] 100% utilization
   Level 1:  [████████        ]  50% utilization
   Level 2:  [████            ]  25% utilization
   Level 3:  [██              ]  12% utilization

   Persistent Threads (효율적):
   All Time: [████████████████] 100% utilization
   ```

2. **레이턴시 숨김**
   - 노드 처리 중 메모리 지연 → 클러스터 처리로 전환
   - 의존성 체인 대기 중 → 다른 트리의 노드 처리

3. **캐시 효율**
   - 64개 스레드가 연속된 클러스터 처리 → 캐시 히트율 향상

### 워크그룹 계산

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf:1033-1036`

```cpp
[numthreads(1, 1, 1)]
void InitClusterCullArgs()
{
    const uint NumCandidateClusters = min(OutQueueState[0].PassState[InitIsPostPass].ClusterWriteOffset, MaxCandidateClusters);
    OutClusterCullArgs[0] = (NumCandidateClusters + NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE - 1) / NANITE_PERSISTENT_CLUSTER_CULLING_GROUP_SIZE;
    // 예: 92,160 클러스터 / 64 = 1,440 워크그룹 (Brian Karis 발표 수치)
}
```

**Brian Karis가 언급한 1440 work groups:**
- GROUP_SIZE = 64 (스레드/그룹)
- 총 스레드 수 = 1440 × 64 = 92,160 스레드
- 일반적인 장면의 평균 클러스터 후보 수

---

## 💡 최적화 팁

### ✅ 효율적인 컬링 최적화

```cpp
// ✅ 좋은 예: Early Exit
if (!Cull.bIsVisible)
    return;  // 즉시 종료

// ✅ 좋은 예: Wave Intrinsics 활용
WaveInterlockedAddScalar_(Counter, 1, Offset);  // 하드웨어 가속

// ✅ 좋은 예: Batch 단위 처리
for (uint i = 0; i < 64; i += 4)  // 4개씩 벡터 처리
    ProcessClusters4(i);
```

### ❌ 피해야 할 패턴

```cpp
// ❌ 나쁜 예: 모든 테스트 후 체크
bool bFrustum = TestFrustum();
bool bOcclusion = TestOcclusion();  // Frustum 실패해도 실행
bool bVisible = bFrustum && bOcclusion;

// ❌ 나쁜 예: 개별 Atomic 연산
for (uint i = 0; i < NumClusters; i++)
    InterlockedAdd(Counter, 1);  // 매우 느림

// ❌ 나쁜 예: Divergent Branch
if (GroupIndex < 32)
    ProcessClustersA();  // 절반 유휴
else
    ProcessClustersB();  // 절반 유휴
```

### 디버그 시각화

```cpp
// 콘솔 명령어 (에디터)
r.Nanite.Visualize 0   // 일반 렌더링
r.Nanite.Visualize 1   // Overdraw
r.Nanite.Visualize 2   // 클러스터별 색상
r.Nanite.Visualize 5   // LOD 레벨

r.Nanite.ShowStats 1   // 통계 표시
```

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Cluster.md](./Cluster.md) - 클러스터 생성 및 구조
- [Rasterization.md](./Rasterization.md) - HW/SW 래스터화 (예정)
- [DAG.md](./DAG.md) - 계층 구조 (예정)

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
