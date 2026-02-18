---
title: "Nanite 스트리밍 시스템 (Streaming System)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 스트리밍 시스템 (Streaming System)

## 🧭 개요

Nanite는 **페이지 기반 가상화 스트리밍**을 사용하여 GPU 메모리를 효율적으로 관리합니다.

### 핵심 개념

**"필요한 클러스터만 GPU 메모리에 로드"**

- 128 KB 페이지 단위 스트리밍
- FClusterGroup의 PageIndexStart/PageIndexNum
- 비동기 로딩 (CPU-GPU 파이프라인)
- LRU 기반 페이지 교체
- 메모리 절감: 전체 데이터의 5-15%만 상주

---

## 🎯 설계 철학

### 왜 가상화된 스트리밍인가?

**Brian Karis (2021 발표):** "100 GB의 Nanite 데이터를 **2 GB GPU 메모리**로 렌더링할 수 있습니다. 이는 가상 메모리와 유사한 개념입니다."

#### 전통적 LOD vs Nanite 스트리밍

```
전통적 LOD 시스템:
┌────────────────────────────────────────┐
│  모든 LOD를 GPU 메모리에 로드           │
│  LOD0 + LOD1 + LOD2 + LOD3 = 1.85x    │
│                                        │
│  문제: 메모리 낭비 (보이지 않는 LOD도)  │
└────────────────────────────────────────┘

Nanite 가상화 스트리밍:
┌────────────────────────────────────────┐
│  FindCut 결과 → 필요한 페이지만 로드    │
│  보이는 클러스터의 페이지만 GPU 상주    │
│                                        │
│  메모리: 원본의 5-15% (10-20배 절감)   │
└────────────────────────────────────────┘
```

---

## 🧱 페이지 구조

### FPageStreamingState

**📂 위치:** `Engine/Source/Runtime/Engine/Public/Rendering/NaniteResources.h`

```cpp
struct FPageStreamingState
{
    uint32 PageIndex;           // 128 KB 페이지 인덱스
    uint32 RefCount;            // 참조 카운트
    bool   bResidentInGPU;      // GPU 메모리 상주 여부
    uint32 LastAccessedFrame;   // LRU용 프레임 번호
};
```

### 페이지 크기

```
NANITE_GPU_PAGE_SIZE = 128 KB (131,072 bytes)

페이지 내용:
┌────────────────────────────────────────┐
│  Header (NANITE_GPU_PAGE_HEADER_SIZE)  │
├────────────────────────────────────────┤
│  FPackedCluster 메타데이터              │
├────────────────────────────────────────┤
│  인덱스 데이터                          │
├────────────────────────────────────────┤
│  위치 데이터 (압축)                     │
├────────────────────────────────────────┤
│  속성 데이터 (Normal, UV, Color 등)     │
└────────────────────────────────────────┘
```

---

## 🔄 스트리밍 프로세스

### 전체 파이프라인

```
Frame N:
  카메라 이동 → FindCut → 필요한 클러스터 식별
        ↓
  클러스터 → 페이지 인덱스 매핑
        ↓
  GPU → CPU: 페이지 요청 (비상주 페이지)
        ↓
  CPU: 비동기 I/O로 페이지 로드
        ↓
Frame N+1:
  GPU 메모리에 페이지 업로드
        ↓
  클러스터 래스터화 가능
```

### 페이지 요청 (GPU → CPU)

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf`

```hlsl
// Cluster Culling 단계
void ProcessCluster(uint4 PackedCluster)
{
    FVisibleCluster VisibleCluster = UnpackVisibleCluster(PackedCluster);
    uint PageIndex = VisibleCluster.PageIndex;

    // 페이지 상주 확인
    if (!IsPageResident(PageIndex))
    {
        // 페이지 요청 큐에 추가
        uint RequestIndex;
        InterlockedAdd(StreamingRequestCounter, 1, RequestIndex);
        StreamingRequests[RequestIndex] = PageIndex;
    }
}
```

### 페이지 로딩 (CPU)

**📂 위치:** `Engine/Source/Runtime/Engine/Public/Rendering/NaniteStreamingManager.h`

```cpp
void FNaniteStreamingManager::ProcessStreamingRequests()
{
    // === STEP 1: GPU에서 요청 큐 읽기 ===
    TArray<uint32> RequestedPages;
    ReadbackStreamingRequests(RequestedPages);

    // === STEP 2: 우선순위 정렬 (거리, LOD) ===
    RequestedPages.Sort([](uint32 A, uint32 B) {
        return GetPagePriority(A) > GetPagePriority(B);
    });

    // === STEP 3: 비동기 I/O ===
    for (uint32 PageIndex : RequestedPages)
    {
        if (IsPageAlreadyResident(PageIndex))
            continue;

        // 페이지 교체 (LRU)
        if (ResidentPages.Num() >= MaxResidentPages)
        {
            uint32 EvictedPageIndex = FindLRUPage();
            EvictPage(EvictedPageIndex);
        }

        // 비동기 로드
        FAsyncFileHandle FileHandle = OpenAsyncRead(PageIndex);
        FileHandle.Read(PageBuffer, NANITE_GPU_PAGE_SIZE);
    }

    // === STEP 4: GPU 업로드 (다음 프레임) ===
    for (FPageLoadRequest& Request : CompletedRequests)
    {
        UploadPageToGPU(Request.PageIndex, Request.PageData);
        ResidentPages.Add(Request.PageIndex);
    }
}
```

---

## 📊 메모리 관리

### LRU 페이지 교체

```cpp
uint32 FindLRUPage()
{
    uint32 OldestFrame = MAX_uint32;
    uint32 LRUPageIndex = 0;

    for (auto& Page : ResidentPages)
    {
        if (Page.LastAccessedFrame < OldestFrame)
        {
            OldestFrame = Page.LastAccessedFrame;
            LRUPageIndex = Page.PageIndex;
        }
    }

    return LRUPageIndex;
}
```

### 메모리 예산

```
일반적인 설정:
- 전체 Nanite 데이터: 10 GB
- GPU 메모리 예산: 512 MB (5%)
- 페이지 크기: 128 KB
- 최대 상주 페이지: 4,096개

실시간 조정:
- 높은 LOD (근거리): 1 GB 사용
- 낮은 LOD (원거리): 200 MB 사용
```

---

## 💡 최적화 팁

### ✅ 효율적인 스트리밍

```cpp
// ✅ 좋은 예: 점진적 카메라 이동
Camera.MoveSmooth(DeltaTime);  // 예측 가능한 페이지 요청

// ❌ 나쁜 예: 순간이동
Camera.TeleportTo(FarLocation);  // 대량 페이지 미스
```

### 디버그 명령어

```cpp
r.Nanite.Streaming.ShowStats 1      // 스트리밍 통계
r.Nanite.Streaming.MaxPendingPages  // 대기 페이지 수
```

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [DAG.md](./DAG.md) - FindCut 알고리즘
- [Compression.md](./Compression.md) - 페이지 내 데이터 압축

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
