---
title: "워크로그 #05 - SASS 레벨에서 본 메모리 코얼레싱"
date: "2026-02-20"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "memory-coalescing"]
---

메모리 접근 패턴은 GPU 커널 성능을 좌우한다. 이 글에서는 CUDA와 Vulkan 양쪽에서 AoS(Array of Structures) vs SoA(Structure of Arrays) 레이아웃을 SASS 레벨로 비교하며, 컴파일러가 생성하는 로드 명령어에 집중한다.

# 문제: 4-컴포넌트 데이터에서 하나의 필드만 읽기

N개의 파티클이 `{x, y, z, w}` 필드를 가지고 있을 때, `x` 필드만 읽으려면:

- **AoS**: `struct { float x, y, z, w; } particles[N]` — x 읽기 시 stride 16바이트
- **SoA**: `float x[N], y[N], z[N], w[N]` — x 읽기가 연속적, stride 4바이트

NVIDIA 하드웨어에서 메모리 컨트롤러는 워프 내 스레드의 요청을 128바이트 캐시 라인 트랜잭션으로 합친다(coalesce). SoA는 완벽한 코얼레싱을 제공하고, AoS는 사용하지 않는 `y, z, w` 필드를 읽느라 대역폭의 75%를 낭비한다.

# 커널 소스

## AoS 읽기 (CUDA)

```cuda
struct Particle { float x, y, z, w; };

extern "C" __global__
void read_aos_x(const Particle* particles, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = particles[idx].x;
    }
}
```

## SoA 읽기 (CUDA)

```cuda
extern "C" __global__
void read_soa_x(const float* x, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = x[idx];
    }
}
```

# SASS 분석: 주목할 점

## AoS 패턴 — 예상 SASS

```
// TBD — read_aos_x에 대한 cuobjdump 출력
// 핵심 명령어:
//   LDG.E R0, [Raddr]          ← stride-16 주소에서 4바이트 로드
// 주소 계산에 sizeof(Particle)=16 곱셈 포함:
//   IMAD Raddr, Ridx, 16, Rbase
// 워프 스레드 접근 주소: base+0, base+16, base+32, ...
// → 32 스레드당 4개 캐시 라인 트랜잭션 (25% 활용률)
```

## SoA 패턴 — 예상 SASS

```
// TBD — read_soa_x에 대한 cuobjdump 출력
// 핵심 명령어:
//   LDG.E R0, [Raddr]          ← 동일 4바이트 로드이지만 연속적
// 주소 계산: 단순 idx*4
//   IMAD Raddr, Ridx, 4, Rbase
// 워프 스레드 접근 주소: base+0, base+4, base+8, ...
// → 32 스레드당 1개 캐시 라인 트랜잭션 (100% 활용률)
```

## 와이드 로드 최적화 (LDG.E.128)

컴파일러가 AoS 경우에 `LDG.E.128`(128비트 / 16바이트 로드)을 사용하여 구조체 전체를 한 번에 로드할 수 있다:

```
// 컴파일러가 구조체 레이아웃을 인식하면:
//   LDG.E.128 R0:R3, [Raddr]   ← x,y,z,w를 16바이트 로드 한 번에 가져옴
// 이후 R0(x 필드)만 추출
```

이렇게 하면 AoS 로드 트랜잭션은 줄지만, 사용하지 않는 필드를 읽느라 레지스터 파일과 대역폭은 여전히 낭비된다.

# 코얼레싱 효율 테이블

| 레이아웃 | 워프당 로드 바이트 | 워프당 유효 바이트 | 효율 |
|---|---:|---:|---:|
| AoS (stride-16) | 4 × 128B = 512B | 32 × 4B = 128B | 25% |
| SoA (stride-4) | 1 × 128B = 128B | 32 × 4B = 128B | 100% |

# 성능 결과

| 변형 | CUDA (ms) | Vulkan (ms) | 대역폭 (GB/s) |
|---|---:|---:|---:|
| AoS | TBD | TBD | TBD |
| SoA | TBD | TBD | TBD |

예상: 대역폭 효율이 4배 좋으므로 SoA가 약 3~4배 빠를 것.

# SASS 비교: CUDA vs Vulkan

| 항목 | CUDA AoS | Vulkan AoS | 차이 |
|---|---|---|---|
| 로드 명령어 | TBD | TBD | 동일 예상 |
| 주소 계산 | TBD | TBD | 동일 예상 |
| Stride | ×16 | ×16 | 동일 |

| 항목 | CUDA SoA | Vulkan SoA | 차이 |
|---|---|---|---|
| 로드 명령어 | TBD | TBD | 동일 예상 |
| 주소 계산 | TBD | TBD | 동일 예상 |
| Stride | ×4 | ×4 | 동일 |

# 코드

실험 코드: `posts/worklog/cuda-vulkan-sass-series/exp03_memory_coalescing/`

```bash
cmake --build build --target exp03_memory_coalescing
./build/exp03_memory_coalescing/exp03_memory_coalescing
```

# 참고 자료

- [NVIDIA CUDA C++ 모범 사례 가이드: 코얼레싱된 접근](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory)
- gkseofla7의 메모리 코얼레싱 블로그 포스트 (실측 비교)
- [NVIDIA GPU 아키텍처: 메모리 계층](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#device-memory-accesses)

# 다음

→ 워크로그 #06: 바인드리스 접근과 BDA — Vulkan의 버퍼 디바이스 주소가 SASS에서 CUDA 스타일 포인터 연산으로 수렴하는가?
