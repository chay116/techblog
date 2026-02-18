---
title: "워크로그 #01 - NVIDIA에서 CUDA vs Vulkan 초기화"
date: "2026-02-14"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "초기화"]
---

# 맥락

vAI의 CUDA/Vulkan 백엔드에서 첫 실행 지연과 초기화 비용을 분리해서 확인한다.

# 가설

- CUDA는 호스트 초기화 코드가 짧다.
- Vulkan은 설정이 길지만 리소스/동기화 제어가 더 명시적이다.

# 초기화 흐름 요약

## CUDA

1. `cudaGetDeviceCount`
2. `cudaSetDevice`
3. warm-up (`cudaFree(0)`)
4. `cudaStreamCreate`
5. `cudaMalloc`, `cudaMemcpyAsync`
6. kernel launch + sync

## Vulkan

1. `vkCreateInstance`
2. 물리 디바이스 선택
3. `vkCreateDevice`, queue 획득
4. buffer/memory 바인딩
5. pipeline + descriptor 생성
6. `vkCmdDispatch` 기록
7. `vkQueueSubmit` + fence wait

# 다음 액션

1. cold/warm 상태별 첫 dispatch 지연 측정
2. Nsight/RenderDoc으로 동일 워크로드 캡처
