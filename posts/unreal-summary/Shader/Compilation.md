---
title: "Shader 컴파일 시스템 (Shader Compilation System)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Shader 컴파일 시스템 (Shader Compilation System)

## 🧭 개요 (Overview)

Unreal Engine의 Shader 컴파일 시스템은 **Material Editor 노드 그래프**를 **플랫폼별 GPU 바이트코드**로 변환하는 복잡한 파이프라인입니다. 이 시스템은 **병렬 컴파일**, **DDC (Derived Data Cache)**, **Permutation 관리**를 통해 효율적으로 수천 개의 Shader 변형을 생성합니다.

**핵심 개념:**
- **FShaderCompileJob**: 단일 Shader 컴파일 작업 단위
- **ShaderCompileWorker.exe**: 병렬 컴파일 프로세스 (CPU 코어별로 생성)
- **Permutation (순열)**: 동일한 소스로부터 생성되는 기능 조합
- **DDC**: 컴파일된 Shader를 캐싱하여 재컴파일 시간 단축
- **MaterialTemplate.ush**: Material 노드 → HLSL 변환 결과

**📂 위치:**
- `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerCore.h`
- `Engine/Source/Runtime/Engine/Private/ShaderCompiler/ShaderCompiler.cpp`
- `Engine/Programs/ShaderCompileWorker/` - 병렬 컴파일 워커

---

## 🧱 컴파일 파이프라인 (Compilation Pipeline)

### 전체 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1: Material Editor → HLSL 변환 (Editor Only)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Material 노드 그래프                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ Texture      │→ │ Multiply     │→ │ BaseColor    │                │
│  │ Sample       │  │ (Scalar)     │  │              │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                           ↓                                            │
│            [Material Expression Tree 순회]                             │
│                           ↓                                            │
│          MaterialTemplate.ush 생성                                     │
│                                                                         │
│  ```hlsl                                                               │
│  // Auto-generated code                                                │
│  float3 GetMaterialBaseColor(FMaterialPixelParameters Parameters)      │
│  {                                                                     │
│      float3 TexColor = Texture2DSample(MyTexture, MySampler, UV);     │
│      return TexColor * ScalarParameter;                               │
│  }                                                                     │
│  ```                                                                   │
└───────────────────────────┼──────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2: Permutation 계산 (ShouldCompilePermutation)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Material 속성:                                                         │
│  - ShadingModel = Lit                     → Define: MATERIAL_LIT=1    │
│  - BlendMode = Opaque                     → Define: BLEND_OPAQUE=1    │
│  - bUseNormalMap = true                   → Define: USE_NORMALMAP=1   │
│  - bUseMetallic = true                    → Define: USE_METALLIC=1    │
│                                                                         │
│  VertexFactory (FMeshMaterialShader만):                                │
│  - FLocalVertexFactory                    → Define: VF_LOCAL=1        │
│                                                                         │
│  Platform:                                                             │
│  - Windows D3D12                          → Define: D3D12=1           │
│                                                                         │
│                           ↓                                            │
│                  PermutationId = 0x4A2F                                │
└───────────────────────────┼──────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 3: ShaderCompileWorker 병렬 실행                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Main Thread]                        [Worker Processes]               │
│       │                                      │                         │
│       │  Create FShaderCompileJob           │                         │
│       ├──────────────────────────────────>  │ Worker 1 (Core 0)       │
│       │  Input:                             │  - Preprocess           │
│       │  - Source: MyShader.usf             │  - Compile HLSL→DXIL    │
│       │  - Defines: {...}                   │  - Generate Reflection  │
│       │  - Platform: D3D12                  │                         │
│       │                                     │                         │
│       ├──────────────────────────────────>  │ Worker 2 (Core 1)       │
│       │  (다른 Permutation)                 │  - 독립적으로 컴파일    │
│       │                                     │                         │
│       ├──────────────────────────────────>  │ Worker 3 (Core 2)       │
│       │                                     │                         │
│       │<────────────────────────────────────┤ Return:                 │
│       │  Output:                            │  - Bytecode             │
│       │  - Compiled Bytecode                │  - ParameterMap         │
│       │  - ParameterMap (Reflection)        │  - Errors/Warnings      │
│       │  - Errors/Warnings                  │                         │
└───────┼─────────────────────────────────────┼──────────────────────────┘
        ↓                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 4: ShaderMap 저장 + DDC 캐싱                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FMaterialShaderMap                                                    │
│  ┌────────────────────────────────────────────┐                       │
│  │ Material: M_Character                      │                       │
│  │                                            │                       │
│  │ Shaders:                                   │                       │
│  │  - TBasePassVS (Permutation 0x4A2F)        │                       │
│  │  - TBasePassPS (Permutation 0x4A2F)        │                       │
│  │  - TDepthOnlyPS (Permutation 0x1234)       │                       │
│  │  ...                                       │                       │
│  │                                            │                       │
│  │ VertexFactory별 저장:                      │                       │
│  │  [FLocalVertexFactory]                     │                       │
│  │    - BasePass Shaders                      │                       │
│  │  [FGPUSkinVertexFactory]                   │                       │
│  │    - BasePass Shaders                      │                       │
│  └────────────────────────────────────────────┘                       │
│                           ↓                                            │
│  DDC에 저장 (Key = Material Hash + Platform + Version)                 │
│  - 다음 로드 시 컴파일 생략 (0.1초로 단축)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 핵심 구성 요소 (Key Components)

### 1. FShaderCompileJob

**역할:** 단일 Shader 컴파일 작업을 표현하는 구조체입니다.

```cpp
struct FShaderCompileJob
{
    // Input: 컴파일할 Shader 정보
    FShaderCompilerInput Input;
    struct FShaderCompilerInput
    {
        FString SourceFilename;               // "MyShader.usf"
        FString EntryPointName;               // "MainVS" 또는 "MainPS"
        EShaderFrequency Frequency;           // Vertex, Pixel, Compute 등
        TMap<FString, FString> Environment;   // #define 매크로 목록
        EShaderPlatform Platform;             // D3D12, Vulkan 등
    };

    // Output: 컴파일 결과
    FShaderCompilerOutput Output;
    struct FShaderCompilerOutput
    {
        TArray<uint8> ShaderCode;             // 컴파일된 바이트코드
        FShaderParameterMap ParameterMap;     // Parameter 바인딩 정보
        TArray<FString> Errors;               // 컴파일 에러
        TArray<FString> Warnings;             // 경고 메시지
    };
};
```

---

### 2. Permutation (순열) 시스템

**Permutation ID 계산:**

```cpp
// Material Shader Permutation ID 예시
int32 CalculatePermutationId()
{
    int32 Id = 0;

    if (bIsLit)              Id |= (1 << 0);  // Bit 0
    if (bIsMasked)           Id |= (1 << 1);  // Bit 1
    if (bUseNormalMap)       Id |= (1 << 2);  // Bit 2
    if (bUseSpecular)        Id |= (1 << 3);  // Bit 3
    if (bIsTranslucent)      Id |= (1 << 4);  // Bit 4
    if (bUseDitheredLOD)     Id |= (1 << 5);  // Bit 5

    return Id;
}

// 예: Lit + NormalMap + Specular = 0b001101 = 13
```

**ShouldCompilePermutation() 필터링:**

```cpp
static bool ShouldCompilePermutation(const FMaterialShaderPermutationParameters& Parameters)
{
    // 불필요한 Permutation 제거

    // Translucent Material은 Depth 쓰기 불가
    if (Parameters.MaterialParameters.bIsTranslucent &&
        Parameters.MaterialParameters.bWritesDepth)
    {
        return false;
    }

    // Masked Material은 Opaque만 지원
    if (Parameters.MaterialParameters.BlendMode == BLEND_Masked &&
        Parameters.MaterialParameters.bIsTranslucent)
    {
        return false;
    }

    // Nanite는 특정 VertexFactory만 지원
    if (Parameters.MaterialParameters.bIsUsedWithNanite &&
        Parameters.VertexFactoryType->GetFName() != TEXT("FNaniteVertexFactory"))
    {
        return false;
    }

    return true;
}
```

---

### 3. ShaderCompileWorker (병렬 컴파일)

**프로세스 생성:**

```
CPU 코어 수: 16개
───────────────────────────────────
생성되는 Worker 프로세스:
- ShaderCompileWorker.exe (Instance 1)
- ShaderCompileWorker.exe (Instance 2)
- ...
- ShaderCompileWorker.exe (Instance 16)

각 Worker는 독립적으로 Shader를 컴파일합니다.
```

**작업 분배:**

```
Main Thread                      Worker 1         Worker 2         Worker 3
    │                               │                │                │
    │  Job 1: BasePassVS            │                │                │
    ├──────────────────────────────>│                │                │
    │                               │ Compiling...   │                │
    │  Job 2: BasePassPS            │                │                │
    ├────────────────────────────────────────────────>│                │
    │                               │                │ Compiling...   │
    │  Job 3: DepthOnlyPS           │                │                │
    ├───────────────────────────────────────────────────────────────>│
    │                               │                │                │ Compiling...
    │<──────────────────────────────┤                │                │
    │  Job 1 Complete               │                │                │
    │<────────────────────────────────────────────────┤                │
    │  Job 2 Complete               │                │                │
    │<───────────────────────────────────────────────────────────────┤
    │  Job 3 Complete               │                │                │
```

---

### 4. DDC (Derived Data Cache)

**역할:** 컴파일된 Shader를 캐싱하여 재컴파일 시간을 99% 단축합니다.

**DDC Key 생성:**

```cpp
FString GenerateDDCKey()
{
    FSHAHash Hash;

    // Material 정보
    Hash.Update(MaterialGuid);
    Hash.Update(MaterialSourceHash);

    // Platform 정보
    Hash.Update(ShaderPlatform);

    // Engine 버전
    Hash.Update(EngineVersion);

    // Permutation ID
    Hash.Update(PermutationId);

    return Hash.ToString();
}
```

**캐시 히트 시:**

```
Material 로드 시간 (DDC Hit):
- Shader 컴파일 생략: 0ms
- DDC에서 바이트코드 로드: ~100ms
- RHI Shader 생성: ~10ms
────────────────────────────────
총 시간: ~110ms  ✅ (원래: 5,000ms+)
```

**캐시 미스 시:**

```
Material 로드 시간 (DDC Miss):
- Shader 컴파일: ~5,000ms  ⚠️
- DDC에 저장: ~50ms
- RHI Shader 생성: ~10ms
────────────────────────────────
총 시간: ~5,060ms
```

---

## 💡 성능 최적화 (Performance Optimization)

### ✅ 해야 할 것

**1. Static Switch Parameter 사용:**

```cpp
// Material Blueprint에서 Static Switch 사용
// → 해당 분기만 컴파일
if (StaticSwitchParameter_UseDynamicLighting)
{
    // Dynamic Lighting 코드
}
else
{
    // Static Lighting 코드
}

// Permutation 수: 2개 (Dynamic=0, Dynamic=1)
```

**2. Quality Switch 활용:**

```cpp
// Material Quality Level별 분기
#if MATERIAL_QUALITY_LEVEL >= MQL_High
    // 고품질 Shader (PC)
    float3 Reflection = ComputeReflection();
#else
    // 저품질 Shader (Mobile)
    float3 Reflection = CubemapSample();
#endif

// Permutation: Low, Medium, High, Epic (4개)
```

**3. Async Compilation 활성화:**

```cpp
// DefaultEngine.ini
[ShaderCompiler]
r.ShaderCompiler.AsyncCompilation=1
r.ShaderCompiler.MaxShaderJobBatchSize=10
```

---

### ❌ 피해야 할 것

**1. Dynamic Branch 남용:**

```cpp
// ❌ 나쁜 예: 런타임 Branch → 모든 분기 컴파일
if (ScalarParameter > 0.5f)
{
    // Branch A
}
else
{
    // Branch B
}

// 두 분기 모두 컴파일되어 바이트코드에 포함 → 비효율
```

**2. 불필요한 Feature 활성화:**

```cpp
// ❌ 나쁜 예: 사용하지 않는 기능 켜기
Material->bUseEmissive = true;  // Emissive 사용하지 않는데 켜짐
Material->bUseTessellation = true;  // Tessellation 미사용

// → 불필요한 Permutation 생성 (2^N 증가)
```

**3. Shader 재컴파일 유발:**

```cpp
// ❌ 나쁜 예: .usf 파일 수정 → 모든 Shader 재컴파일
// Engine/Shaders/Private/Common.ush 수정
// → 수천 개의 Shader가 이 파일을 include → 전체 재컴파일 (수십 분)

// ✅ 좋은 예: 특정 Material만 사용하는 Custom .ush 파일 작성
```

---

## 🆕 UE 5.7 주요 변경사항

### Bindless Resources API 통합

**📂 위치:**
- `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerCore.h:52-56`
- `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerFlags.inl:77-78`

**변경 내용:**

Bindless Resources 및 Samplers 설정 API가 단일 함수로 통합되었습니다:

```cpp
// ❌ UE 5.6 이전 (Deprecated)
UE_DEPRECATED(5.7, "GetBindlessResourcesConfiguration is now GetBindlessConfiguration")
RENDERCORE_API ERHIBindlessConfiguration GetBindlessResourcesConfiguration(FName ShaderFormat);

UE_DEPRECATED(5.7, "GetBindlessSamplersConfiguration is now GetBindlessConfiguration")
RENDERCORE_API ERHIBindlessConfiguration GetBindlessSamplersConfiguration(FName ShaderFormat);

// ✅ UE 5.7 이후 (권장)
RENDERCORE_API ERHIBindlessConfiguration GetBindlessConfiguration(EShaderPlatform ShaderPlatform);
RENDERCORE_API bool ShouldCompileWithBindlessEnabled(EShaderPlatform ShaderPlatform, const FShaderCompilerInput& Input);
```

**ERHIBindlessConfiguration Enum:**

```cpp
enum class ERHIBindlessConfiguration : uint8
{
    Disabled = 0,           // Bindless 비활성화
    AllShaders = 1,         // 모든 Shader에서 Bindless 활성화
    RayTracingShaders = 2,  // Ray Tracing Shader만 Bindless
};
```

**마이그레이션:**

```cpp
// UE 5.6 - Resources와 Samplers 별도 확인
ERHIBindlessConfiguration ResourcesConfig = GetBindlessResourcesConfiguration(ShaderFormat);
ERHIBindlessConfiguration SamplersConfig = GetBindlessSamplersConfiguration(ShaderFormat);

if (ResourcesConfig != ERHIBindlessConfiguration::Disabled &&
    SamplersConfig != ERHIBindlessConfiguration::Disabled)
{
    // Bindless 지원
}

// UE 5.7 - 통합 API 사용
ERHIBindlessConfiguration BindlessConfig = GetBindlessConfiguration(ShaderPlatform);

if (BindlessConfig != ERHIBindlessConfiguration::Disabled)
{
    // Bindless 지원
}
```

---

### Shader Compiler Flags 변경

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerFlags.inl:77-78`

**변경 내용:**

`BindlessResources`와 `BindlessSamplers` 플래그가 내부 전용으로 변경되었습니다:

```cpp
// ❌ UE 5.6 이전 (Public)
SHADER_COMPILER_FLAGS_ENTRY(BindlessResources)
SHADER_COMPILER_FLAGS_ENTRY(BindlessSamplers)

// ✅ UE 5.7 이후 (Internal - Deprecated for public use)
SHADER_COMPILER_FLAGS_ENTRY_DEPRECATED(BindlessResources, 5.7, "This flag is now internal to the shader compiler.")
SHADER_COMPILER_FLAGS_ENTRY_DEPRECATED(BindlessSamplers, 5.7, "This flag is now internal to the shader compiler.")
```

**영향:**

- 외부 코드에서 이 플래그를 직접 설정하면 안 됨
- Shader 컴파일러가 `GetBindlessConfiguration()` 결과에 따라 자동으로 설정
- 사용자 코드는 `ShouldCompileWithBindlessEnabled()` 사용 권장

**ForceBindful 플래그 (새로 추가):**

```cpp
// 특정 Shader에서 Bindless 강제 비활성화
SHADER_COMPILER_FLAGS_ENTRY(ForceBindful)
```

이 플래그를 사용하면 전역 Bindless 설정과 관계없이 특정 Shader를 Bindful(전통적 바인딩)로 컴파일할 수 있습니다.

---

### 실전 예시

#### Bindless 지원 확인 (UE 5.7)

```cpp
// === Bindless 설정 확인 ===

EShaderPlatform Platform = GMaxRHIShaderPlatform;
ERHIBindlessConfiguration Config = GetBindlessConfiguration(Platform);

switch (Config)
{
case ERHIBindlessConfiguration::Disabled:
    UE_LOG(LogShaders, Log, TEXT("Bindless: Disabled"));
    break;

case ERHIBindlessConfiguration::AllShaders:
    UE_LOG(LogShaders, Log, TEXT("Bindless: Enabled for all shaders"));
    break;

case ERHIBindlessConfiguration::RayTracingShaders:
    UE_LOG(LogShaders, Log, TEXT("Bindless: Enabled for ray tracing only"));
    break;
}
```

#### Shader 컴파일 시 Bindless 확인

```cpp
// === Shader Permutation에서 Bindless 확인 ===

static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
{
    // Bindless 활성화 여부 확인
    bool bBindlessEnabled = (GetBindlessConfiguration(Parameters.Platform) != ERHIBindlessConfiguration::Disabled);

    if (bBindlessEnabled)
    {
        // Bindless 전용 Permutation만 컴파일
        return true;
    }

    // Bindful Permutation만 컴파일
    return false;
}
```

#### ForceBindful 플래그 사용

```cpp
// === 특정 Shader에서 Bindless 비활성화 ===

class FMyShader : public FGlobalShader
{
    DECLARE_GLOBAL_SHADER(FMyShader);

    static void ModifyCompilationEnvironment(const FGlobalShaderPermutationParameters& Parameters, FShaderCompilerEnvironment& OutEnvironment)
    {
        FGlobalShader::ModifyCompilationEnvironment(Parameters, OutEnvironment);

        // 이 Shader는 Bindless와 호환되지 않음 - 강제로 Bindful 사용
        OutEnvironment.CompilerFlags.Add(CFLAG_ForceBindful);
    }
};
```

---

### Bindless vs Bindful 비교

| 항목 | Bindful (전통적) | Bindless |
|------|------------------|----------|
| **리소스 바인딩** | Slot 기반 (t0, s0 등) | 무제한 배열/힙 기반 |
| **최대 리소스** | ~128개 (플랫폼별) | ~백만 개 |
| **바인딩 오버헤드** | 높음 (Draw Call마다) | 낮음 (한 번만) |
| **메모리 효율** | 낮음 (Slot 낭비) | 높음 (필요한 것만) |
| **지원 API** | D3D11, D3D12, Vulkan | D3D12 (Tier 2+), Vulkan |
| **Ray Tracing** | 제한적 | 최적 |

**Bindless 예시 (HLSL):**

```hlsl
// Bindful (전통적)
Texture2D MyTexture : register(t0);
SamplerState MySampler : register(s0);

float4 SampleTexture()
{
    return MyTexture.Sample(MySampler, UV);
}

// Bindless (UE 5.7)
ByteAddressBuffer ResourceIndices;  // 리소스 인덱스 버퍼

float4 SampleTexture(uint TextureIndex)
{
    // 동적 인덱싱으로 텍스처 접근
    Texture2D Tex = ResourceDescriptorHeap[TextureIndex];
    SamplerState Samp = SamplerDescriptorHeap[0];
    return Tex.Sample(Samp, UV);
}
```

---

### 마이그레이션 체크리스트

**Bindless API 업데이트:**

1. ✅ `GetBindlessResourcesConfiguration` 검색
2. ✅ `GetBindlessSamplersConfiguration` 검색
3. ✅ 모두 `GetBindlessConfiguration(EShaderPlatform)`로 교체
4. ✅ `FName ShaderFormat` → `EShaderPlatform` 파라미터 변경 확인

**Shader Compiler Flags:**

1. ✅ `CFLAG_BindlessResources` 직접 사용 검색 → 제거
2. ✅ `CFLAG_BindlessSamplers` 직접 사용 검색 → 제거
3. ✅ 필요 시 `CFLAG_ForceBindful` 사용으로 대체

**컴파일 경고:**

```
warning C4996: 'GetBindlessResourcesConfiguration': GetBindlessResourcesConfiguration is now GetBindlessConfiguration
warning C4996: 'CFLAG_BindlessResources': This flag is now internal to the shader compiler
```

---

### 프로젝트 설정

**Bindless 활성화 (Project Settings):**

```
Project Settings → Engine → Rendering → Hardware → RHI
- Enable Bindless Resources: True/False
- Bindless Configuration: Disabled / AllShaders / RayTracingShaders
```

**콘솔 변수:**

```cpp
r.Bindless.Enabled 1          // Bindless 활성화 (런타임)
r.Bindless.Resources 1        // Bindless Resources
r.Bindless.Samplers 1         // Bindless Samplers
```

---

## 🔗 참고 자료 (References)

### 소스 코드
- `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerCore.h`
- `Engine/Source/Runtime/RenderCore/Public/ShaderCompilerFlags.inl` - **UE 5.7 업데이트**
- `Engine/Source/Runtime/Engine/Private/ShaderCompiler/ShaderCompiler.cpp`
- `Engine/Programs/ShaderCompileWorker/`

### 커뮤니티 자료
- [Material 컴파일 과정](https://scahp.tistory.com/79) - Uniform Buffer, Expression 처리
- [Shader 타입과 Uber Shader](https://scahp.tistory.com/m/78) - Permutation 시스템

### 공식 문서
- [Bindless Resources in D3D12](https://docs.microsoft.com/d3d12/bindless)
- [Vulkan Descriptor Indexing](https://www.khronos.org/blog/vulkan-descriptor-indexing)

---

> 🔄 **작성일**: 2025-01-04
> 🔄 **업데이트**: 2025-11-06 — UE 5.7 Bindless API 변경사항 반영
> 📝 **문서 버전**: v1.1
> ✅ **소스 검증**: UE 5.7.0
