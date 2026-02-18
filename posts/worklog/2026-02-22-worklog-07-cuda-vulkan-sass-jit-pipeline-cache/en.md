---
title: "Worklog #07 - JIT Cache vs Pipeline Cache"
date: "2026-02-22"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "jit", "pipeline-cache"]
---

Before any kernel runs, someone has to compile it to SASS. CUDA and Vulkan handle this compilation at different stages and cache results differently. This post measures the cold-start vs warm-start compilation cost and compares caching strategies.

# Compilation Models

## CUDA: Two-Stage with Optional JIT

| Path | When SASS is Generated | Cache |
|---|---|---|
| Offline (cubin) | `nvcc` at build time | No runtime cost |
| JIT (PTX→SASS) | `cuModuleLoad` at runtime | `~/.nv/ComputeCache/` |
| Fat binary | Both embedded, runtime selects | Falls back to JIT for new arch |

The CUDA JIT cache is **transparent and global** — all CUDA applications share it. The cache key includes PTX hash, GPU architecture, and driver version.

## Vulkan: Pipeline Creation

| Path | When SASS is Generated | Cache |
|---|---|---|
| No cache | `vkCreateComputePipelines` | Full SPIR-V→SASS compilation |
| VkPipelineCache | `vkCreateComputePipelines` | Driver skips compilation on hit |
| Pipeline library | Build-time (partial) | Modular, app-managed |

The Vulkan pipeline cache is **app-managed and explicit**. Applications must create, save, and load the cache themselves.

# Experiment Design

## CUDA JIT Measurement

1. **Cold**: Delete `~/.nv/ComputeCache/`, load PTX module, measure `cuModuleLoadDataEx` time.
2. **Warm**: Load the same PTX again (cache hit), measure time.

## Vulkan Pipeline Cache Measurement

1. **Cold**: `vkCreateComputePipelines` with `VK_NULL_HANDLE` cache.
2. **Populate**: Create pipeline with a new `VkPipelineCache`, filling it.
3. **Warm**: Create same pipeline again with the populated cache.
4. **Disk**: Save cache with `vkGetPipelineCacheData`, load in next run.

# Results

## CUDA JIT

| Metric | Time (ms) | Notes |
|---|---:|---|
| Cold (no cache) | TBD | Full PTX→SASS compilation |
| Warm (cached) | TBD | Cache hit, load from disk |
| Speedup | TBD | |

## Vulkan Pipeline Cache

| Metric | Time (ms) | Notes |
|---|---:|---|
| Cold (no cache) | TBD | Full SPIR-V→SASS compilation |
| Warm (in-memory) | TBD | Same VkPipelineCache instance |
| Warm (from disk) | TBD | Loaded from `pipeline_cache.bin` |

## Cache Comparison

| Aspect | CUDA JIT Cache | Vulkan Pipeline Cache |
|---|---|---|
| Managed by | Driver (transparent) | Application (explicit) |
| Scope | Global (all apps) | Per-application |
| Storage | `~/.nv/ComputeCache/` | App-chosen file path |
| Cache key | PTX hash + arch + driver | SPIR-V hash + driver + device |
| Cache size control | Driver LRU eviction | App manages lifecycle |
| Cross-device | JIT recompiles per arch | Opaque blob, device-specific |

# Practical Implications

1. **First-launch latency**: Vulkan apps must proactively warm the pipeline cache. CUDA's transparent cache handles this automatically after the first run.

2. **Shipping strategy**:
   - CUDA: ship PTX for forward-compat, cubin for zero-JIT on known arches
   - Vulkan: ship SPIR-V always, optionally pre-bake pipeline caches per GPU family

3. **Cache invalidation**: Both caches are invalidated by driver updates. CUDA's cache is silently rebuilt. Vulkan apps should detect stale caches (vendor/device ID check in cache header).

4. **vAI consideration**: For the vAI compute backend, we should:
   - Save `VkPipelineCache` to disk on clean shutdown
   - Load cache on startup
   - Include driver version in cache filename for invalidation

# Code

Experiment code: `posts/worklog/cuda-vulkan-sass-series/exp05_jit_pipeline_cache/`

```bash
cmake --build build --target exp05_jit_pipeline_cache
./build/exp05_jit_pipeline_cache/exp05_jit_pipeline_cache
```

# References

- [CUDA Driver API: cuModuleLoadDataEx](https://docs.nvidia.com/cuda/cuda-driver-api/group__CUDA__MODULE.html)
- [NVIDIA JIT Compilation Cache](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#just-in-time-compilation)
- [VkPipelineCache](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VkPipelineCache.html)
- [Vulkan Pipeline Cache Best Practices](https://developer.nvidia.com/blog/vulkan-dos-donts/)

# Series Summary

This 5-post series (Worklog #03–#07) examined CUDA vs Vulkan from the ISA level:

1. **#03 Toolchain**: The compilation paths differ, but both produce SASS.
2. **#04 Vector Add**: Core compute instructions are identical in SASS.
3. **#05 Memory Coalescing**: Same memory hardware, same coalescing rules.
4. **#06 Bindless/BDA**: BDA makes Vulkan ISA-equivalent to CUDA pointers.
5. **#07 JIT/Cache**: Compilation strategy and caching differ significantly.

**Bottom line**: At the SASS level, the GPU does not care which API submitted the work. The differences are in the host-side compilation pipeline, resource binding model, and caching strategy — not in the generated machine code.
