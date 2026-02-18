---
title: "RDG 리소스 관리 (Resource Management)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "RenderGraph"]
---
# RDG 리소스 관리 (Resource Management)

> **연관 문서:**
> - [Architecture.md](./Architecture.md) - RDG 전체 아키텍처 개요
> - [PassExecution.md](./PassExecution.md) - 패스 실행 및 배리어 관리
> - [Examples.md](./Examples.md) - 실전 사용 예시

---

## 📚 목차

- [3. 리소스 관리 기초](#-3-리소스-관리-resource-management)
  - [3.1 FRDGResource 계층 구조](#31-frdgresource-계층-구조)
  - [3.2 Transient Resource Aliasing](#32-transient-resource-aliasing-메모리-재사용)
  - [3.3 External Resources](#33-external-resources-외부-리소스)
  - [3.4 Buffer Upload](#34-buffer-upload-cpu--gpu)
- [7. 리소스 생명주기](#-7-리소스-생명주기-resource-lifecycle)
  - [7.1 BeginResourceRHI()](#71-beginresourcerhi---리소스-생성)
  - [7.2 EndResourceRHI()](#72-endresourcerhi---리소스-해제)
  - [7.3 AddEpilogueTransition()](#73-addepiloguetransition---프레임-종료-전환)
  - [7.4 리소스 생명주기 전체 흐름](#74-리소스-생명주기-전체-흐름)

---

## 🔍 3. 리소스 관리 (Resource Management)

### 3.1 FRDGResource 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FRDGResource 클래스 계층                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FRDGResource (Base)                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  - Name: FName                      // 디버깅용 이름              │ │
│  │  - Type: ERDGResourceType           // Texture or Buffer         │ │
│  │  - FirstPass: FRDGPass*             // 처음 사용하는 패스        │ │
│  │  - LastPass: FRDGPass*              // 마지막 사용하는 패스      │ │
│  │  - bExternal: bool                  // 외부 리소스 여부          │ │
│  │  - bExtracted: bool                 // 추출 요청 여부            │ │
│  │  - bProduced: bool                  // 쓰기 발생 여부            │ │
│  │  - bCulled: bool                    // 컬링되었는지              │ │
│  │  - ResourceRHI: FRHIResource*       // 실제 RHI 리소스           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                ▲                              ▲                         │
│                │                              │                         │
│       ┌────────┴────────┐          ┌─────────┴──────────┐              │
│       │                 │          │                    │              │
│  FRDGTexture       FRDGBuffer      FRDGUniformBuffer    │              │
│  ┌──────────┐     ┌──────────┐    ┌──────────────┐     │              │
│  │ Desc     │     │ Desc     │    │ Layout       │     │              │
│  │ State[]  │     │ State[]  │    │ Contents     │     │              │
│  │ ViewMap  │     │ ViewMap  │    └──────────────┘     │              │
│  └──────────┘     └──────────┘                         │              │
│                                                         │              │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Source/Runtime/RenderCore/Public/RenderGraphResources.h`

### 3.2 Transient Resource Aliasing (메모리 재사용)

RDG의 가장 강력한 최적화는 **사용 시간이 겹치지 않는 리소스들이 같은 메모리를 공유**하는 것입니다.

```
프레임 타임라인:
│
├─ Pass 1: SceneColor (생성) ────────┐
│                                    │ 사용 중
├─ Pass 2: SceneColor (사용) ────────┤
│                                    │
├─ Pass 3: SceneColor (마지막) ──────┘ 해제
│
├─ Pass 4: BloomTexture (생성) ──────┐  ← 같은 메모리 재사용!
│                                    │
├─ Pass 5: BloomTexture (사용) ──────┤
│                                    │
└─ Pass 6: BloomTexture (마지막) ────┘


메모리 사용량:
  기존 방식: SceneColor (16MB) + BloomTexture (16MB) = 32MB
  RDG 방식: max(SceneColor, BloomTexture) = 16MB (50% 절감!)
```

#### Aliasing 구현

```cpp
// FRDGBuilder::BeginResourceRHI()에서 aliasing 처리
void FRDGBuilder::BeginResourceRHI(FRDGPass* Pass, FRDGTexture* Texture)
{
    if (Texture->ResourceRHI == nullptr)
    {
        // 1. Transient 리소스 풀에서 재사용 가능한 메모리 찾기
        FRHITransientTexture* Aliased = TransientResourceAllocator.FindAlias(
            Texture->Desc,
            Pass->Handle  // 이 패스부터 사용 시작
        );

        if (Aliased)
        {
            // 2. 기존 메모리 재사용
            Texture->ResourceRHI = Aliased->GetRHI();

            // 3. Aliasing 배리어 추가 (이전 리소스 → 새 리소스)
            AddAliasingTransition(PreviousResource, Texture);
        }
        else
        {
            // 4. 새로 할당
            Texture->ResourceRHI = RHICreateTexture(Texture->Desc);
            TransientResourceAllocator.Allocate(Texture->ResourceRHI);
        }
    }
}
```

**Aliasing 조건:**
- 리소스 크기/포맷이 동일
- 사용 시간이 겹치지 않음
- Transient 리소스여야 함 (External 제외)

### 3.3 External Resources (외부 리소스)

RDG 외부에서 관리하는 리소스는 특별한 처리가 필요합니다.

```cpp
// 외부 리소스 등록
TRefCountPtr<IPooledRenderTarget> ExistingTarget = ...;
FRDGTextureRef RDGTexture = GraphBuilder.RegisterExternalTexture(ExistingTarget);

// RDG 내부에서 사용
PassParams->InputTexture = RDGTexture;

// 결과 추출 (RDG → 외부)
TRefCountPtr<IPooledRenderTarget> OutputTarget;
GraphBuilder.QueueTextureExtraction(RDGTexture, &OutputTarget);
```

**External 리소스 특징:**
- Aliasing 불가 (외부에서 언제 사용할지 모름)
- 항상 생성됨 (컬링 안 됨)
- 상태 전환은 RDG가 관리

#### RegisterExternalTexture vs ConvertToExternalTexture

| | RegisterExternalTexture | ConvertToExternalTexture |
|---|---|---|
| **입력** | 기존 IPooledRenderTarget | FRDGTexture |
| **출력** | FRDGTextureRef | TRefCountPtr<IPooledRenderTarget> |
| **용도** | RDG 외부 → RDG 내부 | RDG 내부 → RDG 외부 |
| **할당 시점** | 이미 할당됨 | Execute() 시점에 즉시 할당 |
| **Aliasing** | 불가 | 불가 |

```cpp
// RegisterExternalTexture: 기존 리소스를 RDG에 가져오기
FRDGTextureRef Input = GraphBuilder.RegisterExternalTexture(ExternalPooled);
// → FRDGTexture를 만들고, ResourceRHI = ExternalPooled->GetRHI()

// ConvertToExternalTexture: RDG 리소스를 즉시 할당하여 외부로
TRefCountPtr<IPooledRenderTarget> Output;
GraphBuilder.ConvertToExternalTexture(RDGTexture, Output);
// → 즉시 RHI 리소스 생성, FRDGPooledBuffer로 래핑하여 반환
```

### 3.4 Buffer Upload (CPU → GPU)

CPU 데이터를 GPU로 전송하는 과정:

```cpp
// 1. 업로드 큐잉 (Setup Phase)
TArray<FMyVertex> VertexData = { ... };
GraphBuilder.QueueBufferUpload(VertexBuffer, VertexData.GetData(), VertexData.Num() * sizeof(FMyVertex));

// 2. 업로드 버퍼 준비 (Compile Phase)
// FRDGBuilder::PrepareBufferUploads()
void PrepareBufferUploads()
{
    for (FRDGBuffer* Buffer : BuffersToUpload)
    {
        // GPU 버퍼 미리 생성 (Execute 전에)
        Buffer->ResourceRHI = RHICreateBuffer(Buffer->Desc);
    }
}

// 3. 실제 업로드 (Execute Phase)
// FRDGBuilder::SubmitBufferUploads()
void SubmitBufferUploads()
{
    for (FBufferUpload& Upload : UploadQueue)
    {
        // Staging buffer에 CPU 데이터 복사
        void* Mapped = RHILockBuffer(Upload.StagingBuffer);
        memcpy(Mapped, Upload.Data, Upload.Size);
        RHIUnlockBuffer(Upload.StagingBuffer);

        // GPU로 복사
        RHICmdList.CopyBuffer(Upload.StagingBuffer, Upload.DestBuffer);
    }
}
```

**주의:** `QueueBufferUpload()` 대신 `FRDGScatterUploadBuffer`를 사용하는 것이 더 효율적입니다 (내부 풀링 지원).

---

## 🔧 7. 리소스 생명주기 (Resource Lifecycle)

### 7.1 BeginResourceRHI() - 리소스 생성

```cpp
// FRDGBuilder::BeginResourceRHI()
void FRDGBuilder::BeginResourceRHI(FRDGPass* Pass)
{
    // 이 패스에서 처음 사용하는 리소스들 생성
    for (FRDGTexture* Texture : Pass->ResourcesToBegin)
    {
        if (Texture->bExternal)
        {
            // External 리소스: 이미 할당됨 (건너뛰기)
            continue;
        }

        if (Texture->bTransient)
        {
            // Transient 리소스: 풀에서 aliasing 시도
            FRHITransientTexture* Aliased = TransientAllocator.AcquireTexture(
                Texture->Desc,
                Texture->FirstPass->Handle,
                Texture->LastPass->Handle
            );

            if (Aliased)
            {
                // 재사용 성공
                Texture->ResourceRHI = Aliased->GetRHI();

                // Aliasing 배리어 추가
                AddAliasingTransition(
                    Pass->PrologueBarriersToBegin,
                    PreviousResource,  // 이전에 이 메모리를 쓰던 리소스
                    Texture
                );
            }
            else
            {
                // 새로 할당
                Aliased = TransientAllocator.CreateTexture(Texture->Desc);
                Texture->ResourceRHI = Aliased->GetRHI();
            }
        }
        else
        {
            // Pooled 리소스: 풀에서 가져오기
            Texture->PooledTexture = GRenderTargetPool.FindFreeElement(
                Texture->Desc,
                Texture->Name
            );
            Texture->ResourceRHI = Texture->PooledTexture->GetRHI();
        }
    }
}
```

**리소스 타입별 할당:**

| 타입 | 할당 시점 | 메모리 소스 | Aliasing |
|------|----------|------------|----------|
| **Transient** | Execute (필요 시) | FRHITransientHeap | ✅ 가능 |
| **Pooled** | Execute (필요 시) | GRenderTargetPool | ⚠️ 프레임 간만 |
| **External** | RDG 외부 | 외부 관리 | ❌ 불가 |

### 7.2 EndResourceRHI() - 리소스 해제

```cpp
// FRDGBuilder::EndResourceRHI()
void FRDGBuilder::EndResourceRHI(FRDGPass* Pass)
{
    // 이 패스가 마지막으로 사용하는 리소스들 해제
    for (FRDGTexture* Texture : Pass->ResourcesToEnd)
    {
        if (Texture->bExternal)
        {
            // External 리소스: 해제 안 함
            continue;
        }

        if (Texture->bTransient)
        {
            // Transient: 힙에 반환 (aliasing 가능 상태로)
            TransientAllocator.Release(Texture->ResourceRHI);
        }
        else
        {
            // Pooled: 레퍼런스 카운트 감소
            Texture->PooledTexture.SafeRelease();
            // → 0이 되면 GRenderTargetPool로 반환
        }

        // RHI 리소스는 아직 살아있음 (프레임 종료 시 파괴)
    }
}
```

**중요:** `EndResourceRHI()`는 **엔진 힙에 사용 종료를 알리는 것**이지, RHI 리소스를 즉시 파괴하지 않습니다.
실제 RHI 리소스는 **RHI Thread의 EndFrame**에서 파괴됩니다.

### 7.3 AddEpilogueTransition() - 프레임 종료 전환

```cpp
// FRDGBuilder::AddEpilogueTransition()
void FRDGBuilder::AddEpilogueTransition()
{
    for (FRDGTexture* Texture : AllTextures)
    {
        if (Texture->bExternal)
        {
            // External 리소스: ExternalAccessMode로 전환
            AddTransition(
                EpilogueBarriers,
                Texture,
                Texture->CurrentState,
                Texture->ExternalAccessMode  // 보통 ERHIAccess::SRVMask
            );
        }
        else if (Texture->bTransient)
        {
            // Transient: 힙 파괴 마킹 (RHI Thread에서 실행)
            FRHITransientHeap* Heap = Texture->GetTransientHeap();
            Heap->MarkForDestroy();
        }
    }
}
```

**Transient Heap 파괴:**
```cpp
// RHI Thread - EndFrame()
void FRHICommandListImmediate::EndFrame()
{
    for (FRHITransientHeap* Heap : MarkedHeaps)
    {
        Heap->Destroy();  // D3D12: ID3D12Heap::Release()
    }
}
```

### 7.4 리소스 생명주기 전체 흐름

```
Setup Phase:
  CreateTexture() ─────────────→ FRDGTexture 생성 (껍데기)
                                  ResourceRHI = nullptr

Compile Phase:
  Compile() ───────────────────→ 의존성 분석, 최적화
                                  ResourcesToBegin/End 결정

Execute Phase:
  │
  ├─ BeginResourceRHI(Pass1) ──→ Texture->ResourceRHI 할당
  │                               (Transient aliasing 또는 새 할당)
  │
  ├─ ExecutePass(Pass1) ────────→ 실제 렌더링
  │
  ├─ ExecutePass(Pass2) ────────→ 동일 리소스 사용
  │
  ├─ EndResourceRHI(Pass3) ─────→ Transient 메모리 반환
  │                               (aliasing 가능 상태로)
  │
  ├─ BeginResourceRHI(Pass4) ───→ 다른 리소스가 같은 메모리 재사용
  │
  └─ AddEpilogueTransition() ───→ 힙 파괴 마킹

RHI Thread:
  EndFrame() ───────────────────→ 실제 RHI 리소스 파괴
```

---

## 💡 실전 최적화 팁

### 올바른 리소스 플래그 설정

```cpp
// ❌ 나쁜 예: 모든 리소스를 External로
FRDGTextureRef Texture = GraphBuilder.RegisterExternalTexture(Pooled);
// → Aliasing 불가, 항상 메모리 점유

// ✅ 좋은 예: 필요할 때만 External
FRDGTextureRef Texture = GraphBuilder.CreateTexture(Desc, TEXT("Temp"));
// → Transient aliasing 가능, 메모리 절약

// External이 필요한 경우:
// - 다음 프레임에서도 사용 (히스토리 버퍼)
// - RDG 외부 코드에서 접근
```

### 불필요한 Extraction 피하기

```cpp
// ❌ 나쁜 예: 모든 결과를 Extract
GraphBuilder.QueueTextureExtraction(GBuffer, &OutGBuffer);
GraphBuilder.QueueTextureExtraction(Depth, &OutDepth);
// → 컬링 불가, 패스 강제 실행

// ✅ 좋은 예: 실제 사용할 것만 Extract
if (bNeedGBufferNextFrame)
{
    GraphBuilder.QueueTextureExtraction(GBuffer, &OutGBuffer);
}
// → 사용하지 않으면 전체 패스 컬링됨
```

---

## 🔗 참고 자료

### 관련 소스 파일

```
Engine/Source/Runtime/RenderCore/
├── Public/
│   ├── RenderGraphResources.h           ; FRDGResource 계층 구조
│   └── RenderGraphAllocator.h           ; Transient Allocator
└── Private/
    ├── RenderGraphBuilder.cpp           ; BeginResourceRHI, EndResourceRHI
    └── RenderGraphResourcePool.cpp      ; 리소스 풀링 구현
```

### 핵심 함수 위치

| 함수 | 파일 | 설명 |
|------|------|------|
| `BeginResourceRHI()` | RenderGraphBuilder.cpp | 리소스 생성 및 Aliasing |
| `EndResourceRHI()` | RenderGraphBuilder.cpp | 리소스 해제 |
| `AddEpilogueTransition()` | RenderGraphBuilder.cpp | 프레임 종료 전환 |
| `QueueBufferUpload()` | RenderGraphBuilder.cpp | CPU → GPU 업로드 |

---

> **다음 단계:** [PassExecution.md](./PassExecution.md)에서 패스 실행, 배리어 관리, 비동기 컴퓨트 동기화를 확인하세요.
