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

커널이 실행되기 전에 누군가 SASS로 컴파일해야 한다. CUDA와 Vulkan은 이 컴파일을 서로 다른 단계에서 수행하고 결과를 다르게 캐싱한다. 이 글에서는 콜드 스타트 vs 웜 스타트 컴파일 비용을 측정하고 캐싱 전략을 비교한다.

# 컴파일 모델

## CUDA: 2단계 + 선택적 JIT

| 경로 | SASS 생성 시점 | 캐시 |
|---|---|---|
| 오프라인 (cubin) | 빌드 타임 `nvcc` | 런타임 비용 없음 |
| JIT (PTX→SASS) | 런타임 `cuModuleLoad` | `~/.nv/ComputeCache/` |
| Fat binary | 양쪽 내장, 런타임 선택 | 새 아키텍처는 JIT 폴백 |

CUDA JIT 캐시는 **투명하고 전역적** — 모든 CUDA 애플리케이션이 공유한다. 캐시 키에는 PTX 해시, GPU 아키텍처, 드라이버 버전이 포함된다.

## Vulkan: 파이프라인 생성

| 경로 | SASS 생성 시점 | 캐시 |
|---|---|---|
| 캐시 없음 | `vkCreateComputePipelines` | 전체 SPIR-V→SASS 컴파일 |
| VkPipelineCache | `vkCreateComputePipelines` | 히트 시 드라이버가 컴파일 생략 |
| 파이프라인 라이브러리 | 빌드 타임 (부분) | 모듈식, 앱 관리 |

Vulkan 파이프라인 캐시는 **앱이 관리하는 명시적** 방식이다. 애플리케이션이 직접 캐시를 생성, 저장, 로드해야 한다.

# 실험 설계

## CUDA JIT 측정

1. **콜드**: `~/.nv/ComputeCache/` 삭제, PTX 모듈 로드, `cuModuleLoadDataEx` 시간 측정.
2. **웜**: 동일 PTX 재로드 (캐시 히트), 시간 측정.

## Vulkan 파이프라인 캐시 측정

1. **콜드**: `VK_NULL_HANDLE` 캐시로 `vkCreateComputePipelines`.
2. **캐시 채우기**: 새 `VkPipelineCache`로 파이프라인 생성하여 캐시 채움.
3. **웜**: 채워진 캐시로 동일 파이프라인 재생성.
4. **디스크**: `vkGetPipelineCacheData`로 캐시 저장, 다음 실행 시 로드.

# 결과

## CUDA JIT

| 지표 | 시간 (ms) | 비고 |
|---|---:|---|
| 콜드 (캐시 없음) | TBD | 전체 PTX→SASS 컴파일 |
| 웜 (캐시됨) | TBD | 캐시 히트, 디스크에서 로드 |
| 속도 향상 | TBD | |

## Vulkan 파이프라인 캐시

| 지표 | 시간 (ms) | 비고 |
|---|---:|---|
| 콜드 (캐시 없음) | TBD | 전체 SPIR-V→SASS 컴파일 |
| 웜 (인메모리) | TBD | 동일 VkPipelineCache 인스턴스 |
| 웜 (디스크에서) | TBD | `pipeline_cache.bin`에서 로드 |

## 캐시 비교

| 항목 | CUDA JIT 캐시 | Vulkan 파이프라인 캐시 |
|---|---|---|
| 관리 주체 | 드라이버 (투명) | 애플리케이션 (명시적) |
| 범위 | 전역 (모든 앱) | 애플리케이션별 |
| 저장 위치 | `~/.nv/ComputeCache/` | 앱이 선택한 파일 경로 |
| 캐시 키 | PTX 해시 + 아키텍처 + 드라이버 | SPIR-V 해시 + 드라이버 + 디바이스 |
| 캐시 크기 관리 | 드라이버 LRU 퇴거 | 앱이 생명주기 관리 |
| 크로스 디바이스 | 아키텍처별 JIT 재컴파일 | 불투명 blob, 디바이스별 |

# 실무적 시사점

1. **첫 실행 지연**: Vulkan 앱은 파이프라인 캐시를 사전에 워밍업해야 한다. CUDA의 투명 캐시는 첫 실행 이후 자동으로 처리된다.

2. **배포 전략**:
   - CUDA: 전방 호환을 위해 PTX 배포, 알려진 아키텍처에는 cubin으로 JIT 없이 실행
   - Vulkan: SPIR-V는 항상 배포, 선택적으로 GPU 패밀리별 파이프라인 캐시 사전 구축

3. **캐시 무효화**: 양쪽 캐시 모두 드라이버 업데이트 시 무효화된다. CUDA 캐시는 조용히 재생성. Vulkan 앱은 오래된 캐시를 감지해야 함 (캐시 헤더의 벤더/디바이스 ID 확인).

4. **vAI 고려사항**: vAI 컴퓨트 백엔드에서는:
   - 정상 종료 시 `VkPipelineCache`를 디스크에 저장
   - 시작 시 캐시 로드
   - 무효화를 위해 캐시 파일명에 드라이버 버전 포함

# 코드

실험 코드: `posts/worklog/cuda-vulkan-sass-series/exp05_jit_pipeline_cache/`

```bash
cmake --build build --target exp05_jit_pipeline_cache
./build/exp05_jit_pipeline_cache/exp05_jit_pipeline_cache
```

# 참고 자료

- [CUDA Driver API: cuModuleLoadDataEx](https://docs.nvidia.com/cuda/cuda-driver-api/group__CUDA__MODULE.html)
- [NVIDIA JIT 컴파일 캐시](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#just-in-time-compilation)
- [VkPipelineCache](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VkPipelineCache.html)
- [Vulkan 파이프라인 캐시 모범 사례](https://developer.nvidia.com/blog/vulkan-dos-donts/)

# 시리즈 요약

이 5편 시리즈(워크로그 #03–#07)에서 CUDA와 Vulkan을 ISA 수준에서 비교했다:

1. **#03 툴체인**: 컴파일 경로는 다르지만, 양쪽 모두 SASS를 생성한다.
2. **#04 벡터 덧셈**: 핵심 컴퓨트 명령어는 SASS에서 동일하다.
3. **#05 메모리 코얼레싱**: 동일한 메모리 하드웨어, 동일한 코얼레싱 규칙.
4. **#06 바인드리스/BDA**: BDA는 Vulkan을 ISA 수준에서 CUDA 포인터와 동등하게 만든다.
5. **#07 JIT/캐시**: 컴파일 전략과 캐싱은 크게 다르다.

**결론**: SASS 수준에서 GPU는 어떤 API가 작업을 제출했는지 신경 쓰지 않는다. 차이는 호스트 측 컴파일 파이프라인, 리소스 바인딩 모델, 캐싱 전략에 있지 — 생성되는 머신 코드에 있지 않다.
