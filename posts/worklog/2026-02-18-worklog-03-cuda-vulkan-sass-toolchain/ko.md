---
title: "워크로그 #03 - CUDA vs Vulkan: 컴파일 툴체인 해부"
date: "2026-02-18"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "toolchain"]
---

CUDA와 Vulkan 컴퓨트 셰이더는 결국 동일한 NVIDIA SASS(Shader ASSembly) 명령어로 GPU에서 실행된다. 그러나 그 SASS를 만들어내는 컴파일 경로는 근본적으로 다르다. 이 글에서는 두 파이프라인을 나란히 매핑한다.

# 컴파일 파이프라인

## CUDA: 소스 → PTX → SASS

```
.cu 소스
  │  nvcc (clang 프론트엔드)
  ▼
PTX  (가상 ISA, 텍스트)
  │  ptxas  (또는 cuModuleLoad 시 JIT)
  ▼
SASS  (네이티브 GPU ISA, 바이너리)
```

핵심 포인트:
- **PTX**는 NVIDIA의 안정적 가상 ISA다. 전방 호환(forward-compatible): sm_80용 PTX를 sm_89 SASS로 로드 시 JIT 컴파일 가능.
- **오프라인**: `nvcc --gpu-architecture=sm_86`이 SASS가 내장된 cubin을 생성.
- **JIT**: PTX를 배포하면 드라이버가 `cuModuleLoad` 시점에 컴파일. 결과는 `~/.nv/ComputeCache/`에 캐싱.

## Vulkan: 소스 → SPIR-V → (NVVM IR) → SASS

```
.comp 소스 (GLSL/HLSL)
  │  glslangValidator / DXC
  ▼
SPIR-V  (Khronos 포터블 IR, 바이너리)
  │  NVIDIA Vulkan 드라이버 (내부)
  │    SPIR-V → NVVM IR → PTX 유사 → SASS
  ▼
SASS  (네이티브 GPU ISA, 바이너리)
```

핵심 포인트:
- **SPIR-V**는 Khronos 포터블 셰이더 IR. PTX와 달리 벤더 중립적.
- NVIDIA Vulkan 드라이버 내부에 완전한 SPIR-V → SASS 컴파일러가 포함.
- 파이프라인 생성(`vkCreateComputePipelines`) 시점에 컴파일 수행.
- 사용자에게 보이는 중간 단계 없음 (디스크에 PTX 파일 없음).

# 비교 테이블

| 항목 | CUDA | Vulkan |
|---|---|---|
| 소스 언어 | CUDA C++ | GLSL / HLSL |
| 포터블 IR | PTX (NVIDIA 전용) | SPIR-V (벤더 중립) |
| 오프라인 컴파일러 | nvcc + ptxas | glslangValidator / DXC |
| 런타임 컴파일러 | CUDA 드라이버 JIT | Vulkan 드라이버 (파이프라인 생성 시) |
| 캐시 메커니즘 | `~/.nv/ComputeCache/` | `VkPipelineCache` (앱 관리) |
| SASS 추출 | `cuobjdump --dump-sass` | `VK_KHR_pipeline_executable_properties` |

# 실험: Noop 커널 SASS

완전히 비어있는 커널을 양쪽 경로로 컴파일하여 컴파일러가 생성하는 프롤로그/에필로그를 확인한다.

**CUDA noop_kernel.cu:**
```cuda
extern "C" __global__ void noop_kernel() {
    // 빈 커널
}
```

**Vulkan noop.comp:**
```glsl
#version 450
layout(local_size_x = 64) in;
void main() {
    // 빈 셰이더
}
```

## SASS 출력: CUDA

```
// TBD — 실행: cuobjdump --dump-sass exp01_cuda
// 예상: 최소 프롤로그 (S2R, IMAD 스레드 ID 계산) + EXIT
```

## SASS 출력: Vulkan

```
// TBD — exp01_vulkan을 VK_KHR_pipeline_executable_properties로 실행
// 예상: 유사한 프롤로그 + EXIT, 디스크립터 셋업이 추가될 수 있음
```

## 예상 관찰 사항

1. 양쪽 모두 매우 짧은 SASS (10개 미만 명령어)를 생성할 것.
2. CUDA가 디스크립터 테이블 셋업이 없어 약간 더 간결한 프롤로그를 가질 수 있음.
3. Vulkan은 디스크립터 베이스 주소를 위한 추가 `LDC`(상수 로드) 명령어를 포함할 수 있음.

# 코드

모든 실험 코드: `posts/worklog/cuda-vulkan-sass-series/exp01_toolchain/`

```bash
# 빌드
cd posts/worklog/cuda-vulkan-sass-series
cmake -B build -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build build

# CUDA 실행
./build/exp01_toolchain/exp01_cuda

# Vulkan 실행
./build/exp01_toolchain/exp01_vulkan
```

# 참고 자료

- [NVIDIA PTX ISA 스펙](https://docs.nvidia.com/cuda/parallel-thread-execution/)
- [SPIR-V 사양](https://registry.khronos.org/SPIR-V/)
- [VK_KHR_pipeline_executable_properties](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_pipeline_executable_properties.html)
- Sebastian Aaltonen, "There Is No Graphics API" — 수렴 논제

# 다음

→ 워크로그 #04: 동일 로직 벡터 덧셈 커널, 1:1 SASS 비교.
