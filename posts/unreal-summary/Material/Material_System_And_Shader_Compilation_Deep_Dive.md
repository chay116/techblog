---
title: "Material System & Shader Compilation Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Material"
tags: ["unreal", "Material"]
engine_version: "Unreal Engine 5.7"
---
# Material System & Shader Compilation Deep Dive

## 🧭 개요 (Overview)

**Material System**은 비주얼 노드 기반 Shader 제작 시스템으로, Material Graph → HLSL → Platform Shader (DXIL/SPIR-V/MetalIR)로 변환됩니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Material Graph** | 노드 기반 Shader 편집 (UMaterialExpression) |
| **HLSL Translation** | Material Graph → HLSL 코드 생성 |
| **Shader Compilation** | HLSL → Platform Binary (DXC/FXC) |
| **Material Instance** | Base Material의 Parameter Override |
| **Shader Permutation** | Feature 조합별 Shader Variant (수천~수만 개) |

---

## 🏗️ Material Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│          Phase 1: Material Graph (Editor)                   │
├─────────────────────────────────────────────────────────────┤
│  Material Editor:                                           │
│    - Nodes: Add, Multiply, TextureSample, etc.             │
│    - Connections: 노드 간 Wire 연결                        │
│    - Output Pins: Base Color, Roughness, Normal, etc.      │
│                                                             │
│  저장 형식: UMaterial (UAsset)                             │
└──────────────────────┼───────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│       Phase 2: HLSL Code Generation (Cook Time)             │
├─────────────────────────────────────────────────────────────┤
│  FHLSLMaterialTranslator::Translate():                      │
│    - Material Graph Traversal (Depth-First)                │
│    - HLSL 코드 생성 (Template 기반)                        │
│                                                             │
│  예시 Output (Generated HLSL):                             │
│    float3 BaseColor = Texture2DSample(DiffuseTexture, UV); │
│    float Roughness = 0.5;                                  │
│    MaterialFloat3 GetMaterialBaseColor() { return BaseColor; }│
└──────────────────────┼───────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│        Phase 3: Shader Compilation (Platform)               │
├─────────────────────────────────────────────────────────────┤
│  Shader Compiler (Per Platform):                           │
│    - DXC (DirectX 12): HLSL → DXIL                         │
│    - FXC (DirectX 11): HLSL → DXBC                         │
│    - DXC + SPIRV: HLSL → SPIR-V (Vulkan)                   │
│    - Metal Compiler: HLSL → MetalSL → MetalIR              │
│                                                             │
│  결과: FShaderResource (Compiled Bytecode)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 📐 Shader Permutations

**문제:** Material은 수많은 Feature 조합을 지원해야 함

**예시 Feature:**
- Forward/Deferred Shading
- Static/Skeletal Mesh
- Lightmap Yes/No
- CSM Shadow Yes/No
- Virtual Texture Yes/No
- Nanite Yes/No

**Permutation 폭발:**
```
2^6 = 64 Permutations (Base)
× Quality Levels (Low/Medium/High/Epic) = 256
× Platforms (Windows/PS5/Xbox/Mobile) = 1,024+

실제로는 수만 개!
```

**최적화 - Shader Permutation Reduction:**

```cpp
// Material에서 사용 안 하는 Feature는 Permutation 제외
bool ShouldCompilePermutation(const FMaterialShaderPermutationParameters& Parameters)
{
    if (!Material->bUsesLightmaps && Parameters.bUseLightmap)
    {
        return false;  // 🔑 불필요한 Permutation 제거
    }
    return true;
}
```

---

## 🎨 Material Instance

**문제:** Base Material 변경 시 전체 재컴파일 (느림)

**해결:** Material Instance (Parameter Override만)

```cpp
// Base Material
UMaterial* BaseMat = LoadObject<UMaterial>(...);

// Material Instance (빠른 생성)
UMaterialInstanceDynamic* MatInst = UMaterialInstanceDynamic::Create(BaseMat, this);

// Parameter Override (Shader 재컴파일 없음!)
MatInst->SetVectorParameterValue("BaseColor", FLinearColor::Red);
MatInst->SetScalarParameterValue("Roughness", 0.8f);
MatInst->SetTextureParameterValue("DiffuseTexture", MyTexture);
```

**런타임 성능:**
- Base Material 변경: ~10초 (Shader 재컴파일)
- Material Instance Parameter: ~0.001ms (즉각 반영)

---

## ⚡ HLSL Code Generation 예시

### Material Graph:

```
TextureSample (DiffuseTex, UV0)
    ↓
Multiply (RGB, Color)
    ↓
Output: Base Color
```

### Generated HLSL:

```hlsl
// Material Template Code
MaterialFloat3 GetMaterialBaseColor(FMaterialPixelParameters Parameters)
{
    // Node: TextureSample
    MaterialFloat3 Local0 = Texture2DSample(
        Material_Texture2D_0,      // DiffuseTex
        Material_Texture2D_0Sampler,
        Parameters.TexCoords[0].xy // UV0
    ).rgb;

    // Node: Multiply
    MaterialFloat3 Local1 = Local0 * Material.VectorParameter_0.rgb;  // Color

    // Output
    return Local1;
}
```

---

## 🚀 최적화

### 1. Shader Complexity

**✅ 간단한 Material:**
```
Instructions: 50
Texture Samples: 2
```

**❌ 복잡한 Material:**
```
Instructions: 500+  // 🚫 너무 많음!
Texture Samples: 10+
```

**측정:** Material Editor → Stats → Shader Complexity

### 2. Static Switch (Permutation 줄이기)

```cpp
// Bad: 모든 Permutation에서 분기
if (bUseDetailTexture)
{
    Color *= DetailTexture.Sample(...);
}

// Good: Permutation 분리 (Static Switch)
#if USE_DETAIL_TEXTURE
    Color *= DetailTexture.Sample(...);
#endif
```

---

## 🔗 참고 자료

**소스 파일:**
- `Engine/Public/Materials/Material.h` - UMaterial
- `Engine/Public/Materials/MaterialInstance.h` - UMaterialInstance
- `ShaderCompiler/Public/ShaderCompiler.h` - Shader Compilation

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Material System
  - Material Graph → HLSL → Platform Shader
  - Shader Permutations
  - Material Instance (Dynamic Parameter Override)
  - HLSL Code Generation 예시