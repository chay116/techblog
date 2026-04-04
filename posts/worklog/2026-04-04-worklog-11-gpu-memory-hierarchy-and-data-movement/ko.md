---
title: "GPU 시리즈 03 - GPU 메모리 계층과 데이터 이동"
date: "2026-04-04"
status: "wip"
project: "vAI"
lang: "ko"
category: "gpu-series"
track: "gpu-architecture"
series: "gpu"
book: "GPU Series"
part: "Memory Hierarchy & Data Movement"
chapter: "왜 GPU 성능은 데이터 이동에서 먼저 갈리는가"
order: "3"
tags: ["gpu", "memory-hierarchy", "shared-memory", "l2", "dram", "coalescing", "nvidia"]
---

# 1. 핵심 요약

- `GPU 시리즈 01`이 **누가 실행될 수 있는가**에 대한 글이었다면, 이 글은 **누가 제때 데이터를 받을 수 있는가**에 대한 글이다.
- 많은 GPU 커널은 연산 유닛이 부족해서 느린 것이 아니라, 비싼 메모리 계층에서 데이터를 너무 자주 끌어오기 때문에 느려진다.
- 그래서 더 좋은 질문은 "이 GPU가 몇 FLOPs를 내는가?"보다 "같은 바이트를 몇 번이나 다시 여행시키고 있는가?"다.

# 2. 왜 Scheduling 다음이 Memory인가

warp scheduling을 배우고 나면 이런 생각을 하기 쉽다.

> warp만 충분히 많이 올려 두면 하드웨어가 다 숨겨 줄 것이다.

이 말은 절반만 맞다.

scheduler는 latency를 숨기는 데 도움을 주지만, 나쁜 access pattern의 비용 자체를 지워 주지는 못한다. 모든 warp가 먼 메모리의 cold data를 기다리고 있다면, scheduler는 결국 같은 종류의 대기 상태를 여러 warp 사이에서 번갈아 처리할 뿐이다.

그래서 다음과 같은 안정적인 사고 모델이 필요하다.

- scheduling은 **일을 issue할 수 있는가**를 결정하고
- memory hierarchy는 **데이터를 얼마나 빨리 공급할 수 있는가**를 결정하며
- 실제 성능은 둘의 상호작용에서 나온다

# 3. 실전 메모리 계층

실무 관점에서 유용한 계층은 다음과 같다.

1. registers
2. shared memory / L1
3. L2
4. DRAM

세대마다 세부 구현은 달라지지만, 대부분의 성능 해석은 이 순서만으로도 출발할 수 있다.

![GPU memory hierarchy stack](diagram-memory-hierarchy-stack.svg)

*실전적인 메모리 읽기는 결국 "이 바이트가 더 뜨거운 계층을 몇 번 탈출했는가"를 묻는 일과 가깝다.*

## 3.1 Registers

register는 실행에 가장 가까운 저장 공간이다. 빠르고, thread 문맥에 강하게 묶여 있으며, 고성능 커널의 가장 뜨거운 상태가 여기에 머문다.

register가 잘 맞는 대상:

- accumulator
- 여러 번 재사용되는 임시값
- loop 내부 상태

하지만 register에도 비용은 있다.

바로 `register pressure`다. thread당 register를 너무 많이 쓰면 resident warp 수가 줄고, 그 결과 latency-hiding 능력도 같이 줄어든다.

즉 register는 가장 빠른 저장소지만 공짜는 아니다.

## 3.2 Shared Memory / L1

shared memory는 처음으로 "설계할 수 있는" 메모리 계층이다.

왜 중요하냐면:

- 한 번 읽은 데이터를 여러 thread가 재사용할 수 있고
- staging을 프로그래머가 직접 통제할 수 있으며
- tiling이 여기서부터 진짜 전략이 되기 때문이다

shared memory를 단순히 "더 빠른 메모리"로만 보면 조금 약하다. 더 좋은 모델은 이렇다.

> shared memory는 의도적으로 reuse를 만들어 내는 버퍼다.

그래서 많은 최적화된 커널이 계산 전에 tile을 여기에 먼저 올려 두고 반복해서 사용한다.

## 3.3 L2

L2는 SM 로컬 활동과 DRAM 사이에 놓인 큰 on-chip cache다.

실전 역할은 이렇다.

- SM 간 반복 트래픽을 어느 정도 흡수하고
- locality가 있으면 DRAM 왕복을 줄이며
- off-chip 비용을 치르기 전 마지막 on-chip 구조로 작동한다

L2가 잘 맞아떨어지면 global load도 최악의 DRAM 접근보다 훨씬 싸게 보일 수 있다.

## 3.4 DRAM

DRAM은 장치 전체를 받치는 대용량 off-chip 메모리다.

문제는 단순히 bandwidth가 낮다는 데 있지 않다. 현대 GPU의 DRAM bandwidth는 매우 높다. 진짜 문제는:

- on-chip 계층에 비해 여전히 멀고
- 나쁜 access pattern이 transaction 낭비를 크게 만들며
- traffic이 DRAM까지 자주 새기 시작하면 scheduler가 숨길 수 있는 범위도 줄어든다는 점이다

즉 DRAM은 "데이터가 결국 있는 곳"이지, 성능이 머물고 싶은 곳은 아니다.

# 4. Coalescing: 첫 번째 메모리 성능 증폭기

GPU 메모리에서 가장 먼저 체감하는 개념 중 하나가 `coalescing`이다.

직관은 이렇다.

- warp 안의 인접한 thread가 인접한 주소를 읽으면 하드웨어는 더 적은 transaction으로 처리할 수 있고
- 주소가 흩어지면 같은 논리 작업에도 더 많은 transaction이 필요해진다

그래서 같은 계산처럼 보여도 layout과 access pattern에 따라 메모리 비용은 크게 달라진다.

vector add 같은 단순 커널이 여전히 교육적으로 중요한 이유도 여기에 있다.

- contiguous access
- strided access
- scattered access

이 패턴들이 throughput을 어떻게 갈라놓는지 선명하게 보여 주기 때문이다.

![Coalescing and reuse illustration](diagram-coalescing-reuse.svg)

*같은 논리 작업이라도 인접한 thread가 함께 움직이느냐 흩어지느냐에 따라 메모리 시스템이 받는 압력은 크게 달라진다.*

## 4.1 최소 예제로 보는 Access Pattern 차이

```cpp
__global__ void coalesced_copy(const float* in, float* out, int n) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < n) out[idx] = in[idx];
}

__global__ void strided_copy(const float* in, float* out, int n, int stride) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  int src = idx * stride;
  if (src < n) out[idx] = in[src];
}
```

요점은 모든 strided kernel이 나쁘다는 뜻이 아니다. 인접한 thread가 더 이상 인접한 주소를 읽지 않으면, 같은 양의 논리 데이터를 가져오는 데도 더 많은 메모리 transaction이 필요해지는 경우가 많다는 점을 보여 주는 예제다.

# 5. Shared Memory를 "빠른 메모리"보다 "재사용 도구"로 보기

shared memory를 "사용자 관리형 빠른 메모리"로 배우는 건 틀리지 않다. 하지만 그 설명만으로는 약하다.

더 강한 해석은 이렇다.

- global memory는 종종 같은 값을 nearby thread에게 여러 번 전달하고
- shared memory는 그 fetch를 한 번으로 줄이며
- 여러 thread가 같은 tile을 locally reuse하게 만든다

이게 바로 아키텍처와 커널 설계가 연결되는 지점이다.

이 연결이 없으면:

- 각 thread가 자기 데이터를 따로 읽고
- DRAM/L2 traffic이 커지고
- arithmetic unit은 기다리게 된다

이 연결이 생기면:

- tile을 한 번 staging하고
- reuse가 늘어나며
- arithmetic intensity가 올라간다

그래서 convolution과 matmul에서 shared memory가 항상 핵심으로 등장한다.

## 5.1 "한 번 올리고 여러 번 쓰기"의 전형적인 형태

```cpp
for (int tile = 0; tile < numTiles; ++tile) {
  smemA[threadIdx.x] = A[globalA(tile, threadIdx.x)];
  smemB[threadIdx.x] = B[globalB(tile, threadIdx.x)];
  __syncthreads();

  #pragma unroll
  for (int k = 0; k < TILE_K; ++k) {
    acc += smemA[rowOffset + k] * smemB[k * TILE_N + colOffset];
  }
  __syncthreads();
}
```

많은 optimized kernel의 핵심 모양은 결국 이렇다.

- global memory 비용은 한 번 내고
- tile을 on-chip에 남겨 두고
- staged data에서 많은 arithmetic operation을 뽑아내는 것

# 6. Register Pressure와 Occupancy

여기에는 항상 tradeoff가 숨어 있다.

큰 tile이 매력적인 이유:

- reuse를 늘릴 수 있고
- 반복 load를 줄일 수 있기 때문이다

하지만 큰 tile은 동시에 다음을 늘린다.

- accumulator 수
- temporary value 수
- register 사용량

그 결과 occupancy가 떨어질 수 있다.

즉 "tile이 크면 무조건 좋다"는 법칙은 없다. 실제 질문은 이렇다.

> reuse 증가가 warp residency 감소와 scheduling 유연성 감소를 이겼는가?

이게 고성능 커널 튜닝이 한 개의 노브를 돌리는 작업이 아니라, 여러 균형을 같이 맞추는 작업처럼 느껴지는 이유다.

# 7. 이것이 왜 Matmul로 이어지는가

여기서 memory hierarchy는 자연스럽게 `matmul`로 연결된다.

naive matmul이 GPU에서 약한 이유는 단순하다. 비싼 load를 많이 내면서 reuse가 약하기 때문이다. 최적화된 matmul은 working set을 다시 설계한다.

- `A`, `B` tile을 읽고
- on-chip에 붙잡아 두고
- 여러 multiply-accumulate 단계에서 재사용하고
- 나중에 결과를 쓴다

이건 matmul만의 트릭이 아니다. memory hierarchy를 잘 쓰는 방식이 matmul 형태로 선명하게 드러나는 것이다.

그래서 matmul은 좋은 architecture lens가 된다.

- reuse가 명확하고
- register pressure가 눈에 보이며
- shared memory staging이 필수로 등장한다

# 8. Nsight를 Memory Lens로 읽기

memory 관점을 익히면 profiler도 훨씬 읽기 쉬워진다.

## 8.1 높은 occupancy가 곧 건강한 memory를 뜻하지는 않는다

다음이 동시에 나올 수 있다.

- 높은 occupancy
- 많은 active warps
- 낮은 실제 throughput

왜냐하면 warp들이 memory와 dependency chain을 기다리고 있을 수 있기 때문이다.

## 8.2 Long Scoreboard는 종종 "데이터가 아직 돌아오지 않았다"는 뜻이다

`Long Scoreboard`가 높을 때 실전적으로는 이렇게 읽으면 된다.

- warp가 아직 준비되지 않은 데이터에 의존하는 연산을 발행했고
- memory나 긴 dependency가 풀릴 때까지 issue eligibility가 낮은 상태가 이어진다

## 8.3 Memory Dependency는 단순 cache 문제만이 아니다

다음이 모두 원인이 될 수 있다.

- locality 부족
- reuse 부족
- 과도한 DRAM traffic
- load-to-use distance가 너무 짧음

그래서 해법도 항상 "cache hit rate를 올려라"가 아니다. 때로는:

- reuse를 늘리고
- 더 일찍 prefetch하고
- layout을 바꾸고
- kernel을 retile해야 한다

## 8.4 실전 Nsight 패턴 표

| Pattern | Likely reading | First experiment |
|---|---|---|
| high occupancy + high long scoreboard | 많은 warp는 있지만 데이터가 늦게 도착함 | locality나 staging 개선 |
| low occupancy + high registers/thread | residency가 무너지고 있음 | tile 크기나 unroll 축소 |
| low L2 hit + high DRAM traffic | working set이 on-chip을 자꾸 벗어남 | retile 또는 reuse 개선 |
| good coalescing + still memory-bound | 진짜 bandwidth limit일 수 있음 | 이동 바이트 감소 또는 arithmetic intensity 증가 |

# 9. Practical Checklist

커널이 예상보다 느릴 때는 다음 순서로 묻는 편이 좋다.

1. access pattern이 coalesced되어 있는가?
2. nearby thread가 같은 데이터를 반복해서 가져오고 있지는 않은가?
3. tile을 shared memory에 staging해야 하는가?
4. register 사용량이 너무 높아서 occupancy가 무너지는가?
5. working set이 의도한 on-chip 계층에 비해 너무 큰가?
6. profiler stall의 주 원인이 scoreboard나 memory dependency인가?

# 10. Diagram

![GPU memory hierarchy stack](diagram-memory-hierarchy-stack.svg)

*메모리 계층은 reuse와 연결될 때 비로소 의미가 생긴다. 커널이 감당할 수 있는 가장 뜨거운 계층에 데이터를 오래 붙잡아 두는 것이 핵심이다.*

# 11. Final Takeaway

- GPU 메모리 계층은 배경 지식이 아니다. scheduler가 쓸모 있는 일을 계속 발행할 수 있는지 결정하는 핵심 구조 중 하나다.
- shared memory가 중요한 이유는 비싼 반복 fetch를 local reuse로 바꿔 주기 때문이다.
- register는 가장 뜨거운 상태를 담아 주지만, 동시에 occupancy를 제약한다.
- 그래서 이 글 다음 단계가 matmul인 이유는, matmul이 이 tradeoff들을 가장 구체적으로 드러내기 때문이다.

# 12. References

- `General-Purpose Graphics Processor Architecture`
- CUDA C++ Programming Guide
- CUDA Best Practices Guide
- 블로그 내 기존 관련 글:
