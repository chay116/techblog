---
title: "Worklog #03 - CUDA vs Vulkan: Compilation Toolchain Anatomy"
date: "2026-02-18"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "toolchain"]
---

Both CUDA and Vulkan compute shaders end up as the same NVIDIA SASS (Shader ASSembly) instructions on the GPU. But the compilation paths that produce that SASS are radically different. This post maps the two pipelines side by side.

# Compilation Pipelines

## CUDA: Source → PTX → SASS

```
.cu source
  │  nvcc (clang front-end)
  ▼
PTX  (virtual ISA, text)
  │  ptxas  (or JIT at cuModuleLoad)
  ▼
SASS  (native GPU ISA, binary)
```

Key points:
- **PTX** is NVIDIA's stable virtual ISA. It is forward-compatible: PTX compiled for sm_80 can JIT to sm_89 SASS at load time.
- **Offline**: `nvcc --gpu-architecture=sm_86` produces a cubin with embedded SASS.
- **JIT**: ship PTX, driver compiles at `cuModuleLoad`. Result cached in `~/.nv/ComputeCache/`.

## Vulkan: Source → SPIR-V → (NVVM IR) → SASS

```
.comp source (GLSL/HLSL)
  │  glslangValidator / DXC
  ▼
SPIR-V  (Khronos portable IR, binary)
  │  NVIDIA Vulkan driver (internally)
  │    SPIR-V → NVVM IR → PTX-like → SASS
  ▼
SASS  (native GPU ISA, binary)
```

Key points:
- **SPIR-V** is the Khronos portable shader IR. Unlike PTX, it is vendor-neutral.
- The NVIDIA Vulkan driver contains a full SPIR-V → SASS compiler internally.
- Pipeline creation (`vkCreateComputePipelines`) is where compilation happens.
- No user-visible intermediate (no PTX file on disk).

# Side-by-Side Comparison

| Aspect | CUDA | Vulkan |
|---|---|---|
| Source language | CUDA C++ | GLSL / HLSL |
| Portable IR | PTX (NVIDIA only) | SPIR-V (vendor neutral) |
| Offline compiler | nvcc + ptxas | glslangValidator / DXC |
| Runtime compiler | CUDA driver JIT | Vulkan driver (at pipeline creation) |
| Cache mechanism | `~/.nv/ComputeCache/` | `VkPipelineCache` (app-managed) |
| SASS extraction | `cuobjdump --dump-sass` | `VK_KHR_pipeline_executable_properties` |

# Experiment: Noop Kernel SASS

We compile a completely empty kernel in both paths to see the compiler-generated prologue and epilogue.

**CUDA noop_kernel.cu:**
```cuda
extern "C" __global__ void noop_kernel() {
    // empty
}
```

**Vulkan noop.comp:**
```glsl
#version 450
layout(local_size_x = 64) in;
void main() {
    // empty
}
```

## SASS Output: CUDA

```
// TBD — run: cuobjdump --dump-sass exp01_cuda
// Expected: minimal prologue (S2R, IMAD for thread ID) + EXIT
```

## SASS Output: Vulkan

```
// TBD — run exp01_vulkan with VK_KHR_pipeline_executable_properties
// Expected: similar prologue + EXIT, possibly with descriptor setup
```

## Expected Observations

1. Both should produce very short SASS (< 10 instructions).
2. CUDA may have a slightly leaner prologue since there is no descriptor table to set up.
3. Vulkan may include extra `LDC` (load constant) instructions for the descriptor base address.

# Code

All experiment code is in `posts/worklog/cuda-vulkan-sass-series/exp01_toolchain/`.

```bash
# Build
cd posts/worklog/cuda-vulkan-sass-series
cmake -B build -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build build

# Run CUDA
./build/exp01_toolchain/exp01_cuda

# Run Vulkan
./build/exp01_toolchain/exp01_vulkan
```

# References

- [NVIDIA PTX ISA Spec](https://docs.nvidia.com/cuda/parallel-thread-execution/)
- [SPIR-V Specification](https://registry.khronos.org/SPIR-V/)
- [VK_KHR_pipeline_executable_properties](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_pipeline_executable_properties.html)
- Sebastian Aaltonen, ["There Is No Graphics API"](https://twitter.com/SebAaltworked) — the convergence thesis

# Next

→ Worklog #04: same-logic vector add kernel, 1:1 SASS comparison.
