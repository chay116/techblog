---
title: "Material 시스템 (Material System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Material 시스템 (Material System)

## 🧭 개요 (Overview)

Unreal Engine의 **Material 시스템**은 **아티스트 친화적인 노드 기반 인터페이스**를 통해 복잡한 Shader를 생성합니다. Material Editor에서 만든 노드 그래프는 자동으로 **HLSL 코드**로 변환되어 컴파일됩니다.

**📂 위치:**
- `Engine/Source/Runtime/Engine/Public/Materials/Material.h`
- `Engine/Source/Runtime/Engine/Private/Materials/MaterialShared.cpp`

---

## 🧱 Material → Shader 변환 과정

```
┌──────────────────────┐
│  Material Editor     │
│  (노드 그래프)        │
├──────────────────────┤
│ [Texture Sample]     │
│        ↓             │
│ [Multiply] ← [Scalar]│
│        ↓             │
│ [BaseColor]          │
└──────────┬───────────┘
           ↓
┌──────────────────────────────────────┐
│  MaterialTemplate.ush 생성            │
│                                      │
│  float3 GetMaterialBaseColor(...)    │
│  {                                   │
│      float3 Tex = Sample(...);       │
│      return Tex * Scalar;            │
│  }                                   │
└──────────┬───────────────────────────┘
           ↓
┌──────────────────────────────────────┐
│  Shader Compiler                     │
│  → BasePassPixelShader.usf           │
│  #include "MaterialTemplate.ush"     │
└──────────┬───────────────────────────┘
           ↓
      Compiled Shader
```

---

## 💡 주요 Material 속성

| 속성                  | 설명                                    | Shader 영향                    |
|----------------------|----------------------------------------|--------------------------------|
| **Shading Model**    | Lit, Unlit, Subsurface 등              | MATERIAL_SHADINGMODEL_* 매크로  |
| **Blend Mode**       | Opaque, Masked, Translucent 등         | BLEND_* 매크로                 |
| **Material Domain**  | Surface, PostProcess, Decal 등         | Shader 타입 결정                |
| **Two Sided**        | 양면 렌더링 여부                        | Backface Culling 제어           |

---

## 🔗 참고 자료 (References)

### 공식 문서
- [Material Editor User Guide](https://docs.unrealengine.com/5.6/en-US/unreal-engine-material-editor-user-guide/)

### 커뮤니티 자료
- [Material 시스템과 Shader](https://mathmakeworld.tistory.com/30) - Material Editor → HLSL 변환 과정
- [Material 컴파일 과정](https://scahp.tistory.com/79) - Uniform Buffer, Expression 처리

### 소스 코드
- `Engine/Source/Runtime/Engine/Public/Materials/Material.h`
- `Engine/Shaders/Private/MaterialTemplate.ush`

---

> 🔄 **작성일**: 2025-01-04
> 📝 **문서 버전**: v1.0 (간략 버전)
> ✅ **소스 검증**: UE 5.6 Release
