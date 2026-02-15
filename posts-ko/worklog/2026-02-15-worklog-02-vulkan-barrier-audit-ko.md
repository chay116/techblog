---
title: "워크로그 #02 - Vulkan Compute 배리어 점검"
date: "2026-02-15"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "api-language"
tags: ["vulkan", "barrier", "sync", "compute"]
---

# 맥락

현재 Vulkan compute 경로에서 배리어 범위가 과도할 가능성이 있다.

# 가설

stage/access 범위를 줄이면 정확성을 유지하면서 지연을 낮출 수 있다.

# 결과 스냅샷

| 시나리오 | 기존(ms) | 변경(ms) | 변화 |
|---|---:|---:|---:|
| Dispatch chain A | TBD | TBD | TBD |
| Dispatch chain B | TBD | TBD | TBD |

# 다음 액션

1. stress frame에서 정확성 재검증
2. CUDA stream/event 동기화와 대응 비교
