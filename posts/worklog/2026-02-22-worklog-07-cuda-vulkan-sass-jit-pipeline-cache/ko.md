---
title: "워크로그 #07 - JIT 캐시 vs 파이프라인 캐시"
date: "2026-02-22"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "jit", "pipeline-cache"]
---

지난 네 글에서 CUDA와 Vulkan이 NVIDIA GPU에서 거의 동일한 SASS를 생성한다는 것을 확인했다. 산술, 메모리 접근, 코얼레싱 동작 — 모두 동일. BDA를 사용하면 바인딩 모델까지 수렴한다.

그러나 두 API가 크게 갈라지는 영역이 하나 있다: **GPU 머신 코드(SASS)가 언제, 어떻게 생성되는가**, 그리고 **애플리케이션 실행 간에 어떻게 캐싱되는가**. 이것은 생성된 코드의 품질에 관한 것이 아니라 — 생성하는 비용에 관한 것이다.

Vulkan 게임에서 "셰이더 컴파일 끊김"을 경험하거나, CUDA의 첫 커널 런치가 왜 가끔 느린지 궁금했다면, 이 글이 내부에서 정확히 무슨 일이 일어나는지 설명한다.

# 컴파일 비용

IR(PTX 또는 SPIR-V)을 SASS로 컴파일하는 것은 무료가 아니다. 백엔드 컴파일러가 레지스터 할당, 명령어 스케줄링, 최적화 패스를 수행한다. 간단한 커널은 몇 밀리초. 분기와 메모리 접근 패턴이 복잡한 커널은 50-200ms가 소요될 수 있다.

```
 컴퓨트 디스패치의 타임라인:
 ───────────────────────────────────────────────────────────────────
 CUDA (사전 컴파일 cubin):
   앱 시작 ──── cuModuleLoad (빠름, SASS 준비됨) ──── 커널 런치
                │                                     │
                ~ 0.1 ms                               ~ 0.01 ms

 CUDA (PTX에서 JIT):
   앱 시작 ──── cuModuleLoad (JIT 컴파일!) ──── 커널 런치
                │                                │
                ~ 5-200 ms (첫 번째)              ~ 0.01 ms
                ~ 0.1 ms (캐시됨)

 Vulkan:
   앱 시작 ──── vkCreateComputePipelines ──── vkCmdDispatch
                │                              │
                ~ 5-200 ms (첫 번째)            ~ 0.01 ms
                ~ 0.5-2 ms (캐시됨)
 ───────────────────────────────────────────────────────────────────
```

# CUDA: 세 가지 배포 전략

## 전략 1: Cubin 배포 (사전 컴파일 SASS)

```bash
nvcc -arch=sm_86 -cubin -o kernel.cubin kernel.cu
```

- **장점**: 런타임 컴파일 없음. 로드 후 즉시 실행.
- **단점**: 컴파일된 정확한 GPU 아키텍처에서만 동작. 여러 GPU에는 여러 cubin 배포.

## 전략 2: PTX 배포 (로드 시 JIT)

```bash
nvcc -arch=compute_86 --ptx -o kernel.ptx kernel.cu
```

- **장점**: 전방 호환. compute_86용 PTX가 sm_89, sm_90 등에서 JIT 컴파일.
- **단점**: 첫 로드 시 JIT 비용 발생.

## 전략 3: Fat Binary 배포 (양쪽 모두)

```bash
nvcc -gencode arch=compute_86,code=sm_86 \
     -gencode arch=compute_86,code=compute_86 \
     -o kernel.fatbin kernel.cu
```

- 알려진 아키텍처에는 cubin (즉시 로드).
- 미래 아키텍처에는 PTX 폴백 (첫 로드 시 JIT).
- 대부분의 CUDA 애플리케이션이 이 방식을 사용한다.

## CUDA JIT 캐시

CUDA 드라이버가 PTX를 JIT 컴파일하면 결과를 캐싱한다:

```
위치:  ~/.nv/ComputeCache/     (Linux)
       %APPDATA%\NVIDIA\ComputeCache\  (Windows)

캐시 키: hash(PTX 바이트코드 + GPU 아키텍처 + 드라이버 버전)

동작:
  첫 로드:   PTX → SASS 컴파일 (~5-200 ms)
  두 번째:   캐시 히트, 디스크에서 SASS 로드 (~0.1 ms)
  드라이버 업데이트: 캐시 미스, 재컴파일
```

캐시는 **투명하고 전역적** — 시스템의 모든 CUDA 애플리케이션이 공유. 사용자에게 보이지 않음. 관리 API 없음. 드라이버가 모든 것을 처리.

# Vulkan: 파이프라인 캐시

Vulkan의 접근은 근본적으로 다르다: 애플리케이션이 캐시를 관리해야 한다.

## 캐시 없음 (콜드 스타트)

```cpp
// cache = VK_NULL_HANDLE → 캐싱 없음
vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &createInfo, nullptr, &pipeline);
// ^ 여기서 SPIR-V → SASS를 컴파일한다. 완료까지 블로킹.
```

모든 파이프라인 생성이 전체 컴파일 비용을 지불한다.

## VkPipelineCache 사용 (웜 스타트)

```cpp
// 빈 캐시 생성
VkPipelineCacheCreateInfo cacheCI{VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO};
VkPipelineCache cache;
vkCreatePipelineCache(device, &cacheCI, nullptr, &cache);

// 첫 파이프라인 생성 — 컴파일하고 캐시에 채움
vkCreateComputePipelines(device, cache, 1, &createInfo, nullptr, &pipeline1);

// 두 번째 파이프라인 생성 — 캐시 히트, 훨씬 빠름
vkCreateComputePipelines(device, cache, 1, &createInfo, nullptr, &pipeline2);
```

## 디스크에 캐시 저장

```cpp
// 캐시 데이터 읽기
size_t cacheSize = 0;
vkGetPipelineCacheData(device, cache, &cacheSize, nullptr);
std::vector<char> cacheData(cacheSize);
vkGetPipelineCacheData(device, cache, &cacheSize, cacheData.data());

// 파일에 저장
std::ofstream file("pipeline_cache.bin", std::ios::binary);
file.write(cacheData.data(), cacheSize);
```

## 캐시 유효성 검사

파이프라인 캐시 blob은 불투명하지만 표준 헤더로 시작한다:

```cpp
struct VkPipelineCacheHeaderVersionOne {
    uint32_t headerLength;
    uint32_t headerVersion;
    uint32_t vendorID;          // 예: NVIDIA는 0x10DE
    uint32_t deviceID;          // 특정 GPU 모델
    uint8_t  pipelineCacheUUID[VK_UUID_SIZE]; // 드라이버별
};
```

이 필드 중 하나라도 불일치하면 (다른 GPU, 다른 드라이버 버전) 캐시는 조용히 폐기되고 파이프라인이 재컴파일된다.

# 실험: 컴파일 비용 측정

간단한 스케일 커널에 대한 파이프라인/모듈 생성 시간을 측정한다: `data[idx] *= factor`.

## CUDA JIT 결과

| 시나리오 | 시간 | 비고 |
|---|---:|---|
| cubin 로드 (사전 컴파일) | ~0.08 ms | SASS 내장, 컴파일 없음 |
| PTX JIT (콜드, 캐시 없음) | ~12 ms | 전체 컴파일 |
| PTX JIT (웜, 캐시됨) | ~0.15 ms | ComputeCache에서 로드 |
| JIT 속도 향상 (웜/콜드) | **~80배** | |

## Vulkan 파이프라인 캐시 결과

| 시나리오 | 시간 | 비고 |
|---|---:|---|
| 캐시 없음 (콜드) | ~15 ms | 전체 SPIR-V → SASS 컴파일 |
| 인메모리 캐시 (웜) | ~0.8 ms | 동일 VkPipelineCache 인스턴스 |
| 디스크 캐시 (웜) | ~1.2 ms | pipeline_cache.bin에서 로드 |
| 캐시 속도 향상 (디스크/콜드) | **~12배** | |

```
 컴파일 비용 비교 (로그 스케일):
 ────────────────────────────────────────────────────────────
 CUDA cubin         ▏ 0.08 ms
 CUDA JIT 웜        ▎ 0.15 ms
 Vulkan 캐시 웜     ██ 1.2 ms
 CUDA JIT 콜드      ████████████ 12 ms
 Vulkan 콜드        ███████████████ 15 ms
 ────────────────────────────────────────────────────────────
```

핵심 관찰:

1. **콜드 컴파일은 비슷하다** (~12-15 ms). 동일한 NVIDIA 백엔드 컴파일러를 사용하므로 당연하다.

2. **CUDA의 웜 경로가 더 빠르다** (~0.15 ms vs ~1.2 ms). CUDA JIT 캐시는 컴파일된 SASS를 직접 저장. Vulkan 파이프라인 캐시는 드라이버별 blob을 저장하여 약간의 처리가 여전히 필요.

3. **사전 컴파일 cubin은 최적** (~0.08 ms). Vulkan에 동등한 것이 없다.

# 비교 요약

| 항목 | CUDA JIT 캐시 | Vulkan 파이프라인 캐시 |
|---|---|---|
| **관리 주체** | 드라이버 (투명) | 애플리케이션 (명시적) |
| **범위** | 전역 (모든 CUDA 앱 공유) | 애플리케이션별 |
| **저장 위치** | `~/.nv/ComputeCache/` | 앱이 선택한 경로 |
| **캐시 키** | PTX 해시 + 아키텍처 + 드라이버 | SPIR-V 해시 + 드라이버 + 디바이스 |
| **무효화** | 드라이버 업데이트 시 자동 | 앱이 오래된 캐시 감지해야 함 |
| **크기 관리** | 드라이버 LRU 퇴거 | 앱이 생명주기 관리 |
| **사전 컴파일** | 가능 (cubin) | 부분적 (파이프라인 라이브러리) |
| **웜 히트 레이턴시** | ~0.15 ms | ~1.2 ms |

# vAI 실전 아키텍처

```
 vAI 시작 흐름:
 ─────────────────────────────────────────────────────────────
 1. 디스크에서 파이프라인 캐시 로드
    ├── 파일: ~/.vai/pipeline_cache_{vendorID}_{deviceID}_{driverVer}.bin
    ├── 헤더 검증 (vendorID, deviceID, UUID 일치)
    └── 오래됨 → 삭제, 새로 시작

 2. 캐시와 함께 파이프라인 생성
    ├── 캐시 히트 → 빠름 (~1 ms/파이프라인)
    └── 캐시 미스 → 컴파일 (~15 ms/파이프라인, 캐시에 채움)

 3. 정상 종료 시
    └── 파이프라인 캐시를 디스크에 저장

 4. 백그라운드 워밍업 (선택)
    └── 첫 설치 시, 사용자 상호작용 전에 백그라운드 스레드에서
        알려진 모든 파이프라인을 생성하여 캐시 채우기
 ─────────────────────────────────────────────────────────────
```

CUDA 백엔드에는 특별한 처리 불필요 — 드라이버 캐시가 자동으로 동작.

# 코드

```
cuda-vulkan-sass-series/exp05_jit_pipeline_cache/
├── CMakeLists.txt
├── cuda/jit_kernel.cu         ← JIT 측정용 간단한 커널
├── glsl/cached_kernel.comp    ← Vulkan 컴퓨트 셰이더
└── main.cpp                   ← 양쪽 콜드/웜 측정
```

# 참고 자료

- [NVIDIA CUDA 프로그래밍 가이드: JIT 컴파일](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#just-in-time-compilation)
- [VkPipelineCache — Vulkan 사양](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VkPipelineCache.html)
- [Vulkan 파이프라인 캐시 모범 사례 (NVIDIA)](https://developer.nvidia.com/blog/vulkan-dos-donts/)
- [VK_EXT_graphics_pipeline_library](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_EXT_graphics_pipeline_library.html)

# 시리즈 결론

이 5편 시리즈(워크로그 #03–#07)는 하나의 질문 — "NVIDIA GPU에서 컴퓨트 작업을 디스패치하면 무슨 일이 일어나는가?" — 을 따라 머신 코드까지 내려갔다.

발견한 것:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ 계층               │ CUDA vs Vulkan        │ 영향               │
 ├────────────────────┼───────────────────────┼────────────────────┤
 │ 소스 언어           │ 다름                  │ 개발자 편의성       │
 │ 중간 IR             │ 다름 (PTX/SPIRV)      │ 이식성             │
 │ 백엔드 컴파일러     │ 동일 (NVVM)           │ 없음               │
 │ SASS 출력           │ 동일 (BDA 사용 시)     │ 없음               │
 │ 메모리 코얼레싱     │ 동일                  │ 없음               │
 │ 산술 연산           │ 동일                  │ 없음               │
 │ 캐시 전략           │ 다름                  │ 첫 실행 UX         │
 └─────────────────────────────────────────────────────────────────┘
```

**GPU는 어떤 API를 사용하는지 신경 쓰지 않는다.** CUDA와 Vulkan은 동일한 하드웨어에 대한 다른 프론트엔드다. 둘 사이의 선택은 성능 가정이 아니라 에코시스템 필요(이식성, 툴링, 라이브러리 지원)에 기반해야 한다.

vAI에서는 양쪽 모두 사용할 것이다: NVIDIA 최적화 패스트 패스에는 CUDA, 이식성 경로에는 BDA를 갖춘 Vulkan. 이 시리즈가 보여주었듯이, 올바른 패턴(SoA, BDA, 파이프라인 캐싱)을 적용하면 성능 차이는 무시할 수준이다.
