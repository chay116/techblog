---
title: "Niagara 렌더링 파이프라인 (Rendering Pipeline)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara 렌더링 파이프라인 (Rendering Pipeline)

## 🧭 개요 (Overview)

Niagara 렌더링 파이프라인은 **Game Thread (GT)** 에서 시뮬레이션된 파티클 데이터를 **Render Thread (RT)** 로 전달하여 최종적으로 화면에 렌더링하는 시스템입니다. 이 과정은 **UNiagaraRendererProperties** (설정 계층), **FNiagaraRenderer** (실행 계층), **FNiagaraSceneProxy** (Scene 브릿지), 그리고 **Vertex Factory** (GPU 인스턴싱)로 구성된 계층적 아키텍처를 따릅니다.

**핵심 철학:**
> - **UNiagaraRendererProperties**는 "어떻게 렌더링할 것인가"의 **설정**을 담당
> - **FNiagaraRenderer**는 "실제 렌더링 로직"의 **실행**을 담당
> - **FNiagaraSceneProxy**는 "Game Thread → Render Thread" 간 **브릿지**를 담당
> - **Vertex Factory**는 "파티클 데이터를 GPU로 전송"하는 **인스턴싱**을 담당

---

## 🧱 계층별 상세 분석 (Hierarchical Architecture)

### 계층 다이어그램: 전체 렌더링 파이프라인

```
┌────────────────────────────────────────────────────────────────────────┐
│                     게임 스레드 (Game Thread)                           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────────────────────────────────┐                      │
│  │  UNiagaraRendererProperties                 │                      │
│  │  (렌더러 설정 - 에디터/런타임)                │                      │
│  │  - Material, SourceMode, SortMode           │                      │
│  │  - Bindings (Position, Color, Size...)      │                      │
│  └──────────────────┬──────────────────────────┘                      │
│                     │ CreateEmitterRenderer()                         │
│                     ↓                                                  │
│  ┌─────────────────────────────────────────────┐                      │
│  │  FNiagaraRenderer (렌더러 인스턴스)          │                      │
│  │  - BaseMaterials_GT                         │                      │
│  │  - DynamicDataRender (GT → RT 전달 데이터)   │                      │
│  └──────────────────┬──────────────────────────┘                      │
│                     │ GenerateDynamicData()                           │
│                     ↓                                                  │
│  ┌─────────────────────────────────────────────┐                      │
│  │  FNiagaraDynamicDataBase                    │                      │
│  │  (프레임별 동적 데이터)                      │                      │
│  │  - CPUParticleData / ComputeDataBufferInterface                   │
│  │  - MaterialRelevance                        │                      │
│  └──────────────────┬──────────────────────────┘                      │
│                     │                                                  │
└─────────────────────┼──────────────────────────────────────────────────┘
                      │ SetDynamicData_RenderThread()
                      ↓ (ENQUEUE_RENDER_COMMAND)
┌────────────────────────────────────────────────────────────────────────┐
│                     렌더 스레드 (Render Thread)                         │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────────────────────────────────┐                      │
│  │  FNiagaraSceneProxy                         │                      │
│  │  (Primitive Scene Proxy)                    │                      │
│  │  - RenderData (FNiagaraSystemRenderData)    │                      │
│  │  - LocalToWorldInverse                      │                      │
│  └──────────────────┬──────────────────────────┘                      │
│                     │ GetDynamicMeshElements()                        │
│                     ↓                                                  │
│  ┌─────────────────────────────────────────────┐                      │
│  │  FNiagaraRenderer::GetDynamicMeshElements() │                      │
│  │  - PrepareParticleRenderData()              │                      │
│  │  - TransferDataToGPU()                      │                      │
│  └──────────────────┬──────────────────────────┘                      │
│                     │                                                  │
│                     ↓                                                  │
│  ┌─────────────────────────────────────────────┐                      │
│  │  Vertex Factory (FNiagaraSpriteVertexFactory│                      │
│  │                 FNiagaraMeshVertexFactory)   │                      │
│  │  - UniformBuffer (렌더링 파라미터)           │                      │
│  │  - ParticleDataFloat/Half/Int SRV          │                      │
│  └──────────────────┬──────────────────────────┘                      │
│                     │                                                  │
│                     ↓                                                  │
│            FMeshBatch + FMeshElement                                  │
│            (Collector에 전달)                                          │
└────────────────────────────────────────────────────────────────────────┘
                      ↓
            RenderCore (DrawCall 생성)
```

---

## 📐 1. UNiagaraRendererProperties - 렌더러 설정 계층

### 역할 (Role)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererProperties.h:294`

**UNiagaraRendererProperties**는 **Niagara 렌더러의 설정 정보를 저장하는 UObject 기반 클래스**입니다. 에디터에서 설정되며, 런타임에 `FNiagaraRenderer` 인스턴스를 생성하는 팩토리 역할을 합니다.

### 클래스 계층 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                   UNiagaraRendererProperties                    │
│  (추상 기본 클래스 - 모든 렌더러의 공통 인터페이스)               │
├─────────────────────────────────────────────────────────────────┤
│  Private:                                                       │
│    + TArray<const FNiagaraVariableAttributeBinding*> AttributeBindings│
│    + TArray<UMaterialInterface*> BaseMaterials_GT              │
│    + FMaterialRelevance BaseMaterialRelevance_GT               │
│                                                                 │
│  Public:                                                        │
│    + CreateEmitterRenderer() : FNiagaraRenderer* (PURE_VIRTUAL)│
│    + CreateBoundsCalculator() : FNiagaraBoundsCalculator*      │
│    + GetUsedMaterials() : void                                 │
│    + GetVertexFactoryType() : const FVertexFactoryType*        │
│    + CacheFromCompiledData() : void                            │
│                                                                 │
│  Properties:                                                    │
│    + UPROPERTY() FNiagaraPlatformSet Platforms                 │
│    + UPROPERTY() int32 SortOrderHint                           │
│    + UPROPERTY() ENiagaraRendererMotionVectorSetting MotionVectorSetting│
│    + UPROPERTY() FNiagaraVariableAttributeBinding RendererEnabledBinding│
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │ 상속 (Inheritance)
          ┌────────────────┼────────────────┐
          │                │                │
┌─────────────────┐ ┌─────────────┐ ┌──────────────┐
│ UNiagaraSprite  │ │ UNiagaraMesh│ │ UNiagaraRibbon│
│ RendererProperties│ │RendererProperties│RendererProperties│
│ (Sprite 렌더러)  │ │ (Mesh 렌더러)│ │ (Ribbon 렌더러)│
└─────────────────┘ └─────────────┘ └──────────────┘
```

### 핵심 멤버

```cpp
// NiagaraRendererProperties.h:294
UCLASS(ABSTRACT, MinimalAPI)
class UNiagaraRendererProperties : public UNiagaraMergeable
{
    // 렌더러 생성 팩토리 메서드 (순수 가상 함수)
    virtual FNiagaraRenderer* CreateEmitterRenderer(
        ERHIFeatureLevel::Type FeatureLevel,
        const FNiagaraEmitterInstance* Emitter,
        const FNiagaraSystemInstanceController& InController
    ) PURE_VIRTUAL(UNiagaraRendererProperties::CreateEmitterRenderer, return nullptr;);

    // Vertex Factory 타입 반환
    virtual const FVertexFactoryType* GetVertexFactoryType() const { return nullptr; }

    // 사용 중인 머티리얼 수집
    virtual void GetUsedMaterials(
        const FNiagaraEmitterInstance* InEmitter,
        TArray<UMaterialInterface*>& OutMaterials
    ) const PURE_VIRTUAL(UNiagaraRendererProperties::GetUsedMaterials,);

    // 플랫폼별 렌더러 활성화 설정
    UPROPERTY(EditAnywhere, Category = "Scalability")
    FNiagaraPlatformSet Platforms;

    // 렌더 순서 힌트 (같은 타입 내에서 정렬)
    UPROPERTY(EditAnywhere, Category = "Rendering")
    int32 SortOrderHint;

    // 모션 벡터 생성 설정
    UPROPERTY(EditAnywhere, Category = "Rendering")
    ENiagaraRendererMotionVectorSetting MotionVectorSetting;

    // 속성 바인딩 목록 (Position, Color, Size 등)
    TArray<const FNiagaraVariableAttributeBinding*> AttributeBindings;

    // Game Thread용 머티리얼 캐시
    TArray<UMaterialInterface*> BaseMaterials_GT;
    FMaterialRelevance BaseMaterialRelevance_GT;
};
```

### 렌더러별 구현 예시

#### UNiagaraSpriteRendererProperties

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSpriteRendererProperties.h:109`

```cpp
UCLASS(editinlinenew, meta = (DisplayName = "Sprite Renderer"))
class UNiagaraSpriteRendererProperties : public UNiagaraRendererProperties
{
    // 머티리얼
    UPROPERTY(EditAnywhere, Category = "Sprite Rendering")
    TObjectPtr<UMaterialInterface> Material;

    // 렌더 모드 (파티클 vs 이미터)
    UPROPERTY(EditAnywhere, Category = "Sprite Rendering")
    ENiagaraRendererSourceDataMode SourceMode = ENiagaraRendererSourceDataMode::Particles;

    // 정렬 방식
    UPROPERTY(EditAnywhere, Category = "Sprite Rendering")
    ENiagaraSpriteAlignment Alignment = ENiagaraSpriteAlignment::Automatic;

    // 카메라 향하는 모드
    UPROPERTY(EditAnywhere, Category = "Sprite Rendering")
    ENiagaraSpriteFacingMode FacingMode = ENiagaraSpriteFacingMode::Automatic;

    // 정렬 모드
    UPROPERTY(EditAnywhere, Category = "Sorting")
    ENiagaraSortMode SortMode = ENiagaraSortMode::None;

    // SubImage 설정
    UPROPERTY(EditAnywhere, Category = "SubUV")
    FVector2D SubImageSize = FVector2D(1.0f, 1.0f);

    // 속성 바인딩
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding PositionBinding;
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding ColorBinding;
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding VelocityBinding;
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding SpriteSizeBinding;
    // ... 더 많은 바인딩

    // Renderer Layout (Vertex Factory용 데이터 레이아웃)
    FNiagaraRendererLayout RendererLayoutWithCustomSort;
    FNiagaraRendererLayout RendererLayoutWithoutCustomSort;

    // 렌더러 생성 (가상 함수 구현)
    virtual FNiagaraRenderer* CreateEmitterRenderer(
        ERHIFeatureLevel::Type FeatureLevel,
        const FNiagaraEmitterInstance* Emitter,
        const FNiagaraSystemInstanceController& InController
    ) override; // → FNiagaraRendererSprites 생성
};
```

#### UNiagaraMeshRendererProperties

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraMeshRendererProperties.h:125`

```cpp
UCLASS(editinlinenew, meta = (DisplayName = "Mesh Renderer"))
class UNiagaraMeshRendererProperties : public UNiagaraRendererProperties
{
    // 렌더링할 메시 배열
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    TArray<FNiagaraMeshRendererMeshProperties> Meshes;

    // 메시 바인딩 (동적 메시 선택)
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    FNiagaraParameterBinding MeshesBinding;

    // 렌더 모드
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    ENiagaraRendererSourceDataMode SourceMode = ENiagaraRendererSourceDataMode::Particles;

    // 정렬 모드
    UPROPERTY(EditAnywhere, Category = "Sorting")
    ENiagaraSortMode SortMode = ENiagaraSortMode::None;

    // 머티리얼 오버라이드 활성화
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    uint32 bOverrideMaterials : 1;

    // 오버라이드 머티리얼
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    TArray<FNiagaraMeshMaterialOverride> OverrideMaterials;

    // Facing 모드 (메시가 카메라를 향하는 방식)
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    ENiagaraMeshFacingMode FacingMode = ENiagaraMeshFacingMode::Default;

    // 메시 바운드 스케일 (Frustum Culling 조정용)
    UPROPERTY(EditAnywhere, Category = "Mesh Rendering")
    FVector MeshBoundsScale = FVector::OneVector;

    // 속성 바인딩
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding PositionBinding;
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding MeshOrientationBinding;
    UPROPERTY(EditAnywhere, Category = "Bindings")
    FNiagaraVariableAttributeBinding ScaleBinding;
    // ... 더 많은 바인딩

    // Renderer Layout
    FNiagaraRendererLayout RendererLayoutWithCustomSorting;
    FNiagaraRendererLayout RendererLayoutWithoutCustomSorting;
};
```

### 설계 의도

| 이유 | 설명 | 효과 |
|------|------|------|
| **1. UObject 기반 직렬화** | UProperty 시스템을 활용하여 에디터에서 설정한 값을 저장 | 에셋 저장/로드 자동 처리 |
| **2. PURE_VIRTUAL 팩토리** | `CreateEmitterRenderer()`를 순수 가상 함수로 강제 | 각 렌더러 타입이 자신의 `FNiagaraRenderer` 생성 로직 구현 보장 |
| **3. AttributeBindings 배열** | 파티클 속성과 렌더러 파라미터 간 바인딩을 동적으로 관리 | 런타임에 필요한 속성만 GPU로 전송 가능 (최적화) |
| **4. Platform Set** | 플랫폼별로 렌더러 활성화/비활성화 | 모바일에서는 Light Renderer 비활성화 등 유연한 스케일링 |

---

## 📐 2. FNiagaraRenderer - 실제 렌더러 실행 계층

### 역할 (Role)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRenderer.h:71`

**FNiagaraRenderer**는 **Render Thread에서 실제 렌더링 작업을 수행하는 비-UObject 클래스**입니다. `UNiagaraRendererProperties`로부터 생성되며, 매 프레임 `GetDynamicMeshElements()`를 통해 `FMeshBatch`를 생성합니다.

### 클래스 계층 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                        FNiagaraRenderer                         │
│  (추상 기본 클래스 - Render Thread 실행 로직)                    │
├─────────────────────────────────────────────────────────────────┤
│  Protected:                                                     │
│    - FNiagaraDynamicDataBase* DynamicDataRender // RT 동적 데이터│
│    - TArray<UMaterialInterface*> BaseMaterials_GT              │
│    - FMaterialRelevance BaseMaterialRelevance_GT               │
│    - ENiagaraSimTarget SimTarget                               │
│    - ERHIFeatureLevel::Type FeatureLevel                       │
│                                                                 │
│  Public:                                                        │
│    + Initialize() : void                                       │
│    + CreateRenderThreadResources() : void                      │
│    + GetDynamicMeshElements() : void (PURE_VIRTUAL)            │
│    + GenerateDynamicData() : FNiagaraDynamicDataBase*          │
│    + SetDynamicData_RenderThread() : void                      │
│    + GetViewRelevance() : FPrimitiveViewRelevance              │
│    + TransferDataToGPU() : FParticleRenderData (static)        │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │ 상속
          ┌────────────────┼────────────────┐
          │                │                │
┌──────────────────┐ ┌───────────────┐ ┌───────────────┐
│ FNiagaraRenderer │ │ FNiagaraRenderer│ │ FNiagaraRenderer│
│     Sprites      │ │     Meshes     │ │     Ribbons    │
└──────────────────┘ └───────────────┘ └───────────────┘
```

### 핵심 멤버

```cpp
// NiagaraRenderer.h:71
class FNiagaraRenderer
{
public:
    // 생성자: Properties로부터 초기화
    NIAGARA_API FNiagaraRenderer(
        ERHIFeatureLevel::Type FeatureLevel,
        const UNiagaraRendererProperties* InProps,
        const FNiagaraEmitterInstance* Emitter
    );

    // 렌더 스레드 리소스 생성
    virtual void CreateRenderThreadResources(FRHICommandListBase& RHICmdList) {}

    // 동적 메시 생성 (매 프레임 호출)
    virtual void GetDynamicMeshElements(
        const TArray<const FSceneView*>& Views,
        const FSceneViewFamily& ViewFamily,
        uint32 VisibilityMap,
        FMeshElementCollector& Collector,
        const FNiagaraSceneProxy* SceneProxy
    ) const {}

    // GT에서 동적 데이터 생성
    virtual FNiagaraDynamicDataBase* GenerateDynamicData(
        const FNiagaraSceneProxy* Proxy,
        const UNiagaraRendererProperties* InProperties,
        const FNiagaraEmitterInstance* Emitter
    ) const { return nullptr; }

    // RT에 동적 데이터 전달
    NIAGARA_API void SetDynamicData_RenderThread(FNiagaraDynamicDataBase* NewDynamicData);

    // GPU로 파티클 데이터 전송 (Static Helper)
    static NIAGARA_API FParticleRenderData TransferDataToGPU(
        FRHICommandListBase& RHICmdList,
        FGlobalDynamicReadBuffer& DynamicReadBuffer,
        const FNiagaraRendererLayout* RendererLayout,
        TConstArrayView<uint32> IntComponents,
        const FNiagaraDataBuffer* SrcData
    );

protected:
    // RT 동적 데이터 (매 프레임 업데이트)
    struct FNiagaraDynamicDataBase* DynamicDataRender;

    // GT 머티리얼 캐시
    TArray<UMaterialInterface*> BaseMaterials_GT;
    FMaterialRelevance BaseMaterialRelevance_GT;

    // 시뮬레이션 타겟 (CPU or GPU)
    const ENiagaraSimTarget SimTarget;

    // Feature Level
    ERHIFeatureLevel::Type FeatureLevel;
};
```

### FNiagaraDynamicDataBase - GT → RT 데이터 전달

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRenderer.h:31`

```cpp
// GT에서 생성되어 RT로 전달되는 동적 데이터
struct FNiagaraDynamicDataBase
{
    explicit FNiagaraDynamicDataBase(const FNiagaraEmitterInstance* InEmitter);
    virtual ~FNiagaraDynamicDataBase();

    // GPU Low Latency Translucency 활성화 여부
    NIAGARA_API bool IsGpuLowLatencyTranslucencyEnabled() const;

    // 렌더링할 파티클 데이터 가져오기
    NIAGARA_API FNiagaraDataBuffer* GetParticleDataToRender(
        FRHICommandListBase& RHICmdList,
        bool bIsLowLatencyTranslucent = false
    ) const;

    // 머티리얼 관련성
    inline FMaterialRelevance GetMaterialRelevance() const { return MaterialRelevance; }
    inline void SetMaterialRelevance(FMaterialRelevance NewRelevance) { MaterialRelevance = NewRelevance; }

    // 시스템 인스턴스 ID
    inline FNiagaraSystemInstanceID GetSystemInstanceID() const { return SystemInstanceID; }

protected:
    FMaterialRelevance MaterialRelevance;
    FNiagaraSystemInstanceID SystemInstanceID;

    // CPU 시뮬레이션 데이터
    FNiagaraDataBufferRef CPUParticleData;

    // GPU 시뮬레이션 데이터 인터페이스
    INiagaraComputeDataBufferInterface* ComputeDataBufferInterface = nullptr;
};
```

### FNiagaraRendererSprites 구현 예시

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererSprites.h:20`

```cpp
class FNiagaraRendererSprites : public FNiagaraRenderer
{
public:
    FNiagaraRendererSprites(
        ERHIFeatureLevel::Type FeatureLevel,
        const UNiagaraRendererProperties* InProps,
        const FNiagaraEmitterInstance* Emitter
    );

    // 렌더 스레드 리소스 생성
    virtual void CreateRenderThreadResources(FRHICommandListBase& RHICmdList) override;

    // 동적 메시 생성
    virtual void GetDynamicMeshElements(
        const TArray<const FSceneView*>& Views,
        const FSceneViewFamily& ViewFamily,
        uint32 VisibilityMap,
        FMeshElementCollector& Collector,
        const FNiagaraSceneProxy* SceneProxy
    ) const override;

    // GT에서 동적 데이터 생성
    virtual FNiagaraDynamicDataBase* GenerateDynamicData(
        const FNiagaraSceneProxy* Proxy,
        const UNiagaraRendererProperties* InProperties,
        const FNiagaraEmitterInstance* Emitter
    ) const override;

private:
    // 파티클 렌더 데이터 구조체
    struct FParticleSpriteRenderData
    {
        const FNiagaraDynamicDataSprites* DynamicDataSprites = nullptr;
        class FNiagaraDataBuffer* SourceParticleData = nullptr;

        EBlendMode BlendMode = BLEND_Opaque;
        bool bHasTranslucentMaterials = false;
        bool bSortCullOnGpu = false;
        bool bNeedsSort = false;
        bool bNeedsCull = false;

        const FNiagaraRendererLayout* RendererLayout = nullptr;
        ENiagaraSpriteVFLayout::Type SortVariable = ENiagaraSpriteVFLayout::Type(INDEX_NONE);

        // GPU 버퍼 SRV
        FRHIShaderResourceView* ParticleFloatSRV = nullptr;
        FRHIShaderResourceView* ParticleHalfSRV = nullptr;
        FRHIShaderResourceView* ParticleIntSRV = nullptr;
        uint32 ParticleFloatDataStride = 0;
        uint32 ParticleHalfDataStride = 0;
        uint32 ParticleIntDataStride = 0;
    };

    // Sprite 특화 설정
    ENiagaraRendererSourceDataMode SourceMode;
    ENiagaraSpriteAlignment Alignment;
    ENiagaraSpriteFacingMode FacingMode;
    ENiagaraSortMode SortMode;
    FVector2f PivotInUVSpace;
    float MacroUVRadius;
    FVector2f SubImageSize;
    uint32 NumIndicesPerInstance;

    // Renderer Layout (Vertex Factory 데이터 레이아웃)
    const FNiagaraRendererLayout* RendererLayoutWithCustomSort;
    const FNiagaraRendererLayout* RendererLayoutWithoutCustomSort;
};
```

### 렌더링 흐름: GetDynamicMeshElements()

```
GetDynamicMeshElements() 호출
         │
         ↓
PrepareParticleSpriteRenderData()  // 파티클 데이터 준비
         │
         ├─→ GetParticleDataToRender() // CPU/GPU 데이터 가져오기
         │
         ├─→ PrepareParticleRenderBuffers() // GPU 버퍼 전송
         │    └─→ TransferDataToGPU() // Float/Half/Int 데이터 분리 전송
         │
         ├─→ SortAndCullIndices() // 정렬/컬링 (필요시)
         │
         └─→ SetupVertexFactory() // Vertex Factory 설정
                  │
                  ↓
         CreateViewUniformBuffer() // View별 Uniform Buffer 생성
                  │
                  ↓
         CreateMeshBatchForView() // FMeshBatch 생성
                  │
                  ↓
         Collector.AddMesh() // Mesh Collector에 추가
```

---

## 📐 3. FNiagaraSceneProxy - Scene Bridge

### 역할 (Role)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSceneProxy.h:34`

**FNiagaraSceneProxy**는 **`FPrimitiveSceneProxy`를 상속받아 Niagara System을 Unreal Scene에 통합하는 브릿지**입니다. `UNiagaraComponent`로부터 생성되며, Scene에 렌더링 가능한 Primitive로 등록됩니다.

### 클래스 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                     FNiagaraSceneProxy                          │
│  (FPrimitiveSceneProxy 상속 - Scene 통합)                       │
├─────────────────────────────────────────────────────────────────┤
│  Private:                                                       │
│    - FNiagaraSystemRenderData* RenderData                      │
│    - FNiagaraGpuComputeDispatchInterface* ComputeDispatchInterface│
│    - FMatrix LocalToWorldInverse                               │
│    - ENiagaraOcclusionQueryMode OcclusionQueryMode             │
│    - TMap<uint32, TUniformBuffer<...>*> CustomUniformBuffers   │
│                                                                 │
│  Public:                                                        │
│    + GetDynamicMeshElements() : void (override)                │
│    + GetViewRelevance() : FPrimitiveViewRelevance (override)   │
│    + CreateRenderThreadResources() : void (override)           │
│    + OnTransformChanged() : void (override)                    │
│    + GatherSimpleLights() : void (override)                    │
│    + GetSystemRenderData() : FNiagaraSystemRenderData*         │
│    + GetCustomUniformBuffer() : FRHIUniformBuffer*             │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 멤버

```cpp
// NiagaraSceneProxy.h:34
class FNiagaraSceneProxy : public FPrimitiveSceneProxy
{
public:
    // 생성자: UNiagaraComponent로부터 초기화
    NIAGARA_API FNiagaraSceneProxy(const FNiagaraSceneProxyDesc& Desc);

    // 시스템 렌더 데이터 가져오기
    FNiagaraSystemRenderData* GetSystemRenderData() { return RenderData; }

    // GPU Compute Dispatch Interface
    FNiagaraGpuComputeDispatchInterface* GetComputeDispatchInterface() const
    {
        return ComputeDispatchInterface;
    }

    // View Relevance (어떤 렌더 패스에 참여할지)
    NIAGARA_API virtual FPrimitiveViewRelevance GetViewRelevance(
        const FSceneView* View
    ) const override;

    // 동적 메시 생성 (FPrimitiveSceneProxy 인터페이스)
    NIAGARA_API virtual void GetDynamicMeshElements(
        const TArray<const FSceneView*>& Views,
        const FSceneViewFamily& ViewFamily,
        uint32 VisibilityMap,
        FMeshElementCollector& Collector
    ) const override;

    // 간단한 라이트 수집 (Light Renderer용)
    NIAGARA_API virtual void GatherSimpleLights(
        const FSceneViewFamily& ViewFamily,
        FSimpleLightArray& OutParticleLights
    ) const override;

    // 커스텀 Uniform Buffer (Pre-skinned bounds 등)
    NIAGARA_API FRHIUniformBuffer* GetCustomUniformBuffer(
        FRHICommandListBase& RHICmdList,
        bool bHasVelocity,
        const FBox& InstanceBounds = FBox(ForceInitToZero)
    ) const;

    // LocalToWorld 역행렬
    inline const FMatrix& GetLocalToWorldInverse() const { return LocalToWorldInverse; }

private:
    // 시스템 렌더 데이터 (모든 Renderer 포함)
    FNiagaraSystemRenderData* RenderData = nullptr;

    // GPU Compute Dispatch Interface
    FNiagaraGpuComputeDispatchInterface* ComputeDispatchInterface = nullptr;

    // LocalToWorld 역행렬 (Local Space 시뮬레이션용)
    FMatrix LocalToWorldInverse;

    // Occlusion Query 모드
    ENiagaraOcclusionQueryMode OcclusionQueryMode;

    // 커스텀 Uniform Buffer 캐시
    mutable UE::FMutex CustomUniformBuffersGuard;
    mutable TMap<uint32, TUniformBuffer<FPrimitiveUniformShaderParameters>*> CustomUniformBuffers;
};
```

### GetDynamicMeshElements() 구현

```cpp
// NiagaraSceneProxy.cpp (simplified)
void FNiagaraSceneProxy::GetDynamicMeshElements(
    const TArray<const FSceneView*>& Views,
    const FSceneViewFamily& ViewFamily,
    uint32 VisibilityMap,
    FMeshElementCollector& Collector
) const
{
    if (RenderData == nullptr)
        return;

    // 각 렌더러의 GetDynamicMeshElements 호출
    for (FNiagaraRenderer* Renderer : RenderData->GetRenderers())
    {
        if (Renderer && Renderer->HasDynamicData())
        {
            Renderer->GetDynamicMeshElements(
                Views, ViewFamily, VisibilityMap, Collector, this
            );
        }
    }
}
```

### Scene Proxy 생성 흐름

```
UNiagaraComponent::CreateSceneProxy()
         │
         ↓
FNiagaraSceneProxyDesc 생성 (SystemInstanceController, SystemAsset 전달)
         │
         ↓
FNiagaraSceneProxy 생성자 호출
         │
         ├─→ FNiagaraSystemRenderData 생성/참조
         │    └─→ 모든 Emitter의 FNiagaraRenderer 포함
         │
         ├─→ ComputeDispatchInterface 획득 (GPU 시뮬레이션용)
         │
         └─→ LocalToWorldInverse 계산
                  │
                  ↓
Scene에 Proxy 등록 (AddPrimitive)
```

---

## 📐 4. Vertex Factory - GPU 인스턴싱

### 역할 (Role)

**Vertex Factory**는 **파티클 데이터를 GPU Vertex Shader에 전달하는 추상 계층**입니다. Unreal의 `FVertexFactory` 시스템을 활용하여 각 파티클을 개별 인스턴스로 렌더링합니다.

### FNiagaraSpriteVertexFactory

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraSpriteVertexFactory.h:113`

```cpp
class FNiagaraSpriteVertexFactory : public FNiagaraVertexFactoryBase
{
    DECLARE_VERTEX_FACTORY_TYPE_API(FNiagaraSpriteVertexFactory, NIAGARAVERTEXFACTORIES_API);

public:
    // Sprite Uniform Buffer (View별 파라미터)
    void SetSpriteUniformBuffer(const FNiagaraSpriteUniformBufferRef& InSpriteUniformBuffer)
    {
        SpriteUniformBuffer = InSpriteUniformBuffer;
    }

    // Cutout Geometry (SubUV Cutout용)
    void SetCutoutGeometry(FRHIShaderResourceView* InCutoutGeometrySRV)
    {
        CutoutGeometrySRV = InCutoutGeometrySRV;
    }

    // 정렬된 인덱스 (GPU Sorting)
    void SetSortedIndices(
        const FShaderResourceViewRHIRef& InSortedIndicesSRV,
        uint32 InSortedIndicesOffset
    );

    // Facing/Alignment 모드
    void SetFacingMode(uint32 InMode) { FacingMode = InMode; }
    void SetAlignmentMode(uint32 InMode) { AlignmentMode = InMode; }

private:
    // Uniform Buffer (렌더링 파라미터)
    FUniformBufferRHIRef SpriteUniformBuffer;
    FUniformBufferRHIRef LooseParameterUniformBuffer;

    // Cutout Geometry SRV
    FShaderResourceViewRHIRef CutoutGeometrySRV;
    uint32 CutoutParameters = 0;

    // 정렬된 인덱스
    FShaderResourceViewRHIRef SortedIndicesSRV;
    uint32 SortedIndicesOffset = 0;

    // 모드 설정
    uint32 AlignmentMode = 0;
    uint32 FacingMode = 0;
};
```

### FNiagaraSpriteUniformParameters (Uniform Buffer)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraSpriteVertexFactory.h:21`

```cpp
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FNiagaraSpriteUniformParameters, NIAGARAVERTEXFACTORIES_API)
    // 로컬 스페이스 여부
    SHADER_PARAMETER(uint32, bLocalSpace)

    // SubImage 설정
    SHADER_PARAMETER_EX(FVector4f, SubImageSize, EShaderPrecisionModifier::Half)

    // Camera Facing Blend
    SHADER_PARAMETER_EX(FVector3f, CameraFacingBlend, EShaderPrecisionModifier::Half)

    // 회전 스케일/바이어스
    SHADER_PARAMETER_EX(float, RotationScale, EShaderPrecisionModifier::Half)
    SHADER_PARAMETER_EX(float, RotationBias, EShaderPrecisionModifier::Half)

    // 속성 데이터 오프셋 (파티클 버퍼 내)
    SHADER_PARAMETER(int, PositionDataOffset)
    SHADER_PARAMETER(int, VelocityDataOffset)
    SHADER_PARAMETER(int, RotationDataOffset)
    SHADER_PARAMETER(int, SizeDataOffset)
    SHADER_PARAMETER(int, ColorDataOffset)
    SHADER_PARAMETER(int, SubimageDataOffset)
    // ... 더 많은 오프셋

    // 기본값 (바인딩 안 된 속성용)
    SHADER_PARAMETER(FVector4f, DefaultPos)
    SHADER_PARAMETER(FVector2f, DefaultSize)
    SHADER_PARAMETER(FVector4f, DefaultColor)
    // ... 더 많은 기본값

    // Pixel Coverage (서브픽셀 알파 보정)
    SHADER_PARAMETER(int, PixelCoverageEnabled)
    SHADER_PARAMETER(FVector4f, PixelCoverageColorBlend)

    // Accurate Motion Vectors
    SHADER_PARAMETER(int, AccurateMotionVectors)
END_GLOBAL_SHADER_PARAMETER_STRUCT()
```

### FNiagaraSpriteVFLooseParameters (Loose Parameters)

```cpp
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FNiagaraSpriteVFLooseParameters, NIAGARAVERTEXFACTORIES_API)
    // Cutout 파라미터
    SHADER_PARAMETER(uint32, CutoutParameters)

    // Float 데이터 스트라이드
    SHADER_PARAMETER(uint32, NiagaraFloatDataStride)

    // Alignment/Facing 모드
    SHADER_PARAMETER(uint32, ParticleAlignmentMode)
    SHADER_PARAMETER(uint32, ParticleFacingMode)

    // 정렬 인덱스 오프셋
    SHADER_PARAMETER(uint32, SortedIndicesOffset)

    // Indirect Args 오프셋
    SHADER_PARAMETER(uint32, IndirectArgsOffset)

    // SRV 바인딩
    SHADER_PARAMETER_SRV(Buffer<float2>, CutoutGeometry)
    SHADER_PARAMETER_SRV(Buffer<float>, NiagaraParticleDataFloat)
    SHADER_PARAMETER_SRV(Buffer<float>, NiagaraParticleDataHalf)
    SHADER_PARAMETER_SRV(Buffer<uint>, SortedIndices)
    SHADER_PARAMETER_SRV(Buffer<uint>, IndirectArgsBuffer)
END_GLOBAL_SHADER_PARAMETER_STRUCT()
```

### FNiagaraMeshVertexFactory

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraMeshVertexFactory.h:120`

```cpp
class FNiagaraMeshVertexFactory : public FNiagaraVertexFactoryBase
{
    DECLARE_VERTEX_FACTORY_TYPE_API(FNiagaraMeshVertexFactory, NIAGARAVERTEXFACTORIES_API);

public:
    // Static Mesh 데이터 설정 (메시 버텍스)
    NIAGARAVERTEXFACTORIES_API void SetData(
        FRHICommandListBase& RHICmdList,
        const FStaticMeshDataType& InData
    );

    // Uniform Buffer 설정 (파티클별 파라미터)
    inline void SetUniformBuffer(const FNiagaraMeshUniformBufferRef& InMeshParticleUniformBuffer)
    {
        MeshParticleUniformBuffer = InMeshParticleUniformBuffer;
    }

    // GPU Scene 활성화 여부
    static NIAGARAVERTEXFACTORIES_API bool IsGPUSceneEnabled(
        const FStaticShaderPlatform Platform,
        const FStaticFeatureLevel FeatureLevel
    );

private:
    // Static Mesh 데이터 (버텍스 버퍼, UV, Normal 등)
    FStaticMeshDataType Data;

    // Uniform Buffer (파티클별 인스턴스 데이터)
    FRHIUniformBuffer* MeshParticleUniformBuffer;

    // Primitive ID 엘리먼트 추가 여부
    bool bAddPrimitiveIDElement;
};
```

### FNiagaraMeshUniformParameters (Mesh Uniform Buffer)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraMeshVertexFactory.h:78`

```cpp
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FNiagaraMeshUniformParameters, NIAGARAVERTEXFACTORIES_API)
    // 공통 파라미터 (Base Class)
    SHADER_PARAMETER_STRUCT_INCLUDE(FNiagaraMeshCommonParameters, Common)

    // Vertex Fetch 버퍼 (Manual Vertex Fetch용)
    SHADER_PARAMETER_SRV(Buffer<float2>, VertexFetch_TexCoordBuffer)
    SHADER_PARAMETER_SRV(Buffer<float4>, VertexFetch_PackedTangentsBuffer)
    SHADER_PARAMETER_SRV(Buffer<float4>, VertexFetch_ColorComponentsBuffer)
    SHADER_PARAMETER(FIntVector4, VertexFetch_Parameters)

    // SubImage 설정
    SHADER_PARAMETER(FVector4f, SubImageSize)
    SHADER_PARAMETER(uint32, TexCoordWeightA)
    SHADER_PARAMETER(uint32, TexCoordWeightB)

    // 속성 데이터 오프셋
    SHADER_PARAMETER(int, NormalizedAgeDataOffset)
    SHADER_PARAMETER(int, SubImageDataOffset)
    SHADER_PARAMETER(int, MaterialRandomDataOffset)
    SHADER_PARAMETER(int, ColorDataOffset)
    SHADER_PARAMETER(int, MaterialParamDataOffset)
    // ... 더 많은 오프셋

    // 기본값
    SHADER_PARAMETER(float, DefaultNormAge)
    SHADER_PARAMETER(float, DefaultSubImage)
    SHADER_PARAMETER(FVector4f, DefaultColor)
    // ... 더 많은 기본값
END_GLOBAL_SHADER_PARAMETER_STRUCT()
```

---

## 🔄 데이터 흐름: Game Thread → Render Thread

### 전체 데이터 흐름 시퀀스 다이어그램

```
[Game Thread]                                       [Render Thread]
      │                                                    │
      │ FNiagaraSystemInstance::Tick()                    │
      │  └─> FNiagaraEmitterInstance::Tick()              │
      │       └─> Simulate Particles                      │
      │            └─> FNiagaraDataSet::Tick()            │
      │                 └─> FNiagaraDataBuffer (결과)     │
      ↓                                                    │
 GenerateDynamicData()                                    │
      │                                                    │
      ├─> FNiagaraRenderer::GenerateDynamicData()         │
      │    └─> FNiagaraDynamicDataSprites 생성            │
      │         ├─> CPUParticleData 참조                  │
      │         └─> MaterialRelevance 계산                │
      ↓                                                    │
 ENQUEUE_RENDER_COMMAND(                                  │
   SetDynamicData_RenderThread,                           │
   [Renderer, DynamicData]                                │
   {                                                      │
     Renderer->SetDynamicData_RenderThread(DynamicData);  │
   }                                                      │
 )                                                        │
      │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━>│
      │                                          SetDynamicData_RenderThread()
      │                                                    │
      │                                                    ↓
      │                                          DynamicDataRender = NewDynamicData
      │                                                    │
      │                        (렌더링 시점: GetDynamicMeshElements)
      │                                                    │
      │                                                    ↓
      │                              FNiagaraSceneProxy::GetDynamicMeshElements()
      │                                                    │
      │                                                    ├─> 각 Renderer 순회
      │                                                    │
      │                                                    ↓
      │                              FNiagaraRendererSprites::GetDynamicMeshElements()
      │                                                    │
      │                                                    ├─> PrepareParticleSpriteRenderData()
      │                                                    │    └─> GetParticleDataToRender()
      │                                                    │         └─> DynamicData->CPUParticleData
      │                                                    │
      │                                                    ├─> PrepareParticleRenderBuffers()
      │                                                    │    └─> TransferDataToGPU()
      │                                                    │         ├─> Float Buffer (Position, Size...)
      │                                                    │         ├─> Half Buffer (Velocity, Color...)
      │                                                    │         └─> Int Buffer (SubImage...)
      │                                                    │
      │                                                    ├─> SortAndCullIndices() (필요시)
      │                                                    │
      │                                                    ├─> SetupVertexFactory()
      │                                                    │    └─> FNiagaraSpriteVertexFactory
      │                                                    │         ├─> SetSpriteUniformBuffer()
      │                                                    │         ├─> SetSortedIndices()
      │                                                    │         └─> SetLooseParameterUniformBuffer()
      │                                                    │
      │                                                    ├─> CreateMeshBatchForView()
      │                                                    │    └─> FMeshBatch 생성
      │                                                    │         ├─> VertexFactory 설정
      │                                                    │         ├─> MaterialProxy 설정
      │                                                    │         └─> FMeshBatchElement 설정
      │                                                    │              ├─> NumPrimitives
      │                                                    │              ├─> FirstIndex
      │                                                    │              └─> IndirectArgsBuffer
      │                                                    │
      │                                                    └─> Collector.AddMesh(ViewIndex, MeshBatch)
      │                                                              │
      │                                                              ↓
      │                                                    RenderCore (DrawCall 생성)
```

### TransferDataToGPU() 상세 분석

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRenderer.h:183`

```cpp
// FNiagaraRenderer::TransferDataToGPU()
static FParticleRenderData TransferDataToGPU(
    FRHICommandListBase& RHICmdList,
    FGlobalDynamicReadBuffer& DynamicReadBuffer,
    const FNiagaraRendererLayout* RendererLayout,
    TConstArrayView<uint32> IntComponents,
    const FNiagaraDataBuffer* SrcData
)
{
    FParticleRenderData Result;

    const int32 TotalFloatComponents = RendererLayout->GetTotalFloatComponents_RenderThread();
    const int32 TotalHalfComponents = RendererLayout->GetTotalHalfComponents_RenderThread();

    // Float 데이터 전송
    if (TotalFloatComponents > 0)
    {
        Result.FloatStride = TotalFloatComponents;
        Result.FloatData = DynamicReadBuffer.AllocateFloat(
            SrcData->GetNumInstances() * TotalFloatComponents
        );

        // CPU → GPU 복사
        for (const FNiagaraRendererVariableInfo& VarInfo : RendererLayout->GetVFVariables_RenderThread())
        {
            if (VarInfo.ShouldUpload() && !VarInfo.IsHalfType())
            {
                const int32 SrcOffset = VarInfo.GetRawDatasetOffset();
                const int32 DstOffset = VarInfo.GetRawGPUOffset();
                const int32 NumComponents = VarInfo.GetNumComponents();

                // 파티클별 복사
                for (uint32 i = 0; i < SrcData->GetNumInstances(); ++i)
                {
                    const float* SrcPtr = SrcData->GetInstancePtrFloat(SrcOffset, i);
                    float* DstPtr = Result.FloatData.Buffer + (i * TotalFloatComponents + DstOffset);
                    FMemory::Memcpy(DstPtr, SrcPtr, NumComponents * sizeof(float));
                }
            }
        }
    }

    // Half 데이터 전송 (동일한 로직, FFloat16으로 변환)
    if (TotalHalfComponents > 0)
    {
        // ... 생략 (Float와 동일하지만 FFloat16으로 변환)
    }

    // Int 데이터 전송
    if (IntComponents.Num() > 0)
    {
        // ... 생략 (Int 데이터 복사)
    }

    return Result;
}
```

### FParticleRenderData 구조체

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRenderer.h:58`

```cpp
struct FParticleRenderData
{
    // Float 데이터 (Position, Size, CameraOffset 등)
    FGlobalDynamicReadBuffer::FAllocation FloatData;
    uint32 FloatStride = 0;

    // Half 데이터 (Velocity, Color 등 - 정밀도 낮아도 됨)
    FGlobalDynamicReadBuffer::FAllocation HalfData;
    uint32 HalfStride = 0;

    // Int 데이터 (SubImage, MaterialRandom 등)
    FGlobalDynamicReadBuffer::FAllocation IntData;
    uint32 IntStride = 0;
};
```

---

## 🧩 주요 렌더러 타입 (Renderer Types)

Niagara는 다양한 렌더러 타입을 제공합니다:

### 1. Sprite Renderer (FNiagaraRendererSprites)

**용도:** 카메라를 향하는 빌보드 스프라이트 렌더링

**특징:**
- 카메라 Facing 모드 (FaceCamera, FaceCameraPlane, CustomFacingVector)
- Alignment 모드 (Unaligned, VelocityAligned, CustomAlignment)
- SubUV Animation 지원
- Cutout Geometry (서브픽셀 알파)
- GPU Sorting/Culling

**Vertex Factory:** `FNiagaraSpriteVertexFactory`

### 2. Mesh Renderer (FNiagaraRendererMeshes)

**용도:** Static Mesh 인스턴싱 렌더링

**특징:**
- 메시 배열 지원 (파티클별 다른 메시)
- LOD 지원 (거리/스크린 크기 기반)
- 머티리얼 오버라이드
- Facing 모드 (Default, Velocity, CameraPosition, CameraPlane)
- GPU Scene 통합 (UE5+)

**Vertex Factory:** `FNiagaraMeshVertexFactory`

### 3. Ribbon Renderer (FNiagaraRendererRibbons)

**용도:** 파티클을 연결하는 리본/트레일 렌더링

**특징:**
- Multi-Ribbon 지원 (Ribbon ID별)
- Tessellation (커브 부드러움)
- 커스텀 Shape (Plane, MultiPlane, Tube, Custom Vertices)
- UV Mapping (길이/파티클 인덱스 기반)
- GPU 버텍스 생성

**Vertex Factory:** `FNiagaraRibbonVertexFactory`

### 4. Light Renderer (FNiagaraRendererLights)

**용도:** 파티클당 Dynamic Point Light 생성

**특징:**
- SimpleLights 시스템 사용 (경량화)
- 광원 감쇠/반경 제어
- 색상/강도 바인딩

**Vertex Factory:** 없음 (FSimpleLightArray 직접 사용)

### 5. Decal Renderer (FNiagaraRendererDecals)

**용도:** 표면에 데칼 투사

**특징:**
- Deferred Decal 시스템 통합
- 회전/크기/투사 방향 제어

**Vertex Factory:** Decal Vertex Factory 사용

### 6. Component Renderer (FNiagaraRendererComponents)

**용도:** 파티클당 Actor Component 생성 (예: Audio, Niagara Sub-System)

**특징:**
- USceneComponent 풀링
- 라이프사이클 관리

**Vertex Factory:** 없음

---

## 💡 성능 최적화 (Performance Optimization)

### 1. GPU 인스턴싱

**원리:** 동일 메시/스프라이트를 인스턴싱으로 한 번에 렌더링

**✅ 효과:**
- DrawCall 수: `1 DrawCall per Material` (vs `N DrawCalls`)
- GPU 오버헤드 감소

**구현:**
```cpp
// FMeshBatchElement 설정
MeshBatchElement.NumInstances = NumParticles; // 인스턴스 수
MeshBatchElement.InstancedLODIndex = 0;
MeshBatchElement.UserData = (void*)&VertexFactory; // Vertex Factory 포인터
```

### 2. GPU Sorting

**문제:** CPU에서 파티클 정렬 시 병목

**✅ 해결:**
- GPU Compute Shader로 정렬
- Radix Sort 사용 (대규모 파티클에 유리)

**트리거:**
```cpp
// NiagaraRenderer.cpp
if (bSortCullOnGpu)
{
    int32 SortedCount = SortAndCullIndices(
        RHICmdList, SortInfo, Buffer, OutIndices
    );
}
```

### 3. Float vs Half Precision

**원리:** 정밀도가 낮아도 되는 데이터는 Half (FP16)로 전송

**예시:**
```cpp
// Float (32-bit): Position, Size, CameraOffset
// Half (16-bit): Velocity, Color, NormalizedAge
```

**✅ 효과:**
- 메모리 대역폭 **50% 절약** (Half 사용 시)

### 4. Frustum/Distance Culling

**원리:** 보이지 않는 파티클 제거

**설정:**
```cpp
// UNiagaraSpriteRendererProperties
UPROPERTY(EditAnywhere, Category = "Visibility")
uint8 bEnableCameraDistanceCulling : 1;

UPROPERTY(EditAnywhere, Category = "Visibility")
float MinCameraDistance;

UPROPERTY(EditAnywhere, Category = "Visibility")
float MaxCameraDistance = 1000.0f;
```

### 5. GPU Low Latency Translucency

**문제:** GPU 시뮬레이션 결과가 1프레임 지연

**✅ 해결:**
- Translucent 렌더링 직전에 GPU 시뮬레이션 실행
- Depth Buffer/Distance Field 읽기 필요 시 사용

**설정:**
```cpp
UPROPERTY(EditAnywhere, Category = "Sprite Rendering")
ENiagaraRendererGpuTranslucentLatency GpuTranslucentLatency = ENiagaraRendererGpuTranslucentLatency::ProjectDefault;
```

---

## 📐 5. FNiagaraRendererLayout - Vertex Factory 레이아웃

### 역할 (Role)

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererProperties.h:147`

**FNiagaraRendererLayout**는 파티클 데이터에서 GPU 버퍼로의 매핑을 정의합니다. 각 파티클 속성이 GPU 버퍼의 어느 오프셋에 위치할지, Float/Half 중 어떤 정밀도를 사용할지를 관리합니다.

```cpp
struct FNiagaraRendererLayout
{
    // 초기화
    void Initialize(int32 NumVariables);

    // 변수 설정
    bool SetVariable(const FNiagaraDataSetCompiledData* CompiledData,
                    const FNiagaraVariableBase& Variable,
                    int32 VFVarOffset);

    bool SetVariableFromBinding(const FNiagaraDataSetCompiledData* CompiledData,
                               const FNiagaraVariableAttributeBinding& VariableBinding,
                               int32 VFVarOffset);

    // 완료
    void Finalize();

    // Game Thread/Render Thread 분리된 데이터
    TConstArrayView<FNiagaraRendererVariableInfo> GetVFVariables_GameThread() const;
    TConstArrayView<FNiagaraRendererVariableInfo> GetVFVariables_RenderThread() const;

    int32 GetTotalFloatComponents_RenderThread() const;
    int32 GetTotalHalfComponents_RenderThread() const;

private:
    TArray<FNiagaraRendererVariableInfo> VFVariables_GT;
    TArray<FNiagaraRendererVariableInfo> VFVariables_RT;

    uint16 TotalFloatComponents_GT = 0;
    uint16 TotalHalfComponents_GT = 0;
    uint16 TotalFloatComponents_RT = 0;
    uint16 TotalHalfComponents_RT = 0;
};
```

### FNiagaraRendererVariableInfo

```cpp
struct FNiagaraRendererVariableInfo
{
    static constexpr uint16 kInvalidOffset = 0xffff;

    inline int32 GetNumComponents() const { return NumComponents; }
    inline int32 GetGPUOffset() const { return GPUBufferOffset | (bHalfType ? (1 << 31) : 0); }
    inline int32 GetDatasetOffset() const { return DatasetOffset | (bHalfType ? (1 << 31) : 0); }
    inline bool ShouldUpload() const { return bUpload; }
    inline bool IsHalfType() const { return bHalfType; }

protected:
    uint16 DatasetOffset = kInvalidOffset;   // FNiagaraDataSet 내 오프셋
    uint16 GPUBufferOffset = kInvalidOffset; // GPU 버퍼 내 오프셋
    uint16 NumComponents = 0;                // float/half 개수
    bool bUpload = false;                    // GPU로 업로드 여부
    bool bHalfType = false;                  // FP16 여부
};
```

### GPU 버퍼 레이아웃 생성 예시

```cpp
// Sprite Renderer 예시
void UNiagaraSpriteRendererProperties::CacheFromCompiledData(const FNiagaraDataSetCompiledData* CompiledData)
{
    RendererLayout.Initialize(ENiagaraSpriteVFLayout::Num_Max);

    RendererLayout.SetVariableFromBinding(CompiledData, PositionBinding, ENiagaraSpriteVFLayout::Position);
    RendererLayout.SetVariableFromBinding(CompiledData, ColorBinding, ENiagaraSpriteVFLayout::Color);
    RendererLayout.SetVariableFromBinding(CompiledData, VelocityBinding, ENiagaraSpriteVFLayout::Velocity);
    // ... (Rotation, Size, Facing 등)

    RendererLayout.Finalize();
}
```

결과 GPU 버퍼 레이아웃:

```
GPU Buffer Layout (Float):
  Offset 0:  Position.x, Position.y, Position.z
  Offset 3:  Color.r, Color.g, Color.b, Color.a
  Offset 7:  Velocity.x, Velocity.y, Velocity.z
  Offset 10: Rotation (1 component)
  Offset 11: Size.x, Size.y
  ...

Vertex Shader Input (NiagaraSpriteVertexFactory.ush):
  float3 ParticlePosition = ParticleData[InstanceId * Stride + 0];
  float4 ParticleColor = ParticleData[InstanceId * Stride + 3];
  float3 ParticleVelocity = ParticleData[InstanceId * Stride + 7];
  ...
```

---

## 📐 6. Vertex Factory Layout Enum 상세

### ENiagaraSpriteVFLayout

```cpp
namespace ENiagaraSpriteVFLayout
{
    enum Type
    {
        Position,         // Particles.Position
        Color,            // Particles.Color
        Velocity,         // Particles.Velocity
        Rotation,         // Particles.SpriteRotation
        Size,             // Particles.SpriteSize
        Facing,           // Particles.SpriteFacing
        Alignment,        // Particles.SpriteAlignment
        SubImage,         // Particles.SubImageIndex
        MaterialParam0,   // Particles.DynamicMaterialParameter0
        MaterialParam1,   // Particles.DynamicMaterialParameter1
        MaterialParam2,   // Particles.DynamicMaterialParameter2
        MaterialParam3,   // Particles.DynamicMaterialParameter3
        CameraOffset,     // Particles.CameraOffset
        UVScale,          // Particles.UVScale
        PivotOffset,      // Particles.PivotOffset
        MaterialRandom,   // Particles.MaterialRandom
        CustomSorting,    // Particles.CustomSortingValue
        NormalizedAge,    // Particles.NormalizedAge

        Num_Default,

        // Motion Vector용 추가 레이아웃
        PrevPosition = Num_Default,
        PrevVelocity,
        PrevRotation,
        PrevSize,
        PrevFacing,
        PrevAlignment,
        PrevCameraOffset,
        PrevPivotOffset,

        Num_Max,
    };
}
```

### ENiagaraMeshVFLayout

```cpp
namespace ENiagaraMeshVFLayout
{
    enum Type
    {
        Position,         // Particles.Position
        Velocity,         // Particles.Velocity
        Color,            // Particles.Color
        Scale,            // Particles.Scale
        Rotation,         // Particles.MeshOrientation
        MaterialRandom,   // Particles.MaterialRandom
        NormalizedAge,    // Particles.NormalizedAge
        CustomSorting,    // Particles.CustomSortingValue
        SubImage,         // Particles.SubImageIndex
        DynamicParam0,    // Particles.DynamicMaterialParameter0
        DynamicParam1,    // Particles.DynamicMaterialParameter1
        DynamicParam2,    // Particles.DynamicMaterialParameter2
        DynamicParam3,    // Particles.DynamicMaterialParameter3
        CameraOffset,     // Particles.CameraOffset

        Num_Default,

        // Motion Vector용
        PrevPosition = Num_Default,
        PrevScale,
        PrevRotation,
        PrevCameraOffset,
        PrevVelocity,

        Num_Max,
    };
}
```

---

## 📐 7. 머티리얼 파라미터 바인딩 (Material Parameter Binding)

### 머티리얼 파라미터 구조체

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererProperties.h:195`

Niagara는 파티클 Attribute를 머티리얼 파라미터로 자동 전달하는 바인딩 시스템을 제공합니다.

```cpp
USTRUCT()
struct FNiagaraRendererMaterialScalarParameter
{
    UPROPERTY(EditAnywhere, Category = "Material")
    FName MaterialParameterName;  // 머티리얼 파라미터 이름

    UPROPERTY(EditAnywhere, Category = "Material")
    float Value = 0.0f;  // 기본값 (바인딩 없을 때)
};

USTRUCT()
struct FNiagaraRendererMaterialVectorParameter
{
    UPROPERTY(EditAnywhere, Category = "Material")
    FName MaterialParameterName;

    UPROPERTY(EditAnywhere, Category = "Material")
    FLinearColor Value = FLinearColor::White;
};

USTRUCT()
struct FNiagaraRendererMaterialTextureParameter
{
    UPROPERTY(EditAnywhere, Category = "Material")
    FName MaterialParameterName;

    UPROPERTY(EditAnywhere, Category = "Material")
    TObjectPtr<UTexture> Texture;
};

USTRUCT()
struct FNiagaraRendererMaterialStaticBoolParameter
{
    UPROPERTY(EditAnywhere, Category = "Material")
    FName MaterialParameterName;

    UPROPERTY(EditAnywhere, Category = "Material")
    FName StaticVariableName;  // Niagara Static Variable 바인딩
};

USTRUCT()
struct FNiagaraRendererMaterialParameters
{
    UPROPERTY(EditAnywhere, Category = "Material")
    TArray<FNiagaraRendererMaterialScalarParameter> ScalarParameters;

    UPROPERTY(EditAnywhere, Category = "Material")
    TArray<FNiagaraRendererMaterialVectorParameter> VectorParameters;

    UPROPERTY(EditAnywhere, Category = "Material")
    TArray<FNiagaraRendererMaterialTextureParameter> TextureParameters;

    UPROPERTY(EditAnywhere, Category = "Material")
    TArray<FNiagaraRendererMaterialStaticBoolParameter> StaticBoolParameters;

    UPROPERTY(EditAnywhere, Category = "Material")
    TArray<FNiagaraMaterialAttributeBinding> AttributeBindings;
};
```

### FNiagaraMaterialAttributeBinding

```cpp
USTRUCT()
struct FNiagaraMaterialAttributeBinding
{
    // 머티리얼 파라미터 이름 (예: "EmissiveColor")
    UPROPERTY(EditAnywhere, Category = "Material")
    FName MaterialParameterName;

    // Niagara Attribute 바인딩 (예: Particles.Color)
    UPROPERTY(EditAnywhere, Category = "Material")
    FNiagaraVariableAttributeBinding NiagaraVariable;

    // Attribute → Parameter 변환 채널 매핑 (예: RGB → XYZ)
    UPROPERTY(EditAnywhere, Category = "Material")
    ENiagaraMaterialParameterBinding ResolvedDestination = ENiagaraMaterialParameterBinding::None;
};
```

### 머티리얼 파라미터 설정 프로세스

```cpp
// FNiagaraRenderer::ProcessMaterialParameterBindings()
void FNiagaraRenderer::ProcessMaterialParameterBindings(
    const FNiagaraRendererMaterialParameters& MaterialParameters,
    const FNiagaraEmitterInstance* InEmitter,
    TConstArrayView<UMaterialInterface*> InMaterials) const
{
    for (UMaterialInterface* Mat : InMaterials)
    {
        if (UMaterialInstanceDynamic* MID = Cast<UMaterialInstanceDynamic>(Mat))
        {
            // Scalar Parameters
            for (const auto& Param : MaterialParameters.ScalarParameters)
            {
                MID->SetScalarParameterValue(Param.MaterialParameterName, Param.Value);
            }

            // Vector Parameters
            for (const auto& Param : MaterialParameters.VectorParameters)
            {
                MID->SetVectorParameterValue(Param.MaterialParameterName, Param.Value);
            }

            // Texture Parameters
            for (const auto& Param : MaterialParameters.TextureParameters)
            {
                MID->SetTextureParameterValue(Param.MaterialParameterName, Param.Texture);
            }

            // Attribute Bindings (Per-Particle)
            // → Vertex Factory에서 처리 (GPU 버퍼 → Vertex Shader)
        }
    }
}
```

### Vertex Factory에서의 머티리얼 파라미터 전달

```hlsl
// NiagaraSpriteVertexFactory.ush
struct FVertexFactoryIntermediates
{
    float4 ParticleColor;
    float4 DynamicParameter0;
    float NormalizedAge;
    // ...
};

FVertexFactoryIntermediates GetVertexFactoryIntermediates(FVertexFactoryInput Input)
{
    FVertexFactoryIntermediates Intermediates;
    uint ParticleIndex = GetParticleIndex(Input.InstanceId);

    // GPU Buffer에서 Attribute 로드 (RendererLayout에 따라)
    Intermediates.ParticleColor = LoadFloat4(ParticleDataBuffer, ParticleIndex, ColorOffset);
    Intermediates.DynamicParameter0 = LoadFloat4(ParticleDataBuffer, ParticleIndex, DynamicParam0Offset);
    Intermediates.NormalizedAge = LoadFloat(ParticleDataBuffer, ParticleIndex, NormalizedAgeOffset);

    return Intermediates;
}

// Pixel Shader Input에 전달
struct FVertexFactoryInterpolantsVSToPS
{
    float4 ParticleColor : COLOR0;
    float4 DynamicParameter0 : TEXCOORD6;
    float NormalizedAge : TEXCOORD7;
};
```

---

## 📐 8. 정렬 시스템 (Sorting System)

### ENiagaraSortMode

```cpp
UENUM()
enum class ENiagaraSortMode : uint8
{
    None,                   // 정렬 안 함
    ViewDepth,              // 뷰 깊이 기준 정렬
    ViewDistance,           // 카메라 거리 기준 정렬
    CustomAscending,        // Custom Sorting Value 오름차순
    CustomDescending        // Custom Sorting Value 내림차순
};
```

### CPU 정렬 구현

```cpp
// FNiagaraRenderer::SortAndCullIndices()
int32 FNiagaraRenderer::SortAndCullIndices(
    const FNiagaraGPUSortInfo& SortInfo,
    const FNiagaraDataBuffer& Buffer,
    FGlobalDynamicReadBuffer::FAllocation& OutIndices)
{
    const int32 NumInstances = Buffer.GetNumInstances();
    if (NumInstances == 0) return 0;

    TArray<FSortKeyData> SortKeys;
    SortKeys.Reserve(NumInstances);

    for (int32 i = 0; i < NumInstances; ++i)
    {
        FSortKeyData KeyData;
        KeyData.InstanceIndex = i;

        switch (SortInfo.SortMode)
        {
            case ENiagaraSortMode::ViewDepth:
            {
                FVector WorldPos = Buffer.GetPosition(i);
                FVector ViewSpacePos = SortInfo.ViewMatrix.TransformPosition(WorldPos);
                KeyData.SortKey = ViewSpacePos.Z;
                break;
            }
            case ENiagaraSortMode::ViewDistance:
            {
                FVector WorldPos = Buffer.GetPosition(i);
                KeyData.SortKey = (WorldPos - SortInfo.ViewOrigin).SizeSquared();
                break;
            }
            case ENiagaraSortMode::CustomAscending:
            case ENiagaraSortMode::CustomDescending:
            {
                KeyData.SortKey = Buffer.GetCustomSortingValue(i);
                break;
            }
            default:
                KeyData.SortKey = i;
                break;
        }
        SortKeys.Add(KeyData);
    }

    // Descending (멀리 → 가까이, 알파 블렌딩용) 또는 Ascending
    if (SortInfo.SortMode == ENiagaraSortMode::CustomDescending ||
        SortInfo.SortMode == ENiagaraSortMode::ViewDepth)
    {
        SortKeys.Sort([](const FSortKeyData& A, const FSortKeyData& B)
        { return A.SortKey > B.SortKey; });
    }
    else
    {
        SortKeys.Sort([](const FSortKeyData& A, const FSortKeyData& B)
        { return A.SortKey < B.SortKey; });
    }

    // Index Buffer 생성
    OutIndices = DynamicReadBuffer.AllocateUInt32(NumInstances);
    uint32* Indices = (uint32*)OutIndices.Buffer;
    for (int32 i = 0; i < NumInstances; ++i)
    {
        Indices[i] = SortKeys[i].InstanceIndex;
    }
    return NumInstances;
}
```

### GPU 정렬 (Bitonic Sort)

GPU 시뮬레이션에서는 Compute Shader로 정렬합니다:

```hlsl
// NiagaraGPUSorting.usf
[numthreads(64, 1, 1)]
void GenerateSortKeysCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint ParticleIndex = DispatchThreadId.x;
    if (ParticleIndex >= NumParticles) return;

    float3 ParticlePosition = ParticlePositionBuffer[ParticleIndex];
    float ViewDepth = dot(ParticlePosition - ViewOrigin, ViewDirection);

    SortKeyBuffer[ParticleIndex] = ViewDepth;
    IndexBuffer[ParticleIndex] = ParticleIndex;
}

// Bitonic Sort Pass (여러 패스로 분할)
groupshared float SharedSortKeys[128];
groupshared uint SharedIndices[128];

[numthreads(64, 1, 1)]
void BitonicSortPassCS(uint3 GroupId : SV_GroupID,
                       uint3 GroupThreadId : SV_GroupThreadID)
{
    // Shared Memory로 로드 → Bitonic Merge Sort → Global Memory에 쓰기
    // Descending 정렬 (멀리 → 가까이, 반투명 블렌딩용)
    // ...
}
```

---

## 🔬 고급 렌더링 주제 (Advanced Rendering Topics)

### Custom Vertex Factory 구현

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraVertexFactory.h:64`

커스텀 Vertex Factory를 구현하여 Niagara에 새로운 렌더러를 추가할 수 있습니다:

**1. Vertex Factory 정의:**

```cpp
// MyCustomNiagaraVertexFactory.h
class FMyCustomNiagaraVertexFactory : public FNiagaraVertexFactoryBase
{
    DECLARE_VERTEX_FACTORY_TYPE(FMyCustomNiagaraVertexFactory);

public:
    struct FBatchParametersCPU
    {
        const uint8* ParameterData = nullptr;
        FRHIShaderResourceView* NiagaraParticleDataFloat = nullptr;
        FRHIShaderResourceView* NiagaraParticleDataHalf = nullptr;
        FRHIShaderResourceView* NiagaraParticleDataInt = nullptr;
        uint32 FloatDataStride = 0;
        uint32 HalfDataStride = 0;
        uint32 IntDataStride = 0;
    };

    // Vertex Factory Interface
    virtual void InitRHI(FRHICommandListBase& RHICmdList) override;
    static bool ShouldCompilePermutation(const FVertexFactoryShaderPermutationParameters& Parameters);
    static void ModifyCompilationEnvironment(const FVertexFactoryShaderPermutationParameters& Parameters,
                                              FShaderCompilerEnvironment& OutEnvironment);

    void SetBatchParameters(const FBatchParametersCPU& InParameters);

private:
    FBatchParametersCPU BatchParameters;
};
```

**2. Shader Implementation (.ush):**

```hlsl
// MyCustomNiagaraVertexFactory.ush
Buffer<float> NiagaraParticleDataFloat;
Buffer<float> NiagaraParticleDataHalf;
Buffer<int> NiagaraParticleDataInt;

uint FloatDataStride;
uint PositionOffset;
uint VelocityOffset;
uint ColorOffset;

struct FVertexFactoryInput
{
    uint InstanceId : SV_InstanceID;
    uint VertexId : SV_VertexID;
};

FVertexFactoryIntermediates GetVertexFactoryIntermediates(FVertexFactoryInput Input)
{
    FVertexFactoryIntermediates Intermediates;
    uint ParticleId = Input.InstanceId;
    uint FloatIndex = ParticleId * FloatDataStride;

    // Read Particle Data
    Intermediates.Position = float3(
        NiagaraParticleDataFloat[FloatIndex + PositionOffset + 0],
        NiagaraParticleDataFloat[FloatIndex + PositionOffset + 1],
        NiagaraParticleDataFloat[FloatIndex + PositionOffset + 2]
    );

    // ... Color, Velocity 등 동일하게 읽기

    return Intermediates;
}
```

### RayTracing 지원

```cpp
#if RHI_RAYTRACING
void FNiagaraRendererMeshes::GetDynamicRayTracingInstances(
    FRayTracingInstanceCollector& Collector,
    const FNiagaraSceneProxy* Proxy)
{
    if (!CVarRayTracingNiagara.GetValueOnRenderThread()) return;

    FNiagaraDynamicDataBase* DynamicData = GetDynamicData();
    if (!DynamicData) return;

    FNiagaraDataBuffer* ParticleData = DynamicData->GetParticleDataToRender();
    if (!ParticleData) return;

    const int32 NumInstances = ParticleData->GetNumInstances();

    for (const FNiagaraMeshRendererMeshProperties& MeshProps : Meshes)
    {
        UStaticMesh* Mesh = MeshProps.Mesh;
        if (!Mesh || !Mesh->GetRenderData()) continue;

        FRayTracingGeometry& RayTracingGeometry =
            Mesh->GetRenderData()->LODResources[0].RayTracingGeometry;

        for (int32 i = 0; i < NumInstances; ++i)
        {
            FRayTracingInstance RayTracingInstance;
            RayTracingInstance.Geometry = &RayTracingGeometry;
            RayTracingInstance.InstanceTransforms.Add(
                CalculateInstanceTransform(ParticleData, i, MeshProps));
            RayTracingInstance.Materials.Add(GetMaterialForInstance(i));
            RayTracingInstance.Mask = 0xFF;
            Collector.AddRayTracingInstance(MoveTemp(RayTracingInstance));
        }
    }
}
#endif // RHI_RAYTRACING
```

### Sprite/Mesh Alignment 및 Facing Enum 상세

**ENiagaraSpriteAlignment:**

```cpp
UENUM()
enum class ENiagaraSpriteAlignment : uint8
{
    Unaligned,          // Rotation만 영향
    VelocityAligned,    // Velocity 방향 정렬
    CustomAlignment,    // Particles.SpriteAlignment 속성 사용
    Automatic           // Binding 여부에 따라 자동 선택
};
```

**ENiagaraSpriteFacingMode:**

```cpp
UENUM()
enum class ENiagaraSpriteFacingMode : uint8
{
    FaceCamera,                 // 카메라 바라보기 (Up 축 유지)
    FaceCameraPlane,            // 카메라 평면과 완전 평행
    CustomFacingVector,         // Particles.SpriteFacing 벡터 사용
    FaceCameraPosition,         // 카메라 위치만 (회전 무시, 안정적)
    FaceCameraDistanceBlend,    // FaceCamera <-> FaceCameraPosition 혼합
    Automatic                   // Binding 여부에 따라 자동 선택
};
```

**ENiagaraMeshFacingMode:**

```cpp
UENUM()
enum class ENiagaraMeshFacingMode : uint8
{
    Default,           // Particles.MeshOrientation 사용
    Velocity,          // Velocity 방향 정렬
    CameraPosition,    // 카메라 위치 향함
    CameraPlane        // 카메라 평면에 가장 가까운 점 향함
};
```

**ENiagaraRendererSourceDataMode:**

```cpp
UENUM()
enum class ENiagaraRendererSourceDataMode : uint8
{
    Particles,   // 개별 파티클 렌더링
    Emitter      // Emitter 단위 단일 요소 렌더링
};
```

---

## ⚠️ 주의사항 및 안티패턴 (Common Pitfalls)

### 피해야 할 것

**1. GameThread에서 렌더링 데이터 직접 접근:**
```cpp
// WRONG - Thread Safety 위반
void MyFunction()
{
    FNiagaraRenderer* Renderer = GetRenderer();
    // CRASH! RenderThread 데이터
    Renderer->DynamicDataRender->SomeData = 123;
}
```

**2. 너무 많은 Material Parameter Binding:**
```cpp
// WRONG - 각 프레임마다 모든 파티클에 대해 처리
TArray<FNiagaraMaterialAttributeBinding> Bindings;  // 50개+
// Material에서 50개 Parameter 읽기 → 성능 저하
```

**3. Vertex Factory에서 복잡한 연산:**
```hlsl
// WRONG - Vertex Shader에서 너무 많은 계산
for (int i = 0; i < 100; ++i)  // 각 Vertex마다!
{
    // 복잡한 연산 → GPU 병목
}
```

### 올바른 방법

**1. ENQUEUE_RENDER_COMMAND 사용:**
```cpp
// CORRECT - RenderThread로 안전하게 전달
ENQUEUE_RENDER_COMMAND(UpdateRendererData)([Renderer, NewData](FRHICommandListImmediate& RHICmdList)
{
    Renderer->UpdateData(NewData);
});
```

**2. 필요한 Binding만 사용:**
```cpp
// CORRECT - 핵심 Parameter만 바인딩
FNiagaraMaterialAttributeBinding ColorBinding;
FNiagaraMaterialAttributeBinding SizeBinding;
```

**3. Simulation Stage에서 미리 계산:**
```hlsl
// CORRECT - Precompute & Lookup Table
// Simulation Stage: Particles.PrecomputedValue = ComplexFunction();
// Vertex Shader에서 단순히 읽기만:
float Value = NiagaraParticleDataFloat[Index + PrecomputedValueOffset];
```

---

## 🔧 디버깅 및 트러블슈팅 (Debugging & Troubleshooting)

### 일반적인 문제 해결

| 문제 | 원인 | 해결 방법 |
|------|------|----------|
| **파티클이 렌더링되지 않음** | 머티리얼이 Niagara용 플래그 미체크 | 머티리얼 Details에서 "Used with Niagara Sprites/Meshes/Ribbons" 체크 |
| **정렬이 작동하지 않음** | GPU Sim에서 정렬 미지원 (일부 모드) | CPU Sim 사용 또는 GPU 지원 정렬 모드 사용 |
| **Ribbon이 끊어짐** | RibbonID 바인딩 누락 | RibbonIdBinding 또는 RibbonLinkOrderBinding 설정 |
| **Mesh 렌더러가 느림** | 너무 많은 인스턴스 | Scalability 설정으로 인스턴스 수 제한 |
| **SubUV가 작동하지 않음** | SubImageSize 설정 누락 | SubImageSize를 텍스처 Grid에 맞게 설정 (예: 4x4) |
| **Material Parameter가 전달되지 않음** | Attribute 바인딩 누락 | MaterialParameters.AttributeBindings 설정 |

### Console Commands

| 명령어 | 설명 |
|--------|------|
| `fx.Niagara.Renderer.Enabled [0/1]` | 렌더링 활성화/비활성화 |
| `fx.Niagara.Renderer.DebugDrawBounds [0/1]` | 바운딩 박스 표시 |
| `fx.Niagara.Renderer.SortingEnabled [0/1]` | 정렬 활성화/비활성화 |
| `fx.Niagara.Debug.DrawEmitterBounds 1` | Emitter 바운드 표시 |
| `fx.Niagara.Debug.DrawRendererBounds 1` | Renderer 바운드 표시 |
| `r.RayTracing.Niagara [0/1]` | Niagara RayTracing 지원 |
| `fx.Niagara.Ribbon.Tessellation [0/1]` | Ribbon Tessellation 활성화 |
| `stat Particles` | 파티클 렌더링 통계 |
| `stat NiagaraGPU` | GPU 프로파일링 |
| `stat NiagaraGPUComputeDispatchers` | GPU Compute 통계 |
| `Niagara.RadixSortThreshold 400` | Radix Sort 임계값 조정 |

### Profiling

**CPU Profiling:**
```cpp
SCOPE_CYCLE_COUNTER(STAT_NiagaraRender);
SCOPE_CYCLE_COUNTER(STAT_NiagaraRenderSprites);
SCOPE_CYCLE_COUNTER(STAT_NiagaraRenderMeshes);
SCOPE_CYCLE_COUNTER(STAT_NiagaraRenderRibbons);
```
- `stat Particles` 명령어로 확인

**GPU Profiling:**
```
stat GPU
ProfileGPU
```
- "NiagaraRendering" Pass에서 렌더링 시간 측정

---

## 🔗 참조 자료 (References)

### 관련 문서
- **Ribbon/Mesh 렌더러 상세:** [Ribbon_and_Mesh_Rendering.md](Ribbon_and_Mesh_Rendering.md) - Ribbon 및 Mesh Renderer의 세부 사용 사례 및 주의사항

### 공식 문서
- [Unreal Engine Niagara Overview](https://docs.unrealengine.com/5.0/en-US/overview-of-niagara-effects-for-unreal-engine/)
- [Niagara Rendering Best Practices](https://docs.unrealengine.com/5.0/en-US/niagara-rendering-best-practices-in-unreal-engine/)
- [Niagara Visual Effects](https://docs.unrealengine.com/en-US/RenderingAndGraphics/Niagara/)
- [Material Editor](https://docs.unrealengine.com/en-US/RenderingAndGraphics/Materials/Editor/)

### 소스 코드 위치
- **Renderer Properties:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererProperties.h`
- **Renderer Base:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRenderer.h`
- **Scene Proxy:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSceneProxy.h`
- **Sprite Renderer:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererSprites.h`
- **Mesh Renderer:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererMeshes.h`
- **Ribbon Renderer:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraRendererRibbons.h`
- **Sprite Vertex Factory:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraSpriteVertexFactory.h`
- **Mesh Vertex Factory:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraMeshVertexFactory.h`
- **Vertex Factory Base:** `Engine/Plugins/FX/Niagara/Source/NiagaraVertexFactories/Public/NiagaraVertexFactory.h`

### Shader 파일
- `Engine/Plugins/FX/Niagara/Shaders/Private/NiagaraSpriteVertexFactory.ush` - Sprite VF Shader
- `Engine/Plugins/FX/Niagara/Shaders/Private/NiagaraRibbonVertexFactory.ush` - Ribbon VF Shader

---

> 🔄 Updated: 2026-02-18 — Rendering_and_Materials.md, Advanced_Rendering_Topics.md 내용을 통합
>
> **🔄 업데이트:** 2025-01-XX — Niagara 렌더링 파이프라인 전체 분석 완료 (UE 5.7 기준)
