---
title: "Shader Permutation Optimization Deep Dive"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Shader Permutation Optimization Deep Dive

## 🧭 개요

Unreal Engine 5의 **Shader Permutation (셰이더 변형)** 시스템은 다양한 렌더링 경로, 플랫폼, 기능 조합을 처리하기 위한 핵심 메커니즘입니다. 하지만 잘못 관리하면 수만 개의 불필요한 셰이더가 컴파일되어 빌드 시간과 메모리를 낭비합니다. 본 문서는 Permutation 폭발 원인 분석과 실전 최적화 기법을 다룹니다.

**핵심 문제:**
- **조합 폭발 (Combinatorial Explosion)**: 10가지 옵션 × 8개 플랫폼 × 15개 VertexFactory = 1,200개 조합
- **컴파일 시간 폭증**: 대규모 프로젝트에서 수 시간 소요
- **메모리 사용량 증가**: 셰이더맵 크기 GB 단위

**해결 전략:**
- `ShouldCompilePermutation()` 필터링으로 90% 이상 감소
- `PERMUTATION_*` 매크로로 컴파일 타임 조합 제어
- 플랫폼별 조건부 컴파일

---

## 🏗️ Permutation 시스템 아키텍처

### 1. Permutation이란?

**정의:** 동일한 셰이더 타입의 서로 다른 기능 조합

```
예시: BasePassPixelShader

Permutation 0: Default Lit + No Lightmap + No Fog
Permutation 1: Default Lit + Static Lightmap + Exponential Fog
Permutation 2: Unlit + No Lightmap + Volumetric Fog
Permutation 3: Subsurface + IES Profile + Skylight
...
(수백 ~ 수천 개 조합 가능)
```

**생성 이유:**
- 런타임 동적 분기 (if문)는 GPU 성능 저하 유발
- 컴파일 타임에 불필요한 코드 제거 (Dead Code Elimination)

**Before (Dynamic Branch - 느림):**

```hlsl
void MainPS(...)
{
    if (bUseLightmap)  // 런타임 분기 (모든 픽셀에서 평가)
    {
        Lighting += SampleLightmap();  // 50% 픽셀은 실행 안 함
    }

    if (bUseFog)  // 또 다른 런타임 분기
    {
        Color = ApplyFog(Color);
    }
}
// → Warp Divergence 발생, 성능 저하
```

**After (Compile-Time Permutation - 빠름):**

```hlsl
// Permutation 0: #define USE_LIGHTMAP 0, USE_FOG 0
void MainPS(...)
{
    // Lighting += SampleLightmap();  ← 컴파일러가 제거
    // Color = ApplyFog(Color);       ← 컴파일러가 제거
}

// Permutation 1: #define USE_LIGHTMAP 1, USE_FOG 0
void MainPS(...)
{
    Lighting += SampleLightmap();  ← 항상 실행
    // Color = ApplyFog(Color);     ← 컴파일러가 제거
}

// → 분기 없음, 최적 성능
```

### 2. Permutation ID 계산 구조

```cpp
// 각 기능은 비트 플래그로 인코딩
enum EBasePassPermutation
{
    // Bit 0-1: Shading Model (4 variants)
    PERMUTATION_SHADING_MODEL_DEFAULT   = 0 << 0,
    PERMUTATION_SHADING_MODEL_SUBSURFACE= 1 << 0,
    PERMUTATION_SHADING_MODEL_UNLIT     = 2 << 0,
    PERMUTATION_SHADING_MODEL_CLOTH     = 3 << 0,

    // Bit 2-4: Lightmap Policy (8 variants)
    PERMUTATION_LIGHTMAP_NONE           = 0 << 2,
    PERMUTATION_LIGHTMAP_STATIC         = 1 << 2,
    PERMUTATION_LIGHTMAP_STATIONARY     = 2 << 2,
    PERMUTATION_LIGHTMAP_IES_PROFILE    = 3 << 2,
    ...

    // Bit 5: Fog (2 variants)
    PERMUTATION_FOG_DISABLED            = 0 << 5,
    PERMUTATION_FOG_ENABLED             = 1 << 5,

    // Bit 6-7: Reflection (4 variants)
    PERMUTATION_REFLECTION_NONE         = 0 << 6,
    PERMUTATION_REFLECTION_SKYLIGHT     = 1 << 6,
    PERMUTATION_REFLECTION_PLANAR       = 2 << 6,
    ...
};

// PermutationId 계산
int32 PermutationId =
    ShadingModelFlags |
    LightmapPolicyFlags |
    FogFlags |
    ReflectionFlags;

// 예시:
// PermutationId = 0b00100101 = 37
//   → Subsurface + Static Lightmap + Fog + Planar Reflection
```

**최대 Permutation 수:**

```cpp
// 가능한 최대 조합 (이론적)
int32 MaxPermutations =
    ShadingModels (4개) ×
    LightmapPolicies (8개) ×
    FogModes (2개) ×
    ReflectionModes (4개) ×
    ... (추가 플래그들);

// = 4 × 8 × 2 × 4 × ... = 수천~수만 개
```

### 3. Permutation Vector 시스템

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/Shader.h`

**FShaderPermutationVector - 타입 안전 Permutation 빌더:**

```cpp
// BasePassPixelShader.h
class FBasePassPermutationVector
{
public:
    // 각 차원 (Dimension) 정의
    class FShadingModelDim : SHADER_PERMUTATION_ENUM_CLASS("SHADING_MODEL", EShadingModel)
    {
    public:
        enum class EType
        {
            DefaultLit,
            Subsurface,
            Unlit,
            Cloth,
        };
    };

    class FLightmapPolicyDim : SHADER_PERMUTATION_ENUM_CLASS("LIGHTMAP_POLICY", ELightmapPolicy)
    {
    public:
        enum class EType
        {
            NoLightmap,
            StaticLightmap,
            IndirectLightingCache,
            IESProfile,
        };
    };

    class FFogDim : SHADER_PERMUTATION_BOOL("USE_FOG");
    class FReflectionDim : SHADER_PERMUTATION_ENUM_CLASS("REFLECTION_MODE", EReflectionMode)
    {
    public:
        enum class EType
        {
            None,
            Skylight,
            PlanarReflection,
        };
    };

    // 모든 차원 조합
    using FPermutationDomain = TShaderPermutationDomain<
        FShadingModelDim,
        FLightmapPolicyDim,
        FFogDim,
        FReflectionDim
    >;

    // Permutation ID ↔ Domain 변환
    static FPermutationDomain BuildPermutationVector(int32 PermutationId)
    {
        FPermutationDomain PermutationVector;
        PermutationVector.Set<FShadingModelDim>(/* decode from id */);
        PermutationVector.Set<FLightmapPolicyDim>(/* decode from id */);
        // ...
        return PermutationVector;
    }

    static int32 ToDimensionValueId(const FPermutationDomain& PermutationVector)
    {
        return PermutationVector.ToDimensionValueId();
    }
};
```

**사용 예시:**

```cpp
// 특정 Permutation 생성
FBasePassPermutationVector::FPermutationDomain PermutationVector;
PermutationVector.Set<FBasePassPermutationVector::FShadingModelDim>(
    FBasePassPermutationVector::FShadingModelDim::EType::Subsurface
);
PermutationVector.Set<FBasePassPermutationVector::FLightmapPolicyDim>(
    FBasePassPermutationVector::FLightmapPolicyDim::EType::StaticLightmap
);
PermutationVector.Set<FBasePassPermutationVector::FFogDim>(true);

int32 PermutationId = PermutationVector.ToDimensionValueId();
// → HLSL에 #define SHADING_MODEL 1, LIGHTMAP_POLICY 1, USE_FOG 1 주입
```

---

## 🔥 Permutation 폭발 사례 분석

### 사례 1: 실제 대규모 프로젝트 (최악의 케이스)

**조건:**
- 머티리얼: M_ComplexMaster
- 플랫폼: PCD3D_SM6, PCD3D_SM5, Android_Vulkan, PS5
- VertexFactory: 12개 (Static, Skinned, Niagara, Landscape, etc.)

**Permutation 차원:**

```cpp
ShadingModels: 5개 (DefaultLit, Subsurface, Unlit, TwoSided, Cloth)
LightmapPolicies: 6개 (None, Static, Stationary, IES, IndirectCache, Movable)
MobileShadingPath: 3개 (Forward, Deferred, Clustered)
DistanceFieldShadows: 2개 (Enabled, Disabled)
PlanarReflection: 2개 (Enabled, Disabled)
VolumetricFog: 2개 (Enabled, Disabled)
TranslucentLightingMode: 4개 (Surface, PerPixel, Surface+PerVertex, PerVertex)
```

**계산:**

```
이론적 최대 조합 =
    5 (ShadingModels) ×
    6 (LightmapPolicies) ×
    3 (MobilePath) ×
    2 (DistanceField) ×
    2 (PlanarReflection) ×
    2 (VolumetricFog) ×
    4 (TranslucentLighting) ×
    4 (Platforms) ×
    12 (VertexFactories)
= 5 × 6 × 3 × 2 × 2 × 2 × 4 × 4 × 12
= 138,240개 Permutation!

각 셰이더 평균 크기: 50KB
총 메모리: 138,240 × 50KB = 6.6GB
컴파일 시간 (1개당 3초): 138,240 × 3s = 115 hours!
```

**실제 필요한 조합 (필터링 후):**

```
유효한 조합 =
    - Unlit는 라이팅 불필요 → LightmapPolicies 1개만
    - Mobile은 Forward만 지원 → MobilePath 1개만
    - PC는 Mobile 경로 불필요
    - Translucent는 특정 기능 미지원
    - ...

= ~4,500개 Permutation (~97% 감소)
컴파일 시간: ~3.75 hours (실용적)
```

### 사례 2: 불필요한 플랫폼 조합

**Before:**

```cpp
// GlobalShader.cpp
class FMyGlobalShader : public FGlobalShader
{
public:
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
    {
        // 모든 플랫폼에 대해 컴파일
        return true;  // ← 문제!
    }
};

// 결과:
//   - PCD3D_SM6
//   - PCD3D_SM5
//   - Android_Vulkan
//   - Android_ES31
//   - iOS_Metal
//   - Mac_Metal
//   - PS5
//   - XboxSeriesX
//   ... (14개 플랫폼) → 14배 중복
```

**After:**

```cpp
class FMyGlobalShader : public FGlobalShader
{
public:
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
    {
        // PC 전용 기능 (Ray Tracing)
        return IsPCPlatform(Parameters.Platform) &&
               RHISupportsRayTracing(Parameters.Platform);
    }
};

// 결과:
//   - PCD3D_SM6 (Ray Tracing 지원)
//   ... (1~2개 플랫폼) → 85% 감소
```

---

## 🛠️ 실전 최적화 기법

### 기법 1: ShouldCompilePermutation() 스마트 필터링

**📂 위치:** `Engine/Source/Runtime/Engine/Public/MaterialShaderType.h:183`

**기본 템플릿:**

```cpp
// MyMaterialShader.h
class FMyMaterialShader : public FMaterialShader
{
public:
    static bool ShouldCompilePermutation(
        const FMaterialShaderPermutationParameters& Parameters)
    {
        // 1단계: 플랫폼 필터링
        if (!IsPCPlatform(Parameters.Platform))
        {
            return false;  // 모바일/콘솔 제외
        }

        // 2단계: Shader Model 필터링
        if (GetMaxSupportedFeatureLevel(Parameters.Platform) < ERHIFeatureLevel::SM5)
        {
            return false;  // SM5 이상만
        }

        // 3단계: Material 속성 필터링
        if (IsTranslucentBlendMode(Parameters.MaterialParameters))
        {
            return false;  // 불투명 머티리얼만
        }

        // 4단계: ShadingModel 필터링
        if (!Parameters.MaterialParameters.ShadingModels.HasShadingModel(MSM_DefaultLit))
        {
            return false;  // DefaultLit만 지원
        }

        // 5단계: VertexFactory 필터링
        if (Parameters.VertexFactoryType != FindVertexFactoryType(FName(TEXT("FLocalVertexFactory"))))
        {
            return false;  // Static Mesh만
        }

        // 6단계: Permutation ID 필터링
        FMyShaderPermutationVector::FPermutationDomain PermutationVector =
            FMyShaderPermutationVector::BuildPermutationVector(Parameters.PermutationId);

        // 특정 조합 차단
        if (PermutationVector.Get<FMyShaderPermutationVector::FFogDim>() &&
            PermutationVector.Get<FMyShaderPermutationVector::FPlanarReflectionDim>())
        {
            return false;  // Fog + PlanarReflection 조합 미지원
        }

        return true;  // 모든 조건 통과
    }
};
```

**효과 측정:**

```cpp
// 최적화 전
Total Permutations: 8,640
Compile Time: 7.2 hours

// 최적화 후 (90% 필터링)
Total Permutations: 864
Compile Time: 43 minutes (10배 빠름)
```

### 기법 2: Permutation Dimension 축소

**문제:** 너무 많은 Dimension 정의

**Before (16개 조합):**

```cpp
// 4개 Boolean Dimension → 2^4 = 16 Permutations
class FMyPermutationVector
{
public:
    class FUseShadowsDim : SHADER_PERMUTATION_BOOL("USE_SHADOWS");
    class FUseFogDim : SHADER_PERMUTATION_BOOL("USE_FOG");
    class FUseReflectionsDim : SHADER_PERMUTATION_BOOL("USE_REFLECTIONS");
    class FUseAODim : SHADER_PERMUTATION_BOOL("USE_AMBIENT_OCCLUSION");

    using FPermutationDomain = TShaderPermutationDomain<
        FUseShadowsDim,
        FUseFogDim,
        FUseReflectionsDim,
        FUseAODim
    >;
};
```

**After (4개 조합 - 75% 감소):**

```cpp
// 상관 관계 있는 기능 묶기
class FMyPermutationVector
{
public:
    enum class ELightingMode
    {
        SimpleLighting,     // Shadows만
        StandardLighting,   // Shadows + AO
        AdvancedLighting,   // Shadows + AO + Reflections
        FullLighting,       // All features
    };

    class FLightingModeDim : SHADER_PERMUTATION_ENUM_CLASS("LIGHTING_MODE", ELightingMode);
    class FUseFogDim : SHADER_PERMUTATION_BOOL("USE_FOG");

    using FPermutationDomain = TShaderPermutationDomain<
        FLightingModeDim,  // 4 variants
        FUseFogDim         // 2 variants
    >;
    // Total: 4 × 2 = 8 Permutations (50% 감소)
};
```

### 기법 3: 플랫폼별 조건부 Permutation

**📂 위치:** `Engine/Shaders/Private/Common.ush`

**HLSL 조건부 컴파일:**

```hlsl
// Common.ush
#if PLATFORM_SUPPORTS_REAL_TYPES  // SM6.6+
    #define USE_16BIT_TYPES 1
#else
    #define USE_16BIT_TYPES 0
#endif

#if PLATFORM_SUPPORTS_WAVE_OPERATIONS  // SM6.0+
    #define USE_WAVE_INTRINSICS 1
#else
    #define USE_WAVE_INTRINSICS 0
#endif
```

**C++ ShouldCompilePermutation():**

```cpp
static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
{
    // Wave Ops 기능 필요 시
#if USE_WAVE_INTRINSICS
    return RHISupportsWaveOperations(Parameters.Platform);
#else
    return true;  // Fallback 경로 항상 컴파일
#endif
}
```

### 기법 4: Sparse Permutation (희소 변형)

**개념:** 모든 조합이 아닌 실제 사용되는 조합만 컴파일

**Before (Dense Permutation):**

```cpp
// 모든 ShadingModel × LightmapPolicy 조합 생성
for (int SM = 0; SM < NumShadingModels; ++SM)
    for (int LM = 0; LM < NumLightmapPolicies; ++LM)
        CompilePermutation(SM, LM);

// = 5 × 6 = 30 Permutations
```

**After (Sparse Permutation):**

```cpp
// 유효한 조합만 명시적 정의
struct FValidCombination
{
    EShadingModel ShadingModel;
    ELightmapPolicy LightmapPolicy;
};

const TArray<FValidCombination> ValidCombinations = {
    {MSM_DefaultLit, LMP_STATIC_LIGHTMAP},
    {MSM_DefaultLit, LMP_NO_LIGHTMAP},
    {MSM_Unlit, LMP_NO_LIGHTMAP},  // Unlit는 라이트맵 불필요
    {MSM_Subsurface, LMP_STATIC_LIGHTMAP},
    // ... (실제 사용하는 8개 조합만)
};

for (const auto& Combo : ValidCombinations)
{
    CompilePermutation(Combo.ShadingModel, Combo.LightmapPolicy);
}

// = 8 Permutations (73% 감소)
```

### 기법 5: Lazy Permutation (지연 컴파일)

**📂 위치:** `Engine.ini`

```ini
[ShaderCompiler]
; 실제 사용 시에만 컴파일
r.ShaderCompiler.LazyPermutations=1

; 쿡 시에는 모든 Permutation 강제 컴파일
r.ShaderCompiler.CookAllPermutations=1
```

**동작 방식:**

```cpp
// 에디터 런타임
if (GShaderCompilerLazyPermutations)
{
    // 필요한 Permutation만 즉시 컴파일
    RequestShaderCompile(Material, PermutationId);
}
else
{
    // 모든 Permutation 미리 컴파일
    for (int32 PermId = 0; PermId < GetPermutationCount(); ++PermId)
    {
        RequestShaderCompile(Material, PermId);
    }
}
```

**효과:**
- 에디터 시작 시간: 5분 → 30초 (10배 빠름)
- 쿡 시간 변화 없음 (모든 조합 컴파일)

---

## 📊 최적화 효과 측정

### 측정 방법 1: 셰이더 통계

```cpp
// 콘솔 명령
r.DumpMaterialStats PCD3D_SM6

// 출력:
// ===== Material Shader Statistics =====
// Material: M_Example
//   Total Shaders: 1,245
//   Vertex Shaders: 423
//   Pixel Shaders: 702
//   Pipeline Shaders: 120
//
//   VertexFactory Usage:
//     FLocalVertexFactory: 480 shaders
//     FGPUSkinVertexFactory: 420 shaders
//     FNiagaraSpriteVF: 200 shaders
//     ...
//
//   Permutation Stats:
//     Average Permutations per ShaderType: 15.2
//     Max Permutations: 48 (TBasePassPS)
//     Min Permutations: 1 (TDepthOnlyPS)
//
//   Memory Usage:
//     Total: 12.4 MB
//     Per Shader Average: 10.2 KB
```

### 측정 방법 2: 컴파일 시간 프로파일링

```cpp
// ShaderCompileWorker 로그 분석
LogShaderCompilers: Display: Compiling 1,245 shaders for Material 'M_Example'
LogShaderCompilers: Display: Finished in 245.3 seconds (avg 0.197s per shader)

// Permutation 별 시간
LogShaderCompilers: Verbose: TBasePassPS Perm=0: 0.21s
LogShaderCompilers: Verbose: TBasePassPS Perm=1: 0.19s
LogShaderCompilers: Verbose: TBasePassPS Perm=2: 0.23s
...
```

### 측정 방법 3: DDC 히트율

```cpp
// -trace=Shaders로 실행 후 Unreal Insights 확인

// Shaders/JobCache/SearchAttempts: 10,000
// Shaders/JobCache/Hits: 8,500
// Cache Hit Rate: 85%

// 최적화 목표:
// - Hit Rate > 90%: 우수
// - Hit Rate 70-90%: 보통
// - Hit Rate < 70%: 개선 필요 (과도한 Permutation)
```

---

## 🚨 대규모 프로젝트 최적화 체크리스트

### 1. Material 최적화

```cpp
✅ Material 속성 최소화
  □ Used with Static Meshes: 필요 시만
  □ Used with Skeletal Meshes: 필요 시만
  □ Used with Particle Systems: 필요 시만
  □ Used with Landscape: 필요 시만

✅ Static Switch Parameter 최소화
  // Before: 5개 Static Switch → 2^5 = 32 Permutations
  // After: 2개로 축소 → 2^2 = 4 Permutations

✅ Material Quality Level 활용
  [Quality Switch]
    ├─ Low: Simple BSDF
    ├─ High: Advanced BSDF
  // Platform별로 다른 Permutation 생성
```

### 2. VertexFactory 최적화

```cpp
✅ 사용하지 않는 VertexFactory 제외
  // 예: Static Mesh 전용 Material
  Used with Skeletal Meshes: false
  → FGPUSkinVertexFactory 조합 모두 제거 (~50% 감소)

✅ Custom VertexFactory 재검토
  // 기존 VertexFactory 확장 가능한지 확인
  // 새 VertexFactory 추가 = 전체 Permutation × 2
```

### 3. 플랫폼 필터링

```cpp
✅ ShouldCompilePermutation에 플랫폼 체크 추가
  if (!IsPCPlatform(Parameters.Platform))
  {
      return false;  // PC 전용 기능
  }

✅ Shader Model 요구사항 명시
  if (GetMaxSupportedFeatureLevel(Parameters.Platform) < ERHIFeatureLevel::SM6)
  {
      return false;  // SM6+ 필수
  }

✅ 모바일 전용 경로 분리
  // Mobile과 Desktop 셰이더 코드 분리
  #if MOBILE_EMULATION
      // 모바일 최적화 경로
  #else
      // PC 고품질 경로
  #endif
```

### 4. Permutation Dimension 재설계

```cpp
✅ Boolean → Enum 변환 (가능한 경우)
  // Before: 3 Bools = 2^3 = 8
  class FFogDim : SHADER_PERMUTATION_BOOL("USE_FOG");
  class FReflectionDim : SHADER_PERMUTATION_BOOL("USE_REFLECTION");
  class FAODim : SHADER_PERMUTATION_BOOL("USE_AO");

  // After: 1 Enum = 4
  enum class EFeatureSet
  {
      Basic,      // No features
      Standard,   // Fog only
      Advanced,   // Fog + AO
      Full,       // Fog + AO + Reflection
  };
  class FFeatureSetDim : SHADER_PERMUTATION_ENUM_CLASS("FEATURE_SET", EFeatureSet);

✅ 상관 관계 제거
  // Fog와 Reflection은 독립적 → 분리 유지
  // Shadow와 AO는 항상 같이 사용 → 묶기
```

### 5. 프로젝트 설정 검토

```ini
; Engine.ini
[ShaderCompiler]
; 최소 Shader Model 설정
r.ShaderCompiler.MinShaderModel=SM6  ; SM5 버전 스킵

; 사용하지 않는 플랫폼 제외
; -CookPlatform=Windows 지정 시 다른 플랫폼 컴파일 안 함

; LazyPermutation 활성화 (에디터)
r.ShaderCompiler.LazyPermutations=1

; 병렬 컴파일 최대화
r.ShaderCompiler.JobCacheMemoryMB=16384
r.ForceAllCoresForShaderCompiling=1
```

---

## 📈 최적화 사례 연구

### Case Study 1: AAA 게임 프로젝트

**Before:**
- Total Materials: 3,500개
- Avg Permutations per Material: 420
- Total Shader Permutations: 1,470,000개
- Compile Time: 18 hours (초기 컴파일)
- ShaderMap Size: 42 GB

**Optimization Steps:**

1. **VertexFactory 사용 제한** (-50%)
   - 각 Material에 Used with 플래그 정확하게 설정
   - Avg Permutations: 420 → 210

2. **ShouldCompilePermutation 강화** (-30%)
   - 플랫폼별 필터링 추가
   - Material 속성 기반 조기 리턴
   - Avg Permutations: 210 → 147

3. **Permutation Dimension 재설계** (-20%)
   - Boolean 7개 → Enum 3개로 통합
   - Avg Permutations: 147 → 118

4. **Sparse Permutation 도입** (-15%)
   - 실제 사용 조합만 컴파일
   - Avg Permutations: 118 → 100

**After:**
- Avg Permutations per Material: 100 (~76% 감소)
- Total Shader Permutations: 350,000개
- Compile Time: 4.5 hours (~75% 감소)
- ShaderMap Size: 10 GB (~76% 감소)

### Case Study 2: 모바일 게임

**Before:**
- 플랫폼: Android ES3.1, iOS Metal
- Permutations: PC 셰이더도 함께 컴파일 (불필요)
- Compile Time: 2.5 hours
- APK Size: 450 MB (셰이더 포함)

**Optimization:**

```cpp
// ShouldCompilePermutation 수정
static bool ShouldCompilePermutation(const FMaterialShaderPermutationParameters& Parameters)
{
    // 모바일 플랫폼만 허용
    if (!IsMobilePlatform(Parameters.Platform))
    {
        return false;
    }

    // Forward Shading 경로만
    if (Parameters.MaterialParameters.bIsUsedWithDeferredShading)
    {
        return false;
    }

    // 고급 기능 제외
    if (Parameters.MaterialParameters.bUsesDistanceFieldShadows ||
        Parameters.MaterialParameters.bUsesPlanarReflection ||
        Parameters.MaterialParameters.bUsesRayTracing)
    {
        return false;
    }

    return true;
}
```

**After:**
- Compile Time: 25 minutes (~83% 감소)
- APK Size: 180 MB (~60% 감소)
- 기능 손실 없음 (모바일에서 사용 안 하는 기능)

---

## 🔗 참조 자료

**소스 파일:**
- `Engine/Source/Runtime/RenderCore/Public/Shader.h` - FShaderPermutationVector
- `Engine/Source/Runtime/Engine/Public/MaterialShaderType.h` - ShouldCompilePermutation
- `Engine/Shaders/Private/Common.ush` - 플랫폼 매크로

**공식 문서:**
- [Shader Permutations](https://docs.unrealengine.com/5.7/en-US/shader-permutations-in-unreal-engine/)
- [Shader Development Best Practices](https://docs.unrealengine.com/5.7/en-US/shader-development-best-practices/)

**CVar 레퍼런스:**
```ini
r.ShaderCompiler.LazyPermutations       ; 지연 컴파일
r.ShaderCompiler.MinShaderModel         ; 최소 Shader Model
r.DumpMaterialStats                     ; Permutation 통계
r.ForceAllCoresForShaderCompiling       ; 병렬 컴파일
```

---

> **마지막 업데이트:** 2025-01-22
>
> **핵심 철학:**
> Shader Permutation은 "성능"과 "컴파일 효율"의 균형입니다.
> - 런타임 분기 제거로 **GPU 성능 최대화**
> - ShouldCompilePermutation()으로 **불필요한 조합 사전 제거**
> - Sparse/Lazy Permutation으로 **컴파일 시간 단축**
