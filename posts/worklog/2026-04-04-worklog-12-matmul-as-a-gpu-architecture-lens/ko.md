---
title: "GPU 시리즈 04 - Matmul로 보는 GPU 아키텍처"
date: "2026-04-04"
status: "wip"
project: "vAI"
lang: "ko"
category: "gpu-series"
track: "gpu-architecture"
series: "gpu"
book: "GPU Series"
part: "Matmul as an Architecture Lens"
chapter: "왜 matmul이 GPU를 가장 잘 드러내는 커널인가"
order: "4"
tags: ["gpu", "matmul", "gemm", "tensor-core", "tiling", "register-pressure", "nvidia"]
---

<div class="gpu-kicker">GPU 시리즈 04 · Architecture Lens</div>

<div class="gpu-intro-grid">
  <p class="gpu-intro-copy">
    matmul은 GPU 아키텍처를 구성 요소 목록이 아니라 하나의 파이프라인으로 보게 만드는 커널이다. tiling, shared memory, register, Tensor Core, scheduling overlap이 한 커널 안에서 동시에 드러난다.
  </p>
  <div class="gpu-note-card">
    <p class="gpu-note-eyebrow">먼저 볼 것</p>
    <ul>
      <li>현재 tile이 어느 저장 계층에 머무는가</li>
      <li>읽어 온 바이트 하나를 몇 번 재사용하는가</li>
      <li>accumulator 모양이 얼마나 큰 register 상태를 만드는가</li>
      <li>compute와 data movement가 실제로 겹치는가</li>
    </ul>
  </div>
</div>

## 왜 이 커널이 중요한가

- matmul이 중요한 이유는 많은 워크로드가 GEMM으로 환원되기 때문만이 아니다. matmul은 GPU 성능을 결정하는 거의 모든 큰 개념을 한 번에 드러낸다.
- 좋은 matmul 커널을 만들려면 tiling, reuse, shared memory, register pressure, occupancy, Tensor Core, 비동기 데이터 이동, scheduling overlap을 함께 봐야 한다.
- 그래서 matmul은 실행 모델과 메모리 계층을 배운 뒤 GPU를 이해하는 가장 좋은 아키텍처 렌즈 중 하나가 된다.

어떤 커널은 한 가지 교훈을 선명하게 보여 준다. vector add는 coalescing을 드러내고, reduction은 tree 구조와 synchronization을 드러내며, elementwise kernel은 launch geometry를 드러낸다.

반면 matmul은 다르다. 거의 모든 핵심 아키텍처 긴장을 한 번에 드러낸다. 성능 좋은 커널을 만들려면 동시에 다음 질문에 답해야 한다.

1. 데이터를 얼마나 많이 on-chip에 붙잡아 둘 수 있는가?
2. 한 번 읽은 tile을 몇 번이나 재사용할 수 있는가?
3. register 상태를 얼마나 감당할 수 있는가?
4. block, warp, thread에 일을 어떻게 나눌 것인가?
5. data movement와 compute를 얼마나 겹칠 수 있는가?

그래서 Aleksa Gordić의 matmul 글은 단순한 GEMM 글이라기보다, 현대 GPU 커널 설계를 단계적으로 훑어 주는 글로 읽는 편이 맞다.

<div class="gpu-compare-grid">
  <div class="gpu-compare-card">
    <p class="gpu-compare-label">단순 커널</p>
    <p>대개 하나의 병목을 또렷하게 보여 준다. 그래서 입문용으로는 좋지만, 머신 전체를 동시에 생각하게 만들지는 않는다.</p>
  </div>
  <div class="gpu-compare-card">
    <p class="gpu-compare-label">Matmul</p>
    <p>ownership, reuse, hierarchy, pipeline depth, register cost가 동시에 드러난다. 그래서 GPU 아키텍처와 가장 자연스럽게 겹쳐진다.</p>
  </div>
</div>

이 흐름이 특히 좋은 이유는 커널이 좋아질수록 질문 자체가 바뀌기 때문이다. 처음에는 산술이 맞는지가 중요해 보인다. 하지만 금방 그건 가장 덜 흥미로운 문제가 된다. 진짜 질문은 데이터가 어디에 머무는지, 얼마나 오래 붙잡혀 있는지, 다시 먼 계층으로 내려가기 전에 얼마나 많은 일을 뽑아내는지로 이동한다.

![Matmul optimization ladder](diagram-matmul-ladder.svg)

*최적화 경로를 사다리처럼 보면, 각 단계가 데이터를 더 가까운 계층에 붙잡아 두고 더 많이 재사용한다는 점이 한눈에 보인다.*

그래서 matmul은 좋은 교재다. 최적화 경로가 서로 무관한 트릭의 묶음이 아니라, 데이터 흐름을 점점 더 명시적으로 설계해 가는 과정으로 보이기 때문이다.

## 코드로 따라가는 Matmul 학습 계단

이 지점에서 code-first 자료와 글 기반 자료가 자연스럽게 만난다. 글로는 hierarchy와 ownership을 먼저 잡고, 코드로는 naive kernel에서 출발해 각 단계가 무엇을 바꾸는지 확인하면 된다.

실전적으로는 다음 계단이 가장 이해하기 좋다.

1. naive fp32 GEMM: 정확성, arithmetic intensity, roofline gap을 본다.
2. global-memory 정리: coalescing과 vectorization으로 transaction 낭비를 줄인다.
3. shared-memory tiling: 재사용을 명시적으로 설계한다.
4. warp/register tiling: ownership을 더 작은 실행 단위와 accumulator 모양으로 내린다.
5. Tensor Core / WMMA: compute primitive를 바꾸되, 여전히 feeding 문제를 중심에 둔다.
6. async pipeline: `cp.async` 같은 경로로 copy와 compute를 겹치기 시작한다.
7. Hopper-style pipeline: `TMA`, `WGMMA`, persistent execution, cluster 관점으로 movement가 1급 설계가 된다.

이 순서가 좋은 이유는 "더 빠른 instruction을 찾아라"가 아니라 "같은 데이터를 더 오래 붙잡고, 더 질서 있게 흘려라"라는 한 문장으로 모든 단계를 다시 읽을 수 있기 때문이다.

## 왜 Naive Matmul은 GPU를 굶기는가

교과서식 loop는 단순하다.

```text
for m:
  for n:
    acc = 0
    for k:
      acc += A[m, k] * B[k, n]
```

이 구조는 이해하기 쉽지만, GPU 관점에서는 memory hierarchy 테스트를 통과하지 못한다.

- 비싼 global load가 너무 많다.
- 데이터를 버리기 전에 reuse가 충분하지 않다.
- on-chip working set을 거의 통제하지 못한다.
- 하드웨어가 낼 수 있는 수준에 비해 arithmetic intensity가 낮다.

그래서 naive matmul은 주로 최적화 목표를 분명하게 보여 주는 출발점으로 의미가 있다.

> 먼 메모리에서 덜 가져오고, 한 번 가져온 데이터는 놓기 전에 더 많이 재사용하라.

### 최소한의 Naive CUDA 형태

```cpp
__global__ void naive_gemm(const float* A, const float* B, float* C, int M, int N, int K) {
  int row = blockIdx.y * blockDim.y + threadIdx.y;
  int col = blockIdx.x * blockDim.x + threadIdx.x;
  if (row >= M || col >= N) return;

  float acc = 0.0f;
  for (int k = 0; k < K; ++k) {
    acc += A[row * K + k] * B[k * N + col];
  }
  C[row * N + col] = acc;
}
```

이 커널은 읽기 쉬워서 교육용으로는 좋다. 하지만 각 output element가 거의 협조 없이 메모리 깊숙한 곳까지 반복해서 손을 뻗기 때문에 성능 커널로는 약하다.

## Tiling은 첫 번째 진짜 아키텍처 이동이다

naive kernel을 넘어서면 가장 먼저 등장하는 큰 변화가 tiling이다.

이제는 scalar output 하나를 따로 계산하지 않는다. 대신 output tile을 계산하면서 input tile을 반복해서 재사용한다. 이 순간 문제의 모양이 완전히 달라진다.

### Block Tiling

하나의 thread block이 `C`의 tile 하나를 맡는다.

- block은 `A` tile을 반복해서 읽는다.
- block은 `B` tile을 반복해서 읽는다.
- block은 block 크기의 output tile에 누적한다.

이 지점부터 shared memory가 중심으로 들어온다. 읽어 온 tile을 많은 thread가 함께 재사용해야 하기 때문이다.

### Warp Tiling

block 내부에서는 각 warp가 더 작은 output tile을 맡는다.

- warp 단위 ownership이 작업 분할을 결정한다.
- shared-memory access pattern이 이 단계에서 모양을 잡는다.
- warp가 들고 있어야 하는 accumulator 상태의 크기도 여기서 정해진다.

### Register Tiling

가장 안쪽 단계에서는 각 thread가 output tile의 작은 fragment를 register에 들고 간다.

- register가 많으면 local reuse가 늘어날 수 있다.
- register를 너무 많이 쓰면 occupancy가 줄어든다.

즉 tiling은 단순한 geometry 문제가 아니다. geometry와 resource pressure를 함께 보는 문제다.

### Tiled Mental Model

```text
for each C_tile owned by a block:
  zero accumulators
  for each K_tile:
    load A_tile to shared memory
    load B_tile to shared memory
    synchronize
    accumulate many FMAs or MMAs
    synchronize
  store C_tile
```

이 지점이 진짜 전환점이다. 커널은 더 이상 많은 scalar dot product의 묶음처럼 동작하지 않고, staged on-chip dataflow program처럼 동작하기 시작한다.

<div class="gpu-callout">
  <p>
    이때부터 코드는 하드웨어가 일하는 단위와 같은 언어로 읽힌다. block은 tile을 맡고, warp는 subtile을 맡고, thread는 fragment를 맡으며, 메모리 계층은 그 ownership을 먹여 살리는 구조가 된다.
  </p>
</div>

## Shared Memory는 첫 번째 큰 변곡점이다

optimized matmul이 진짜 GPU 커널처럼 보이기 시작하는 순간은 shared memory가 들어오는 시점이다.

기본 패턴은 안정적이다.

1. `A`와 `B` tile을 global memory에서 읽는다.
2. shared memory에 놓는다.
3. 많은 thread와 warp가 그 tile을 재사용한다.
4. 여러 번 multiply-accumulate를 수행한다.
5. 다음 tile로 넘어간다.

중요한 건 shared memory가 단지 빠르다는 사실만이 아니다. 더 중요한 건 한 번의 비싼 fetch가 많은 arithmetic operation을 먹여 살리고, 커널이 reuse를 캐시에 맡기지 않고 직접 설계할 수 있게 된다는 점이다.

이 시점부터 memory hierarchy는 배경 지식이 아니라 실행 전략이 된다.

## 더 좋은 커널의 숨은 비용은 Register Footprint다

커널이 좋아질수록 다른 제약이 빠르게 커진다.

- accumulator tile이 커진다.
- `A`, `B` fragment가 더 오래 살아 있다.
- temporary state가 늘어난다.

즉 thread당 register 사용량이 늘어난다.

더 좋은 커널은 보통:

- shared memory를 더 많이 쓰고
- register도 훨씬 많이 쓰고
- occupancy는 조금 낮추지만
- 전체 성능은 훨씬 좋아진다

겉으로 보면 역설처럼 보이지만, 실제로는 늘어난 on-chip reuse가 줄어든 warp residency보다 더 큰 이득을 만들기 때문이다.

결국 중요한 튜닝 질문은 이것이 된다.

> 더 큰 tile이 만들어 낸 reuse 증가가, 더 큰 register footprint 비용을 정당화하는가?

## Tensor Core는 메모리 문제를 없애 주지 않는다

Tensor Core는 종종 matmul을 자동으로 해결해 주는 것처럼 소개되지만, 실제로는 그렇지 않다.

Tensor Core가 해결하는 것:

- matrix-multiply fragment에 대한 매우 높은 연산 throughput

Tensor Core가 자동으로 해결하지 않는 것:

- fragment를 효율적으로 공급하는 문제
- 데이터를 올바르게 staging하는 문제
- 파이프라인을 계속 채워 넣는 문제
- register/shared-memory 제약에 맞는 tile shape를 고르는 문제

그래서 고성능 Tensor Core kernel은 여전히 메모리 discipline 문제다.

- tile을 어떻게 읽을 것인가
- fragment를 어떻게 분배할 것인가
- pipeline을 어떻게 overlap할 것인가
- register pressure를 어떻게 억제할 것인가

Tensor Core throughput은 보상이지 설계 그 자체는 아니다.

### Tensor Kernel을 볼 때의 질문

Tensor Core kernel을 볼 때는 다음을 먼저 묻는 편이 좋다.

1. `A`, `B` fragment는 어떻게 load되는가?
2. 어디에 staging되는가?
3. accumulator fragment는 얼마나 오래 살아 있는가?
4. 그 live state가 register에 주는 비용은 얼마나 큰가?
5. asynchronous movement가 latency를 실제로 숨기고 있는가, 아니면 복잡도만 늘리고 있는가?

![Hopper-style matmul pipeline](diagram-hopper-pipeline.svg)

*현대 matmul 커널은 코드 목록이기 전에 먼저 파이프라인 그림으로 이해하는 편이 낫다.*

이 그림이 특히 도움이 되는 이유는, 커널이 본질적으로 공간적인 구조를 갖기 때문이다. 글만으로도 순서를 설명할 수는 있지만, 그림으로 보면 데이터가 저장 계층 사이를 이동하는 흐름과 실행 계층 사이에서 ownership이 이동하는 흐름이 한 번에 보인다.

## CUTLASS를 읽을 때도 질문은 같다

`CUTLASS`를 처음 볼 때 가장 헷갈리는 점은, 템플릿 이름과 정책 객체가 너무 많아서 "라이브러리 문법"이 핵심처럼 보인다는 것이다. 하지만 실제 핵심은 문법이 아니라 ownership과 pipeline이다.

그래서 CUTLASS 스타일 커널을 볼 때도 먼저 다음을 추적하는 편이 좋다.

1. block과 warp-group이 어떤 tile을 소유하는가
2. `A`, `B` fragment가 어느 계층을 거쳐 들어오는가
3. accumulator가 얼마나 오래 살아 있고, epilogue는 누가 담당하는가
4. movement와 compute가 어떤 stage 구조로 겹치는가
5. 더 큰 tile이 만든 reuse 증가가 register/shared-memory 비용을 정당화하는가

즉 CUTLASS는 "알아야 할 새로운 마법"이라기보다, 이미 배운 ownership, staging, synchronization, epilogue 문제를 더 노골적으로 드러내는 프레임워크에 가깝다.

## 왜 Aleksa Gordić의 글이 좋은 기준점인가

그 글은 "Tensor Core를 써라"에서 멈추지 않는다. 실제로는 다음 계단을 차례로 올라간다.

- architecture basics
- PTX와 SASS 감각
- synchronous tiling
- Tensor Core kernels
- deep asynchronous pipelines
- TMA
- persistent kernels
- clusters

이 순서는 아주 적절하다. 커널이 하드웨어를 점점 더 직접적으로 의식하게 되는 과정을 그대로 반영하기 때문이다.

실전적으로 가장 중요한 교훈은 단순하다.

> 현대 GPU 성능은 마법 같은 instruction 하나를 찾는 문제보다, data movement와 compute를 하나의 coherent pipeline으로 묶는 문제에 더 가깝다.

## Matmul이 GPU 일반론에 대해 가르쳐 주는 것

실제 워크로드가 GEMM이 아니더라도 matmul은 재사용 가능한 진실을 많이 가르쳐 준다.

### Reuse가 이긴다

가장 빠른 커널은 단순히 더 많은 연산을 하는 커널이 아니다. 같은 바이트를 읽고 더 많은 연산을 끌어내는 커널이다.

### Flat Bandwidth 숫자보다 Hierarchy가 중요하다

GPU가 높은 DRAM bandwidth를 가진다는 사실만으로는 충분하지 않다. 중요한 것은:

- 커널이 DRAM까지 얼마나 자주 탈출하는가
- shared memory와 register가 의도한 방식대로 실제 활용되고 있는가

### Scheduling과 Memory는 분리되지 않는다

좋은 matmul 커널은:

- data가 제때 도착하고
- warp가 올바른 granularity로 일을 배정받고
- compute 단계와 memory 단계가 깔끔하게 겹치기 때문에 빠르다

이건 단순 라이브러리 구현 문제가 아니라 아키텍처 문제다.

## Practical Checklist

matmul 계열 커널을 볼 때는 다음을 묻는 편이 좋다.

1. block이 소유하는 output tile은 무엇인가?
2. warp가 소유하는 sub-tile은 무엇인가?
3. 무엇이 shared memory에 남는가?
4. 무엇이 register에 남는가?
5. load한 tile 하나당 몇 번의 reuse 기회가 존재하는가?
6. 현재 accumulator 모양이 얼마나 큰 register pressure를 만드는가?
7. 커널은 math throughput에 막히는가, 아니면 math를 먹여 살리는 경로에 막히는가?

## Final Takeaway

- matmul은 실행, 메모리, 자원 tradeoff를 하나의 커널 계열 안에 밀어 넣기 때문에 GPU 아키텍처를 공부하는 가장 좋은 실전 렌즈 중 하나다.
- 핵심 최적화는 "Tensor Core를 써라"가 아니다. 핵심 최적화는 "compute pipeline이 계속 바쁘게 돌 수 있도록 data movement를 설계하라"다.
- 그래서 이 글 다음 단계는 Hopper 특화 matmul 설계다. 같은 아이디어가 그쪽에서는 훨씬 더 노골적으로 드러난다.

## References

- [Inside NVIDIA GPUs: Anatomy of high performance matmul kernels](https://www.aleksagordic.com/blog/matmul)
- [Learning CUTLASS the hard way! 코드 저장소](https://github.com/gpusgobrr/explore-gemm)
- [Learn CUTLASS the hard way!](https://www.kapilsharma.dev/posts/learn-cutlass-the-hard-way/)
- `General-Purpose Graphics Processor Architecture`
- 기존 관련 글:
  - `GPU 시리즈 02 - Systolic Array: 기초에서 실제 매핑까지`
  - `GPU 시리즈 03 - GPU Memory Hierarchy와 Data Movement`
