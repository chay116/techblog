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

가장 단순하면서도 의미 있는 컴퓨트 커널은 `C[i] = A[i] + B[i]`다. CUDA와 Vulkan에서 동일한 로직을 구현하면 노이즈가 최소화된 1:1 SASS 비교가 가능하다. 이 글에서는 생성된 SASS를 분석하고 실행 시간을 측정한다.

# 커널 소스

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

# SASS 비교

## CUDA SASS

```
// TBD — cuobjdump --dump-sass 출력
// 예상 명령어:
//   S2R  Rx, SR_CTAID.X       // blockIdx.x
//   S2R  Ry, SR_TID.X         // threadIdx.x
//   IMAD Ridx, Rx, blockDim, Ry
//   ISETP.LT P0, Ridx, N
//   @P0 LDG.E R0, [A + Ridx*4]
//   @P0 LDG.E R1, [B + Ridx*4]
//   @P0 FADD R2, R0, R1
//   @P0 STG.E [C + Ridx*4], R2
//   EXIT
```

## Vulkan SASS

```
// TBD — VK_KHR_pipeline_executable_properties 출력
// 예상: CUDA와 구조적으로 동일, 차이점 가능:
//   - 디스크립터 셋에서 버퍼 주소를 가져오는 디스크립터 로드(LDC)
//   - 핵심 FADD, LDG.E, STG.E 명령어는 동일
//   - S2R을 통한 스레드 ID 계산은 동일해야 함
```

## 핵심 비교 포인트

| 명령어 | CUDA | Vulkan | 비고 |
|---|---|---|---|
| 스레드 ID 계산 | S2R + IMAD | S2R + IMAD | 동일해야 함 |
| 버퍼 주소 | 파라미터에서 직접 | 디스크립터에서 LDC | Vulkan 간접 참조 |
| 로드 | LDG.E | LDG.E | 동일 메모리 유닛 |
| 덧셈 | FADD | FADD | 동일 FP32 파이프 |
| 스토어 | STG.E | STG.E | 동일 메모리 유닛 |
| 바운드 체크 | ISETP.LT + 프레디킷 | ISETP.LT + 프레디킷 | 동일 패턴 |

# 성능 결과

| N | CUDA (ms) | Vulkan (ms) | 비율 |
|---|---:|---:|---:|
| 1M (2²⁰) | TBD | TBD | TBD |
| 16M (2²⁴) | TBD | TBD | TBD |

예상: 거의 동일한 타이밍. 양쪽 모두 동일한 기능적 SASS로 컴파일되며, 메모리 대역폭이 지배적.

# 분석

벡터 덧셈 커널은 CUDA와 Vulkan 간에 거의 동일한 SASS를 생성해야 한다. 유의미한 차이는 버퍼 베이스 주소를 해석하는 방식뿐:

- **CUDA**: 커널 파라미터로 주소 전달 (상수 뱅크 로드)
- **Vulkan**: 디스크립터 셋을 통한 간접 주소 로드 (추가 LDC 명령어)

벡터 덧셈처럼 메모리 바운드 커널에서는 이 하나의 추가 명령어가 성능에 미치는 영향이 무시할 수준이다.

# 코드

실험 코드: `posts/worklog/cuda-vulkan-sass-series/exp02_vector_add/`

```bash
cmake --build build --target exp02_vector_add
./build/exp02_vector_add/exp02_vector_add
```

# 참고 자료

- [NVIDIA SASS 명령어 셋 (비공식)](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html)
- [cuobjdump 문서](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html#cuobjdump)

# 다음

→ 워크로그 #05: 메모리 코얼레싱 패턴 — SASS 차이가 실제 성능에 영향을 미치는 지점.
