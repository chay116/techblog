---
title: "Niagara Collision System"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara Collision System

## 🧭 개요

Niagara Collision System은 파티클이 월드의 지오메트리와 상호작용할 수 있도록 하는 충돌 감지 및 응답 시스템입니다. **CPU와 GPU 모두에서 다양한 충돌 감지 방식을 제공**하며, 물리 머티리얼 속성, 비동기 트레이스, 리지드 메시 충돌 등 다양한 기능을 지원합니다.

**핵심 설계 철학:**
- **다중 감지 방식:** Scene Geometry, Depth Buffer, Distance Field, RayTracing 등 다양한 감지 방법 제공
- **플랫폼 최적화:** CPU는 비동기 트레이스, GPU는 전용 RayTracing/Distance Field 활용
- **물리 통합:** PhysicalMaterial 정보(Friction, Restitution) 실시간 반영
- **유연한 쿼리:** 동기/비동기 쿼리, 배치 처리, 프레임 지연 처리 등 지원

---

## 🏗️ 아키텍처

### 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Collision Query Layer                              │
│  (Data Interface APIs - Blueprint/Script에서 호출)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐   │
│  │ UNiagaraDataInterface-       │  │ UNiagaraDataInterface-       │   │
│  │ CollisionQuery               │  │ RigidMeshCollisionQuery      │   │
│  │                              │  │                              │   │
│  │ - Scene Geometry Traces      │  │ - PhysicsAsset Primitives    │   │
│  │ - Depth Buffer Sampling      │  │ - Actor Tag Filtering        │   │
│  │ - Distance Field Sampling    │  │ - Transform Caching          │   │
│  └──────────────┬───────────────┘  └──────────────┬───────────────┘   │
│                 │                                  │                    │
│                 └──────────────┬───────────────────┘                    │
│                                ↓                                        │
│                  [Collision Query Routing]                              │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       Trace Execution Layer                              │
│  (CPU/GPU 별 실제 충돌 감지 로직)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │               CPU Path                                      │       │
│  │  ┌─────────────────────────────────────────────────────┐   │       │
│  │  │ FNiagaraDICollisionQueryBatch                       │   │       │
│  │  │ - Double Buffering (Write/Read)                     │   │       │
│  │  │ - AsyncLineTraceByChannel                           │   │       │
│  │  │ - DispatchQueries() → CollectResults()              │   │       │
│  │  └─────────────────────────────────────────────────────┘   │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │               GPU Path                                      │       │
│  │  ┌─────────────────────────────────────────────────────┐   │       │
│  │  │ FNiagaraAsyncGpuTraceHelper                         │   │       │
│  │  │ - FNiagaraAsyncGpuTraceProvider (추상 Provider)    │   │       │
│  │  │   ├─ HWRT Provider (RayTracing)                     │   │       │
│  │  │   ├─ GSDF Provider (Global SDF)                     │   │       │
│  │  │   └─ FallBack Provider                              │   │       │
│  │  │ - Scratch Pad Buffer Management                     │   │       │
│  │  │ - Collision Group Hash Map (Self-collision filter) │   │       │
│  │  └─────────────────────────────────────────────────────┘   │       │
│  └─────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 계층별 상세 분석

### 1. **ENiagaraCollisionMode - 충돌 모드 열거형**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraCollision.h:13`

```cpp
UENUM()
enum class ENiagaraCollisionMode : uint8
{
    None = 0,
    SceneGeometry,   // 물리 시뮬레이션을 통한 지오메트리 충돌
    DepthBuffer,     // Depth Buffer 샘플링 (GPU 전용, 스크린 공간)
    DistanceField    // Global/Mesh Distance Field 활용 (GPU 전용)
};
```

**역할:** Niagara 시스템이 어떤 방식으로 충돌을 감지할지 결정

**특징:**
- **SceneGeometry:** CPU/GPU 모두 지원, 가장 정확하지만 비용이 높음
- **DepthBuffer:** GPU 전용, 스크린 공간 한정, 빠르지만 보이지 않는 면 감지 불가
- **DistanceField:** GPU 전용, 오프스크린 지오메트리 지원, 중간 수준의 비용

---

### 2. **FNiagaraCollisionTrace - CPU 트레이스 요청 구조체**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraCollision.h:21`

```cpp
struct FNiagaraCollisionTrace
{
    FTraceHandle CollisionTraceHandle;          // UWorld의 비동기 트레이스 핸들
    int32 HitIndex;                             // 결과 배열의 인덱스
    const FCollisionQueryParams CollisionQueryParams;
    const FVector StartPos;
    const FVector EndPos;
    const ECollisionChannel Channel;

    FNiagaraCollisionTrace(const FVector& InStartPos, const FVector& InEndPos,
                           ECollisionChannel InChannel,
                           const FCollisionQueryParams& InQueryParams);
};
```

**역할:** CPU에서 발생한 트레이스 요청을 담는 컨테이너

**핵심 특징:**
- **비동기 트레이스 지원:** FTraceHandle을 통해 프레임 지연 처리
- **ECollisionChannel 사용:** Unreal의 표준 충돌 채널 시스템 활용
- **Immutable 설계:** StartPos, EndPos, Channel은 const로 보호

---

### 3. **FNiagaraDICollsionQueryResult - 충돌 결과 구조체**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraCollision.h:39`

```cpp
struct FNiagaraDICollsionQueryResult
{
    FVector CollisionPos;            // 충돌 지점
    FVector CollisionNormal;         // 충돌 표면 노멀
    FVector CollisionVelocity;       // 충돌 표면의 속도 (동적 오브젝트)
    int32 PhysicalMaterialIdx;       // 물리 머티리얼 타입
    float Friction;                  // 마찰 계수
    float Restitution;               // 반발 계수 (0.0 = 흡수, 1.0 = 완전 반사)
    bool IsInsideMesh;               // StartPos가 메시 내부였는지 여부
};
```

**역할:** 충돌 감지 후 파티클이 사용할 물리적 정보를 반환

**활용 예시:**
```cpp
// 파티클 스크립트에서 활용
if (CollisionResult.IsInsideMesh)
{
    // 메시 내부에 갇힌 경우 → Kill 또는 강제 Ejection
    Particle.Position += CollisionResult.CollisionNormal * EjectionDistance;
}
else
{
    // 반사 처리
    FVector ReflectedVelocity = FMath::Reflect(Particle.Velocity, CollisionResult.CollisionNormal);
    Particle.Velocity = ReflectedVelocity * CollisionResult.Restitution;

    // 마찰 적용 (접선 방향 속도 감소)
    FVector TangentialVelocity = Particle.Velocity - (Particle.Velocity | CollisionResult.CollisionNormal) * CollisionResult.CollisionNormal;
    TangentialVelocity *= (1.0f - CollisionResult.Friction);
}
```

---

### 4. **FNiagaraDICollisionQueryBatch - CPU 배치 프로세서**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraCollision.h:50`

```cpp
class FNiagaraDICollisionQueryBatch
{
public:
    // Double Buffering for 비동기 처리
    int32 GetWriteBufferIdx() { return CurrBuffer; }
    int32 GetReadBufferIdx() { return CurrBuffer ^ 0x1; }  // XOR로 스왑

    // 트레이스 제출 및 결과 수집
    void DispatchQueries();   // Game Thread에서 호출 → AsyncLineTrace 발행
    void CollectResults();    // 다음 프레임 Game Thread에서 호출 → 결과 수집

    // 동기 쿼리 (즉시 실행)
    bool PerformQuery(FVector StartPos, FVector EndPos,
                      FNiagaraDICollsionQueryResult& Result,
                      ECollisionChannel TraceChannel, bool bTraceComplex = false);

    // 비동기 쿼리 (배치에 추가)
    int32 SubmitQuery(FVector StartPos, FVector EndPos,
                      ECollisionChannel TraceChannel, bool bTraceComplex = false);

    // 비동기 쿼리 결과 조회
    bool GetQueryResult(uint32 TraceID, FNiagaraDICollsionQueryResult& Result);

private:
    void FlipBuffers() { CurrBuffer = CurrBuffer ^ 0x1; }

    FRWLock CollisionTraceLock;                      // 멀티스레드 보호
    TArray<FNiagaraCollisionTrace> CollisionTraces[2];  // Double Buffer
    TArray<FNiagaraDICollsionQueryResult> CollisionResults;
    uint32 CurrBuffer;                               // 0 or 1
    UWorld* CollisionWorld;
};
```

**역할:** CPU 파티클의 충돌 쿼리를 배치로 묶어 비동기 처리

**더블 버퍼링 동작 원리:**
```
Frame N:
  [Write Buffer 0] ← 파티클 시뮬레이션에서 트레이스 요청 추가
  [Read Buffer 1]  → DispatchQueries() → AsyncLineTrace 발행

Frame N+1:
  [Write Buffer 1] ← 새로운 트레이스 요청 추가
  [Read Buffer 0]  → CollectResults() → 이전 프레임 결과 수집
                   → 파티클이 GetQueryResult()로 결과 사용
```

**소스 코드 검증:**

```cpp
// NiagaraCollision.cpp:26
void FNiagaraDICollisionQueryBatch::DispatchQueries()
{
    check(IsInGameThread());
    FlipBuffers();  // 버퍼 스왑

    const int32 ReadBufferIdx = GetReadBufferIdx();
    const int32 TraceCount = CollisionTraces[ReadBufferIdx].Num();

    for (int32 TraceIt = 0; TraceIt < TraceCount; ++TraceIt)
    {
        FNiagaraCollisionTrace& CollisionTrace = CollisionTraces[ReadBufferIdx][TraceIt];

        // AsyncLineTraceByChannel → 1프레임 지연 처리
        CollisionTrace.CollisionTraceHandle = CollisionWorld->AsyncLineTraceByChannel(
            EAsyncTraceType::Single,
            CollisionTrace.StartPos,
            CollisionTrace.EndPos,
            CollisionTrace.Channel,
            CollisionTrace.CollisionQueryParams,
            FCollisionResponseParams::DefaultResponseParam,
            nullptr,
            TraceIt);
    }
}
```

```cpp
// NiagaraCollision.cpp:61
void FNiagaraDICollisionQueryBatch::CollectResults()
{
    check(IsInGameThread());

    const int32 ReadBufferIdx = GetReadBufferIdx();
    const int32 TraceCount = CollisionTraces[ReadBufferIdx].Num();

    CollisionResults.Reset(TraceCount);

    for (int32 TraceIt = 0; TraceIt < TraceCount; ++TraceIt)
    {
        FNiagaraCollisionTrace& CollisionTrace = CollisionTraces[ReadBufferIdx][TraceIt];

        FTraceDatum TraceResult;
        const bool TraceReady = CollisionWorld->QueryTraceData(
            CollisionTrace.CollisionTraceHandle, TraceResult);

        if (TraceReady && TraceResult.OutHits.Num())
        {
            FHitResult* Hit = FHitResult::GetFirstBlockingHit(TraceResult.OutHits);
            if (Hit && Hit->bBlockingHit)
            {
                // 결과 저장
                CollisionTrace.HitIndex = CollisionResults.AddUninitialized();
                FNiagaraDICollsionQueryResult& Result = CollisionResults[CollisionTrace.HitIndex];

                Result.IsInsideMesh = Hit->bStartPenetrating;
                Result.CollisionPos = Hit->ImpactPoint;
                Result.CollisionNormal = Hit->ImpactNormal;

                // PhysicalMaterial 정보 추출
                if (Hit->PhysMaterial.IsValid())
                {
                    Result.PhysicalMaterialIdx = Hit->PhysMaterial->SurfaceType.GetValue();
                    Result.Friction = Hit->PhysMaterial->Friction;
                    Result.Restitution = Hit->PhysMaterial->Restitution;
                }
            }
        }
    }
}
```

**성능 최적화 특징:**
- **비동기 트레이스:** 메인 스레드를 블로킹하지 않음
- **배치 처리:** 모든 파티클의 트레이스를 한 번에 발행
- **RWLock 사용:** 멀티스레드 환경에서 안전한 트레이스 추가

---

### 5. **UNiagaraDataInterfaceCollisionQuery - CPU 충돌 DI**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceCollisionQuery.h:26`

```cpp
UCLASS(EditInlineNew, Category = "Collision",
       meta = (DisplayName = "Collision Query"), MinimalAPI)
class UNiagaraDataInterfaceCollisionQuery : public UNiagaraDataInterface
{
    GENERATED_UCLASS_BODY()

public:
    // Per-Instance Data 관리
    virtual bool InitPerInstanceData(void* PerInstanceData,
                                     FNiagaraSystemInstance* InSystemInstance) override;
    virtual void DestroyPerInstanceData(void* PerInstanceData,
                                       FNiagaraSystemInstance* InSystemInstance) override;

    // Tick 처리
    virtual bool PerInstanceTick(void* PerInstanceData,
                                FNiagaraSystemInstance* SystemInstance,
                                float DeltaSeconds) override;
    virtual bool PerInstanceTickPostSimulate(void* PerInstanceData,
                                            FNiagaraSystemInstance* SystemInstance,
                                            float DeltaSeconds) override;

    virtual int32 PerInstanceDataSize() const override
    {
        return sizeof(CQDIPerInstanceData);
    }

    // VM 함수 바인딩
    virtual void GetVMExternalFunction(const FVMExternalFunctionBindingInfo& BindingInfo,
                                      void* InstanceData,
                                      FVMExternalFunction& OutFunc) override;

    // VM 함수 구현
    void PerformQuerySyncCPU(FVectorVMExternalFunctionContext& Context);
    void PerformQueryAsyncCPU(FVectorVMExternalFunctionContext& Context);

    // 플랫폼 지원
    virtual bool CanExecuteOnTarget(ENiagaraSimTarget Target) const override
    {
        return true;  // CPU/GPU 모두 지원
    }

    // GPU 리소스 요구사항
    virtual bool RequiresGlobalDistanceField() const override { return true; }
    virtual bool RequiresDepthBuffer() const override { return true; }

    // Tick Ordering
    virtual bool HasPreSimulateTick() const override { return true; }
    virtual bool HasPostSimulateTick() const override { return true; }
    virtual bool PostSimulateCanOverlapFrames() const { return false; }
};
```

**Per-Instance Data 구조:**

```cpp
struct CQDIPerInstanceData
{
    FNiagaraSystemInstance* SystemInstance;
    FNiagaraDICollisionQueryBatch CollisionBatch;  // 배치 프로세서
};
```

**Tick 생명주기:**

```
PreSimulateTick (PerInstanceTick):
  └─ DispatchQueries()
       └─ 이전 프레임의 Write Buffer를 Read Buffer로 전환
       └─ AsyncLineTraceByChannel 발행

[Simulation Phase]
  └─ PerformQueryAsyncCPU() / PerformQuerySyncCPU()
       └─ 파티클이 트레이스 요청 추가 또는 결과 조회

PostSimulateTick (PerInstanceTickPostSimulate):
  └─ CollectResults()
       └─ AsyncLineTrace 결과 수집
       └─ CollisionResults 배열에 저장
```

**Blueprint에서 호출되는 함수들:**

| 함수 이름 | 설명 |
|----------|------|
| `QuerySceneDepth` | Depth Buffer에서 깊이 샘플링 (GPU 전용) |
| `QueryMeshDistanceField` | Mesh Distance Field 쿼리 (GPU 전용) |
| `QueryGlobalDistanceField` | Global Distance Field 쿼리 (GPU 전용) |
| `PerformCollisionQuerySync` | 동기 충돌 쿼리 (CPU/GPU) |
| `PerformCollisionQueryAsync` | 비동기 충돌 쿼리 (CPU 전용) |
| `GetAsyncQueryResult` | 비동기 쿼리 결과 조회 (CPU 전용) |

---

### 6. **UNiagaraDataInterfaceRigidMeshCollisionQuery - 리지드 메시 충돌 DI**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraDataInterfaceRigidMeshCollisionQuery.h:180`

```cpp
UCLASS(EditInlineNew, Category = "Collision",
       meta = (DisplayName = "Rigid Mesh Collision Query"))
class UNiagaraDataInterfaceRigidMeshCollisionQuery : public UNiagaraDataInterface
{
    GENERATED_UCLASS_BODY()

public:
    // Actor/Component 필터링 설정
    UPROPERTY(EditAnywhere, Category = "Search")
    TArray<FName> ActorTags;           // Actor 태그 매칭

    UPROPERTY(EditAnywhere, Category = "Source")
    TArray<FName> ComponentTags;       // Component 태그 매칭

    UPROPERTY(EditAnywhere, Category = "Source")
    TArray<TSoftObjectPtr<AActor>> SourceActors;  // 명시적 Actor 지정

    UPROPERTY(EditAnywhere, Category = "Source")
    bool OnlyUseMoveable = true;       // 이동 가능한 Actor만 대상

    UPROPERTY(EditAnywhere, Category = "Source")
    bool UseComplexCollisions = false; // Complex Collision 사용 여부

    UPROPERTY(EditAnywhere, Category = "Source")
    bool bFilterByObjectType = false;  // ObjectType 필터링

    // 최대 프리미티브 개수 제한
    UPROPERTY(EditAnywhere, Category = "General")
    int MaxNumPrimitives = 100;

    // GPU 전용
    virtual bool CanExecuteOnTarget(ENiagaraSimTarget Target) const override
    {
        return Target == ENiagaraSimTarget::GPUComputeSim;
    }

    // CPU 함수
    void FindActorsCPU(FVectorVMExternalFunctionContext& Context);
    void GetNumElementsCPU(FVectorVMExternalFunctionContext& Context);
    void IsWorldPositionInsideCombinedBoundsCPU(FVectorVMExternalFunctionContext& Context);
};
```

**핵심 기능:**

1. **Actor 검색 및 필터링**
```cpp
bool FindActors(UWorld* World, FNDIRigidMeshCollisionData& InstanceData,
                ECollisionChannel Channel,
                const FVector& OverlapLocation,
                const FVector& OverlapExtent,
                const FQuat& OverlapRotation) const;
```

2. **Transform Caching**
```cpp
struct FNDIRigidMeshCollisionArrays
{
    FNDIRigidMeshCollisionElementOffset ElementOffsets;  // Box/Sphere/Capsule 오프셋
    TArray<FVector4f> CurrentTransform;     // 현재 프레임 Transform (3x4 행렬)
    TArray<FVector4f> CurrentInverse;       // 역행렬
    TArray<FVector4f> PreviousTransform;    // 이전 프레임 (Motion Vector용)
    TArray<FVector4f> PreviousInverse;
    TArray<FVector4f> ElementExtent;        // Box/Sphere/Capsule 크기
    TArray<FVector4f> MeshScale;            // Mesh Scale
    TArray<uint32> PhysicsType;             // 0=Box, 1=Sphere, 2=Capsule
    TArray<int32> ComponentIdIndex;         // Component ID 매핑

    FVector3f CombinedBBoxWorldMin;         // 모든 프리미티브의 결합 AABB
    FVector3f CombinedBBoxWorldMax;
};
```

3. **GPU Buffer 업로드**
```cpp
struct FNDIRigidMeshCollisionBuffer : public FRenderResource
{
    FReadBuffer WorldTransformBuffer;       // 3*MaxPrimitives
    FReadBuffer InverseTransformBuffer;     // 3*MaxPrimitives
    FReadBuffer ElementExtentBuffer;        // MaxPrimitives
    FReadBuffer MeshScaleBuffer;            // MaxPrimitives
    FReadBuffer PhysicsTypeBuffer;          // MaxPrimitives
    FReadBuffer DFIndexBuffer;              // Distance Field Index
};
```

**업데이트 흐름:**

```
PerInstanceTickPostSimulate:
  ├─ UpdateSourceActors() → Actor 검색 및 필터링
  ├─ MergeActors() → ExplicitActors + FoundActors 병합
  ├─ TrimMissingActors() → 제거된 Actor 정리
  │
  └─ Update() → CPU Arrays 갱신
       ├─ Iterate over BodyInstances
       ├─ Extract Box/Sphere/Capsule Transforms
       ├─ Build Current/Previous Transform matrices
       ├─ Update CombinedBBox
       │
       └─ ProvidePerInstanceDataForRenderThread()
            └─ GPU Buffer 업로드 (Render Thread)
```

**Blueprint 함수 라이브러리:**

```cpp
UCLASS(MinimalAPI)
class UNiagaraDIRigidMeshCollisionFunctionLibrary : public UBlueprintFunctionLibrary
{
public:
    UFUNCTION(BlueprintCallable, Category = Niagara,
              meta = (DisplayName = "Niagara Set Source Actors"))
    static void SetSourceActors(UNiagaraComponent* NiagaraSystem,
                               FName OverrideName,
                               const TArray<AActor*>& SourceActors);
};
```

**사용 예시:**
```cpp
// Blueprint에서 동적으로 충돌 대상 Actor 설정
TArray<AActor*> EnemyActors = GetAllEnemiesInRange();
UNiagaraDIRigidMeshCollisionFunctionLibrary::SetSourceActors(
    NiagaraComponent,
    TEXT("RigidMeshCollisionDI"),
    EnemyActors
);
```

---

### 7. **UNiagaraDataInterfaceAsyncGpuTrace - GPU 비동기 트레이스 DI**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceAsyncGpuTrace.h:14`

```cpp
UCLASS(EditInlineNew, Category = "Collision",
       meta = (DisplayName = "Async Gpu Trace"), MinimalAPI)
class UNiagaraDataInterfaceAsyncGpuTrace : public UNiagaraDataInterface
{
    GENERATED_UCLASS_BODY()

public:
    // 프레임당 최대 트레이스 개수 (파티클당)
    UPROPERTY(EditAnywhere, Category = "Async GPU Trace")
    int32 MaxTracesPerParticle = 1;

    // 재시도 횟수 (Invalid Hit 발생 시)
    UPROPERTY(EditAnywhere, Category = "Async GPU Trace")
    int32 MaxRetraces = 0;

    // Trace Provider 선택
    UPROPERTY(EditAnywhere, Category = "Async GPU Trace")
    TEnumAsByte<ENDICollisionQuery_AsyncGpuTraceProvider::Type> TraceProvider =
        ENDICollisionQuery_AsyncGpuTraceProvider::Default;

    // GPU 전용
    virtual bool CanExecuteOnTarget(ENiagaraSimTarget Target) const override
    {
        return Target == ENiagaraSimTarget::GPUComputeSim;
    }

    virtual bool RequiresGlobalDistanceField() const override;
    virtual bool RequiresRayTracingScene() const override;
};
```

**TraceProvider 종류:**

```cpp
namespace ENDICollisionQuery_AsyncGpuTraceProvider
{
    enum Type : int
    {
        Default,            // 프로젝트 설정에서 지정한 기본값
        HWRT,               // Hardware RayTracing (DXR/VK_KHR_ray_tracing)
        GSDF,               // Global Signed Distance Field
        None                // 비활성화
    };
}
```

---

### 8. **FNiagaraAsyncGpuTraceHelper - GPU 트레이스 관리자**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraAsyncGpuTraceHelper.h:58`

```cpp
class FNiagaraAsyncGpuTraceHelper
{
public:
    FNiagaraAsyncGpuTraceHelper(EShaderPlatform InShaderPlatform,
                               ERHIFeatureLevel::Type FeatureLevel,
                               FNiagaraGpuComputeDispatchInterface* Dispatcher);

    // Frame Lifecycle
    void BeginFrame(FRHICommandList& RHICmdList,
                   FNiagaraGpuComputeDispatchInterface* Dispatcher);
    void PostRenderOpaque(FRHICommandList& RHICmdList,
                         FNiagaraGpuComputeDispatchInterface* Dispatcher,
                         TConstStridedView<FSceneView> Views,
                         TUniformBufferRef<FSceneUniformParameters> SceneUniformBufferRHI);
    void EndFrame(FRHICommandList& RHICmdList,
                 FNiagaraGpuComputeDispatchInterface* Dispatcher,
                 TUniformBufferRef<FSceneUniformParameters> SceneUniformBufferRHI);

    // Dispatch 누적 및 빌드
    void AddToDispatch(FNiagaraDataInterfaceProxy* DispatchKey,
                      uint32 MaxRays, int32 MaxRetraces,
                      ENDICollisionQuery_AsyncGpuTraceProvider::Type ProviderType);
    void BuildDispatch(FRHICommandList& RHICmdList,
                      FNiagaraDataInterfaceProxy* DispatchKey);

    // Dispatch 정보 조회
    const FNiagaraAsyncGpuTraceDispatchInfo& GetDispatch(
        FNiagaraDataInterfaceProxy* DispatchKey) const;
    const FNiagaraAsyncGpuTraceDispatchInfo& GetDummyDispatch() const;

    // Collision Group 관리 (HWRT 전용)
#if NIAGARA_ASYNC_GPU_TRACE_COLLISION_GROUPS
    void SetPrimitiveCollisionGroup(FPrimitiveSceneInfo& Primitive, uint32 CollisionGroup);
    void UpdateCollisionGroupMap(FRHICommandList& RHICmdList,
                                FScene* Scene,
                                ERHIFeatureLevel::Type FeatureLevel);

    int32 AcquireGPURayTracedCollisionGroup_GT();
    void ReleaseGPURayTracedCollisionGroup_GT(int32 CollisionGroup);
#endif

private:
    // Scratch Pad Buffers
    FNiagaraGpuScratchPadStructured<FNiagaraAsyncGpuTrace> TraceRequests;
    FNiagaraGpuScratchPadStructured<FNiagaraAsyncGpuTraceResult> TraceResults;
    FNiagaraGpuScratchPad TraceCounts;

    // DI별 Dispatch 정보
    TMap<FNiagaraDataInterfaceProxy*, FNiagaraAsyncGpuTraceDispatchInfo> Dispatches;
    TMap<FNiagaraDataInterfaceProxy*, FNiagaraAsyncGpuTraceDispatchInfo> PreviousFrameDispatches;

    // Provider 관리
    TArray<TUniquePtr<FNiagaraAsyncGpuTraceProvider>> TraceProviders;

    // Collision Group Hash Map (Self-collision 방지)
#if NIAGARA_ASYNC_GPU_TRACE_COLLISION_GROUPS
    TMap<FPrimitiveComponentId, uint32> CollisionGroupMap;  // CPU
    FNiagaraAsyncGpuTraceProvider::FCollisionGroupHashMap CollisionGroupHashMapBuffer;  // GPU
#endif
};
```

**Scratch Pad 구조:**

```cpp
struct FNiagaraAsyncGpuTraceDispatchInfo
{
    FNiagaraGpuScratchPadStructured<FNiagaraAsyncGpuTrace>::FAllocation TraceRequests;
    FNiagaraGpuScratchPadStructured<FNiagaraAsyncGpuTraceResult>::FAllocation TraceResults;
    FNiagaraGpuScratchPadStructured<FNiagaraAsyncGpuTraceResult>::FAllocation LastFrameTraceResults;  // 1프레임 지연
    FNiagaraGpuScratchPad::FAllocation TraceCounts;
    uint32 MaxTraces;
    uint32 MaxRetraces;
    ENDICollisionQuery_AsyncGpuTraceProvider::Type ProviderType;
};
```

**Frame Timeline:**

```
BeginFrame:
  └─ Reset Scratch Pad allocations
  └─ LastFrameDispatches = CurrentFrameDispatches

[Simulation Phase]
  └─ AddToDispatch() → 각 DI에서 MaxRays 누적

BuildDispatch:
  └─ Allocate TraceRequests buffer (MaxTraces * sizeof(FNiagaraAsyncGpuTrace))
  └─ Allocate TraceResults buffer (MaxTraces * sizeof(FNiagaraAsyncGpuTraceResult))
  └─ Allocate TraceCounts buffer (4 * uint32)
  └─ Store LastFrameTraceResults allocation

[GPU Simulation Shaders]
  └─ Write trace requests to TraceRequests buffer
  └─ Increment TraceCounts via Interlocked Add

PostRenderOpaque:
  └─ Execute RayTracing Shaders
       ├─ HWRT Provider: DispatchRays() with RayGen/ClosestHit/Miss shaders
       ├─ GSDF Provider: Compute shader with Global SDF sampling
       └─ Write results to TraceResults buffer

EndFrame:
  └─ (No action - results available next frame via LastFrameTraceResults)
```

---

### 9. **FNiagaraAsyncGpuTraceProvider - 추상 Provider 클래스**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraShader/Public/NiagaraAsyncGpuTraceProvider.h:34`

```cpp
class FNiagaraAsyncGpuTraceProvider
{
public:
    using EProviderType = ENDICollisionQuery_AsyncGpuTraceProvider::Type;

    FNiagaraAsyncGpuTraceProvider(EShaderPlatform InShaderPlatform,
                                 FNiagaraGpuComputeDispatchInterface* Dispatcher);
    virtual ~FNiagaraAsyncGpuTraceProvider() = default;

    // Provider 정보
    virtual bool IsAvailable() const = 0;
    virtual EProviderType GetType() const = 0;

    // 트레이스 실행
    virtual void IssueTraces(FRHICommandList& RHICmdList,
                            const FDispatchRequest& Request,
                            TUniformBufferRef<FSceneUniformParameters> SceneUniformBufferRHI,
                            FCollisionGroupHashMap* CollisionGroupHash);

    virtual void PostRenderOpaque(FRHICommandList& RHICmdList,
                                 TConstStridedView<FSceneView> Views,
                                 TUniformBufferRef<FSceneUniformParameters> SceneUniformBufferRHI,
                                 FCollisionGroupHashMap* CollisionGroupHash);

    // Static Helpers
    static EProviderType ResolveSupportedType(EProviderType InType,
                                             const FProviderPriorityArray& Priorities);
    static bool RequiresGlobalDistanceField(EProviderType InType,
                                           const FProviderPriorityArray& Priorities);
    static bool RequiresRayTracingScene(EProviderType InType,
                                       const FProviderPriorityArray& Priorities);

    // Collision Group Hash Map 빌드
    static void BuildCollisionGroupHashMap(FRHICommandList& RHICmdList,
                                          ERHIFeatureLevel::Type FeatureLevel,
                                          FSceneInterface* Scene,
                                          const TMap<FPrimitiveComponentId, uint32>& CollisionGroupMap,
                                          FCollisionGroupHashMap& Result);

protected:
    const EShaderPlatform ShaderPlatform;
    FNiagaraGpuComputeDispatchInterface* Dispatcher;
};
```

**Dispatch Request 구조:**

```cpp
struct FDispatchRequest
{
    FRWBufferStructured* TracesBuffer = nullptr;      // Input: 트레이스 요청
    FRWBufferStructured* ResultsBuffer = nullptr;     // Output: 트레이스 결과
    FRWBuffer* TraceCountsBuffer = nullptr;           // Dispatch Args
    uint32 TracesOffset = 0;
    uint32 ResultsOffset = 0;
    uint32 TraceCountsOffset = 0;
    uint32 MaxTraceCount = 0;
    uint32 MaxRetraceCount = 0;
};
```

**Collision Group Hash Map:**

```cpp
struct FCollisionGroupHashMap
{
    FRWBufferStructured PrimIdHashTable;        // GPUSceneInstanceIndex → Hash Index
    FRWBuffer HashToCollisionGroups;            // Hash Index → Collision Group
    uint32 HashTableSize = 0;
};
```

**구체적인 Provider 구현들:**

1. **FNiagaraAsyncGpuTraceProviderHwrt (HWRT)**
   - DXR/VK_KHR_ray_tracing 활용
   - RayGen/ClosestHit/Miss 셰이더 사용
   - 가장 정확하지만 RayTracing 지원 필요

2. **FNiagaraAsyncGpuTraceProviderGsdf (GSDF)**
   - Global Signed Distance Field 활용
   - Compute Shader로 SDF 샘플링
   - 오프스크린 지오메트리 지원

3. **FallBack Provider**
   - Depth Buffer + Scene Color 활용
   - 스크린 공간 한정
   - 가장 빠르지만 정확도 낮음

---

## 💡 실전 예시

### 예시 1: CPU 파티클의 동기 충돌 쿼리

```hlsl
// Niagara Script (HLSL)
void SpawnParticle(out FParticleData Particle,
                  inout FVectorVMContext Context,
                  NiagaraDataInterfaceCollisionQuery CollisionDI)
{
    float3 StartPos = Particle.Position;
    float3 EndPos = StartPos + Particle.Velocity * DeltaTime;

    // 동기 충돌 쿼리
    bool bHit;
    float3 HitPos;
    float3 HitNormal;
    float Friction;
    float Restitution;
    int PhysMaterialIdx;
    bool bIsInsideMesh;

    CollisionDI.PerformCollisionQuerySync(
        StartPos, EndPos,
        ECC_WorldStatic,  // Collision Channel
        false,            // bTraceComplex
        bHit, HitPos, HitNormal, Friction, Restitution, PhysMaterialIdx, bIsInsideMesh
    );

    if (bHit)
    {
        // 충돌 응답
        if (bIsInsideMesh)
        {
            // 메시 내부 → Kill
            Particle.bKilled = true;
        }
        else
        {
            // 반사
            float3 ReflectedVel = reflect(Particle.Velocity, HitNormal);
            Particle.Velocity = ReflectedVel * Restitution;
            Particle.Position = HitPos + HitNormal * 0.01;  // Offset to prevent re-collision

            // 마찰 적용
            float3 Tangent = Particle.Velocity - dot(Particle.Velocity, HitNormal) * HitNormal;
            Particle.Velocity -= Tangent * Friction;
        }
    }
    else
    {
        Particle.Position = EndPos;
    }
}
```

**내부 동작:**
```
1. PerformCollisionQuerySync() 호출
   └─ FNiagaraDICollisionQueryBatch::PerformQuery()
       └─ UWorld::LineTraceSingleByChannel() (동기)
           └─ Physics Scene Query
               └─ FHitResult 반환

2. 즉시 결과 사용 가능 (같은 프레임)
```

---

### 예시 2: CPU 파티클의 비동기 충돌 쿼리

```hlsl
// Frame N - 트레이스 요청
void UpdateParticle(inout FParticleData Particle,
                   inout FVectorVMContext Context,
                   NiagaraDataInterfaceCollisionQuery CollisionDI)
{
    float3 StartPos = Particle.Position;
    float3 EndPos = StartPos + Particle.Velocity * DeltaTime;

    // 비동기 트레이스 제출
    int TraceID = CollisionDI.PerformCollisionQueryAsync(
        StartPos, EndPos,
        ECC_WorldDynamic,
        false
    );

    Particle.TraceID = TraceID;  // 다음 프레임에서 사용
}

// Frame N+1 - 결과 조회
void ApplyCollisionResult(inout FParticleData Particle,
                         inout FVectorVMContext Context,
                         NiagaraDataInterfaceCollisionQuery CollisionDI)
{
    if (Particle.TraceID != -1)
    {
        bool bValidResult;
        float3 HitPos, HitNormal;
        float Friction, Restitution;
        int PhysMaterialIdx;
        bool bIsInsideMesh;

        CollisionDI.GetAsyncQueryResult(
            Particle.TraceID,
            bValidResult, HitPos, HitNormal, Friction, Restitution, PhysMaterialIdx, bIsInsideMesh
        );

        if (bValidResult && !bIsInsideMesh)
        {
            // 반사 처리
            float3 ReflectedVel = reflect(Particle.Velocity, HitNormal);
            Particle.Velocity = ReflectedVel * Restitution;
            Particle.Position = HitPos;
        }

        Particle.TraceID = -1;  // 초기화
    }
}
```

**내부 동작:**
```
Frame N:
  PerformCollisionQueryAsync()
    └─ FNiagaraDICollisionQueryBatch::SubmitQuery()
        └─ CollisionTraces[WriteBuffer].Add(Request)  // 배치에 추가
        └─ return TraceID

  PreSimulateTick:
    └─ DispatchQueries()
        └─ FlipBuffers()
        └─ AsyncLineTraceByChannel(CollisionTraces[ReadBuffer])

Frame N+1:
  PostSimulateTick:
    └─ CollectResults()
        └─ QueryTraceData(TraceHandle)
        └─ Store results in CollisionResults[]

  GetAsyncQueryResult()
    └─ Lookup CollisionResults[TraceID]
    └─ return result
```

---

### 예시 3: GPU 파티클의 Hardware RayTracing

```hlsl
// Niagara Simulation Shader (Compute)
[numthreads(64, 1, 1)]
void SimulateParticles(uint ParticleID : SV_DispatchThreadID)
{
    FParticleData Particle = ParticleBuffer[ParticleID];

    float3 StartPos = Particle.Position;
    float3 EndPos = StartPos + Particle.Velocity * DeltaTime;
    float3 Direction = normalize(EndPos - StartPos);
    float Distance = length(EndPos - StartPos);

    // Trace Request 생성
    FNiagaraAsyncGpuTrace TraceRequest;
    TraceRequest.Origin = StartPos;
    TraceRequest.Direction = Direction;
    TraceRequest.TFar = Distance;
    TraceRequest.CollisionGroup = Particle.CollisionGroup;  // Self-collision 방지용

    // Trace Request Buffer에 쓰기
    uint TraceIndex;
    InterlockedAdd(TraceCountsBuffer[0], 1, TraceIndex);

    if (TraceIndex < MaxTraceCount)
    {
        TraceRequestsBuffer[TraceIndex] = TraceRequest;
        Particle.TraceIndex = TraceIndex;
    }

    // 이전 프레임 결과 사용
    if (Particle.TraceIndex != -1)
    {
        FNiagaraAsyncGpuTraceResult Result = LastFrameTraceResultsBuffer[Particle.TraceIndex];

        if (Result.HitT >= 0.0)  // 충돌 발생
        {
            float3 HitPos = Result.WorldPosition;
            float3 HitNormal = normalize(Result.WorldNormal);

            // 반사
            Particle.Velocity = reflect(Particle.Velocity, HitNormal) * Restitution;
            Particle.Position = HitPos + HitNormal * 0.01;
        }
    }

    ParticleBuffer[ParticleID] = Particle;
}
```

**RayTracing Shader (HWRT Provider):**

```hlsl
// RayGen Shader
[shader("raygeneration")]
void RayGenMain()
{
    uint TraceIndex = DispatchRaysIndex().x;

    if (TraceIndex < TraceCount)
    {
        FNiagaraAsyncGpuTrace TraceRequest = TraceRequestsBuffer[TraceIndex];

        RayDesc Ray;
        Ray.Origin = TraceRequest.Origin;
        Ray.Direction = TraceRequest.Direction;
        Ray.TMin = 0.001;
        Ray.TMax = TraceRequest.TFar;

        FNiagaraAsyncGpuTraceResult Result;
        Result.HitT = -1.0;  // No hit

        TraceRay(
            SceneRayTracingScene,
            RAY_FLAG_CULL_BACK_FACING_TRIANGLES,
            0xFF,  // InstanceMask
            0,     // RayContributionToHitGroupIndex
            0,     // MultiplierForGeometryContributionToHitGroupIndex
            0,     // MissShaderIndex
            Ray,
            Result
        );

        TraceResultsBuffer[TraceIndex] = Result;
    }
}

// ClosestHit Shader
[shader("closesthit")]
void ClosestHitMain(inout FNiagaraAsyncGpuTraceResult Result,
                   in BuiltInTriangleIntersectionAttributes Attribs)
{
    // Collision Group 체크 (Self-collision 방지)
    uint PrimitiveIndex = InstanceIndex();
    uint CollisionGroup = GetCollisionGroupFromHashMap(PrimitiveIndex);

    uint RequestedCollisionGroup = TraceRequestsBuffer[DispatchRaysIndex().x].CollisionGroup;

    if (CollisionGroup != 0 && CollisionGroup == RequestedCollisionGroup)
    {
        // 같은 그룹 → 무시 (Retrace 처리됨)
        IgnoreHit();
        return;
    }

    // Hit 정보 저장
    Result.HitT = RayTCurrent();
    Result.WorldPosition = WorldRayOrigin() + WorldRayDirection() * RayTCurrent();
    Result.WorldNormal = GetWorldSpaceNormal(PrimitiveIndex, PrimitiveInstanceIndex(), Attribs);
}

// Miss Shader
[shader("miss")]
void MissMain(inout FNiagaraAsyncGpuTraceResult Result)
{
    Result.HitT = -1.0;  // No hit
}
```

**내부 동작:**
```
Frame N:
  [Simulation Shader]
    └─ Write TraceRequests
    └─ InterlockedAdd(TraceCounts)

PostRenderOpaque:
  [RayTracing Dispatch]
    └─ DispatchRays(TraceCounts[0])
        ├─ RayGenMain → TraceRay()
        ├─ ClosestHitMain → Store HitT, WorldPosition, WorldNormal
        └─ MissMain → HitT = -1.0
    └─ Write TraceResults

Frame N+1:
  [Simulation Shader]
    └─ Read LastFrameTraceResults
    └─ Apply collision response
```

---

### 예시 4: Rigid Mesh Collision Query (GPU)

```cpp
// Blueprint - Actor 설정
void AMyGameMode::SetupNiagaraCollision()
{
    TArray<AActor*> EnemyActors;
    UGameplayStatics::GetAllActorsOfClass(GetWorld(), AEnemy::StaticClass(), EnemyActors);

    UNiagaraDIRigidMeshCollisionFunctionLibrary::SetSourceActors(
        PlayerVFXComponent,
        TEXT("EnemyCollisionDI"),
        EnemyActors
    );
}
```

**Niagara Script (HLSL):**

```hlsl
// GPU Particle Update
[numthreads(64, 1, 1)]
void UpdateParticles(uint ParticleID : SV_DispatchThreadID)
{
    FParticleData Particle = ParticleBuffer[ParticleID];

    // Combined AABB 체크 (Early-out)
    bool bInsideCombinedBounds = IsWorldPositionInsideCombinedBounds(
        RigidMeshCollisionDI, Particle.Position
    );

    if (!bInsideCombinedBounds)
    {
        // 충돌 가능 영역 밖 → Skip
        return;
    }

    // Primitive 개수 조회
    int NumElements = GetNumElements(RigidMeshCollisionDI);

    // 각 Primitive에 대해 충돌 체크
    for (int i = 0; i < NumElements; ++i)
    {
        // Primitive 타입 및 Transform 조회
        uint PhysicsType = PhysicsTypeBuffer[i];  // 0=Box, 1=Sphere, 2=Capsule
        float4x3 WorldTransform = UnpackTransform(WorldTransformBuffer, i);
        float4x3 InverseTransform = UnpackTransform(InverseTransformBuffer, i);
        float3 Extent = ElementExtentBuffer[i].xyz;

        // World Space → Local Space
        float3 LocalPos = mul(InverseTransform, float4(Particle.Position, 1.0)).xyz;
        float3 LocalVel = mul(InverseTransform, float4(Particle.Velocity, 0.0)).xyz;

        bool bCollided = false;
        float3 LocalNormal = 0.0;

        if (PhysicsType == 0)  // Box
        {
            bCollided = IsInsideBox(LocalPos, Extent, LocalNormal);
        }
        else if (PhysicsType == 1)  // Sphere
        {
            bCollided = IsInsideSphere(LocalPos, Extent.x, LocalNormal);
        }
        else if (PhysicsType == 2)  // Capsule
        {
            bCollided = IsInsideCapsule(LocalPos, Extent.xy, LocalNormal);
        }

        if (bCollided)
        {
            // Local Normal → World Normal
            float3 WorldNormal = normalize(mul(WorldTransform, float4(LocalNormal, 0.0)).xyz);

            // 반사
            Particle.Velocity = reflect(Particle.Velocity, WorldNormal) * Restitution;

            // Penetration Depth 계산 및 보정
            float PenetrationDepth = CalculatePenetrationDepth(LocalPos, PhysicsType, Extent);
            Particle.Position += WorldNormal * PenetrationDepth;

            break;  // 첫 충돌만 처리
        }
    }

    ParticleBuffer[ParticleID] = Particle;
}
```

**내부 Transform Caching:**

```cpp
// FNDIRigidMeshCollisionData::Update()
void FNDIRigidMeshCollisionData::Update(UNiagaraDataInterfaceRigidMeshCollisionQuery* Interface)
{
    AssetArrays->Reset();

    uint32 BoxOffset = 0;
    uint32 SphereOffset = 0;
    uint32 CapsuleOffset = 0;
    uint32 ElementIndex = 0;

    FBox CombinedBBox(ForceInit);

    for (AActor* Actor : MergedActors)
    {
        UPrimitiveComponent* PrimComp = Actor->FindComponentByClass<UPrimitiveComponent>();
        if (!PrimComp || !PrimComp->GetBodySetup()) continue;

        FTransform ComponentTransform = PrimComp->GetComponentTransform();
        FTransform PreviousTransform = PrimComp->GetPreviousComponentTransform();

        for (const FKBoxElem& BoxElem : PrimComp->GetBodySetup()->AggGeom.BoxElems)
        {
            FTransform LocalTransform = BoxElem.GetTransform();
            FTransform WorldTransform = LocalTransform * ComponentTransform;
            FTransform PrevWorldTransform = LocalTransform * PreviousTransform;

            // 3x4 행렬로 저장 (Rotation + Translation)
            StoreTransform(AssetArrays->CurrentTransform, ElementIndex, WorldTransform);
            StoreTransform(AssetArrays->CurrentInverse, ElementIndex, WorldTransform.Inverse());
            StoreTransform(AssetArrays->PreviousTransform, ElementIndex, PrevWorldTransform);
            StoreTransform(AssetArrays->PreviousInverse, ElementIndex, PrevWorldTransform.Inverse());

            AssetArrays->ElementExtent[ElementIndex] = FVector4f(BoxElem.X, BoxElem.Y, BoxElem.Z, 0);
            AssetArrays->PhysicsType[ElementIndex] = 0;  // Box

            CombinedBBox += WorldTransform.TransformPosition(FVector(-BoxElem.X, -BoxElem.Y, -BoxElem.Z));
            CombinedBBox += WorldTransform.TransformPosition(FVector(BoxElem.X, BoxElem.Y, BoxElem.Z));

            ++ElementIndex;
            ++BoxOffset;
        }

        // Sphere, Capsule도 동일하게 처리...
    }

    AssetArrays->ElementOffsets = FNDIRigidMeshCollisionElementOffset(0, BoxOffset, SphereOffset, ElementIndex);
    AssetArrays->CombinedBBoxWorldMin = FVector3f(CombinedBBox.Min);
    AssetArrays->CombinedBBoxWorldMax = FVector3f(CombinedBBox.Max);

    // Render Thread로 전송
    ENQUEUE_RENDER_COMMAND(UpdateRigidMeshCollisionBuffer)(
        [AssetBuffer = AssetBuffer, AssetArrays = AssetArrays.Get()](FRHICommandListImmediate& RHICmdList)
        {
            // GPU Buffer 업데이트
            AssetBuffer->WorldTransformBuffer.Upload(AssetArrays->CurrentTransform);
            AssetBuffer->InverseTransformBuffer.Upload(AssetArrays->CurrentInverse);
            AssetBuffer->ElementExtentBuffer.Upload(AssetArrays->ElementExtent);
            AssetBuffer->PhysicsTypeBuffer.Upload(AssetArrays->PhysicsType);
        }
    );
}
```

---

### 예시 5: Global Distance Field를 활용한 GPU 충돌

```hlsl
// Niagara Script (HLSL) - GSDF Provider
[numthreads(64, 1, 1)]
void TraceWithGSDF(uint TraceID : SV_DispatchThreadID)
{
    if (TraceID >= TraceCount) return;

    FNiagaraAsyncGpuTrace TraceRequest = TraceRequestsBuffer[TraceID];

    float3 Origin = TraceRequest.Origin;
    float3 Direction = TraceRequest.Direction;
    float TMax = TraceRequest.TFar;

    FNiagaraAsyncGpuTraceResult Result;
    Result.HitT = -1.0;

    // Sphere Tracing with Global SDF
    float T = 0.0;
    const int MaxSteps = 64;
    const float Threshold = 0.01;

    for (int Step = 0; Step < MaxSteps; ++Step)
    {
        float3 SamplePos = Origin + Direction * T;

        // Global Distance Field 샘플링
        float SignedDistance = SampleGlobalDistanceField(SamplePos);

        if (abs(SignedDistance) < Threshold)
        {
            // Hit!
            Result.HitT = T;
            Result.WorldPosition = SamplePos;

            // Normal 계산 (Gradient)
            float3 Normal;
            Normal.x = SampleGlobalDistanceField(SamplePos + float3(0.01, 0, 0))
                     - SampleGlobalDistanceField(SamplePos - float3(0.01, 0, 0));
            Normal.y = SampleGlobalDistanceField(SamplePos + float3(0, 0.01, 0))
                     - SampleGlobalDistanceField(SamplePos - float3(0, 0.01, 0));
            Normal.z = SampleGlobalDistanceField(SamplePos + float3(0, 0, 0.01))
                     - SampleGlobalDistanceField(SamplePos - float3(0, 0, 0.01));
            Result.WorldNormal = normalize(Normal);

            break;
        }

        T += abs(SignedDistance);

        if (T >= TMax)
        {
            // No hit
            break;
        }
    }

    TraceResultsBuffer[TraceID] = Result;
}
```

**GSDF 샘플링 함수:**

```hlsl
// Global Distance Field Sampling (from Engine)
float SampleGlobalDistanceField(float3 WorldPosition)
{
    // World Position → Global SDF Volume UV
    float3 VolumeUV = (WorldPosition - GlobalDistanceFieldOrigin)
                     / GlobalDistanceFieldExtent;

    if (any(VolumeUV < 0.0) || any(VolumeUV > 1.0))
    {
        // Out of bounds → 무한대 거리
        return 1e6;
    }

    // 3D Texture 샘플링
    float SignedDistance = GlobalDistanceFieldTexture.SampleLevel(
        GlobalDistanceFieldSampler,
        VolumeUV,
        0
    ).r;

    return SignedDistance;
}
```

---

### 예시 6: Collision Group을 활용한 Self-Collision 방지 (HWRT)

```cpp
// Blueprint - Collision Group 할당
void AMyProjectile::BeginPlay()
{
    Super::BeginPlay();

    // GPU RayTraced Collision Group 할당
    int32 CollisionGroup = NiagaraAsyncGpuTraceHelper->AcquireGPURayTracedCollisionGroup_GT();

    // Primitive에 그룹 할당
    GetMeshComponent()->SetRayTracingCollisionGroup(CollisionGroup);

    // Niagara Component에 그룹 전달
    NiagaraComponent->SetVariableInt(TEXT("User.CollisionGroup"), CollisionGroup);
}

void AMyProjectile::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    // Collision Group 반환
    int32 CollisionGroup = NiagaraComponent->GetVariableInt(TEXT("User.CollisionGroup"));
    NiagaraAsyncGpuTraceHelper->ReleaseGPURayTracedCollisionGroup_GT(CollisionGroup);

    Super::EndPlay(EndPlayReason);
}
```

**RayTracing Shader (ClosestHit):**

```hlsl
[shader("closesthit")]
void ClosestHitMain(inout FNiagaraAsyncGpuTraceResult Result,
                   in BuiltInTriangleIntersectionAttributes Attribs)
{
    uint PrimitiveIndex = InstanceIndex();

    // Collision Group Hash Map 조회
    uint HashIndex = PrimIdHashTable[PrimitiveIndex % HashTableSize];
    uint HitCollisionGroup = HashToCollisionGroups[HashIndex];

    uint RequestedCollisionGroup = TraceRequestsBuffer[DispatchRaysIndex().x].CollisionGroup;

    if (HitCollisionGroup != 0 && HitCollisionGroup == RequestedCollisionGroup)
    {
        // Self-collision → 무시
        // MaxRetraces > 0이면 자동으로 Retrace됨
        IgnoreHit();
        return;
    }

    // 정상적인 충돌 처리
    Result.HitT = RayTCurrent();
    Result.WorldPosition = WorldRayOrigin() + WorldRayDirection() * RayTCurrent();
    Result.WorldNormal = GetWorldSpaceNormal(PrimitiveIndex, PrimitiveInstanceIndex(), Attribs);
}
```

**Collision Group Hash Map 빌드:**

```cpp
// FNiagaraAsyncGpuTraceHelper::UpdateCollisionGroupMap()
void FNiagaraAsyncGpuTraceHelper::UpdateCollisionGroupMap(FRHICommandList& RHICmdList,
                                                          FScene* Scene,
                                                          ERHIFeatureLevel::Type FeatureLevel)
{
    if (!bCollisionGroupMapDirty) return;

    // Hash Map 생성
    FNiagaraAsyncGpuTraceProvider::BuildCollisionGroupHashMap(
        RHICmdList,
        FeatureLevel,
        Scene,
        CollisionGroupMap,
        CollisionGroupHashMapBuffer
    );

    bCollisionGroupMapDirty = false;
}

// Static Helper
void FNiagaraAsyncGpuTraceProvider::BuildCollisionGroupHashMap(...)
{
    // Hash Table Size 결정 (충돌 최소화를 위해 2^N 크기)
    uint32 HashTableSize = FMath::RoundUpToPowerOfTwo(CollisionGroupMap.Num() * 2);

    Result.HashTableSize = HashTableSize;
    Result.PrimIdHashTable.Initialize(sizeof(uint32), HashTableSize, EPixelFormat::PF_R32_UINT);
    Result.HashToCollisionGroups.Initialize(sizeof(uint32), HashTableSize, EPixelFormat::PF_R32_UINT);

    // CPU에서 Hash Table 빌드
    TArray<uint32> HashTable;
    HashTable.SetNumZeroed(HashTableSize);

    TArray<uint32> CollisionGroupsArray;
    CollisionGroupsArray.SetNumZeroed(HashTableSize);

    for (const auto& Pair : CollisionGroupMap)
    {
        FPrimitiveComponentId PrimId = Pair.Key;
        uint32 CollisionGroup = Pair.Value;

        // GPUSceneInstanceIndex 조회
        uint32 GPUSceneInstanceIndex = Scene->GetGPUSceneInstanceIndex(PrimId);

        // Hash 계산
        uint32 Hash = GPUSceneInstanceIndex % HashTableSize;

        // Linear Probing으로 충돌 해결
        while (HashTable[Hash] != 0)
        {
            Hash = (Hash + 1) % HashTableSize;
        }

        HashTable[Hash] = GPUSceneInstanceIndex;
        CollisionGroupsArray[Hash] = CollisionGroup;
    }

    // GPU Buffer 업로드
    Result.PrimIdHashTable.Upload(RHICmdList, HashTable);
    Result.HashToCollisionGroups.Upload(RHICmdList, CollisionGroupsArray);
}
```

---

## 🔧 디버깅 및 트러블슈팅

### 일반적인 문제 해결

| 문제 | 원인 | 해결 방법 |
|------|------|----------|
| **CPU 충돌이 감지되지 않음** | `fx.Niagara.Collision.CPUEnabled = 0` | 콘솔 변수를 1로 설정 |
| **GPU 트레이스 결과가 항상 No Hit** | RayTracing Scene 또는 Global SDF 미활성화 | 프로젝트 설정에서 RayTracing 활성화, r.GenerateMeshDistanceFields 1 |
| **1프레임 지연된 충돌 응답** | 비동기 트레이스 사용 중 | 정상 동작. 동기 쿼리 사용 또는 예측 로직 추가 |
| **RigidMesh 충돌이 작동하지 않음** | SourceActors 또는 Tag 설정 누락 | Blueprint에서 SetSourceActors() 호출 또는 ActorTags 설정 |
| **Self-collision 발생** | Collision Group 미설정 (HWRT) | AcquireGPURayTracedCollisionGroup_GT() 호출 및 Primitive 할당 |
| **GSDF 트레이스가 부정확함** | Distance Field 해상도 낮음 | StaticMesh의 Distance Field Resolution Scale 증가 |

---

### Console Commands

| 명령어 | 설명 |
|--------|------|
| `fx.Niagara.Collision.CPUEnabled [0/1]` | CPU 충돌 활성화/비활성화 |
| `r.RayTracing [0/1]` | Hardware RayTracing 활성화/비활성화 |
| `r.RayTracing.Scene.Capture [0/1]` | RayTracing Scene 캡처 활성화 |
| `r.GenerateMeshDistanceFields [0/1]` | Mesh Distance Field 생성 활성화 |
| `r.DistanceFields.MaxPerMeshResolution [128-512]` | Distance Field 해상도 제한 |
| `r.AOGlobalDistanceField [0/1]` | Global Distance Field 생성 활성화 |
| `r.AOGlobalDistanceField.NumClipmaps [1-4]` | Global SDF Clipmap 개수 |
| `stat Niagara` | Niagara 통계 (STAT_NiagaraCollision 포함) |
| `vis.Collision.DrawAll [0/1]` | 충돌 지오메트리 시각화 |

---

### Profiling

**CPU Profiling:**
```cpp
SCOPE_CYCLE_COUNTER(STAT_NiagaraCollision);
```
- `stat Niagara` 명령어로 확인
- "Collision" 항목에서 트레이스 시간 측정

**GPU Profiling:**
```
stat GPU
ProfileGPU
```
- "NiagaraAsyncGpuTrace" Pass에서 RayTracing 시간 측정
- "NiagaraSimulation" Pass에서 시뮬레이션 시간 확인

---

### 시각화

**충돌 Primitive 시각화:**
```cpp
// Debug Draw in PerInstanceTick
void UNiagaraDataInterfaceRigidMeshCollisionQuery::DrawDebugHud(FNDIDrawDebugHudContext& DebugHudContext) const
{
    FNDIRigidMeshCollisionData* InstanceData = ...;

    for (int32 i = 0; i < InstanceData->AssetArrays->ElementOffsets.NumElements; ++i)
    {
        uint32 PhysicsType = InstanceData->AssetArrays->PhysicsType[i];
        FTransform WorldTransform = UnpackTransform(InstanceData->AssetArrays->CurrentTransform, i);
        FVector Extent = InstanceData->AssetArrays->ElementExtent[i];

        if (PhysicsType == 0)  // Box
        {
            DrawDebugBox(GetWorld(), WorldTransform.GetLocation(), Extent,
                        WorldTransform.GetRotation(), FColor::Green, false, 0.0f, 0, 1.0f);
        }
        else if (PhysicsType == 1)  // Sphere
        {
            DrawDebugSphere(GetWorld(), WorldTransform.GetLocation(), Extent.X,
                           16, FColor::Green, false, 0.0f, 0, 1.0f);
        }
        else if (PhysicsType == 2)  // Capsule
        {
            DrawDebugCapsule(GetWorld(), WorldTransform.GetLocation(), Extent.X, Extent.Y,
                            WorldTransform.GetRotation(), FColor::Green, false, 0.0f, 0, 1.0f);
        }
    }
}
```

**RayTracing 시각화:**
```
r.RayTracing.Debug.VisualizeModes 1  // RayTracing Scene 시각화
```

---

## 📚 참고 자료

### 소스 파일 위치

| 파일 | 설명 |
|------|------|
| `NiagaraCollision.h/cpp` | CPU 충돌 배치 프로세서 |
| `NiagaraDataInterfaceCollisionQuery.h/cpp` | CPU 충돌 Data Interface |
| `NiagaraDataInterfaceRigidMeshCollisionQuery.h/cpp` | Rigid Mesh 충돌 Data Interface |
| `NiagaraDataInterfaceAsyncGpuTrace.h/cpp` | GPU 비동기 트레이스 Data Interface |
| `NiagaraAsyncGpuTraceHelper.h/cpp` | GPU 트레이스 관리자 |
| `NiagaraAsyncGpuTraceProvider.h/cpp` | 추상 Provider 클래스 |
| `NiagaraAsyncGpuTraceProviderHwrt.cpp` | Hardware RayTracing Provider |
| `NiagaraAsyncGpuTraceProviderGsdf.cpp` | Global SDF Provider |
| `NiagaraAsyncGpuTraceCommon.ush` | GPU Trace 공통 구조체 (Shader) |

### 관련 문서

- **Unreal Docs:** [Niagara Collision](https://docs.unrealengine.com/en-US/RenderingAndGraphics/Niagara/ParticleAttributes/Collision/)
- **Unreal Docs:** [Hardware Ray Tracing](https://docs.unrealengine.com/en-US/BuildingVirtualWorlds/Rendering/RayTracing/)
- **Unreal Docs:** [Distance Fields](https://docs.unrealengine.com/en-US/BuildingVirtualWorlds/Rendering/DistanceFields/)

---

> 🔄 **Updated:** 2025-11-22 — Niagara Collision System 문서 생성 (CPU/GPU 충돌 감지, RigidMesh 충돌, AsyncGpuTrace, Provider 시스템, Collision Group)
