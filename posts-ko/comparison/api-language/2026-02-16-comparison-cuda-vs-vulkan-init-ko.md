---
title: "비교 - CUDA vs Vulkan 초기화"
date: "2026-02-16"
status: "wip"
project: "vAI"
lang: "ko"
category: "comparison"
track: "api-language"
tags: ["cuda", "vulkan", "초기화", "nvidia"]
---

# 범위

NVIDIA GPU 기준으로 초기화 복잡도와 첫 실행 특성을 비교한다.

# 핵심 비교

| 항목 | CUDA | Vulkan | vAI 메모 |
|---|---|---|---|
| 설정 복잡도 | 낮음 | 높음 | Vulkan은 객체 생명주기 관리가 명시적 |
| 리소스 제어 | 중간 | 높음 | 메모리/동기화 제어 세밀함 |
| 첫 실행 특성 | lazy init 영향 | pipeline 생성 영향 | warm-up 분리 측정 필요 |

# 코드 열람

- `src/compute/cuda/`
- `src/compute/vulkan/`
- `benchmarks/`

# 참고 자료

- Vulkan 1.3 Spec
- CUDA Programming Guide
- CUDA Runtime API
