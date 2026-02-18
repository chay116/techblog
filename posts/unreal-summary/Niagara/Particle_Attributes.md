---
title: "Niagara Particle Attributes 시스템"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara Particle Attributes 시스템

## 🧭 개요

**Niagara Particle Attributes**는 파티클의 상태를 저장하는 **타입 안전한 변수 시스템**입니다. 각 파티클은 Position, Velocity, Color, Size 등의 Attribute를 가지며, 이들은 **FNiagaraDataSet**에 **Structure of Arrays (SoA)** 형태로 저장됩니다. Attribute는 Niagara Script에서 읽고 쓸 수 있으며, 렌더러나 DataInterface를 통해 외부 시스템과도 상호작용합니다.

**핵심 철학:**
> Attribute는 **강타입(Strongly Typed)**이며,
> **SoA 레이아웃**으로 GPU 친화적이고,
> **리플렉션 시스템**을 통해 Blueprint/C++에서 동적으로 접근 가능하다.

**📂 주요 파일 위치:**
- Types: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraTypes.h`
- Variable: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraVariableMetaData.h`
- DataSet: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataSet.h`

---

## 🏗️ 핵심 타입 시스템

### 1. **FNiagaraTypeDefinition - 타입 정의**

**역할:** Niagara에서 사용 가능한 모든 타입을 정의

**Built-in 타입:**

```cpp
// Scalar 타입
FNiagaraTypeDefinition::GetFloatDef()    // float
FNiagaraTypeDefinition::GetIntDef()      // int32
FNiagaraTypeDefinition::GetBoolDef()     // bool (실제로는 FNiagaraBool)

// Vector 타입
FNiagaraTypeDefinition::GetVec2Def()     // FVector2f
FNiagaraTypeDefinition::GetVec3Def()     // FVector3f
FNiagaraTypeDefinition::GetVec4Def()     // FVector4f
FNiagaraTypeDefinition::GetColorDef()    // FLinearColor
FNiagaraTypeDefinition::GetQuatDef()     // FQuat4f

// Matrix
FNiagaraTypeDefinition::GetMatrix4Def()  // FMatrix44f

// ID 타입
FNiagaraTypeDefinition::GetIDDef()       // FNiagaraID (int32 Index + int32 AcquireTag)

// Enum
FNiagaraTypeDefinition::GetExecutionStateEnum()    // ENiagaraExecutionState
FNiagaraTypeDefinition::GetCoordinateSpaceEnum()   // ENiagaraCoordinateSpace

// UObject 참조
FNiagaraTypeDefinition::GetUObjectDef()            // UObject*
FNiagaraTypeDefinition::GetUTexture2DDef()         // UTexture2D*
FNiagaraTypeDefinition::GetUStaticMeshDef()        // UStaticMesh*

// Custom Structs
FNiagaraTypeDefinition(UScriptStruct*)  // 커스텀 구조체
```

**타입 크기:**

```cpp
FNiagaraTypeDefinition TypeDef = FNiagaraTypeDefinition::GetVec3Def();
int32 Size = TypeDef.GetSize();  // 12 bytes (3 x sizeof(float))
int32 Alignment = TypeDef.GetAlignment();  // 4 bytes
```

---

### 2. **FNiagaraVariable - 타입 + 이름**

**역할:** Attribute/Parameter를 표현하는 기본 단위

**구조:**

```cpp
struct FNiagaraVariable
{
    FName Name;                        // 예: "Particles.Position"
    FNiagaraTypeDefinition TypeDef;    // 예: FVector3f
    TArray<uint8> VarData;             // 기본값 (선택적)

    // 헬퍼 함수
    bool IsDataAllocated() const { return VarData.Num() > 0; }
    bool IsDataInterface() const { return TypeDef.IsDataInterface(); }
    bool IsUObject() const { return TypeDef.IsUObject(); }

    template<typename T>
    void SetValue(const T& Value)
    {
        VarData.SetNumUninitialized(sizeof(T));
        FMemory::Memcpy(VarData.GetData(), &Value, sizeof(T));
    }

    template<typename T>
    T GetValue() const
    {
        check(VarData.Num() == sizeof(T));
        T Value;
        FMemory::Memcpy(&Value, VarData.GetData(), sizeof(T));
        return Value;
    }
};
```

**예시:**

```cpp
// Position Attribute 생성
FNiagaraVariable PositionVar(FNiagaraTypeDefinition::GetVec3Def(), TEXT("Particles.Position"));

// 기본값 설정
PositionVar.SetValue(FVector3f(0, 0, 100));

// 값 읽기
FVector3f DefaultPos = PositionVar.GetValue<FVector3f>();
```

---

### 3. **Standard Particle Attributes**

Niagara는 파티클에 사용되는 **표준 Attribute**를 정의합니다:

```cpp
// 필수 Attribute (항상 존재)
SYS_PARAM_PARTICLES_POSITION         // FVector3f - 파티클 위치
SYS_PARAM_PARTICLES_VELOCITY         // FVector3f - 속도
SYS_PARAM_PARTICLES_COLOR            // FLinearColor - 색상
SYS_PARAM_PARTICLES_SPRITE_ROTATION  // float - 회전 (Radians)
SYS_PARAM_PARTICLES_NORMALIZED_AGE   // float - 0~1 정규화된 나이
SYS_PARAM_PARTICLES_SPRITE_SIZE      // FVector2f - 스프라이트 크기
SYS_PARAM_PARTICLES_LIFETIME         // float - 전체 수명
SYS_PARAM_PARTICLES_UNIQUE_ID        // FNiagaraID - 고유 ID

// 선택적 Attribute (필요 시 추가)
SYS_PARAM_PARTICLES_MESH_ORIENTATION // FQuat4f - 메시 방향
SYS_PARAM_PARTICLES_SCALE            // FVector3f - 3D 스케일
SYS_PARAM_PARTICLES_SPRITE_FACING    // FVector3f - Facing Vector
SYS_PARAM_PARTICLES_SPRITE_ALIGNMENT // FVector3f - Alignment Vector
SYS_PARAM_PARTICLES_SUB_IMAGE_INDEX  // float - SubUV 인덱스
SYS_PARAM_PARTICLES_DYNAMIC_MATERIAL_PARAM // FVector4f - Material Parameter
SYS_PARAM_PARTICLES_CAMERA_OFFSET    // float - Camera Offset

// Ribbon Renderer용
SYS_PARAM_PARTICLES_RIBBONID         // FNiagaraID - Ribbon 그룹 ID
SYS_PARAM_PARTICLES_RIBBONWIDTH      // float - Ribbon 폭
SYS_PARAM_PARTICLES_RIBBONTWIST      // float - Ribbon 비틀기
SYS_PARAM_PARTICLES_RIBBONFACING     // FVector3f - Ribbon Facing

// Mesh Renderer용
SYS_PARAM_PARTICLES_MESH_INDEX       // int32 - Mesh 인덱스 (여러 메시 중 선택)
```

**Namespace 규칙:**

```
Particles.Position       // 파티클 Attribute
Emitter.LocalSpace       // Emitter Parameter
System.TimeSinceStart    // System Parameter
User.MyCustomParam       // User Parameter
```

---

## 📦 데이터 레이아웃: Structure of Arrays (SoA)

### CPU 레이아웃

**전통적인 AoS (Array of Structures):**

```cpp
struct Particle
{
    FVector3f Position;
    FVector3f Velocity;
    FLinearColor Color;
    float Age;
};

Particle Particles[1000];  // 메모리 레이아웃:
// [Pos0][Vel0][Col0][Age0][Pos1][Vel1][Col1][Age1]...
```

**Niagara의 SoA (Structure of Arrays):**

```cpp
struct FNiagaraDataBuffer
{
    FNiagaraDataSet* Owner;
    uint32 NumInstances;

    // 각 Attribute별로 별도 버퍼
    TArray<float> PositionBuffer;  // [X0, Y0, Z0, X1, Y1, Z1, ...]
    TArray<float> VelocityBuffer;  // [VX0, VY0, VZ0, VX1, VY1, VZ1, ...]
    TArray<float> ColorBuffer;     // [R0, G0, B0, A0, R1, G1, B1, A1, ...]
    TArray<float> AgeBuffer;       // [Age0, Age1, Age2, ...]
};
```

**메모리 레이아웃 비교:**

```
AoS (나쁨):
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Particle0│ Particle1│ Particle2│ Particle3│ ...      │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│P│V│C│A  │P│V│C│A  │P│V│C│A  │P│V│C│A  │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
  ↑ Cache Miss!  (Position만 필요해도 V, C, A를 읽음)

SoA (좋음):
┌────────────────────────────────────────────────────┐
│ Position Buffer                                    │
├────────────────────────────────────────────────────┤
│ X0│Y0│Z0│X1│Y1│Z1│X2│Y2│Z2│X3│Y3│Z3│...           │
└────────────────────────────────────────────────────┘
  ↑ Cache Friendly! (Position만 연속으로 읽음)

┌────────────────────────────────────────────────────┐
│ Velocity Buffer                                    │
├────────────────────────────────────────────────────┤
│VX0│VY0│VZ0│VX1│VY1│VZ1│VX2│VY2│VZ2│...             │
└────────────────────────────────────────────────────┘
```

**장점:**
1. **Cache 효율**: 같은 Attribute를 여러 파티클에서 읽을 때 캐시 히트율 증가
2. **SIMD 친화적**: Vector 연산 시 연속된 데이터 처리
3. **GPU 최적화**: GPU Compute Shader에서 Coalesced Memory Access
4. **부분 업데이트**: 특정 Attribute만 업데이트 시 해당 버퍼만 접근

---

### GPU 레이아웃

GPU에서는 **StructuredBuffer** 또는 **Texture Buffer**로 저장:

```hlsl
// GPU Shader에서
StructuredBuffer<float> ParticlePositionBuffer;  // [X0, Y0, Z0, X1, Y1, Z1, ...]
StructuredBuffer<float> ParticleVelocityBuffer;
StructuredBuffer<float> ParticleColorBuffer;
StructuredBuffer<float> ParticleAgeBuffer;

[numthreads(64, 1, 1)]
void UpdateParticles(uint3 DispatchThreadID : SV_DispatchThreadID)
{
    uint ParticleIndex = DispatchThreadID.x;
    if (ParticleIndex >= NumParticles)
        return;

    // Position 읽기 (SoA 레이아웃)
    uint BaseIndex = ParticleIndex * 3;
    float3 Position = float3(
        ParticlePositionBuffer[BaseIndex + 0],
        ParticlePositionBuffer[BaseIndex + 1],
        ParticlePositionBuffer[BaseIndex + 2]
    );

    // Velocity 읽기
    float3 Velocity = float3(
        ParticleVelocityBuffer[BaseIndex + 0],
        ParticleVelocityBuffer[BaseIndex + 1],
        ParticleVelocityBuffer[BaseIndex + 2]
    );

    // 업데이트
    Position += Velocity * DeltaTime;

    // Position 쓰기
    ParticlePositionBuffer[BaseIndex + 0] = Position.x;
    ParticlePositionBuffer[BaseIndex + 1] = Position.y;
    ParticlePositionBuffer[BaseIndex + 2] = Position.z;
}
```

---

## 🔧 Attribute 생명주기

### Spawn 시 초기화

```cpp
// Spawn Script
void SpawnParticles(FVectorVMExternalFunctionContext& Context)
{
    // Output Handlers
    VectorVM::FExternalFuncRegisterHandler<float> OutPosX(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosY(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosZ(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutAge(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutLifetime(Context);

    // Emitter Parameter
    FVector3f EmitterPosition = GetEmitterPosition();
    float DefaultLifetime = 2.0f;

    for (int32 i = 0; i < Context.GetNumInstances(); ++i)
    {
        // 랜덤 오프셋
        FVector3f RandomOffset = RandomUnitVector() * 100.0f;
        FVector3f InitialPos = EmitterPosition + RandomOffset;

        // Attribute 쓰기
        *OutPosX.GetDestAndAdvance() = InitialPos.X;
        *OutPosY.GetDestAndAdvance() = InitialPos.Y;
        *OutPosZ.GetDestAndAdvance() = InitialPos.Z;
        *OutAge.GetDestAndAdvance() = 0.0f;
        *OutLifetime.GetDestAndAdvance() = DefaultLifetime;
    }
}
```

---

### Update 시 읽기/쓰기

```cpp
// Update Script
void UpdateParticles(FVectorVMExternalFunctionContext& Context)
{
    // Input Handlers (Previous Frame)
    VectorVM::FExternalFuncInputHandler<float> InPosX(Context);
    VectorVM::FExternalFuncInputHandler<float> InPosY(Context);
    VectorVM::FExternalFuncInputHandler<float> InPosZ(Context);
    VectorVM::FExternalFuncInputHandler<float> InVelX(Context);
    VectorVM::FExternalFuncInputHandler<float> InVelY(Context);
    VectorVM::FExternalFuncInputHandler<float> InVelZ(Context);
    VectorVM::FExternalFuncInputHandler<float> InAge(Context);
    VectorVM::FExternalFuncInputHandler<float> InLifetime(Context);

    // Output Handlers (Current Frame)
    VectorVM::FExternalFuncRegisterHandler<float> OutPosX(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosY(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosZ(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutAge(Context);
    VectorVM::FExternalFuncRegisterHandler<bool> OutAlive(Context);

    float DeltaTime = Context.GetDeltaSeconds();

    for (int32 i = 0; i < Context.GetNumInstances(); ++i)
    {
        // 읽기
        FVector3f Position(InPosX.GetAndAdvance(), InPosY.GetAndAdvance(), InPosZ.GetAndAdvance());
        FVector3f Velocity(InVelX.GetAndAdvance(), InVelY.GetAndAdvance(), InVelZ.GetAndAdvance());
        float Age = InAge.GetAndAdvance();
        float Lifetime = InLifetime.GetAndAdvance();

        // 업데이트
        Age += DeltaTime;
        Position += Velocity * DeltaTime;
        bool bAlive = Age < Lifetime;

        // 쓰기
        *OutPosX.GetDestAndAdvance() = Position.X;
        *OutPosY.GetDestAndAdvance() = Position.Y;
        *OutPosZ.GetDestAndAdvance() = Position.Z;
        *OutAge.GetDestAndAdvance() = Age;
        *OutAlive.GetDestAndAdvance() = bAlive;
    }
}
```

---

## 💡 실전 예시

### 예시 1: Custom Attribute 추가

```cpp
// C++ - Custom Attribute 등록
void RegisterCustomAttributes(UNiagaraEmitter* Emitter)
{
    FNiagaraVariable CustomAttr(FNiagaraTypeDefinition::GetFloatDef(), TEXT("Particles.Temperature"));
    CustomAttr.SetValue(25.0f);  // 기본값: 25도

    Emitter->AddAttribute(CustomAttr);
}

// Niagara Script - 사용
float Temperature = Particles.Temperature;
Temperature += DeltaTime * 10.0;  // 초당 10도 상승
Particles.Temperature = Temperature;

if (Temperature > 100.0)
{
    Particles.Color = float4(1, 0, 0, 1);  // 빨강 (뜨거움)
}
```

---

### 예시 2: Blueprint에서 Attribute 접근

```cpp
// Blueprint Function Library
UFUNCTION(BlueprintCallable, Category="Niagara")
static float GetParticleAttribute(UNiagaraComponent* Component, FName EmitterName, FName AttributeName, int32 ParticleIndex)
{
    FNiagaraSystemInstance* SystemInstance = Component->GetSystemInstance();
    FNiagaraEmitterInstance* EmitterInstance = SystemInstance->GetEmitterByName(EmitterName);

    FNiagaraDataSet& DataSet = EmitterInstance->GetData();
    FNiagaraDataBuffer& CurrentData = DataSet.GetCurrentData();

    FNiagaraVariable AttrVar(FNiagaraTypeDefinition::GetFloatDef(), AttributeName);
    int32 AttrOffset = DataSet.GetCompiledData().Variables.IndexOfByPredicate([&](const FNiagaraVariable& Var) {
        return Var.GetName() == AttributeName;
    });

    if (AttrOffset != INDEX_NONE && ParticleIndex < CurrentData.GetNumInstances())
    {
        const float* DataPtr = CurrentData.GetInstancePtrFloat(AttrOffset, ParticleIndex);
        return *DataPtr;
    }

    return 0.0f;
}
```

---

### 예시 3: Attribute를 Material Parameter로 전달

```cpp
// Sprite Renderer Properties
UNiagaraSpriteRendererProperties* SpriteRenderer = ...;

// Material Parameter Binding 설정
FNiagaraMaterialAttributeBinding Binding;
Binding.AttributeName = TEXT("Particles.Temperature");
Binding.MaterialParameterName = TEXT("ParticleTemperature");

SpriteRenderer->MaterialParameterBindings.Add(Binding);

// Material에서 (ParticleTemperature를 Scalar Parameter로 사용)
// Color = lerp(Blue, Red, ParticleTemperature / 100.0);
```

---

### 예시 4: Attribute 간 의존성

```cpp
// Spawn Script
Particles.Position = Emitter.Position;
Particles.Velocity = RandomUnitVector() * 500.0;
Particles.Lifetime = 2.0;
Particles.Age = 0.0;
Particles.Mass = Random(0.5, 2.0);  // Custom Attribute

// Update Script
float Gravity = 980.0;
float Acceleration = Gravity / Particles.Mass;  // F = ma → a = F/m

Particles.Velocity += float3(0, 0, -Acceleration) * DeltaTime;
Particles.Position += Particles.Velocity * DeltaTime;
Particles.Age += DeltaTime;

if (Particles.Age > Particles.Lifetime)
{
    Particles.Kill();
}
```

---

### 예시 5: Attribute Culling (메모리 최적화)

```cpp
// 사용하지 않는 Attribute는 자동 제거됨
// Spawn Script
Particles.Position = ...;
Particles.Velocity = ...;
Particles.UnusedAttribute = 0.0;  // ← Update에서 사용 안 함

// Update Script
Particles.Position += Particles.Velocity * DeltaTime;
// UnusedAttribute 사용 안 함

// 결과: UnusedAttribute는 컴파일 시 제거됨 (메모리 절약)
```

---

## 🐛 디버깅 팁

### Attribute 값 확인

```cpp
// Console Command
Niagara.Debug.ParticleData 1

// 출력:
// Emitter: MyEmitter
//   Particle 0: Position=(100, 200, 300), Velocity=(10, 0, 0), Age=0.5
//   Particle 1: Position=(150, 200, 300), Velocity=(12, 0, 0), Age=0.6
//   ...
```

### Attribute 메모리 사용량

```cpp
// FNiagaraDataSet::GetTotalBytesUsed()
uint32 TotalBytes = DataSet.GetTotalBytesUsed();
UE_LOG(LogNiagara, Log, TEXT("DataSet Memory: %.2f KB"), TotalBytes / 1024.0f);

// Attribute별 크기
for (const FNiagaraVariable& Var : DataSet.GetVariables())
{
    int32 Size = Var.GetSizeInBytes() * DataSet.GetCurrentData().GetNumInstances();
    UE_LOG(LogNiagara, Log, TEXT("  %s: %.2f KB"), *Var.GetName().ToString(), Size / 1024.0f);
}
```

---

## 📚 참고 자료

### 주요 타입 요약

| 타입 | C++ | HLSL | 크기 |
|------|-----|------|------|
| float | float | float | 4 bytes |
| int32 | int32 | int | 4 bytes |
| bool | FNiagaraBool | bool | 4 bytes |
| FVector2f | FVector2f | float2 | 8 bytes |
| FVector3f | FVector3f | float3 | 12 bytes |
| FVector4f | FVector4f | float4 | 16 bytes |
| FLinearColor | FLinearColor | float4 | 16 bytes |
| FQuat4f | FQuat4f | float4 | 16 bytes |
| FMatrix44f | FMatrix44f | float4x4 | 64 bytes |
| FNiagaraID | struct { int32, int32 } | int2 | 8 bytes |

### 핵심 Attribute 목록

| Attribute | 타입 | 필수 | 설명 |
|-----------|------|------|------|
| Position | FVector3f | ✅ | 파티클 위치 |
| Velocity | FVector3f | ✅ | 속도 |
| Color | FLinearColor | ✅ | 색상 (RGBA) |
| SpriteRotation | float | ✅ | 2D 회전 |
| SpriteSize | FVector2f | ✅ | 스프라이트 크기 |
| NormalizedAge | float | ✅ | 0~1 정규화된 나이 |
| Lifetime | float | ✅ | 전체 수명 |
| UniqueID | FNiagaraID | ✅ | 고유 ID |
| MeshOrientation | FQuat4f | ❌ | 메시 방향 |
| Scale | FVector3f | ❌ | 3D 스케일 |
| DynamicMaterialParameter | FVector4f | ❌ | Material Parameter |

---

> 📝 **작성일:** 2025-01-22
> 📝 **버전:** Unreal Engine 5.7
