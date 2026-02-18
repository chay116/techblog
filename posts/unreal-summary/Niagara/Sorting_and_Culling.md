---
title: "Sorting and Culling (정렬 및 컬링)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Sorting and Culling (정렬 및 컬링)

## 🧭 개요

Niagara의 Sorting/Culling 시스템은 **렌더링 성능 최적화**를 위해 파티클을 정렬하고 불필요한 파티클을 제거합니다.

**핵심 개념:**
- **GPU Sorting**: Bitonic Sort, Radix Sort
- **CPU Sorting**: std::sort 기반
- **Distance Culling**: 카메라에서 먼 파티클 제거
- **Frustum Culling**: 화면 밖 파티클 제거

---

## 🧱 주요 기능

### 1. **Sorting (정렬)**

**Sort Methods:**
- **None**: 정렬 안 함
- **View Depth**: 카메라 거리 기준 (Back-to-Front / Front-to-Back)
- **Custom Ascending/Descending**: 사용자 정의 Attribute 기반

**GPU Sorting:**
```cpp
// Renderer Settings
SortMode = ViewDepth
bSortOnlyWhenTranslucent = true

// GPU에서 자동으로 Bitonic Sort 실행
// - O(N log^2 N) 복잡도
// - 병렬 처리
```

### 2. **Culling (컬링)**

**Culling Types:**
- **Distance Culling**: `CullDistance` 이상 제거
- **Frustum Culling**: 화면 밖 제거 (자동)
- **Custom Culling**: Script에서 `Kill Particle`

**Distance Culling:**
```cpp
// Component Settings
UNiagaraComponent* NC;
NC->SetCullDistance(5000.0f);  // 50m 이상 제거
```

---

## 💡 주요 사용 사례

### 예시 1: Translucent Particles 정렬

```cpp
// Sprite Renderer
SortMode = ViewDepth
SortOrderHint = BackToFront  // 반투명 올바른 블렌딩
```

### 예시 2: Opaque Particles (정렬 불필요)

```cpp
// Mesh Renderer (Opaque)
SortMode = None  // Depth Buffer 사용, 정렬 불필요
```

### 예시 3: Custom Attribute Sorting

```cpp
// Priority 기반 정렬
SortMode = CustomAscending
CustomSortBinding = "Particles.Priority"

// Priority 높은 파티클이 먼저 렌더링
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. 불필요한 정렬:**
```cpp
// ❌ Opaque Mesh에 정렬 (성능 낭비)
SortMode = ViewDepth  // Depth Buffer가 알아서 처리함
```

**2. 과도한 Sorting Frequency:**
```cpp
// ❌ 매 프레임 정렬 (비싼 연산)
// Translucent가 아니면 불필요
```

### ✅ 올바른 방법

**1. 필요한 경우에만 정렬:**
```cpp
// ✅ Translucent만 정렬
bSortOnlyWhenTranslucent = true
```

**2. 적절한 CullDistance:**
```cpp
// ✅ 보이지 않는 거리에서 컬링
SetCullDistance(ViewDistance * 0.8);
```

---

## 🔗 참조 자료

**소스 파일:**
- `NiagaraRenderer.cpp` (Sorting 로직)
- `NiagaraGPUSort.cpp` (GPU Sorting 구현)

**관련 문서:**
- [Rendering_Overview.md](Rendering_Overview.md) - 렌더링 파이프라인

---

> 🔄 작성: 2025-11-22 — Niagara Sorting/Culling 개요
