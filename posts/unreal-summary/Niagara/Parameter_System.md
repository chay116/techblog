---
title: "Parameter System (파라미터 시스템)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Parameter System (파라미터 시스템)

## 🧭 개요

Niagara Parameter System은 **스크립트와 시스템 간 데이터 흐름을 관리**하는 핵심 시스템입니다.

**핵심 역할:**
- Parameter 저장 및 관리 (FNiagaraParameterStore)
- Parameter Store 간 바인딩 및 동기화
- DataInterface, UObject, Scalar 파라미터 통합 관리
- VM 실행 시 Constant Table 제공

**📂 주요 위치:**
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraParameterStore.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScriptExecutionParameterStore.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraParameterBinding.h`

---

## 🧱 전체 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Parameter System Architecture                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  System Level                                                        │
│  ┌────────────────────────────────────────┐                         │
│  │ FNiagaraSystemInstance                 │                         │
│  │  - SystemParameterStore                │                         │
│  │    (System.*, Engine.*, User.*)        │                         │
│  └────────────────────────────────────────┘                         │
│              │ Bind                                                  │
│              ↓                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Emitter Level (Each Emitter Instance)                          │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ FNiagaraEmitterInstance                                  │  │ │
│  │  │  - EmitterParameterStore                                 │  │ │
│  │  │    (Emitter.*, Module Parameters)                        │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │           │ Bind                                                │ │
│  │           ↓                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Script Execution Contexts                                │  │ │
│  │  │  - SpawnScriptContext.Parameters                         │  │ │
│  │  │  - UpdateScriptContext.Parameters                        │  │ │
│  │  │  - SimStageScriptContext.Parameters                      │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Parameter Store 내부 구조                                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ FNiagaraParameterStore                                         │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ SortedParameterOffsets                                   │  │ │
│  │  │  [Name, Type, Offset, StructConverter]                   │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ ParameterData (TArray<uint8>)                            │  │ │
│  │  │  [float][float][int][FVector][...]                       │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ DataInterfaces (TArray<UNiagaraDataInterface*>)          │  │ │
│  │  │  [StaticMeshDI][CurveDI][Grid3DDI][...]                  │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ UObjects (TArray<UObject*>)                              │  │ │
│  │  │  [Material][Texture][...]                                │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Bindings (Source → Dest Bindings)                        │  │ │
│  │  │  SystemStore → EmitterStore                              │  │ │
│  │  │  EmitterStore → ScriptStore                              │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 계층별 상세 분석

### 1. **FNiagaraParameterStore - 파라미터 저장소**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraParameterStore.h:158`

**역할:** Parameter의 이름, 타입, 값을 저장하고 관리하는 핵심 컨테이너.

**핵심 구조:**
```cpp
USTRUCT()
struct FNiagaraParameterStore
{
private:
    // Owner (Outer for DataInterfaces)
    UPROPERTY(Transient)
    TWeakObjectPtr<UObject> Owner;

    // Parameter 변수 정의 (Name, Type, Offset)
    UPROPERTY()
    TArray<FNiagaraVariableWithOffset> SortedParameterOffsets;

    // Scalar/Vector 데이터 버퍼
    UPROPERTY()
    TArray<uint8> ParameterData;

    // DataInterface 배열
    UPROPERTY()
    TArray<TObjectPtr<UNiagaraDataInterface>> DataInterfaces;

    // UObject 배열 (Material, Texture 등)
    UPROPERTY()
    TArray<TObjectPtr<UObject>> UObjects;

    // LWC Position Source Data
    UPROPERTY()
    TArray<FNiagaraPositionSource> OriginalPositionData;

    // Bindings to other stores
    TArray<TPair<FNiagaraParameterStore*, FNiagaraParameterStoreBinding>> Bindings;

    // Source stores (feeding data into this store)
    TArray<FNiagaraParameterStore*> SourceStores;

    // Dirty flags
    uint32 bParametersDirty : 1;
    uint32 bInterfacesDirty : 1;
    uint32 bUObjectsDirty : 1;
    uint32 bPositionDataDirty : 1;

    // Layout Version (변경 감지)
    uint32 LayoutVersion;

public:
    // Parameter 추가/제거
    bool AddParameter(const FNiagaraVariable& Param, bool bInitialize = true);
    bool RemoveParameter(const FNiagaraVariableBase& Param);

    // Parameter 값 읽기/쓰기
    template<typename T>
    T GetParameterValue(const FNiagaraVariableBase& Parameter) const;

    template<typename T>
    bool SetParameterValue(const T& InValue, const FNiagaraVariable& Param);

    // DataInterface 접근
    UNiagaraDataInterface* GetDataInterface(const FNiagaraVariable& Parameter) const;

    // Binding
    void Bind(FNiagaraParameterStore* DestStore);
    void Unbind(FNiagaraParameterStore* DestStore);
    void Tick();  // 바인딩된 Store로 값 전달
};
```

**FNiagaraVariableWithOffset 구조:**
```cpp
// NiagaraParameterStore.h:125
USTRUCT()
struct FNiagaraVariableWithOffset : public FNiagaraVariableBase
{
    // FNiagaraVariableBase:
    //   FName Name;
    //   FNiagaraTypeDefinition Type;

    UPROPERTY()
    int32 Offset;  // ParameterData 또는 DataInterfaces/UObjects 인덱스

    UPROPERTY()
    FNiagaraLwcStructConverter StructConverter;  // LWC 변환용
};
```

**메모리 레이아웃:**
```
┌──────────────────────────────────────────────────────────────┐
│        Parameter Store Memory Layout                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  SortedParameterOffsets:                                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [0] System.DeltaTime (float, Offset=0)                 │ │
│  │ [1] System.NumParticles (int, Offset=4)                │ │
│  │ [2] Emitter.SpawnRate (float, Offset=8)                │ │
│  │ [3] Module.Gravity (FVector, Offset=12)                │ │
│  │ [4] Module.StaticMeshDI (DataInterface, Offset=0)      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ParameterData (TArray<uint8>):                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [Offset 0]:  0.0166 (DeltaTime)                        │ │
│  │ [Offset 4]:  1000 (NumParticles)                       │ │
│  │ [Offset 8]:  50.0 (SpawnRate)                          │ │
│  │ [Offset 12]: (0,0,-980) (Gravity)                      │ │
│  │ [Offset 24]: ...                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  DataInterfaces (TArray<UNiagaraDataInterface*>):            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [Index 0]: UNiagaraDataInterfaceStaticMesh*            │ │
│  │ [Index 1]: UNiagaraDataInterfaceCurve*                 │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

### 2. **FNiagaraParameterStoreBinding - Store 간 바인딩**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraParameterStore.h:47`

**역할:** 두 ParameterStore 간 데이터 동기화 정보를 관리.

**핵심 구조:**
```cpp
struct FNiagaraParameterStoreBinding
{
    // Scalar/Vector 파라미터 바인딩
    struct FParameterBinding
    {
        uint16 SrcOffset;   // Source Store의 ParameterData offset
        uint16 DestOffset;  // Dest Store의 ParameterData offset
        uint16 Size;        // 복사할 바이트 크기
    };
    TArray<FParameterBinding> ParameterBindings;

    // DataInterface 바인딩
    struct FInterfaceBinding
    {
        uint16 SrcOffset;   // Source DataInterfaces 인덱스
        uint16 DestOffset;  // Dest DataInterfaces 인덱스
    };
    TArray<FInterfaceBinding> InterfaceBindings;

    // UObject 바인딩
    struct FUObjectBinding
    {
        uint16 SrcOffset;   // Source UObjects 인덱스
        uint16 DestOffset;  // Dest UObjects 인덱스
    };
    TArray<FUObjectBinding> UObjectBindings;

    // 바인딩 초기화
    bool Initialize(FNiagaraParameterStore* DestStore, FNiagaraParameterStore* SrcStore);

    // 데이터 복사
    void CopyParameters(FNiagaraParameterStore* DestStore, const FNiagaraParameterStore* SrcStore) const;
};
```

**Binding 초기화 프로세스:**
```cpp
// Pseudo-code
bool FNiagaraParameterStoreBinding::Initialize(
    FNiagaraParameterStore* DestStore,
    FNiagaraParameterStore* SrcStore)
{
    ParameterBindings.Empty();
    InterfaceBindings.Empty();
    UObjectBindings.Empty();

    // Source의 모든 파라미터 순회
    for (const FNiagaraVariableWithOffset& SrcParam : SrcStore->ReadParameterVariables())
    {
        // Dest에서 같은 이름의 파라미터 찾기
        const FNiagaraVariableWithOffset* DestParam = DestStore->FindParameterVariable(SrcParam);

        if (DestParam && DestParam->GetType() == SrcParam.GetType())
        {
            if (SrcParam.IsDataInterface())
            {
                // DataInterface 바인딩
                InterfaceBindings.Add(FInterfaceBinding(SrcParam.Offset, DestParam->Offset));
            }
            else if (SrcParam.IsUObject())
            {
                // UObject 바인딩
                UObjectBindings.Add(FUObjectBinding(SrcParam.Offset, DestParam->Offset));
            }
            else
            {
                // Scalar/Vector 바인딩
                ParameterBindings.Add(FParameterBinding(
                    SrcParam.Offset,
                    DestParam->Offset,
                    SrcParam.GetSizeInBytes()
                ));
            }
        }
    }

    return ParameterBindings.Num() > 0 || InterfaceBindings.Num() > 0 || UObjectBindings.Num() > 0;
}
```

---

### 3. **FNiagaraScriptInstanceParameterStore - Script 실행용 Parameter Store**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScriptExecutionParameterStore.h`

**역할:** Script 실행에 특화된 ParameterStore. VM에 직접 전달 가능한 형태로 관리.

**핵심 구조:**
```cpp
struct FNiagaraScriptInstanceParameterStore : public FNiagaraParameterStore
{
    // VM External Function Binding Table (DataInterface 함수)
    TArray<FVMExternalFunction> VMExternalFunctions;

    // UserPtr Table (DataInterface Instance Data)
    TArray<void*> UserPtrTable;

    // Parameter 버퍼를 VM에 직접 전달 가능하도록 준비
    void PrepareForExecution();

    // DataInterface 초기화
    void InitDataInterfaces(FNiagaraSystemInstance* SystemInstance, UNiagaraScript* Script);

    // DataInterface Tick
    void TickDataInterfaces(float DeltaSeconds);
};
```

**VM 통합:**
```cpp
// Script 실행 시
void FNiagaraScriptExecutionContext::Execute(
    FNiagaraSystemInstance* Instance,
    float DeltaSeconds,
    uint32 NumInstances)
{
    // 1. Constant Buffer 준비
    TArray<const uint8*> ConstantBuffers;
    ConstantBuffers.Add(Parameters.GetParameterDataArray().GetData());  // Scalar/Vector 데이터

    // 2. VM 실행
    VectorVM::Exec(
        VectorVMState,
        NumInstances,
        ConstantBuffers,  // ParameterData → VM Constant Table
        DataSetInfo,
        Parameters.VMExternalFunctions,  // External Function Table
        Parameters.UserPtrTable  // DataInterface Instance Data
    );
}
```

---

### 4. **FNiagaraParameterBinding - Named Binding**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraParameterBinding.h`

**역할:** 이름 기반 파라미터 바인딩 (Material Parameter, Renderer Parameter 등).

**핵심 구조:**
```cpp
USTRUCT()
struct FNiagaraParameterBinding
{
    // Resolved Parameter Name
    UPROPERTY()
    FNiagaraVariableBase ResolvedParameter;

    // Cached Offset in Parameter Store
    mutable int32 CachedOffset = INDEX_NONE;

    // Binding 초기화
    void Initialize(FNiagaraParameterStore* ParameterStore, const FNiagaraVariable& InVar);

    // 값 읽기
    template<typename T>
    T GetValue(const FNiagaraParameterStore* ParameterStore) const
    {
        if (CachedOffset != INDEX_NONE)
        {
            return ParameterStore->GetParameterValueFromOffset<T>(CachedOffset);
        }
        return T();
    }
};
```

**사용 예시 (Renderer):**
```cpp
// Sprite Renderer에서 Color 파라미터 바인딩
class UNiagaraSpriteRendererProperties
{
    UPROPERTY(EditAnywhere)
    FNiagaraParameterBinding ColorBinding;  // "Particles.Color"

    void InitBindings()
    {
        ColorBinding.Initialize(
            ParameterStore,
            FNiagaraVariable(FNiagaraTypeDefinition::GetColorDef(), TEXT("Particles.Color"))
        );
    }

    void Render()
    {
        FLinearColor Color = ColorBinding.GetValue<FLinearColor>(ParameterStore);
        // Use Color for rendering...
    }
};
```

---

### 5. **Parameter Namespace Hierarchy**

**Namespace 계층 구조:**
```
System
  ├─ System.*        (System 전역, 모든 Emitter 공유)
  ├─ Engine.*        (Engine이 제공하는 상수)
  ├─ User.*          (User Parameter, Blueprint에서 설정 가능)
  └─ Emitter.*       (Emitter 스코프, 해당 Emitter만 접근)
       ├─ Module.*   (Module 로컬 변수)
       └─ Particles.* (Particle Attribute)
```

**Parameter 이름 해석:**
```cpp
// Compiler가 Parameter 이름으로 적절한 Store 결정
void ResolveParameter(const FString& ParameterName)
{
    if (ParameterName.StartsWith("System."))
    {
        // SystemParameterStore에서 조회
        Value = SystemInstance->GetSystemParameterStore().GetParameterValue(ParameterName);
    }
    else if (ParameterName.StartsWith("Emitter."))
    {
        // EmitterParameterStore에서 조회
        Value = EmitterInstance->GetEmitterParameterStore().GetParameterValue(ParameterName);
    }
    else if (ParameterName.StartsWith("Particles."))
    {
        // Particle DataSet에서 조회 (Runtime)
        Value = ParticleDataSet.GetAttribute(ParameterName);
    }
    else if (ParameterName.StartsWith("User."))
    {
        // User Parameter (Blueprint Exposed)
        Value = SystemInstance->GetUserParameterStore().GetParameterValue(ParameterName);
    }
}
```

---

## 🔄 Parameter 흐름도

```
┌──────────────────────────────────────────────────────────────────────┐
│               Parameter Flow (System → Emitter → Script)             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Step 1: System Initialization                                       │
│  ┌────────────────────────────────────────┐                         │
│  │ SystemParameterStore 생성              │                         │
│  │  - System.DeltaTime = 0.0166           │                         │
│  │  - Engine.ExecutionState = Active      │                         │
│  │  - User.CustomValue = 10.0 (Blueprint) │                         │
│  └────────────────────────────────────────┘                         │
│                   │                                                  │
│                   ↓ Bind                                             │
│  Step 2: Emitter Initialization                                      │
│  ┌────────────────────────────────────────┐                         │
│  │ EmitterParameterStore 생성             │                         │
│  │  - Emitter.SpawnRate = 100.0           │                         │
│  │  - Emitter.LifetimeRange = (1,2)       │                         │
│  │  - Module.Gravity = (0,0,-980)         │                         │
│  └────────────────────────────────────────┘                         │
│                   │                                                  │
│                   ↓ Bind                                             │
│  Step 3: Script Context Initialization                               │
│  ┌────────────────────────────────────────┐                         │
│  │ SpawnScriptContext.Parameters          │                         │
│  │  - All above parameters inherited      │                         │
│  │  - Additional script-specific params   │                         │
│  └────────────────────────────────────────┘                         │
│                   │                                                  │
│                   ↓ Tick()                                           │
│  Step 4: Runtime Update (Each Tick)                                  │
│  ┌────────────────────────────────────────┐                         │
│  │ SystemParameterStore.Tick()            │                         │
│  │  → Copies dirty parameters to          │                         │
│  │    bound EmitterParameterStores        │                         │
│  │                                         │                         │
│  │ EmitterParameterStore.Tick()           │                         │
│  │  → Copies dirty parameters to          │                         │
│  │    bound ScriptParameterStores         │                         │
│  └────────────────────────────────────────┘                         │
│                   │                                                  │
│                   ↓                                                  │
│  Step 5: VM Execution                                                │
│  ┌────────────────────────────────────────┐                         │
│  │ ScriptContext.Parameters               │                         │
│  │  → ParameterData → VM Constant Table   │                         │
│  │  → DataInterfaces → VM UserPtrTable    │                         │
│  └────────────────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 💡 실전 예시

### 예시 1: Parameter Store 생성 및 값 설정

**C++ 코드:**
```cpp
// ParameterStore 생성
FNiagaraParameterStore MyStore;
MyStore.SetOwner(this);

// Float Parameter 추가
FNiagaraVariable FloatParam(FNiagaraTypeDefinition::GetFloatDef(), TEXT("MyModule.Speed"));
MyStore.AddParameter(FloatParam, true);
MyStore.SetParameterValue(10.0f, FloatParam);

// Vector Parameter 추가
FNiagaraVariable VectorParam(FNiagaraTypeDefinition::GetVec3Def(), TEXT("MyModule.Direction"));
MyStore.AddParameter(VectorParam, true);
MyStore.SetParameterValue(FVector(1, 0, 0), VectorParam);

// DataInterface 추가
UNiagaraDataInterfaceStaticMesh* StaticMeshDI = NewObject<UNiagaraDataInterfaceStaticMesh>(this);
StaticMeshDI->SetSourceComponent(MyStaticMeshComponent);

FNiagaraVariable DIParam(FNiagaraTypeDefinition(UNiagaraDataInterfaceStaticMesh::StaticClass()), TEXT("MyModule.StaticMeshDI"));
MyStore.AddParameter(DIParam, true);
MyStore.SetDataInterface(StaticMeshDI, DIParam);

// Parameter 읽기
float Speed = MyStore.GetParameterValue<float>(FloatParam);
FVector Dir = MyStore.GetParameterValue<FVector>(VectorParam);
UNiagaraDataInterface* DI = MyStore.GetDataInterface(DIParam);
```

---

### 예시 2: Store 간 바인딩 및 동기화

**Setup:**
```cpp
// Source Store (System Level)
FNiagaraParameterStore SystemStore;
FNiagaraVariable DeltaTimeParam(FNiagaraTypeDefinition::GetFloatDef(), TEXT("System.DeltaTime"));
SystemStore.AddParameter(DeltaTimeParam, true);
SystemStore.SetParameterValue(0.0166f, DeltaTimeParam);

// Destination Store (Emitter Level)
FNiagaraParameterStore EmitterStore;
EmitterStore.AddParameter(DeltaTimeParam, true);  // 같은 이름 추가

// Binding
EmitterStore.Bind(&SystemStore);

// 이제 SystemStore의 변경사항이 EmitterStore로 자동 전파됨
```

**Runtime Update:**
```cpp
void Tick(float NewDeltaTime)
{
    // 1. Source Store 업데이트
    SystemStore.SetParameterValue(NewDeltaTime, DeltaTimeParam);

    // 2. Tick 호출 → 바인딩된 Store로 전파
    SystemStore.Tick();

    // 3. Destination Store에서 확인
    float EmitterDeltaTime = EmitterStore.GetParameterValue<float>(DeltaTimeParam);
    check(EmitterDeltaTime == NewDeltaTime);  // 자동 동기화!
}
```

**Binding 내부 동작:**
```cpp
void FNiagaraParameterStore::Tick()
{
    if (bParametersDirty || bInterfacesDirty || bUObjectsDirty)
    {
        // 모든 바인딩된 Store로 복사
        for (TPair<FNiagaraParameterStore*, FNiagaraParameterStoreBinding>& Binding : Bindings)
        {
            FNiagaraParameterStore* DestStore = Binding.Key;
            FNiagaraParameterStoreBinding& BindingInfo = Binding.Value;

            // Binding 정보에 따라 데이터 복사
            BindingInfo.CopyParameters(DestStore, this);
        }

        // Dirty flags 초기화
        bParametersDirty = false;
        bInterfacesDirty = false;
        bUObjectsDirty = false;
    }
}
```

---

### 예시 3: Blueprint User Parameter 노출

**C++ Setup:**
```cpp
// System Asset에서 User Parameter 정의
UNiagaraSystem* MySystem = LoadObject<UNiagaraSystem>(...);

// User Parameter 추가
FNiagaraVariable UserParam(FNiagaraTypeDefinition::GetFloatDef(), TEXT("User.MyCustomValue"));
MySystem->GetExposedParameters().AddParameter(UserParam, true);
MySystem->GetExposedParameters().SetParameterValue(5.0f, UserParam);
```

**Blueprint에서 사용:**
```cpp
// Blueprint Graph
UNiagaraComponent* NiagaraComp = CreateDefaultSubobject<UNiagaraComponent>(TEXT("NiagaraComp"));
NiagaraComp->SetAsset(MySystem);

// User Parameter 설정 (Blueprint Node: "Set Niagara Variable (Float)")
NiagaraComp->SetFloatParameter(FName("User.MyCustomValue"), 10.0f);

// Runtime에서 변경
void UpdateEffect(float NewValue)
{
    NiagaraComp->SetFloatParameter(FName("User.MyCustomValue"), NewValue);
    // → SystemInstance->GetUserParameterStore()로 전달됨
}
```

**System Instance에서 접근:**
```cpp
void FNiagaraSystemInstance::Tick_GameThread(float DeltaSeconds)
{
    // User Parameter 읽기
    float CustomValue = GetUserParameterStore().GetParameterValue<float>(
        FNiagaraVariable(FNiagaraTypeDefinition::GetFloatDef(), TEXT("User.MyCustomValue"))
    );

    // SystemParameterStore로 복사
    SystemParameterStore.SetParameterValue(CustomValue, InternalCustomValueParam);
    SystemParameterStore.Tick();  // Emitter/Script로 전파
}
```

---

### 예시 4: Rapid Iteration Parameter

**Rapid Iteration이란?**
- Module의 파라미터를 **재컴파일 없이** 런타임에 변경 가능
- Editor에서 실시간 조정 가능
- Shipping Build에서는 Baking 가능

**Setup (Module):**
```hlsl
// MyCustomModule.usf
void MyCustomModule(
    float Speed,  // Rapid Iteration Parameter
    inout float3 Velocity)
{
    Velocity += float3(0, 0, Speed);
}
```

**Compiled Data:**
```cpp
// FNiagaraVMExecutableData
TArray<FNiagaraVariable> BakedRapidIterationParameters;
// Contains: "Module.Speed" with default value 10.0

// Script Execution:
if (bUsesRapidIterationParams)
{
    // Dynamic: Read from ParameterStore
    float Speed = Parameters.GetParameterValue<float>("Module.Speed");
}
else
{
    // Baked: Constant in ByteCode
    float Speed = 10.0f;  // Compile-time constant
}
```

**Editor에서 변경:**
```cpp
// User가 "Speed" 값을 UI에서 변경
void OnSpeedChanged(float NewSpeed)
{
    // Emitter's RapidIterationParameterStore 업데이트
    EmitterInstance->GetRapidIterationParameterStore().SetParameterValue(
        NewSpeed,
        FNiagaraVariable(FNiagaraTypeDefinition::GetFloatDef(), TEXT("Module.Speed"))
    );

    // 재컴파일 불필요!
    // 다음 Tick에서 자동으로 Script로 전달됨
}
```

---

### 예시 5: DataInterface Parameter 관리

**Setup:**
```cpp
// Module에서 StaticMesh DataInterface 사용
UNiagaraDataInterfaceStaticMesh* MeshDI = NewObject<UNiagaraDataInterfaceStaticMesh>();
MeshDI->SetSourceComponent(MyStaticMeshComponent);

FNiagaraVariable DIVar(
    FNiagaraTypeDefinition(UNiagaraDataInterfaceStaticMesh::StaticClass()),
    TEXT("MyModule.StaticMeshDI")
);

EmitterParameterStore.AddParameter(DIVar, true);
EmitterParameterStore.SetDataInterface(MeshDI, DIVar);
```

**Runtime DataInterface Binding:**
```cpp
// Script Execution Context에서
void FNiagaraScriptExecutionContext::Init(
    FNiagaraSystemInstance* Instance,
    UNiagaraScript* InScript,
    ENiagaraSimTarget InTarget)
{
    // DataInterface 초기화
    const TArray<UNiagaraDataInterface*>& DataInterfaces = Parameters.GetDataInterfaces();

    for (int32 i = 0; i < DataInterfaces.Num(); ++i)
    {
        UNiagaraDataInterface* DI = DataInterfaces[i];

        // Per-Instance Data 할당
        void* PerInstanceData = DI->AllocatePerInstanceData(Instance);
        UserPtrTable[i] = PerInstanceData;

        // External Function Binding
        TArray<FVMExternalFunction> Functions;
        DI->GetVMExternalFunction(BindingInfo, PerInstanceData, Functions);

        FunctionTable.Append(Functions);
    }
}
```

**VM에서 DataInterface 호출:**
```
// ByteCode:
external_func_call FuncID=5, NumInputs=1, NumOutputs=3

// Runtime:
const FVMExternalFunction& ExtFunc = FunctionTable[5];
void* InstanceData = UserPtrTable[DIIndex];

ExtFunc.Execute(InstanceData, Context);
// → UNiagaraDataInterfaceStaticMesh::GetTrianglePosition() 호출
```

---

### 예시 6: LWC (Large World Coordinates) Position Handling

**LWC 문제:**
- Unreal 5부터 FVector는 double precision (64-bit)
- Niagara는 float precision (32-bit) 사용
- Position 파라미터는 특별 처리 필요

**OriginalPositionData 저장:**
```cpp
// User가 Position Parameter 설정
void SetPositionParameter(const FVector& WorldPosition, const FName& ParamName)
{
    // 1. Original Position 저장 (double precision)
    ParameterStore.SetPositionData(ParamName, WorldPosition);

    // 2. Relative Position 계산 (float precision)
    FVector RelativePosition = WorldPosition - SystemWorldLocation;

    // 3. ParameterData에 float로 저장
    ParameterStore.SetParameterValue(FVector3f(RelativePosition), ParamName);
}
```

**Runtime Conversion:**
```cpp
void FNiagaraParameterStore::ResolvePositions(FNiagaraLWCConverter LwcConverter)
{
    for (const FNiagaraPositionSource& PosSource : OriginalPositionData)
    {
        // World Position → Simulation Space Position
        FVector3f SimPos = LwcConverter.ConvertWorldToSimulationPosition(PosSource.Value);

        // ParameterData 업데이트
        int32 Offset = IndexOf(FNiagaraVariable(FNiagaraTypeDefinition::GetPositionDef(), PosSource.Name));
        SetParameterValue(SimPos, Offset);
    }
}
```

---

## ⚡ 성능 최적화

### ✅ 해야 할 것

**1. Binding 최소화:**
```cpp
// 좋은 예: 필요한 Parameter만 바인딩
FNiagaraBoundParameterArray BoundParams;
BoundParams.Add(FNiagaraBoundParameter(SystemDeltaTimeParam, 0, 0));
BoundParams.Add(FNiagaraBoundParameter(SystemNumParticlesParam, 4, 4));
EmitterStore.Bind(&SystemStore, &BoundParams);

// 나쁜 예: 모든 Parameter 바인딩
EmitterStore.Bind(&SystemStore);  // 수백 개 파라미터 복사
```

**2. Dirty Flag 활용:**
```cpp
// 좋은 예: 변경 시에만 Dirty Flag 설정
void UpdateParameter(float NewValue)
{
    if (CurrentValue != NewValue)
    {
        ParameterStore.SetParameterValue(NewValue, Param);  // Auto-marks dirty
    }
}

// 나쁜 예: 매 프레임 설정
void Tick()
{
    ParameterStore.SetParameterValue(CurrentValue, Param);  // 불필요한 복사 트리거
}
```

**3. Constant Parameter 사용:**
```hlsl
// 좋은 예: 변하지 않는 값은 Constant로
static const float PI = 3.14159265f;
float Angle = Particles.Time * PI;

// 나쁜 예: Parameter로 전달
float PI = Module.PiValue;  // 불필요한 ParameterStore 조회
```

---

### ❌ 피해야 할 것

**1. 과도한 User Parameter:**
```cpp
// 나쁜 예: 너무 많은 User Parameter
NiagaraComp->SetFloatParameter("User.Param1", 1.0f);
NiagaraComp->SetFloatParameter("User.Param2", 2.0f);
// ... 100개 Parameter
// → 매 Tick마다 100개 복사

// 좋은 예: Struct로 묶기
struct FMyParams
{
    float Param1;
    float Param2;
    // ...
};
NiagaraComp->SetUserParameterValue("User.MyParams", MyParams);
// → 단일 복사
```

**2. DataInterface 과다 사용:**
```cpp
// 나쁜 예: 모든 Emitter에 같은 DI
Emitter1->AddDataInterface(StaticMeshDI);  // Copy 1
Emitter2->AddDataInterface(StaticMeshDI);  // Copy 2
Emitter3->AddDataInterface(StaticMeshDI);  // Copy 3
// → 3배 메모리, 3배 Tick overhead

// 좋은 예: System Level에서 공유
SystemParameterStore.AddDataInterface(StaticMeshDI);  // Single instance
// Emitter들은 Binding으로 접근
```

**3. 불필요한 Parameter 전달:**
```hlsl
// 나쁜 예: 사용하지 않는 Parameter 전달
void MyModule(
    float Speed,
    float Mass,
    float Friction,
    float Drag,
    float Damping)
{
    Velocity += Speed;  // Speed만 사용
}

// 좋은 예: 필요한 것만 전달
void MyModule(float Speed)
{
    Velocity += Speed;
}
```

---

## 🐛 디버깅 가이드

### 일반적인 함정

**❌ Parameter Not Found:**
```cpp
// 증상: GetParameterValue가 default 값 반환
// 원인: Parameter 이름 typo 또는 Store에 없음

// 디버깅:
void DebugParameter(const FName& ParamName)
{
    TArray<FNiagaraVariable> AllParams;
    ParameterStore.GetParameters(AllParams);

    for (const FNiagaraVariable& Param : AllParams)
    {
        UE_LOG(LogNiagara, Log, TEXT("Available: %s"), *Param.GetName().ToString());
    }

    // 찾고자 하는 Parameter 확인
    int32 Offset = ParameterStore.IndexOf(FNiagaraVariable(Type, ParamName));
    if (Offset == INDEX_NONE)
    {
        UE_LOG(LogNiagara, Error, TEXT("Parameter not found: %s"), *ParamName.ToString());
    }
}
```

**❌ Binding Not Working:**
```cpp
// 증상: Source Store 업데이트가 Dest Store로 전파 안됨
// 원인 1: Binding 초기화 실패

// 디버깅:
bool bSuccess = DestStore.Bind(&SourceStore);
if (!bSuccess)
{
    UE_LOG(LogNiagara, Error, TEXT("Binding failed: No matching parameters"));
}

// 원인 2: Tick 호출 안됨
SourceStore.SetParameterValue(NewValue, Param);
SourceStore.Tick();  // ← 이거 빼먹지 말것!
```

**❌ DataInterface Null:**
```cpp
// 증상: GetDataInterface() 반환 nullptr
// 원인: DataInterface가 Initialize 안됨

// 디버깅:
UNiagaraDataInterface* DI = ParameterStore.GetDataInterface(DIParam);
if (!DI)
{
    UE_LOG(LogNiagara, Error, TEXT("DataInterface is null!"));
}
else if (!DI->IsInitialized())
{
    UE_LOG(LogNiagara, Error, TEXT("DataInterface not initialized!"));
    // InitDataInterfaces() 호출 필요
}
```

---

### 디버깅 팁

**1. Parameter Store Dump:**
```cpp
void DumpParameterStore(const FNiagaraParameterStore& Store)
{
    Store.DumpParameters(true);  // Include bindings

    // Output:
    // Parameter: System.DeltaTime (float) Offset=0, Value=0.0166
    // Parameter: Emitter.SpawnRate (float) Offset=4, Value=100.0
    // DataInterface: Module.StaticMeshDI (Index=0)
    // Binding: → EmitterStore (3 parameters)
}
```

**2. Binding Verification:**
```cpp
bool VerifyBindings(const FNiagaraParameterStore& DestStore, const FNiagaraParameterStore& SrcStore)
{
    for (const TPair<FNiagaraParameterStore*, FNiagaraParameterStoreBinding>& Binding : SrcStore.GetBindings())
    {
        if (Binding.Key == &DestStore)
        {
            bool bValid = Binding.Value.VerifyBinding(&DestStore, &SrcStore);
            if (!bValid)
            {
                UE_LOG(LogNiagara, Error, TEXT("Binding verification failed!"));
                Binding.Value.Dump(&DestStore, &SrcStore);
                return false;
            }
        }
    }
    return true;
}
```

**3. Runtime Parameter Tracking:**
```cpp
// 특정 Parameter의 값 변화 추적
void TrackParameter(const FNiagaraVariable& Param)
{
    static float LastValue = 0.0f;
    float CurrentValue = ParameterStore.GetParameterValue<float>(Param);

    if (CurrentValue != LastValue)
    {
        UE_LOG(LogNiagara, Warning, TEXT("Parameter %s changed: %f → %f"),
            *Param.GetName().ToString(), LastValue, CurrentValue);
        LastValue = CurrentValue;
    }
}
```

---

## 🎯 핵심 정리

### Parameter System 요약

| 컴포넌트 | 역할 | 특징 |
|----------|------|------|
| **FNiagaraParameterStore** | Parameter 저장소 | Scalars, Vectors, DataInterfaces, UObjects 통합 관리 |
| **FNiagaraParameterStoreBinding** | Store 간 바인딩 | 이름 매칭, 자동 동기화 |
| **FNiagaraScriptInstanceParameterStore** | Script 실행용 Store | VM 통합, External Function Table |
| **FNiagaraParameterBinding** | Named Binding | Renderer, Material Parameter Binding |

### 설계 철학

> **"Hierarchical Binding with Automatic Propagation"**
> - System → Emitter → Script 계층 구조
> - Dirty Flag 기반 효율적 동기화
> - DataInterface Polymorphism 지원

### 주요 최적화 포인트

1. **Selective Binding** - 필요한 Parameter만 바인딩
2. **Dirty Flag** - 변경 시에만 복사
3. **Shared DataInterface** - System Level에서 공유
4. **Constant Folding** - 불변 값은 Constant로

---

## 🔗 참조 자료

- **Parameter Store 구현:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraParameterStore.cpp`
- **Parameter Binding:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraParameterBinding.h`
- **Script Execution Context:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScriptExecutionContext.h`
