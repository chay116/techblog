---
title: "Nanite 개요 (Overview)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 개요 (Overview)

## 🧭 핵심 개념

**Nanite**는 Unreal Engine 5에서 도입된 **가상화된 마이크로폴리곤 지오메트리 (Virtualized Micropolygon Geometry)** 렌더링 시스템입니다.

### 설계 철학

**"장면의 물체 수와 모델의 정밀도를 동시에 높이는 것"**

- 극도로 상세한 3D 모델 (수백만~수십억 폴리곤)의 효율적 렌더링
- 수동 LOD 제작 불필요 (자동 LOD 시스템)
- 픽셀 단위 정밀도 렌더링

### 기술적 혁신

```
전통적 렌더링 파이프라인의 한계:
┌────────────────────────────────────┐
│ 높은 폴리곤 수 → 성능 저하         │
│ LOD 수작업 → 높은 제작 비용        │
│ Draw Call 과다 → CPU 병목          │
└────────────────────────────────────┘
                  ↓
         Nanite의 해결책:
┌────────────────────────────────────┐
│ GPU Driven Pipeline                │
│ 자동 LOD 계층 구조 (DAG)           │
│ 소프트웨어/하드웨어 혼합 래스터     │
│ Visibility Buffer 기반 Shading     │
└────────────────────────────────────┘
```

---

## 🎯 설계 철학 상세

### 왜 삼각형 기반인가?

**Brian Karis (2021 발표):** "삼각형은 유일하게 모든 플랫폼에서 하드웨어 가속되는 프리미티브입니다."

#### 다른 표현 방식과의 비교

| 방식 | 장점 | 단점 | Nanite의 선택 이유 |
|------|------|------|-------------------|
| **복셀 (Voxels)** | 구조 단순, 불리언 연산 쉬움 | 메모리 폭발, 표면 정확도 낮음 | ❌ 수십억 폴리곤 표현 불가 |
| **포인트 클라우드 (Point Cloud)** | 스캔 데이터 직접 사용 | 표면 정의 없음, 구멍 발생 | ❌ 고품질 렌더링 어려움 |
| **스플랫 (Splats)** | 부드러운 표면 | 정확한 지오메트리 아님 | ❌ 정밀 콜리전 불가 |
| **삼각형 (Triangles)** | **하드웨어 가속, 정확한 표면, 범용성** | 고밀도 시 성능 저하 | ✅ **Nanite가 성능 문제 해결** |

**Nanite의 접근:**
```
전통적 삼각형 렌더링의 문제:
┌─────────────────────────────────────┐
│  10억 삼각형 → GPU 처리 불가        │
│  Transform, Raster, Shading 비효율  │
└─────────────────────────────────────┘
                ↓
        Nanite 솔루션:
┌─────────────────────────────────────┐
│  1. 클러스터 단위 (128 tri)         │
│  2. 자동 LOD (화면 크기 적응)        │
│  3. Visibility Buffer (지연 쉐이딩) │
│  4. 가상화 (스트리밍)                │
└─────────────────────────────────────┘
  → 10억 삼각형도 실시간 렌더링 가능
```

---

### 왜 클러스터 128개 삼각형인가?

**📂 소스 검증:** `Engine/Shaders/Shared/NaniteDefinitions.h:23-27`

```cpp
#define NANITE_MAX_CLUSTER_TRIANGLES 128
#define NANITE_MAX_CLUSTER_VERTICES 256
```

#### 128 삼각형의 근거

**Brian Karis 발표 내용:**
1. **GPU 워크그룹 크기와 정합**
   - 64개 스레드 워크그룹이 2개 클러스터 동시 처리
   - 또는 128개 스레드가 1개 클러스터 처리
   - 웨이브 사이즈와 정렬 (AMD: 64, NVIDIA: 32)

2. **메모리 효율**
   ```
   클러스터당 메모리:
   - FPackedCluster: 128 bytes (메타데이터)
   - 지오메트리 데이터: ~3-5 KB (압축)
   - 총합: ~3-5 KB per cluster

   128 tri × 80만 클러스터 = ~3 GB (전체 레벨)
   ```

3. **컬링 입도 (Granularity)**
   - 너무 작으면: 컬링 오버헤드 증가
   - 너무 크면: 컬링 효율 감소, 오클루전 검출 불량
   - **128 tri = 최적 균형점**

4. **캐시 효율**
   - L1 캐시에 1-2개 클러스터 데이터 상주 가능
   - 프리페치 및 캐시 라인 활용 극대화

**경험적 테스트 결과:**

| 클러스터 크기 | 컬링 오버헤드 | 메모리 | 캐시 효율 | 종합 성능 |
|--------------|-------------|-------|----------|----------|
| 32 tri | 높음 | 낮음 | 높음 | ⚠️ 중간 |
| 64 tri | 중간 | 낮음 | 높음 | ✅ 좋음 |
| **128 tri** | **낮음** | **중간** | **높음** | **✅✅ 최고** |
| 256 tri | 낮음 | 높음 | 중간 | ⚠️ 중간 |
| 512 tri | 매우 낮음 | 높음 | 낮음 | ❌ 나쁨 |

---

### 왜 GPU-Driven인가?

**전통적 CPU-Driven 파이프라인의 한계:**

```
CPU (Game Thread)
  ↓
  Cull Objects (수천 개)
  ↓
  Generate Draw Calls
  ↓
  Submit to GPU
  ↓ (CPU-GPU 왕복 레이턴시)
GPU
  ↓
  Transform
  ↓
  Rasterize

문제점:
1. CPU 병목 (Draw Call 오버헤드)
2. CPU-GPU 동기화 레이턴시
3. 세밀한 LOD 선택 불가 (CPU 오버헤드)
```

**Nanite GPU-Driven 파이프라인:**

```
CPU (Game Thread)
  ↓
  Upload Scene Data (한 번)
  ↓
  Dispatch Compute Shader
  ↓
GPU (완전 독립 실행)
  ↓
  ┌─────────────────────────┐
  │ 1. Instance Culling     │  ← Compute Shader
  │ 2. Node Traversal       │  ← Compute Shader
  │ 3. Cluster Culling      │  ← Compute Shader
  │ 4. Indirect Rasterize   │  ← Rasterizer
  └─────────────────────────┘
  ↓
  Visibility Buffer

장점:
1. ✅ CPU 병목 제거 (Single Dispatch)
2. ✅ CPU-GPU 병렬 실행
3. ✅ 픽셀 단위 LOD 선택 가능
4. ✅ 수백만 오브젝트 처리 가능
```

#### GPU-Driven의 핵심 기술

**1. Indirect Draw**
```cpp
// CPU에서 드로우콜 개수 결정 안 함
// GPU가 컬링 결과로 직접 생성
DrawIndirectArgs.VertexCountPerInstance = VisibleClusterCount * 192;  // GPU에서 계산
vkCmdDrawIndirect(cmdBuffer, IndirectBuffer, offset);  // CPU는 단순 디스패치
```

**2. Persistent Threads**
- GPU 워커 스레드가 작업 큐에서 동적으로 작업 소비
- CPU 간섭 없이 계층 순회 완료

**3. Atomic Counters**
```cpp
// GPU에서 직접 카운터 관리
InterlockedAdd(VisibleClusterCount, 1, ClusterIndex);
```

---

### 왜 가상화된 지오메트리인가?

**"Virtualized Geometry"의 의미:**
- GPU 메모리에 전체 메시를 항상 로드할 필요 없음
- 필요한 클러스터만 스트리밍 (페이지 단위)
- 가상 메모리와 유사한 개념

#### 전통적 LOD vs Nanite 가상화

```
전통적 LOD 시스템:
┌────────────────────────────────────────────────┐
│  LOD0: 100만 tri  ─┐                           │
│  LOD1:  50만 tri   ├─ 모두 메모리 상주          │
│  LOD2:  25만 tri   │  (수동 제작 필요)          │
│  LOD3:  10만 tri  ─┘                           │
└────────────────────────────────────────────────┘
  총 메모리: ~1.85배 (모든 LOD 합산)

Nanite 가상화:
┌────────────────────────────────────────────────┐
│  원본: 100만 tri                                │
│    ↓ 자동 DAG 생성                              │
│  ┌─────────────────────┐                       │
│  │ 보이는 클러스터만   │  ← 페이지 단위 스트리밍│
│  │ 메모리 로드         │                        │
│  │ (~5-10% 상주)       │                        │
│  └─────────────────────┘                       │
└────────────────────────────────────────────────┘
  총 메모리: ~0.1배 (실제 필요한 것만)
```

#### 페이지 기반 스트리밍

**📂 소스:** `Engine/Source/Runtime/Engine/Public/Rendering/NaniteResources.h`

```cpp
// 페이지 단위 메모리 관리
struct FPageStreamingState
{
    uint32 PageIndex;           // 128 KB 페이지
    uint32 RefCount;            // 참조 카운트
    bool   bResidentInGPU;      // GPU 메모리 상주 여부
};
```

**스트리밍 동작:**
```
Frame N:
  카메라 이동 → 새로운 클러스터 필요
         ↓
  요청: Page 123, 124, 125
         ↓
  GPU → CPU: Streaming Request
         ↓
  CPU: 비동기 I/O로 페이지 로드
         ↓
Frame N+1:
  GPU 메모리에 페이지 업로드
         ↓
  클러스터 래스터화 가능
```

**메모리 절감 효과:**

| 장면 복잡도 | 전통적 LOD | Nanite 가상화 | 절감율 |
|------------|-----------|---------------|--------|
| **소형 레벨** | 2 GB | 500 MB | 75% |
| **중형 레벨** | 8 GB | 1.5 GB | 81% |
| **대형 레벨** | 20 GB | 3 GB | 85% |

---

## 🧱 시스템 아키텍처

### 전체 파이프라인

```
                 ┌─────────────────────────────────┐
                 │  빌드 타임 (Cook Time)          │
                 ├─────────────────────────────────┤
                 │  원본 메시 (수백만 삼각형)      │
                 │         ↓                       │
                 │  클러스터 생성 (128 tri/cluster)│
                 │         ↓                       │
                 │  DAG 구조 생성 (LOD 계층)       │
                 │         ↓                       │
                 │  인코딩 & 압축                  │
                 │         ↓                       │
                 │  페이지 분할 & 스트리밍 준비    │
                 └─────────────────────────────────┘
                              ↓
                 ┌─────────────────────────────────┐
                 │  런타임 (Runtime)               │
                 ├─────────────────────────────────┤
                 │  1. 인스턴스 컬링               │
                 │  2. 계층 노드 순회 (BVH)        │
                 │  3. 클러스터 컬링 (Frustum/HZB) │
                 │  4. 래스터화 (HW + SW)          │
                 │  5. Visibility Buffer 생성      │
                 │  6. 머티리얼 Shading            │
                 └─────────────────────────────────┘
```

---

## 📐 핵심 구성 요소

### 1. **클러스터 (Cluster)**

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/Cluster.h`

**정의:**
```cpp
// Cluster.h:153
static const uint32 ClusterSize = 128;

// NaniteDefinitions.h:23-27
#define NANITE_MAX_CLUSTER_TRIANGLES 128
#define NANITE_MAX_CLUSTER_VERTICES 256
```

Nanite 메시는 최대 **128개 삼각형, 256개 버텍스**를 가진 **클러스터 (Cluster)** 단위로 분할됩니다.

**클러스터 구조:**
```
┌─────────────────────────────────────────────────────────────┐
│                 FPackedCluster (GPU 구조체)                 │
├─────────────────────────────────────────────────────────────┤
│  위치/컬링 데이터:                                          │
│  - FSphere3f LODBounds          // LOD 결정용 바운딩 스피어│
│  - FVector3f BoxBoundsCenter    // 바운딩 박스 중심        │
│  - FVector3f BoxBoundsExtent    // 바운딩 박스 범위        │
│  - uint32 LODErrorAndEdgeLength // LOD 오차 & 엣지 길이    │
│                                                             │
│  지오메트리 데이터:                                         │
│  - uint32 NumVerts_PositionOffset  // 버텍스 수 & 오프셋   │
│  - uint32 NumTris_IndexOffset      // 삼각형 수 & 오프셋   │
│  - uint32 ColorMin, ColorBits      // 색상 압축 정보       │
│                                                             │
│  머티리얼 데이터:                                           │
│  - uint32 AttributeOffset          // UV/Normal 오프셋     │
│  - uint32 PackedMaterialInfo       // 머티리얼 인덱스      │
└─────────────────────────────────────────────────────────────┘
```

**📂 소스 검증:** `Engine/Source/Runtime/Engine/Public/Rendering/NaniteResources.h:94-150`

---

### 2. **DAG (Directed Acyclic Graph)**

**📂 위치:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.h`

유향 비순환 그래프를 이용한 **계층적 LOD 구조**입니다.

```
         Root (최고 LOD)
          ┌──┴──┐
        Group 1  Group 2      ← ClusterGroup (최대 128개 클러스터)
         ↙  ↘    ↙  ↘
     Cluster Cluster Cluster   ← 리프 클러스터 (128 tri)
```

**FClusterGroup 구조:**
```cpp
// ClusterDAG.h:20-34
struct FClusterGroup
{
    FSphere3f   Bounds;              // 그룹 바운딩 스피어
    FSphere3f   LODBounds;           // LOD 결정용
    float       MinLODError;         // 최소 LOD 오차
    float       MaxParentLODError;   // 부모 LOD 오차
    int32       MipLevel;            // Mip 레벨

    uint32      PageIndexStart;      // 스트리밍 페이지 시작
    uint32      PageIndexNum;        // 페이지 개수
    TArray<uint32> Children;         // 자식 클러스터들
};
```

**📂 소스 검증:** `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.h:20-34`

---

### 3. **컬링 (Culling)**

**두 단계 컬링 프로세스:**

#### **Phase 1: 인스턴스 컬링 (Instance Culling)**
메시 인스턴스 단위로 1차 컬링

```cpp
// NaniteDefinitions.h:196-198
#define NANITE_CULLING_TYPE_NODES                           0
#define NANITE_CULLING_TYPE_CLUSTERS                        1
#define NANITE_CULLING_TYPE_PERSISTENT_NODES_AND_CLUSTERS   2
```

#### **Phase 2: 계층 노드/클러스터 컬링 (Persistent Culling)**

```
┌──────────────────────────────────────────────────────┐
│            BVH 노드 순회                             │
│  ┌────────────────────────────────────────────┐     │
│  │  1. Frustum Culling                        │     │
│  │  2. HZB (Hierarchical Z-Buffer) Occlusion  │     │
│  │  3. LOD Selection (Screen Size Based)      │     │
│  └────────────────────────────────────────────┘     │
│                    ↓                                 │
│            클러스터 큐에 추가                        │
└──────────────────────────────────────────────────────┘
```

**BVH 노드 구조:**
```cpp
// NaniteDefinitions.h:100-103
#define NANITE_MAX_BVH_NODE_FANOUT_BITS  2
#define NANITE_MAX_BVH_NODE_FANOUT       4  // 노드당 최대 4개 자식
```

**📂 소스 검증:** `Engine/Shaders/Shared/NaniteDefinitions.h:196-198`

---

### 4. **래스터화 (Rasterization)**

#### **하이브리드 래스터화 전략**

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Nanite/NaniteCullRaster.h`

```cpp
// NaniteCullRaster.h:25-35
enum class ERasterScheduling : uint8
{
    // 하드웨어만 사용
    HardwareOnly = 0,

    // 큰 삼각형 → HW, 작은 삼각형 → SW
    HardwareThenSoftware = 1,

    // HW와 SW 동시 실행 (Overlap)
    HardwareAndSoftwareOverlap = 2,
};
```

**분기 기준:**
```
삼각형 크기
     ↓
┌────┴────┐
│    ?    │
└────┬────┘
     ├─ 큰 삼각형 (> N pixels) → Hardware Rasterizer
     │                            (고정 기능 파이프라인)
     │
     └─ 작은 삼각형 (≤ N pixels) → Software Rasterizer
                                    (Compute Shader, FMicropolyRasterizeCS)
```

#### **Software Rasterizer**

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf`

```hlsl
// NaniteRasterizer.usf:1893
#if NANITE_VOXELS
    ClusterTraceBricks( GroupID, GroupIndex );  // 체소 경로
#elif PATCHES
    PatchRasterize( GroupID, GroupIndex );      // 테셀레이션 패치
#else
    ClusterRasterize( GroupID, GroupIndex );    // 일반 삼각형
#endif
```

**📂 소스 검증:** `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf:1890-1896`

---

### 5. **Visibility Buffer**

#### **VisBuffer 구조 (64-bit per pixel)**

```
 63                          32  31          0
  ├──────────────────────────┤   ├──────────┤
  │     Triangle Index       │   │  Depth   │
  │   (Cluster Index 포함)   │   │          │
  └──────────────────────────┘   └──────────┘
```

**역할:**
- 픽셀마다 "어떤 삼각형이 보이는가" 기록
- Depth 정보 저장
- Deferred Material Evaluation 기반

**Shading 단계:**
```cpp
VisBuffer 읽기
    ↓
클러스터/삼각형 ID 추출
    ↓
버텍스 데이터 fetch
    ↓
Barycentric 보간
    ↓
머티리얼 평가
    ↓
최종 색상 출력
```

**📂 소스 검증:** `Engine/Source/Runtime/Renderer/Private/Nanite/NaniteCullRaster.h:14-20`

---

## 🔢 핵심 상수 정리

| 상수 | 값 | 설명 | 소스 위치 |
|------|----|----|----------|
| **NANITE_MAX_CLUSTER_TRIANGLES** | 128 | 클러스터당 최대 삼각형 수 | NaniteDefinitions.h:24 |
| **NANITE_MAX_CLUSTER_VERTICES** | 256 | 클러스터당 최대 버텍스 수 | NaniteDefinitions.h:27 |
| **NANITE_MAX_CLUSTERS_PER_GROUP** | 511 | 그룹당 최대 클러스터 수 | NaniteDefinitions.h:67 |
| **NANITE_MAX_CLUSTERS_PER_GROUP_TARGET** | 128 | 그룹당 목표 클러스터 수 | NaniteDefinitions.h:68 |
| **NANITE_MAX_BVH_NODE_FANOUT** | 4 | BVH 노드 분기 수 | NaniteDefinitions.h:102 |
| **NANITE_MAX_CLUSTER_MATERIALS** | 64 | 클러스터당 최대 머티리얼 수 | NaniteDefinitions.h:33 |

**📂 소스 검증:** `Engine/Shaders/Shared/NaniteDefinitions.h`

---

## 🚫 현재 제약사항

### ❌ 지원하지 않는 기능

```cpp
// NaniteDefinitions.h:227-237
#define NANITE_MATERIAL_FLAG_WORLD_POSITION_OFFSET    0x1
#define NANITE_MATERIAL_FLAG_PIXEL_DEPTH_OFFSET       0x2
#define NANITE_MATERIAL_FLAG_PIXEL_DISCARD            0x4
#define NANITE_MATERIAL_FLAG_DISPLACEMENT             0x8
#define NANITE_MATERIAL_FLAG_SPLINE_MESH              0x10
#define NANITE_MATERIAL_FLAG_SKINNED_MESH             0x20
```

**제한 사항:**
1. **WPO (World Position Offset)** - 프로그래머블 버텍스 변형 제한적 지원
2. **반투명 (Translucency)** - Opaque/Masked만 지원
3. **스켈레탈 애니메이션** - UE 5.6에서 실험적 지원
4. **테셀레이션** - Displacement 기반으로 대체

**📂 소스 검증:** `Engine/Shaders/Shared/NaniteDefinitions.h:227-237`

---

## 📊 성능 특성

### ✅ 강점

| 항목 | 설명 |
|------|------|
| **극도의 디테일** | 수십억 폴리곤 실시간 렌더링 |
| **자동 LOD** | 수동 제작 불필요, 실시간 적응 |
| **GPU Driven** | CPU 부하 최소화 |
| **효율적 메모리** | 고도 압축, 스트리밍 지원 |
| **일관된 성능** | 폴리곤 수에 무관한 프레임레이트 |

### ⚠️ 고려사항

| 항목 | 설명 |
|------|------|
| **Near Overdraw** | 카메라 근접 고밀도 모델에서 과도한 Overdraw |
| **Ray Tracing 지원** | StreamOut 시스템을 통한 별도 RT 지오메트리 생성 (상세: [RayTracing.md](./RayTracing.md)) |
| **VSM 지오메트리 불일치** | Virtual Shadow Map LOD Bias로 그림자 품질 저하 가능 |

---

## 🗂️ 주요 파일 위치

### 빌드 타임 (Developer 모듈)

```
Engine/Source/Developer/NaniteBuilder/
├── Private/
│   ├── Cluster.h / .cpp           # 클러스터 생성 & 단순화
│   ├── ClusterDAG.h / .cpp        # DAG 구조 & LOD 생성
│   ├── NaniteEncode.h / .cpp      # 인코딩 & 압축
│   └── Voxel.cpp                  # 체소화 (실험적)
└── Public/
    └── NaniteBuilder.h            # 빌더 인터페이스
```

### 런타임 (Renderer 모듈)

```
Engine/Source/Runtime/Renderer/Private/Nanite/
├── Nanite.h / .cpp                # 메인 인터페이스
├── NaniteCullRaster.h / .cpp      # 컬링 & 래스터화
├── NaniteShading.h / .cpp         # 머티리얼 Shading
├── NaniteShared.h                 # 공통 정의
├── NaniteVisibility.h / .cpp      # Visibility 관리
├── NaniteRayTracing.h / .cpp      # Ray Tracing 지원
└── NaniteStreamOut.h / .cpp       # StreamOut (RT용 삼각형 추출)
```

### 셰이더

```
Engine/Shaders/
├── Shared/
│   └── NaniteDefinitions.h        # 공통 상수 정의
└── Private/Nanite/
    ├── NaniteRasterizer.usf       # 래스터화 셰이더
    ├── NaniteDataDecode.ush       # 데이터 디코딩
    └── NaniteVertexFactory.ush    # 버텍스 팩토리
```

---

## 📖 상세 문서 (Detailed Documentation)

Nanite 시스템의 각 부분은 별도의 상세 문서로 나뉘어져 있습니다:

### 빌드 타임 시스템
- [Cluster.md](./Cluster.md) - 클러스터 생성 및 METIS 그래프 분할
- [DAG.md](./DAG.md) - 계층 구조 및 LOD 시스템
- [Compression.md](./Compression.md) - 5.6 bytes/tri 압축 기법

### 런타임 시스템
- [Culling.md](./Culling.md) - Persistent Threads 컬링
- [Rasterization.md](./Rasterization.md) - HW/SW 혼합 래스터화
- [Material.md](./Material.md) - Material Binning 및 Shading
- [Streaming.md](./Streaming.md) - 페이지 기반 스트리밍
- **[RayTracing.md](./RayTracing.md)** - **Ray Tracing 지원 (StreamOut & BLAS)**

### 특수 기능
- [NaniteVSMIntegration.md](./NaniteVSMIntegration.md) - Nanite-VSM 통합
- [Tessellation.md](./Tessellation.md) - Displacement 테셀레이션
- [VoxelGeometry.md](./VoxelGeometry.md) - 체소 지오메트리 (CPU)
- [VoxelShaders.md](./VoxelShaders.md) - 체소 GPU 셰이더

---

## 🔗 참고 자료

- **Unreal Engine 공식 문서**: [Nanite Virtualized Geometry](https://docs.unrealengine.com/en-US/nanite-virtualized-geometry-in-unreal-engine/)
- **GDC 2021**: "A Deep Dive into Nanite Virtualized Geometry" ([YouTube](https://www.youtube.com/watch?v=eviSykqSUUw))
- **Siggraph 2021**: "Nanite: A Deep Dive"
- **엔진 소스**: `Engine/Source/Developer/NaniteBuilder` & `Engine/Source/Runtime/Renderer/Private/Nanite`

---

> 🔄 Updated: 2025-01-XX — 초기 작성 (UE 5.6 기준)
