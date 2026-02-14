---
title: "Worklog #02 - Vulkan Barrier Audit for Compute"
date: "2026-02-15"
status: "wip"
project: "vAI"
category: "worklog"
track: "api-language"
tags: ["vulkan", "barrier", "synchronization", "compute"]
---

# Context

Barrier placement in the Vulkan compute path may be over-conservative, reducing overlap opportunities.

# Hypothesis

Narrower stage/access masks should preserve correctness while reducing synchronization overhead.

# Setup

- GPU: NVIDIA (target)
- API: Vulkan compute
- Capture: RenderDoc + timestamp queries

# Result Snapshot

| Scenario | Baseline (ms) | Updated (ms) | Delta |
|---|---:|---:|---:|
| Dispatch chain A | TBD | TBD | TBD |
| Dispatch chain B | TBD | TBD | TBD |

# Next

1. Cross-check correctness under stress frames.
2. Compare equivalent sync intent in CUDA stream/event model.
