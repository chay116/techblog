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

[워크로그 #04](/posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/)에서 CUDA와 Vulkan 사이의 유일한 구조적 SASS 차이를 확인했다: 디스크립터 간접 참조. CUDA는 상수 뱅크를 통해 버퍼 주소를 직접 전달한다. Vulkan은 글로벌 메모리의 디스크립터 테이블에서 가져오면서 추가 `LDG` 명령어가 발생한다.

Sebastian Aaltonen의 "There Is No Graphics API" 논제는 최신 Vulkan이 하드웨어 수준에서 CUDA와 수렴하고 있다고 주장한다. 그 증거가 `VK_KHR_buffer_device_address`(BDA) — 셰이더가 푸시 상수를 통해 64비트 GPU 포인터를 직접 받아, 디스크립터 테이블을 완전히 우회하는 Vulkan 확장이다.

BDA가 이론대로 작동한다면, Vulkan SASS는 CUDA와 구조적으로 동일해져야 한다. 검증해보자.

# 세 가지 리소스 바인딩 모델

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                    CUDA: 원시 포인터                             │
 │                                                                  │
 │  호스트: cuLaunchKernel(func, ..., &args, ...)                  │
 │                       │                                          │
 │                       ▼                                          │
 │  상수 뱅크: c[0x0][0x160] = buffer_ptr (64비트)                 │
 │                       │                                          │
 │  SASS: LDC.64 R2, c[0x0][0x160]  ← 1 로드, ~1 사이클          │
 │                       │                                          │
 │  커널: R2가 버퍼 포인터. 끝.                                    │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │               Vulkan: 디스크립터 바인딩 SSBO                    │
 │                                                                  │
 │  호스트: vkUpdateDescriptorSets → vkCmdBindDescriptorSets       │
 │                       │                                          │
 │                       ▼                                          │
 │  상수 뱅크: c[0x0][0x20] = descriptor_table_ptr                 │
 │                       │                                          │
 │  SASS: LDC.64 R2, c[0x0][0x20]    ← 테이블 베이스 로드          │
 │        LDG.E.64 R4, [R2+0x10]     ← 테이블에서 버퍼 주소 로드   │
 │                       │               (~100 사이클, 캐시됨)      │
 │  커널: R4가 버퍼 포인터.                                         │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │          Vulkan: Buffer Device Address (BDA)                    │
 │                                                                  │
 │  호스트: vkCmdPushConstants(cmd, ..., &device_address, 8)       │
 │                       │                                          │
 │                       ▼                                          │
 │  상수 뱅크: c[0x0][0x0] = buffer_ptr (64비트, 푸시 상수 통해)   │
 │                       │                                          │
 │  SASS: LDC.64 R2, c[0x0][0x0]    ← 1 로드, ~1 사이클          │
 │                       │                                          │
 │  커널: R2가 버퍼 포인터. 끝.                                    │
 │                                                                  │
 │  ✓ CUDA와 동일!                                                 │
 └─────────────────────────────────────────────────────────────────┘
```

핵심: Vulkan의 푸시 상수는 CUDA가 커널 파라미터에 사용하는 **동일한 상수 뱅크**에 저장된다. 64비트 디바이스 주소를 푸시 상수로 전달하면, 셰이더는 CUDA가 사용하는 것과 동일한 `LDC.64` 명령어로 접근한다.

# 커널 소스

세 커널 모두 동일한 연산 수행: `out[idx] = data[idx] * 2.0`.

## CUDA — 원시 포인터

```cuda
extern "C" __global__
void read_via_pointer(const float* data, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = data[idx] * 2.0f;
    }
}
```

## Vulkan — 디스크립터 SSBO

```glsl
#version 450
layout(local_size_x = 256) in;
layout(std430, binding = 0) readonly buffer BufIn { float data_in[]; };
layout(std430, binding = 1) writeonly buffer BufOut { float data_out[]; };
layout(push_constant) uniform PushConstants { int N; };
void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) { data_out[idx] = data_in[idx] * 2.0; }
}
```

## Vulkan — BDA

```glsl
#version 450
#extension GL_EXT_buffer_reference : require
#extension GL_EXT_buffer_reference2 : require
layout(local_size_x = 256) in;

layout(buffer_reference, std430, buffer_reference_align = 4)
    readonly buffer FloatBufIn { float data[]; };
layout(buffer_reference, std430, buffer_reference_align = 4)
    writeonly buffer FloatBufOut { float data[]; };

layout(push_constant) uniform PushConstants {
    FloatBufIn inPtr;     // 64비트 디바이스 주소
    FloatBufOut outPtr;   // 64비트 디바이스 주소
    int N;
};

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) { outPtr.data[idx] = inPtr.data[idx] * 2.0; }
}
```

호스트 측:

```cpp
// 디바이스 주소 얻기
VkBufferDeviceAddressInfo addrInfo{VK_STRUCTURE_TYPE_BUFFER_DEVICE_ADDRESS_INFO};
addrInfo.buffer = inputBuffer;
uint64_t inputAddr = vkGetBufferDeviceAddress(device, &addrInfo);

// 셰이더에 푸시
struct PushData { uint64_t inPtr; uint64_t outPtr; int N; };
PushData push = { inputAddr, outputAddr, N };
vkCmdPushConstants(cmd, layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(push), &push);
```

CUDA가 디바이스 포인터를 커널 인자로 전달하는 것과 놀랍도록 비슷하다.

# SASS 비교

## CUDA — 원시 포인터 SASS

```sass
// 버퍼 주소를 상수 뱅크에서 직접 로드 (커널 파라미터)
@!P0 LDC.64 R4, c[0x0][0x160] ;        // data 포인터
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;       // &data[idx]
@!P0 LDG.E R8, [R6] ;                  // data[idx]
@!P0 FMUL R8, R8, 2.0 ;               // × 2.0
@!P0 LDC.64 R10, c[0x0][0x168] ;       // out 포인터
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;
```

**패턴: `LDC.64` → `IMAD.WIDE` → `LDG.E` → 연산 → `STG.E`**

## Vulkan — 디스크립터 SSBO SASS

```sass
// 디스크립터 테이블에서 간접 로드
@!P0 LDC.64 R2, c[0x0][0x20] ;          // 디스크립터 테이블 포인터
@!P0 LDG.E.64 R4, [R2+0x00] ;          // data_in 주소 ← 추가 로드!
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;
@!P0 LDG.E R8, [R6] ;
@!P0 FMUL R8, R8, 2.0 ;
@!P0 LDG.E.64 R10, [R2+0x10] ;         // data_out 주소 ← 추가 로드!
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;
```

**+2 `LDG.E.64` 추가** (디스크립터 해석).

## Vulkan — BDA SASS

```sass
// 푸시 상수에서 직접 로드 (상수 뱅크!)
@!P0 LDC.64 R4, c[0x0][0x0] ;          // inPtr (푸시 상수에서)
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;
@!P0 LDG.E R8, [R6] ;
@!P0 FMUL R8, R8, 2.0 ;
@!P0 LDC.64 R10, c[0x0][0x8] ;         // outPtr (푸시 상수에서)
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;
```

**CUDA와 구조적으로 동일하다.** 상수 뱅크에서 `LDC.64`로 버퍼 주소를 로드. 디스크립터 테이블 없음. 추가 글로벌 메모리 로드 없음.

# 수렴 테이블

```
 명령어 시퀀스 비교:
 ─────────────────────────────────────────────────────────────────────
           CUDA 포인터      Vulkan SSBO          Vulkan BDA
 ─────────────────────────────────────────────────────────────────────
 idx 계산  S2R + IMAD       S2R + IMAD           S2R + IMAD
 바운드    ISETP            ISETP                ISETP
 주소 획득 LDC.64           LDC.64 + LDG.E.64   LDC.64
 원소 주소 IMAD.WIDE        IMAD.WIDE            IMAD.WIDE
 로드      LDG.E            LDG.E                LDG.E
 연산      FMUL             FMUL                 FMUL
 스토어    STG.E            STG.E                STG.E
 ─────────────────────────────────────────────────────────────────────
 총 명령어 ~11              ~13                  ~11
 추가분    기준선            +2 (디스크립터)       +0 ✓
 ─────────────────────────────────────────────────────────────────────
```

# 성능 측정

GPU: NVIDIA RTX 3080 (sm_86), N = 1M, 100회 반복.

| 모델 | 시간 (ms) | vs CUDA |
|---|---:|---:|
| CUDA 원시 포인터 | ~0.038 | 1.00x |
| Vulkan SSBO | ~0.039 | ~1.03x |
| Vulkan BDA | ~0.038 | ~1.00x |

SSBO 오버헤드(~3%)는 디스크립터 테이블 로드에서 발생. BDA는 이를 완전히 제거하여 CUDA와 일치.

# Aaltonen의 수렴 논제가 왜 중요한가

```
Vulkan 버퍼 접근의 진화:
─────────────────────────────────────────────────────
2016  Vulkan 1.0     디스크립터 셋만              CUDA와 거리 멀음
2019  VK 1.2 + BDA   푸시 상수로 원시 포인터 전달  ≈ CUDA 포인터
2023  VK 1.3 + desc  디스크립터 버퍼 + BDA         ≈ CUDA 포인터
─────────────────────────────────────────────────────
```

BDA로 Vulkan 컴퓨트 프로그래밍 모델은:
1. 버퍼 할당
2. 디바이스 주소 획득 (`vkGetBufferDeviceAddress`)
3. 주소를 셰이더에 푸시
4. 셰이더에서 포인터 연산

이것은 정확히 CUDA 모델이다, 다만 API 이름만 다를 뿐.

# 어떤 모델을 사용할 것인가

| 모델 | 사용 사례 | 트레이드오프 |
|---|---|---|
| Vulkan SSBO | 표준 그래픽스 파이프라인, 호환성 | 추가 간접 참조, 하지만 폭넓은 지원 |
| Vulkan BDA | 컴퓨트 집약, 다수 버퍼, 레이 트레이싱 | Vulkan 1.2+ 필요, 수동 수명 관리 |
| CUDA 포인터 | CUDA 에코시스템 | NVIDIA 전용, 크로스 벤더 불가 |

vAI에서는 Vulkan 컴퓨트 백엔드에 BDA가 명확한 선택이다. CUDA 동등 성능에 Vulkan의 이식성을 제공한다.

# 코드

```
cuda-vulkan-sass-series/exp04_bindless_bda/
├── CMakeLists.txt
├── cuda/raw_ptr.cu           ← CUDA 원시 포인터 커널
├── glsl/ubo_access.comp      ← Vulkan SSBO 커널
├── glsl/bda_access.comp      ← Vulkan BDA 커널
└── main.cpp                  ← 3가지 모두 실행, 타이밍 비교
```

# 참고 자료

- Sebastian Aaltonen, "There Is No Graphics API"
- [VK_KHR_buffer_device_address](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_buffer_device_address.html)
- [GL_EXT_buffer_reference](https://github.com/KhronosGroup/GLSL/blob/master/extensions/ext/GLSL_EXT_buffer_reference.txt)
- [NVIDIA 블로그: Vulkan 디바이스 메모리 신기능](https://developer.nvidia.com/blog/new-vulkan-device-memory-features/)

# 다음

[워크로그 #07](/posts/worklog/2026-02-22-worklog-07-cuda-vulkan-sass-jit-pipeline-cache/)에서 마지막 주요 차이를 살펴본다: 컴파일 캐싱. SASS는 동일할 수 있지만, 그 SASS를 생산하는 데 얼마나 비용이 들고, CUDA와 Vulkan은 어떻게 결과를 캐싱하는가?
