---
title: "Shader 시스템 개요 (Shader System Overview)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Shader 시스템 개요 (Shader System Overview)

## 🧭 개요 (Overview)

Unreal Engine의 Shader 시스템은 **크로스 플랫폼 GPU 프로그래밍**을 위한 핵심 인프라입니다. 이 시스템은 **단일 HLSL 소스**로부터 다양한 플랫폼(DirectX, Vulkan, Metal, PlayStation, Xbox 등)과 그래픽 API를 지원하는 셰이더를 자동 생성합니다.

**핵심 개념:**
- **Uber Shader 아키텍처**: 하나의 셰이더 소스에 모든 기능을 포함하고 매크로로 제어
- **Permutation (순열) 시스템**: 런타임에 필요한 셰이더 변형만 선택적으로 컴파일
- **계층적 Shader 클래스**: FShader → FGlobalShader / FMaterialShader → FMeshMaterialShader
- **Vertex Factory 추상화**: 다양한 메시 타입(Static, Skeletal, Particle 등)을 통일된 인터페이스로 처리
- **Material System 통합**: 아티스트 친화적인 노드 기반 인터페이스를 HLSL로 자동 변환

**📂 위치:**
- `Engine/Source/Runtime/RenderCore/Public/Shader.h` - FShader 기본 클래스
- `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h` - FGlobalShader
- `Engine/Source/Runtime/Renderer/Public/MaterialShader.h` - FMaterialShader
- `Engine/Source/Runtime/Renderer/Public/MeshMaterialShader.h` - FMeshMaterialShader
- `Engine/Shaders/` - `.usf` (Unreal Shader File) 소스 파일들

---

## 🧱 전체 아키텍처 (System Architecture)

### 계층적 Shader 클래스 구조 (Shader Class Hierarchy)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FShader                                    │
│  (모든 Shader의 기본 클래스)                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - ParameterMapInfo : FShaderParameterMapInfo  // Parameter 바인딩 정보│
│    - Code : TRefCountPtr<FShaderCode>            // 컴파일된 바이트코드  │
│                                                                         │
│  Public:                                                                │
│    + GetType() : FShaderType*                    // Shader 타입 반환    │
│    + GetVertexFactoryType() : FVertexFactoryType* // VF 타입 반환      │
│    + GetResourceId() : FShaderId                 // 고유 ID             │
└─────────────────────────────────────────────────────────────────────────┘
                    ▲                            ▲
                    │                            │
          ┌─────────┴────────┐        ┌──────────┴──────────┐
          │                  │        │                     │
┌─────────────────────┐  ┌────────────────────┐  ┌───────────────────────┐
│  FGlobalShader      │  │  FMaterialShader   │  │  기타 Shader 타입     │
│  (싱글톤 Shader)    │  │  (Material 연결)   │  │  - FNiagaraShader     │
│                     │  │                    │  │  - FOpenColorIOShader │
│  예시:              │  │  예시:             │  └───────────────────────┘
│  - PostProcess      │  │  - Deferred Shading│
│  - ScreenQuad       │  │  - Forward Shading │
│  - Compute Shader   │  │  (VertexFactory 없음)│
└─────────────────────┘  └──────────┬─────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  FMeshMaterialShader          │
                    │  (Material + VertexFactory)   │
                    │                               │
                    │  예시:                        │
                    │  - BasePass (Deferred)        │
                    │  - DepthOnly Pass            │
                    │  - ShadowDepth Pass          │
                    │  - VelocityPass              │
                    └───────────────────────────────┘
```

**소스 검증:**

```cpp
// Shader.h:89-116 - Permutation 정의
template<typename MetaShaderType>
struct TShaderTypePermutation
{
    MetaShaderType* const Type;
    const int32 PermutationId;

    TShaderTypePermutation(MetaShaderType* InType, int32 InPermutationId)
        : Type(InType), PermutationId(InPermutationId) {}
};
```

```cpp
// GlobalShader.h:85-92
class FGlobalShaderType : public FShaderType
{
    // 싱글톤 Shader - Material이나 Vertex Factory 없이 동작
    // 예: PostProcess, Compute Shader 등
};
```

```cpp
// MaterialShader.h:54-59
class FMaterialShader : public FShader
{
    using FPermutationParameters = FMaterialShaderPermutationParameters;
    using ShaderMetaType = FMaterialShaderType;
    // Material과 연결되지만 Vertex Factory 없음
};
```

```cpp
// MeshMaterialShader.h:66-71
class FMeshMaterialShader : public FMaterialShader
{
    using FPermutationParameters = FMeshMaterialShaderPermutationParameters;
    using ShaderMetaType = FMeshMaterialShaderType;
    // Material + Vertex Factory 조합
};
```

---

### Uber Shader 아키텍처 (Uber Shader Architecture)

Unreal Engine은 **Uber Shader 패턴**을 사용합니다. 이는 단일 셰이더 소스 파일에 모든 기능을 포함하고, 컴파일 타임 매크로로 기능을 활성화/비활성화하는 방식입니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     BasePassPixelShader.usf                              │
│  (단일 소스 파일 - 모든 Material 기능 포함)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  #if MATERIAL_SHADINGMODEL_SUBSURFACE                                  │
│      // Subsurface Scattering 코드                                      │
│  #endif                                                                 │
│                                                                         │
│  #if USE_NORMAL_MAP                                                    │
│      // Normal Mapping 코드                                            │
│  #endif                                                                 │
│                                                                         │
│  #if TRANSLUCENT_LIGHTING_VOLUMETRIC                                   │
│      // Volumetric Fog 코드                                            │
│  #endif                                                                 │
│                                                                         │
│  // ... 수백 개의 #if 분기 ...                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▼
                    [Shader Compiler - Permutation 생성]
                                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Permutation 0│  │ Permutation 1│  │ Permutation 2│  │ ... 수천 개  │
│              │  │              │  │              │  │              │
│ SSS=0        │  │ SSS=1        │  │ SSS=0        │  │              │
│ NormalMap=0  │  │ NormalMap=0  │  │ NormalMap=1  │  │              │
│ VolumetricFog=0 │ VolumetricFog=0│ VolumetricFog=0│  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

**장점:**
1. **단일 소스 관리**: 하나의 `.usf` 파일만 유지보수
2. **선택적 컴파일**: 필요한 기능 조합만 컴파일
3. **메모리 효율**: 사용되지 않는 Permutation은 로드하지 않음
4. **크로스 플랫폼**: 플랫폼별 분기도 매크로로 처리

**단점:**
1. **긴 컴파일 시간**: Permutation 수가 기하급수적으로 증가 (2^N)
2. **DDC 의존성**: Derived Data Cache가 없으면 매우 느림
3. **복잡한 디버깅**: 활성화된 매크로 조합을 파악해야 함

---

### Shader Permutation (순열) 시스템

**Permutation**은 동일한 셰이더 소스로부터 생성되는 **서로 다른 기능 조합**을 의미합니다.

#### Permutation 생성 과정

```
    Material Editor          Shader Compiler          Runtime
         │                         │                      │
         │  Material 노드 그래프    │                      │
         ├──────────────────────> │                      │
         │                         │  Permutation 계산    │
         │                         ├──────────────┐       │
         │                         │              │       │
         │                         │  예시:       │       │
         │                         │  - Lit       │       │
         │                         │  - Masked    │       │
         │                         │  - NormalMap │       │
         │                         │  → 특정      │       │
         │                         │    Permutation ID    │
         │                         │<─────────────┘       │
         │                         │                      │
         │                         │  HLSL 생성           │
         │                         │  #define MATERIAL_   │
         │                         │    SHADINGMODEL_..   │
         │                         ├──────────────────>   │
         │                         │                      │
         │                         │<─────────────────    │
         │                         │  컴파일된 바이트코드 │
         │                         │                      │
         │                         │  ShaderMap 저장      │
         │                         ├──────────────────>   │
```

**소스 검증:**

```cpp
// Shader.h:89-116
template<typename MetaShaderType>
struct TShaderTypePermutation
{
    MetaShaderType* const Type;
    const int32 PermutationId;  // 이 조합의 고유 ID

    FORCEINLINE bool operator==(const TShaderTypePermutation& Other) const
    {
        return Type == Other.Type && PermutationId == Other.PermutationId;
    }

    friend FORCEINLINE uint32 GetTypeHash(const TShaderTypePermutation& Var)
    {
        return HashCombine(GetTypeHash(Var.Type), (uint32)Var.PermutationId);
    }
};
```

#### Permutation ID 계산 예시

**예시: BasePass Material Shader**

| 기능               | 비트 위치 | 값 (0 또는 1) |
|-------------------|----------|--------------|
| **Lit Shading**   | Bit 0    | 1            |
| **Masked**        | Bit 1    | 0            |
| **Normal Map**    | Bit 2    | 1            |
| **Specular**      | Bit 3    | 1            |
| **Anisotropic**   | Bit 4    | 0            |

```
PermutationId = (1 << 0) | (0 << 1) | (1 << 2) | (1 << 3) | (0 << 4)
              = 1 + 0 + 4 + 8 + 0
              = 13
```

이 Material은 **Permutation 13**으로 컴파일됩니다.

---

### Shader Compilation Pipeline (컴파일 파이프라인)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Layer 1: Material Editor (Editor Only)                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────┐  ┌────────────────────────┐               │
│  │ Material 노드 그래프     │  │ Material Instance      │               │
│  │ - Texture Sample       │  │ - Parameter Override   │               │
│  │ - Math Operations      │  │ - Static Switch       │               │
│  │ - Custom Expression    │  └───────────┬────────────┘               │
│  └───────────┬────────────┘              │                            │
│              │                           │                            │
│              └─────────────┬─────────────┘                            │
│                            ↓                                          │
│                  [MaterialTemplate.ush 생성]                          │
└───────────────────────────┼──────────────────────────────────────────┘
                            ↓ 노드 → HLSL 변환
┌─────────────────────────────────────────────────────────────────────────┐
│                   Layer 2: Shader Compiler (UnrealBuildTool)            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │ ShaderCompileWorker.exe (병렬 프로세스)                   │          │
│  │                                                          │          │
│  │  1. Permutation 계산                                     │          │
│  │     → ShouldCompilePermutation()                        │          │
│  │                                                          │          │
│  │  2. Preprocessor 실행                                    │          │
│  │     → #include 확장, #define 처리                        │          │
│  │                                                          │          │
│  │  3. HLSL → Platform Bytecode                            │          │
│  │     → DXC (DirectX)                                     │          │
│  │     → glslang/spirv-cross (Vulkan)                      │          │
│  │     → Metal Compiler (Metal)                            │          │
│  │                                                          │          │
│  │  4. Reflection Data 생성                                 │          │
│  │     → Uniform Buffer 바인딩                             │          │
│  │     → Texture/Sampler 바인딩                            │          │
│  │     → Constant Buffer 레이아웃                           │          │
│  └──────────────────────────────────────────────────────────┘          │
└───────────────────────────┼──────────────────────────────────────────┘
                            ↓ Compiled Shader + Reflection
┌─────────────────────────────────────────────────────────────────────────┐
│                   Layer 3: ShaderMap Storage (Runtime)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │ FShaderMapBase                                           │          │
│  │  - TMap<FShaderType*, FShader*> Shaders                  │          │
│  │  - Permutation별로 저장                                   │          │
│  │                                                          │          │
│  │  [FGlobalShaderMap]                                      │          │
│  │  - 싱글톤 Global Shader들                                 │          │
│  │                                                          │          │
│  │  [FMaterialShaderMap]                                    │          │
│  │  - Material별로 관리                                      │          │
│  │  - VertexFactory별 Permutation 저장                       │          │
│  └──────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Vertex Factory 시스템

**Vertex Factory**는 **다양한 메시 타입**을 위한 **버텍스 데이터 추상화 레이어**입니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FVertexFactoryType                              │
│  (추상 인터페이스 - 버텍스 입력 정의)                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + GetStreamStrides() : FVertexStream[]    // 버텍스 스트림 정의      │
│    + ModifyCompilationEnvironment()          // Shader 컴파일 설정      │
│    + SupportsPrimitiveIdStream() : bool      // Primitive ID 지원 여부   │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ 상속
                ┌─────────────────┼─────────────────┐
                │                 │                 │
┌───────────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│ FLocalVertexFactory   │  │ FGPUBaseSkinVF    │  │ FNiagaraSpriteVF  │
│ (Static Mesh)         │  │ (Skeletal Mesh)   │  │ (Particle System) │
│                       │  │                   │  │                   │
│ - Position            │  │ - Position        │  │ - Position        │
│ - Normal              │  │ - Normal          │  │ - Size            │
│ - Tangent             │  │ - Bone Index[4]   │  │ - Rotation        │
│ - UV[8]               │  │ - Bone Weight[4]  │  │ - UV              │
│ - Color               │  │ - UV[8]           │  │ - Color           │
└───────────────────────┘  └───────────────────┘  └───────────────────┘
```

**소스 검증:**

```cpp
// VertexFactory.h:134-149
enum class EVertexFactoryFlags : uint32
{
    None                                  = 0u,
    UsedWithMaterials                     = 1u << 1,
    SupportsStaticLighting                = 1u << 2,
    SupportsDynamicLighting               = 1u << 3,
    SupportsPrecisePrevWorldPos           = 1u << 4,
    SupportsPositionOnly                  = 1u << 5,
    SupportsCachingMeshDrawCommands       = 1u << 6,
    SupportsPrimitiveIdStream             = 1u << 7,
    SupportsNaniteRendering               = 1u << 8,  // Nanite 지원
    SupportsRayTracing                    = 1u << 9,
    // ...
};
```

**핵심 역할:**
1. **버텍스 레이아웃 추상화**: StaticMesh vs SkeletalMesh의 차이를 숨김
2. **Shader 변형 생성**: 각 VertexFactory마다 별도 Permutation 생성
3. **GPU 버퍼 관리**: Vertex Stream → GPU Buffer 바인딩

---

## 🧩 주요 구성 요소 (Key Components)

### 1. FShader (기본 클래스)

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/Shader.h:54-800`

**역할:** 모든 Shader의 기본 클래스. 컴파일된 바이트코드와 Parameter 바인딩 정보를 관리합니다.

**핵심 멤버:**

```cpp
class FShader
{
private:
    // Parameter 바인딩 정보 (Uniform Buffer, Texture, Sampler 등)
    FShaderParameterMapInfo ParameterMapInfo;

    // 컴파일된 Shader 바이트코드 (RHI별로 다름)
    TRefCountPtr<FShaderCode> Code;

    // ShaderMap 참조 (이 Shader가 속한 ShaderMap)
    FShaderMapBase* ShaderMapResource;

public:
    // Shader 타입 정보
    virtual FShaderType* GetType() const = 0;

    // Vertex Factory 타입 (FMeshMaterialShader만 사용)
    virtual FVertexFactoryType* GetVertexFactoryType() const = 0;

    // 고유 ID (Permutation 식별용)
    FShaderId GetResourceId() const;
};
```

**소스 검증:**

```cpp
// Shader.h:289-313 - FShaderParameterMapInfo
class FShaderParameterMapInfo
{
public:
    TMemoryImageArray<FShaderUniformBufferParameterInfo> UniformBuffers;
    TMemoryImageArray<FShaderResourceParameterInfo> TextureSamplers;
    TMemoryImageArray<FShaderResourceParameterInfo> SRVs;
    TMemoryImageArray<FShaderLooseParameterBufferInfo> LooseParameterBuffers;
    uint64 Hash;  // 빠른 비교를 위한 해시
};
```

---

### 2. FGlobalShader (싱글톤 Shader)

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h:85-119`

**역할:** Material이나 Vertex Factory 없이 동작하는 싱글톤 Shader입니다. 주로 **PostProcess, Compute Shader, Screen Quad** 등에 사용됩니다.

**특징:**
- **싱글톤**: 플랫폼당 하나의 인스턴스만 존재
- **FGlobalShaderMap**에 저장
- **Material 없음**: Material 파라미터 사용 불가
- **빠른 로딩**: 엔진 시작 시 자동 로드

**예시:**
```cpp
// PostProcessTonemap.usf를 위한 Shader
class FPostProcessTonemapPS : public FGlobalShader
{
    DECLARE_SHADER_TYPE(FPostProcessTonemapPS, Global);

public:
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
    {
        return true;  // 모든 플랫폼에서 컴파일
    }
};
```

---

### 3. FMaterialShader (Material 연결 Shader)

**📂 위치:** `Engine/Source/Runtime/Renderer/Public/MaterialShader.h:54-136`

**역할:** **Material**과 연결된 Shader입니다. Material Editor에서 생성한 노드 그래프를 HLSL로 변환하여 사용합니다.

**핵심 멤버:**

```cpp
// MaterialShader.h:54-59
class FMaterialShader : public FShader
{
private:
    // Material Uniform Buffer (Material 파라미터)
    FShaderUniformBufferParameter MaterialUniformBuffer;

    // Parameter Collection (전역 Material 파라미터)
    TMemoryImageArray<FShaderUniformBufferParameter> ParameterCollectionUniformBuffers;

public:
    // Material 파라미터 설정
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
| **인스턴스**       | 싱글톤 (플랫폼당 1개)      | Material마다 별도 인스턴스 |
| **Permutation 수** | 적음 (~수십 개)           | 많음 (~수천 개)           |
| **사용 예**        | PostProcess, Compute      | Deferred Shading, Forward |
| **ShaderMap**      | FGlobalShaderMap          | FMaterialShaderMap        |

---

### 4. FMeshMaterialShader (Mesh + Material Shader)

**📂 위치:** `Engine/Source/Runtime/Renderer/Public/MeshMaterialShader.h:66-123`

**역할:** **Material + Vertex Factory** 조합입니다. 실제 메시 렌더링에 사용되는 대부분의 Shader가 이 클래스를 상속합니다.

**핵심 멤버:**

```cpp
// MeshMaterialShader.h:66-123
class FMeshMaterialShader : public FMaterialShader
{
private:
    // Vertex Factory Parameters (버텍스 레이아웃 정보)
    TMemoryImagePtr<FVertexFactoryShaderParameters> VertexFactoryParameters;

    // Pass Uniform Buffer (Pass별 공통 파라미터)
    FShaderUniformBufferParameter PassUniformBuffer;

public:
    // Element별 바인딩 (MeshBatch 처리)
    void GetElementShaderBindings(
        const FScene* Scene,
        const FVertexFactory* VertexFactory,
        const FMeshBatch& MeshBatch,
        FMeshDrawSingleShaderBindings& ShaderBindings,
        FVertexInputStreamArray& VertexStreams
    ) const;
};
```

**소스 검증:**

```cpp
// MeshMaterialShader.h:31-40 - Permutation Parameters
struct FMeshMaterialShaderPermutationParameters : public FMaterialShaderPermutationParameters
{
    // VertexFactory 타입을 포함 - Material + VF 조합마다 별도 Permutation
    const FVertexFactoryType* VertexFactoryType;

    FMeshMaterialShaderPermutationParameters(
        EShaderPlatform InPlatform,
        const FMaterialShaderParameters& InMaterialParameters,
        const FVertexFactoryType* InVertexFactoryType,
        int32 InPermutationId,
        EShaderPermutationFlags InFlags
    );
};
```

---

## 💡 핵심 설계 철학 (Design Philosophy)

### 왜 Uber Shader를 사용하는가?

| 이유                      | 설명                                                  | 효과                              |
|--------------------------|------------------------------------------------------|-----------------------------------|
| **1. 크로스 플랫폼 단순화** | 단일 HLSL 소스 → 모든 플랫폼                          | 유지보수 부담 1/N로 감소           |
| **2. 기능 조합 폭발 방지**  | 매크로로 선택적 컴파일                                | 소스 파일 수 기하급수 증가 방지    |
| **3. DDC 활용**           | 컴파일된 Permutation 캐싱                             | 재컴파일 시간 99% 감소             |
| **4. 런타임 메모리 최적화** | 사용되는 Permutation만 로드                          | VRAM 절약 (~수백 MB)              |

### Permutation 폭발 문제와 해결책

**문제:** Material 기능이 N개 있으면 **2^N개의 Permutation** 생성

**예시:**
```
기능 10개 → 2^10 = 1,024 Permutations
기능 20개 → 2^20 = 1,048,576 Permutations  ⚠️ 현실적으로 불가능
```

**해결책:**

1. **ShouldCompilePermutation() 필터링**
```cpp
static bool ShouldCompilePermutation(const FMaterialShaderPermutationParameters& Parameters)
{
    // 불필요한 조합 제거
    if (Parameters.MaterialParameters.bIsTranslucent && Parameters.MaterialParameters.bWritesDepth)
    {
        return false;  // Translucent Material은 Depth 쓰기 불가
    }
    return true;
}
```

2. **Static Switch Parameter**
   - Material Instance에서 설정 → 해당 분기만 컴파일
   - 일반 Parameter는 런타임 변경 가능 → 모든 분기 컴파일

3. **Shader Quality Level**
   - Low/Medium/High/Epic → Quality별 Permutation 생성
   - 모바일: Low만, PC: High 이상만

---

## 🆕 UE 5.7 주요 변경사항

### Substrate 시스템 기본 활성화

**📂 위치:** `Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp:1952-1955`

**UE 5.7부터 새로운 프로젝트에서 Substrate가 기본으로 활성화됩니다:**

```cpp
// RenderUtils.cpp:1949-1955
// New projects created with 5.7, will have Substrate enabled automatically:
//  * With Blendable GBuffer for regular templates.
//  * With Adaptive Gbuffer for advanced templates.
// This is handled in GameProjectUtils.cpp.
```

**변경 내용:**

| 프로젝트 유형 | UE 5.6 이전 | UE 5.7 이후 |
|--------------|------------|------------|
| **새 프로젝트 (일반 템플릿)** | 비활성화 | ✅ **Substrate (Blendable GBuffer)** |
| **새 프로젝트 (고급 템플릿)** | 비활성화 | ✅ **Substrate (Adaptive GBuffer)** |
| **기존 프로젝트** | 기존 설정 유지 | 기존 설정 유지 (하위 호환성) |

**Substrate란?**

Substrate는 언리얼 엔진 5에서 도입된 차세대 머티리얼 시스템입니다:

- **레이어드 머티리얼**: 복잡한 multi-layer 머티리얼 표현
- **물리 기반**: 더 정확한 물리 기반 렌더링
- **성능 최적화**: Material Binning을 통한 성능 향상
- **유연한 GBuffer**: Blendable 또는 Adaptive GBuffer 선택

**GBuffer 모드:**

1. **Blendable GBuffer** (일반 템플릿 기본값)
   - 유연한 머티리얼 블렌딩 지원
   - 더 많은 머티리얼 기능 사용 가능
   - 약간 높은 메모리 사용량

2. **Adaptive GBuffer** (고급 템플릿 기본값)
   - 동적 GBuffer 할당
   - 메모리 효율적
   - 필요한 채널만 사용

**기존 프로젝트 마이그레이션:**

기존 프로젝트는 자동으로 Substrate로 전환되지 않습니다. 수동으로 활성화하려면:

1. **Project Settings → Rendering → Substrate**
2. **Enable Substrate Materials** 체크박스 활성화
3. **GBuffer Format** 선택:
   - `Blendable` - 더 많은 기능 (권장)
   - `Adaptive` - 메모리 효율

**주의사항:**

- Substrate 활성화 후에는 기존 머티리얼 재작업이 필요할 수 있음
- 일부 legacy 머티리얼 기능은 Substrate에서 다르게 동작
- 셰이더 재컴파일 필요 (DDC 리빌드)

---

## 🔗 참고 자료 (References)

### 공식 문서
- [Unreal Engine - Shaders Overview](https://docs.unrealengine.com/5.6/en-US/shaders-in-unreal-engine/)
- [Material Editor User Guide](https://docs.unrealengine.com/5.6/en-US/unreal-engine-material-editor-user-guide/)
- [RenderDoc Integration](https://docs.unrealengine.com/5.6/en-US/renderdoc-integration-in-unreal-engine/)

### 커뮤니티 자료
- [UE5 Rendering Architecture](https://www.cnblogs.com/timlly/p/15092257.html) - Shader 시스템 전체 구조 설명
- [Custom Mesh Pass 구현](https://techartnomad.tistory.com/217) - Mesh Pass Processor 커스터마이징
- [Material 시스템과 Shader](https://mathmakeworld.tistory.com/30) - Material Editor → HLSL 변환 과정
- [Shader 타입과 Uber Shader](https://scahp.tistory.com/m/78) - FShaderType, Permutation 시스템
- [Material 컴파일 과정](https://scahp.tistory.com/79) - Uniform Buffer, Expression 처리
- [Shader Resource Binding (UE5)](https://scahp.tistory.com/80) - UniformBuffer 정의 및 바인딩

### 소스 코드
- `Engine/Source/Runtime/RenderCore/Public/Shader.h` - FShader 기본 클래스
- `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h` - FGlobalShader
- `Engine/Source/Runtime/Renderer/Public/MaterialShader.h` - FMaterialShader
- `Engine/Source/Runtime/Renderer/Public/MeshMaterialShader.h` - FMeshMaterialShader
- `Engine/Source/Runtime/RenderCore/Public/VertexFactory.h` - Vertex Factory 시스템
- `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerCore.h` - Shader 컴파일러

---

> 🔄 **작성일**: 2025-01-04
> 🔄 **업데이트**: 2025-11-06 (UE 5.7 대응)
> 📝 **문서 버전**: v1.1
> ✅ **소스 검증**: UE 5.7.0
