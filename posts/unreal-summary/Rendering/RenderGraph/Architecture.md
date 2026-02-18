---
title: "RDG (Render Dependency Graph) Architecture Deep Dive"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "RenderGraph"]
---
# RDG (Render Dependency Graph) Architecture Deep Dive

## 📚 문서 구조

이 문서는 RDG 아키텍처의 개요와 설계 철학을 다룹니다. 상세한 내용은 아래 문서들을 참고하세요:

- **[ResourceManagement.md](./ResourceManagement.md)** - 리소스 생명주기, Aliasing, External 리소스 관리
- **[PassExecution.md](./PassExecution.md)** - 패스 실행, 배리어 관리, 비동기 컴퓨트 동기화
- **[Examples.md](./Examples.md)** - 레벨별 실전 사용 예시 (6단계)

---

## 🧭 1. 설계 철학 (Design Philosophy)

### 1.1 RDG의 탄생 배경

RDG(Render Dependency Graph)는 **Frostbite 엔진의 FrameGraph**에서 영감을 받아 UE 4.22에서 도입된 현대적인 렌더링 프레임워크입니다.

#### 기존 Immediate Mode의 한계

```cpp
// ❌ 기존 방식 (Immediate Mode Rendering)
void RenderScene_Old()
{
    // 1. 수동 리소스 생성
    FRHITexture* SceneColor = RHICreateTexture(...);
    FRHITexture* SceneDepth = RHICreateTexture(...);
    FRHITexture* GBuffer = RHICreateTexture(...);

    // 2. 수동 배리어 삽입
    RHICmdList.TransitionResource(SceneColor, EResourceState::RenderTarget);

    // 3. 렌더링
    RHICmdList.BeginRenderPass(...);
    DrawScene();
    RHICmdList.EndRenderPass();

    // 4. 수동 배리어
    RHICmdList.TransitionResource(SceneColor, EResourceState::PixelShaderResource);

    // 5. 다음 패스...
    // 문제: 리소스가 항상 메모리에 상주 (낭비)
    //       배리어를 깜빡하면 크래시/아티팩트
    //       최적화 불가능 (컴파일러가 전체 흐름을 모름)
}
```

**문제점:**
- **메모리 낭비:** 모든 리소스를 프레임 내내 할당
- **수동 동기화:** 개발자가 배리어를 직접 관리 → 버그 위험
- **최적화 불가:** 사용하지 않는 패스도 무조건 실행
- **가독성 저하:** 렌더링 로직과 리소스 관리가 뒤섞임

#### RDG의 핵심 설계 원칙

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      RDG 설계 3대 원칙                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 지연 실행 (Deferred Execution)                                       │
│     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│     Setup Phase → Compile Phase → Execute Phase                        │
│     • 패스 등록: 무엇을 할지만 선언                                       │
│     • 컴파일: 의존성 분석, 최적화                                        │
│     • 실행: 최적화된 순서로 실제 렌더링                                  │
│                                                                         │
│  2. 자동 리소스 관리 (Automatic Resource Management)                    │
│     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│     개발자는 입출력만 선언 → RDG가 생명주기 관리                          │
│     • Transient Resource Aliasing (메모리 재사용)                       │
│     • 사용하지 않는 리소스 자동 제거                                     │
│     • 풀링을 통한 할당/해제 비용 절감                                    │
│                                                                         │
│  3. 자동 동기화 (Automatic Synchronization)                              │
│     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│     배리어를 수동으로 삽입할 필요 없음                                   │
│     • 리소스 상태 추적 (Read, Write, RenderTarget, ...)                 │
│     • 의존성 기반 자동 배리어 삽입                                       │
│     • 비동기 컴퓨트 동기화 자동 처리                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 RDG의 핵심 장점

| 측면 | 기존 방식 (Immediate) | RDG 방식 (Deferred) |
|------|---------------------|-------------------|
| **메모리 사용** | 모든 리소스 항상 할당 | Aliasing으로 50-70% 절감 |
| **개발 생산성** | 배리어 수동 관리 필요 | 입출력만 선언 |
| **디버깅** | 크래시 시 원인 파악 어려움 | RenderDoc/PIX 완벽 통합 |
| **최적화** | 수동 최적화 필요 | 자동 패스 컬링, 병합 |
| **비동기 컴퓨트** | 복잡한 수동 동기화 | 자동 Fork/Join |

### 1.3 RDG 기본 사용 예시

```cpp
// ✅ RDG 방식 (Deferred Execution)
void RenderScene_RDG(FRDGBuilder& GraphBuilder)
{
    // 1. 리소스 선언 (아직 생성 안 됨)
    FRDGTextureDesc Desc = FRDGTextureDesc::Create2D(
        ViewSize,
        PF_FloatRGBA,
        FClearValueBinding::Black,
        TexCreate_RenderTargetable | TexCreate_ShaderResource
    );
    FRDGTextureRef SceneColor = GraphBuilder.CreateTexture(Desc, TEXT("SceneColor"));

    // 2. 패스 등록 (람다로 실행 코드 지연)
    FMyPassParameters* PassParams = GraphBuilder.AllocParameters<FMyPassParameters>();
    PassParams->RenderTargets[0] = FRenderTargetBinding(SceneColor, ERenderTargetLoadAction::EClear);

    GraphBuilder.AddPass(
        RDG_EVENT_NAME("MyRenderPass"),
        PassParams,
        ERDGPassFlags::Raster,
        [](FRHICommandList& RHICmdList, FMyPassParameters* Params)
        {
            // 실제 렌더링 코드 (Execute 시점에 실행됨)
            DrawMyScene(RHICmdList, Params);
        }
    );

    // 3. 결과 추출 (외부에서 사용하려면)
    GraphBuilder.QueueTextureExtraction(SceneColor, &OutSceneColor);

    // 4. 실행 (여기서 비로소 리소스 생성 및 렌더링)
    GraphBuilder.Execute();
}
```

**핵심 차이:**
- **선언적 프로그래밍:** "무엇을 할지"만 선언
- **지연 실행:** Execute() 호출 시 최적화 후 실행
- **자동 관리:** 리소스 생성, 배리어, 동기화 모두 자동

---

## 🧱 2. 전체 아키텍처 개요 (Architecture Overview)

### 2.1 FRDGBuilder 실행 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FRDGBuilder 실행 파이프라인                          │
└─────────────────────────────────────────────────────────────────────────┘

   Setup Phase              Compile Phase             Execute Phase
   ───────────              ─────────────             ─────────────

 ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
 │ AddPass()   │          │ Compile()   │          │ Execute()   │
 │ (여러 번)   │  ──────→ │ (1회)       │  ──────→ │ (1회)       │
 └─────────────┘          └─────────────┘          └─────────────┘
       ↓                        ↓                        ↓
  패스 등록               최적화/컴파일              실제 렌더링
       │                        │                        │
       ├─ CreateTexture()       ├─ CullPassesMarker()   ├─ BeginResourceRHI()
       ├─ CreateBuffer()        ├─ MergePasses()        ├─ SubmitBufferUploads()
       ├─ QueueExtraction()     ├─ CollectBarriers()    ├─ ExecutePass()
       └─ AddPass()             ├─ CreateBarriers()     │   ├─ Prologue
                                └─ SetupParallelExecute()│   ├─ Lambda()
                                                         │   └─ Epilogue
                                                         ├─ EndResourceRHI()
                                                         └─ AddEpilogueTransition()
```

### 2.2 FRDGBuilder 주요 단계 상세

#### Setup Phase (패스 등록)

```cpp
void SetupRenderGraph(FRDGBuilder& GraphBuilder)
{
    // 1. 리소스 생성 (선언만, 실제 할당 안 됨)
    FRDGTextureRef DepthBuffer = GraphBuilder.CreateTexture(...);
    FRDGTextureRef GBufferA = GraphBuilder.CreateTexture(...);
    FRDGBufferRef VertexBuffer = GraphBuilder.CreateBuffer(...);

    // 2. 외부 리소스 등록 (기존 리소스 재사용)
    FRDGTextureRef ExternalTexture = GraphBuilder.RegisterExternalTexture(PooledTexture);

    // 3. 패스 추가 (실행은 아직)
    GraphBuilder.AddPass(RDG_EVENT_NAME("Pass1"), ...);
    GraphBuilder.AddPass(RDG_EVENT_NAME("Pass2"), ...);
    GraphBuilder.AddPass(RDG_EVENT_NAME("Pass3"), ...);

    // 4. 결과 추출 요청
    GraphBuilder.QueueTextureExtraction(GBufferA, &OutGBuffer);
}
```

**이 단계에서 하는 일:**
- 리소스 선언 (FRDGTexture, FRDGBuffer 생성)
- 패스 등록 (람다 함수로 실행 코드 저장)
- 의존성 그래프 구축 (어떤 패스가 어떤 리소스를 읽고 쓰는지)

#### Compile Phase (최적화)

```cpp
// FRDGBuilder::Compile() 내부 흐름
void FRDGBuilder::Compile()
{
    // 1. 패스 의존성 분석
    SetupPassDependencies();

    // 2. 사용하지 않는 패스 제거 (Culling)
    CullPassesMarker();

    // 3. 동일 렌더타겟 사용 패스 병합
    MergePasses();

    // 4. 비동기 컴퓨트 동기화 설정
    SetupAsyncComputeForks();
    SetupAsyncComputeJoins();

    // 5. 배리어 수집
    CollectPassBarriers();

    // 6. 배리어 RHI 객체 생성
    CreatePassBarriers();

    // 7. 병렬 실행 준비 (멀티스레드)
    SetupParallelExecute();
}
```

**핵심 최적화:**
- **Pass Culling:** 최종 출력에 기여하지 않는 패스 제거 → [PassExecution.md](./PassExecution.md#44-pass-culling-사용하지-않는-패스-제거) 참조
- **Pass Merging:** 동일 RT에 쓰는 패스들을 하나의 RenderPass로 병합 → [PassExecution.md](./PassExecution.md#45-pass-merging-패스-병합) 참조
- **Barrier Optimization:** 불필요한 배리어 제거 → [PassExecution.md](./PassExecution.md#5-배리어-관리-barrier-management) 참조

#### Execute Phase (실제 렌더링)

```cpp
// FRDGBuilder::Execute() 내부 흐름
void FRDGBuilder::Execute()
{
    // 1. 리소스 생성 (이제야 실제 RHI 리소스 할당)
    BeginResourceRHI();

    // 2. GPU 업로드 준비 (CPU → GPU 데이터 전송)
    PrepareBufferUploads();
    SubmitBufferUploads();

    // 3. 유니폼 버퍼 생성
    CreateUniformBuffers();

    // 4. 패스 실행 (순서대로)
    for (FRDGPass* Pass : Passes)
    {
        ExecutePassPrologue(Pass);   // 배리어 + RenderPass 시작
        Pass->Execute(RHICmdList);   // 실제 렌더링 람다 호출
        ExecutePassEpilogue(Pass);   // 배리어 + RenderPass 종료
    }

    // 5. 리소스 해제 (사용 끝난 것들)
    EndResourceRHI();

    // 6. 에필로그 트랜지션 (다음 프레임을 위한 상태 전환)
    AddEpilogueTransition();

    // 7. 추출 요청된 리소스 반환
    ProcessExtractedTextures();
}
```

**상세 내용:**
- 리소스 생명주기 → [ResourceManagement.md](./ResourceManagement.md#7-리소스-생명주기-resource-lifecycle) 참조
- 배리어 실행 → [PassExecution.md](./PassExecution.md#5-배리어-관리-barrier-management) 참조

---

## 📊 10. RDG vs Immediate Mode 비교

| 측면 | Immediate Mode | RDG |
|------|---------------|-----|
| **코드 스타일** | 명령형 (Imperative) | 선언형 (Declarative) |
| **리소스 할당** | 수동, 즉시 | 자동, 지연 |
| **메모리 사용** | 100% (모두 할당) | 30-50% (aliasing) |
| **배리어** | 수동 삽입 | 자동 삽입 |
| **패스 컬링** | 불가능 | 자동 |
| **비동기 컴퓨트** | 복잡한 수동 동기화 | 자동 Fork/Join |
| **디버깅** | 어려움 (크래시 추적) | 쉬움 (RenderDoc 통합) |
| **성능** | 비효율적 | 최적화됨 |
| **학습 곡선** | 낮음 | 중간 |

---

## 🔗 11. 참고 자료

### 11.1 1차 자료

- **TechArtNomad 블로그:** [RDG 분석](https://techartnomad.tistory.com/204)
- **Frostbite FrameGraph (GDC 2017):** Yuriy O'Donnell
  → RDG의 영감 출처

### 11.2 Unreal Engine 소스 코드

```
Engine/Source/Runtime/RenderCore/
├── Public/
│   ├── RenderGraph.h                    ; FRDGBuilder API
│   ├── RenderGraphResources.h           ; FRDGTexture, FRDGBuffer
│   ├── RenderGraphParameters.h          ; 파라미터 구조체
│   └── RenderGraphEvent.h               ; RDG_EVENT_NAME
└── Private/
    ├── RenderGraphBuilder.cpp           ; 핵심 구현
    ├── RenderGraphPass.cpp              ; 패스 실행
    ├── RenderGraphResourcePool.cpp      ; 리소스 풀링
    └── RenderGraphTrace.cpp             ; 프로파일링
```

### 11.3 핵심 함수 위치

| 함수 | 파일 | 라인 (대략) | 설명 |
|------|------|-----------|------|
| `FRDGBuilder::Compile()` | RenderGraphBuilder.cpp | ~1500 | Compile Phase 진입점 |
| `FRDGBuilder::Execute()` | RenderGraphBuilder.cpp | ~2000 | Execute Phase 진입점 |
| `SetupPassResources()` | RenderGraphBuilder.cpp | ~800 | 리소스 등록 |
| `CollectPassBarriers()` | RenderGraphBuilder.cpp | ~1200 | 배리어 수집 |
| `BeginResourceRHI()` | RenderGraphBuilder.cpp | ~1800 | 리소스 생성 |
| `EndResourceRHI()` | RenderGraphBuilder.cpp | ~1950 | 리소스 해제 |

---

## 📝 12. 변경 이력

> **v1.1 — 2025-11-23:** 문서 분리 (4개 파일로 재구성)
> - Architecture.md: 설계 철학 및 전체 개요
> - ResourceManagement.md: 리소스 관리 및 생명주기
> - PassExecution.md: 패스 실행, 배리어, 비동기 컴퓨트
> - Examples.md: 실전 사용 예시

> **v1.0 — 2025-11-23:** RDG Architecture Deep Dive 초안 작성
> 기반: TechArtNomad 블로그 + 사용자 제공 상세 분석

---

## 💡 13. 핵심 요약

### RDG의 본질

> **"개발자는 무엇을 그릴지만 선언하고, RDG가 어떻게 그릴지를 결정한다."**

```
Setup:    무엇을 (What)     → 입출력만 선언
Compile:  최적화 (Optimize) → 불필요한 것 제거, 의존성 분석
Execute:  실행 (How)        → 최적화된 순서로 렌더링
```

### 개발자가 알아야 할 핵심

1. **리소스는 Execute 시점에 생성됨** → Setup에서는 껍데기만
2. **Extract하지 않으면 전체 패스가 컬링될 수 있음** → 의도 명확히
3. **External 리소스는 aliasing 불가** → 필요할 때만 사용
4. **비동기 컴퓨트는 자동 동기화** → Fork/Join 자동 삽입
5. **배리어는 신경 쓰지 않아도 됨** → 상태만 올바르게 선언

### 성능 목표

- **메모리 절감:** 50-70% (Transient aliasing) → [ResourceManagement.md](./ResourceManagement.md#32-transient-resource-aliasing-메모리-재사용)
- **패스 컬링:** 10-30% (미사용 패스 제거) → [PassExecution.md](./PassExecution.md#44-pass-culling-사용하지-않는-패스-제거)
- **배리어 최적화:** Split barrier로 오버랩 증가 → [PassExecution.md](./PassExecution.md#51-배리어의-역할)
- **비동기 활용:** 20-40% GPU 활용도 증가 → [PassExecution.md](./PassExecution.md#6-비동기-컴퓨트-동기화-async-compute-synchronization)

---

## 📖 다음 단계

1. **리소스 관리 심화:** [ResourceManagement.md](./ResourceManagement.md) - Aliasing, External 리소스, 생명주기
2. **패스 실행 이해:** [PassExecution.md](./PassExecution.md) - Pass Culling, Merging, 배리어, 비동기 컴퓨트
3. **실전 예시 학습:** [Examples.md](./Examples.md) - 6단계 난이도별 실습

---

**이 문서는 RDG의 설계 철학과 전체 아키텍처를 개괄합니다. 상세 내용은 연관 문서를 참조하세요.**