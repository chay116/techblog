---
title: "RDG 실전 사용 예시 (Practical Examples)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "RenderGraph"]
---
# RDG 실전 사용 예시 (Practical Examples)

> **연관 문서:**
> - [Architecture.md](./Architecture.md) - RDG 전체 아키텍처 개요
> - [ResourceManagement.md](./ResourceManagement.md) - 리소스 생명주기 및 메모리 관리
> - [PassExecution.md](./PassExecution.md) - 패스 실행 및 배리어 관리

---

## 📚 목차

- [레벨 1: 간단한 Compute Shader Pass](#레벨-1-간단한-compute-shader-pass)
- [레벨 2: 텍스처 생성 및 처리](#레벨-2-텍스처-생성-및-처리)
- [레벨 3: 외부 리소스 통합](#레벨-3-외부-리소스-통합)
- [레벨 4: Pass 병합 최적화](#레벨-4-pass-병합-최적화)
- [레벨 5: 비동기 컴퓨트 활용](#레벨-5-비동기-컴퓨트-활용)
- [레벨 6: 실전 사례 - Lumen SSGI](#레벨-6-실전-사례---lumen-ssgi)
- [실전 팁 모음](#실전-팁-모음)

---

## 💻 레벨 1: 간단한 Compute Shader Pass

가장 기본적인 RDG 사용 예시는 **Compute Shader로 텍스처 처리**하는 것입니다.

### 예시: 텍스처 Clear Pass

```cpp
// 📂 위치: Engine/Source/Runtime/RenderCore/Public/RenderGraphUtils.h:ClearUAVPass

void AddClearUAVPass(FRDGBuilder& GraphBuilder, FRDGTextureUAVRef TextureUAV, const FVector4& ClearValue)
{
    // 1. Pass 파라미터 구조체 정의
    struct FClearUAVParameters
    {
        FRDGTextureUAVRef TextureUAV;  // 출력 UAV
    };

    // 2. 파라미터 할당 (RDG가 생명주기 관리)
    FClearUAVParameters* PassParameters = GraphBuilder.AllocParameters<FClearUAVParameters>();
    PassParameters->TextureUAV = TextureUAV;

    // 3. Compute Shader 가져오기
    TShaderMapRef<FClearTextureCS> ComputeShader(GetGlobalShaderMap(ERHIFeatureLevel::SM5));

    // 4. Pass 추가
    FComputeShaderUtils::AddPass(
        GraphBuilder,
        RDG_EVENT_NAME("ClearTexture"),           // 디버그 이름
        ERDGPassFlags::Compute,                    // Compute Pass
        ComputeShader,
        PassParameters,
        FIntVector(DivideAndRoundUp(1920, 8), DivideAndRoundUp(1080, 8), 1)  // Group count
    );
}
```

**핵심 포인트:**
- `GraphBuilder.AllocParameters()`: RDG가 메모리 관리
- `FComputeShaderUtils::AddPass()`: Compute Shader 전용 헬퍼
- `RDG_EVENT_NAME()`: RenderDoc/PIX에 표시될 이름
- 리소스 생성 없음 → UAV만 전달

---

## 레벨 2: 텍스처 생성 및 처리

### 예시: 다운샘플 Pass

```cpp
// 📂 실제 사용: Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessDownsample.cpp

FScreenPassTexture AddDownsamplePass(
    FRDGBuilder& GraphBuilder,
    const FViewInfo& View,
    FScreenPassTexture Input)
{
    // ----1. 출력 텍스처 생성----

    FRDGTextureDesc OutputDesc = Input.Texture->Desc;
    OutputDesc.Extent = Input.ViewRect.Size() / 2;  // 절반 크기
    OutputDesc.Format = PF_FloatRGBA;

    FRDGTextureRef OutputTexture = GraphBuilder.CreateTexture(
        OutputDesc,
        TEXT("DownsampledTexture")  // 디버그 이름
    );

    // ----2. Pass 파라미터 설정----

    FDownsamplePS::FParameters* PassParameters = GraphBuilder.AllocParameters<FDownsamplePS::FParameters>();
    PassParameters->InputTexture = Input.Texture;
    PassParameters->InputSampler = TStaticSamplerState<SF_Bilinear>::GetRHI();
    PassParameters->RenderTargets[0] = FRenderTargetBinding(
        OutputTexture,
        ERenderTargetLoadAction::ENoAction  // 이전 내용 무시
    );

    // ----3. Shader 가져오기----

    TShaderMapRef<FScreenPassVS> VertexShader(View.ShaderMap);
    TShaderMapRef<FDownsamplePS> PixelShader(View.ShaderMap);

    // ----4. Pass 추가 (Raster)----

    GraphBuilder.AddPass(
        RDG_EVENT_NAME("Downsample 2x2"),
        PassParameters,
        ERDGPassFlags::Raster,  // 래스터 패스
        [VertexShader, PixelShader, PassParameters, OutputDesc](FRHICommandList& RHICmdList)
        {
            // 뷰포트 설정
            RHICmdList.SetViewport(0, 0, 0.0f, OutputDesc.Extent.X, OutputDesc.Extent.Y, 1.0f);

            // PSO 설정
            FGraphicsPipelineStateInitializer GraphicsPSOInit;
            RHICmdList.ApplyCachedRenderTargets(GraphicsPSOInit);
            GraphicsPSOInit.BlendState = TStaticBlendState<>::GetRHI();
            GraphicsPSOInit.RasterizerState = TStaticRasterizerState<>::GetRHI();
            GraphicsPSOInit.DepthStencilState = TStaticDepthStencilState<false, CF_Always>::GetRHI();
            GraphicsPSOInit.BoundShaderState.VertexDeclarationRHI = GFilterVertexDeclaration.VertexDeclarationRHI;
            GraphicsPSOInit.BoundShaderState.VertexShaderRHI = VertexShader.GetVertexShader();
            GraphicsPSOInit.BoundShaderState.PixelShaderRHI = PixelShader.GetPixelShader();
            GraphicsPSOInit.PrimitiveType = PT_TriangleList;

            SetGraphicsPipelineState(RHICmdList, GraphicsPSOInit, 0);

            // Shader 파라미터 바인딩
            SetShaderParameters(RHICmdList, PixelShader, PixelShader.GetPixelShader(), *PassParameters);

            // Fullscreen 삼각형 그리기
            DrawRectangle(
                RHICmdList,
                0, 0,                          // DestX, DestY
                OutputDesc.Extent.X, OutputDesc.Extent.Y,  // DestWidth, DestHeight
                0, 0,                          // SrcX, SrcY
                1, 1,                          // SrcWidth, SrcHeight
                FIntPoint(OutputDesc.Extent.X, OutputDesc.Extent.Y),  // TargetSize
                FIntPoint(1, 1),               // TextureSize
                VertexShader,
                EDRF_UseTriangleOptimization
            );
        }
    );

    // ----5. 결과 반환----

    return FScreenPassTexture(OutputTexture, FIntRect(FIntPoint::ZeroValue, OutputDesc.Extent));
}
```

**핵심 포인트:**
- `CreateTexture()` → 즉시 할당 안 됨 (Execute 시점에 할당)
- `RenderTargets[0]` → Pass가 어떤 RT에 쓰는지 명시
- 람다 내부 → 실제 렌더링 코드 (BeginRenderPass는 RDG가 자동 호출)
- 반환값 → 다음 Pass의 입력으로 사용 가능

---

## 레벨 3: 외부 리소스 통합

### 예시: TAA (Temporal Anti-Aliasing)

```cpp
// 📂 실제 사용: Engine/Source/Runtime/Renderer/Private/PostProcess/TemporalAA.cpp

FScreenPassTexture AddTemporalAAPass(
    FRDGBuilder& GraphBuilder,
    const FViewInfo& View,
    FScreenPassTexture SceneColor,
    FScreenPassTexture SceneDepth)
{
    // ----1. History 버퍼 가져오기 (외부 리소스)----

    TRefCountPtr<IPooledRenderTarget> PrevHistoryRT;
    if (View.ViewState && View.ViewState->PrevFrameViewInfo.TemporalAAHistory.IsValid())
    {
        PrevHistoryRT = View.ViewState->PrevFrameViewInfo.TemporalAAHistory.RT[0];
    }

    FRDGTextureRef HistoryTexture = nullptr;
    if (PrevHistoryRT.IsValid())
    {
        // 외부 리소스 등록
        HistoryTexture = GraphBuilder.RegisterExternalTexture(PrevHistoryRT, TEXT("PrevHistory"));
    }
    else
    {
        // History 없으면 검은색 텍스처 생성
        HistoryTexture = GraphBuilder.RegisterExternalTexture(GSystemTextures.BlackDummy);
    }

    // ----2. 새로운 History 버퍼 생성----

    FRDGTextureDesc NewHistoryDesc = SceneColor.Texture->Desc;
    NewHistoryDesc.Flags |= TexCreate_UAV;
    FRDGTextureRef NewHistoryTexture = GraphBuilder.CreateTexture(NewHistoryDesc, TEXT("NewHistory"));

    // ----3. TAA Pass 추가----

    FTAAPassParameters* PassParameters = GraphBuilder.AllocParameters<FTAAPassParameters>();
    PassParameters->SceneColorTexture = SceneColor.Texture;
    PassParameters->SceneDepthTexture = SceneDepth.Texture;
    PassParameters->HistoryTexture = HistoryTexture;
    PassParameters->VelocityTexture = GetVelocityTexture(GraphBuilder, View);
    PassParameters->OutputTexture = GraphBuilder.CreateUAV(NewHistoryTexture);

    TShaderMapRef<FTemporalAACS> ComputeShader(View.ShaderMap);

    FComputeShaderUtils::AddPass(
        GraphBuilder,
        RDG_EVENT_NAME("TAA %dx%d", View.ViewRect.Width(), View.ViewRect.Height()),
        ComputeShader,
        PassParameters,
        FComputeShaderUtils::GetGroupCount(View.ViewRect.Size(), 8)
    );

    // ----4. History 추출 (다음 프레임용)----

    TRefCountPtr<IPooledRenderTarget>* OutputHistoryRT = &View.ViewState->PrevFrameViewInfo.TemporalAAHistory.RT[0];
    GraphBuilder.QueueTextureExtraction(NewHistoryTexture, OutputHistoryRT);

    return FScreenPassTexture(NewHistoryTexture, View.ViewRect);
}
```

**핵심 포인트:**
- `RegisterExternalTexture()` → 이전 프레임 History 등록
- `QueueTextureExtraction()` → **다음 프레임**을 위해 추출 (지연 실행!)
- History 버퍼 → RDG가 생명주기 관리 못 함 (외부 관리)

---

## 레벨 4: Pass 병합 최적화

### 예시: G-Buffer 렌더링 (BasePass + Decals)

```cpp
// 📂 개념: 여러 Pass가 같은 RT 사용 → 자동 병합

void RenderGBuffer(FRDGBuilder& GraphBuilder, FViewInfo& View)
{
    // ----1. G-Buffer 생성----

    FRDGTextureRef GBufferA = GraphBuilder.CreateTexture(..., TEXT("GBufferA"));
    FRDGTextureRef GBufferB = GraphBuilder.CreateTexture(..., TEXT("GBufferB"));
    FRDGTextureRef GBufferC = GraphBuilder.CreateTexture(..., TEXT("GBufferC"));
    FRDGTextureRef SceneDepth = GraphBuilder.CreateTexture(..., TEXT("SceneDepth"));

    // ----2. BasePass (불투명 지오메트리)----

    {
        FBasePassParameters* PassParameters = GraphBuilder.AllocParameters<FBasePassParameters>();
        PassParameters->RenderTargets[0] = FRenderTargetBinding(GBufferA, ERenderTargetLoadAction::EClear);
        PassParameters->RenderTargets[1] = FRenderTargetBinding(GBufferB, ERenderTargetLoadAction::EClear);
        PassParameters->RenderTargets[2] = FRenderTargetBinding(GBufferC, ERenderTargetLoadAction::EClear);
        PassParameters->RenderTargets.DepthStencil = FDepthStencilBinding(
            SceneDepth,
            ERenderTargetLoadAction::EClear,
            ERenderTargetLoadAction::EClear,
            FExclusiveDepthStencil::DepthWrite_StencilWrite
        );

        GraphBuilder.AddPass(
            RDG_EVENT_NAME("BasePass"),
            PassParameters,
            ERDGPassFlags::Raster,
            [&View](FRHICommandList& RHICmdList)
            {
                DrawDynamicMeshPass(View, RHICmdList, ...);
            }
        );
    }

    // ----3. Decals Pass (같은 RT 사용!)----

    {
        FDecalPassParameters* PassParameters = GraphBuilder.AllocParameters<FDecalPassParameters>();
        PassParameters->RenderTargets[0] = FRenderTargetBinding(GBufferA, ERenderTargetLoadAction::ELoad);  // ← Load!
        PassParameters->RenderTargets[1] = FRenderTargetBinding(GBufferB, ERenderTargetLoadAction::ELoad);
        PassParameters->RenderTargets[2] = FRenderTargetBinding(GBufferC, ERenderTargetLoadAction::ELoad);
        PassParameters->RenderTargets.DepthStencil = FDepthStencilBinding(
            SceneDepth,
            ERenderTargetLoadAction::ELoad,
            ERenderTargetLoadAction::ELoad,
            FExclusiveDepthStencil::DepthRead_StencilRead
        );

        GraphBuilder.AddPass(
            RDG_EVENT_NAME("Decals"),
            PassParameters,
            ERDGPassFlags::Raster,
            [&View](FRHICommandList& RHICmdList)
            {
                DrawDecals(View, RHICmdList, ...);
            }
        );
    }

    // ✅ RDG가 자동으로 병합:
    // BeginRenderPass(GBuffer) → BasePass → Decals → EndRenderPass()
    // (BeginRenderPass가 1번만 호출됨!)
}
```

**병합 조건:**
1. 연속된 Raster Pass
2. 동일한 RenderTargets 사용
3. 중간에 읽기 의존성 없음 (둘 다 쓰기만)

---

## 레벨 5: 비동기 컴퓨트 활용

### 예시: SSAO (Screen Space Ambient Occlusion)

```cpp
// 📂 실제 사용: Engine/Source/Runtime/Renderer/Private/CompositionLighting/PostProcessAmbientOcclusion.cpp

FRDGTextureRef AddSSAOPass(
    FRDGBuilder& GraphBuilder,
    const FViewInfo& View,
    FRDGTextureRef SceneDepth,
    FRDGTextureRef SceneNormal)
{
    // ----1. AO 텍스처 생성----

    FRDGTextureDesc AODesc = FRDGTextureDesc::Create2D(
        View.ViewRect.Size() / 2,  // 절반 해상도
        PF_G8,
        FClearValueBinding::White,
        TexCreate_UAV | TexCreate_ShaderResource
    );
    FRDGTextureRef RawAO = GraphBuilder.CreateTexture(AODesc, TEXT("RawAO"));

    // ----2. SSAO Compute Pass (AsyncCompute!)----

    {
        FSSAOComputeParameters* PassParameters = GraphBuilder.AllocParameters<FSSAOComputeParameters>();
        PassParameters->SceneDepth = SceneDepth;
        PassParameters->SceneNormal = SceneNormal;
        PassParameters->Output = GraphBuilder.CreateUAV(RawAO);

        TShaderMapRef<FSSAOComputeShader> ComputeShader(View.ShaderMap);

        FComputeShaderUtils::AddPass(
            GraphBuilder,
            RDG_EVENT_NAME("SSAO Compute"),
            ERDGPassFlags::AsyncCompute,  // ← 비동기 컴퓨트!
            ComputeShader,
            PassParameters,
            FComputeShaderUtils::GetGroupCount(AODesc.Extent, 8)
        );
    }

    // ----3. Bilateral Filter (Graphics Pipeline)----
    // RDG가 자동으로 Fence 삽입!

    {
        FRDGTextureRef FilteredAO = GraphBuilder.CreateTexture(AODesc, TEXT("FilteredAO"));

        FSSAOFilterParameters* PassParameters = GraphBuilder.AllocParameters<FSSAOFilterParameters>();
        PassParameters->RawAO = RawAO;  // ← AsyncCompute 결과 읽기
        PassParameters->RenderTargets[0] = FRenderTargetBinding(FilteredAO, ERenderTargetLoadAction::ENoAction);

        GraphBuilder.AddPass(
            RDG_EVENT_NAME("SSAO Filter"),
            PassParameters,
            ERDGPassFlags::Raster,  // ← Graphics Pipeline
            [](FRHICommandList& RHICmdList)
            {
                // Bilateral filter shader 실행
            }
        );

        return FilteredAO;
    }

    // RDG가 자동 처리:
    // Graphics: Depth/Normal 생성 → Fork
    // AsyncCompute: SSAO 계산 (병렬 실행) → Join
    // Graphics: Filter (동기화 후 실행)
}
```

**자동 동기화:**
```
Timeline:
│
Graphics: ───[Depth/Normal]────────────────────[Filter]────
                      ↓ Fork                   ↑ Join (Fence)
AsyncCompute: ────────────[SSAO Compute]───────┘

RDG가 자동 삽입:
- Fork: EpilogueBarrierToBeginForAsyncCompute (Fence 생성)
- Join: PrologueBarriersToEnd (Fence 대기)
```

---

## 레벨 6: 실전 사례 - Lumen SSGI

### 📂 위치: `Engine/Source/Runtime/Renderer/Private/Lumen/LumenScreenProbeGather.cpp`

```cpp
void RenderLumenScreenProbeGather(
    FRDGBuilder& GraphBuilder,
    const FViewInfo& View,
    const FLumenSceneData& LumenSceneData,
    FRDGTextureRef SceneDepth,
    FRDGTextureRef SceneColor,
    FLumenScreenProbeGatherParameters& ScreenProbeParameters)
{
    // ----1. Probe 배치 (1/16 해상도)----

    const FIntPoint ProbeResolution = View.ViewRect.Size() / 16;

    FRDGTextureDesc ProbeDesc = FRDGTextureDesc::Create2D(
        ProbeResolution,
        PF_FloatRGBA,
        FClearValueBinding::Black,
        TexCreate_UAV | TexCreate_ShaderResource
    );

    FRDGTextureRef ScreenProbeRadiance = GraphBuilder.CreateTexture(ProbeDesc, TEXT("ScreenProbeRadiance"));

    // ----2. Trace Screen Probes (Compute)----

    {
        FScreenProbeTraceParameters* PassParameters = GraphBuilder.AllocParameters<FScreenProbeTraceParameters>();
        PassParameters->View = View.ViewUniformBuffer;
        PassParameters->SceneTextures = GetSceneTextureParameters(GraphBuilder, View);
        PassParameters->LumenCardScene = LumenSceneData.GetCardSceneUniformBuffer(GraphBuilder);
        PassParameters->SceneDepth = SceneDepth;
        PassParameters->RadianceProbeAtlasTexture = LumenSceneData.RadianceProbeAtlasTexture;
        PassParameters->ProbeRadianceOutput = GraphBuilder.CreateUAV(ScreenProbeRadiance);

        TShaderMapRef<FScreenProbeTraceCS> ComputeShader(View.ShaderMap);

        FComputeShaderUtils::AddPass(
            GraphBuilder,
            RDG_EVENT_NAME("ScreenProbeTrace %dx%d Probes=%d", ProbeResolution.X, ProbeResolution.Y, ProbeResolution.X * ProbeResolution.Y),
            ComputeShader,
            PassParameters,
            FComputeShaderUtils::GetGroupCount(ProbeResolution, 8)
        );
    }

    // ----3. Temporal Filter (이전 프레임 History 사용)----

    FRDGTextureRef FilteredRadiance = AddTemporalFilterPass(
        GraphBuilder,
        View,
        ScreenProbeRadiance,
        SceneDepth
    );

    // ----4. Spatial Filter----

    FRDGTextureRef SpatialFilteredRadiance = AddSpatialFilterPass(
        GraphBuilder,
        View,
        FilteredRadiance,
        SceneDepth
    );

    // ----5. Upsample to Full Resolution (1/16 → 1/1)----

    {
        FRDGTextureRef FullResGI = GraphBuilder.CreateTexture(
            FRDGTextureDesc::Create2D(View.ViewRect.Size(), PF_FloatRGB, FClearValueBinding::Black, TexCreate_RenderTargetable),
            TEXT("LumenGI")
        );

        FScreenProbeUpsampleParameters* PassParameters = GraphBuilder.AllocParameters<FScreenProbeUpsampleParameters>();
        PassParameters->ProbeRadiance = SpatialFilteredRadiance;
        PassParameters->SceneDepth = SceneDepth;
        PassParameters->RenderTargets[0] = FRenderTargetBinding(FullResGI, ERenderTargetLoadAction::ENoAction);

        TShaderMapRef<FScreenPassVS> VertexShader(View.ShaderMap);
        TShaderMapRef<FScreenProbeUpsamplePS> PixelShader(View.ShaderMap);

        GraphBuilder.AddPass(
            RDG_EVENT_NAME("ScreenProbeUpsample"),
            PassParameters,
            ERDGPassFlags::Raster,
            [VertexShader, PixelShader, PassParameters, &View](FRHICommandList& RHICmdList)
            {
                RHICmdList.SetViewport(0, 0, 0.0f, View.ViewRect.Width(), View.ViewRect.Height(), 1.0f);

                FGraphicsPipelineStateInitializer GraphicsPSOInit;
                RHICmdList.ApplyCachedRenderTargets(GraphicsPSOInit);
                GraphicsPSOInit.BlendState = TStaticBlendState<>::GetRHI();
                GraphicsPSOInit.RasterizerState = TStaticRasterizerState<>::GetRHI();
                GraphicsPSOInit.DepthStencilState = TStaticDepthStencilState<false, CF_Always>::GetRHI();

                GraphicsPSOInit.BoundShaderState.VertexDeclarationRHI = GFilterVertexDeclaration.VertexDeclarationRHI;
                GraphicsPSOInit.BoundShaderState.VertexShaderRHI = VertexShader.GetVertexShader();
                GraphicsPSOInit.BoundShaderState.PixelShaderRHI = PixelShader.GetPixelShader();
                GraphicsPSOInit.PrimitiveType = PT_TriangleList;

                SetGraphicsPipelineState(RHICmdList, GraphicsPSOInit, 0);
                SetShaderParameters(RHICmdList, PixelShader, PixelShader.GetPixelShader(), *PassParameters);

                DrawRectangle(RHICmdList, 0, 0, View.ViewRect.Width(), View.ViewRect.Height(),
                    0, 0, 1, 1, View.ViewRect.Size(), FIntPoint(1, 1), VertexShader, EDRF_UseTriangleOptimization);
            }
        );

        ScreenProbeParameters.DiffuseIndirect = FullResGI;
    }
}
```

**복잡한 파이프라인 요약:**
1. **Trace** (Compute) → 32 rays/probe, 1/16 해상도
2. **Temporal Filter** (Compute) → History 활용
3. **Spatial Filter** (Compute) → Bilateral blur
4. **Upsample** (Raster) → 1/16 → Full resolution

**RDG 이점:**
- 5개 Pass, 10개 이상의 텍스처 → RDG가 자동 관리
- History 추출 → `QueueTextureExtraction()` 한 줄
- 배리어 → 자동 삽입 (수동 작성 시 50줄+)

---

## 실전 팁 모음

### Tip 1: 무참조 리소스 경고 제거

```cpp
// ❌ 경고 발생: "Texture was created but never used"
FRDGTextureRef UnusedTexture = GraphBuilder.CreateTexture(...);
// → 아무 Pass에서도 참조 안 함

// ✅ 해결 1: 의도적으로 미사용이면 경고 제거
GraphBuilder.RemoveUnusedTextureWarning(UnusedTexture);

// ✅ 해결 2: Dummy Pass 추가 (비추천)
// ...
```

### Tip 2: 리소스 재사용 패턴

```cpp
FRDGTextureRef Ping = GraphBuilder.CreateTexture(..., TEXT("Ping"));
FRDGTextureRef Pong = GraphBuilder.CreateTexture(..., TEXT("Pong"));

for (int Iteration = 0; Iteration < 4; ++Iteration)
{
    // Ping → Pong
    AddBlurPass(GraphBuilder, Ping, Pong, true);
    // Pong → Ping
    AddBlurPass(GraphBuilder, Pong, Ping, false);
}

// ✅ Ping/Pong 패턴 → Transient aliasing 최대 활용
```

### Tip 3: 조건부 Pass 추가

```cpp
if (CVarEnableSSAO.GetValueOnRenderThread() > 0)
{
    FRDGTextureRef AO = AddSSAOPass(GraphBuilder, ...);
    // AO 사용...
}
else
{
    // SSAO Pass 자체가 추가 안 됨 → 비용 0
}

// ✅ 조건문으로 Pass 제어 가능
```

### Tip 4: 디버깅 - Immediate Mode

```
// 콘솔 명령
r.RDG.ImmediateMode 1

// 효과:
// - AddPass() 즉시 Execute() 호출
// - 크래시 시 AddPass() 호출 스택 유지
// - 디버깅 후 반드시 0으로 복원!
```

### Tip 5: Pass 병합 확인

```
// 콘솔 명령
r.RDG.DumpGraph 1

// 출력: D:\UnrealEngine5.7\Saved\RenderGraphs\Frame_XXXX.dot
// Graphviz로 열어서 Pass 병합 여부 확인
// "MergedRenderPass" 노드로 표시됨
```

---

## 🔗 참고 자료

### 실제 사용 사례 소스 위치

```
Engine/Source/Runtime/Renderer/Private/
├── PostProcess/
│   ├── PostProcessDownsample.cpp        ; 다운샘플 예시
│   ├── TemporalAA.cpp                   ; TAA (외부 리소스)
│   └── PostProcessAmbientOcclusion.cpp  ; SSAO (비동기 컴퓨트)
├── Lumen/
│   └── LumenScreenProbeGather.cpp       ; Lumen SSGI (복합 파이프라인)
└── DeferredShadingRenderer.cpp          ; G-Buffer 렌더링
```

### 헬퍼 함수 위치

```
Engine/Source/Runtime/RenderCore/Public/
├── RenderGraphUtils.h                   ; Clear, Copy 등 유틸리티
├── ScreenPass.h                         ; FScreenPassTexture 구조체
└── ComputeShaderUtils.h                 ; FComputeShaderUtils::AddPass
```

---

> **이전 문서:**
> - [Architecture.md](./Architecture.md) - 설계 철학 및 전체 아키텍처
> - [ResourceManagement.md](./ResourceManagement.md) - 리소스 생명주기
> - [PassExecution.md](./PassExecution.md) - 패스 실행 및 배리어
