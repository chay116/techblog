---
title: "Worklog #04 - Hello SASS: Vector Add"
date: "2026-02-19"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "vector-add"]
---

The simplest meaningful compute kernel is `C[i] = A[i] + B[i]`. By implementing identical logic in both CUDA and Vulkan, we get a 1:1 SASS comparison with minimal noise. This post examines the generated SASS and measures execution time.

# Kernel Source

## CUDA

```cuda
extern "C" __global__ void vector_add(const float* A, const float* B,
                                       float* C, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        C[idx] = A[idx] + B[idx];
    }
}
```

## Vulkan (GLSL)

```glsl
#version 450
layout(local_size_x = 256) in;

layout(std430, binding = 0) readonly buffer BufA { float A[]; };
layout(std430, binding = 1) readonly buffer BufB { float B[]; };
layout(std430, binding = 2) writeonly buffer BufC { float C[]; };

layout(push_constant) uniform PushConstants { int N; };

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        C[idx] = A[idx] + B[idx];
    }
}
```

# SASS Comparison

## CUDA SASS

```
// TBD — cuobjdump --dump-sass output
// Expected instructions:
//   S2R  Rx, SR_CTAID.X       // blockIdx.x
//   S2R  Ry, SR_TID.X         // threadIdx.x
//   IMAD Ridx, Rx, blockDim, Ry
//   ISETP.LT P0, Ridx, N
//   @P0 LDG.E R0, [A + Ridx*4]
//   @P0 LDG.E R1, [B + Ridx*4]
//   @P0 FADD R2, R0, R1
//   @P0 STG.E [C + Ridx*4], R2
//   EXIT
```

## Vulkan SASS

```
// TBD — VK_KHR_pipeline_executable_properties output
// Expected: structurally identical to CUDA, with possible differences:
//   - Descriptor load (LDC) to fetch buffer addresses from descriptor set
//   - Same FADD, LDG.E, STG.E core instructions
//   - Thread ID calculation via S2R should be identical
```

## Key Comparison Points

| Instruction | CUDA | Vulkan | Notes |
|---|---|---|---|
| Thread ID calc | S2R + IMAD | S2R + IMAD | Should be identical |
| Buffer address | Direct from param | LDC from descriptor | Vulkan indirection |
| Load | LDG.E | LDG.E | Same memory unit |
| Add | FADD | FADD | Same FP32 pipe |
| Store | STG.E | STG.E | Same memory unit |
| Bound check | ISETP.LT + predicate | ISETP.LT + predicate | Same pattern |

# Performance Results

| N | CUDA (ms) | Vulkan (ms) | Ratio |
|---|---:|---:|---:|
| 1M (2²⁰) | TBD | TBD | TBD |
| 16M (2²⁴) | TBD | TBD | TBD |

Expected: near-identical timing. Both compile to the same functional SASS, and memory bandwidth dominates.

# Analysis

The vector add kernel should produce nearly identical SASS between CUDA and Vulkan, with the only meaningful difference being how the buffer base addresses are resolved:

- **CUDA**: addresses passed as kernel parameters (constant bank load)
- **Vulkan**: addresses loaded indirectly via descriptor set (extra LDC instruction)

For a memory-bound kernel like vector add, this single extra instruction has negligible performance impact.

# Code

Experiment code: `posts/worklog/cuda-vulkan-sass-series/exp02_vector_add/`

```bash
cmake --build build --target exp02_vector_add
./build/exp02_vector_add/exp02_vector_add
```

# References

- [NVIDIA SASS Instruction Set (unofficial)](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html)
- [cuobjdump documentation](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html#cuobjdump)

# Next

→ Worklog #05: memory coalescing patterns — where SASS differences actually matter for performance.
