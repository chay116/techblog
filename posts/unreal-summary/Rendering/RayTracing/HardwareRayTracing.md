---
title: "Hardware Ray Tracing Optimization Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "RayTracing"]
---
# Hardware Ray Tracing Optimization Deep Dive

## 🧭 개요

**Hardware Ray Tracing (HWRT)** 은 실시간 광선 추적을 GPU 하드웨어로 가속하는 기술입니다. The Witcher 4 Demo에서는 **60 FPS 유지**를 위해 공격적인 최적화를 적용했습니다.

### 목표

| 항목 | 기존 HWRT | The Witcher 4 (최적화) |
|------|----------|----------------------|
| **GPU 시간 (RT)** | ~12ms | ~4ms |
| **BLAS 메모리** | ~800 MB | ~300 MB |
| **BLAS 업데이트** | 매 프레임 (~2ms) | 선택적 (~0.2ms) |
| **목표 FPS** | 30 FPS | 60 FPS |

---

## 🏗️ Ray Tracing Scene 구조

### 가속 구조 (Acceleration Structure)

```
┌─────────────────────────────────────────────────────────────────┐
│               TLAS (Top-Level Acceleration Structure)            │
│  - 씬 전체의 최상위 구조                                          │
│  - 각 오브젝트의 BLAS 참조                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  BLAS 1      │  │  BLAS 2      │  │  BLAS 3      │          │
│  │  (나무)      │  │  (건물)      │  │  (캐릭터)    │          │
│  │              │  │              │  │              │          │
│  │ - 삼각형 1   │  │ - 삼각형 1   │  │ - 삼각형 1   │          │
│  │ - 삼각형 2   │  │ - 삼각형 2   │  │ - 삼각형 2   │          │
│  │ - ...        │  │ - ...        │  │ - ...        │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

TLAS = Top-Level Acceleration Structure (씬 전체)
BLAS = Bottom-Level Acceleration Structure (개별 오브젝트)
```

**작동 방식:**

```cpp
// Ray Tracing Shader (HLSL)
[shader("raygeneration")]
void RayGen()
{
    Ray R = GenerateRay(DispatchRaysIndex());

    // 1. TLAS를 통해 광선 발사
    TraceRay(
        SceneTLAS,        // Top-Level Structure
        RAY_FLAG_NONE,
        0xFF,             // Instance Mask
        0,                // Ray Contribution
        1,                // MultiplierForGeometry
        0,                // Miss Shader Index
        R,                // Ray
        Payload           // Output
    );

    // 2. TLAS가 적절한 BLAS로 라우팅
    // 3. BLAS 내부에서 삼각형 교차 테스트
    // 4. Hit Shader 실행 또는 Miss Shader 실행
}
```

---

## 🚀 핵심 최적화 1: 근거리/원거리 Scene 분리

### 문제: 모든 지오메트리를 하나의 TLAS에 넣으면 느림

**기존 방식:**

```
단일 TLAS:
  - 근거리 나무 (4100만 폴리곤)
  - 원거리 나무 (수억 폴리곤)
  - 건물, 지형, 캐릭터 등 모두 포함

→ BLAS 메모리: ~800 MB
→ 업데이트 시간: ~2ms (매 프레임)
```

### 해결: 근거리/원거리 TLAS 분리

**The Witcher 4 전략:**

```
┌─────────────────────────────────────────────────────────────────┐
│                  근거리 TLAS (0 ~ 150m)                          │
├─────────────────────────────────────────────────────────────────┤
│  - 모든 지오메트리 포함 (다이나믹 포함)                           │
│  - 고품질 메시                                                   │
│  - 예산:                                                         │
│    → 메모리: 400 MB (실제 피크: ~300 MB)                         │
│    → GPU 업데이트: 0.5 ms (Async Compute)                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  원거리 TLAS (150m ~)                            │
├─────────────────────────────────────────────────────────────────┤
│  - 정적 지오메트리만 (Static Only)                                │
│  - 단순화된 프록시 메시                                           │
│  - 예산:                                                         │
│    → 메모리: ~100 MB                                             │
│    → GPU 업데이트: 거의 없음 (정적이므로)                         │
└─────────────────────────────────────────────────────────────────┘
```

### 구현

```cpp
// Shader: 근거리 먼저, 없으면 원거리
[shader("raygeneration")]
void RayGenDualScene()
{
    Ray R = GenerateRay(DispatchRaysIndex());
    FPayload Payload;

    // 1. 근거리 TLAS 먼저 트레이싱
    TraceRay(NearSceneTLAS, RAY_FLAG_NONE, 0xFF, 0, 1, 0, R, Payload);

    if (!Payload.bHit)  // 근거리에서 안 맞음
    {
        // 2. 원거리 TLAS 트레이싱
        TraceRay(FarSceneTLAS, RAY_FLAG_NONE, 0xFF, 0, 1, 0, R, Payload);
    }

    OutputColor[DispatchRaysIndex()] = Payload.Color;
}
```

**효과:**

| 항목 | 단일 TLAS | 이중 TLAS |
|------|----------|----------|
| **메모리** | ~800 MB | ~400 MB |
| **업데이트 시간** | ~2ms | ~0.5ms |
| **품질** | 동일 | 동일 |

---

## 🚀 핵심 최적화 2: 원거리 정적 Scene (Far Field)

### 파필드 (Far Field) 최적화

**핵심 아이디어**: 원거리는 대부분 정적 → 한 번만 빌드

```cpp
// Far Field Scene Setup
void SetupFarFieldScene()
{
    // 1. 정적 지오메트리만 선택
    TArray<UStaticMeshComponent*> StaticMeshes;
    for (auto& Actor : WorldActors)
    {
        if (Actor->IsStatic() && Actor->Distance > 150.0f)
        {
            StaticMeshes.Add(Actor->GetStaticMeshComponent());
        }
    }

    // 2. BLAS 빌드 (한 번만)
    for (auto& Mesh : StaticMeshes)
    {
        FRayTracingGeometry BLAS = BuildBLAS(Mesh->GetRenderMesh());
        FarFieldBLASes.Add(BLAS);
    }

    // 3. TLAS 빌드 (한 번만)
    FarFieldTLAS = BuildTLAS(FarFieldBLASes);
}

// 런타임: 업데이트 안 함!
void UpdateRayTracingScene()
{
    // 근거리만 업데이트
    UpdateNearSceneTLAS();

    // 원거리는 그대로 사용 (업데이트 비용 0!)
    // FarFieldTLAS는 변경 없음
}
```

**결과:**
- 원거리 BLAS 업데이트 비용: **0 ms**
- 메모리: ~100 MB (한 번만 할당)

---

## 🚀 핵심 최적화 3: 나무 Ray Tracing 최적화

### 문제: 애니메이션되는 나무 = BLAS 업데이트 비용 큼

**히어로 트리 (Hero Tree):**
- 폴리곤 수: 4,100만 개
- 바람 애니메이션: 매 프레임 변형
- BLAS 업데이트: ~0.5ms (하나만!)

**기존 방식:**

```cpp
// 게임 렌더링: Full Detail
TreeMesh->Render(FullQuality);

// Ray Tracing: 똑같이 Full Detail
TreeBLAS->Update(TreeMesh->GetDeformedVertices());  // 느림!
```

### 해결 1: Ray Tracing용 단순화 메시

```cpp
// Ray Tracing Scene에서는 애니메이션 꺼짐
TreeMesh->bRayTracingAnimated = false;

// 단순화된 메시 사용
TreeBLAS->SimplifiedMesh = CreateSimplifiedMesh(
    OriginalTriangles = 41,000,000,
    SimplifiedTriangles = 2,250  // ~18,000배 감소!
);
```

**용도:**
- 광원 차폐 여부만 체크 (Shadow Ray)
- 복잡한 Ray Hit 판정 불필요

**효과:**

| 메시 타입 | 삼각형 수 | RT 성능 |
|----------|---------|---------|
| **원본** | 41,000,000 | ~15ms |
| **단순화** | 2,250 | ~0.01ms |

### 해결 2: Nanite Foliage Voxel 활용

```cpp
// Nanite Foliage의 Voxel 표현을 RT에도 사용
if (TreeDistance > 200.0f)
{
    // Voxel로 치환 (단일 복셀 = 매우 빠름)
    TreeBLAS = CreateVoxelBLAS(NaniteFoliage->GetVoxelRepresentation());
}
else
{
    // 단순화 메시
    TreeBLAS = CreateSimplifiedBLAS(SimplifiedMesh);
}
```

---

## 🚀 핵심 최적화 4: Virtual Shadow Map 통합

### Nanite Voxel → VSM

**핵심 아이디어**: Nanite Foliage의 Voxel 표현을 그림자에도 활용

```cpp
// Virtual Shadow Map 렌더링 시
void RenderVirtualShadowMap()
{
    // 원거리 나무: Voxel로 렌더링
    for (auto& Tree : DistantTrees)
    {
        // Nanite Voxel 표현 가져오기
        FVoxelRepresentation Voxels = Tree->GetNaniteVoxels();

        // VSM에 단순화된 형태로 렌더링
        RenderVoxelsToShadowMap(Voxels);  // 매우 빠름!
    }
}
```

**효과:**

| 방법 | VSM 렌더링 시간 |
|------|---------------|
| **기존 (Full Mesh)** | ~8ms |
| **Nanite Voxel** | ~2.5ms |

### VSM 페이지 타일링

**문제**: VSM 페이지가 커서 업데이트 비용 높음

**해결:**

```cpp
// VSM 페이지를 64개 타일로 분할
const int32 TilesPerPage = 64;  // 8×8

// 변경된 타일만 업데이트
void UpdateVSMPage(FVSMPage& Page)
{
    for (int32 TileIndex = 0; TileIndex < TilesPerPage; ++TileIndex)
    {
        if (Page.Tiles[TileIndex].bDirty)
        {
            // 이 타일만 다시 렌더링
            RenderTile(Page.Tiles[TileIndex]);
            Page.Tiles[TileIndex].bDirty = false;
        }
    }
}
```

**효과:**
- 전체 페이지 업데이트 대신 일부 타일만
- 동적 오브젝트 주변만 업데이트 가능

---

## 🚀 핵심 최적화 5: Landscape Ray Tracing LOD

### 문제: Landscape LOD 변경 시 BLAS 업데이트 비용

**기존:**

```cpp
// Landscape LOD 변경 시
LandscapeMesh->SetLOD(NewLOD);

// BLAS 즉시 업데이트 → 프레임 드롭!
LandscapeBLAS->Update(LandscapeMesh->GetCurrentLODMesh());
```

### 해결: Time-Sliced Update

```cpp
// LOD 변경 시 즉시 업데이트하지 않음
void OnLandscapeLODChanged(int32 NewLOD)
{
    // 이전 LOD의 BLAS를 계속 사용
    // 새 LOD는 백그라운드에서 빌드
    AsyncBuildBLAS(NewLOD);
}

// 백그라운드 빌드
void AsyncBuildBLAS(int32 LOD)
{
    // 여러 프레임에 걸쳐 천천히 빌드 (Time Slice)
    for (int32 Frame = 0; Frame < 10; ++Frame)
    {
        BuildPartialBLAS(LOD, Frame / 10.0f);  // 10% 씩
        WaitForNextFrame();
    }

    // 빌드 완료 후 교체
    SwapBLAS(OldBLAS, NewBLAS);
}
```

**효과:**
- LOD 변경 시 프레임 드롭 없음
- 잠깐 동안 낮은 LOD의 RT 사용 (플레이어 눈에 안 띔)

---

## 📊 성능 측정

### The Witcher 4 Demo - 숲 씬

**Ray Tracing 비용 (PS5):**

```
근거리 TLAS (0 ~ 150m):
  - BLAS 메모리: ~300 MB (예산 400 MB)
  - BLAS 업데이트: ~0.5 ms (Async Compute)
  - 포함 지오메트리:
    → 캐릭터 (다이나믹)
    → 히어로 트리 (단순화 메시 2,250 삼각형)
    → 건물 (근거리)
    → 지형 (현재 LOD)

원거리 TLAS (150m ~):
  - BLAS 메모리: ~100 MB
  - BLAS 업데이트: 0 ms (정적)
  - 포함 지오메트리:
    → 원거리 나무 (Voxel)
    → 원거리 건물 (프록시)
    → 지형 (낮은 LOD)

총 RT 비용:
  - BLAS 업데이트: ~0.5 ms
  - RT 셰이딩: ~3.5 ms
  - VSM 렌더링: ~2.5 ms
  - 총: ~6.5 ms (목표 프레임의 40%)
```

### 기존 vs 최적화

| 항목 | 기존 (단일 TLAS) | 최적화 (이중 TLAS) |
|------|----------------|------------------|
| **BLAS 메모리** | ~800 MB | ~400 MB |
| **BLAS 업데이트** | ~2ms | ~0.5ms |
| **RT 셰이딩** | ~5ms | ~3.5ms |
| **VSM** | ~8ms | ~2.5ms |
| **총 RT 비용** | ~15ms | ~6.5ms |
| **FPS** | ~30 FPS | ~60 FPS |

---

## 💡 Async Compute 활용

### 문제: RT 업데이트가 Graphics Work 블로킹

**기존:**

```
Graphics Queue:
  [G-Buffer] → [Wait BLAS Update] → [Lighting] → [Post Process]
                      ↑ 블로킹 (2ms)
```

### 해결: Async Compute

```cpp
// BLAS 업데이트를 Async Compute Queue로
FRHICommandList& ComputeCmdList = RHICmdList.GetComputeCommandList();

// Graphics와 병렬 실행
ComputeCmdList.BeginParallelExecute();
{
    // BLAS 업데이트 (Compute Queue)
    UpdateRayTracingScene(ComputeCmdList);
}
ComputeCmdList.EndParallelExecute();

// Graphics Queue는 막히지 않음
GraphicsCmdList.DrawIndexedPrimitive(...);
```

**효과:**

```
Graphics Queue:  [G-Buffer] → [Lighting] → [Post Process]
                      ║
Compute Queue:        ║ [BLAS Update]
                      ║ (병렬 실행!)
```

**시간 절약**: ~0.5ms → 0.2ms (체감)

---

## 🎯 Best Practices

### 1. **Scene 분리 기준**

```cpp
// 150m 기준 사용 (The Witcher 4)
const float NearFarThreshold = 15000.0f;  // 150m (cm 단위)

// 오브젝트 분류
void ClassifyForRayTracing(AActor* Actor)
{
    float Distance = (Actor->GetActorLocation() - CameraLocation).Size();

    if (Distance < NearFarThreshold)
    {
        // 근거리: Full Quality
        Actor->SetRayTracingScene(NearSceneTLAS);
        Actor->SetRayTracingQuality(ERTQuality::High);
    }
    else
    {
        // 원거리: Simplified
        Actor->SetRayTracingScene(FarSceneTLAS);
        Actor->SetRayTracingQuality(ERTQuality::Low);
    }
}
```

### 2. **BLAS 단순화 전략**

```cpp
// 거리 기반 단순화
int32 GetRayTracingTriangleCount(float Distance)
{
    if (Distance < 50.0f)       // 5m
        return OriginalTriangles;  // 100% 디테일

    else if (Distance < 150.0f)  // 15m
        return OriginalTriangles / 10;  // 10% 디테일

    else if (Distance < 500.0f)  // 50m
        return OriginalTriangles / 100;  // 1% 디테일

    else
        return 0;  // Far Field TLAS 사용
}
```

### 3. **애니메이션 오브젝트 처리**

```cpp
// ✅ 올바른 방법
AnimatedTree->bRayTracingAnimated = false;  // RT에서는 정적
AnimatedTree->RayTracingProxyMesh = SimplifiedMesh;

// ❌ 나쁜 방법
AnimatedTree->bRayTracingAnimated = true;  // 매 프레임 BLAS 업데이트!
```

---

## 🔗 References

- **GDC Talk**: "The Witcher 4: Ray Tracing at 60 FPS" (에픽게임즈 코리아)
- **Official Docs**: [Ray Tracing in Unreal Engine](https://docs.unrealengine.com/5.6/en-US/ray-tracing/)
- **Source Code**: `Engine/Source/Runtime/Renderer/Private/RayTracing/RayTracingScene.cpp`
- **Paper**: "Efficient Ray Tracing for Open World Games" (SIGGRAPH 2024)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Hardware Ray Tracing Optimization (UE 5.6/5.7, The Witcher 4 Tech Demo)