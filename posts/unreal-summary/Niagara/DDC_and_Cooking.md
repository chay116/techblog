---
title: "Niagara DDC 및 쿠킹 시스템 (Derived Data Cache & Cooking System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara DDC 및 쿠킹 시스템 (Derived Data Cache & Cooking System)

## 🧭 개요 (Overview)

Niagara의 DDC 시스템은 **VM 바이트코드**와 **GPU 셰이더**의 컴파일 결과를 캐싱하여 재컴파일을 방지하고 빌드 속도를 향상시킵니다. 두 가지 주요 경로가 있습니다:

1. **VM 바이트코드 (CPU 시뮬레이션)** → `FNiagaraVMExecutableDataId` 기반 DDC 키 생성
2. **GPU 셰이더 (GPU Compute)** → `FNiagaraShaderMapId` 기반 DDC 키 생성

## 🧱 구조 (Structure)

### 계층별 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     상위 레이어: 스크립트 컴파일 요청                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  UNiagaraScript::RequestCompile()                                        │
│  UNiagaraScript::RequestExternallyManagedAsyncCompile()                  │
│                                                                           │
│  ├─> ComputeVMCompilationId()  ──> FNiagaraVMExecutableDataId 생성      │
│  └─> GetNiagaraDDCKeyString()  ──> DDC 키 생성                          │
│                                                                           │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                     중간 레이어: DDC 캐시 조회/저장                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  GetDerivedDataCacheRef().GetSynchronous()  // DDC에서 읽기              │
│  GetDerivedDataCacheRef().Put()            // DDC에 쓰기                 │
│                                                                           │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │ VM 바이트코드 경로       │  │ GPU 셰이더 경로          │              │
│  │ - BuildNiagaraDDCKeyString│  │ - GetNiagaraShaderMapKeyString│       │
│  │ - BinaryToExecData      │  │ - FNiagaraShaderMap::    │              │
│  │ - ExecToBinaryData      │  │   LoadFromDerivedDataCache│             │
│  └─────────────────────────┘  └─────────────────────────┘              │
│                                                                           │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                     하위 레이어: 컴파일 실행                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  FNiagaraHlslTranslator::Translate()  // HLSL 코드 생성                  │
│  FNiagaraShaderType::BeginCompileShader()  // GPU 셰이더 컴파일          │
│  FVectorVMCompiler::Compile()  // VM 바이트코드 생성                     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🧩 핵심 API (Key APIs)

### 1. VM 바이트코드 DDC 키 생성

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp:992`

#### `UNiagaraScript::BuildNiagaraDDCKeyString()`

```cpp
// NiagaraScript.cpp:992
FString UNiagaraScript::BuildNiagaraDDCKeyString(
    const FNiagaraVMExecutableDataId& CompileId,
    const FString& ScriptPath)
{
    enum { UE_NIAGARA_COMPILATION_DERIVEDDATA_VER = 3 };

    FString KeyString;
    KeyString.Reserve(1024);

    // 1. 버전 정보 추가
    KeyString.Appendf(TEXT("%i_%i"),
        (int32)UE_NIAGARA_COMPILATION_DERIVEDDATA_VER,
        GNiagaraSkipVectorVMBackendOptimizations);

    KeyString.AppendChar(TCHAR('_'));

    // 2. 스크립트 경로 (고유 식별자)
    KeyString.Append(ScriptPath);
    KeyString.AppendChar(TCHAR('_'));

    // 3. 컴파일 ID의 모든 요소 추가
    CompileId.AppendKeyString(KeyString);

    // 4. DDC 버전과 함께 최종 키 생성
    return FDerivedDataCacheInterface::BuildCacheKey(
        TEXT("NiagaraScriptDerivedData"),
        NIAGARASCRIPT_DERIVEDDATA_VER,
        *KeyString);
}
```

#### `FNiagaraVMExecutableDataId` 구조

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScript.h:241`

```cpp
// NiagaraScript.h:241
USTRUCT()
struct FNiagaraVMExecutableDataId
{
    GENERATED_USTRUCT_BODY()

    // 컴파일러 버전
    UPROPERTY()
    FGuid CompilerVersionID;

    // 보간 스폰 모드
    UPROPERTY()
    ENiagaraInterpolatedSpawnMode InterpolatedSpawnMode;

#if WITH_EDITORONLY_DATA
    // 스크립트 사용 타입 (Spawn, Update 등)
    UPROPERTY()
    FGuid ScriptUsageTypeID;

    UPROPERTY()
    ENiagaraScriptUsage ScriptUsageType;

    // 추가 정의 (예: CompressAttributes, TrimAttributes)
    UPROPERTY()
    TArray<FString> AdditionalDefines;

    // 추가 변수 (Static Switches 등)
    UPROPERTY()
    TArray<FNiagaraVariableBase> AdditionalVariables;

    UPROPERTY()
    uint32 bDisableDebugSwitches : 1;

    UPROPERTY()
    uint32 bRequiresPersistentIDs : 1;

    // Rapid Iteration 파라미터 사용 여부
    UPROPERTY()
    uint32 bUsesRapidIterationParams : 1;
#endif

    // 스크립트 그래프의 해시 (가장 중요한 요소)
    UPROPERTY()
    FNiagaraCompileHash BaseScriptCompileHash;

#if WITH_EDITORONLY_DATA
    // 의존성 스크립트들의 해시
    UPROPERTY()
    TArray<FNiagaraCompileHash> ReferencedCompileHashes;

    // 스크립트 버전
    UPROPERTY()
    FGuid ScriptVersionID;
#endif
};
```

#### `FNiagaraVMExecutableDataId::AppendKeyString()`

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp:843`

```cpp
// NiagaraScript.cpp:843
void FNiagaraVMExecutableDataId::AppendKeyString(
    FString& KeyString,
    const FString& Delimiter,
    bool bAppendObjectForDebugging,
    const FNiagaraScriptHashCollector* HashCollector) const
{
    // 1. 스크립트 사용 타입
    KeyString += FString::Printf(TEXT("%d%s"),
        (int32)ScriptUsageType, *Delimiter);
    KeyString += ScriptUsageTypeID.ToString() + Delimiter;

    // 2. 컴파일러 버전
    KeyString += CompilerVersionID.ToString() + Delimiter;

    // 3. 베이스 스크립트 해시 (가장 중요!)
    KeyString += BaseScriptCompileHash.ToString() + Delimiter;

    // 4. Rapid Iteration 파라미터 사용 여부
    KeyString += (bUsesRapidIterationParams ? TEXT("USESRI") : TEXT("NORI")) + Delimiter;

    // 5. 디버그 스위치 설정
    KeyString += (bDisableDebugSwitches ? TEXT("DISBALEDEBUGSWITCH") : TEXT("ALLOWDEBUGSWITCH")) + Delimiter;

    // 6. 추가 정의 (예: CompressAttributes, TrimAttributes)
    for (const FString& Define : AdditionalDefines)
    {
        KeyString += Define + Delimiter;
    }

    // 7. 추가 변수 (Static Switches)
    for (const FNiagaraVariableBase& Var : AdditionalVariables)
    {
        KeyString += Var.GetName().ToString() + Delimiter;
        KeyString += Var.GetType().GetName() + Delimiter;
    }

    // 8. 참조된 컴파일 해시 (의존성)
    for (const FNiagaraCompileHash& Hash : ReferencedCompileHashes)
    {
        KeyString += Hash.ToString();
    }
}
```

### 2. GPU 셰이더 DDC 키 생성

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraShader/Private/NiagaraShader.cpp:536`

#### `GetNiagaraShaderMapKeyString()`

```cpp
// NiagaraShader.cpp:536
static FString GetNiagaraShaderMapKeyString(
    const FNiagaraShaderMapId& ShaderMapId,
    EShaderPlatform Platform)
{
    static const FString NIAGARASHADERMAP_DERIVEDDATA_VER =
        FDevSystemGuids::GetSystemGuid(
            FDevSystemGuids::Get().NIAGARASHADERMAP_DERIVEDDATA_VER
        ).ToString(EGuidFormats::DigitsWithHyphens);

    FName Format = LegacyShaderPlatformToShaderFormat(Platform);

    // 1. 플랫폼과 포맷 버전
    FString ShaderMapKeyString =
        Format.ToString() + TEXT("_") +
        FString::FromInt(GetTargetPlatformManagerRef().ShaderFormatVersion(Format)) +
        TEXT("_");

    // 2. 나이아가라 특화 설정
    NiagaraShaderMapAppendKeyString(Platform, ShaderMapKeyString);

    // 3. 공통 셰이더 맵 설정
    ShaderMapAppendKeyString(Platform, ShaderMapKeyString);

    // 4. 셰이더 맵 ID 추가
    ShaderMapId.AppendKeyString(ShaderMapKeyString);

    // 5. 최종 DDC 키 생성
    return FDerivedDataCacheInterface::BuildCacheKey(
        TEXT("NIAGARASM"),
        *NIAGARASHADERMAP_DERIVEDDATA_VER,
        *ShaderMapKeyString);
}
```

#### `FNiagaraShaderMapId` 구조

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraShader/Public/NiagaraShared.h:321`

```cpp
// NiagaraShared.h:321
class FNiagaraShaderMapId
{
    DECLARE_TYPE_LAYOUT(FNiagaraShaderMapId, NonVirtual);
public:
    // 컴파일러 버전
    LAYOUT_FIELD(FGuid, CompilerVersionID);

    // Feature Level (SM5, SM6 등)
    LAYOUT_FIELD(ERHIFeatureLevel::Type, FeatureLevel);

    // 추가 정의 (GPU 특화 설정)
    LAYOUT_FIELD(TMemoryImageArray<FMemoryImageString>, AdditionalDefines);

    // 추가 변수
    LAYOUT_FIELD(TMemoryImageArray<FMemoryImageString>, AdditionalVariables);

    // 베이스 컴파일 해시 (VM과 동일한 그래프 해시 사용)
    LAYOUT_FIELD(FSHAHash, BaseCompileHash);

    // 의존성 스크립트 해시
    LAYOUT_FIELD(TMemoryImageArray<FSHAHash>, ReferencedCompileHashes);

    // 메모리 레이아웃 파라미터 (플랫폼별 차이)
    LAYOUT_FIELD(FPlatformTypeLayoutParameters, LayoutParams);

    // 셰이더 타입 의존성
    LAYOUT_FIELD(TMemoryImageArray<FShaderTypeDependency>, ShaderTypeDependencies);

    // Rapid Iteration 파라미터 사용 여부
    LAYOUT_FIELD_INITIALIZED(bool, bUsesRapidIterationParams, true);
};
```

#### `FNiagaraShaderMapId::GetScriptHash()`

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraShader/Private/NiagaraShader.cpp:154`

```cpp
// NiagaraShader.cpp:154
void FNiagaraShaderMapId::GetScriptHash(FSHAHash& OutHash) const
{
    FSHA1 HashState;

    // 1. 컴파일러 버전
    HashState.Update((const uint8*)&CompilerVersionID, sizeof(CompilerVersionID));

    // 2. 베이스 컴파일 해시
    HashState.Update(BaseCompileHash.Hash, FNiagaraCompileHash::HashSize);

    // 3. Feature Level
    HashState.Update((const uint8*)&FeatureLevel, sizeof(FeatureLevel));

    // 4. 추가 정의
    for (const FMemoryImageString& Define : AdditionalDefines)
    {
        HashState.UpdateWithString(*Define, Define.Len());
    }

    // 5. 추가 변수
    for (const FMemoryImageString& Var : AdditionalVariables)
    {
        HashState.UpdateWithString(*Var, Var.Len());
    }

    // 6. 참조된 컴파일 해시
    for (const FSHAHash& Hash : ReferencedCompileHashes)
    {
        HashState.Update(Hash.Hash, FNiagaraCompileHash::HashSize);
    }

    // 7. 셰이더 타입 의존성
    for (const FShaderTypeDependency& Dependency : ShaderTypeDependencies)
    {
        HashState.Update(Dependency.SourceHash.Hash, sizeof(Dependency.SourceHash));
    }

    HashState.Final();
    HashState.GetHash(&OutHash.Hash[0]);
}
```

### 3. DDC 조회 및 저장

#### VM 바이트코드 DDC 조회

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp:3242`

```cpp
// NiagaraScript.cpp:3242
void UNiagaraScript::RequestCompile(const FGuid& ScriptVersion, bool bForceCompile)
{
    // ... 생략 ...

    TArray<uint8> OutData;

    // DDC에서 먼저 조회
    if (!bForceCompile &&
        GetDerivedDataCacheRef().GetSynchronous(
            *GetNiagaraDDCKeyString(ScriptVersion, ScriptPathName),
            OutData,
            ScriptPathName))
    {
        // DDC 히트: 바이너리 데이터를 실행 가능한 데이터로 변환
        FNiagaraVMExecutableData ExeData;
        if (BinaryToExecData(this, OutData, ExeData))
        {
            COOK_STAT(Timer.AddHit(OutData.Num()));
            SetVMCompilationResults(LastGeneratedVMId, ExeData,
                FString(), RequestDuplicateData->GetObjectNameMap(), false);
            return;
        }
    }

    // DDC 미스: 새로 컴파일
    FNiagaraCompileOptions Options(GetUsage(), GetUsageId(),
        ScriptData->ModuleUsageBitmask, ScriptPathName, GetFullName(), GetName());
    int32 JobHandle = NiagaraModule.StartScriptCompileJob(
        RequestData.Get(), RequestDuplicateData.Get(), Options);

    TSharedPtr<FNiagaraVMExecutableData> ExeData =
        NiagaraModule.GetCompileJobResult(JobHandle, true, ScriptMetrics);

    if (ExeData)
    {
        SetVMCompilationResults(LastGeneratedVMId, *ExeData,
            FString(), RequestDuplicateData->GetObjectNameMap(), false);

        // DDC에 저장
        if (ExecToBinaryData(this, OutData, *ExeData))
        {
            COOK_STAT(Timer.AddMiss(OutData.Num()));
            GetDerivedDataCacheRef().Put(
                *GetNiagaraDDCKeyString(ScriptVersion, ScriptPathName),
                OutData,
                ScriptPathName);
        }
    }
}
```

#### GPU 셰이더 DDC 조회

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraShader/Private/NiagaraShader.cpp:549`

```cpp
// NiagaraShader.cpp:549
void FNiagaraShaderMap::LoadFromDerivedDataCache(
    const FNiagaraShaderScript* Script,
    const FNiagaraShaderMapId& ShaderMapId,
    EShaderPlatform Platform,
    FNiagaraShaderMapRef& InOutShaderMap)
{
    if (InOutShaderMap != NULL)
    {
        // 메모리에 있지만 불완전한 경우
        check(InOutShaderMap->GetShaderPlatform() == Platform);
        InOutShaderMap->LoadMissingShadersFromMemory(Script);
    }
    else
    {
        // DDC에서 로드 시도
        TArray<uint8> CachedData;
        const FString DataKey = GetNiagaraShaderMapKeyString(ShaderMapId, Platform);

        if (GetDerivedDataCacheRef().GetSynchronous(
            *DataKey, CachedData, Script->GetFriendlyName()))
        {
            COOK_STAT(Timer.AddHit(CachedData.Num()));
            InOutShaderMap = new FNiagaraShaderMap();
            FMemoryReader Ar(CachedData, true);
            FShaderSerializeContext Ctx(Ar);

            // 역직렬화
            if (InOutShaderMap->Serialize(Ctx))
            {
                check(InOutShaderMap->GetShaderMapId() == ShaderMapId);

                // 글로벌 맵에 등록
                InOutShaderMap->Register(Platform);
            }
            else
            {
                // 직렬화 실패 (셰이더 파라미터 변경 등)
                COOK_STAT(Timer.TrackCyclesOnly());
                InOutShaderMap = nullptr;
            }
        }
        else
        {
            // DDC 미스
            COOK_STAT(Timer.TrackCyclesOnly());
            InOutShaderMap = nullptr;
        }
    }
}
```

#### GPU 셰이더 DDC 저장

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraShader/Private/NiagaraShader.cpp:600`

```cpp
// NiagaraShader.cpp:600
void FNiagaraShaderMap::SaveToDerivedDataCache(const FNiagaraShaderScript* Script)
{
    COOK_STAT(auto Timer = NiagaraShaderCookStats::UsageStats.TimeSyncWork());

    TArray<uint8> SaveData;
    FMemoryWriter Ar(SaveData, true);
    FShaderSerializeContext Ctx(Ar);

    // 직렬화
    Serialize(Ctx);

    // DDC에 저장
    GetDerivedDataCacheRef().Put(
        *GetNiagaraShaderMapKeyString(
            GetContent()->ShaderMapId,
            GetShaderPlatform()),
        SaveData,
        Script ? Script->GetFriendlyName() : TEXT(""));

    COOK_STAT(Timer.AddMiss(SaveData.Num()));
}
```

## 💡 VM vs GPU DDC 처리 차이 (Key Differences)

### 비교표

| 항목 | VM 바이트코드 (CPU) | GPU 셰이더 |
|------|---------------------|------------|
| **DDC 키 구조** | `FNiagaraVMExecutableDataId` | `FNiagaraShaderMapId` |
| **주요 해시** | `BaseScriptCompileHash` (FNiagaraCompileHash) | `BaseCompileHash` (FSHAHash) |
| **플랫폼 의존성** | ❌ 플랫폼 독립적 | ✅ 플랫폼별 (SM5, SM6 등) |
| **Feature Level** | ❌ 없음 | ✅ ERHIFeatureLevel::Type |
| **셰이더 타입 의존성** | ❌ 없음 | ✅ ShaderTypeDependencies |
| **메모리 레이아웃** | ❌ 없음 | ✅ FPlatformTypeLayoutParameters |
| **컴파일 출력** | VM 바이트코드 (TArray<uint8>) | 컴파일된 셰이더 코드 |
| **DDC 버전 키** | `NiagaraScriptDerivedData` | `NIAGARASM` |
| **직렬화 방식** | `BinaryToExecData` / `ExecToBinaryData` | `FShaderSerializeContext` |
| **글로벌 캐시** | ❌ 없음 | ✅ `GIdToNiagaraShaderMap` |

### VM 바이트코드 특징

```cpp
// VM은 플랫폼 독립적
FNiagaraVMExecutableDataId VMId;
VMId.BaseScriptCompileHash = NodeGraph->GetCompileDataHash(Usage, UsageId);
VMId.ScriptUsageType = ENiagaraScriptUsage::ParticleUpdateScript;
VMId.bUsesRapidIterationParams = true;
// 플랫폼 정보 없음!

// DDC 키는 스크립트 로직만 의존
FString DDCKey = BuildNiagaraDDCKeyString(VMId, ScriptPath);
// 결과: "NiagaraScriptDerivedData_3_0_/Game/MyScript_Spawn_GUID_HASH_USESRI_..."
```

### GPU 셰이더 특징

```cpp
// GPU는 플랫폼 의존적
FNiagaraShaderMapId ShaderMapId;
ShaderMapId.BaseCompileHash = BaseScriptCompileHash;  // VM과 동일한 해시
ShaderMapId.FeatureLevel = ERHIFeatureLevel::SM5;    // 플랫폼 특화!
ShaderMapId.LayoutParams = GetPlatformLayoutParams(); // 메모리 레이아웃!

// DDC 키는 플랫폼 + 로직 의존
FString DDCKey = GetNiagaraShaderMapKeyString(ShaderMapId, Platform);
// 결과: "NIAGARASM_SF_D3D_SM5_1234_GUID_HASH_LAYOUTHASH_..."
```

## 🔄 쿠킹 시 DDC 사용 흐름 (Cooking Flow with DDC)

### 시퀀스 다이어그램

```
    쿠커(Cooker)      UNiagaraScript    DDC           컴파일러        패키지
       │                   │             │                │             │
       │ BeginCacheForCookedPlatformData │                │             │
       ├──────────────────>│             │                │             │
       │                   │ GetDDCKey() │                │             │
       │                   ├────────────>│                │             │
       │                   │<────────────┤                │             │
       │                   │  Cache Hit? │                │             │
       │                   │             │                │             │
       │                   ├── Yes ──────┤                │             │
       │                   │  Load Data  │                │             │
       │                   │<────────────┤                │             │
       │                   │ SetVMCompilationResults      │             │
       │                   │             │                │             │
       │                   ├── No ───────┤                │             │
       │                   │             │  StartCompile()│             │
       │                   │             │───────────────>│             │
       │                   │             │<───────────────┤             │
       │                   │             │  Results       │             │
       │                   │ Put(DDC)    │                │             │
       │                   ├────────────>│                │             │
       │                   │             │                │             │
       │ IsCachedCookedPlatformDataLoaded │               │             │
       ├──────────────────>│             │                │             │
       │<──────────────────┤ true        │                │             │
       │                   │             │                │             │
       │ Serialize()       │             │                │             │
       ├──────────────────>│             │                │             │
       │                   │ WriteToPackage                             │
       │                   │─────────────────────────────>│             │
       │<──────────────────┤             │                │             │
```

### 코드 흐름 상세

#### 1. 쿠킹 시작

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp`

```cpp
// UNiagaraScript::BeginCacheForCookedPlatformData()
void UNiagaraScript::BeginCacheForCookedPlatformData(const ITargetPlatform* TargetPlatform)
{
    // GPU 스크립트인 경우 셰이더 캐싱
    if (IsGPUScript(Usage))
    {
        TArray<FName> DesiredShaderFormats = FindShaderFormatsForCooking(TargetPlatform);

        for (FName Format : DesiredShaderFormats)
        {
            // 각 플랫폼별로 셰이더 컴파일
            CacheResourceShadersForCooking(
                ShaderFormatToLegacyShaderPlatform(Format),
                CachedScriptResourcesForCooking[TargetPlatform],
                TargetPlatform);
        }
    }

    // VM 스크립트는 플랫폼 독립적이므로 이미 캐싱됨
}
```

#### 2. VM 바이트코드 쿠킹

```cpp
// VM 바이트코드는 항상 동일 (플랫폼 독립적)
void UNiagaraScript::Serialize(FArchive& Ar)
{
    Super::Serialize(Ar);

    if (Ar.IsCooking())
    {
        // CachedScriptVM을 그대로 직렬화
        // DDC에서 로드된 바이트코드를 쿠킹된 패키지에 포함
        CachedScriptVM.SerializeData(Ar, true);

        // RapidIterationParameters도 포함
        if (!CachedScriptVMId.bUsesRapidIterationParams)
        {
            // RI 파라미터가 베이크됨
            RapidIterationParametersCookedEditorCache = RapidIterationParameters;
        }
    }
}
```

#### 3. GPU 셰이더 쿠킹

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp`

```cpp
void UNiagaraScript::CacheResourceShadersForCooking(
    EShaderPlatform ShaderPlatform,
    TArray<TUniquePtr<FNiagaraShaderScript>>& InOutCachedResources,
    const ITargetPlatform* TargetPlatform)
{
    // 1. 셰이더 맵 ID 생성
    FNiagaraShaderMapId ShaderMapId;
    ScriptResource->GetShaderMapId(ShaderPlatform, TargetPlatform, ShaderMapId);

    // 2. DDC 캐시 확인
    if (IsShaderMapCached(TargetPlatform, ShaderMapId))
    {
        // 캐시 히트: 이미 컴파일됨
        return;
    }

    // 3. DDC에서 로드 또는 새로 컴파일
    TUniquePtr<FNiagaraShaderScript> NewResource =
        MakeUnique<FNiagaraShaderScript>();

    NewResource->SetScript(
        this,
        GetOutermost(),
        CachedScriptVMId,
        TargetPlatform,
        FeatureLevel);

    // 4. 셰이더 컴파일 (DDC 미스인 경우)
    CacheShadersForResources(
        NewResource.Get(),
        false,  // bApplyCompletedShaderMapForRendering
        false,  // bForceRecompile
        true,   // bCooking
        TargetPlatform);

    // 5. 컴파일된 리소스 저장
    InOutCachedResources.Add(MoveTemp(NewResource));
}
```

#### 4. 직렬화 (패키지에 포함)

```cpp
void UNiagaraScript::Serialize(FArchive& Ar)
{
    // ... 생략 ...

    if (Ar.IsCooking() && IsGPUScript(Usage))
    {
        // GPU 셰이더 직렬화
        TArray<TUniquePtr<FNiagaraShaderScript>>& CachedResources =
            CachedScriptResourcesForCooking[TargetPlatform];

        if (CachedResources.Num() > 0)
        {
            // 컴파일된 셰이더를 패키지에 포함
            SerializeNiagaraShaderMaps(Ar, NiagaraVer, true);
        }
    }
}
```

## 🎯 파라미터 변경 시 재컴파일 트리거 (Recompilation Triggers)

### 재컴파일이 필요한 경우

#### 1. 그래프 변경 (Graph Changes)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraScriptSource.cpp:158`

```cpp
void UNiagaraScriptSource::OnGraphChanged(const FEdGraphEditAction& InAction)
{
    // 그래프가 변경되면 스크립트 동기화 해제
    NodeGraph->MarkGraphRequiresSynchronization("Graph changed");
}

void UNiagaraScriptSource::OnGraphDataInterfaceChanged()
{
    // Data Interface 변경 시에도 동기화 해제
    NodeGraph->MarkGraphRequiresSynchronization("Data interface changed");
}
```

#### 2. 스크립트 속성 변경

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp`

```cpp
#if WITH_EDITOR
void UNiagaraScript::PostEditChangeProperty(FPropertyChangedEvent& PropertyChangedEvent)
{
    Super::PostEditChangeProperty(PropertyChangedEvent);

    FName PropertyName = PropertyChangedEvent.GetPropertyName();

    // Usage 변경
    if (PropertyName == GET_MEMBER_NAME_CHECKED(UNiagaraScript, Usage))
    {
        InvalidateCompileResults("Usage changed");
    }

    // 기타 중요 속성 변경
    OnPropertyChangedDelegate.Broadcast(PropertyChangedEvent);
}
#endif
```

#### 3. 시스템 설정 변경

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp:1017`

```cpp
void UNiagaraScript::ComputeVMCompilationId(FNiagaraVMExecutableDataId& Id, ...)
{
    // ... 생략 ...

    // 시스템 설정이 변경되면 AdditionalDefines가 달라짐
    if (EmitterOwner->ShouldCompressAttributes())
    {
        Id.AdditionalDefines.Add(TEXT("CompressAttributes"));  // ← DDC 키 변경!
    }

    if (EmitterOwner->ShouldTrimAttributes())
    {
        Id.AdditionalDefines.Add(TEXT("TrimAttributes"));  // ← DDC 키 변경!
    }

    // 속성 보존 리스트 변경
    for (const FString& Attribute : EmitterData->AttributesToPreserve)
    {
        Id.AdditionalDefines.Add(TEXT("PreserveAttribute_") + Attribute);  // ← DDC 키 변경!
    }
}
```

### 재컴파일 검사 로직

#### `AreScriptAndSourceSynchronized()`

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp`

```cpp
bool UNiagaraScript::AreScriptAndSourceSynchronized(const FGuid& VersionGuid) const
{
    const FVersionedNiagaraScriptData* ScriptData = GetScriptData(VersionGuid);

    if (ScriptData && ScriptData->Source)
    {
        // 1. 스크립트의 LastGeneratedVMId 가져오기
        FNiagaraVMExecutableDataId CurrentId = GetLastGeneratedVMId(VersionGuid);

        // 2. 소스에서 ChangeId 가져오기
        FGuid SourceChangeId = ScriptData->Source->GetCompileBaseId(Usage, UsageId);

        // 3. CurrentId의 BaseScriptCompileHash와 SourceChangeId 비교
        return ScriptData->Source->IsSynchronized(SourceChangeId);
    }

    return false;
}
```

#### `MarkScriptAndSourceDesynchronized()`

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp`

```cpp
void UNiagaraScript::MarkScriptAndSourceDesynchronized(
    FString Reason,
    const FGuid& VersionGuid)
{
    FVersionedNiagaraScriptData* ScriptData = GetScriptData(VersionGuid);

    if (ScriptData && ScriptData->Source)
    {
        // 소스를 동기화 해제 상태로 마킹
        ScriptData->Source->MarkNotSynchronized(Reason);

        UE_LOG(LogNiagara, Log,
            TEXT("Script '%s' marked as desynchronized. Reason: %s"),
            *GetPathName(), *Reason);
    }
}
```

### Rapid Iteration 파라미터 변경

**Rapid Iteration (RI) 파라미터는 DDC 키에 영향을 주지 않습니다!**

#### RI 파라미터 처리 방식

```cpp
// ComputeVMCompilationId()에서
Id.bUsesRapidIterationParams = EmitterOwner->ShouldUseRapidIterationParameters();

// bUsesRapidIterationParams가 true인 경우:
// - RI 파라미터 값은 DDC 키에 포함되지 않음
// - 런타임에 RapidIterationParameters로 오버라이드됨
// - RI 값만 바뀌면 재컴파일 없이 즉시 반영

// bUsesRapidIterationParams가 false인 경우:
// - RI 파라미터가 바이트코드에 베이크됨 (Baked-in)
// - RI 값이 바뀌면 재컴파일 필요
// - 쿠킹 빌드에서는 항상 false
```

#### RI 파라미터 값 변경 감지

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScript.cpp`

```cpp
void UNiagaraScript::PostEditChangeProperty(FPropertyChangedEvent& PropertyChangedEvent)
{
    // RapidIterationParameters가 변경된 경우
    if (PropertyChangedEvent.GetPropertyName() ==
        GET_MEMBER_NAME_CHECKED(UNiagaraScript, RapidIterationParameters))
    {
        // bUsesRapidIterationParams가 true면 재컴파일 불필요
        if (CachedScriptVMId.bUsesRapidIterationParams)
        {
            // 런타임에 즉시 반영
            OnVMScriptCompiled().Broadcast(this, FGuid());
            FNiagaraSystemUpdateContext(this, true);
        }
        else
        {
            // bUsesRapidIterationParams가 false면 재컴파일 필요
            InvalidateCompileResults("Baked RI parameters changed");
        }
    }
}
```

## 🔧 실전 예시 (Practical Examples)

### 예시 1: DDC 키 생성 과정

```cpp
// 1. 스크립트 그래프 해시 계산
UNiagaraGraph* Graph = Script->GetSource()->NodeGraph;
FNiagaraCompileHash GraphHash = Graph->GetCompileDataHash(
    ENiagaraScriptUsage::ParticleUpdateScript,
    UsageId);
// 결과: "A1B2C3D4E5F6..."

// 2. FNiagaraVMExecutableDataId 생성
FNiagaraVMExecutableDataId VMId;
VMId.BaseScriptCompileHash = GraphHash;
VMId.CompilerVersionID = FNiagaraCustomVersion::GetLatestScriptCompileVersion();
VMId.ScriptUsageType = ENiagaraScriptUsage::ParticleUpdateScript;
VMId.ScriptUsageTypeID = FGuid::NewGuid();
VMId.bUsesRapidIterationParams = true;
VMId.AdditionalDefines.Add(TEXT("CompressAttributes"));

// 3. DDC 키 문자열 생성
FString KeyString;
VMId.AppendKeyString(KeyString, TEXT("_"));
// 결과: "3_GUID_A1B2C3D4E5F6_USESRI_ALLOWDEBUGSWITCH_CompressAttributes_..."

// 4. 최종 DDC 키
FString DDCKey = UNiagaraScript::BuildNiagaraDDCKeyString(VMId, TEXT("/Game/MyScript"));
// 결과: "NIAGARA_3_/Game/MyScript_3_GUID_A1B2C3D4E5F6_USESRI_..."
```

### 예시 2: 파라미터 변경 시나리오

#### ✅ 재컴파일 불필요한 경우

```cpp
// Scenario: Rapid Iteration 파라미터 값 변경
// 예: Module의 Color 파라미터를 Red에서 Blue로 변경

UNiagaraScript* Script = ...;
FNiagaraVariable ColorParam(FNiagaraTypeDefinition::GetColorDef(),
    TEXT("Module.MyModule.Color"));

// RI 파라미터 값만 변경
FLinearColor NewColor = FLinearColor::Blue;
Script->RapidIterationParameters.SetParameterValue(
    NewColor.GetData(),
    ColorParam);

// bUsesRapidIterationParams == true이므로:
// - DDC 키 변경 없음
// - 재컴파일 없음
// - 런타임에 즉시 반영
// - 파티클 시스템만 업데이트

FNiagaraSystemUpdateContext(Script, true);  // 즉시 반영
```

#### ❌ 재컴파일 필요한 경우 1: 그래프 로직 변경

```cpp
// Scenario: 그래프에 새 노드 추가
// 예: Add Float 노드를 Add Vector 노드로 교체

UNiagaraGraph* Graph = Script->GetSource()->NodeGraph;

// 노드 삭제 및 추가
UNiagaraNodeOp* OldNode = ...;
Graph->RemoveNode(OldNode);

UNiagaraNodeOp* NewNode = NewObject<UNiagaraNodeOp>(Graph);
NewNode->OpName = FName("Add");
Graph->AddNode(NewNode);

// 그래프 변경 → 해시 변경
// - BaseScriptCompileHash 변경
// - DDC 키 변경
// - 재컴파일 트리거

Graph->NotifyGraphChanged();  // 동기화 해제
Script->MarkScriptAndSourceDesynchronized("Node added", FGuid());
Script->RequestCompile(FGuid(), false);  // 재컴파일 요청
```

#### ❌ 재컴파일 필요한 경우 2: 시스템 설정 변경

```cpp
// Scenario: Attribute Compression 활성화

UNiagaraSystem* System = ...;

// 설정 변경
System->bCompressAttributes = true;

// ComputeVMCompilationId()에서:
// Id.AdditionalDefines.Add(TEXT("CompressAttributes"));
// → DDC 키 변경
// → 재컴파일 트리거

System->RequestCompile(false);  // 모든 스크립트 재컴파일
```

#### ❌ 재컴파일 필요한 경우 3: Static Switch 변경

```cpp
// Scenario: Static Switch 값 변경
// 예: "UseAdvancedLogic" static switch를 false → true로 변경

FNiagaraVariable StaticSwitch(FNiagaraTypeDefinition::GetBoolDef(),
    TEXT("Module.MyModule.UseAdvancedLogic"));

Script->RapidIterationParameters.SetParameterValue(true, StaticSwitch);

// ComputeVMCompilationId()에서:
// Id.AdditionalVariables.Add(StaticSwitch);
// → DDC 키 변경
// → 재컴파일 트리거 (그래프 구조 자체가 바뀜)

Script->RequestCompile(FGuid(), false);
```

### 예시 3: DDC 히트 vs 미스 시나리오

#### DDC 히트 (Cache Hit)

```cpp
// 1. 첫 번째 컴파일
UNiagaraScript* Script1 = LoadObject<UNiagaraScript>(..., TEXT("/Game/MyScript"));
Script1->RequestCompile(FGuid(), false);

// DDC 미스 → 컴파일 수행
// - HLSL 생성: ~500ms
// - VM 바이트코드 생성: ~200ms
// - DDC에 저장
// 총 시간: ~700ms

// 2. 두 번째 로드 (같은 스크립트)
UNiagaraScript* Script2 = LoadObject<UNiagaraScript>(..., TEXT("/Game/MyScript"));
Script2->RequestCompile(FGuid(), false);

// DDC 히트 → 직렬화만 수행
// - DDC에서 읽기: ~5ms
// - BinaryToExecData(): ~10ms
// 총 시간: ~15ms (47배 빠름!)
```

#### DDC 미스 (Cache Miss)

```cpp
// DDC가 무효화되는 경우:

// 1. 컴파일러 버전 업그레이드
FNiagaraCustomVersion::LatestScriptCompileVersion++;
// → CompilerVersionID 변경 → DDC 키 변경

// 2. 플랫폼 변경 (GPU 셰이더만)
EShaderPlatform Platform = SP_PCD3D_SM6;  // SM5 → SM6
// → FeatureLevel 변경 → DDC 키 변경

// 3. 엔진 설정 변경
GetMutableDefault<UNiagaraSettings>()->InvalidNamespaceWriteSeverity =
    ENiagaraNamespaceMetadataOptions::PreventUsageAndWarnIfEnabled;
// → AdditionalDefines 변경 → DDC 키 변경

// 4. DDC 수동 삭제
GetDerivedDataCacheRef().ClearCache();
// → 모든 캐시 무효화
```

## 🐛 디버깅 팁 (Debugging Tips)

### DDC 키 덤프

```cpp
// 콘솔 명령어
// UNiagaraScript에서 DDC 키 출력
exec function DumpDDCKey
{
    FNiagaraVMExecutableDataId VMId = GetLastGeneratedVMId();

    FString KeyString;
    VMId.AppendKeyString(KeyString, TEXT("\n"), true);

    UE_LOG(LogNiagara, Display, TEXT("DDC Key Components:\n%s"), *KeyString);

    FString FinalKey = BuildNiagaraDDCKeyString(VMId, GetPathName());
    UE_LOG(LogNiagara, Display, TEXT("Final DDC Key: %s"), *FinalKey);
}
```

### 재컴파일 이유 추적

```cpp
// MarkScriptAndSourceDesynchronized() 호출 시 로그
void UNiagaraScript::MarkScriptAndSourceDesynchronized(FString Reason, const FGuid& VersionGuid)
{
    UE_LOG(LogNiagara, Warning,
        TEXT("Script desynchronized: %s\nReason: %s\nCallstack:\n%s"),
        *GetPathName(),
        *Reason,
        *FPlatformStackWalk::GetStackTrace());

    // ... 생략 ...
}
```

### DDC 통계

```cpp
// DDC 히트율 확인
#if ENABLE_COOK_STATS
namespace NiagaraScriptCookStats
{
    extern FCookStats::FDDCResourceUsageStats UsageStats;

    void PrintStats()
    {
        UE_LOG(LogNiagara, Display,
            TEXT("DDC Hits: %d, Misses: %d, Hit Rate: %.2f%%"),
            UsageStats.GetAccumulatedValue(FCookStats::ECounter::Hits),
            UsageStats.GetAccumulatedValue(FCookStats::ECounter::Misses),
            UsageStats.GetHitRate() * 100.0f);
    }
}
#endif
```

## 📊 성능 최적화 (Performance Optimization)

### ✅ 해야 할 것 (Best Practices)

#### 1. Rapid Iteration 파라미터 활용

```cpp
// 좋은 예: RI 파라미터 사용
// - 아티스트가 값을 자주 변경하는 파라미터는 RI로 노출
// - 재컴파일 없이 즉시 반영

UPROPERTY(EditAnywhere, Category = "Module")
float ColorIntensity = 1.0f;  // RI 파라미터로 자동 노출

// 값 변경 → 즉시 반영 (재컴파일 없음)
```

#### 2. Static Switch 최소화

```cpp
// 나쁜 예: 불필요한 Static Switch
bool bUseRedColor = true;  // Static Switch
FLinearColor Color = bUseRedColor ? FLinearColor::Red : FLinearColor::Blue;

// 좋은 예: 일반 파라미터 사용
FLinearColor Color = MyColorParameter;  // RI 파라미터
```

#### 3. AdditionalDefines 최소화

```cpp
// 나쁜 예: 동적으로 변하는 정보를 Define으로 추가
Id.AdditionalDefines.Add(FString::Printf(TEXT("ParticleCount_%d"), ParticleCount));
// → 파티클 수가 바뀔 때마다 재컴파일!

// 좋은 예: 런타임 파라미터 사용
// Emitter.NumParticles를 셰이더에서 읽기
```

### ❌ 피해야 할 것 (Anti-Patterns)

#### 1. 불필요한 ForceRecompile

```cpp
// 나쁜 예
Script->RequestCompile(FGuid(), true);  // 항상 강제 재컴파일!

// 좋은 예
Script->RequestCompile(FGuid(), false);  // DDC 활용
```

#### 2. 과도한 MarkScriptAndSourceDesynchronized 호출

```cpp
// 나쁜 예: 매 프레임 동기화 해제
void Tick(float DeltaTime)
{
    Script->MarkScriptAndSourceDesynchronized("Tick", FGuid());
    // → 끊임없는 재컴파일!
}

// 좋은 예: 실제 변경이 있을 때만 호출
void OnGraphModified()
{
    Script->MarkScriptAndSourceDesynchronized("Graph modified", FGuid());
}
```

#### 3. DDC 무시

```cpp
// 나쁜 예: DDC를 항상 무시
bool bShouldUseDDC = false;  // 절대 이렇게 하지 말 것!

// 좋은 예: DDC 활용
// - 첫 컴파일: ~700ms
// - DDC 히트: ~15ms (47배 빠름)
```

## 🔗 참조 자료 (References)

### 주요 소스 파일

| 파일 | 라인 | 설명 |
|------|------|------|
| `NiagaraScript.cpp` | 992 | `BuildNiagaraDDCKeyString()` - VM DDC 키 생성 |
| `NiagaraScript.cpp` | 843 | `FNiagaraVMExecutableDataId::AppendKeyString()` - 키 문자열 생성 |
| `NiagaraScript.cpp` | 1017 | `ComputeVMCompilationId()` - VM 컴파일 ID 계산 |
| `NiagaraScript.cpp` | 3242 | `RequestCompile()` - DDC 조회 및 컴파일 요청 |
| `NiagaraScript.h` | 241 | `FNiagaraVMExecutableDataId` 구조체 정의 |
| `NiagaraShader.cpp` | 536 | `GetNiagaraShaderMapKeyString()` - GPU DDC 키 생성 |
| `NiagaraShader.cpp` | 154 | `FNiagaraShaderMapId::GetScriptHash()` - GPU 해시 계산 |
| `NiagaraShader.cpp` | 549 | `LoadFromDerivedDataCache()` - GPU DDC 로드 |
| `NiagaraShared.h` | 321 | `FNiagaraShaderMapId` 구조체 정의 |
| `NiagaraScriptSource.cpp` | 63 | `ComputeVMCompilationId()` - 소스 기반 컴파일 ID |

### 관련 문서

- [Unreal Engine DDC Documentation](https://docs.unrealengine.com/5.3/derived-data-cache-in-unreal-engine/)
- [Niagara Overview](https://docs.unrealengine.com/5.3/niagara-overview-for-unreal-engine/)
- [Shader Compilation](https://docs.unrealengine.com/5.3/shader-development-in-unreal-engine/)

---

> 🔄 **Updated:** 2025-01-21 — Niagara DDC 및 쿠킹 시스템 초기 문서화 완료
