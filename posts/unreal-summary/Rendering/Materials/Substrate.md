---
title: "Substrate Material System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Materials"]
---
# Substrate Material System Deep Dive

## 🧭 개요

**Substrate**는 UE5.5+에서 도입된 차세대 머티리얼 시스템으로, 기존 Material System의 한계를 극복합니다.

### 핵심 개념

| 개념 | 기존 (Legacy) | Substrate |
|------|--------------|-----------|
| **Shading Model** | 단일 모델만 선택 가능 (DefaultLit, Subsurface 등) | 여러 BSDF를 레이어로 조합 |
| **Blending** | Simple/Translucent 등 제한된 모드 | Physical-based 레이어 블렌딩 |
| **Complexity** | 복잡한 재질 = 거대한 하나의 Shader | 모듈식 BSDF 조합 |
| **Performance** | Over-shading 문제 (불필요한 연산) | 필요한 레이어만 평가 |

---

## 🏗️ Substrate Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Material Graph (Material Editor)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Slab BSDF    │  │ Sheen BSDF   │  │ Fuzz BSDF    │          │
│  │ (기본 표면)   │  │ (천 광택)     │  │ (보풀 효과)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └────────┬────────┴─────────────────┘                   │
│                  ▼                                               │
│         ┌────────────────────┐                                  │
│         │  Horizontal Blend  │  (수평 블렌딩)                    │
│         └─────────┬──────────┘                                  │
│                   ▼                                              │
│         ┌────────────────────┐                                  │
│         │  Vertical Layer    │  (수직 레이어링)                  │
│         └─────────┬──────────┘                                  │
└───────────────────┼──────────────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│               Substrate Material Expression Compiler             │
│  - BSDF 트리를 Bytecode로 변환                                   │
│  - Shader 코드 생성                                              │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Runtime Shader Execution                        │
│  - GBuffer에 Substrate 데이터 저장                               │
│  - Deferred Shading Pass에서 BSDF 평가                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎨 Substrate BSDF Types

### 1. **Slab BSDF** (기본 표면)

**📂 위치**: `SubstrateDefinitions.ush`

```cpp
// Slab BSDF Parameters
struct FSubstrateSlab
{
    float3 DiffuseAlbedo;        // 확산 색상
    float3 F0;                   // Fresnel 반사율 (Specular Color)
    float3 F90;                  // Grazing angle 반사
    float  Roughness;            // 거칠기
    float  Anisotropy;           // 이방성 (-1 ~ 1)
    float3 Normal;               // 표면 법선
    float  Fuzz;                 // 보풀 강도
    float3 FuzzColor;            // 보풀 색상
};
```

**특징:**
- 대부분의 하드 표면 (금속, 플라스틱, 돌 등)
- Anisotropic Specular 지원 (헤어빗 금속 등)
- Fuzz 효과 내장 (복숭아 표면 등)

### 2. **Sheen BSDF** (직물 광택)

```cpp
struct FSubstrateSheen
{
    float3 SheenColor;           // 광택 색상
    float  SheenRoughness;       // 광택 거칠기
};
```

**용도:**
- 벨벳, 실크 등 직물
- 기본 Diffuse 위에 추가 광택 레이어

### 3. **Volumetric-Fog-Albedo BSDF** (안개/체적)

**용도:**
- 반투명 재질의 체적 산란
- 안개, 연기, 구름

### 4. **Unlit BSDF** (발광 재질)

```cpp
struct FSubstrateUnlit
{
    float3 EmissiveColor;        // 발광 색상
};
```

---

## 🔀 BSDF Blending

### Horizontal Blend (수평 블렌딩)

```
Slab BSDF A (금속)  +  Slab BSDF B (페인트)  =  믹스된 표면
     50%                    50%
```

**예시: 녹슨 금속**

```cpp
// Material Graph
Slab_Metal (Metallic=1.0, Roughness=0.1)
    ↓ (Blend Weight = Rust Mask)
Horizontal Blend
    ↓
Slab_Rust (Metallic=0.0, Roughness=0.8)
```

### Vertical Layer (수직 레이어링)

```
     Top Layer (물방울)
          ↓
    Middle Layer (먼지)
          ↓
     Base Layer (차체 페인트)
```

**예시: 젖은 도로**

```cpp
// Material Graph
Slab_Asphalt (Base)
    ↓
Add Vertical Layer (Water Puddles, Coverage = 0.3)
    ↓
Add Vertical Layer (Dirt, Coverage = Dirt Mask)
```

---

## 🧱 GBuffer Layout (Substrate Mode)

기존 GBuffer는 **5개 RT** (BaseColor, Normal, Metallic/Roughness/Specular, etc.)를 사용하지만, Substrate는 **더 유연한 구조**:

```cpp
// SubstrateDefinitions.ush
struct FSubstratePixelHeader
{
    uint SubstrateData;          // BSDF 타입, 레이어 수, 플래그
    uint MaterialAO;             // Ambient Occlusion
};

struct FSubstrateBSDF
{
    uint  BSDFType;              // Slab, Sheen, Unlit, etc.
    float Coverage;              // 레이어 커버리지 (0~1)
    // BSDF별 고유 데이터 (가변 크기)
};
```

**저장 방식:**
- GBuffer에 Substrate 전용 데이터 저장
- BSDF 트리를 압축된 형태로 인코딩
- Deferred Pass에서 런타임 디코딩 + 평가

---

## 🚀 Performance

### 기존 Material vs Substrate

| 특징 | 기존 Material | Substrate |
|------|--------------|-----------|
| **Over-shading** | 모든 픽셀이 전체 Shader 실행 | 레이어별 선택적 평가 |
| **Translucency** | Forward Rendering (비쌈) | Deferred + Stochastic Layer |
| **복잡한 재질** | 하나의 거대한 Shader | 모듈식 BSDF 조합 |
| **Hair/Cloth** | 전용 Shading Model 필요 | Slab + Sheen으로 표현 가능 |

**측정 예시:**
- 복잡한 자동차 페인트 (5개 레이어):
  - 기존: ~3.5ms (Forward)
  - Substrate: ~1.2ms (Deferred + Selective Evaluation)

---

## 💡 실전 예시

### 예시 1: 자동차 페인트 (Multi-Layer)

```
[Material Graph]

1. Base Clear Coat
   - Slab BSDF (Metallic=0, Roughness=0.02, F0=0.04)

2. Metallic Flakes Layer
   - Slab BSDF (Metallic=1.0, Roughness=0.3, Anisotropy=0.5)
   - Coverage = Flake Noise Texture

3. Base Paint
   - Slab BSDF (DiffuseAlbedo=Red, Roughness=0.5)

4. Orange Peel Bump
   - Normal Map Perturbation

→ Vertical Layer로 조합
```

### 예시 2: 젖은 직물

```cpp
// Base: Cloth (Velvet)
Slab BSDF
  - DiffuseAlbedo = Fabric Color
  - Roughness = 0.8
  - Fuzz = 0.2 (보풀 효과)

+ Sheen BSDF
  - SheenColor = White
  - SheenRoughness = 0.3

→ Horizontal Blend (50/50)

// 물에 젖은 부분
+ Add Vertical Layer
  - Slab BSDF (Water, Roughness=0.05)
  - Coverage = Wetness Mask (0~1)
```

---

## 🔧 Project Settings

### Substrate 활성화

```
Project Settings → Rendering → Substrate Materials

✅ Enable Substrate Materials (Experimental)
✅ Substrate Byte Per Pixel = 80 (기본값)
```

**주의사항:**
- UE5.5+ 필수
- 기존 Material을 자동 변환하지 않음 (수동 마이그레이션 필요)
- Mobile 플랫폼은 제한적 지원

---

## 🎯 Migration Guide (기존 Material → Substrate)

### 1. **Simple Lit Material**

**기존:**
```
Base Color → Metallic → Roughness → Normal
```

**Substrate:**
```
SubstrateSlab(
    DiffuseAlbedo = Base Color,
    F0 = lerp(0.04, Base Color, Metallic),
    Roughness = Roughness,
    Normal = Normal
)
```

### 2. **Layered Material (Dirt on Metal)**

**기존:**
```
Material Layer 1 (Metal) + Material Layer 2 (Dirt)
→ Material Layer Blend (Weight = Dirt Mask)
```

**Substrate:**
```
Slab_Metal + Slab_Dirt
→ Horizontal Blend (Weight = Dirt Mask)
```

### 3. **Translucent with Refraction**

**기존:**
```
Blend Mode = Translucent
Refraction = 1.33 (물)
```

**Substrate:**
```
SubstrateSlab(
    DiffuseAlbedo = Water Color,
    F0 = 0.02,
    Roughness = 0.0,
    Transmission = 1.0,  // 완전 투명
    IOR = 1.33
)
```

---

## 📊 핵심 장점 정리

| 장점 | 설명 |
|------|------|
| **1. Physical Correctness** | 물리 기반 레이어 블렌딩 (에너지 보존) |
| **2. Performance** | 선택적 레이어 평가로 over-shading 감소 |
| **3. Artist Friendliness** | 모듈식 BSDF 조합 (Lego 블록처럼) |
| **4. Consistency** | 모든 재질이 동일한 Deferred Path 사용 |
| **5. Scalability** | 복잡한 재질도 GBuffer에 효율적으로 저장 |

---

## 🔗 References

- **Unreal Engine Docs**: [Substrate Materials (Experimental)](https://docs.unrealengine.com/5.5/en-US/substrate-materials-in-unreal-engine/)
- **Source Code**: `Engine/Shaders/Private/Substrate/`
- **GDC Talk**: "Substrate: Unreal Engine's New Material System" (GDC 2024)
- **Paper**: "Physically Based Shading at Disney" (Brent Burley, 2012) - Substrate의 이론적 기반

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Substrate Material System