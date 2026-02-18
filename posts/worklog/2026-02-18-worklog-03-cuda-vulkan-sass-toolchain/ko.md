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

CUDA든 Vulkan이든, 디스패치하는 모든 컴퓨트 워크로드는 결국 동일한 NVIDIA SASS 명령어로 같은 실리콘 위에서 실행된다. GPU는 어떤 API가 작업을 제출했는지 모른다. 그러나 소스 코드에서 SASS까지의 여정은 두 에코시스템 사이에서 근본적으로 다르며, 그 여정을 이해하는 것이 두 API가 동일한 하드웨어를 대상으로 함에도 왜 그토록 다르게 느껴지는지를 이해하는 열쇠다.

이 글은 CUDA와 Vulkan을 ISA 레벨에서 비교하는 5편 시리즈의 첫 번째다. 가장 처음부터 시작한다: 소스 코드가 어떻게 GPU 머신 코드가 되는가?

# 왜 이것이 중요한가

혹시 이런 궁금증을 가진 적이 있는가:

- "Vulkan이 SPIR-V를 거치니까 CUDA보다 느린 건가?"
- "NVIDIA 드라이버가 SPIR-V에서 만드는 SASS와 nvcc가 CUDA에서 만드는 SASS의 품질이 같은가?"
- "런타임에 정확히 어디서 컴파일이 일어나는가?"

스포일러: 양쪽 경로 모두 NVIDIA 드라이버 내부의 동일한 백엔드 컴파일러로 수렴한다. 차이는 그 컴파일이 *언제*, *어떻게* 트리거되는가에 있지 — 출력의 품질에 있지 않다.

# 전체 그림

NVIDIA GPU의 전체 컴파일 과정은 다음과 같다:

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                         소스 코드                                │
 │                                                                  │
 │    .cu (CUDA C++)              .comp / .hlsl (GLSL / HLSL)     │
 └────────┬─────────────────────────────────┬──────────────────────┘
          │                                 │
          │  nvcc                           │  glslangValidator / DXC
          │  (clang 프론트엔드 + ptxas)      │  (Khronos 툴체인)
          ▼                                 ▼
 ┌─────────────────┐              ┌─────────────────┐
 │   PTX            │              │   SPIR-V         │
 │   (NVIDIA vISA)  │              │   (Khronos IR)   │
 │   텍스트, NVIDIA  │              │   바이너리, 벤더  │
 │   GPU 세대 간     │              │   중립            │
 │   이식 가능       │              │                   │
 └────────┬─────────┘              └────────┬──────────┘
          │                                 │
          │  ptxas (오프라인)                │  NVIDIA Vulkan 드라이버
          │  또는 CUDA 드라이버 (JIT)        │  (vkCreateComputePipelines 시)
          │                                 │
          │         ┌───────────────────┐   │
          └────────►│  NVIDIA 백엔드    │◄──┘
                    │  컴파일러 (NVVM)   │
                    │                   │
                    │  최적화           │
                    │  레지스터 할당     │
                    │  스케줄링         │
                    └────────┬──────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   SASS           │
                    │   (네이티브 ISA)  │
                    │   sm_86, sm_89,  │
                    │   sm_90, ...     │
                    └─────────────────┘
```

핵심 인사이트: **양쪽 경로 모두 동일한 NVIDIA 백엔드 컴파일러로 합류한다.** PTX 경로와 SPIR-V 경로는 수렴한다. 이것이 SASS 레벨에서 출력이 거의 동일한 이유다.

# CUDA 컴파일 경로 상세

## 단계 1: nvcc 프론트엔드

`nvcc`는 단일 컴파일러가 아니라 오케스트레이터다. 다음을 실행하면:

```bash
nvcc -arch=sm_86 -o kernel.cubin kernel.cu
```

내부적으로 `nvcc`는 `.cu` 파일을 호스트 코드와 디바이스 코드로 분리한다. 디바이스 코드는 CUDA 문법(`__global__`, `__shared__`, `blockIdx` 등)을 이해하는 수정된 Clang 프론트엔드를 통과하여 NVIDIA의 PTX 중간 표현을 생성한다.

```
kernel.cu
  │
  ├─► 호스트 코드 ──► 시스템 C++ 컴파일러 (MSVC, GCC, Clang)
  │
  └─► 디바이스 코드 ──► Clang (CUDA 모드) ──► PTX
                                                │
                                                └──► ptxas ──► SASS (cubin)
```

## 단계 2: PTX — 가상 ISA

PTX(Parallel Thread Execution)는 NVIDIA의 가상 명령어 셋이다. GPU 병렬성을 위해 설계된 LLVM IR이라고 생각하면 된다. 간단한 스레드 인덱스 계산의 PTX는 이렇다:

```
// PTX: int idx = blockIdx.x * blockDim.x + threadIdx.x;
mov.u32     %r1, %ctaid.x;      // blockIdx.x
mov.u32     %r2, %ntid.x;       // blockDim.x
mov.u32     %r3, %tid.x;        // threadIdx.x
mad.lo.s32  %r4, %r1, %r2, %r3; // idx = blockIdx.x * blockDim.x + threadIdx.x
```

PTX의 핵심 특성:
- **텍스트 형식** — 사람이 읽을 수 있고, 검사와 수정 가능
- **전방 호환** — sm_80용 PTX가 sm_89에서 실행 가능 (드라이버가 JIT 컴파일)
- **무한 가상 레지스터** — `%r1`, `%r2` 등은 가상이며, ptxas가 물리 레지스터에 매핑
- **스케줄링 정보 없음** — 명령어 순서는 ptxas/SASS 백엔드가 결정

코드가 생성하는 PTX를 확인하려면:

```bash
nvcc -arch=sm_86 --ptx -o kernel.ptx kernel.cu
```

## 단계 3: ptxas — PTX에서 SASS로

`ptxas`가 진정한 최적화기다. PTX를 받아서 특정 GPU 아키텍처의 네이티브 머신 코드인 SASS를 생성한다. 이 단계에서:

- 가상 레지스터가 물리 레지스터에 할당됨 (최신 GPU에서 스레드당 최대 255개)
- 레이턴시를 숨기기 위한 명령어 스케줄링
- 분기 최적화를 위한 프레디케이션 적용
- 메모리 접근 패턴 최적화

## 단계 4: SASS 추출

cubin이나 CUDA 커널이 링크된 실행 파일이 있으면 SASS를 검사할 수 있다:

```bash
cuobjdump --dump-sass kernel.cubin
```

우리의 noop 커널에 대한 출력은 다음과 같다:

```sass
// ---- noop_kernel ----
// SM_86 (Ampere)
.text.noop_kernel:
        /*0000*/                   MOV R1, c[0x0][0x28] ;  // 스택 포인터 설정
        /*0010*/                   EXIT ;                    // 즉시 리턴
        /*0020*/                   BRA 0x20 ;                // 도달 불가 (패딩)
```

이것이 전부다. 의미 있는 명령어 2개. GPU가 스택 포인터를 설정하고 (사용하지 않더라도 프롤로그는 표준화되어 있다) 즉시 종료한다.

# Vulkan 컴파일 경로 상세

## 단계 1: GLSL/HLSL에서 SPIR-V로

Vulkan은 GLSL이나 HLSL을 직접 받지 않는다. Khronos가 정의한 바이너리 IR인 SPIR-V로 사전 컴파일해야 한다:

```bash
glslangValidator --target-env vulkan1.2 -o noop.spv noop.comp
```

SPIR-V는 구조화된 SSA 형태의 바이너리다. PTX와 달리:
- **바이너리 형식** — 사람이 읽을 수 없음 (디스어셈블하려면 `spirv-dis` 사용)
- **벤더 중립** — NVIDIA, AMD, Intel, Qualcomm, ARM 등에서 실행
- **PTX보다 높은 수준** — 타입 정보, 구조화된 제어 흐름, 데코레이션 유지

빈 셰이더의 디스어셈블된 SPIR-V:

```spirv
; SPIR-V 디스어셈블리 (단순화)
               OpCapability Shader
               OpMemoryModel Logical GLSL450
               OpEntryPoint GLCompute %main "main" %gl_GlobalInvocationID
               OpExecutionMode %main LocalSize 64 1 1
       %void = OpTypeVoid
       %func = OpTypeFunction %void
       %main = OpFunction %void None %func
      %entry = OpLabel
               OpReturn
               OpFunctionEnd
```

빈 셰이더조차 SPIR-V는 구조 정보를 유지한다: 엔트리 포인트, 실행 모드(워크그룹 크기), 타입 선언. 이것은 GPU 드라이버가 디스패치를 설정하는 데 필요한 정보다.

## 단계 2: NVIDIA 드라이버 — SPIR-V에서 SASS로

`vkCreateComputePipelines`를 호출하면, NVIDIA Vulkan 드라이버는:

1. **SPIR-V 파싱** — 구조 검증, 엔트리 포인트와 실행 모드 추출
2. **NVVM IR로 하위 변환** — NVIDIA의 내부 LLVM 기반 IR (CUDA 경로와 동일한 IR)
3. **최적화** — ptxas와 동일한 최적화 패스
4. **SASS 생성** — 동일한 백엔드 코드 생성기

```
vkCreateComputePipelines(device, cache, 1, &createInfo, NULL, &pipeline)
    │
    │  NVIDIA 드라이버 내부:
    │
    ├─► SPIR-V 파서
    │       │
    │       ▼
    ├─► NVVM IR (LLVM 기반)  ◄── CUDA와의 수렴 지점!
    │       │
    │       ▼
    ├─► 백엔드 최적화기
    │       │
    │       ▼
    └─► SASS 바이너리 (VkPipeline 객체에 내장)
```

핵심: **NVVM IR 단계는 CUDA와 Vulkan이 공유한다.** NVIDIA 드라이버는 양쪽 경로에 대해 본질적으로 동일한 백엔드 컴파일러를 갖고 있다.

## 단계 3: Vulkan SASS 추출

CUDA처럼 `cuobjdump`만 실행하면 되는 것과 달리, Vulkan SASS 추출은 `VK_KHR_pipeline_executable_properties` 확장이 필요하다:

```cpp
// 파이프라인 생성 시 플래그 설정:
pipelineCI.flags = VK_PIPELINE_CREATE_CAPTURE_INTERNAL_REPRESENTATIONS_BIT_KHR;

// 생성 후 내부 표현 쿼리:
vkGetPipelineExecutableInternalRepresentationsKHR(device, &execInfo,
                                                   &irCount, irs);

// NVIDIA 드라이버가 반환하는 IR들:
//   - "NVVM IR" (LLVM 비트코드)
//   - "PTX"     (맞다, 동일한 PTX!)
//   - "SASS"    (네이티브 ISA 텍스트)
```

주목할 점: NVIDIA Vulkan 드라이버는 PTX를 내부 표현 중 하나로 노출한다. 이것은 SPIR-V가 SASS에 도달하기 전에 PTX 동등한 IR을 통과한다는 것을 확인해준다.

# Noop 커널 실험

가능한 가장 간단한 커널 — 아무것도 하지 않는 커널 — 의 실제 컴파일 출력을 비교해보자.

## CUDA 측

```cuda
// noop_kernel.cu
extern "C" __global__ void noop_kernel() {
    // 의도적으로 비어있음
}
```

```sass
// CUDA SASS (sm_86, Ampere):
.text.noop_kernel:
  /*0000*/  MOV R1, c[0x0][0x28] ;          // 스택 프레임 크기 로드
  /*0010*/  EXIT ;                            // 완료
  /*0020*/  BRA 0x20 ;                        // 패딩 (도달 불가)
  /*0030*/  NOP ;                             // 정렬
```

**의미 있는 명령어 2개.**

## Vulkan 측

```glsl
// noop.comp
#version 450
layout(local_size_x = 64) in;
void main() {
    // 의도적으로 비어있음
}
```

```sass
// Vulkan SASS (NVIDIA 드라이버, sm_86):
.text.main:
  /*0000*/  MOV R1, c[0x0][0x28] ;          // 스택 포인터 (CUDA와 동일)
  /*0010*/  EXIT ;                            // 완료
  /*0020*/  BRA 0x20 ;                        // 패딩
  /*0030*/  NOP ;                             // 정렬
```

**동일하다.** 의미 있는 명령어 2개로 같다. 리소스에 접근하지 않는 커널에서 양쪽 경로는 바이트 단위로 동일한 SASS를 생성한다.

## 이것이 의미하는 바

```
 CUDA noop 커널 SASS             Vulkan noop 셰이더 SASS
 ──────────────────────          ───────────────────────
 MOV R1, c[0x0][0x28]           MOV R1, c[0x0][0x28]
 EXIT                            EXIT
 BRA 0x20                        BRA 0x20
 NOP                             NOP
 ──────────────────────          ───────────────────────
 총 명령어: 4                    총 명령어: 4
 의미 있는: 2                    의미 있는: 2
```

컴파일 툴체인은 다르다. 소스 언어는 다르다. 중간 표현은 다르다. 하지만 최종 출력 — GPU 실리콘이 실제로 보는 유일한 것 — 은 같다.

# 차이가 시작되는 지점

noop 케이스는 자명하게 동일하다. 커널이 실제로 작업을 수행하면 차이가 나타난다:

## 1. 리소스 바인딩

CUDA는 커널 인자를 **상수 뱅크**(`c[0x0][offset]`)를 통해 전달한다. 각 인자는 알려진 고정 오프셋에 있다.

Vulkan은 **디스크립터 셋**을 통해 버퍼 주소를 해석한다. 드라이버가 디스크립터 테이블 베이스 주소를 로드한 다음 인덱싱한다. 이것은 간접 참조를 추가한다:

```sass
// CUDA: 상수 뱅크에서 직접 로드
LDC.64 R2, c[0x0][0x160] ;   // 파라미터에서 버퍼 포인터 로드

// Vulkan (디스크립터 바인딩): 간접 로드
LDC.64 R2, c[0x0][0x0]  ;    // 디스크립터 테이블 베이스 로드
LDG.E.64 R4, [R2+0x10] ;     // 디스크립터에서 버퍼 주소 로드
```

이 추가 `LDG`가 Vulkan 바인딩 모델의 비용이다. 이것은 워크로그 #06 (BDA)에서 자세히 다룬다.

## 2. 워크그룹 크기 인코딩

CUDA는 블록 크기를 런치 설정(런타임)에서 인코딩한다. Vulkan은 로컬 워크그룹 크기를 SPIR-V에 베이크인한다(`OpExecutionMode ... LocalSize 64 1 1`). 드라이버가 이를 기반으로 최적화할 수 있다 — 예를 들어 워크그룹 크기가 컴파일 시 알려져 있으면, 컴파일러가 일부 범위 체크를 제거할 수 있다.

## 3. 컴파일 타이밍

| 이벤트 | CUDA (오프라인) | CUDA (JIT) | Vulkan |
|---|---|---|---|
| 소스 → IR | 빌드 시 (nvcc) | 빌드 시 (nvcc → PTX) | 빌드 시 (glslang → SPIR-V) |
| IR → SASS | 빌드 시 (ptxas) | 첫 `cuModuleLoad` | 첫 `vkCreateComputePipelines` |
| 캐시 | N/A (사전 컴파일) | `~/.nv/ComputeCache/` | `VkPipelineCache` (앱 관리) |

실질적 결과: Vulkan 애플리케이션은 파이프라인을 처음 생성할 때 "셰이더 컴파일 끊김"을 경험한다. cubin(사전 컴파일된 SASS)을 배포하는 CUDA 애플리케이션은 런타임 컴파일 비용이 0이다.

# SASS 검사 실전 가이드

## CUDA

```bash
# .cu 소스에서 — cubin으로 컴파일 후 덤프
nvcc -arch=sm_86 -cubin -o kernel.cubin kernel.cu
cuobjdump --dump-sass kernel.cubin

# 실행 파일에서
cuobjdump --dump-sass ./my_cuda_program

# PTX만 (중간 단계)
nvcc -arch=sm_86 --ptx -o kernel.ptx kernel.cu

# 특정 함수만
cuobjdump --dump-sass --function-name vector_add kernel.cubin
```

## Vulkan

```cpp
// 디바이스 생성 시 확장 활성화
const char* ext = VK_KHR_PIPELINE_EXECUTABLE_PROPERTIES_EXTENSION_NAME;

// 파이프라인 생성 시 캡처 플래그 설정:
createInfo.flags |= VK_PIPELINE_CREATE_CAPTURE_INTERNAL_REPRESENTATIONS_BIT_KHR;

// 생성 후 내부 표현 순회:
vkGetPipelineExecutablePropertiesKHR(device, &pipeInfo, &count, props);
vkGetPipelineExecutableInternalRepresentationsKHR(device, &execInfo, &irCount, irs);

// 각 IR: name ("SASS", "PTX", "NVVM IR"), isText, dataSize, pData
```

# 실험 코드

```
cuda-vulkan-sass-series/exp01_toolchain/
├── CMakeLists.txt
├── cuda/noop_kernel.cu      ← 빈 __global__ 커널
├── glsl/noop.comp           ← 빈 컴퓨트 셰이더
├── main_cuda.cpp            ← 모듈 로드, 실행, 빌드 시 SASS 덤프
└── main_vulkan.cpp          ← exec props로 파이프라인 생성, SASS 추출
```

```bash
cd posts/worklog/cuda-vulkan-sass-series
cmake -B build -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build build
./build/exp01_toolchain/exp01_cuda
./build/exp01_toolchain/exp01_vulkan
```

# 핵심 요약

1. **동일한 백엔드 컴파일러.** CUDA와 Vulkan 모두 NVIDIA에서 동일한 NVVM 기반 백엔드로 합류한다. 프론트엔드는 다르지만 백엔드는 수렴한다.

2. **SASS가 진실.** PTX, SPIR-V, NVVM IR — 이것들은 모두 중간 단계다. SASS만이 하드웨어에서 실행된다. SASS 미만의 것을 비교하는 것은 사과와 오렌지를 비교하는 것이다.

3. **Noop = 동일.** 작업이 없는 커널에서 양쪽 경로는 바이트 단위로 동일한 SASS를 생성한다. 차이는 리소스 바인딩, 메모리 접근 패턴, 컴파일 힌트가 개입할 때만 나타난다.

4. **Vulkan의 오버헤드는 바인딩이지, 연산이 아니다.** Vulkan 커널의 추가 SASS 명령어는 디스크립터 간접 참조에서 비롯되지, 열등한 코드 생성에서 비롯되지 않는다.

5. **양쪽 모두 검사 가능하다.** CUDA는 `cuobjdump`, Vulkan은 `VK_KHR_pipeline_executable_properties`. 어느 쪽도 블랙박스가 아니다.

# 참고 자료

- [NVIDIA PTX ISA 8.5 사양](https://docs.nvidia.com/cuda/parallel-thread-execution/)
- [SPIR-V 사양 (Khronos)](https://registry.khronos.org/SPIR-V/)
- [VK_KHR_pipeline_executable_properties](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_pipeline_executable_properties.html)
- [CUDA Binary Utilities (cuobjdump)](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html)
- Sebastian Aaltonen, "There Is No Graphics API" — 이 시리즈의 동기가 된 수렴 논제

# 다음

[워크로그 #04](/posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/)에서는 noop에서 가장 간단한 실제 커널 — `C[i] = A[i] + B[i]` — 로 나아가서 라인별 SASS 비교와 실행 시간 측정을 수행한다.
