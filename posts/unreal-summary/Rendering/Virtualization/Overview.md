---
title: "Virtualization Technology Deep Dive (Virtual Textures, Nanite, VSM)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Virtualization"]
---
# Virtualization Technology Deep Dive (Virtual Textures, Nanite, VSM)

## 🧭 개요 (Overview)

**Virtualization (가상화)**는 Unreal Engine 5의 핵심 메모리 최적화 기술로, Textures, Geometry, Shadows를 **필요한 만큼만 GPU 메모리에 로드**하여 방대한 디테일을 제한된 VRAM에서 처리할 수 있게 합니다. 이 문서는 Virtual Textures (VT), Nanite, Virtual Shadow Maps (VSM)의 통합 가상화 아키텍처를 다룹니다.

**핵심 문제:**
```
전통적인 방식:
  - 4K Texture × 1,000개 = ~16GB VRAM
  - 10M Triangle Mesh × 100개 = ~8GB VRAM
  - 8K Shadow Map × 8 lights = ~2GB VRAM
  총: ~26GB VRAM (콘솔: 10GB 불가능!)

가상화 방식:
  - Virtual Texture Pool: 512MB (필요한 타일만)
  - Nanite Streaming Pool: 256MB (필요한 클러스터만)
  - VSM Page Pool: 128MB (필요한 섀도우 페이지만)
  총: ~1GB VRAM (26배 절감!)
```

**가상화 공통 원리:**
1. **데이터를 작은 단위로 분할** (Tile, Cluster, Page)
2. **Indirection Table로 매핑** (Virtual → Physical)
3. **필요한 것만 스트리밍** (On-Demand Loading)
4. **LRU 캐싱** (Least Recently Used 교체)

**주요 기술:**
- **Virtual Textures**: Streaming VT (메모리 절약) + Runtime VT (동적 생성)
- **Nanite**: Virtualized Micropolygon Geometry (픽셀 단위 LOD)
- **Virtual Shadow Maps**: Page-based Shadow Caching (캐스케이드 대체)

**성능 데이터 (실제 프로젝트):**
- Texture 메모리: **22GB → 500MB** (44배 절감)
- Geometry 메모리: **8GB → 800MB** (10배 절감)
- Shadow 비용: **12ms → 3ms** (4배 빠름)

---

## 💾 가상화의 기본 개념

### 1. 왜 가상화인가?

#### 문제: GPU 메모리는 느리게 증가

**하드웨어 트렌드:**
```
연도별 콘솔 VRAM:
  PS4 (2013): 8GB (공유)
  PS5 (2020): 16GB (공유) → 7년 만에 2배

연도별 게임 에셋 크기:
  2013: ~50GB
  2020: ~200GB → 4배 증가

문제: 에셋 크기 > VRAM 증가 속도
```

**전통적인 해결책의 한계:**
```cpp
// 1. LOD (Level of Detail)
// 문제: Pop-in 아티팩트, 수작업 제작 비용

// 2. Texture Streaming
// 문제: 전체 텍스처를 한 번에 로드, 메모리 낭비

// 3. Shadow Cascades
// 문제: 멀리 갈수록 품질 저하, 고정 해상도
```

#### 해결책: 가상화

**가상화 핵심 아이디어:**
```
Virtual Address Space (무한대처럼 보임)
    ↓ Indirection Table
Physical Memory (제한된 실제 메모리)
    ↓ LRU Caching
Disk Storage (거대한 저장소)
```

**가상화의 장점:**
- ✅ **무한에 가까운 디테일**: 메모리 제약 없이 고품질
- ✅ **메모리 사용량 고정**: Pool 크기만큼만 사용
- ✅ **자동 LOD**: 카메라 거리/화면 크기에 따라 자동
- ✅ **Pop-in 최소화**: 점진적 로딩

---

### 2. 가상화 공통 아키텍처

#### Indirection Table (간접 테이블)

```
┌──────────────────────────────────────────────────────────────┐
│                   Virtual Address Space                      │
│  (매우 큼 - 예: 16K × 16K Texture)                           │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ↓ Indirection Table (작음 - 예: 256 × 256)
┌──────────────────────────────────────────────────────────────┐
│  [Virtual Tile 0,0] → Physical Page 42                       │
│  [Virtual Tile 0,1] → Physical Page 15                       │
│  [Virtual Tile 1,0] → Invalid (아직 로드 안 됨)              │
│  ...                                                         │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ↓ Physical Memory Pool (제한됨 - 예: 512MB)
┌──────────────────────────────────────────────────────────────┐
│  [Page 0] [Page 1] ... [Page 42] ... [Page 255]             │
│  (128×128 each)                                              │
└──────────────────────────────────────────────────────────────┘
```

**예시: 16K Texture 샘플링**
```cpp
// 1. UV → Virtual Tile 계산
float2 UV = PixelUV;  // 0.0 ~ 1.0
uint2 VirtualTile = UV * IndirectionResolution;  // 예: (42, 15)

// 2. Indirection Table 샘플링
uint4 IndirectionData = IndirectionTexture[VirtualTile];
uint PhysicalPage = IndirectionData.x;  // 예: 42
float2 TileOffset = IndirectionData.yz;  // 타일 내 오프셋

// 3. Physical Texture 샘플링
float2 PhysicalUV = (TileOffset + frac(UV * TileSize)) / PhysicalPoolSize;
float4 Color = PhysicalTexture.Sample(Sampler, PhysicalUV);
```

---

#### Page/Tile/Cluster 개념

**공통 용어:**
| 기술 | 최소 단위 | 크기 | 용도 |
|------|-----------|------|------|
| **Virtual Texture** | Tile | 128×128 pixels | 텍스처 데이터 |
| **Nanite** | Cluster | 128 triangles | 지오메트리 데이터 |
| **Virtual Shadow Map** | Page | 128×128 pixels | 섀도우 깊이 |

**왜 128인가?**
```cpp
// GPU Warp/Wave 크기: 32~64 threads
// 128×128 = 16,384 pixels
// → 256 warps (64 threads)
// → 효율적인 GPU 활용

// 128 triangles
// → 2 warps per cluster
// → 캐시 친화적
```

---

#### LRU (Least Recently Used) 캐싱

```cpp
struct FVirtualPage
{
    uint64 VirtualAddress;     // Virtual Tile/Cluster/Page ID
    uint32 PhysicalIndex;      // Physical Pool 내 위치
    uint64 LastAccessFrame;    // 마지막 접근 프레임
    uint32 RefCount;           // 참조 카운트
};

class FVirtualPagePool
{
    TArray<FVirtualPage> Pages;           // 모든 페이지
    TDoubleLinkedList<FVirtualPage*> LRU; // LRU 순서

    FVirtualPage* AllocatePage(uint64 VirtualAddress)
    {
        // 1. 빈 페이지 찾기
        FVirtualPage* Page = FindFreePage();

        if (!Page)
        {
            // 2. LRU에서 가장 오래된 페이지 제거
            Page = EvictLRUPage();
        }

        // 3. 새 데이터 로드
        LoadPageData(Page, VirtualAddress);

        // 4. LRU List 맨 뒤에 추가
        LRU.AddTail(Page);

        return Page;
    }

    void TouchPage(FVirtualPage* Page)
    {
        // 접근 시 LRU List 맨 뒤로 이동
        Page->LastAccessFrame = GFrameNumber;
        LRU.Remove(Page);
        LRU.AddTail(Page);
    }
};
```

---

## 🖼️ Virtual Textures (가상 텍스처)

### 1. Virtual Texture 종류

#### Streaming Virtual Texture (SVT)

**목적:** 메모리 절약

**작동 방식:**
```
Disk: 16K × 16K Texture (압축)
  ↓ 비동기 스트리밍
CPU Memory: Staging Buffer
  ↓ GPU Upload
GPU Memory: Physical Texture Pool (512MB)
  ↓ Indirection
Shader: Virtual Texture 샘플링
```

**메모리 절약 사례:**
```
기존 방식:
  - 4K Albedo × 1,000 = ~16GB
  - 4K Normal × 1,000 = ~16GB
  총: 32GB (불가능!)

Streaming VT:
  - Physical Pool: 512MB (고정)
  - Disk: 22GB (압축)
  절감: 64배 절약!
```

**설정 방법:**
```cpp
// 1. 프로젝트 설정
Project Settings → Rendering → Virtual Textures
  Enable Virtual Texture Support: ✓

// 2. Texture 설정
Texture Asset → Details
  Virtual Texture Streaming: ✓
  Tile Size: 128 (기본)
  Tile Border Size: 4 (Filtering용)

// 3. Material에서 사용
Material Graph:
  Texture Sample → Sampler Type: Virtual
```

**성능 비용:**
```
정적 씬:
  - Indirection Sampling: 0.1ms
  - Feedback Analysis: 0.05ms
  - Page Streaming: 0.1ms
  총: 0.25ms (미미함)

동적 씬 (빠른 카메라 이동):
  - Page Thrashing 가능
  - 비용: 1~2ms
```

---

#### Runtime Virtual Texture (RVT)

**목적:** 동적 생성 (주로 Landscape)

**작동 방식:**
```
Landscape Layers (여러 머티리얼)
  ↓ GPU Rendering
RVT (동적으로 생성)
  ↓ Sampling
Final Landscape Rendering
```

**주요 용도:**
- Landscape Layer Blending
- Decal Baking
- Lighting Baking (임시)

**설정 방법:**
```cpp
// 1. RVT Volume 배치
Add Actor → Runtime Virtual Texture Volume
  Size: Landscape 크기에 맞춤
  Tile Count: 1024 (기본)  ← 해상도 결정
  Tile Size: 128
  Tile Border Size: 4

// 2. Landscape 설정
Landscape → Details
  Virtual Texture Render: ✓
  Runtime Virtual Textures: [RVT Volume 선택]

// 3. Material에서 사용
Material Graph:
  Runtime Virtual Texture Sample → RVT: [선택]
```

**메모리 vs 품질:**
```cpp
// Tile Count vs 해상도
Tile Count = 512  → 512 × 128 = 65K resolution
Tile Count = 1024 → 1024 × 128 = 131K resolution
Tile Count = 2048 → 2048 × 128 = 262K resolution

// 메모리 사용 (BC7 압축 기준)
Tile Count = 1024:
  - Physical Pool: 1024 tiles × 128×128 × 4 bytes (BC7)
  - = 64 MB (기본)

주의: Tile Count 증가 → 메모리 증가
      Tile Size 증가 → 업데이트 비효율
```

**흐릿함 문제 해결:**
```cpp
// 잘못된 접근
RVT_Volume->TileSize = 256;  // ❌ 비효율적

// 올바른 접근
RVT_Volume->TileCount = 2048;  // ✅ 해상도 증가
```

**이유:**
- Tile Size ↑ → 작은 영역 업데이트 시 전체 Tile 재렌더링
- Tile Count ↑ → 더 많은 타일, 더 세밀한 업데이트

---

### 2. Virtual Texture Stack

#### Stack 개념

**Stack = UV 좌표 조합의 수**

```cpp
// Example 1: Single Stack
Material:
  Albedo = Texture2D(AlbedoTex, UV0);  // Stack 0
  Normal = Texture2D(NormalTex, UV0);  // Stack 0 (같은 UV)
  Roughness = Texture2D(RoughTex, UV0); // Stack 0

→ Total Stacks: 1

// Example 2: Multiple Stacks
Material:
  Albedo = Texture2D(AlbedoTex, UV0);   // Stack 0
  Detail = Texture2D(DetailTex, UV1);   // Stack 1 (다른 UV)
  Decal = Texture2D(DecalTex, UV2);     // Stack 2

→ Total Stacks: 3
```

**Stack 수와 성능:**
```
Stacks = 1: GPU가 처리할 Book 1개
Stacks = 5: GPU가 처리할 Book 5개

각 Stack마다:
  - Indirection Texture 샘플링
  - Physical Texture 샘플링

Stack 수 ↑ → Texture Fetch ↑ → 성능 ↓
```

**최적화:**
```cpp
// 나쁜 예: UV 낭비
Material:
  Albedo = Texture2D(Tex, UV0);
  Detail1 = Texture2D(Tex, UV0 * 2);   // Stack 1 (UV 변형)
  Detail2 = Texture2D(Tex, UV0 * 4);   // Stack 2
  Detail3 = Texture2D(Tex, UV0 * 8);   // Stack 3
→ 4 Stacks

// 좋은 예: UV 재사용
Material:
  Albedo = Texture2D(Tex, UV0);        // Stack 0
  DetailMask = Texture2D(Mask, UV0);   // Stack 0

  // Vertex Shader에서 UV 변형
  UV1 = UV0 * DetailScale;  // Vertex-level
  Detail = Texture2D(DetailTex, UV1);  // Stack 1
→ 2 Stacks (절반 절감)
```

---

### 3. Virtual Texture 변환

#### 자동 변환 도구

**Unreal Engine 내장 도구:**
```cpp
// 1. Batch 변환
Content Browser → 여러 Texture 선택
Right Click → Asset Actions → Convert to Virtual Texture

// 2. 개별 변환
Texture Asset → Details
  Virtual Texture Streaming: ✓

// 변환 시 자동 생성:
// - Tile 구조로 재구성
// - Mipmap 재계산
// - 압축 포맷 유지
```

**변환 후 확인 사항:**
```cpp
// Material에서 Sampler Type 변경 필요
Texture Sample → Sampler Type: Virtual  // ✅

// 변경 안 하면:
Sampler Type: Color  // ❌ VT가 작동 안 함!
```

---

### 4. Virtual Texture 메모리 디버깅

#### Render Resource Viewer

**사용 방법:**
```
Editor → Window → Developer Tools → Render Resource Viewer

Virtual Textures Tab:
  - Physical Pool Size: 512 MB (실제 GPU 메모리)
  - Streaming Request: 150 tiles/frame (현재 요청)
  - Cache Hit Rate: 85% (히트율)
```

**메모리 최적화:**
```cpp
// Console Commands
r.VT.PoolSize = 512  // MB, Physical Pool 크기

// Pool 부족 증상:
// - 텍스처가 흐릿함 (Low Mip)
// - Console 경고: "VT Pool Exhausted"

// 해결:
r.VT.PoolSize = 1024  // 더 큰 Pool

// 또는 Tile Count 줄이기 (메모리 절약)
r.VT.MaxAnisotropy = 4  // 기본 8
```

---

## 🔷 Nanite: 가상화된 지오메트리

### 1. Nanite 기본 원리

#### Virtualized Micropolygon Geometry

**핵심 아이디어:**
```
픽셀 단위 LOD:
  - 화면 1 픽셀 = ~1 삼각형
  - 카메라 멀리 = 적은 삼각형
  - 카메라 가까이 = 많은 삼각형

예: 10M Triangle Mesh
  화면에서 100K pixels →100K triangles 실제 렌더링
  나머지 9.9M triangles → 스트리밍 Pool에만 존재
```

**Cluster 구조:**
```
Original Mesh: 10,485,760 triangles
  ↓ Clustering (128 triangles per cluster)
Clusters: 81,920 clusters

각 Cluster:
  - 128 triangles
  - Bounding Box
  - Normal Cone (Backface Culling용)
  - LOD Level

LOD Hierarchy:
  LOD 0: 1 cluster (최저 디테일)
  LOD 1: 4 clusters
  LOD 2: 16 clusters
  ...
  LOD N: 81,920 clusters (최고 디테일)
```

---

### 2. Nanite 메모리 관리

#### Cluster Page Data

**Render Resource Viewer:**
```
Nanite Tab:
  - Cluster Page Data: 450 MB (현재 로드됨)
  - Streaming Pool Size: 512 MB (최대)
  - Visible Clusters: 245K (현재 프레임)
```

**Pool 크기 조정:**
```cpp
// Console Command
r.Nanite.StreamingPoolSize = 512  // MB

// Pool 부족 증상:
// - LOD 팝핑 발생
// - Console 경고: "Nanite Pool Exhausted"

// 해결:
r.Nanite.StreamingPoolSize = 1024  // 더 큰 Pool
```

---

### 3. Nanite 최신 기능 (UE 5.4+)

#### Spline Mesh 지원

**배경:**
```cpp
// UE 5.3 이전: Spline Mesh는 Nanite 미지원
// → CPU에서 Deform
// → 메모리 많이 사용

// UE 5.4+: Spline Mesh Nanite 지원
// → GPU에서 Deform
// → 메모리 절약
```

**사용 방법:**
```cpp
// Spline Mesh Component
SplineMeshComponent->bEnableNanite = true;

// 내부적으로:
// 1. Spline을 따라 Cluster 배치
// 2. GPU에서 Deformation
// 3. Nanite Rasterization
```

**메모리 절감:**
```
기존 (Non-Nanite Spline):
  - Spline 100개 × 10K verts = 4 MB
  - 각 Spline마다 별도 메모리

Nanite Spline:
  - Base Mesh 1개 (공유): 1 MB
  - Cluster 인스턴싱
  절감: 4배
```

---

#### Tessellation 지원 (UE 5.5+)

**PN Tessellation:**
```hlsl
// PN Triangles (Point-Normal)
// 3차 Bezier 곡면으로 삼각형을 부드럽게

// Nanite + PN Tessellation:
// 1. Nanite Cluster (128 triangles)
// 2. PN Tessellation (각 triangle → 4~16 triangles)
// 3. Displacement (High-Frequency Detail)
```

**사용 예시:**
```cpp
// Material
Material->TessellationMode = MTM_PNTriangles;
Material->TessellationMultiplier = 4.0f;  // 4배 세분화

// Nanite Mesh
StaticMesh->bEnableNanite = true;
StaticMesh->NaniteSettings.bAllowTessellation = true;
```

**성능:**
```
Base Mesh: 1M triangles
  ↓ Nanite Culling
Visible: 200K triangles
  ↓ PN Tessellation (4x)
Final: 800K triangles

비용: +1.5ms (Tessellation)
```

---

### 4. Nanite 설정 최적화

#### Fallback Target (폴백 타겟)

**용도:**
- Non-Nanite 플랫폼 (Mobile, VR)
- Nanite 미지원 패스 (Translucency)

**설정:**
```cpp
// Static Mesh → Nanite Settings

// 잘못된 설정
Fallback Target: Percent Triangles = 10%
// 문제: 복잡한 메시는 여전히 많은 삼각형

// 올바른 설정
Fallback Target: Relative Error = 1.0
// 효과: 일관된 품질, 삼각형 수 자동 조절
```

**Relative Error 설명:**
```
Relative Error = 화면에서 허용 가능한 오차 (픽셀)

Relative Error = 0.5 → 0.5 pixel 오차 허용 (고품질)
Relative Error = 1.0 → 1.0 pixel 오차 허용 (중간)
Relative Error = 2.0 → 2.0 pixel 오차 허용 (저품질)

장점: 거리에 관계없이 일관된 품질
```

---

#### Vertex Color Embedding

**용도:**
- Curvature (곡률) 정보 저장
- AO (Ambient Occlusion) 베이킹
- Blend Weights

**주의사항:**
```cpp
// 나쁜 예: 급격한 색상 변화
VertexColor[0] = FLinearColor(1, 0, 0, 1);  // 빨강
VertexColor[1] = FLinearColor(0, 1, 0, 1);  // 초록 (급변!)

// 문제: Nanite Cluster가 이 정점을 분리
//       → 불필요한 Cluster 증가
//       → 메모리 낭비

// 좋은 예: 부드러운 변화
VertexColor[0] = FLinearColor(0.8, 0.2, 0, 1);
VertexColor[1] = FLinearColor(0.6, 0.4, 0, 1);  // 점진적
```

---

### 5. Nanite 디버깅

#### Visualization Modes

**사용 방법:**
```
Editor Viewport → View Mode → Nanite Visualization

옵션:
  - Triangles: 삼각형 밀도 (빨강 = 많음)
  - Clusters: Cluster 경계
  - Groups: Cluster Group
  - Pages: Streaming Page
```

**Console Commands:**
```cpp
// Cluster 시각화
r.Nanite.Visualize.Mode = Triangles

// 메모리 통계
Stat Nanite

// 출력:
// Cluster Page Data: 450 MB
// Visible Clusters: 245,000
// Rasterized Triangles: 8,200,000
```

---

## 🌑 Virtual Shadow Maps (가상 섀도우 맵)

### 1. VSM 기본 원리

#### Page Table 방식

**전통적인 Cascade Shadow Maps (CSM):**
```
Cascade 0: 2K × 2K (가까이)
Cascade 1: 2K × 2K (중간)
Cascade 2: 2K × 2K (멀리)
Cascade 3: 2K × 2K (매우 멀리)

문제:
  - 고정 해상도 → 멀리 갈수록 품질 저하
  - 4개 Draw Call
  - 총 메모리: 64 MB (고정)
```

**Virtual Shadow Maps (VSM):**
```
Virtual Space: 무한대 해상도 (논리적)
  ↓ Page Table
Physical Pool: 128 MB (제한됨)

장점:
  - 필요한 곳만 high-res
  - 단일 Draw Call (Nanite 통합)
  - 캐싱으로 성능 향상
```

**Page 구조:**
```
Page = 128 × 128 pixels (Shadow Depth)

Page Table (Indirection):
  Virtual Coordinate (무한대)
    ↓
  Physical Page Index (제한됨)
    ↓
  Shadow Depth Value
```

---

### 2. VSM 캐싱

#### Static Caching

**작동 방식:**
```cpp
// Frame 1:
// - Static Object 렌더링
// - Page에 섀도우 저장
// - Page 캐싱

// Frame 2:
// - Static Object 변화 없음
// - 캐시된 Page 재사용
// - 렌더링 비용 0!

// Dynamic Object만 매 프레임 렌더링
```

**캐싱 무효화 (Invalidation):**
```cpp
// 다음 경우 캐시 무효화:
// 1. Object 이동
// 2. Object 회전
// 3. Light 이동
// 4. WPO (World Position Offset) 변화

// 무효화 비용:
// - 해당 Page 재렌더링
// - 인접 Page도 영향 받을 수 있음
```

---

### 3. VSM 튜닝

#### WPO Disabled Distance

**문제:**
```cpp
// World Position Offset (WPO):
// - 나무 바람 애니메이션 등
// - 매 프레임 정점 위치 변경
// - VSM 캐시 매 프레임 무효화 (비용 높음!)
```

**해결책: WPO 비활성화 거리**
```cpp
// Console Variable
r.Shadow.Virtual.Clipmap.WPO.DisabledDistance = 5000  // cm (50m)

// 작동:
// - 50m 이내: WPO 활성화, 캐시 무효화
// - 50m 이상: WPO 비활성화, 캐시 유지

// 효과:
// - 멀리 있는 나무: 바람 애니메이션 없음 (눈에 안 띔)
// - 캐시 유지: 성능 향상
```

---

#### Clipmap LOD Bias

**Clipmap 구조:**
```
VSM은 Clipmap 구조 사용:
  Clipmap 0: 카메라 주변 10m
  Clipmap 1: 10~20m
  Clipmap 2: 20~40m
  ...
  Clipmap N: 매우 멀리
```

**LOD Bias:**
```cpp
// Console Variable
r.Shadow.Virtual.Clipmap.LODBias = 1

// 효과:
// - 모든 Clipmap을 1단계 낮은 해상도로
// - 메모리 절감, 성능 향상
// - 품질 약간 저하 (멀리는 눈에 안 띔)

// 예:
// LODBias = 0 (기본):
//   Clipmap 0: 128 pixels/meter
//   Clipmap 1: 64 pixels/meter

// LODBias = 1:
//   Clipmap 0: 64 pixels/meter  ← 1단계 낮음
//   Clipmap 1: 32 pixels/meter
```

---

#### Shadow Tearing 문제

**증상:**
```
섀도우가 찢어지는 현상 (Tearing)
특히 카메라 빠르게 이동 시
```

**원인:**
```cpp
// Clipmap이 카메라 따라 이동
// → 이전 프레임 캐시와 불일치
// → Tearing 발생
```

**해결책:**
```cpp
// 1. WPO Disabled Distance 조정
r.Shadow.Virtual.Clipmap.WPO.DisabledDistance.LODBias = 1

// 2. Clipmap LOD Bias 증가 (성능 우선)
r.Shadow.Virtual.Clipmap.LODBias = 2

// 3. Page Pool 크기 증가 (품질 우선)
r.Shadow.Virtual.PagePoolSize = 256  // MB
```

---

### 4. VSM 메모리 디버깅

#### Render Resource Viewer

**사용 방법:**
```
Render Resource Viewer → Virtual Shadow Maps

표시:
  - Page Pool Size: 128 MB
  - Allocated Pages: 45,000 / 65,536
  - Cache Hit Rate: 78%
  - Invalidation Count: 1,200 pages
```

**최적화:**
```cpp
// Pool 부족 증상:
// - 섀도우 품질 저하
// - Page 교체 빈번 (Thrashing)

// 해결 1: Pool 증가
r.Shadow.Virtual.PagePoolSize = 256  // 128 → 256 MB

// 해결 2: Clipmap 범위 감소
r.Shadow.Virtual.Clipmap.LastLevel = 8  // 기본 10

// 해결 3: WPO 비활성화
r.Shadow.Virtual.Clipmap.WPO.DisabledDistance = 2000  // 20m
```

---

## 🔧 통합 메모리 최적화 전략

### 1. 메모리 예산 할당

**권장 VRAM 예산 (1440p, 콘솔):**
```
총 VRAM: 10GB (Xbox Series S 기준)
  - OS/System: 2GB
  - 사용 가능: 8GB

권장 할당:
  - G-Buffer: 800MB (15%)
  - Virtual Textures: 512MB (10%)
  - Nanite: 512MB (10%)
  - Virtual Shadow Maps: 256MB (5%)
  - Lumen: 1GB (20%)
  - Post Process: 512MB (10%)
  - 기타/여유: 2.4GB (30%)
```

---

### 2. Scalability 설정

**프로젝트별 Scalability:**
```cpp
// Config/DefaultScalability.ini

[SystemSettings]
; Low (모바일, 저사양 PC)
sg.ViewDistanceQuality = 0
r.VT.PoolSize = 128
r.Nanite.StreamingPoolSize = 128
r.Shadow.Virtual.PagePoolSize = 64

; Medium (PS4, Xbox One)
sg.ViewDistanceQuality = 1
r.VT.PoolSize = 256
r.Nanite.StreamingPoolSize = 256
r.Shadow.Virtual.PagePoolSize = 128

; High (PS5, Xbox Series S)
sg.ViewDistanceQuality = 2
r.VT.PoolSize = 512
r.Nanite.StreamingPoolSize = 512
r.Shadow.Virtual.PagePoolSize = 256

; Epic (High-End PC)
sg.ViewDistanceQuality = 3
r.VT.PoolSize = 1024
r.Nanite.StreamingPoolSize = 1024
r.Shadow.Virtual.PagePoolSize = 512
```

---

### 3. 프로파일링 워크플로우

#### 단계별 체크리스트

**1. Render Resource Viewer로 현황 파악**
```
1. Virtual Textures:
   - Pool 사용률: < 90% 목표
   - Cache Hit Rate: > 80% 목표

2. Nanite:
   - Pool 사용률: < 85% 목표
   - Visible Clusters: 합리적인 수준

3. VSM:
   - Pool 사용률: < 80% 목표
   - Cache Hit Rate: > 75% 목표
```

**2. Console 경고 확인**
```cpp
// 자주 나타나는 경고:
// "VT Pool Exhausted" → r.VT.PoolSize 증가
// "Nanite Pool Exhausted" → r.Nanite.StreamingPoolSize 증가
// "VSM Page Pool Full" → r.Shadow.Virtual.PagePoolSize 증가
```

**3. GPU 프로파일링 (Unreal Insights)**
```
Unreal Insights → GPU Track

확인 항목:
  - Nanite Rasterization: < 2ms 목표
  - VSM Shadow Depth: < 3ms 목표
  - Lumen: < 5ms 목표 (Hardware RT)
```

---

## 💡 실전 최적화 팁

### ✅ 해야 할 것

**Virtual Textures:**
```cpp
// 1. 모든 주요 텍스처를 VT로 변환
// 예외: UI, Post Process, 매우 작은 텍스처 (< 256x256)

// 2. Material에서 Sampler Type 확인
Sampler Type: Virtual  // ✅

// 3. Stack 수 최소화 (UV 재사용)
// Stack 3개 이하 목표
```

**Nanite:**
```cpp
// 1. Fallback Target: Relative Error 사용
FallbackTarget: Relative Error = 1.0  // ✅

// 2. Vertex Color 부드럽게 변화
// 급격한 색상 변화 금지

// 3. WPO 최소화
// 필요 시만 사용, 거리 제한
```

**VSM:**
```cpp
// 1. WPO Disabled Distance 설정
r.Shadow.Virtual.Clipmap.WPO.DisabledDistance = 5000  // 50m

// 2. Clipmap LOD Bias (성능 우선 시)
r.Shadow.Virtual.Clipmap.LODBias = 1

// 3. Page Pool 충분히 할당
r.Shadow.Virtual.PagePoolSize = 256  // 최소
```

---

### ❌ 피해야 할 것

**Virtual Textures:**
```cpp
// 1. Sampler Type 변경 안 함
Sampler Type: Color  // ❌ VT 작동 안 함!

// 2. Stack 너무 많음
Material with 10 UV sets  // ❌ 비효율

// 3. Tile Size 증가로 해상도 올리기
RVT->TileSize = 256;  // ❌ 업데이트 비효율
```

**Nanite:**
```cpp
// 1. Fallback: Percent Triangles 사용
FallbackTarget: Percent Triangles = 10%  // ❌ 비일관적

// 2. Vertex Color 급변
VertexColor[i] = Random();  // ❌ Cluster 분리

// 3. WPO 무분별 사용
Material->WorldPositionOffset = Wind();  // ❌ 캐시 무효화
```

**VSM:**
```cpp
// 1. WPO Disabled Distance 너무 작음
WPO.DisabledDistance = 500;  // ❌ 캐시 무효화 많음

// 2. Page Pool 너무 작음
r.Shadow.Virtual.PagePoolSize = 64;  // ❌ Thrashing

// 3. Clipmap Last Level 너무 높음
r.Shadow.Virtual.Clipmap.LastLevel = 15;  // ❌ 메모리 낭비
```

---

## 📚 참고 자료 (References)

### 공식 문서
- [Virtual Textures in Unreal Engine](https://docs.unrealengine.com/5.7/en-US/virtual-textures-in-unreal-engine/)
- [Nanite Virtualized Geometry](https://docs.unrealengine.com/5.7/en-US/nanite-virtualized-geometry-in-unreal-engine/)
- [Virtual Shadow Maps](https://docs.unrealengine.com/5.7/en-US/virtual-shadow-maps-in-unreal-engine/)

### GDC/SIGGRAPH Talks
- **Epic Games** - "A Deep Dive into Nanite Virtualized Geometry" (SIGGRAPH 2021)
- **Epic Games** - "Virtual Shadow Maps in Unreal Engine 5" (GDC 2022)
- **Brian Karis** - "Virtualized Geometry in UE5" (SIGGRAPH 2021)

### 커뮤니티 자료
- [Virtual Texture Best Practices](https://unrealcommunity.wiki/virtual-textures)
- [Nanite Memory Optimization Guide](https://unrealcommunity.wiki/nanite-memory)

---

## 🗓️ Version History

> v1.0 — 2025-01-23: Virtualization Technology Deep Dive 초안 작성 (Virtual Textures, Nanite, VSM 통합 가상화 아키텍처 포함)
