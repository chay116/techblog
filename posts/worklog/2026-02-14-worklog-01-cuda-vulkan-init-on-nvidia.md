---
title: "Worklog #01 - CUDA vs Vulkan Initialization on NVIDIA"
date: "2026-02-14"
status: "wip"
project: "vAI"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "initialization"]
---

# Context

vAI compute path starts with both CUDA and Vulkan backends. The immediate objective is to isolate one-time initialization cost and first-dispatch latency.

# Hypothesis

- CUDA should have shorter host-side setup code.
- Vulkan should require more explicit setup but offer cleaner control over resource and synchronization ownership.

# Initialization Flow

## CUDA (runtime API)

1. `cudaGetDeviceCount`
2. `cudaSetDevice`
3. warm-up call (e.g. `cudaFree(0)`)
4. `cudaStreamCreate`
5. `cudaMalloc` / `cudaMemcpyAsync`
6. kernel launch and `cudaStreamSynchronize`

## Vulkan (compute path)

1. `vkCreateInstance`
2. `vkEnumeratePhysicalDevices` and pick NVIDIA GPU
3. `vkCreateDevice` + compute queue
4. buffer creation and memory bind
5. descriptor set and compute pipeline creation
6. command buffer record with `vkCmdDispatch`
7. `vkQueueSubmit` + fence wait

# Result Snapshot

| Metric | CUDA | Vulkan |
|---|---:|---:|
| Host init LOC (rough) | 40 | 140 |
| First dispatch latency (ms) | TBD | TBD |
| Steady-state kernel time (ms) | TBD | TBD |

# Analysis

Both paths converge to the same NVIDIA hardware execution resources. Major performance differences are expected from kernel/data movement design rather than API label.

# Next

1. Measure first-dispatch latency with cold and warm driver states.
2. Add Nsight and RenderDoc captures for matching workloads.
