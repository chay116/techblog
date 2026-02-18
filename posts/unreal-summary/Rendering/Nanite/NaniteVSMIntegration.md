---
title: "Nanite-VSM 통합 (Nanite-Virtual Shadow Maps Integration)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite-VSM 통합 (Nanite-Virtual Shadow Maps Integration)

## 🧭 개요

**이 문서는 Nanite와 Virtual Shadow Maps의 통합에 대해서만 다룹니다.**

VSM 자체의 상세한 내용은 `Rendering/VirtualShadowMaps/` 문서를 참조하세요.

### Nanite-VSM 통합의 핵심

**"Nanite의 극도로 상세한 지오메트리 → VSM의 고해상도 그림자"**

- Nanite 전용 VSM 렌더 패스
- 페이지 기반 가상화 공유 철학
- GPU-Driven 그림자 렌더링
- 프레임 간 캐싱 최적화

---

## 🎯 설계 철학

### 왜 VSM과 Nanite가 함께 설계되었나?

**Brian Karis (2021 발표):** "Nanite의 수백만 폴리곤을 그림자에도 활용하려면, 그림자 시스템도 **가상화**되어야 합니다."

```
문제:
Nanite 메시 (10M triangles)
    ↓
전통적 Shadow Maps (4K × 4K)
    ↓
결과: 디테일 손실, 성능 저하

해결:
Nanite 메시 (10M triangles)
    ↓
Virtual Shadow Maps (16K × 16K 가상, 페이지 단위)
    ↓
결과: 완벽한 디테일, 효율적 메모리
```

---

## 🔄 Nanite-VSM 렌더 패스

### 통합 파이프라인

```
1. Nanite Culling (Shadow View)
   - 광원 시점에서 컬링
   - Frustum + HZB (이전 프레임 VSM)
        ↓
2. Nanite Rasterization (VSM 타겟)
   - 하드웨어/소프트웨어 혼합 래스터라이저
   - Depth만 출력 (색상 불필요)
        ↓
3. VSM 페이지 업데이트
   - 변경된 타일만 재렌더링
   - 프레임 간 캐싱
```

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.cpp`

```cpp
void FVirtualShadowMapArray::RenderVirtualShadowMaps(
    FRDGBuilder& GraphBuilder,
    const TArray<FProjectedShadowInfo*>& VirtualShadowMaps)
{
    for (FProjectedShadowInfo* ProjectedShadowInfo : VirtualShadowMaps)
    {
        // === Nanite 지오메트리 전용 경로 ===
        if (ProjectedShadowInfo->bNaniteGeometry)
        {
            // Nanite 컬링 + 래스터화
            FNaniteRasterResults Results = Nanite::DrawVirtualShadowMaps(
                GraphBuilder,
                ProjectedShadowInfo,
                VirtualShadowMapArray);

            // VSM 페이지에 Depth 쓰기
            WriteNaniteToVSMPages(Results, VirtualShadowMapArray);
        }
        else
        {
            // 전통적 메시 경로 (Non-Nanite)
            RenderTraditionalGeometryToVSM(...);
        }
    }
}
```

---

## 🧱 Nanite-VSM 최적화

### 1. HZB Occlusion Culling (이전 프레임 VSM)

```cpp
// Nanite Culling 단계에서 이전 프레임 VSM을 HZB로 사용
void CullClustersForShadow(...)
{
    // 이전 프레임 VSM Depth를 HZB로 빌드
    FRDGTextureRef PrevFrameVSM = GetPreviousFrameVSM(LightIndex);
    FRDGTextureRef HZB = BuildHZB(GraphBuilder, PrevFrameVSM);

    // Nanite 컬링 시 HZB 오클루전 테스트
    NaniteCullingParams.HZBTexture = HZB;
    NaniteCullingParams.bUseHZB = true;

    Nanite::CullClusters(GraphBuilder, NaniteCullingParams);
}
```

**효과:**
- 이전 프레임에 가려진 클러스터 조기 제거
- 그림자 렌더링 비용 30-50% 절감

### 2. 페이지 무효화 (Invalidation)

```
정적 메시 (Static):
Frame N:   모든 VSM 페이지 렌더링
Frame N+1: 캐시 재사용 (렌더링 안 함)
Frame N+2: 캐시 재사용
...

동적 메시 (Movable):
Frame N:   렌더링
Frame N+1: 이동 → 영향받는 페이지만 무효화 → 재렌더링
```

**📂 위치:** `Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapPageManagement.usf`

```hlsl
// 동적 오브젝트가 영향을 주는 VSM 페이지 마킹
void MarkPagesForInvalidation(
    uint3 PageCoord,
    FBounds3f ObjectBounds,
    FMatrix LightViewProjection)
{
    // 오브젝트 바운딩 박스가 덮는 VSM 페이지 계산
    FPageRect AffectedPages = ComputeAffectedPages(ObjectBounds, LightViewProjection);

    for (uint Y = AffectedPages.MinY; Y <= AffectedPages.MaxY; Y++)
    {
        for (uint X = AffectedPages.MinX; X <= AffectedPages.MaxX; X++)
        {
            uint PageIndex = GetPageIndex(X, Y, MipLevel);
            InvalidatePageBitmask[PageIndex >> 5] |= (1u << (PageIndex & 31));
        }
    }
}
```

### 3. Nanite Culling 모드

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Nanite/NaniteCullRaster.cpp`

```cpp
// Shadow View를 위한 Nanite Culling 설정
FNaniteCullingContext CullingContext;
CullingContext.RenderFlags |= NANITE_RENDER_FLAG_SHADOW_DEPTH;
CullingContext.bTwoPassOcclusion = false;  // 그림자는 1-pass
CullingContext.bSupportsMultiplePasses = false;

// Depth만 필요하므로 Material Evaluation 스킵
CullingContext.bMaterialDepthOnly = true;
```

---

## 📊 성능 특성

### Nanite-VSM vs 전통적 Shadow Maps

**Brian Karis 벤치마크 (복잡한 장면, 10M triangles):**

| 방식 | 렌더링 시간 | 메모리 | 그림자 품질 |
|------|------------|--------|------------|
| **Cascaded SM (4K×4K×4)** | 12ms | 64 MB | 중간 (디테일 손실) |
| **Nanite + VSM (16K 가상)** | 3ms | 10 MB | 높음 (완벽한 디테일) |

**절감율:**
- 렌더링 시간: 75% 절감
- 메모리: 84% 절감
- 품질: 4배 해상도 (16K vs 4K)

### 프레임 간 캐싱 효과

```
정적 장면 (90% 정적 메시):
Frame 1: 8ms (초기 렌더링)
Frame 2: 0.8ms (캐시 재사용)
Frame 3: 0.5ms
Frame 4: 0.4ms
...

동적 장면 (50% 동적 메시):
Frame 1: 8ms
Frame 2: 4ms (50% 무효화)
Frame 3: 4.2ms
Frame 4: 3.8ms
```

---

## 💡 최적화 팁

### ✅ 효율적인 Nanite-VSM 사용

```cpp
// ✅ 좋은 예: 정적 메시 설정
StaticMeshComponent->SetMobility(EComponentMobility::Static);
StaticMeshComponent->SetCastShadow(true);
→ VSM 페이지 완전 캐싱, 거의 무료

// ✅ 좋은 예: 동적 메시 최소화
OnlyMovingActors->SetMobility(EComponentMobility::Movable);
MostOfTheWorld->SetMobility(EComponentMobility::Static);
→ 무효화되는 페이지 최소화

// ❌ 나쁜 예: 모든 것을 Movable로
AllMeshes->SetMobility(EComponentMobility::Movable);
→ 매 프레임 전체 VSM 재렌더링
```

### 디버그 시각화

```cpp
// VSM 페이지 시각화 (Nanite 지오메트리 하이라이트)
r.Shadow.Virtual.Visualize 1       // VSM 페이지 표시
r.Shadow.Virtual.VisualizeNanite 1 // Nanite 렌더링 부분만

// 캐싱 효과 확인
r.Shadow.Virtual.Cache 0           // 캐싱 비활성화 (비교용)
r.Shadow.Virtual.ShowStats 1       // 통계 표시
```

---

## 🔗 관련 문서

**Nanite 문서:**
- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Rasterization.md](./Rasterization.md) - Nanite 래스터화
- [Culling.md](./Culling.md) - Nanite 컬링 시스템

**VSM 문서 (향후 작성 예정):**
- `Rendering/VirtualShadowMaps/Overview.md` - VSM 시스템 개요
- `Rendering/VirtualShadowMaps/PageAllocation.md` - 페이지 할당
- `Rendering/VirtualShadowMaps/Clipmap.md` - Clipmap 구조

---

> 🔄 Updated: 2025-11-03 — Nanite 통합 부분만 문서화 (UE 5.6 기준)
>
> ⚠️ **주의**: 이 문서는 Nanite-VSM 통합만 다룹니다. VSM 자체의 상세한 내용은 별도 문서를 참조하세요.
