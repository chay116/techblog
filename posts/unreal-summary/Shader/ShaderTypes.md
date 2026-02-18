---
title: "Shader 타입 계층 구조 (Shader Type Hierarchy)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Shader 타입 계층 구조 (Shader Type Hierarchy)

## 🧭 개요 (Overview)

Unreal Engine의 Shader 시스템은 **4단계 계층 구조**로 이루어져 있습니다. 각 계층은 명확한 책임 분리를 통해 다양한 렌더링 시나리오를 지원합니다.

**📂 위치:**
- `Engine/Source/Runtime/RenderCore/Public/Shader.h:54-800`
- `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h:85-119`
- `Engine/Source/Runtime/Renderer/Public/MaterialShader.h:54-136`
- `Engine/Source/Runtime/Renderer/Public/MeshMaterialShader.h:66-123`

---

## 🧱 계층별 상세 분석 (Hierarchical Analysis)

### 계층 1: FShader (기본 클래스)

**역할:** 모든 Shader의 추상 기본 클래스. 컴파일된 바이트코드와 Parameter 바인딩 정보를 관리합니다.

**핵심 멤버:**

```cpp
// Shader.h:54+
class FShader
{
private:
    // Parameter 바인딩 정보 (UniformBuffer, Texture, Sampler 위치)
    FShaderParameterMapInfo ParameterMapInfo;

    // 컴파일된 Shader 바이트코드 (플랫폼별로 다름)
    TRefCountPtr<FShaderCode> Code;

    // 이 Shader가 속한 ShaderMap 참조
    FShaderMapBase* ShaderMapResource;

public:
    // Shader 타입 정보 반환
    virtual FShaderType* GetType() const = 0;

    // VertexFactory 타입 (FMeshMaterialShader만 사용)
    virtual FVertexFactoryType* GetVertexFactoryType() const = 0;

    // 고유 ID (Permutation 식별용)
    FShaderId GetResourceId() const;
};
```

**제공 기능:**
- **바이트코드 관리**: 플랫폼별 컴파일된 Shader 저장
- **Parameter 바인딩**: CPU → GPU 데이터 전송 정보
- **ShaderMap 연결**: 어느 ShaderMap에 속하는지 추적

---

### 계층 2-A: FGlobalShader (싱글톤 Shader)

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h:85-119`

**역할:** Material이나 Vertex Factory 없이 동작하는 **싱글톤 Shader**입니다.

```cpp
// GlobalShader.h:85-92
class FGlobalShaderType : public FShaderType
{
    // Material 없음, VertexFactory 없음
    // 플랫폼당 단일 인스턴스
};
```

**사용 사례:**
- **PostProcess Shader**: ToneMapping, Bloom, MotionBlur
- **Compute Shader**: GPU Particle Update, Culling
- **Screen Quad Shader**: FullScreen Pass

**특징:**
- ✅ **빠른 로딩**: 엔진 시작 시 자동 로드
- ✅ **적은 Permutation**: ~수십 개
- ❌ **Material 없음**: Material Parameter 사용 불가

---

### 계층 2-B: FMaterialShader (Material 연결 Shader)

**📂 위치:** `Engine/Source/Runtime/Renderer/Public/MaterialShader.h:54-136`

**역할:** **Material**과 연결된 Shader. Material Editor 노드를 HLSL로 변환하여 사용합니다.

```cpp
// MaterialShader.h:54-59
class FMaterialShader : public FShader
{
private:
    // Material Uniform Buffer (Material 파라미터: Texture, Scalar 등)
    FShaderUniformBufferParameter MaterialUniformBuffer;

    // Parameter Collection (전역 Material 파라미터)
    TMemoryImageArray<FShaderUniformBufferParameter> ParameterCollectionUniformBuffers;

public:
    void SetParameters(
        FRHIBatchedShaderParameters& BatchedParameters,
        const FMaterialRenderProxy* MaterialRenderProxy,
        const FMaterial& Material,
        const FSceneView& View
    );
};
```

**차이점: FGlobalShader vs FMaterialShader**

| 항목               | FGlobalShader              | FMaterialShader            |
|-------------------|---------------------------|---------------------------|
| **Material 연결**  | ❌ 없음                   | ✅ 있음                   |
| **인스턴스**       | 싱글톤 (플랫폼당 1개)      | Material마다 별도         |
| **Permutation 수** | 적음 (~수십 개)           | 많음 (~수천 개)           |
| **사용 예**        | PostProcess, Compute      | Deferred Shading, Forward |
| **ShaderMap 타입** | FGlobalShaderMap          | FMaterialShaderMap        |
| **로드 시점**      | 엔진 시작                 | Material 사용 시          |

---

### 계층 3: FMeshMaterialShader (Mesh + Material Shader)

**📂 위치:** `Engine/Source/Runtime/Renderer/Public/MeshMaterialShader.h:66-123`

**역할:** **Material + Vertex Factory** 조합. 실제 메시 렌더링의 대부분을 담당합니다.

```cpp
// MeshMaterialShader.h:66-123
class FMeshMaterialShader : public FMaterialShader
{
private:
    // Vertex Factory Parameters (버텍스 레이아웃 정보)
    TMemoryImagePtr<FVertexFactoryShaderParameters> VertexFactoryParameters;

    // Pass Uniform Buffer (Pass별 공통 파라미터: View, SceneTextures 등)
    FShaderUniformBufferParameter PassUniformBuffer;

public:
    void GetElementShaderBindings(
        const FScene* Scene,
        const FVertexFactory* VertexFactory,
        const FMeshBatch& MeshBatch,
        FMeshDrawSingleShaderBindings& ShaderBindings,
        FVertexInputStreamArray& VertexStreams
    ) const;
};
```

**Permutation 계산:**

FMeshMaterialShader는 **Material × VertexFactory**로 Permutation이 생성됩니다.

```
Material Permutation: 100개
VertexFactory 타입: 10개 (Local, GPUSkin, Niagara, Landscape 등)
───────────────────────────────────────────
총 Permutation 수: 100 × 10 = 1,000개
```

**소스 검증:**

```cpp
// MeshMaterialShader.h:31-40
struct FMeshMaterialShaderPermutationParameters : public FMaterialShaderPermutationParameters
{
    // VertexFactory 타입 포함 - Material + VF 조합마다 별도 Permutation
    const FVertexFactoryType* VertexFactoryType;
};
```

---

## 💡 실전 예시 (Practical Examples)

### 예시 1: PostProcess Shader (FGlobalShader)

```cpp
// ToneMapping Shader 정의
class FPostProcessTonemapPS : public FGlobalShader
{
    DECLARE_SHADER_TYPE(FPostProcessTonemapPS, Global);

public:
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
    {
        return true;  // 모든 플랫폼에서 컴파일
    }

    static void ModifyCompilationEnvironment(
        const FGlobalShaderPermutationParameters& Parameters,
        FShaderCompilerEnvironment& OutEnvironment
    )
    {
        FGlobalShader::ModifyCompilationEnvironment(Parameters, OutEnvironment);
        OutEnvironment.SetDefine(TEXT("USE_BLOOM"), 1);
    }
};

IMPLEMENT_SHADER_TYPE(, FPostProcessTonemapPS, TEXT("/Engine/Private/PostProcessTonemap.usf"), TEXT("MainPS"), SF_Pixel);
```

**사용:**
```cpp
// Render Graph에서 사용
TShaderMapRef<FPostProcessTonemapPS> PixelShader(View.ShaderMap);
GraphBuilder.AddPass(
    RDG_EVENT_NAME("Tonemap"),
    PixelShader,
    [PixelShader](FRHICommandList& RHICmdList)
    {
        SetShaderParameters(RHICmdList, PixelShader, ...);
        DrawFullscreenQuad(RHICmdList);
    }
);
```

---

### 예시 2: Material Shader (FMaterialShader)

```cpp
// Deferred Decal Shader
class FDeferredDecalPS : public FMaterialShader
{
    DECLARE_SHADER_TYPE(FDeferredDecalPS, Material);

public:
    static bool ShouldCompilePermutation(const FMaterialShaderPermutationParameters& Parameters)
    {
        // Decal Material만 컴파일
        return Parameters.MaterialParameters.MaterialDomain == MD_DeferredDecal;
    }
};
```

---

### 예시 3: Mesh Material Shader (FMeshMaterialShader)

```cpp
// BasePass Vertex Shader
class TBasePassVS : public FMeshMaterialShader
{
    DECLARE_SHADER_TYPE(TBasePassVS, MeshMaterial);

public:
    static bool ShouldCompilePermutation(const FMeshMaterialShaderPermutationParameters& Parameters)
    {
        // StaticMesh와 SkeletalMesh만 지원
        return Parameters.VertexFactoryType->GetFName() == TEXT("FLocalVertexFactory") ||
               Parameters.VertexFactoryType->GetFName() == TEXT("FGPUSkinVertexFactory");
    }
};
```

**내부 동작:**

```
Material: M_Character
VertexFactory: FGPUSkinVertexFactory (SkeletalMesh)
───────────────────────────────────────────────────
생성되는 Shader:
- TBasePassVS<M_Character, FGPUSkinVertexFactory>
- TBasePassPS<M_Character, FGPUSkinVertexFactory>
```

---

## 🔗 참고 자료 (References)

### 소스 코드
- `Engine/Source/Runtime/RenderCore/Public/Shader.h` - FShader 기본 클래스
- `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h` - FGlobalShader
- `Engine/Source/Runtime/Renderer/Public/MaterialShader.h` - FMaterialShader
- `Engine/Source/Runtime/Renderer/Public/MeshMaterialShader.h` - FMeshMaterialShader

### 커뮤니티 자료
- [Shader 타입과 Uber Shader](https://scahp.tistory.com/m/78) - FShaderType, Permutation 시스템

---

> 🔄 **작성일**: 2025-01-04
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.6 Release
