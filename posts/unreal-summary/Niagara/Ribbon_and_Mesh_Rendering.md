---
title: "Ribbon and Mesh Rendering (리본 및 메시 렌더링)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Ribbon and Mesh Rendering (리본 및 메시 렌더링)

## 🧭 개요

Niagara의 Ribbon/Mesh Renderer는 **Sprite 이외의 복잡한 형태**를 렌더링합니다.

**핵심 개념:**
- **Ribbon**: 연결된 파티클로 Trail/Beam 생성
- **Mesh**: Static Mesh를 각 파티클에 배치
- **Orientation**: 파티클의 방향/회전 제어

---

## 🧱 주요 렌더러

### 1. **Ribbon Renderer**

**특징:**
- 파티클을 순서대로 연결하여 리본 생성
- UV 좌표 자동 생성
- Width/Twist 제어

**주요 설정:**
```cpp
// Ribbon Shape
FacingMode = Screen  // 카메라를 향함
UV0Settings.TilingDistance = 100.0  // UV Tiling

// Width Control
RibbonWidthMode = FromFirst/Last/Average
WidthBinding = "Particles.RibbonWidth"
```

**사용 사례:**
- Laser Beam
- Sword Trail
- Lightning

### 2. **Mesh Renderer**

**특징:**
- Static Mesh를 각 파티클에 인스턴싱
- GPU Instancing으로 성능 최적화
- Mesh Orientation 제어

**주요 설정:**
```cpp
// Mesh Selection
Meshes = [StaticMesh1, StaticMesh2, ...]
MeshSelectionMode = Random/Sequential

// Orientation
FacingMode = Velocity/CustomAxis
VelocityBinding = "Particles.Velocity"

// Scale
ScaleBinding = "Particles.Scale"
```

**사용 사례:**
- Debris Particles
- Instanced Foliage
- Procedural Placement

---

## 💡 주요 사용 사례

### 예시 1: Trail Effect (Ribbon)

```cpp
// Ribbon Renderer
FacingMode = Screen
RibbonLinkOrder = RibbonLinkOrderParticleID
CurveTension = 0.5  // 부드러운 곡선

// Trail을 위한 Particle 설정
SpawnRate = 100  // 초당 100개
Lifetime = 1.0   // 1초 지속

// 결과: 1초 동안 이어지는 Trail
```

### 예시 2: Instanced Mesh Particles

```cpp
// Mesh Renderer
Meshes = [RockMesh1, RockMesh2, RockMesh3]
MeshSelectionMode = Random

// Orientation to Velocity
FacingMode = Velocity
VelocityAxisBinding = "Particles.Velocity"

// Random Scale
ScaleBinding = "Particles.MeshScale"
// (Spawn Script에서 MeshScale = Random(0.5, 2.0))
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. 과도한 Ribbon Segments:**
```cpp
// ❌ 너무 많은 파티클 → 폴리곤 폭발
SpawnRate = 10000  // Ribbon이 너무 조밀!
```

**2. 복잡한 Mesh:**
```cpp
// ❌ 고폴리곤 Mesh를 수천 개 인스턴싱
Mesh = HighPolyStatue (10,000 triangles)
Particles = 1000
// → 10,000,000 triangles! GPU 과부하!
```

### ✅ 올바른 방법

**1. 적절한 Segment 밀도:**
```cpp
// ✅ Ribbon 품질과 성능 균형
SpawnRate = 50  // 충분히 부드러움
```

**2. LOD Mesh 사용:**
```cpp
// ✅ 저폴리곤 Mesh
Mesh = SimplifiedRock (100 triangles)
Particles = 1000
// → 100,000 triangles (관리 가능)
```

---

## 🔗 참조 자료

**소스 파일:**
- `NiagaraRendererRibbons.cpp`
- `NiagaraRendererMeshes.cpp`

**관련 문서:**
- [Rendering_Overview.md](Rendering_Overview.md)

---

> 🔄 작성: 2025-11-22 — Ribbon/Mesh Renderer 개요
