---
title: "워크로그 #06 - 바인드리스, BDA, 원시 포인터"
date: "2026-02-21"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "bda", "bindless"]
---

Sebastian Aaltonen의 "There Is No Graphics API" 논제는 Vulkan에 Buffer Device Address(BDA) 같은 기능이 추가되면서 프로그래밍 모델이 하드웨어 수준에서 CUDA와 수렴한다고 주장한다. 이 글에서는 그 주장을 ISA 수준에서 검증한다: BDA 기반 Vulkan SASS가 실제로 CUDA 포인터 SASS처럼 보이는가?

# 세 가지 접근 모델

| 모델 | API | 버퍼 주소가 셰이더에 도달하는 방식 |
|---|---|---|
| 원시 포인터 | CUDA | 커널 파라미터 → 상수 뱅크 → 레지스터 |
| 디스크립터 (SSBO) | Vulkan | 디스크립터 셋 → 디스크립터 테이블 로드 → 레지스터 |
| Buffer Device Address | Vulkan | 푸시 상수 (uint64) → 레지스터 (포인터처럼) |

# 커널 소스

## CUDA 원시 포인터

```cuda
extern "C" __global__
void read_via_pointer(const float* data, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = data[idx] * 2.0f;
    }
}
```

## Vulkan 디스크립터 바인딩 SSBO

```glsl
#version 450
layout(local_size_x = 256) in;

layout(std430, binding = 0) readonly buffer BufIn { float data_in[]; };
layout(std430, binding = 1) writeonly buffer BufOut { float data_out[]; };
layout(push_constant) uniform PushConstants { int N; };

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        data_out[idx] = data_in[idx] * 2.0;
    }
}
```

## Vulkan BDA

```glsl
#version 450
#extension GL_EXT_buffer_reference : require
#extension GL_EXT_buffer_reference2 : require

layout(local_size_x = 256) in;

layout(buffer_reference, std430) readonly buffer FloatBufIn { float data[]; };
layout(buffer_reference, std430) writeonly buffer FloatBufOut { float data[]; };

layout(push_constant) uniform PushConstants {
    FloatBufIn inPtr;
    FloatBufOut outPtr;
    int N;
};

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        outPtr.data[idx] = inPtr.data[idx] * 2.0;
    }
}
```

# SASS 분석

## 예상: CUDA 원시 포인터

```
// TBD — cuobjdump 출력
// 패턴:
//   LDC.64 Rptr, c[0x0][param_offset]    ← 상수 뱅크에서 포인터 로드
//   IMAD    Raddr, Ridx, 4, Rptr          ← 포인터 연산
//   LDG.E   R0, [Raddr]                   ← 글로벌 로드
//   FMUL    R1, R0, 2.0
//   STG.E   [Raddr_out], R1               ← 글로벌 스토어
```

## 예상: Vulkan 디스크립터 SSBO

```
// TBD — pipeline executable properties
// 패턴:
//   LDC.64  Rdesc_table, c[0x0][desc_offset]  ← 디스크립터 테이블 베이스
//   LDG.E.64 Rptr, [Rdesc_table + binding*8]  ← 디스크립터에서 버퍼 주소 로드
//   IMAD     Raddr, Ridx, 4, Rptr
//   LDG.E    R0, [Raddr]
//   FMUL     R1, R0, 2.0
//   STG.E    [Raddr_out], R1
// 추가 간접 참조: 디스크립터 해석을 위한 LDG 1회 추가
```

## 예상: Vulkan BDA

```
// TBD — pipeline executable properties
// 패턴:
//   LDC.64  Rptr, c[0x0][push_const_offset]   ← 푸시 상수에서 64비트 주소 로드
//   IMAD    Raddr, Ridx, 4, Rptr               ← 포인터 연산 (CUDA와 동일!)
//   LDG.E   R0, [Raddr]
//   FMUL    R1, R0, 2.0
//   STG.E   [Raddr_out], R1
// 디스크립터 간접 참조 없음 — CUDA 패턴과 수렴!
```

# 수렴 가설

| 항목 | CUDA | Vulkan SSBO | Vulkan BDA |
|---|---|---|---|
| 주소 소스 | 상수 뱅크 (파라미터) | 디스크립터 테이블 (간접) | 푸시 상수 (직접) |
| 추가 로드 | 0 | 1 (디스크립터 페치) | 0 |
| SASS 패턴 | LDC → IMAD → LDG | LDC → LDG → IMAD → LDG | LDC → IMAD → LDG |
| 수렴 여부 | 기준선 | 다름 | **CUDA와 수렴** |

실제 SASS 덤프로 확인되면, Aaltonen의 논제가 검증된다: BDA는 Vulkan의 메모리 접근 패턴을 ISA 수준에서 CUDA와 동일하게 만든다.

# 성능 결과

| 모델 | 시간 (ms) | 비고 |
|---|---:|---|
| CUDA 원시 포인터 | TBD | 기준선 |
| Vulkan SSBO | TBD | +1 디스크립터 로드 |
| Vulkan BDA | TBD | CUDA와 동등 예상 |

# 코드

실험 코드: `posts/worklog/cuda-vulkan-sass-series/exp04_bindless_bda/`

```bash
cmake --build build --target exp04_bindless_bda
./build/exp04_bindless_bda/exp04_bindless_bda
```

# 참고 자료

- Sebastian Aaltonen, "There Is No Graphics API" — 수렴 논제
- [VK_KHR_buffer_device_address](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_buffer_device_address.html)
- [GL_EXT_buffer_reference](https://github.com/KhronosGroup/GLSL/blob/master/extensions/ext/GLSL_EXT_buffer_reference.txt)
- [NVIDIA Vulkan BDA 사용 가이드](https://developer.nvidia.com/blog/new-vulkan-device-memory-features/)

# 다음

→ 워크로그 #07: JIT과 파이프라인 캐싱 — 첫 번째 디스패치 뒤에 숨어있는 컴파일 비용.
