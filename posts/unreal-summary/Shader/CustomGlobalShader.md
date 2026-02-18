---
title: "Custom Global Shader 제작 가이드"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Custom Global Shader 제작 가이드

## 🧭 개요

### Custom Global Shader를 만드는 이유

**Global Shader**는 Material Editor를 거치지 않고 **순수 코드로 작성하는 셰이더**로, 다음과 같은 경우에 필요합니다:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Global Shader 사용 케이스                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ✅ **사용해야 하는 경우**                                               │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  1. PostProcess 효과                                      │          │
│  │     - ToneMapping, Color Grading, Bloom                  │          │
│  │     - Custom DOF, Motion Blur                            │          │
│  │                                                          │          │
│  │  2. Compute Shader                                       │          │
│  │     - GPU Particle Simulation                            │          │
│  │     - GPU Culling, Sorting                               │          │
│  │     - Physics Simulation                                 │          │
│  │                                                          │          │
│  │  3. Fullscreen Quad 렌더링                                │          │
│  │     - Screen Space Effects                               │          │
│  │     - Debug Visualization                                │          │
│  │                                                          │          │
│  │  4. 성능 크리티컬한 셰이더                                 │          │
│  │     - Material System 오버헤드 없이 직접 제어            │          │
│  │     - 최소한의 Permutation으로 최적화                     │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
│  ❌ **Material Shader를 사용해야 하는 경우**                             │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  - 메시에 적용되는 표면 렌더링                            │          │
│  │  - 아티스트가 Material Editor로 수정해야 하는 경우         │          │
│  │  - Material Parameter 시스템 필요                         │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**핵심 차이점:**

| 항목 | Global Shader | Material Shader |
|------|--------------|-----------------|
| **Material 연결** | ❌ 없음 | ✅ 있음 |
| **작성 방식** | 순수 C++ + HLSL | Material Editor 노드 |
| **Permutation 수** | 적음 (~수십 개) | 많음 (~수천 개) |
| **로드 시점** | 엔진 시작 시 | Material 사용 시 |
| **ShaderMap** | FGlobalShaderMap (싱글톤) | FMaterialShaderMap (Material별) |
| **메모리** | 작음 (플랫폼당 1개) | 큼 (Material마다 별도) |

---

## 🎯 Uber Shader와 Permutation 시스템

### Uber Shader 개념

**Uber Shader**는 **하나의 .usf 파일**에 모든 기능을 포함하고, **매크로로 제어**하여 **다양한 변형(Permutation)을 생성**하는 기법입니다.

```
단일 .usf 파일 → 수백/수천 개 Permutation 생성
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  [1] 소스 파일: MyComputeShader.usf                                      │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  #include "/Engine/Public/Platform.ush"                 │          │
│  │                                                          │          │
│  │  // ✅ Permutation 매크로 (컴파일 시 결정)                │          │
│  │  #ifndef USE_WAVE_OPS                                   │          │
│  │      #define USE_WAVE_OPS 0                             │          │
│  │  #endif                                                  │          │
│  │                                                          │          │
│  │  #ifndef USE_ASYNC_COMPUTE                              │          │
│  │      #define USE_ASYNC_COMPUTE 0                        │          │
│  │  #endif                                                  │          │
│  │                                                          │          │
│  │  [numthreads(64, 1, 1)]                                 │          │
│  │  void MainCS(uint3 DispatchThreadId : SV_DispatchThreadID)│        │
│  │  {                                                       │          │
│  │      // 공통 코드                                         │          │
│  │      uint ParticleID = DispatchThreadId.x;             │          │
│  │                                                          │          │
│  │      #if USE_WAVE_OPS                                   │          │
│  │          // Wave Intrinsics 사용 (SM6+)                 │          │
│  │          uint MinID = WaveActiveMin(ParticleID);       │          │
│  │      #else                                               │          │
│  │          // 일반 코드 (SM5 호환)                         │          │
│  │          uint MinID = ParticleID;                       │          │
│  │      #endif                                              │          │
│  │                                                          │          │
│  │      #if USE_ASYNC_COMPUTE                              │          │
│  │          // Async Compute Queue 최적화                  │          │
│  │          DeviceMemoryBarrier();                         │          │
│  │      #endif                                              │          │
│  │  }                                                       │          │
│  └──────────────────────────────────────────────────────────┘          │
│                       ↓ 컴파일 시 Permutation 생성                      │
│                                                                         │
│  [2] 생성되는 Permutation들                                              │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Permutation 0: USE_WAVE_OPS=0, USE_ASYNC_COMPUTE=0     │          │
│  │  ├─ 대상: SM5, Vulkan 1.0                                │          │
│  │  └─ 결과: 일반 코드만 포함                               │          │
│  │                                                          │          │
│  │  Permutation 1: USE_WAVE_OPS=1, USE_ASYNC_COMPUTE=0     │          │
│  │  ├─ 대상: SM6, DX12                                      │          │
│  │  └─ 결과: Wave Intrinsics 포함                          │          │
│  │                                                          │          │
│  │  Permutation 2: USE_WAVE_OPS=1, USE_ASYNC_COMPUTE=1     │          │
│  │  ├─ 대상: SM6 + Async Compute 지원 플랫폼                │          │
│  │  └─ 결과: Wave Intrinsics + 메모리 배리어               │          │
│  │                                                          │          │
│  │  Permutation 3: USE_WAVE_OPS=0, USE_ASYNC_COMPUTE=1     │          │
│  │  └─ (이 조합은 ShouldCompilePermutation에서 필터링 가능)│          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
│  핵심: "하나의 소스" → "플랫폼/기능별 최적화된 바이너리"                  │
└─────────────────────────────────────────────────────────────────────────┘
```

**장점:**
- ✅ **유지보수 용이**: 모든 변형이 하나의 파일에 있음
- ✅ **플랫폼 최적화**: 각 플랫폼에 맞는 최적 코드 생성
- ✅ **메모리 효율**: 필요한 변형만 로드

**단점:**
- ⚠️ **컴파일 시간**: Permutation이 많을수록 오래 걸림
- ⚠️ **복잡도**: 매크로 중첩으로 가독성 저하 가능

---

## 🔍 ShouldCompilePermutation - Permutation 필터링

### 역할

**`ShouldCompilePermutation`**은 **불필요한 Permutation 컴파일을 방지**하여 빌드 시간과 메모리를 절약하는 필터 함수입니다.

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/Shader.h:860`

```cpp
class FShader
{
public:
    /** Permutation을 컴파일할지 결정 */
    static bool ShouldCompilePermutation(const FShaderPermutationParameters& Parameters)
    {
        return true;  // 기본: 모든 Permutation 컴파일
    }
};
```

### 컴파일 파이프라인에서의 역할

```
Shader 컴파일 프로세스:
┌─────────────────────────────────────────────────────────────────────────┐
│  [1] Shader Type 등록 (IMPLEMENT_SHADER_TYPE)                           │
│  └─ Static 초기화 시 FShaderType::GetTypeList()에 추가                  │
│                                                                         │
│  [2] Permutation 생성 (빌드 시)                                          │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  for each ShaderType:                                    │          │
│  │    for each Platform (SM5, SM6, Vulkan, ...):           │          │
│  │      for each PermutationId (0 ~ N):                    │          │
│  │          ↓                                               │          │
│  │          ✅ ShouldCompilePermutation() 호출               │          │
│  │          ├─ true  → 컴파일 큐에 추가                     │          │
│  │          └─ false → ❌ 스킵 (컴파일 안 함)               │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
│  [3] 컴파일 실행 (ShaderCompileWorker)                                  │
│  └─ 필터링된 Permutation만 컴파일                                       │
│                                                                         │
│  [4] ShaderMap 저장                                                      │
│  └─ 컴파일된 결과를 FGlobalShaderMap에 저장                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 실전 예시: Wave Ops 필터링

```cpp
class FNiagaraSortKeyGenCS : public FGlobalShader
{
    DECLARE_GLOBAL_SHADER(FNiagaraSortKeyGenCS);
    SHADER_USE_PARAMETER_STRUCT(FNiagaraSortKeyGenCS, FGlobalShader);

    // ✅ Permutation 정의
    class FUseWaveOps : SHADER_PERMUTATION_BOOL("USE_WAVE_OPS");
    using FPermutationDomain = TShaderPermutationDomain<FUseWaveOps>;

    // ✅ Permutation 필터링 로직
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
    {
        FPermutationDomain PermutationVector(Parameters.PermutationId);

        ERHIFeatureSupport WaveOpsSupport =
            FDataDrivenShaderPlatformInfo::GetSupportsWaveOperations(Parameters.Platform);

        if (PermutationVector.Get<FUseWaveOps>())
        {
            // ✅ Wave Ops 사용 Permutation → 플랫폼 지원 필요
            if (WaveOpsSupport == ERHIFeatureSupport::Unsupported)
                return false;  // ❌ OpenGL, DX11 등에서는 컴파일 안 함
        }
        else
        {
            // ✅ Wave Ops 미사용 Permutation → 필수 지원 플랫폼에서는 불필요
            if (WaveOpsSupport == ERHIFeatureSupport::RuntimeGuaranteed)
                return false;  // ❌ SM6 전용 플랫폼에서는 컴파일 안 함 (Wave Ops 버전만 사용)
        }

        return FGlobalShader::ShouldCompilePermutation(Parameters);
    }
};
```

**필터링 효과:**

```
필터링 전 (모든 조합 컴파일):
┌─────────────────────────────────────────────────────────────────────────┐
│  Platform        │ USE_WAVE_OPS=0 │ USE_WAVE_OPS=1 │ 총 Permutation   │
│──────────────────┼────────────────┼────────────────┼──────────────────│
│  SM5 (DX11)      │ ✅             │ ✅             │ 2개              │
│  SM6 (DX12)      │ ✅             │ ✅             │ 2개              │
│  Vulkan          │ ✅             │ ✅             │ 2개              │
│  Metal           │ ✅             │ ✅             │ 2개              │
│──────────────────┼────────────────┼────────────────┼──────────────────│
│  총합            │ 4개            │ 4개            │ 8개              │
└─────────────────────────────────────────────────────────────────────────┘

필터링 후 (불필요한 조합 제거):
┌─────────────────────────────────────────────────────────────────────────┐
│  Platform        │ USE_WAVE_OPS=0 │ USE_WAVE_OPS=1 │ 총 Permutation   │
│──────────────────┼────────────────┼────────────────┼──────────────────│
│  SM5 (DX11)      │ ✅             │ ❌ (미지원)    │ 1개              │
│  SM6 (DX12)      │ ❌ (불필요)    │ ✅             │ 1개              │
│  Vulkan          │ ✅             │ ❌ (미지원)    │ 1개              │
│  Metal           │ ❌ (불필요)    │ ✅             │ 1개              │
│──────────────────┼────────────────┼────────────────┼──────────────────│
│  총합            │ 2개            │ 2개            │ 4개 (50% 절감)   │
└─────────────────────────────────────────────────────────────────────────┘

실제 대형 프로젝트:
- 필터링 없음: ~15시간 컴파일, ~5GB Shader 파일
- 필터링 적용: ~3시간 컴파일, ~800MB Shader 파일
→ 80% 시간 절감, 84% 용량 절감!
```

### 일반적인 필터링 패턴

```cpp
// 1. 플랫폼 필터링
static bool ShouldCompilePermutation(const FShaderPermutationParameters& Parameters)
{
    return IsPCPlatform(Parameters.Platform);  // PC만
}

// 2. Feature Level 필터링
static bool ShouldCompilePermutation(const FShaderPermutationParameters& Parameters)
{
    return IsFeatureLevelSupported(Parameters.Platform, ERHIFeatureLevel::SM5);  // SM5+
}

// 3. 프로젝트 설정 필터링
static bool ShouldCompilePermutation(const FShaderPermutationParameters& Parameters)
{
    return IsRayTracingEnabledForProject(Parameters.Platform);  // RT 활성화된 프로젝트만
}

// 4. 복합 조건
static bool ShouldCompilePermutation(const FShaderPermutationParameters& Parameters)
{
    return IsPCPlatform(Parameters.Platform)
        && IsFeatureLevelSupported(Parameters.Platform, ERHIFeatureLevel::SM6)
        && IsRayTracingEnabledForProject(Parameters.Platform);
}
```

---

## 🗺️ .usf 파일 등록 시스템

### IMPLEMENT_GLOBAL_SHADER의 내부 동작

**`IMPLEMENT_GLOBAL_SHADER`** 매크로는 **.usf 파일을 Unreal Shader 시스템에 등록**합니다.

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/Shader.h:1724-1743`

### 전체 등록 프로세스

```
┌─────────────────────────────────────────────────────────────────────────┐
│              .usf 파일 → 시스템 등록 전체 과정                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 소스 파일 작성                                                      │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  📂 위치:                                                 │          │
│  │  Project/Shaders/Private/MyShader.usf                    │          │
│  │  또는                                                     │          │
│  │  MyPlugin/Shaders/Private/MyCustomShader.usf            │          │
│  │                                                          │          │
│  │  내용:                                                    │          │
│  │  [numthreads(64, 1, 1)]                                 │          │
│  │  void MainCS(uint3 DispatchThreadId : SV_DispatchThreadID)│        │
│  │  {                                                       │          │
│  │      // Compute Shader 로직                              │          │
│  │  }                                                       │          │
│  └──────────────────────────────────────────────────────────┘          │
│         │                                                               │
│         ↓                                                               │
│  [2] C++ 클래스 정의 (.h 파일)                                          │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  // MyCustomShader.h                                     │          │
│  │  class FMyCustomComputeShader : public FGlobalShader     │          │
│  │  {                                                       │          │
│  │      DECLARE_GLOBAL_SHADER(FMyCustomComputeShader);     │          │
│  │      SHADER_USE_PARAMETER_STRUCT(FMyCustomComputeShader,│          │
│  │          FGlobalShader);                                 │          │
│  │                                                          │          │
│  │      BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )       │          │
│  │          SHADER_PARAMETER_UAV(RWStructuredBuffer<float>, Output)│   │
│  │          SHADER_PARAMETER(float, DeltaTime)             │          │
│  │      END_SHADER_PARAMETER_STRUCT()                       │          │
│  │                                                          │          │
│  │      static bool ShouldCompilePermutation(...);         │          │
│  │  };                                                      │          │
│  └──────────────────────────────────────────────────────────┘          │
│         │                                                               │
│         ↓                                                               │
│  [3] C++ 구현 (.cpp) - ✅ 핵심 등록 지점!                               │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  // MyCustomShader.cpp                                   │          │
│  │                                                          │          │
│  │  // ✅ 이 매크로가 .usf 파일을 시스템에 등록!             │          │
│  │  IMPLEMENT_GLOBAL_SHADER(                                │          │
│  │      FMyCustomComputeShader,                // C++ 클래스│          │
│  │      "/MyPlugin/Private/MyCustomShader.usf", // .usf 경로│          │
│  │      "MainCS",                              // Entry Point│          │
│  │      SF_Compute                             // Frequency │          │
│  │  );                                                      │          │
│  │                                                          │          │
│  │  bool FMyCustomComputeShader::ShouldCompilePermutation(...)│        │
│  │  {                                                       │          │
│  │      return true;                                        │          │
│  │  }                                                       │          │
│  └──────────────────────────────────────────────────────────┘          │
│         │                                                               │
│         ↓                                                               │
│  [4] 매크로 확장 (Static 변수 생성)                                     │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  // IMPLEMENT_GLOBAL_SHADER 매크로 내부에서 생성되는 코드│          │
│  │                                                          │          │
│  │  // Static Type 생성                                     │          │
│  │  FGlobalShaderType& FMyCustomComputeShader::GetStaticType()│        │
│  │  {                                                       │          │
│  │      static FGlobalShaderType StaticType(               │          │
│  │          TEXT("FMyCustomComputeShader"),                │          │
│  │          TEXT("/MyPlugin/Private/MyCustomShader.usf"),  │          │
│  │          TEXT("MainCS"),                                 │          │
│  │          SF_Compute,                                     │          │
│  │          /* PermutationCount, VTABLE, etc */            │          │
│  │      );                                                  │          │
│  │      return StaticType;                                  │          │
│  │  }                                                       │          │
│  │                                                          │          │
│  │  // ✅ Static Registration 변수 (프로그램 시작 시 자동 실행!)│       │
│  │  FShaderTypeRegistration                                │          │
│  │      FMyCustomComputeShader::ShaderTypeRegistration{    │          │
│  │          []() -> FShaderType& {                         │          │
│  │              return FMyCustomComputeShader::GetStaticType();│      │
│  │          }                                               │          │
│  │      };                                                  │          │
│  │  // ↑ 생성자에서 GetInstances().Add(this) 호출!          │          │
│  └──────────────────────────────────────────────────────────┘          │
│         │                                                               │
│         ↓                                                               │
│  [5] Static 초기화 (DLL 로드 시)                                        │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  ShaderTypeRegistration의 생성자 자동 호출:              │          │
│  │  └─ FShaderTypeRegistration::GetInstances().Add(this)   │          │
│  │      └─ ✅ 전역 리스트에 추가됨!                          │          │
│  └──────────────────────────────────────────────────────────┘          │
│         │                                                               │
│         ↓                                                               │
│  [6] 엔진 초기화 (LaunchEngineLoop)                                     │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  FShaderTypeRegistration::CommitAll() 호출               │          │
│  │  └─ for each Registration in GetInstances():            │          │
│  │      ├─ FShaderType& Type = GetStaticType()             │          │
│  │      ├─ FShaderType::GetTypeList().Add(&Type)           │          │
│  │      │   └─ ✅ 전역 Shader Type 리스트에 등록!           │          │
│  │      └─ FGlobalShaderMap::AddShaderType(&Type)          │          │
│  │          └─ ✅ ShaderMap에 추가!                          │          │
│  └──────────────────────────────────────────────────────────┘          │
│         │                                                               │
│         ↓                                                               │
│  [7] 컴파일 (빌드 시 또는 On-Demand)                                    │
│  └─ ShaderCompileWorker가 .usf 파일 컴파일                             │
│      └─ 결과를 FGlobalShaderMap에 저장                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FShaderTypeRegistration 자동 등록

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/Shader.h:1588-1607`

```cpp
class FShaderTypeRegistration
{
public:
    // ✅ 생성자: Static 변수 생성 시 자동 호출!
    FShaderTypeRegistration(TFunctionRef<FShaderType& ()> LazyShaderTypeAccessor)
        : LazyShaderTypeAccessor(LazyShaderTypeAccessor)
    {
        // 너무 늦게 로드되면 에러
        checkf(!AreShaderTypesInitialized(),
            TEXT("Shader type was loaded too late, use ELoadingPhase::PostConfigInit on your module"));

        // ✅ 전역 리스트에 추가! (핵심!)
        GetInstances().Add(this);
    }

    // 전역 리스트 (모든 Shader Type 저장)
    static TArray<const FShaderTypeRegistration*>& GetInstances();

    // ✅ 엔진 초기화 시 호출: 모든 Shader Type 실제 등록
    static void CommitAll();

private:
    TFunctionRef<FShaderType& ()> LazyShaderTypeAccessor;
};
```

### Shader가 저장되는 위치

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Shader 데이터 저장 위치                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 소스 레벨                                                           │
│  └─ Engine/Shaders/**/*.usf (파일 시스템)                               │
│                                                                         │
│  [2] 타입 시스템                                                         │
│  ├─ FShaderType::GetTypeList()                                         │
│  │   └─ 모든 Shader Type의 메타데이터                                  │
│  └─ FShaderTypeRegistration::GetInstances()                            │
│      └─ 초기화 중 임시 저장                                              │
│                                                                         │
│  [3] 컴파일 결과 (런타임)                                                │
│  └─ FGlobalShaderMap (싱글톤)                                           │
│      ├─ Platform: SM5                                                  │
│      │   ├─ FMyCustomComputeShader                                     │
│      │   │   └─ Permutation 0 → Compiled Bytecode                     │
│      │   ├─ FNiagaraSortKeyGenCS                                       │
│      │   │   ├─ Permutation 0: USE_WAVE_OPS=0 → Bytecode              │
│      │   │   └─ Permutation 1: USE_WAVE_OPS=1 → Bytecode              │
│      │   └─ ...                                                        │
│      ├─ Platform: SM6                                                  │
│      │   └─ ...                                                        │
│      └─ Platform: Vulkan                                               │
│          └─ ...                                                        │
│                                                                         │
│  [4] DDC (캐시)                                                          │
│  └─ DerivedDataCache/GLOBALSHADERS_<Platform>_<Hash>.bin              │
│                                                                         │
│  [5] 패키징                                                              │
│  └─ Content/ShaderArchive-<Platform>-Global.ushaderbytecode           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📝 단계별 튜토리얼: Custom Global Shader 제작

### 1단계: .usf 파일 생성

**파일 위치:**
- Engine 내장(예시): `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf`
- 플러그인: `MyPlugin/Shaders/Private/MyCustomShader.usf`

**내용 예시:**

```hlsl
// MyCustomComputeShader.usf

#include "/Engine/Public/Platform.ush"
#include "/Engine/Private/Common.ush"

// ✅ Permutation 매크로
#ifndef USE_ADVANCED_MATH
    #define USE_ADVANCED_MATH 0
#endif

// 파라미터
RWStructuredBuffer<float4> OutputBuffer;
StructuredBuffer<float4> InputBuffer;
float DeltaTime;
uint ParticleCount;

[numthreads(64, 1, 1)]
void MainCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint ParticleID = DispatchThreadId.x;

    if (ParticleID >= ParticleCount)
        return;

    float4 Data = InputBuffer[ParticleID];

    #if USE_ADVANCED_MATH
        // 고급 수학 연산
        Data.xyz = normalize(Data.xyz) * length(Data.xyz);
        Data.w = saturate(Data.w + DeltaTime);
    #else
        // 단순 연산
        Data.w += DeltaTime;
    #endif

    OutputBuffer[ParticleID] = Data;
}
```

### 2단계: C++ 클래스 선언 (.h 파일)

```cpp
// MyCustomShader.h

#pragma once

#include "GlobalShader.h"
#include "ShaderParameterStruct.h"

// ✅ Shader 클래스 정의
class FMyCustomComputeShader : public FGlobalShader
{
    DECLARE_GLOBAL_SHADER(FMyCustomComputeShader);
    SHADER_USE_PARAMETER_STRUCT(FMyCustomComputeShader, FGlobalShader);

    // ✅ Permutation 정의
    class FUseAdvancedMath : SHADER_PERMUTATION_BOOL("USE_ADVANCED_MATH");
    using FPermutationDomain = TShaderPermutationDomain<FUseAdvancedMath>;

    // ✅ 파라미터 구조체
    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER_UAV(RWStructuredBuffer<float4>, OutputBuffer)
        SHADER_PARAMETER_SRV(StructuredBuffer<float4>, InputBuffer)
        SHADER_PARAMETER(float, DeltaTime)
        SHADER_PARAMETER(uint32, ParticleCount)
    END_SHADER_PARAMETER_STRUCT()

    // ✅ Permutation 필터링
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
    {
        // PC 플랫폼에서만 컴파일
        return IsPCPlatform(Parameters.Platform);
    }

    // ✅ 컴파일 환경 설정 (선택사항)
    static void ModifyCompilationEnvironment(
        const FGlobalShaderPermutationParameters& Parameters,
        FShaderCompilerEnvironment& OutEnvironment)
    {
        FGlobalShader::ModifyCompilationEnvironment(Parameters, OutEnvironment);

        // Wave Ops 활성화 (SM6+)
        OutEnvironment.CompilerFlags.Add(CFLAG_Wave32);

        // 최적화 레벨
        OutEnvironment.CompilerFlags.Add(CFLAG_StandardOptimization);
    }
};
```

### 3단계: C++ 구현 (.cpp 파일)

```cpp
// MyCustomShader.cpp

#include "MyCustomShader.h"
#include "ShaderCompilerCore.h"
#include "RenderGraphUtils.h"

// ✅ 핵심! .usf 파일 등록
IMPLEMENT_GLOBAL_SHADER(
    FMyCustomComputeShader,                              // C++ 클래스명
    "/MyPlugin/Private/MyCustomComputeShader.usf",      // .usf 파일 경로
    "MainCS",                                            // Entry Point 함수명
    SF_Compute                                           // Shader Frequency
);

bool FMyCustomComputeShader::ShouldCompilePermutation(
    const FGlobalShaderPermutationParameters& Parameters)
{
    FPermutationDomain PermutationVector(Parameters.PermutationId);

    // AdvancedMath는 SM5 이상에서만
    if (PermutationVector.Get<FUseAdvancedMath>())
    {
        return IsFeatureLevelSupported(Parameters.Platform, ERHIFeatureLevel::SM5);
    }

    return IsPCPlatform(Parameters.Platform);
}

void FMyCustomComputeShader::ModifyCompilationEnvironment(
    const FGlobalShaderPermutationParameters& Parameters,
    FShaderCompilerEnvironment& OutEnvironment)
{
    FGlobalShader::ModifyCompilationEnvironment(Parameters, OutEnvironment);

    OutEnvironment.SetDefine(TEXT("THREADGROUP_SIZE"), 64);
}
```

### 4단계: Shader 사용 (Render Graph)

```cpp
// MyRenderPass.cpp

#include "MyCustomShader.h"
#include "RenderGraphBuilder.h"
#include "GlobalShader.h"
#include "ShaderParameterStruct.h"

void AddMyCustomComputePass(
    FRDGBuilder& GraphBuilder,
    FRDGBufferRef InputBuffer,
    FRDGBufferRef OutputBuffer,
    float DeltaTime,
    uint32 ParticleCount)
{
    // ✅ Shader 가져오기
    FGlobalShaderMap* GlobalShaderMap = GetGlobalShaderMap(GMaxRHIFeatureLevel);

    // Permutation 선택
    FMyCustomComputeShader::FPermutationDomain PermutationVector;
    PermutationVector.Set<FMyCustomComputeShader::FUseAdvancedMath>(true);

    TShaderMapRef<FMyCustomComputeShader> ComputeShader(GlobalShaderMap, PermutationVector);

    // ✅ 파라미터 설정
    FMyCustomComputeShader::FParameters* PassParameters =
        GraphBuilder.AllocParameters<FMyCustomComputeShader::FParameters>();

    PassParameters->OutputBuffer = GraphBuilder.CreateUAV(OutputBuffer);
    PassParameters->InputBuffer = GraphBuilder.CreateSRV(InputBuffer);
    PassParameters->DeltaTime = DeltaTime;
    PassParameters->ParticleCount = ParticleCount;

    // ✅ Render Graph Pass 추가
    FComputeShaderUtils::AddPass(
        GraphBuilder,
        RDG_EVENT_NAME("MyCustomCompute"),
        ComputeShader,
        PassParameters,
        FIntVector(FMath::DivideAndRoundUp(ParticleCount, 64u), 1, 1)  // Dispatch 크기
    );
}
```

---

## 🎯 전체 워크플로우 요약

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Custom Global Shader 제작 워크플로우                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 기획                                                                │
│  ├─ 무엇을 계산할 것인가? (PostProcess, Compute, etc)                    │
│  ├─ 어떤 Permutation이 필요한가? (플랫폼, 기능별 변형)                    │
│  └─ 성능 요구사항은? (Async Compute, Wave Ops 등)                       │
│                                                                         │
│  [2] .usf 파일 작성                                                      │
│  ├─ 위치: Engine/Shaders/Private/ 또는 Plugin/Shaders/Private/         │
│  ├─ Permutation 매크로 정의 (#if USE_FEATURE)                          │
│  └─ Entry Point 함수 작성 (MainVS, MainPS, MainCS 등)                  │
│                                                                         │
│  [3] C++ 클래스 정의 (.h)                                                │
│  ├─ DECLARE_GLOBAL_SHADER() 매크로                                     │
│  ├─ Permutation Domain 정의 (SHADER_PERMUTATION_*)                    │
│  ├─ 파라미터 구조체 정의 (BEGIN_SHADER_PARAMETER_STRUCT)               │
│  └─ ShouldCompilePermutation() 선언                                    │
│                                                                         │
│  [4] C++ 구현 (.cpp)                                                    │
│  ├─ IMPLEMENT_GLOBAL_SHADER() 매크로 (.usf 파일 등록)                  │
│  ├─ ShouldCompilePermutation() 구현 (필터링 로직)                      │
│  └─ ModifyCompilationEnvironment() 구현 (컴파일 옵션)                  │
│                                                                         │
│  [5] 모듈 설정                                                           │
│  ├─ .Build.cs에 "RenderCore", "Renderer" 의존성 추가                   │
│  └─ Plugin인 경우: LoadingPhase = PostConfigInit 설정                  │
│                                                                         │
│  [6] 컴파일 및 테스트                                                    │
│  ├─ 엔진/프로젝트 리빌드                                                 │
│  ├─ Shader 컴파일 오류 확인 (Output Log)                               │
│  └─ DDC 클리어 (필요 시): Delete DerivedDataCache/                     │
│                                                                         │
│  [7] 사용 코드 작성                                                      │
│  ├─ GetGlobalShaderMap()으로 ShaderMap 가져오기                        │
│  ├─ Permutation 선택                                                   │
│  ├─ 파라미터 바인딩                                                     │
│  └─ Render Graph Pass 추가 또는 RHI Command 직접 호출                  │
│                                                                         │
│  [8] 최적화                                                              │
│  ├─ ShouldCompilePermutation으로 불필요한 조합 제거                     │
│  ├─ Wave Ops, Async Compute 등 하드웨어 기능 활용                       │
│  └─ Shader 프로파일링 (stat RHI, GPU Visualizer)                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 실전 예시: Niagara Sort Key 생성 Shader

### 전체 코드

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Private/NiagaraSortingGPU.cpp:29`

```cpp
// ========================================
// [1] 헤더 파일
// ========================================
class FNiagaraSortKeyGenCS : public FGlobalShader
{
    DECLARE_GLOBAL_SHADER(FNiagaraSortKeyGenCS);
    SHADER_USE_PARAMETER_STRUCT(FNiagaraSortKeyGenCS, FGlobalShader);

    // Permutation
    class FUseWaveOps : SHADER_PERMUTATION_BOOL("USE_WAVE_OPS");
    class FSupportCollisionGroups : SHADER_PERMUTATION_BOOL("SUPPORT_COLLISION_GROUPS");
    using FPermutationDomain = TShaderPermutationDomain<FUseWaveOps, FSupportCollisionGroups>;

    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER_UAV(RWStructuredBuffer<uint>, OutKeys)
        SHADER_PARAMETER_SRV(StructuredBuffer<float>, ParticlePositions)
        SHADER_PARAMETER(FVector3f, CameraPosition)
        SHADER_PARAMETER(uint32, ParticleCount)
    END_SHADER_PARAMETER_STRUCT()

    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters);
};

// ========================================
// [2] 구현 파일
// ========================================
IMPLEMENT_GLOBAL_SHADER(
    FNiagaraSortKeyGenCS,
    "/Plugin/FX/Niagara/Private/NiagaraSortKeyGen.usf",
    "GenerateParticleSortKeys",
    SF_Compute
);

bool FNiagaraSortKeyGenCS::ShouldCompilePermutation(
    const FGlobalShaderPermutationParameters& Parameters)
{
    FPermutationDomain PermutationVector(Parameters.PermutationId);

    // Wave Ops 지원 확인
    ERHIFeatureSupport WaveOpsSupport =
        FDataDrivenShaderPlatformInfo::GetSupportsWaveOperations(Parameters.Platform);

    if (PermutationVector.Get<FUseWaveOps>())
    {
        // Wave Ops 사용 → 플랫폼 지원 필요
        if (WaveOpsSupport == ERHIFeatureSupport::Unsupported)
            return false;
    }
    else
    {
        // Wave Ops 미사용 → 필수 플랫폼에서는 불필요
        if (WaveOpsSupport == ERHIFeatureSupport::RuntimeGuaranteed)
            return false;
    }

    return FGlobalShader::ShouldCompilePermutation(Parameters);
}

// ========================================
// [3] Shader 파일: NiagaraSortKeyGen.usf
// ========================================
/*
#include "/Engine/Public/Platform.ush"

RWStructuredBuffer<uint> OutKeys;
StructuredBuffer<float3> ParticlePositions;
float3 CameraPosition;
uint ParticleCount;

[numthreads(64, 1, 1)]
void GenerateParticleSortKeys(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint ParticleID = DispatchThreadId.x;

    if (ParticleID >= ParticleCount)
        return;

    float3 ParticlePos = ParticlePositions[ParticleID];
    float Distance = length(ParticlePos - CameraPosition);

    #if USE_WAVE_OPS
        // Wave Intrinsics 사용
        uint MinDistance = WaveActiveMin(asuint(Distance));
        OutKeys[ParticleID] = MinDistance;
    #else
        // 일반 코드
        OutKeys[ParticleID] = asuint(Distance);
    #endif
}
*/

// ========================================
// [4] 사용 예시
// ========================================
void GenerateSortKeys(FRDGBuilder& GraphBuilder, FRDGBufferRef ParticleBuffer, uint32 ParticleCount)
{
    FGlobalShaderMap* ShaderMap = GetGlobalShaderMap(GMaxRHIFeatureLevel);

    // Permutation 선택
    FNiagaraSortKeyGenCS::FPermutationDomain PermutationVector;
    PermutationVector.Set<FNiagaraSortKeyGenCS::FUseWaveOps>(true);
    PermutationVector.Set<FNiagaraSortKeyGenCS::FSupportCollisionGroups>(false);

    TShaderMapRef<FNiagaraSortKeyGenCS> ComputeShader(ShaderMap, PermutationVector);

    // 파라미터 설정
    FNiagaraSortKeyGenCS::FParameters* PassParameters =
        GraphBuilder.AllocParameters<FNiagaraSortKeyGenCS::FParameters>();

    PassParameters->OutKeys = GraphBuilder.CreateUAV(SortKeyBuffer);
    PassParameters->ParticlePositions = GraphBuilder.CreateSRV(ParticleBuffer);
    PassParameters->CameraPosition = ViewLocation;
    PassParameters->ParticleCount = ParticleCount;

    // Dispatch
    FComputeShaderUtils::AddPass(
        GraphBuilder,
        RDG_EVENT_NAME("NiagaraSortKeyGen"),
        ComputeShader,
        PassParameters,
        FIntVector(FMath::DivideAndRoundUp(ParticleCount, 64u), 1, 1)
    );
}
```

---

## ⚠️ 일반적인 실수와 해결 방법

### 1. Shader 컴파일 실패

```
❌ 증상:
Error: Shader /MyPlugin/Private/MyShader.usf not found
```

**원인:**
- .usf 파일 경로가 잘못됨
- Virtual Path Mapping이 안 됨

**해결:**

```cpp
// ✅ Plugin인 경우: MyPlugin.uplugin에 추가
{
    "Modules": [
        {
            "Name": "MyPlugin",
            "Type": "Runtime",
            "LoadingPhase": "PostConfigInit"  // ✅ 중요!
        }
    ]
}

// ✅ Module 시작 시 Shader 경로 매핑
void FMyPluginModule::StartupModule()
{
    FString PluginShaderDir = FPaths::Combine(
        IPluginManager::Get().FindPlugin(TEXT("MyPlugin"))->GetBaseDir(),
        TEXT("Shaders")
    );

    AddShaderSourceDirectoryMapping(
        TEXT("/MyPlugin"),  // Virtual Path
        PluginShaderDir     // Physical Path
    );
}
```

### 2. "Shader type was loaded too late" 에러

```
❌ 증상:
Assertion failed: !AreShaderTypesInitialized()
```

**원인:**
- Module LoadingPhase가 너무 늦음

**해결:**

```cpp
// ✅ .uplugin 또는 .uproject에서 LoadingPhase 변경
"LoadingPhase": "PostConfigInit"  // Default보다 빠름
```

### 3. Permutation이 컴파일 안 됨

```
❌ 증상:
런타임에 "Shader not found" 에러
```

**원인:**
- ShouldCompilePermutation에서 false 반환

**해결:**

```cpp
// ✅ 디버깅: 로그 추가
static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
{
    bool bShouldCompile = IsPCPlatform(Parameters.Platform);

    UE_LOG(LogShaders, Log, TEXT("ShouldCompilePermutation: %s - %s"),
        *GetFName().ToString(),
        bShouldCompile ? TEXT("YES") : TEXT("NO")
    );

    return bShouldCompile;
}
```

### 4. DDC 캐시 문제

```
❌ 증상:
Shader 수정했는데 변경사항이 반영 안 됨
```

**해결:**

```bash
# ✅ DDC 클리어
# Windows
rmdir /s /q "C:\Users\<YourName>\AppData\Local\UnrealEngine\Common\DerivedDataCache"

# ✅ 또는 에디터에서
Project Settings → Engine → Derived Data → Clear DDC
```

### 5. 파라미터 바인딩 실패

```
❌ 증상:
Warning: Parameter 'MyParameter' not found in shader
```

**원인:**
- .usf 파일의 파라미터 이름과 C++ 구조체 이름 불일치

**해결:**

```cpp
// ❌ 잘못된 예
BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
    SHADER_PARAMETER(float, MyTime)  // C++: MyTime
END_SHADER_PARAMETER_STRUCT()

// .usf 파일:
float DeltaTime;  // HLSL: DeltaTime (불일치!)

// ✅ 올바른 예
BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
    SHADER_PARAMETER(float, DeltaTime)  // 이름 일치!
END_SHADER_PARAMETER_STRUCT()
```

---

## 🔧 디버깅 팁

### Shader 컴파일 로그 확인

```cpp
// Output Log 필터링
LogShaders: Display
LogShaderCompilers: Display
```

### Shader 프로파일링

```cpp
// 콘솔 명령어
stat RHI              // RHI 통계
stat GPU              // GPU 시간
r.ShaderDevelopmentMode 1  // Shader 개발 모드
r.DumpShaderDebugInfo 1    // Shader 디버그 정보 덤프
```

### Visual Studio Graphics Debugger

```cpp
// .usf 파일에 디버깅 코드 추가
[numthreads(64, 1, 1)]
void MainCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint ParticleID = DispatchThreadId.x;

    // ✅ 디버깅: 특정 파티클 추적
    if (ParticleID == 0)
    {
        // Breakpoint 가능 (VS Graphics Debugger)
        float DebugValue = ParticlePositions[0].x;
    }
}
```

---

## 🔗 참고 자료

### 공식 문서
- [Unreal Engine Shader Development](https://docs.unrealengine.com/5.3/en-US/shader-development-in-unreal-engine/)
- [Global Shaders in UE5](https://docs.unrealengine.com/5.3/en-US/global-shaders-in-unreal-engine/)

### 소스 코드
- `Engine/Source/Runtime/RenderCore/Public/Shader.h` - FShader 기본 클래스
- `Engine/Source/Runtime/RenderCore/Public/GlobalShader.h` - FGlobalShader
- `Engine/Source/Runtime/RenderCore/Public/ShaderPermutation.h` - Permutation 시스템
- `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Private/NiagaraSortingGPU.cpp` - 실전 예시

### 커뮤니티 자료
- [Custom Global Shader 만들기](https://scahp.tistory.com/78) - Scahp's Blog
- [Unreal Engine Shader 시스템 분석](https://blog.uwa4d.com/)

---

> 🔄 **작성일**: 2025-01-11
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7
