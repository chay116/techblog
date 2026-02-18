---
title: "Nanite 테셀레이션 (Tessellation - Displacement)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 테셀레이션 (Tessellation - Displacement)

## 🧭 개요

Nanite는 **전통적 하드웨어 테셀레이션** 대신 **Displacement 기반 프로그래밍 가능 테셀레이션**을 지원합니다.

### 핵심 개념

**"Compute Shader 기반 버텍스 변형"**

- WPO (World Position Offset) 제한적 지원
- PDO (Pixel Depth Offset) 지원
- 프로그래밍 가능 Displacement
- 빌드 타임 베이킹 (실험적)

---

## 🎯 설계 철학

### 왜 하드웨어 테셀레이션을 지원하지 않나?

**Brian Karis (2021 발표):** "전통적 테셀레이션은 GPU-Driven 파이프라인과 호환되지 않습니다. Nanite는 대신 **프로그래밍 가능한 Displacement**를 제공합니다."

#### 하드웨어 Tessellation vs Nanite Displacement

| 특성 | 하드웨어 Tessellation | Nanite Displacement |
|------|----------------------|---------------------|
| **파이프라인** | Fixed-function (Hull/Domain) | **Compute Shader** |
| **LOD 제어** | Distance-based (단순) | **화면 크기 기반** (정밀) |
| **GPU-Driven** | 불가능 (CPU 설정 필요) | **완전 GPU-Driven** |
| **Visibility Buffer** | 비호환 | **호환** |
| **유연성** | 제한적 | **완전 프로그래밍 가능** |

---

## 🧱 지원 기능

### 1. Pixel Depth Offset (PDO)

**지원됨** - 픽셀 셰이더에서 Depth 조정

```hlsl
// Material Pixel Shader
MaterialPixelParameters.PixelDepthOffset = DisplacementMap.Sample(...).r * DisplacementScale;
```

**사용 사례:**
- Parallax Occlusion Mapping
- Detail Normal Mapping
- 작은 규모의 디테일 추가

### 2. World Position Offset (WPO)

**제한적 지원** - 정적 메시에만 빌드 타임 베이킹

```cpp
// Material에서 WPO 사용
FMaterialOutput Output;
Output.WorldPositionOffset = DisplacementVector;

// Nanite 빌드 시 베이킹됨
→ 런타임에는 고정된 버텍스 위치
```

**제한 사항:**
- 애니메이션된 WPO 불가 (풀, 깃발 등)
- 런타임 변형 불가
- UE 5.6에서 실험적 지원

### 3. Programmable Displacement (실험적)

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteTessellation.ush` (실험적)

```hlsl
// Compute Shader 기반 Displacement
[numthreads(64, 1, 1)]
void DisplaceVertices(uint VertexID : SV_DispatchThreadID)
{
    // 버텍스 로드
    FVertex Vertex = LoadVertex(VertexID);

    // Displacement 계산
    float DisplacementHeight = DisplacementTexture.SampleLevel(Sampler, Vertex.UV, 0).r;
    float3 DisplacementVector = Vertex.Normal * DisplacementHeight * DisplacementScale;

    // 버텍스 위치 업데이트
    Vertex.Position += DisplacementVector;

    // 저장
    StoreVertex(VertexID, Vertex);
}
```

---

## ⚠️ 현재 제약사항

### ❌ 지원하지 않는 기능

**📂 소스:** `Engine/Shaders/Shared/NaniteDefinitions.h:227-237`

```cpp
#define NANITE_MATERIAL_FLAG_WORLD_POSITION_OFFSET    0x1   // 제한적
#define NANITE_MATERIAL_FLAG_PIXEL_DEPTH_OFFSET       0x2   // ✅ 지원
#define NANITE_MATERIAL_FLAG_PIXEL_DISCARD            0x4   // 제한적
#define NANITE_MATERIAL_FLAG_DISPLACEMENT             0x8   // 실험적
#define NANITE_MATERIAL_FLAG_SPLINE_MESH              0x10  // ❌ 미지원
```

**미지원 항목:**
1. **애니메이션된 WPO** - 풀/깃발/물 표면 등
2. **스플라인 메시** - 도로/케이블 변형
3. **모프 타겟** - 캐릭터 표정 애니메이션
4. **스켈레탈 메시** (UE 5.6에서 실험적 지원)

---

## 🔄 대안 솔루션

### 애니메이션된 WPO 대체

```cpp
// ❌ Nanite에서 작동 안 함:
Material->WorldPositionOffset = WindAnimation;

// ✅ 대안 1: Non-Nanite 메시 사용
FoliageMesh->SetNaniteEnabled(false);

// ✅ 대안 2: GPU 시뮬레이션
NiagaraSystem->SpawnMeshParticles();  // GPU Particle System

// ✅ 대안 3: Vertex Animation Texture (VAT)
// - 애니메이션을 텍스처로 베이킹
// - 런타임에 텍스처에서 버텍스 위치 읽기
```

### 스켈레탈 메시 (UE 5.6)

```cpp
// UE 5.6 실험적 기능
SkeletalMesh->NaniteSettings.bEnabled = true;

// 제한 사항:
// - 최대 256개 본
// - 복잡한 스키닝 불가
// - 성능 오버헤드 있음
```

---

## 💡 최적화 팁

### ✅ 효율적인 Displacement 사용

```cpp
// ✅ 좋은 예: 빌드 타임 베이킹
Material->WorldPositionOffset = StaticDisplacement;
→ Nanite 빌드 시 베이킹됨

// ✅ 좋은 예: Pixel Depth Offset
Material->PixelDepthOffset = ParallaxMap;
→ 런타임 성능 영향 적음

// ❌ 나쁜 예: 동적 WPO
Material->WorldPositionOffset = AnimatedWind;
→ Nanite에서 작동 안 함 (fallback to regular mesh)
```

---

## 🔗 관련 문서

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Cluster.md](./Cluster.md) - 클러스터 생성 및 버텍스 데이터

---

> 🔄 Updated: 2025-11-03 — 초기 작성 (UE 5.6 기준)
