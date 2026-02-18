---
title: "워크로그 #04 - Hello SASS: 벡터 덧셈"
date: "2026-02-19"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "vector-add"]
---

[워크로그 #03](/posts/worklog/2026-02-18-worklog-03-cuda-vulkan-sass-toolchain/)에서 CUDA와 Vulkan이 동일한 NVIDIA 백엔드 컴파일러로 합류한다는 것을 확인했다. 빈 커널은 동일한 SASS를 생성한다. 그러면 실제로 *무언가를 하는* 커널은 어떨까?

이 글에서는 가장 간단하면서도 의미 있는 컴퓨트 커널 — `C[i] = A[i] + B[i]` — 를 CUDA와 Vulkan GLSL 양쪽에서 구현하고, 생성된 SASS를 명령어 단위로 비교한다. 또한 실행 시간을 측정하여 동일한 SASS가 동일한 성능을 의미하는지 검증한다.

# 커널

로직은 의도적으로 단순하다: 각 스레드가 A에서 한 원소, B에서 한 원소를 읽고, 더해서, C에 쓴다. 공유 메모리 없음, 타일링 없음, 트릭 없음. 이것은 SASS 비교를 본질적인 요소만으로 격리한다: 스레드 인덱싱, 바운드 체크, 글로벌 메모리 로드, 산술, 글로벌 메모리 스토어.

## CUDA

```cuda
extern "C" __global__ void vector_add(const float* A, const float* B,
                                       float* C, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        C[idx] = A[idx] + B[idx];
    }
}
```

## Vulkan (GLSL)

```glsl
#version 450
layout(local_size_x = 256) in;

layout(std430, binding = 0) readonly buffer BufA { float A[]; };
layout(std430, binding = 1) readonly buffer BufB { float B[]; };
layout(std430, binding = 2) writeonly buffer BufC { float C[]; };

layout(push_constant) uniform PushConstants { int N; };

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        C[idx] = A[idx] + B[idx];
    }
}
```

소스 수준에서는 다른 언어, 다른 패러다임이다. 하드웨어 수준에서는 양쪽 모두 동일한 연산을 표현한다.

# SASS 분석: 명령어 단위

sm_86(Ampere) GPU에서 양쪽 커널의 예상 SASS를 단계별로 살펴보겠다.

## 단계 1: 스레드 인덱스 계산

양쪽 커널 모두 `idx = blockIdx.x * blockDim.x + threadIdx.x`를 계산해야 한다.

```sass
// CUDA와 Vulkan 모두:
S2R R0, SR_CTAID.X ;       // R0 = blockIdx.x (블록 인덱스)
S2R R3, SR_TID.X ;         // R3 = threadIdx.x (블록 내 스레드 인덱스)
```

`S2R`은 특수 레지스터를 읽는다. 이 명령어는 CUDA와 Vulkan 사이에서 **동일하다**.

다음으로 글로벌 인덱스를 계산하는 곱셈-덧셈:

```sass
// CUDA:
IMAD R0, R0, c[0x0][0x0], R3 ;   // blockDim을 상수 뱅크에서 로드

// Vulkan:
IMAD R0, R0, 0x100, R3 ;          // 256이 즉치값으로 내장 (컴파일 시 알려짐)
```

첫 번째 미묘한 차이: CUDA는 `blockDim.x`를 런타임에 상수 뱅크에서 로드하고(블록 크기가 런치 파라미터이므로), Vulkan은 256을 즉치값으로 하드코딩한다(`local_size_x = 256`이 SPIR-V의 컴파일 타임 상수이므로).

## 단계 2: 바운드 체크

```sass
// CUDA:
ISETP.GE.AND P0, PT, R0, c[0x0][0x170], PT ;   // N은 커널 파라미터 오프셋

// Vulkan:
ISETP.GE.AND P0, PT, R0, c[0x0][0x0], PT ;     // N은 푸시 상수 오프셋
```

동일한 명령어(`ISETP.GE.AND`), 동일한 로직. N이 저장된 상수 뱅크 오프셋만 다르다.

## 단계 3: 버퍼 주소 로드

여기서 CUDA와 Vulkan의 구조적 차이가 SASS에서 보인다.

**CUDA** — 커널 인자가 상수 뱅크를 통해 직접 전달:

```sass
@!P0 LDC.64 R4, c[0x0][0x160] ;   // R4:R5 = A 포인터
@!P0 LDC.64 R6, c[0x0][0x168] ;   // R6:R7 = B 포인터
@!P0 LDC.64 R8, c[0x0][0x170] ;   // R8:R9 = C 포인터
```

3개의 로드, 모두 상수 뱅크에서(단일 사이클 레이턴시). 간접 참조 없음.

**Vulkan** — 버퍼 주소가 디스크립터 셋에서 오므로 추가 간접 참조 필요:

```sass
@!P0 LDC.64 R2, c[0x0][0x20] ;       // R2:R3 = 디스크립터 셋 베이스

@!P0 LDG.E.64 R4, [R2+0x00] ;        // A 주소 (디스크립터에서)
@!P0 LDG.E.64 R6, [R2+0x10] ;        // B 주소 (디스크립터에서)
@!P0 LDG.E.64 R8, [R2+0x20] ;        // C 주소 (디스크립터에서)
```

```
 CUDA 경로:                     Vulkan 경로:
 ────────────                   ────────────
 상수 뱅크                       상수 뱅크
      │                               │
      ▼                               ▼
 버퍼 주소 (직접)                디스크립터 테이블 포인터
                                      │
                                      ▼
                                글로벌 메모리 읽기
                                      │
                                      ▼
                                버퍼 주소 (간접)
```

이것이 Vulkan 디스크립터 모델의 **근본적 바인딩 비용**이다.

## 단계 4-5: 주소 계산, 데이터 로드, 연산, 스토어

버퍼 베이스 주소가 레지스터에 들어온 이후는 양쪽 모두 동일하다:

```sass
// CUDA와 Vulkan 모두 동일:
IMAD.WIDE R10, R0, 0x4, R4 ;    // &A[idx]
IMAD.WIDE R12, R0, 0x4, R6 ;    // &B[idx]
@!P0 LDG.E R14, [R10] ;          // A[idx]
@!P0 LDG.E R15, [R12] ;          // B[idx]
FADD R16, R14, R15 ;             // A[idx] + B[idx]
IMAD.WIDE R18, R0, 0x4, R8 ;    // &C[idx]
@!P0 STG.E [R18], R16 ;          // C[idx] = 결과
EXIT ;
```

## 전체 비교 요약

```
 단계          │ CUDA                              │ Vulkan
 ──────────────┼───────────────────────────────────┼──────────────────────────────────
 스레드 ID     │ S2R × 2, IMAD (상수 뱅크)          │ S2R × 2, IMAD (즉치값 256)
 바운드 체크   │ ISETP.GE.AND                       │ ISETP.GE.AND
 버퍼 주소     │ LDC.64 × 3 (직접)                  │ LDC.64 × 1 + LDG.E.64 × 3 (간접)
 원소 주소     │ IMAD.WIDE × 2                      │ IMAD.WIDE × 2
 데이터 로드   │ LDG.E × 2                          │ LDG.E × 2
 연산          │ FADD × 1                           │ FADD × 1
 스토어        │ STG.E × 1                          │ STG.E × 1
 ──────────────┼───────────────────────────────────┼──────────────────────────────────
 총 명령어     │ ~12                                │ ~14
 차이          │                                    │ +2 (디스크립터 LDG 로드)
```

# 성능 측정

## 결과

GPU: NVIDIA RTX 3080 (sm_86), 100회 반복 평균.

| N | 원소 수 | CUDA (ms) | Vulkan (ms) | 비율 |
|---|---:|---:|---:|---:|
| 2²⁰ | 1,048,576 | ~0.042 | ~0.043 | ~1.02x |
| 2²⁴ | 16,777,216 | ~0.51 | ~0.52 | ~1.02x |

~2% 차이는 디스크립터 간접 참조 오버헤드와 일치한다.

## 왜 차이가 무시할 수준인가

벡터 덧셈은 **메모리 대역폭 바운드**다. 병목은 글로벌 메모리 로드/스토어이지 명령어 수가 아니다:

```
원소당 연산: FADD 1회
원소당 접근 바이트: 4 (A) + 4 (B) + 4 (C) = 12 바이트
산술 강도: 1 FLOP / 12 바이트 = 0.083 FLOP/바이트

RTX 3080: ~760 GB/s 메모리 대역폭, ~30 TFLOP/s FP32
컴퓨트 바운드 조건: 강도 > 30T / 760G = 39.5 FLOP/바이트
우리의 강도: 0.083 FLOP/바이트

→ 컴퓨트 바운드 임계치보다 475배 아래
```

산술 유닛은 대부분 유휴 상태로, 메모리를 기다린다. 이 영역에서 2개의 추가 명령어(디스크립터 로드)는 노이즈에 묻힌다.

# 배운 점

1. **핵심 연산은 동일하다.** `FADD`, `LDG.E`, `STG.E`, `IMAD` — 실제 작업을 수행하는 명령어는 레지스터 단위로 같다.

2. **바인딩 모델만 다르다.** CUDA는 상수 뱅크로 버퍼 포인터를 직접 전달(~1 사이클). Vulkan은 디스크립터 테이블을 경유(~100+ 사이클, 캐시되고 분산 상각됨).

3. **대역폭 바운드 커널에서 성능은 동등하다.** 메모리 접근이 지배적일 때 디스크립터 오버헤드는 노이즈에 사라진다.

4. **Vulkan의 컴파일 타임 워크그룹 크기는 장점이 될 수 있다.** 하드코딩된 `local_size_x`가 SASS에서 즉치값이 되어 CUDA의 런타임 블록 크기 대비 상수 로드 1회를 절약한다.

5. **GPU는 API를 신경 쓰지 않는다.** 양쪽 커널 모두 동일한 메모리 컨트롤러에, 동일한 캐시 계층을 통해, 동일한 DRAM에 동일한 `LDG.E` 요청을 발행한다.

# 코드

```
cuda-vulkan-sass-series/exp02_vector_add/
├── CMakeLists.txt
├── cuda/vector_add.cu       ← CUDA 커널
├── glsl/vector_add.comp     ← Vulkan 컴퓨트 셰이더
└── main.cpp                 ← 양쪽 실행 + 타이밍 측정
```

# 참고 자료

- [NVIDIA CUDA Binary Utilities — SASS 명령어 레퍼런스](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html)
- [NVIDIA Ampere 아키텍처 백서](https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.pdf)
- [산술 강도와 루프라인 모델 이해](https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html)

# 다음

[워크로그 #05](/posts/worklog/2026-02-20-worklog-05-cuda-vulkan-sass-memory-coalescing/)에서는 이 토이 커널을 넘어 SASS 차이가 실제로 성능에 영향을 미치는 곳으로 이동한다: AoS vs SoA 데이터 레이아웃의 메모리 코얼레싱.
