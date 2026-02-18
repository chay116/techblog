---
title: "RDG 패스 실행 및 배리어 관리 (Pass Execution & Barrier Management)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "RenderGraph"]
---
# RDG 패스 실행 및 배리어 관리 (Pass Execution & Barrier Management)

> **연관 문서:**
> - [Architecture.md](./Architecture.md) - RDG 전체 아키텍처 개요
> - [ResourceManagement.md](./ResourceManagement.md) - 리소스 생명주기 및 메모리 관리
> - [Examples.md](./Examples.md) - 실전 사용 예시

---

## 📚 목차

- [4. 패스 관리](#-4-패스-관리-pass-management)
  - [4.1 FRDGPass 구조](#41-frdgpass-구조)
  - [4.2 AddPass() 호출 시 동작](#42-addpass-호출-시-동작)
  - [4.3 SetupPassResources()](#43-setuppassresources---리소스-등록)
  - [4.4 Pass Culling](#44-pass-culling-사용하지-않는-패스-제거)
  - [4.5 Pass Merging](#45-pass-merging-패스-병합)
- [5. 배리어 관리](#-5-배리어-관리-barrier-management)
  - [5.1 배리어의 역할](#51-배리어의-역할)
  - [5.2 RDG 배리어 4종류](#52-rdg-배리어-4종류)
  - [5.3 CollectPassBarriers()](#53-collectpassbarriers---배리어-수집)
  - [5.4 CreatePassBarriers()](#54-createpassbarriers---rhi-배리어-생성)
- [6. 비동기 컴퓨트 동기화](#-6-비동기-컴퓨트-동기화-async-compute-synchronization)
  - [6.1 Fork/Join 메커니즘](#61-forkjoin-메커니즘)
  - [6.2 SetupAsyncComputeForks/Joins](#62-setupasynccomputeforksjoi ns)
  - [6.3 Fork/Join 배리어 삽입](#63-forkjoin-배리어-삽입)
  - [6.4 D3D12 펜스 구현](#64-d3d12-펜스-구현)
- [8. 실전 최적화 팁](#-8-실전-최적화-팁)

---

## ⚙️ 4. 패스 관리 (Pass Management)

### 4.1 FRDGPass 구조

```cpp
// 단순화된 FRDGPass 구조
class FRDGPass
{
public:
    FName Name;                          // 디버그 이름
    ERDGPassFlags Flags;                 // Raster, Compute, AsyncCompute, ...
    FRDGParameterStruct Parameters;      // 패스 파라미터 (입출력 리소스)

    TArray<FRDGTextureAccess> TextureAccesses;  // 사용하는 텍스처 목록
    TArray<FRDGBufferAccess> BufferAccesses;    // 사용하는 버퍼 목록

    FRDGPass* GraphicsForkPass;          // 비동기 컴퓨트 시작 지점
    FRDGPass* GraphicsJoinPass;          // 비동기 컴퓨트 종료 지점

    TFunction<void(FRHICommandList&)> ExecuteLambda;  // 실제 렌더링 코드

    // 배리어 정보
    TArray<FRHITransition*> PrologueBarriersToBegin;
    TArray<FRHITransition*> PrologueBarriersToEnd;
    TArray<FRHITransition*> EpilogueBarriersToBegin;
    TArray<FRHITransition*> EpilogueBarriersToEnd;

    bool bCulled;                        // 컬링 여부
    bool bSkippedByReducedWork;          // 동적 스킵 여부
};
```

### 4.2 AddPass() 호출 시 동작

```cpp
// 사용자 코드
GraphBuilder.AddPass(
    RDG_EVENT_NAME("MyPass"),
    PassParameters,
    ERDGPassFlags::Compute,
    [](FRHICommandList& RHICmdList, FMyParameters* Params)
    {
        // 렌더링 코드
    }
);

// 내부 동작 (FRDGBuilder::AddPass)
template<typename ParameterStructType, typename ExecuteLambdaType>
FRDGPassRef FRDGBuilder::AddPass(
    FRDGEventName&& Name,
    ParameterStructType* Parameters,
    ERDGPassFlags Flags,
    ExecuteLambdaType&& ExecuteLambda)
{
    // 1. FRDGPass 객체 생성
    FRDGPass* Pass = Allocate<FRDGPass>(Name, Flags);

    // 2. 파라미터 저장
    Pass->Parameters = Parameters;

    // 3. 람다 저장 (나중에 실행)
    Pass->ExecuteLambda = Forward<ExecuteLambdaType>(ExecuteLambda);

    // 4. 리소스 등록 (SetupPassResources)
    SetupPassResources(Pass, Parameters);

    // 5. 패스 목록에 추가
    Passes.Add(Pass);

    return Pass;
}
```

### 4.3 SetupPassResources() - 리소스 등록

```cpp
// FRDGBuilder::SetupPassResources()
void FRDGBuilder::SetupPassResources(FRDGPass* Pass, FRDGParameterStruct* Parameters)
{
    // 1. 파라미터 구조체를 순회하며 리소스 추출
    Parameters->Enumerate([&](FRDGParameter& Parameter)
    {
        if (FRDGTextureRef Texture = Parameter.GetAsTexture())
        {
            // 2. 텍스처 상태 생성
            FTextureState State;
            State.Access = Parameter.GetAccess();          // Read, Write, RTV, ...
            State.Flags = Parameter.GetTransitionFlags();  // Discard, KeepData, ...
            State.Pass = Pass;

            // 3. 텍스처에 상태 추가
            Texture->State.Add(State);

            // 4. 마지막 사용 패스 업데이트
            Texture->LastPass = Pass;

            // 5. 쓰기 작업이면 bProduced 마킹
            if (EnumHasAnyFlags(State.Access, ERHIAccess::WritableMask))
            {
                Texture->bProduced = true;
            }

            // 6. 패스에도 기록
            Pass->TextureAccesses.Add({ Texture, State.Access });
        }

        // 버퍼도 동일하게 처리
        if (FRDGBufferRef Buffer = Parameter.GetAsBuffer())
        {
            // ... 동일한 로직
        }
    });

    // 7. 유니폼 버퍼 수집
    CollectUniformBuffers(Pass, Parameters);
}
```

**핵심:**
- 각 리소스에 **FTextureState** 또는 **FBufferState** 추가
- 리소스의 `FirstPass`, `LastPass` 업데이트
- 쓰기 작업 시 `bProduced = true` 마킹

### 4.4 Pass Culling (사용하지 않는 패스 제거)

```cpp
// FRDGBuilder::CullPassesMarker()
void FRDGBuilder::CullPassesMarker()
{
    // 1. 모든 패스를 일단 컬링 대상으로 마킹
    for (FRDGPass* Pass : Passes)
    {
        Pass->bCulled = true;
    }

    // 2. 추출 요청된 리소스부터 역추적
    for (FRDGTexture* Texture : ExtractedTextures)
    {
        MarkPassAsUsed(Texture->LastPass);  // 마지막 사용 패스 마킹
    }

    // 3. External 리소스도 무조건 유지
    for (FRDGTexture* Texture : ExternalTextures)
    {
        if (Texture->bProduced)  // 쓰기가 발생했다면
        {
            MarkPassAsUsed(Texture->LastPass);
        }
    }
}

// 역추적 마킹
void MarkPassAsUsed(FRDGPass* Pass)
{
    if (Pass->bCulled)
    {
        Pass->bCulled = false;  // 컬링 해제

        // 이 패스가 읽는 리소스의 생산자 패스도 마킹
        for (FRDGTextureAccess& Access : Pass->TextureAccesses)
        {
            if (EnumHasAnyFlags(Access.Access, ERHIAccess::ReadableMask))
            {
                FRDGTexture* Texture = Access.Texture;
                if (Texture->FirstPass != Pass)  // 다른 패스에서 생산
                {
                    MarkPassAsUsed(Texture->LastPass);  // 생산자 마킹
                }
            }
        }
    }
}
```

**컬링 전략:**
1. 추출 요청된 리소스부터 역추적
2. 그 리소스를 생산하는 패스 마킹
3. 그 패스가 읽는 리소스의 생산자도 마킹
4. 재귀적으로 의존성 체인 추적

### 4.5 Pass Merging (패스 병합)

동일한 렌더타겟에 쓰는 연속 패스들을 하나의 `BeginRenderPass/EndRenderPass`로 묶습니다.

```cpp
// FRDGBuilder::MergePasses()
void FRDGBuilder::MergePasses()
{
    FRDGPass* MergeParent = nullptr;

    for (FRDGPass* Pass : Passes)
    {
        if (Pass->bCulled)
            continue;

        // Raster 패스만 병합 대상
        if (!EnumHasAnyFlags(Pass->Flags, ERDGPassFlags::Raster))
        {
            MergeParent = nullptr;
            continue;
        }

        // 병합 조건 체크
        if (MergeParent && CanMerge(MergeParent, Pass))
        {
            // 병합: Pass를 MergeParent의 서브패스로 추가
            MergeParent->SubPasses.Add(Pass);
            Pass->MergedParent = MergeParent;
        }
        else
        {
            // 새로운 병합 그룹 시작
            MergeParent = Pass;
        }
    }
}

// 병합 가능 조건
bool CanMerge(FRDGPass* A, FRDGPass* B)
{
    // 1. 동일한 렌더타겟 사용
    if (A->Parameters->RenderTargets != B->Parameters->RenderTargets)
        return false;

    // 2. 동일한 옵션 (MSAA, Load/Store actions 등)
    if (A->Parameters->DepthStencil != B->Parameters->DepthStencil)
        return false;

    // 3. 쓰기만 하는 패스 (읽기 의존성 없음)
    if (HasReadDependency(A, B))
        return false;

    return true;
}
```

**병합 효과:**
```cpp
// 병합 전:
RHICmdList.BeginRenderPass(RT, "Pass1");
DrawPass1();
RHICmdList.EndRenderPass();

RHICmdList.BeginRenderPass(RT, "Pass2");  // ← 비용 발생
DrawPass2();
RHICmdList.EndRenderPass();

// 병합 후:
RHICmdList.BeginRenderPass(RT, "Pass1+Pass2");
DrawPass1();
DrawPass2();
RHICmdList.EndRenderPass();
// → BeginRenderPass 호출 1회로 감소!
```

---

## 🚧 5. 배리어 관리 (Barrier Management)

### 5.1 배리어의 역할

**배리어(Barrier)**는 GPU에서 **메모리 일관성**을 보장하는 동기화 메커니즘입니다.

```
GPU 파이프라인:
┌─────────┐    ┌─────────┐    ┌─────────┐
│ Pass A  │───→│ L2 Cache│───→│ Pass B  │
│ (Write) │    │         │    │ (Read)  │
└─────────┘    └─────────┘    └─────────┘

배리어 없이:
  Pass A가 쓴 데이터가 L2 캐시에만 있음
  Pass B가 읽을 때 오래된 VRAM 데이터 읽음
  → 아티팩트, 크래시

배리어 있음:
  Pass A 종료 → Flush (캐시 → VRAM)
  Pass B 시작 → Invalidate (VRAM → 캐시)
  → 올바른 데이터 보장
```

#### 배리어의 두 단계

```cpp
// Split Barrier (2단계 트랜지션)
RHICmdList.BeginTransition({
    Resource: SceneColor,
    StateBefore: ERHIAccess::RTV,      // RenderTarget (쓰기)
    StateAfter: ERHIAccess::SRVGraphics // ShaderResource (읽기)
});
// → Flush: RTV 캐시를 VRAM으로 비움

// ... 다른 작업 가능 (비동기 오버랩)

RHICmdList.EndTransition({
    Resource: SceneColor,
    StateBefore: ERHIAccess::RTV,
    StateAfter: ERHIAccess::SRVGraphics
});
// → Invalidate: SRV 캐시를 무효화하고 VRAM에서 다시 로드
```

### 5.2 RDG 배리어 4종류

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     RDG 배리어 타입                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Pass N-1]            [Pass N]            [Pass N+1]                  │
│     │                     │                     │                       │
│     │  ①                  │  ③                  │                       │
│     ├─EpilogueBarrier─┐  ├─PrologueBarrier─┐  │                       │
│     │   ToBegin        │  │   ToBegin        │  │                       │
│     │                  │  │                  │  │                       │
│     │                  │  │                  │  │                       │
│     │  ②               │  │  ④               │  │                       │
│     ├─EpilogueBarrier──┤  ├─PrologueBarrier──┤  │                       │
│     │   ToEnd          │  │   ToEnd          │  │                       │
│     │                  │  │                  │  │                       │
│     ▼                  ▼  ▼                  ▼  ▼                       │
│  [Execute]          [Execute]          [Execute]                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

① EpilogueBarrierToBegin: Pass N-1 종료 후 즉시 BeginTransition
② EpilogueBarrierToEnd: Pass N 시작 직전 EndTransition
③ PrologueBarrierToBegin: Pass N 시작 직전 BeginTransition
④ PrologueBarrierToEnd: Pass N 시작 직전 EndTransition
```

**왜 4가지로 나누는가?**

```
그래픽스 큐 타임라인:
│
├─ Pass A (Graphics) ───────┐
│                      EndA  │ ← EpilogueBarrierToBegin
│                            │
├─ Pass X (Async Compute) ──┼─── BeginX
│                            │         EndX
│                            │
├─ Pass B (Graphics) ───────┤ ← EpilogueBarrierToEnd
│                      BeginB
│                      EndB
│


문제: EndA가 실행되기 전에 BeginX - EndX가 끼어들 수 있음
해결: EndA를 미리 실행 (EpilogueBarrierToBegin)
     Pass B 시작 직전에 EndTransition (EpilogueBarrierToEnd)
```

### 5.3 CollectPassBarriers() - 배리어 수집

```cpp
// FRDGBuilder::CollectPassBarriers()
void FRDGBuilder::CollectPassBarriers()
{
    for (FRDGPass* Pass : Passes)
    {
        if (Pass->bCulled)
            continue;

        // 이 패스에서 사용하는 모든 텍스처 순회
        for (FRDGTextureAccess& Access : Pass->TextureAccesses)
        {
            FRDGTexture* Texture = Access.Texture;

            // 현재 텍스처 상태
            FTextureState& CurrentState = Texture->CurrentState;

            // 패스에서 필요로 하는 상태
            FTextureState& RequiredState = Texture->GetMergedState(Pass);

            // 상태 전환 필요?
            if (CurrentState.Access != RequiredState.Access)
            {
                // 배리어 생성 결정
                DetermineBarrierPlacement(Pass, Texture, CurrentState, RequiredState);
            }

            // 텍스처 상태 업데이트 (다음 패스용)
            Texture->CurrentState = RequiredState;
        }
    }
}

void DetermineBarrierPlacement(FRDGPass* Pass, FRDGTexture* Texture, FTextureState& Before, FTextureState& After)
{
    // 케이스 1: 처음 사용하는 리소스
    if (Texture->FirstPass == Pass)
    {
        // PrologueBarrierToBegin → PrologueBarrierToEnd
        // (패스 시작 전에 완료)
        AddTransition(
            Pass->PrologueBarriersToBegin,
            Pass->PrologueBarriersToEnd,
            Texture, Before.Access, After.Access
        );
    }
    // 케이스 2: N-to-N (비동기 컴퓨트 + 그래픽스)
    else if (IsCrossPipeline(Before, After))
    {
        FRDGPass* ProducerPass = Texture->LastProducerPass;

        // SharedEpilogueBarrierToBegin (생산자 종료 후)
        AddTransition(
            ProducerPass->SharedEpilogueBarriersToBegin,
            Texture, Before.Access, After.Access
        );

        // PrologueBarrierToEnd (각 소비자 시작 전)
        for (FRDGPass* ConsumerPass : Texture->ConsumerPasses)
        {
            AddTransition(
                ConsumerPass->PrologueBarriersToEnd,
                Texture, Before.Access, After.Access
            );
        }
    }
    // 케이스 3: 일반적인 경우 (이전 패스 → 현재 패스)
    else
    {
        FRDGPass* PreviousPass = Texture->LastPass;

        // EpilogueBarrierToBegin (이전 패스 종료 후)
        AddTransition(
            PreviousPass->EpilogueBarriersToBegin,
            Texture, Before.Access, After.Access
        );

        // EpilogueBarrierToEnd (현재 패스 시작 전)
        AddTransition(
            Pass->EpilogueBarriersToEnd,
            Texture, Before.Access, After.Access
        );
    }
}
```

### 5.4 CreatePassBarriers() - RHI 배리어 생성

```cpp
// FRDGBuilder::CreatePassBarriers()
void FRDGBuilder::CreatePassBarriers()
{
    for (FRDGPass* Pass : Passes)
    {
        // Prologue 배리어 생성
        for (FRDGTransition& Transition : Pass->PrologueTransitions)
        {
            FRHITransition* RHIBarrier = RHICreateTransition({
                Transition.Resource->ResourceRHI,
                Transition.StateBefore,
                Transition.StateAfter,
                Transition.Flags  // CrossPipeline, Aliasing, ...
            });

            // CrossPipeline이면 FD3D12SyncPoint 생성 (펜스)
            if (EnumHasAnyFlags(Transition.Flags, EResourceTransitionFlags::CrossPipeline))
            {
                RHIBarrier->SyncPoint = new FD3D12SyncPoint();
            }

            Pass->PrologueBarriersToBegin.Add(RHIBarrier);
        }

        // Epilogue 배리어도 동일하게 생성
        // ...
    }
}
```

**CrossPipeline 배리어:**
```cpp
// FD3D12DynamicRHI::RHICreateTransition()
if (Transition.Flags & CrossPipeline)
{
    // 펜스 생성
    FD3D12SyncPoint* SyncPoint = new FD3D12SyncPoint();
    SyncPoint->GraphicsFence = GraphicsQueue->GetFence();
    SyncPoint->ComputeFence = ComputeQueue->GetFence();

    // 나중에 RHI 스레드에서 실제 Wait() 호출
    Transition->SyncPoint = SyncPoint;
}
```

---

## ⚡ 6. 비동기 컴퓨트 동기화 (Async Compute Synchronization)

### 6.1 Fork/Join 메커니즘

비동기 컴퓨트는 그래픽스 파이프라인과 **병렬 실행**됩니다.

```
타임라인:
│
├─ Graphics Pass 1 ─────────────────────────────────────┐
│                                                       │
├─ Fork ────────────────────────────────────────────────┤
│                                                       │
│  ┌─ Async Compute Pass A ──────────┐                 │
│  │                                  │                 │
│  └─ Async Compute Pass B ──────────┤                 │
│                                     │                 │
├─ Join ─────────────────────────────┼─────────────────┤
│                                     │                 │
├─ Graphics Pass 2 (결과 사용) ───────┼─────────────────┘
│                                     │
│                                     ▼
│                                  (대기)
```

### 6.2 SetupAsyncComputeForks/Joins

```cpp
// FRDGBuilder::SetupAsyncComputeForks()
void FRDGBuilder::SetupAsyncComputeForks()
{
    for (FRDGPass* Pass : Passes)
    {
        if (Pass->bCulled)
            continue;

        if (!EnumHasAnyFlags(Pass->Flags, ERDGPassFlags::AsyncCompute))
            continue;

        // 이 비동기 컴퓨트 패스가 읽는 리소스의 생산자 찾기
        FRDGPass* ProducerPass = nullptr;
        for (FRDGTextureAccess& Access : Pass->TextureAccesses)
        {
            if (EnumHasAnyFlags(Access.Access, ERHIAccess::ReadableMask))
            {
                FRDGTexture* Texture = Access.Texture;
                if (Texture->LastProducerPass)
                {
                    ProducerPass = Texture->LastProducerPass;
                    break;
                }
            }
        }

        if (ProducerPass)
        {
            // Fork 설정: 생산자 패스 종료 → 비동기 시작
            Pass->GraphicsForkPass = ProducerPass;
            ProducerPass->AsyncComputeForks.Add(Pass);
        }
    }
}

// FRDGBuilder::SetupAsyncComputeJoins()
void FRDGBuilder::SetupAsyncComputeJoins()
{
    for (FRDGPass* AsyncPass : AsyncComputePasses)
    {
        // 이 비동기 패스가 생산한 리소스의 소비자 찾기
        FRDGPass* ConsumerPass = nullptr;
        for (FRDGTextureAccess& Access : AsyncPass->TextureAccesses)
        {
            if (EnumHasAnyFlags(Access.Access, ERHIAccess::WritableMask))
            {
                FRDGTexture* Texture = Access.Texture;
                for (FRDGPass* Pass : Texture->ConsumerPasses)
                {
                    if (!EnumHasAnyFlags(Pass->Flags, ERDGPassFlags::AsyncCompute))
                    {
                        ConsumerPass = Pass;
                        break;
                    }
                }
            }
        }

        if (ConsumerPass)
        {
            // Join 설정: 비동기 종료 → 소비자 시작
            AsyncPass->GraphicsJoinPass = ConsumerPass;
            ConsumerPass->AsyncComputeJoins.Add(AsyncPass);
        }
    }
}
```

### 6.3 Fork/Join 배리어 삽입

```cpp
// Fork 배리어 (생산자 종료 후)
FRDGPass* ProducerPass = AsyncPass->GraphicsForkPass;
if (ProducerPass)
{
    AddTransition(
        ProducerPass->EpilogueBarriersToBegin,
        Texture,
        ERHIAccess::RTV,              // Graphics에서 쓰기
        ERHIAccess::SRVCompute,       // Compute에서 읽기
        EResourceTransitionFlags::CrossPipeline  // ← 펜스 생성
    );
}

// Join 배리어 (소비자 시작 전)
FRDGPass* ConsumerPass = AsyncPass->GraphicsJoinPass;
if (ConsumerPass)
{
    AddTransition(
        AsyncPass->EpilogueBarriersToEnd,
        Texture,
        ERHIAccess::UAVCompute,       // Compute에서 쓰기
        ERHIAccess::SRVGraphics,      // Graphics에서 읽기
        EResourceTransitionFlags::CrossPipeline
    );
}
```

### 6.4 D3D12 펜스 구현

```cpp
// FD3D12CommandContext::RHIEndTransitions()
void FD3D12CommandContext::RHIEndTransitions(TArrayView<FRHITransition*> Transitions)
{
    for (FRHITransition* Transition : Transitions)
    {
        if (Transition->SyncPoint)
        {
            // CrossPipeline 배리어: 펜스 등록
            FD3D12SyncPoint* SyncPoint = Transition->SyncPoint;

            if (IsGraphicsQueue())
            {
                // Graphics 큐: Signal
                GraphicsQueue->Signal(SyncPoint->GraphicsFence);
            }
            else
            {
                // Compute 큐: Wait
                ComputeQueue->Wait(SyncPoint->GraphicsFence);
            }
        }

        // 일반 배리어 실행
        CommandList->ResourceBarrier(Transition);
    }
}

// FD3D12DynamicRHI::ProcessSubmissionQueue() - RHI 스레드
void ProcessSubmissionQueue()
{
    for (FD3D12SyncPoint* SyncPoint : PendingSyncPoints)
    {
        // Wait 실행
        SyncPoint->ComputeQueue->FlushFenceWait(SyncPoint->GraphicsFence);
        // → ID3D12CommandQueue::Wait() 호출
    }
}
```

**펜스 타임라인:**
```
Graphics Queue:
├─ Pass A (생산자) ──────────────┐
│                           Signal(Fence) ← RHI Thread
│
Compute Queue:
├─ Wait(Fence) ──────────────────┤ ← RHI Thread
├─ Async Pass ───────────────────┤
│                           Signal(Fence2)
│
Graphics Queue:
├─ Wait(Fence2) ─────────────────┤
├─ Pass B (소비자) ──────────────┘
```

---

## 🎯 8. 실전 최적화 팁

### 비동기 컴퓨트 활용

```cpp
// ✅ 병렬화 가능한 작업은 AsyncCompute로
GraphBuilder.AddPass(
    RDG_EVENT_NAME("LightCulling"),
    PassParameters,
    ERDGPassFlags::AsyncCompute,  // ← 비동기 컴퓨트
    [](FRHICommandList& RHICmdList, FParameters* Params)
    {
        // Graphics 파이프라인과 병렬 실행
    }
);

// RDG가 자동으로 Fork/Join 설정
```

**비동기 컴퓨트 적합한 작업:**
- Light culling
- Particle simulation
- Depth reduction (Hi-Z)
- SSAO downsampling

### Pass Merging 활용

```cpp
// ✅ 동일 RT 사용 패스는 연속으로 배치
GraphBuilder.AddPass(RDG_EVENT_NAME("BasePass"), ...);     // RT: GBuffer
GraphBuilder.AddPass(RDG_EVENT_NAME("Decals"), ...);       // RT: GBuffer
GraphBuilder.AddPass(RDG_EVENT_NAME("Emissive"), ...);     // RT: GBuffer
// → 자동으로 1개의 RenderPass로 병합

// ❌ 중간에 다른 패스가 끼면 병합 안 됨
GraphBuilder.AddPass(RDG_EVENT_NAME("BasePass"), ...);     // RT: GBuffer
GraphBuilder.AddPass(RDG_EVENT_NAME("Shadows"), ...);      // RT: ShadowMap (다름!)
GraphBuilder.AddPass(RDG_EVENT_NAME("Decals"), ...);       // RT: GBuffer
// → 병합 불가, BeginRenderPass 2회
```

### 메모리 프로파일링

```
stat RDG               ; RDG 전체 통계
r.RDG.Debug 1          ; 디버그 모드 활성화
r.RDG.DumpGraph 1      ; 그래프 덤프 (DOT 포맷)
r.RDG.ImmediateMode 1  ; 즉시 실행 모드 (디버깅용)
```

**RenderDoc/PIX 활용:**
- Pass 이름이 그대로 표시됨 (`RDG_EVENT_NAME`)
- 리소스 aliasing 확인 가능
- 배리어 위치 및 비용 측정

---

## 🔗 참고 자료

### 관련 소스 파일

```
Engine/Source/Runtime/RenderCore/
├── Public/
│   ├── RenderGraph.h                    ; FRDGPass API
│   └── RenderGraphParameters.h          ; 파라미터 구조체
└── Private/
    ├── RenderGraphPass.cpp              ; 패스 실행 로직
    ├── RenderGraphBuilder.cpp           ; Compile, Execute
    └── RenderGraphBarrier.cpp           ; 배리어 생성 및 관리
```

### 핵심 함수 위치

| 함수 | 파일 | 설명 |
|------|------|------|
| `SetupPassResources()` | RenderGraphBuilder.cpp | 리소스 등록 |
| `CullPassesMarker()` | RenderGraphBuilder.cpp | Pass Culling |
| `MergePasses()` | RenderGraphBuilder.cpp | Pass Merging |
| `CollectPassBarriers()` | RenderGraphBuilder.cpp | 배리어 수집 |
| `CreatePassBarriers()` | RenderGraphBuilder.cpp | RHI 배리어 생성 |
| `SetupAsyncComputeForks/Joins()` | RenderGraphBuilder.cpp | 비동기 컴퓨트 동기화 |

---

> **다음 단계:** [Examples.md](./Examples.md)에서 실전 사용 예시를 확인하세요.
