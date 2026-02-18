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

이전 두 글에서 CUDA와 Vulkan이 단순 커널에서 거의 동일한 SASS를 생성하며, 유일한 차이가 디스크립터 바인딩 오버헤드라는 것을 확인했다. 벡터 덧셈 커널에서는 순수 대역폭 바운드여서 그것이 문제가 되지 않았다.

이제 *메모리 접근 패턴* — 워프 내 스레드들이 어떤 주소에 접근하는가 — 이 성능에 극적인 차이를 만드는 경우를 살펴보자. 하드웨어는 같다. SASS 명령어(`LDG.E`)도 같다. 하지만 주소가 어떻게 배치되느냐에 따라 메모리 컨트롤러가 같은 워프에 대해 1개의 트랜잭션을 실행할 수도 있고 4개를 실행할 수도 있다.

# 문제: AoS vs SoA

N개의 파티클이 각각 4개의 float 필드 `x, y, z, w`를 갖고 있다. `x` 필드만 읽고 싶다.

## Array of Structures (AoS)

```
메모리 레이아웃 (AoS):
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───
│ x₀   │ y₀   │ z₀   │ w₀   │ x₁   │ y₁   │ z₁   │ w₁   │ ...
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴───
  4B     4B     4B     4B     4B     4B     4B     4B

스레드 0이 x₀를 읽음: 오프셋 0
스레드 1이 x₁를 읽음: 오프셋 16
스레드 2가 x₂를 읽음: 오프셋 32

연속 스레드 간 stride: 16 바이트
```

## Structure of Arrays (SoA)

```
메모리 레이아웃 (SoA):
┌──────┬──────┬──────┬──────┬──────┬──────┬───
│ x₀   │ x₁   │ x₂   │ x₃   │ x₄   │ x₅   │ ...
└──────┴──────┴──────┴──────┴──────┴──────┴───
  4B     4B     4B     4B     4B     4B

스레드 0이 x₀를 읽음: 오프셋 0
스레드 1이 x₁를 읽음: 오프셋 4
스레드 2가 x₂를 읽음: 오프셋 8

연속 스레드 간 stride: 4 바이트
```

# NVIDIA 메모리 코얼레싱 동작 원리

NVIDIA GPU에서 메모리 컨트롤러는 **128바이트 캐시 라인 섹터** 단위로 요청을 처리한다. 워프(32 스레드)가 로드 명령어를 발행하면, 하드웨어가 개별 스레드 요청을 최소 수의 128바이트 트랜잭션으로 합친다:

```
128바이트 캐시 라인 1개 = 32 × 4바이트 float

SoA 패턴 (stride 4B):
┌────────────────────── 128 바이트 ─────────────────────┐
│ x₀  x₁  x₂  x₃  x₄  x₅  ... x₃₁                    │
└───────────────────────────────────────────────────────┘
스레드: 0   1   2   3   4   5       31
→ 1 트랜잭션, 128B 로드, 128B 유효 = 100% 효율

AoS 패턴 (stride 16B):
┌────────────── 128 바이트 ──────────────┐
│ x₀ y₀ z₀ w₀  x₁ y₁ z₁ w₁ ... x₇ y₇ z₇ w₇ │
└───────────────────────────────────────┘
스레드: 0          1              7
→ 128B 트랜잭션당 8 스레드만 처리
→ 32 스레드 전체에 4 트랜잭션 필요
→ 512B 로드, 128B 유효 = 25% 효율
```

전체 그림:

```
 AoS: 32 스레드가 x[idx] 읽기          SoA: 32 스레드가 x[idx] 읽기
 ─────────────────────────────          ─────────────────────────────
 스레드  주소             캐시 라인      스레드  주소             캐시 라인
 ──────  ──────────────  ──────────     ──────  ──────────────  ──────────
 T0      base + 0        라인 0         T0      base + 0        라인 0
 T1      base + 16       라인 0         T1      base + 4        라인 0
 T2      base + 32       라인 0         T2      base + 8        라인 0
 ...                                    ...
 T7      base + 112      라인 0         T31     base + 124      라인 0
 T8      base + 128      라인 1
 ...                                    → 1 트랜잭션, 낭비 0%
 T31     base + 496      라인 3

 → 4 트랜잭션, 낭비 75%
```

# SASS 분석

## SoA — 연속 접근

```sass
// SoA read_soa_x — CUDA SASS (sm_86)
S2R R0, SR_CTAID.X ;
S2R R3, SR_TID.X ;
IMAD R0, R0, c[0x0][0x0], R3 ;
ISETP.GE.AND P0, PT, R0, c[0x0][0x170], PT ;

@!P0 LDC.64 R4, c[0x0][0x160] ;      // x[] 베이스 포인터
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;     // &x[idx]  ← stride 4
@!P0 LDG.E R8, [R6] ;                // x[idx]   ← 코얼레싱된 로드

@!P0 LDC.64 R10, c[0x0][0x168] ;
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;   // &out[idx]
@!P0 STG.E [R12], R8 ;               // out[idx] = x[idx]
EXIT ;
```

핵심: `IMAD.WIDE`의 stride가 `0x4`(4바이트). 연속 스레드가 연속 주소에 접근 → 단일 128바이트 트랜잭션으로 코얼레싱.

## AoS — 스트라이드 접근

```sass
// AoS read_aos_x — CUDA SASS (sm_86)
S2R R0, SR_CTAID.X ;
S2R R3, SR_TID.X ;
IMAD R0, R0, c[0x0][0x0], R3 ;
ISETP.GE.AND P0, PT, R0, c[0x0][0x170], PT ;

@!P0 LDC.64 R4, c[0x0][0x160] ;      // particles[] 베이스
@!P0 IMAD.WIDE R6, R0, 0x10, R4 ;    // &particles[idx]
                                       //          ^^^ 0x10 = 16 = sizeof(Particle)
@!P0 LDG.E R8, [R6] ;                // particles[idx].x  ← .x만 읽음!

@!P0 LDC.64 R10, c[0x0][0x168] ;
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;
EXIT ;
```

핵심 차이: `IMAD.WIDE`의 stride가 `0x10`(16바이트). `LDG.E` 명령어 자체는 동일한 4바이트 로드이지만, 주소가 16바이트 간격이므로 메모리 컨트롤러는 4배 많은 트랜잭션이 필요하다.

**SASS 명령어 수는 거의 동일하다.** 성능 차이는 전적으로 메모리 접근 패턴에서 발생한다.

## 와이드 로드 최적화 가능성 (LDG.E.128)

컴파일러가 구조체 레이아웃을 인식하면 와이드 로드를 내보낼 수 있다:

```sass
// 최적화된 AoS (가설):
@!P0 LDG.E.128 R8, [R6] ;   // 16바이트 로드 (x, y, z, w 한 번에)
// R8만 사용 (x 필드), R9, R10, R11은 버림
```

이렇게 하면 트랜잭션 수는 줄지만, 쓰지 않는 y, z, w를 읽느라 대역폭과 레지스터 파일을 낭비한다.

# 성능 결과

NVIDIA RTX 3080 (sm_86), N = 4M 파티클, 100회 반복.

| 변형 | 시간 (ms) | 실효 대역폭 (GB/s) | 워프당 메모리 트랜잭션 |
|---|---:|---:|---:|
| CUDA SoA | ~0.17 | ~95 | 1 (로드) + 1 (스토어) |
| CUDA AoS | ~0.58 | ~28 | 4 (로드) + 1 (스토어) |
| Vulkan SoA | ~0.17 | ~95 | 1 (로드) + 1 (스토어) |
| Vulkan AoS | ~0.59 | ~27 | 4 (로드) + 1 (스토어) |

```
 성능 (낮을수록 좋음):
 ────────────────────────────────────────────────────
 CUDA  SoA  ████████░░░░░░░░░░░░░░░░  0.17 ms
 CUDA  AoS  ██████████████████████████████  0.58 ms
 Vulk  SoA  ████████░░░░░░░░░░░░░░░░  0.17 ms
 Vulk  AoS  ██████████████████████████████  0.59 ms
 ────────────────────────────────────────────────────
 SoA가 AoS 대비 속도 향상: ~3.4배
```

관찰:

1. **SoA가 AoS보다 3.4배 빠르다** — 이론적 4배에 근접 (4배와의 차이는 스토어가 레이아웃에 관계없이 항상 코얼레싱되기 때문).

2. **CUDA와 Vulkan은 노이즈 범위 내에서 동일** — 같은 접근 패턴 → 같은 메모리 컨트롤러 동작 → 같은 성능.

3. **SASS 명령어 수는 AoS와 SoA 사이에 거의 동일** — 성능 차이는 명령어 스트림이 아니라 메모리 접근 패턴에서 발생.

# 대역폭 계산

```
원소당 데이터:
  SoA: 4B 읽기 (x) + 4B 쓰기 (out) = 8 바이트
  AoS: 16B 읽기 (x,y,z,w) + 4B 쓰기 (out) = 20 바이트 실제 전송
       필요한 것: 4B 읽기 + 4B 쓰기 = 8 바이트
       → 원소당 12 바이트 낭비

N = 4M 원소:
  SoA 전송량: 4M × 8B = 32 MB
  AoS 전송량: 4M × 20B = 80 MB

RTX 3080 피크 대역폭: ~760 GB/s
  SoA 이론 최소 시간: 32 MB / 760 GB/s ≈ 0.042 ms
  AoS 이론 최소 시간: 80 MB / 760 GB/s ≈ 0.105 ms

  SoA 측정값: 0.17 ms → 피크의 ~42% (작은 커널 전형)
  AoS 측정값: 0.58 ms → 피크의 ~30% (캐시 라인 추출이 효율을 더 떨어뜨림)
```

# CUDA vs Vulkan: 코얼레싱에 차이 없음

핵심 발견: **메모리 코얼레싱 동작은 접근 패턴에 의해 결정되지, API에 의해 결정되지 않는다.** 메모리 컨트롤러는 워프에서 오는 주소를 본다 — "CUDA 주소"나 "Vulkan 주소" 같은 개념은 없다. 워프 내 스레드들이 연속 4바이트 주소에 접근하면 완벽한 코얼레싱을 얻는다. 16바이트 간격이면 25% 효율을 얻는다. API는 무관하다.

# vAI 실전 시사점

1. **부분 읽기 데이터는 항상 SoA를 사용하라.** 커널이 위치 데이터만 필요하면, 속도/질량/수명과 함께 패킹하지 마라.

2. **메모리 패턴에 있어 API 선택은 중요하지 않다.** CUDA든 Vulkan이든 에코시스템 필요에 따라 선택하라, 메모리 성능이 아니라.

3. **Nsight Compute로 프로파일링하라:** `l1tex__t_sectors_pipe_lsu_mem_global_op_ld.sum`으로 실제 페치된 섹터 수를 확인할 수 있다.

# 코드

```
cuda-vulkan-sass-series/exp03_memory_coalescing/
├── CMakeLists.txt
├── cuda/coalesce_aos.cu      ← AoS 읽기 커널
├── cuda/coalesce_soa.cu      ← SoA 읽기 커널
├── glsl/coalesce_aos.comp    ← Vulkan AoS
├── glsl/coalesce_soa.comp    ← Vulkan SoA
└── main.cpp                  ← 4가지 변형 모두 실행 + 타이밍
```

# 참고 자료

- [NVIDIA CUDA C++ 모범 사례 가이드: 코얼레싱된 글로벌 메모리 접근](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory)
- [NVIDIA Ampere GA102 아키텍처 백서](https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.pdf)
- [Nsight Compute 메모리 처리량 분석](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html)

# 다음

[워크로그 #06](/posts/worklog/2026-02-21-worklog-06-cuda-vulkan-sass-bindless-bda/)에서는 디스크립터 간접 참조 문제를 정면으로 다룬다: Vulkan의 Buffer Device Address(BDA)가 디스크립터 테이블 룩업을 제거하고 CUDA와 동일한 SASS를 생성할 수 있는가?
