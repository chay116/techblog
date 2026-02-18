---
title: "Memory Management (메모리 관리)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Memory Management (메모리 관리)

## 🧭 개요

Niagara의 메모리 관리 시스템은 **FNiagaraDataBuffer**와 **FNiagaraDataSet**를 중심으로 파티클 데이터를 효율적으로 관리하며, **UNiagaraComponentPool**을 통해 Component 재사용을 최적화합니다. 이 시스템은 CPU/GPU 메모리를 분리 관리하고, SoA(Structure of Arrays) 레이아웃을 사용하여 SIMD 성능을 최대화합니다.

**핵심 설계 원칙:**
- **SoA (Structure of Arrays) 레이아웃**: Float/Int32/Half 버퍼 분리로 SIMD 최적화
- **Double Buffering**: Current/Destination 버퍼 교체로 Thread-Safe 보장
- **Component Pooling**: 생성/파괴 비용 감소를 위한 재사용
- **Ref Counting**: FNiagaraSharedObject 기반 안전한 lifetime 관리

---

## 🧱 메모리 아키텍처

### 전체 구조도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FNiagaraDataSet                                  │
│  (Particle DataSet - System/Emitter별로 하나씩 존재)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FNiagaraDataSetCompiledData                                            │
│  ├─ Variables (Position, Velocity, Color, ...)                         │
│  ├─ TotalFloatComponents, TotalInt32Components, TotalHalfComponents    │
│  └─ Variable Layouts (각 Variable의 Component 위치)                     │
│                                                                         │
│  Buffer Pool:                                                           │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐            │
│  │ DataBuffer[0]  │  │ DataBuffer[1]  │  │ DataBuffer[2]  │            │
│  │ (Current)      │  │ (Destination)  │  │ (RenderThread) │            │
│  └────────────────┘  └────────────────┘  └────────────────┘            │
│         ▲                    ▲                                          │
│         │                    │                                          │
│    CurrentData          DestinationData                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     FNiagaraDataBuffer                                  │
│  (단일 프레임의 파티클 데이터)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  CPU Buffers (SoA Layout):                                             │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ FloatData[]:   Pos.X[0..N], Pos.Y[0..N], Pos.Z[0..N], ...   │      │
│  │                ↑────────────────────────────────────┘        │      │
│  │                FloatStride (Instance 개수만큼)               │      │
│  └──────────────────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ Int32Data[]:   ID[0..N], SomeInt[0..N], ...                 │      │
│  └──────────────────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ HalfData[]:    PackedValue[0..N], ...                       │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  GPU Buffers:                                                           │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ GPUBufferFloat (FRWBuffer) - Shader에서 읽기/쓰기            │      │
│  │ GPUBufferInt   (FRWBuffer)                                   │      │
│  │ GPUBufferHalf  (FRWBuffer)                                   │      │
│  │ GPUIDToIndexTable (FRWBuffer) - ID → Index 매핑             │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  RegisterTable[]:  빠른 접근을 위한 포인터 배열                        │
│  ├─ RegisterTable[0] → FloatData + 0 * FloatStride (Pos.X)             │
│  ├─ RegisterTable[1] → FloatData + 1 * FloatStride (Pos.Y)             │
│  └─ ...                                                                 │
│                                                                         │
│  IDToIndexTable[]: Persistent ID → Buffer Index 매핑                   │
│                                                                         │
│  NumInstances: 현재 살아있는 파티클 개수                                │
│  NumInstancesAllocated: 할당된 메모리 크기                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### SoA (Structure of Arrays) 레이아웃

**전통적인 AoS (Array of Structures):**
```cpp
struct Particle {
    FVector Position;   // 12 bytes
    FVector Velocity;   // 12 bytes
    FLinearColor Color; // 16 bytes
    float Age;          // 4 bytes
};

Particle Particles[1000];  // 연속된 메모리에 Particle 구조체 배열
// Memory: [P0.Pos][P0.Vel][P0.Col][P0.Age][P1.Pos][P1.Vel]...
```

**Niagara의 SoA:**
```cpp
// Float Buffer
float FloatData[] = {
    Pos.X[0], Pos.X[1], ..., Pos.X[999],  // Component 0: 모든 파티클의 X
    Pos.Y[0], Pos.Y[1], ..., Pos.Y[999],  // Component 1: 모든 파티클의 Y
    Pos.Z[0], Pos.Z[1], ..., Pos.Z[999],  // Component 2: 모든 파티클의 Z
    Vel.X[0], Vel.X[1], ..., Vel.X[999],  // Component 3
    // ...
};

// Int32 Buffer (별도)
int32 Int32Data[] = {
    ID[0], ID[1], ..., ID[999],
    // ...
};
```

**SoA의 장점:**
- **SIMD 최적화**: 같은 Component가 연속되어 있어 벡터 연산 효율적
- **캐시 친화적**: 같은 Component만 접근할 때 캐시 히트율 증가
- **유연한 레이아웃**: 타입별로 버퍼 분리 (Float/Int32/Half)

---

## 🧩 계층별 상세 분석

### 1. **FNiagaraSharedObject - Ref Counting 기반 Lifetime 관리**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataSet.h:20`

**역할:** 다중 Thread에서 안전하게 객체를 읽고 쓸 수 있도록 Reference Counting 제공

```cpp
// NiagaraDataSet.h:20
class FNiagaraSharedObject
{
public:
    FNiagaraSharedObject() : ReadRefCount(0) {}

    // Reader 추가 (여러 Reader 가능)
    inline void AddRef()
    {
        check(!IsBeingWritten());
        ReadRefCount++;
    }

    // Reader 제거
    inline void Release()
    {
        check(IsBeingRead());
        ReadRefCount--;
    }

    // Write Lock 획득 (단독 Write만 가능)
    inline bool TryLock()
    {
        // Reader가 없을 때만 Lock 가능
        int32 Expected = 0;
        return ReadRefCount.CompareExchange(Expected, INDEX_NONE);
    }

    // Write Lock 해제
    inline void Unlock()
    {
        int32 Expected = INDEX_NONE;
        ensureAlwaysMsgf(ReadRefCount.CompareExchange(Expected, 0),
            TEXT("Trying to release a write lock that is not locked."));
    }

    // Write Lock 해제 후 즉시 Read Lock으로 전환
    inline TRefCountPtr<FNiagaraSharedObject> UnlockForRead()
    {
        int32 Expected = INDEX_NONE;
        ensureAlwaysMsgf(ReadRefCount.CompareExchange(Expected, 1),
            TEXT("Trying to release a write lock that is not locked."));
        return TRefCountPtr<FNiagaraSharedObject>(this, false);
    }

    inline bool IsInUse() const { return ReadRefCount.Load() != 0; }
    inline bool IsBeingRead() const { return ReadRefCount.Load() > 0; }
    inline bool IsBeingWritten() const { return ReadRefCount.Load() == INDEX_NONE; }

protected:
    /**
     * ReadRefCount:
     * - 0: 사용 중 아님
     * - 1~N: N개의 Reader가 읽는 중
     * - INDEX_NONE: Writer가 쓰는 중 (단독)
     */
    TAtomic<int32> ReadRefCount;

    static FCriticalSection CritSec;
    static TArray<FNiagaraSharedObject*> DeferredDeletionList;
};
```

**핵심 설계:**
- **Multiple Reader, Single Writer (MRSW)**: 여러 Thread가 동시에 읽을 수 있지만, 쓰기는 단독
- **INDEX_NONE을 Write Lock으로 사용**: -1 값을 특수 값으로 사용
- **Deferred Deletion**: 사용 중인 객체는 삭제 큐에 넣어 나중에 안전하게 삭제

---

### 2. **FNiagaraDataBuffer - 단일 프레임 데이터**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataSet.h:85`

**역할:** 한 프레임의 모든 파티클 데이터를 SoA 레이아웃으로 저장

#### 메모리 할당

```cpp
// NiagaraDataSet.h:102
void FNiagaraDataBuffer::Allocate(uint32 NumInstances, bool bMaintainExisting)
{
    CheckUsage(false);  // Write 권한 확인

    NumInstancesAllocated = NumInstances;

    // Float Buffer 할당
    const uint32 NumFloatComponents = Owner->GetNumFloatComponents();
    if (NumFloatComponents > 0)
    {
        FloatStride = GetSafeComponentBufferSize(NumInstances);
        FloatData.SetNumUninitialized(FloatStride * NumFloatComponents);
    }

    // Int32 Buffer 할당
    const uint32 NumInt32Components = Owner->GetNumInt32Components();
    if (NumInt32Components > 0)
    {
        Int32Stride = GetSafeComponentBufferSize(NumInstances);
        Int32Data.SetNumUninitialized(Int32Stride * NumInt32Components);
    }

    // Half Buffer 할당
    const uint32 NumHalfComponents = Owner->GetNumHalfComponents();
    if (NumHalfComponents > 0)
    {
        HalfStride = GetSafeComponentBufferSize(NumInstances);
        HalfData.SetNumUninitialized(HalfStride * NumHalfComponents);
    }

    // Persistent ID 사용 시 IDToIndexTable 할당
    if (Owner->RequiresPersistentIDs())
    {
        IDToIndexTable.SetNumUninitialized(NumInstances);
    }

    BuildRegisterTable();  // 빠른 접근을 위한 포인터 배열 구축
}
```

**GetSafeComponentBufferSize 계산:**
```cpp
// NiagaraDataSet.h:199
inline int32 GetSafeComponentBufferSize(int32 RequiredSize) const
{
    // VECTOR_WIDTH_BYTES (16 bytes)로 정렬
    // → SIMD 연산 최적화 + 다른 Component 덮어쓰기 방지
    return Align(RequiredSize, VECTOR_WIDTH_BYTES) + VECTOR_WIDTH_BYTES;
}
```

**예시:**
```
NumInstances = 100
NumFloatComponents = 10 (Pos.X, Pos.Y, Pos.Z, Vel.X, ...)

FloatStride = Align(100, 16) + 16 = 112
FloatData.Num() = 112 * 10 = 1120 bytes
```

#### RegisterTable 구축

```cpp
// BuildRegisterTable 내부 로직
void FNiagaraDataBuffer::BuildRegisterTable()
{
    const uint32 NumFloatComponents = Owner->GetNumFloatComponents();
    const uint32 NumInt32Components = Owner->GetNumInt32Components();
    const uint32 NumHalfComponents = Owner->GetNumHalfComponents();

    const uint32 TotalComponents = NumFloatComponents + NumInt32Components + NumHalfComponents;
    RegisterTable.SetNumUninitialized(TotalComponents);

    uint32 RegisterIdx = 0;

    // Float Components
    RegisterTypeOffsets[0] = 0;
    for (uint32 i = 0; i < NumFloatComponents; ++i)
    {
        RegisterTable[RegisterIdx++] = FloatData.GetData() + FloatStride * i;
    }

    // Int32 Components
    RegisterTypeOffsets[1] = RegisterIdx;
    for (uint32 i = 0; i < NumInt32Components; ++i)
    {
        RegisterTable[RegisterIdx++] = Int32Data.GetData() + Int32Stride * i;
    }

    // Half Components
    RegisterTypeOffsets[2] = RegisterIdx;
    for (uint32 i = 0; i < NumHalfComponents; ++i)
    {
        RegisterTable[RegisterIdx++] = HalfData.GetData() + HalfStride * i;
    }
}
```

**RegisterTable 활용:**
```cpp
// VectorVM에서 빠른 Component 접근
uint8** RegisterTable = DataBuffer->EditRegisterTable().GetData();
float* PosXPtr = (float*)RegisterTable[0];  // Pos.X Component 시작 주소

// Instance 순회
for (uint32 i = 0; i < NumInstances; ++i)
{
    float PosX = PosXPtr[i];  // 연속된 메모리 접근 (캐시 친화적)
}
```

#### GPU Buffer 할당

```cpp
// NiagaraDataSet.h:105
void FNiagaraDataBuffer::AllocateGPU(
    FRHICommandListBase& RHICmdList,
    uint32 InNumInstances,
    ERHIFeatureLevel::Type FeatureLevel,
    const TCHAR* DebugSimName)
{
    check(IsInRenderingThread());

    NumInstancesAllocated = InNumInstances;

    // Float Buffer
    if (Owner->GetNumFloatComponents() > 0)
    {
        FloatStride = InNumInstances;
        GPUBufferFloat.Initialize(
            RHICmdList,
            TEXT("NiagaraGPUFloat"),
            sizeof(float),
            FloatStride * Owner->GetNumFloatComponents(),
            EPixelFormat::PF_R32_FLOAT,
            BUF_Static
        );
    }

    // Int32 Buffer
    if (Owner->GetNumInt32Components() > 0)
    {
        Int32Stride = InNumInstances;
        GPUBufferInt.Initialize(
            RHICmdList,
            TEXT("NiagaraGPUInt"),
            sizeof(int32),
            Int32Stride * Owner->GetNumInt32Components(),
            EPixelFormat::PF_R32_SINT,
            BUF_Static
        );
    }

    // Half Buffer
    if (Owner->GetNumHalfComponents() > 0)
    {
        HalfStride = InNumInstances;
        GPUBufferHalf.Initialize(
            RHICmdList,
            TEXT("NiagaraGPUHalf"),
            sizeof(FFloat16),
            HalfStride * Owner->GetNumHalfComponents(),
            EPixelFormat::PF_R16F,
            BUF_Static
        );
    }

    // ID to Index Table (Persistent ID 지원)
    if (Owner->RequiresPersistentIDs())
    {
        GPUIDToIndexTable.Initialize(
            RHICmdList,
            TEXT("NiagaraGPUIDTable"),
            sizeof(int32),
            InNumInstances,
            EPixelFormat::PF_R32_SINT,
            BUF_Static
        );
    }
}
```

**GPU Buffer 특징:**
- **FRWBuffer**: Read/Write 가능한 Structured Buffer
- **RenderThread 전용**: GPU 버퍼는 RenderThread에서만 생성/접근
- **PF_R32_FLOAT/SINT/R16F**: Pixel Format으로 타입 지정

---

### 3. **FNiagaraDataSet - Buffer Pool 관리**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataSet.h:266`

**역할:** 여러 DataBuffer를 관리하고 Current/Destination 버퍼 교체

```cpp
// NiagaraDataSet.h:266
class FNiagaraDataSet
{
public:
    void Init(const FNiagaraDataSetCompiledData* InDataSetCompiledData, int32 DefaultNumBuffers = 0);

    // Simulation 시작: Destination 버퍼 획득
    FNiagaraDataBuffer& BeginSimulate(bool bResetDestinationData = true);

    // Simulation 종료: Current ↔ Destination 교체
    void EndSimulate(bool SetCurrentData = true);

    FNiagaraDataBuffer& AllocateBuffer();

private:
    FNiagaraCompiledDataReference<FNiagaraDataSetCompiledData> CompiledData;

    /** 현재 읽기 버퍼 (RenderThread도 읽을 수 있음) */
    FNiagaraDataBuffer* CurrentData;

    /** 현재 쓰기 버퍼 (Simulation 중에만 유효) */
    FNiagaraDataBuffer* DestinationData;

    /**
     * Buffer Pool (일반적으로 2~3개)
     * - Data[0]: Current
     * - Data[1]: Destination
     * - Data[2+]: RenderThread가 아직 사용 중
     */
    TArray<FNiagaraDataBuffer*, TInlineAllocator<2>> Data;

    uint32 MaxInstanceCount;     // 최대 파티클 개수 제한
    uint32 MaxAllocationCount;   // 실제 할당 가능한 최대 개수

    bool bInitialized;
};
```

#### BeginSimulate / EndSimulate 패턴

```cpp
// BeginSimulate: 쓰기용 버퍼 획득
FNiagaraDataBuffer& FNiagaraDataSet::BeginSimulate(bool bResetDestinationData)
{
    check(DestinationData == nullptr);  // 중첩 호출 방지

    // 사용 가능한 버퍼 찾기
    DestinationData = nullptr;
    for (FNiagaraDataBuffer* Buffer : Data)
    {
        // Write Lock 획득 시도
        if (Buffer->TryLock())
        {
            DestinationData = Buffer;
            break;
        }
    }

    // 사용 가능한 버퍼가 없으면 새로 할당
    if (DestinationData == nullptr)
    {
        DestinationData = new FNiagaraDataBuffer(this);
        DestinationData->TryLock();
        Data.Add(DestinationData);
    }

    if (bResetDestinationData)
    {
        DestinationData->SetNumInstances(0);
    }

    return *DestinationData;
}

// EndSimulate: Current ↔ Destination 교체
void FNiagaraDataSet::EndSimulate(bool SetCurrentData)
{
    check(DestinationData != nullptr);

    if (SetCurrentData)
    {
        // DestinationData를 새로운 CurrentData로 설정
        FNiagaraDataBuffer* OldCurrent = CurrentData;

        // Write Lock → Read Lock으로 전환
        CurrentData = DestinationData->UnlockForRead().GetReference();

        // 이전 CurrentData는 Release (Ref Count 감소)
        if (OldCurrent)
        {
            OldCurrent->Release();
        }
    }
    else
    {
        // Destination 버퍼 Unlock만 수행
        DestinationData->Unlock();
    }

    DestinationData = nullptr;
}
```

**Buffer Pool 흐름:**

```
Frame N:
    Data[0] (Current) - RefCount = 2 (CPU + RenderThread 읽는 중)
    Data[1] (Idle)    - RefCount = 0

    BeginSimulate():
        Data[1].TryLock() 성공 → DestinationData = Data[1]
        Simulation 수행...
    EndSimulate():
        CurrentData = Data[1] (RefCount = 1)
        Data[0].Release() (RefCount = 1, 아직 RenderThread 사용 중)

Frame N+1:
    Data[0] (Idle?)   - RefCount = 1 (RenderThread 아직 사용 중)
    Data[1] (Current) - RefCount = 1

    BeginSimulate():
        Data[0].TryLock() 실패 (RefCount > 0)
        새 버퍼 할당: Data[2] = new Buffer
        DestinationData = Data[2]
```

---

### 4. **UNiagaraComponentPool - Component 재사용**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponentPool.h:68`

**역할:** UNiagaraComponent 생성/파괴 비용을 줄이기 위한 Object Pool

```cpp
// NiagaraComponentPool.h:38
USTRUCT()
struct FNCPool
{
    GENERATED_BODY()

    /** 사용 가능한 Component 목록 */
    UPROPERTY(transient)
    TArray<FNCPoolElement> FreeElements;

    /** Pool에서 Component 획득 */
    UNiagaraComponent* Acquire(UWorld* World, UNiagaraSystem* Template, ENCPoolMethod PoolingMethod, bool bForceNew = false);

    /** Pool에 Component 반환 */
    void Reclaim(UNiagaraComponent* NC, const double CurrentTimeSeconds);

    /** 오래된 Component 정리 */
    void KillUnusedComponents(double KillTime, UNiagaraSystem* Template);
};

// NiagaraComponentPool.h:15
USTRUCT()
struct FNCPoolElement
{
    GENERATED_BODY()

    UPROPERTY(transient)
    TObjectPtr<UNiagaraComponent> Component;

    double LastUsedTime;  // 마지막 사용 시간
};

// NiagaraComponentPool.h:68
UCLASS(Transient, MinimalAPI)
class UNiagaraComponentPool : public UObject
{
    GENERATED_UCLASS_BODY()

private:
    /** System별 Pool */
    UPROPERTY()
    TMap<TObjectPtr<UNiagaraSystem>, FNCPool> WorldParticleSystemPools;

    double LastParticleSytemPoolCleanTime;

public:
    static bool Enabled();

    void PrimePool(UNiagaraSystem* Template, UWorld* World);
    UNiagaraComponent* CreateWorldParticleSystem(UNiagaraSystem* Template, UWorld* World, ENCPoolMethod PoolingMethod);
    void ReclaimWorldParticleSystem(UNiagaraComponent* Component);
};
```

#### Acquire: Component 획득

```cpp
// NiagaraComponentPool.cpp:83
UNiagaraComponent* FNCPool::Acquire(UWorld* World, UNiagaraSystem* Template, ENCPoolMethod PoolingMethod, bool bForceNew)
{
    check(GbEnableNiagaraSystemPooling);
    check(PoolingMethod != ENCPoolMethod::None);

    FNCPoolElement RetElem;

    // Pool에서 사용 가능한 Component 찾기
    while (FreeElements.Num() && !bForceNew)
    {
        RetElem = FreeElements.Pop(EAllowShrinking::No);

        if (!RetElem.Component || !IsValidChecked(RetElem.Component))
        {
            // Component가 외부에서 파괴됨 (경고)
            UE_LOG(LogNiagara, Warning, TEXT("Pooled NC has been destroyed! | System: %s"), *Template->GetFullName());
            RetElem = FNCPoolElement();
        }
        else
        {
            check(RetElem.Component->GetAsset() == Template);

            // Component 재사용 준비
            RetElem.Component->OnPooledReuse(World);
            break;
        }
    }

    // Pool이 비어있으면 새로 생성
    if (RetElem.Component == nullptr)
    {
        AActor* OuterActor = World->GetWorldSettings();
        UObject* OuterObject = OuterActor ? static_cast<UObject*>(OuterActor) : static_cast<UObject*>(World);

        RetElem.Component = NewObject<UNiagaraComponent>(OuterObject);
        RetElem.Component->SetAutoDestroy(false);  // Pool에서 관리
        RetElem.Component->bAutoActivate = false;
        RetElem.Component->SetAsset(Template);
    }

    RetElem.Component->PoolingMethod = PoolingMethod;

    return RetElem.Component;
}
```

#### Reclaim: Component 반환

```cpp
// NiagaraComponentPool.cpp:124
void FNCPool::Reclaim(UNiagaraComponent* Component, const double CurrentTimeSeconds)
{
    check(Component);
    check(Component->GetAsset());

    // Pool 크기 제한 확인
    if (GbEnableNiagaraSystemPooling != 0 &&
        FreeElements.Num() < (int32)Component->GetAsset()->MaxPoolSize &&
        Component->GetWorld()->bIsTearingDown == false)
    {
        // Component 정리
        Component->DeactivateImmediate();
        Component->DetachFromComponent(FDetachmentTransformRules::KeepWorldTransform);
        Component->SetRelativeScale3D(FVector(1.f));
        Component->SetAbsolute();
        Component->SetCastShadow(false);

        if (GNiagaraKeepPooledComponentsRegistered)
        {
            // Component를 등록 상태로 유지 (Register/Unregister 비용 절약)
            Component->SetVisibility(false);
        }
        else
        {
            Component->UnregisterComponent();
        }

        Component->SetCullDistance(FLT_MAX);

        // Pool에 추가
        Component->PoolingMethod = ENCPoolMethod::FreeInPool;
        FreeElements.Push(FNCPoolElement(Component, CurrentTimeSeconds));
    }
    else
    {
        // Pool 크기 초과 또는 Pooling 비활성화 → 파괴
        Component->PoolingMethod = ENCPoolMethod::None;
        Component->DestroyComponent();
    }
}
```

#### KillUnusedComponents: 오래된 Component 정리

```cpp
// NiagaraComponentPool.cpp:188
void FNCPool::KillUnusedComponents(double KillTime, UNiagaraSystem* Template)
{
    int32 i = 0;
    int32 PrimedSize = GNigaraAllowPrimedPools != 0 ? Template->PoolPrimeSize : 0;

    // PrimeSize 이하로는 줄이지 않음
    while (i < FreeElements.Num() && FreeElements.Num() > PrimedSize)
    {
        if (FreeElements[i].LastUsedTime < KillTime)
        {
            UNiagaraComponent* Component = FreeElements[i].Component;
            if (Component)
            {
                Component->PoolingMethod = ENCPoolMethod::None;
                Component->DestroyComponent();
            }

            FreeElements.RemoveAtSwap(i, EAllowShrinking::No);
        }
        else
        {
            ++i;
        }
    }

    FreeElements.Shrink();
}
```

**Console Variables:**
- `FX.NiagaraComponentPool.KillUnusedTime` (기본: 180초): 이 시간 이상 사용되지 않으면 파괴
- `FX.NiagaraComponentPool.Enable` (기본: 1): Pooling 활성화 여부
- `FX.NiagaraComponentPool.KeepComponentsRegistered` (기본: 1): Pool된 Component를 등록 상태로 유지

---

### 5. **Persistent ID 시스템**

**📂 위치:** `FNiagaraDataBuffer::IDToIndexTable`

**역할:** 파티클 ID를 실제 버퍼 Index로 매핑 (파티클이 죽어도 ID는 유지)

```cpp
// ID를 사용하는 경우 (RequiresPersistentIDs == true)
class FNiagaraDataBuffer
{
    /** ID → Buffer Index 매핑 */
    TArray<int32> IDToIndexTable;

    /** GPU용 ID 매핑 테이블 */
    FRWBuffer GPUIDToIndexTable;
};

class FNiagaraDataSet
{
    /** 사용 가능한 ID 목록 */
    TArray<int32> FreeIDsTable;
    int32 NumFreeIDs;

    /** 이번 프레임에 생성된 ID 목록 */
    TArray<int32> SpawnedIDsTable;

    /** 가장 큰 ID (테이블 크기 최적화) */
    int32 MaxUsedID;

    /** ID 생성 시 Tag (중복 방지) */
    int32 IDAcquireTag;
};
```

**ID 할당 흐름:**

```
1. Spawn:
   - FreeIDsTable에서 사용 가능한 ID 가져오기
   - 없으면 MaxUsedID++ 후 새 ID 생성
   - IDToIndexTable[ID] = NewIndex
   - SpawnedIDsTable에 추가

2. Kill:
   - IDToIndexTable[ID] = INDEX_NONE
   - FreeIDsTable에 ID 반환 (다음 프레임에 재사용)

3. Update:
   - IDToIndexTable[ID]로 실제 버퍼 위치 찾기
   - 데이터 읽기/쓰기
```

**GPU에서 ID 사용:**
```hlsl
// Shader Code
int ParticleID = 12345;
int BufferIndex = GPUIDToIndexTable[ParticleID];

if (BufferIndex != INDEX_NONE)
{
    float3 Position = FloatBuffer[BufferIndex];
    // ...
}
```

---

## 💡 실전 예시

### 예시 1: DataSet Simulation 흐름

```cpp
// Emitter Tick 내부
void FNiagaraEmitterInstance::Tick(float DeltaSeconds)
{
    // 1. Simulation 시작 - Destination 버퍼 획득
    FNiagaraDataBuffer& DestBuffer = ParticleDataSet.BeginSimulate();

    // 2. Spawn 처리
    int32 NumToSpawn = CalculateSpawnCount(DeltaSeconds);
    ParticleDataSet.Allocate(CurrentParticleCount + NumToSpawn);

    // Spawn Script 실행
    SpawnScript.Execute(DestBuffer, 0, NumToSpawn);

    // 3. Update 처리
    UpdateScript.Execute(DestBuffer, 0, DestBuffer.GetNumInstances());

    // 4. 죽은 파티클 제거
    for (int32 i = DestBuffer.GetNumInstances() - 1; i >= 0; --i)
    {
        if (ShouldKillParticle(DestBuffer, i))
        {
            DestBuffer.KillInstance(i);
        }
    }

    // 5. Simulation 종료 - Current ↔ Destination 교체
    ParticleDataSet.EndSimulate();
}
```

**버퍼 교체 효과:**
- CPU가 DestBuffer에 쓰는 동안, RenderThread는 OldCurrent 읽기 가능
- EndSimulate 후 즉시 RenderThread가 새 Current 사용 가능
- Thread-Safe하게 데이터 전달

---

### 예시 2: Component Pooling 사용

```cpp
// Blueprint/C++에서 Particle System 생성
void AMyActor::SpawnEffect(FVector Location)
{
    // Pooling 사용 (자동 반환)
    UNiagaraComponent* NC = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
        GetWorld(),
        MyNiagaraSystem,
        Location,
        FRotator::ZeroRotator,
        FVector::OneVector,
        true,  // bAutoDestroy
        true,  // bAutoActivate
        ENCPoolMethod::AutoRelease,  // ← Pooling 활성화!
        true   // bPreCullCheck
    );

    // Effect 실행 중...
}

// 내부 동작:
// 1. UNiagaraComponentPool::CreateWorldParticleSystem 호출
//    → FNCPool::Acquire()
//    → Pool에서 사용 가능한 Component 반환 (또는 새로 생성)
// 2. Component Activate
// 3. Effect 완료 후 자동으로 Deactivate
// 4. UNiagaraComponent::OnSystemComplete() 호출
//    → UNiagaraComponentPool::ReclaimWorldParticleSystem()
//    → Pool에 반환 (파괴하지 않음!)
```

**Pooling 효과:**
- Component 생성/파괴 비용 제거
- Register/Unregister 비용 감소 (GNiagaraKeepPooledComponentsRegistered = 1)
- 메모리 재사용

---

### 예시 3: SoA 레이아웃 활용 (SIMD)

```cpp
// 모든 파티클의 Position.X 업데이트 (SIMD 최적화)
void UpdatePositionX(FNiagaraDataBuffer& Buffer, float DeltaTime)
{
    uint8** RegisterTable = Buffer.EditRegisterTable().GetData();
    float* PosX = (float*)RegisterTable[0];  // Pos.X Component
    float* VelX = (float*)RegisterTable[3];  // Vel.X Component

    const uint32 NumInstances = Buffer.GetNumInstances();

    // 4개씩 SIMD 연산 (SSE/AVX)
    for (uint32 i = 0; i < NumInstances; i += 4)
    {
        // Load 4 floats at once
        __m128 PosX_SIMD = _mm_load_ps(&PosX[i]);
        __m128 VelX_SIMD = _mm_load_ps(&VelX[i]);
        __m128 DeltaTime_SIMD = _mm_set1_ps(DeltaTime);

        // PosX += VelX * DeltaTime (4 instances simultaneously)
        __m128 Result = _mm_add_ps(PosX_SIMD, _mm_mul_ps(VelX_SIMD, DeltaTime_SIMD));

        // Store 4 floats
        _mm_store_ps(&PosX[i], Result);
    }
}
```

**SoA가 SIMD에 유리한 이유:**
- Pos.X[0..3]이 메모리에 연속 배치
- `_mm_load_ps`로 한 번에 4개 로드
- 캐시 라인(64 bytes)에 16개 float 담김

**AoS의 경우 (비교):**
```cpp
struct Particle { FVector Pos; FVector Vel; };
Particle Particles[100];

// Particles[0].Pos.X, Particles[1].Pos.X가 12 bytes 떨어져 있음!
// → SIMD 로드 불가능, 캐시 미스 증가
```

---

### 예시 4: GPU Buffer 전송

```cpp
// CPU → GPU 버퍼 전송
void FNiagaraDataBuffer::PushCPUBuffersToGPU(
    const TArray<FNiagaraDataBufferRef>& SourceBuffers,
    bool bReleaseRef,
    FRHICommandList& RHICmdList,
    ERHIFeatureLevel::Type FeatureLevel,
    const TCHAR* DebugSimName,
    bool bAllocate)
{
    // GPU 버퍼 할당
    if (bAllocate)
    {
        AllocateGPU(RHICmdList, NumInstances, FeatureLevel, DebugSimName);
    }

    // Float Buffer 전송
    if (Owner->GetNumFloatComponents() > 0)
    {
        void* GPUMemory = RHICmdList.LockBuffer(GPUBufferFloat.Buffer, 0, FloatData.Num(), RLM_WriteOnly);
        FMemory::Memcpy(GPUMemory, FloatData.GetData(), FloatData.Num());
        RHICmdList.UnlockBuffer(GPUBufferFloat.Buffer);
    }

    // Int32 Buffer 전송
    if (Owner->GetNumInt32Components() > 0)
    {
        void* GPUMemory = RHICmdList.LockBuffer(GPUBufferInt.Buffer, 0, Int32Data.Num(), RLM_WriteOnly);
        FMemory::Memcpy(GPUMemory, Int32Data.GetData(), Int32Data.Num());
        RHICmdList.UnlockBuffer(GPUBufferInt.Buffer);
    }

    // Half Buffer 전송
    if (Owner->GetNumHalfComponents() > 0)
    {
        void* GPUMemory = RHICmdList.LockBuffer(GPUBufferHalf.Buffer, 0, HalfData.Num(), RLM_WriteOnly);
        FMemory::Memcpy(GPUMemory, HalfData.GetData(), HalfData.Num());
        RHICmdList.UnlockBuffer(GPUBufferHalf.Buffer);
    }
}
```

---

### 예시 5: Persistent ID로 파티클 추적

```cpp
// ID를 사용하여 특정 파티클 찾기
void TrackParticleByID(FNiagaraDataBuffer& Buffer, int32 ParticleID)
{
    const TArray<int32>& IDTable = Buffer.GetIDTable();

    if (IDTable.IsValidIndex(ParticleID))
    {
        int32 BufferIndex = IDTable[ParticleID];

        if (BufferIndex != INDEX_NONE)
        {
            // 파티클이 살아있음
            float* PosX = Buffer.GetInstancePtrFloat(0, BufferIndex);
            float* PosY = Buffer.GetInstancePtrFloat(1, BufferIndex);
            float* PosZ = Buffer.GetInstancePtrFloat(2, BufferIndex);

            FVector Position(*PosX, *PosY, *PosZ);
            UE_LOG(LogNiagara, Log, TEXT("Particle %d at %s"), ParticleID, *Position.ToString());
        }
        else
        {
            UE_LOG(LogNiagara, Log, TEXT("Particle %d is dead"), ParticleID);
        }
    }
}

// Event Handler에서 ID 사용 예시
void SpawnParticleOnDeath(FNiagaraDataBuffer& SourceBuffer, int32 DeadParticleIndex)
{
    // 죽은 파티클의 ID 읽기
    int32* IDPtr = SourceBuffer.GetInstancePtrInt32(IDComponentIndex, DeadParticleIndex);
    int32 DeadParticleID = *IDPtr;

    // Event Payload에 ID 저장
    FNiagaraDataBuffer& EventBuffer = GetEventDataSet().BeginSimulate();
    EventBuffer.Allocate(1);

    int32* EventIDPtr = EventBuffer.GetInstancePtrInt32(0, 0);
    *EventIDPtr = DeadParticleID;

    GetEventDataSet().EndSimulate();

    // 다른 Emitter가 이 ID를 참조하여 같은 위치에 파티클 생성 가능
}
```

---

### 예시 6: Pool Priming (미리 할당)

```cpp
// Level 시작 시 Pool 미리 채우기
void AMyGameMode::BeginPlay()
{
    Super::BeginPlay();

    // 자주 사용하는 Effect를 미리 Pool에 생성
    if (FNiagaraWorldManager* WorldManager = FNiagaraWorldManager::Get(GetWorld()))
    {
        UNiagaraComponentPool* Pool = WorldManager->GetComponentPool();

        // PoolPrimeSize만큼 미리 생성 (UNiagaraSystem에서 설정)
        Pool->PrimePool(ExplosionEffect, GetWorld());
        Pool->PrimePool(MuzzleFlashEffect, GetWorld());
    }
}
```

**UNiagaraSystem 설정:**
```cpp
UNiagaraSystem* MyEffect;
MyEffect->PoolPrimeSize = 10;   // 미리 10개 생성
MyEffect->MaxPoolSize = 50;     // 최대 50개까지 Pool에 보관
```

---

## ⚠️ 일반적인 함정

### ❌ 하지 말아야 할 것

**1. BeginSimulate 없이 Destination 접근:**

```cpp
// 위험: Destination이 nullptr
void BadTick()
{
    FNiagaraDataBuffer& Dest = ParticleDataSet.GetDestinationDataChecked();  // ❌ Crash!
    // BeginSimulate()를 호출하지 않았음
}
```

**2. EndSimulate 없이 BeginSimulate 중첩 호출:**

```cpp
// 위험: Destination 누수
void BadTick()
{
    ParticleDataSet.BeginSimulate();
    // ... Simulation ...

    ParticleDataSet.BeginSimulate();  // ❌ Crash! (check 실패)
}
```

**3. Pooled Component 수동 파괴:**

```cpp
// 위험: Pool이 깨짐
UNiagaraComponent* NC = SpawnEffect();  // Pooled
// ...
NC->DestroyComponent();  // ❌ Pool에 남아있던 포인터가 Dangling!

// ✅ 올바른 방법: 그냥 Deactivate (자동으로 Pool에 반환)
NC->Deactivate();
```

**4. RegisterTable 직접 수정:**

```cpp
// 위험: RegisterTable은 읽기 전용
uint8** RegisterTable = Buffer.EditRegisterTable().GetData();
RegisterTable[0] = SomeOtherPointer;  // ❌ 버퍼 구조 깨짐!

// RegisterTable은 BuildRegisterTable()로만 생성해야 함
```

**5. GPU Buffer를 GameThread에서 접근:**

```cpp
// 위험: GPU Buffer는 RenderThread 전용
void GameThreadFunction()
{
    FRWBuffer& GPUBuffer = DataBuffer->GetGPUBufferFloat();  // ❌ Thread 위반!
}
```

---

### ✅ 올바른 방법

**1. BeginSimulate / EndSimulate 패턴:**

```cpp
// 좋은 예: 항상 쌍으로 호출
void GoodTick()
{
    FNiagaraDataBuffer& Dest = ParticleDataSet.BeginSimulate();

    // Simulation...
    Dest.Allocate(NumParticles);
    // ...

    ParticleDataSet.EndSimulate();
}
```

**2. Component Pooling 활용:**

```cpp
// 좋은 예: ENCPoolMethod::AutoRelease 사용
UNiagaraComponent* NC = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
    World, System, Location, Rotation, Scale,
    true,  // bAutoDestroy
    true,  // bAutoActivate
    ENCPoolMethod::AutoRelease,  // ✅ 자동 Pool 반환
    true
);

// Effect 완료 후 자동으로 Pool에 반환됨
```

**3. SoA 접근 최적화:**

```cpp
// 좋은 예: Component별로 연속 접근
void OptimizedUpdate(FNiagaraDataBuffer& Buffer)
{
    uint8** RegisterTable = Buffer.EditRegisterTable().GetData();

    float* PosX = (float*)RegisterTable[0];
    float* PosY = (float*)RegisterTable[1];
    float* PosZ = (float*)RegisterTable[2];

    float* VelX = (float*)RegisterTable[3];
    float* VelY = (float*)RegisterTable[4];
    float* VelZ = (float*)RegisterTable[5];

    const uint32 NumInstances = Buffer.GetNumInstances();

    // X, Y, Z 각각 연속 처리 (캐시 친화적)
    for (uint32 i = 0; i < NumInstances; ++i)
    {
        PosX[i] += VelX[i] * DeltaTime;
    }
    for (uint32 i = 0; i < NumInstances; ++i)
    {
        PosY[i] += VelY[i] * DeltaTime;
    }
    for (uint32 i = 0; i < NumInstances; ++i)
    {
        PosZ[i] += VelZ[i] * DeltaTime;
    }
}
```

**4. GPU/CPU Buffer 분리 관리:**

```cpp
// 좋은 예: RenderThread에서만 GPU 접근
ENQUEUE_RENDER_COMMAND(UpdateGPUBuffer)(
    [DataBuffer](FRHICommandListImmediate& RHICmdList)
    {
        // ✅ RenderThread에서 안전하게 접근
        FRWBuffer& GPUBuffer = DataBuffer->GetGPUBufferFloat();
        // ...
    }
);
```

---

## 🐛 디버깅

### DataSet 상태 확인

```cpp
// 명령어: DumpDataSet
void FNiagaraDataSet::Dump(int32 StartIndex, int32 NumInstances, const FString& Label, const FName& SortParameterKey) const
{
    UE_LOG(LogNiagara, Log, TEXT("=== DataSet: %s ==="), *Label);
    UE_LOG(LogNiagara, Log, TEXT("NumInstances: %d / %d (allocated)"), CurrentData->GetNumInstances(), CurrentData->GetNumInstancesAllocated());
    UE_LOG(LogNiagara, Log, TEXT("NumFloatComponents: %d, NumInt32Components: %d, NumHalfComponents: %d"),
        GetNumFloatComponents(), GetNumInt32Components(), GetNumHalfComponents());

    // 각 Variable 출력
    for (int32 InstIdx = StartIndex; InstIdx < FMath::Min(StartIndex + NumInstances, (int32)CurrentData->GetNumInstances()); ++InstIdx)
    {
        FNiagaraDataVariableIterator It(CurrentData, InstIdx);
        It.Get();

        for (const FNiagaraVariable& Var : It.GetVariables())
        {
            UE_LOG(LogNiagara, Log, TEXT("[%d] %s = %s"), InstIdx, *Var.GetName().ToString(), *Var.ToString());
        }
    }
}
```

### Component Pool 상태 확인

```cpp
// 명령어: FX.DumpNCPoolInfo
void UNiagaraComponentPool::Dump()
{
    UE_LOG(LogNiagara, Log, TEXT("=== Niagara Component Pool ==="));

    for (auto& Pair : WorldParticleSystemPools)
    {
        UNiagaraSystem* System = Pair.Key;
        FNCPool& Pool = Pair.Value;

        UE_LOG(LogNiagara, Log, TEXT("System: %s"), *GetNameSafe(System));
        UE_LOG(LogNiagara, Log, TEXT("  Free Elements: %d"), Pool.FreeElements.Num());

#if ENABLE_NC_POOL_DEBUGGING
        UE_LOG(LogNiagara, Log, TEXT("  In Use (Auto): %d"), InUseComponents_Auto.Num());
        UE_LOG(LogNiagara, Log, TEXT("  In Use (Manual): %d"), InUseComponents_Manual.Num());
        UE_LOG(LogNiagara, Log, TEXT("  Max Used: %d"), MaxUsed);
#endif
    }
}
```

### Memory Tracking

```cpp
#if NIAGARA_MEMORY_TRACKING
// FNiagaraDataBuffer::Allocate 내부
AllocationSizeBytes = FloatData.Num() + Int32Data.Num() + HalfData.Num();

// FNiagaraDataSet::GetSizeBytes
int64 FNiagaraDataSet::GetSizeBytes() const
{
    int64 TotalBytes = 0;
    for (const FNiagaraDataBuffer* Buffer : Data)
    {
        TotalBytes += Buffer->GetAllocationSizeBytes();
    }
    return TotalBytes;
}
#endif
```

**Console Commands:**
- `stat Niagara` - Niagara 메모리 통계
- `FX.DumpNCPoolInfo` - Component Pool 상태
- `obj list class=NiagaraComponent` - 모든 NiagaraComponent 나열

---

## 🔧 성능 최적화

### ✅ 해야 할 것

**1. Component Pooling 활성화:**

```cpp
// Project Settings → Niagara → Component Pool
FX.NiagaraComponentPool.Enable = 1              // Pooling 활성화
FX.NiagaraComponentPool.KillUnusedTime = 180    // 3분 후 정리
FX.NiagaraComponentPool.KeepComponentsRegistered = 1  // Register 비용 절약
```

**2. Pool Priming 사용:**

```cpp
// 자주 사용하는 Effect는 미리 Pool에 생성
UNiagaraSystem* FrequentEffect;
FrequentEffect->PoolPrimeSize = 20;
FrequentEffect->MaxPoolSize = 100;
```

**3. MaxInstanceCount 설정:**

```cpp
// Emitter에서 최대 파티클 개수 제한
UNiagaraEmitter* Emitter;
Emitter->MaxParticleCount = 10000;

// DataSet에도 반영
ParticleDataSet.SetMaxInstanceCount(10000);
```

**4. Half Precision 사용:**

```cpp
// Color 같은 낮은 정밀도 데이터는 Half 사용
// Float (4 bytes) → Half (2 bytes) = 50% 메모리 절약
FNiagaraTypeDefinition HalfType = FNiagaraTypeDefinition::GetHalfDef();
MyVariable.SetType(HalfType);
```

---

### ❌ 피해야 할 것

**1. Pooling 없이 대량 Spawn:**

```cpp
// ❌ 매 프레임 수백 개 생성/파괴
for (int i = 0; i < 100; ++i)
{
    UNiagaraComponent* NC = NewObject<UNiagaraComponent>();  // ❌ 매우 느림!
    NC->Activate();
}

// ✅ Pooling 사용
for (int i = 0; i < 100; ++i)
{
    UNiagaraFunctionLibrary::SpawnSystemAtLocation(..., ENCPoolMethod::AutoRelease);
}
```

**2. 불필요한 Persistent ID 사용:**

```cpp
// ❌ Event도 없고 ID 참조도 없는데 Persistent ID 활성화
UNiagaraEmitter* Emitter;
Emitter->bRequiresPersistentIDs = true;  // ❌ 메모리 낭비!

// IDToIndexTable 할당: sizeof(int32) * MaxParticles
// → 10,000 particles = 40 KB 추가 메모리
```

**3. 과도한 MaxPoolSize:**

```cpp
// ❌ 거의 사용하지 않는 Effect에 큰 Pool 설정
UNiagaraSystem* RareEffect;
RareEffect->MaxPoolSize = 1000;  // ❌ 메모리 낭비!
// 대부분의 Component가 Pool에 잠자고 있음
```

---

## 🔗 참조 자료

**소스 파일:**
- `NiagaraDataSet.h/cpp` - DataSet/DataBuffer 구현
- `NiagaraComponentPool.h/cpp` - Component Pooling
- `NiagaraSharedObject.h` - Ref Counting

**관련 문서:**
- [Tick_and_Update_System.md](Tick_and_Update_System.md) - Tick 중 Buffer 교체
- [VM_Execution.md](VM_Execution.md) - VectorVM의 SoA 레이아웃 활용

**Console Variables:**
- `FX.NiagaraComponentPool.Enable` - Component Pooling 활성화
- `FX.NiagaraComponentPool.KillUnusedTime` - Pool 정리 주기
- `FX.NiagaraComponentPool.KeepComponentsRegistered` - Register 유지 여부
- `NIAGARA_MEMORY_TRACKING` - 메모리 추적 활성화 (빌드 설정)

---

> 🔄 작성: 2025-11-22 — Niagara 메모리 관리 시스템의 SoA 레이아웃, Double Buffering, Component Pooling 상세 분석
