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

Over the past four posts, we have established that CUDA and Vulkan produce nearly identical SASS on NVIDIA GPUs. The arithmetic, the memory accesses, the coalescing behavior — all the same. With BDA, even the binding model converges.

But there is one area where the two APIs diverge significantly: **when and how the GPU machine code (SASS) is produced**, and **how it is cached** across application runs. This is not about the quality of the generated code — it is about the cost of generating it.

If you have ever experienced a "shader compilation stutter" in a Vulkan game, or wondered why CUDA's first kernel launch is sometimes slow, this post explains exactly what is happening under the hood.

# The Compilation Cost

Compiling IR (PTX or SPIR-V) to SASS is not free. The backend compiler performs register allocation, instruction scheduling, and optimization passes. For a simple kernel, this takes a few milliseconds. For a complex kernel with many branches and memory access patterns, it can take 50-200 ms.

This compilation must happen before the kernel can execute. The question is: when?

```
 Timeline of a compute dispatch:
 ───────────────────────────────────────────────────────────────────
 CUDA (pre-compiled cubin):
   App start ──── cuModuleLoad (fast, SASS ready) ──── kernel launch
                  │                                    │
                  ~ 0.1 ms                             ~ 0.01 ms

 CUDA (JIT from PTX):
   App start ──── cuModuleLoad (JIT compile!) ──── kernel launch
                  │                                │
                  ~ 5-200 ms (first time)          ~ 0.01 ms
                  ~ 0.1 ms (cached)

 Vulkan:
   App start ──── vkCreateComputePipelines ──── vkCmdDispatch
                  │                              │
                  ~ 5-200 ms (first time)        ~ 0.01 ms
                  ~ 0.5-2 ms (cached)
 ───────────────────────────────────────────────────────────────────
```

# CUDA: Three Shipping Strategies

CUDA gives developers three choices for how to deliver GPU code:

## Strategy 1: Ship Cubin (Pre-compiled SASS)

```bash
# Compile directly to SASS for a specific architecture
nvcc -arch=sm_86 -cubin -o kernel.cubin kernel.cu
```

- **Pro**: Zero runtime compilation. Load and run immediately.
- **Con**: Only works on the exact GPU architecture it was compiled for. Ship multiple cubins for multiple GPUs.

## Strategy 2: Ship PTX (JIT at Load Time)

```bash
# Compile to PTX (virtual ISA)
nvcc -arch=compute_86 --ptx -o kernel.ptx kernel.cu
```

- **Pro**: Forward-compatible. PTX for compute_86 will JIT to SASS on sm_89, sm_90, etc.
- **Con**: First load pays the JIT cost.

## Strategy 3: Ship Fat Binary (Both)

```bash
# Embed both cubin and PTX
nvcc -gencode arch=compute_86,code=sm_86 \
     -gencode arch=compute_86,code=compute_86 \
     -o kernel.fatbin kernel.cu
```

- Cubin for known architectures (instant load).
- PTX fallback for future architectures (JIT on first load).
- This is what most CUDA applications do.

## CUDA JIT Cache

When the CUDA driver JIT-compiles PTX, it caches the result:

```
Location:  ~/.nv/ComputeCache/     (Linux)
           %APPDATA%\NVIDIA\ComputeCache\  (Windows)

Cache key: hash(PTX bytecode + GPU architecture + driver version)

Behavior:
  First load:  PTX → SASS compilation (~5-200 ms)
  Second load: cache hit, load SASS from disk (~0.1 ms)
  Driver update: cache miss, recompile
```

The cache is **transparent and global** — all CUDA applications on the system share it. The user never sees it. There is no API to manage it. The driver handles everything.

```
 CUDA JIT Cache flow:
 ─────────────────────────────────────────
 cuModuleLoadDataEx(ptx_data)
       │
       ├── Cache lookup (hash of PTX + arch + driver)
       │       │
       │       ├── HIT:  load SASS from disk (~0.1 ms)
       │       │
       │       └── MISS: compile PTX → SASS (~5-200 ms)
       │                 save to cache
       │
       └── SASS loaded into GPU context
 ─────────────────────────────────────────
```

# Vulkan: Pipeline Cache

Vulkan's approach is fundamentally different: the application is responsible for managing the cache.

## No Cache (Cold Start)

```cpp
VkComputePipelineCreateInfo createInfo{...};
// cache = VK_NULL_HANDLE → no caching
vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &createInfo, nullptr, &pipeline);
// ^ This compiles SPIR-V → SASS right here. Blocks until done.
```

Every pipeline creation pays the full compilation cost. Every application launch recompiles everything from scratch.

## With VkPipelineCache (Warm Start)

```cpp
// Create an empty cache
VkPipelineCacheCreateInfo cacheCI{VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO};
VkPipelineCache cache;
vkCreatePipelineCache(device, &cacheCI, nullptr, &cache);

// First pipeline creation — compiles and populates cache
vkCreateComputePipelines(device, cache, 1, &createInfo, nullptr, &pipeline1);

// Second pipeline creation — cache hit, much faster
vkCreateComputePipelines(device, cache, 1, &createInfo, nullptr, &pipeline2);
```

## Saving Cache to Disk

```cpp
// Query cache size
size_t cacheSize = 0;
vkGetPipelineCacheData(device, cache, &cacheSize, nullptr);

// Read cache data
std::vector<char> cacheData(cacheSize);
vkGetPipelineCacheData(device, cache, &cacheSize, cacheData.data());

// Save to file
std::ofstream file("pipeline_cache.bin", std::ios::binary);
file.write(cacheData.data(), cacheSize);
```

## Loading Cache on Next Launch

```cpp
// Read from file
std::ifstream file("pipeline_cache.bin", std::ios::binary);
std::vector<char> cacheData((std::istreambuf_iterator<char>(file)),
                             std::istreambuf_iterator<char>());

// Create cache pre-populated with saved data
VkPipelineCacheCreateInfo cacheCI{VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO};
cacheCI.initialDataSize = cacheData.size();
cacheCI.pInitialData = cacheData.data();
VkPipelineCache cache;
vkCreatePipelineCache(device, &cacheCI, nullptr, &cache);

// Pipeline creation with pre-populated cache — fast
vkCreateComputePipelines(device, cache, 1, &createInfo, nullptr, &pipeline);
```

## Cache Validation

The pipeline cache blob is opaque, but it starts with a standard header:

```cpp
struct VkPipelineCacheHeaderVersionOne {
    uint32_t headerLength;
    uint32_t headerVersion;    // VK_PIPELINE_CACHE_HEADER_VERSION_ONE
    uint32_t vendorID;         // e.g., 0x10DE for NVIDIA
    uint32_t deviceID;         // specific GPU model
    uint8_t  pipelineCacheUUID[VK_UUID_SIZE]; // driver-specific
};
```

If any of these fields do not match (different GPU, different driver version), the cache is silently discarded and pipelines are recompiled. Applications should store the expected values alongside the cache file to avoid unnecessary I/O on known-stale caches.

# Experiment: Measuring Compilation Cost

We measure pipeline/module creation time for a simple scale kernel: `data[idx] *= factor`.

## CUDA JIT Results

| Scenario | Time | Notes |
|---|---:|---|
| cubin load (pre-compiled) | ~0.08 ms | SASS embedded, no compilation |
| PTX JIT (cold, no cache) | ~12 ms | Full compilation |
| PTX JIT (warm, cached) | ~0.15 ms | Loaded from ComputeCache |
| JIT speedup (warm/cold) | **~80x** | |

## Vulkan Pipeline Cache Results

| Scenario | Time | Notes |
|---|---:|---|
| No cache (cold) | ~15 ms | Full SPIR-V → SASS compilation |
| In-memory cache (warm) | ~0.8 ms | Same VkPipelineCache instance |
| Disk cache (warm) | ~1.2 ms | Loaded from pipeline_cache.bin |
| Cache speedup (disk/cold) | **~12x** | |

```
 Compilation cost comparison (log scale):
 ────────────────────────────────────────────────────────────
 CUDA cubin         ▏ 0.08 ms
 CUDA JIT warm      ▎ 0.15 ms
 Vulkan cache warm  ██ 1.2 ms
 CUDA JIT cold      ████████████ 12 ms
 Vulkan cold        ███████████████ 15 ms
 ────────────────────────────────────────────────────────────
```

Key observations:

1. **Cold compilation is similar** (~12-15 ms). This makes sense — both paths use the same NVIDIA backend compiler.

2. **CUDA's warm path is faster** (~0.15 ms vs ~1.2 ms). The CUDA JIT cache stores compiled SASS directly. Vulkan's pipeline cache stores driver-specific blobs that still require some processing.

3. **Pre-compiled cubin is unbeatable** (~0.08 ms). No Vulkan equivalent exists — `VK_EXT_graphics_pipeline_library` and pipeline caches help, but cannot match loading pre-compiled SASS.

# Comparison Summary

| Aspect | CUDA JIT Cache | Vulkan Pipeline Cache |
|---|---|---|
| **Who manages it** | Driver (transparent) | Application (explicit) |
| **Scope** | Global (all CUDA apps share) | Per-application |
| **Storage** | `~/.nv/ComputeCache/` | App-chosen path |
| **Cache key** | PTX hash + arch + driver | SPIR-V hash + driver + device |
| **Invalidation** | Automatic on driver update | App must detect stale cache |
| **Size control** | Driver LRU eviction | App manages lifecycle |
| **Pre-compilation** | Yes (cubin) | Partial (pipeline libraries) |
| **Warm hit latency** | ~0.15 ms | ~1.2 ms |
| **Cross-device** | Recompiles per arch | Silently discards mismatched |

# Practical Architecture for vAI

Based on these findings, here is the caching strategy for the vAI compute backend:

```
 vAI Startup Flow:
 ─────────────────────────────────────────────────────────────
 1. Load pipeline cache from disk
    ├── File: ~/.vai/pipeline_cache_{vendorID}_{deviceID}_{driverVer}.bin
    ├── Validate header (vendorID, deviceID, UUID match)
    └── If stale → delete, start fresh

 2. Create pipelines with cache
    ├── Cache hit → fast (~1 ms per pipeline)
    └── Cache miss → compile (~15 ms per pipeline, populate cache)

 3. On clean shutdown
    └── Save pipeline cache to disk

 4. Background warmup (optional)
    └── On first install, create all known pipelines in a background
        thread to populate the cache before user interaction
 ─────────────────────────────────────────────────────────────
```

For the CUDA backend, no special handling is needed — the driver cache works automatically.

# Code

```
cuda-vulkan-sass-series/exp05_jit_pipeline_cache/
├── CMakeLists.txt
├── cuda/jit_kernel.cu         ← simple kernel for JIT measurement
├── glsl/cached_kernel.comp    ← Vulkan compute shader
└── main.cpp                   ← measures cold/warm for both APIs
```

Build and run:

```bash
cmake --build build --target exp05_jit_pipeline_cache
./build/exp05_jit_pipeline_cache/exp05_jit_pipeline_cache
```

# References

- [NVIDIA CUDA Programming Guide: JIT Compilation](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#just-in-time-compilation)
- [VkPipelineCache — Vulkan Specification](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VkPipelineCache.html)
- [Vulkan Pipeline Cache Best Practices (NVIDIA)](https://developer.nvidia.com/blog/vulkan-dos-donts/)
- [VK_EXT_graphics_pipeline_library](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_EXT_graphics_pipeline_library.html)

# Series Conclusion

This 5-post series (Worklog #03–#07) took a single question — "what happens when you dispatch compute work on an NVIDIA GPU?" — and followed it all the way down to the machine code.

Here is what we found:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ Layer              │ CUDA vs Vulkan        │ Impact             │
 ├────────────────────┼───────────────────────┼────────────────────┤
 │ Source language     │ Different             │ Developer ergonomy │
 │ Intermediate IR     │ Different (PTX/SPIRV) │ Portability        │
 │ Backend compiler    │ Same (NVVM)           │ None               │
 │ SASS output         │ Same (with BDA)       │ None               │
 │ Memory coalescing   │ Same                  │ None               │
 │ Arithmetic          │ Same                  │ None               │
 │ Cache strategy      │ Different             │ First-launch UX    │
 └─────────────────────────────────────────────────────────────────┘
```

**The GPU does not care which API you use.** CUDA and Vulkan are different frontends to the same hardware. The choice between them should be based on ecosystem needs (portability, tooling, library support) rather than performance assumptions.

For vAI, we will use both: CUDA for the NVIDIA-optimized fast path, Vulkan with BDA for the portable path. As this series has shown, the performance difference is negligible when the right patterns (SoA, BDA, pipeline caching) are applied.
