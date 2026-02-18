---
title: "Worklog #06 - Bindless, BDA, Raw Pointers"
date: "2026-02-21"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "bda", "bindless"]
---

Sebastian Aaltonen's "There Is No Graphics API" thesis argues that as Vulkan adds features like Buffer Device Address (BDA), the programming model converges with CUDA at the hardware level. This post puts that claim to the ISA test: does BDA-based Vulkan SASS actually look like CUDA pointer SASS?

# Three Access Models

| Model | API | How buffer address reaches the shader |
|---|---|---|
| Raw pointer | CUDA | Kernel parameter → constant bank → register |
| Descriptor (SSBO) | Vulkan | Descriptor set → descriptor table load → register |
| Buffer Device Address | Vulkan | Push constant (uint64) → register (like a pointer) |

# Kernel Source

## CUDA Raw Pointer

```cuda
extern "C" __global__
void read_via_pointer(const float* data, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = data[idx] * 2.0f;
    }
}
```

## Vulkan Descriptor-Bound SSBO

```glsl
#version 450
layout(local_size_x = 256) in;

layout(std430, binding = 0) readonly buffer BufIn { float data_in[]; };
layout(std430, binding = 1) writeonly buffer BufOut { float data_out[]; };
layout(push_constant) uniform PushConstants { int N; };

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        data_out[idx] = data_in[idx] * 2.0;
    }
}
```

## Vulkan BDA

```glsl
#version 450
#extension GL_EXT_buffer_reference : require
#extension GL_EXT_buffer_reference2 : require

layout(local_size_x = 256) in;

layout(buffer_reference, std430) readonly buffer FloatBufIn { float data[]; };
layout(buffer_reference, std430) writeonly buffer FloatBufOut { float data[]; };

layout(push_constant) uniform PushConstants {
    FloatBufIn inPtr;
    FloatBufOut outPtr;
    int N;
};

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        outPtr.data[idx] = inPtr.data[idx] * 2.0;
    }
}
```

# SASS Analysis

## Expected: CUDA Raw Pointer

```
// TBD — cuobjdump output
// Pattern:
//   LDC.64 Rptr, c[0x0][param_offset]    ← load pointer from constant bank
//   IMAD    Raddr, Ridx, 4, Rptr          ← pointer arithmetic
//   LDG.E   R0, [Raddr]                   ← global load
//   FMUL    R1, R0, 2.0
//   STG.E   [Raddr_out], R1               ← global store
```

## Expected: Vulkan Descriptor SSBO

```
// TBD — pipeline executable properties
// Pattern:
//   LDC.64  Rdesc_table, c[0x0][desc_offset]  ← descriptor table base
//   LDG.E.64 Rptr, [Rdesc_table + binding*8]  ← load buffer address from descriptor
//   IMAD     Raddr, Ridx, 4, Rptr
//   LDG.E    R0, [Raddr]
//   FMUL     R1, R0, 2.0
//   STG.E    [Raddr_out], R1
// Extra indirection: one additional LDG to resolve the descriptor
```

## Expected: Vulkan BDA

```
// TBD — pipeline executable properties
// Pattern:
//   LDC.64  Rptr, c[0x0][push_const_offset]   ← load 64-bit address from push constant
//   IMAD    Raddr, Ridx, 4, Rptr               ← pointer arithmetic (identical to CUDA!)
//   LDG.E   R0, [Raddr]
//   FMUL    R1, R0, 2.0
//   STG.E   [Raddr_out], R1
// NO descriptor indirection — converges with CUDA pattern!
```

# Convergence Hypothesis

| Aspect | CUDA | Vulkan SSBO | Vulkan BDA |
|---|---|---|---|
| Address source | Constant bank (param) | Descriptor table (indirect) | Push constant (direct) |
| Extra loads | 0 | 1 (descriptor fetch) | 0 |
| SASS pattern | LDC → IMAD → LDG | LDC → LDG → IMAD → LDG | LDC → IMAD → LDG |
| Convergence | baseline | different | **converges with CUDA** |

If confirmed by actual SASS dumps, this validates Aaltonen's thesis: BDA makes Vulkan's memory access pattern ISA-identical to CUDA.

# Performance Results

| Model | Time (ms) | Notes |
|---|---:|---|
| CUDA raw ptr | TBD | Baseline |
| Vulkan SSBO | TBD | +1 descriptor load |
| Vulkan BDA | TBD | Expected ≈ CUDA |

# Code

Experiment code: `posts/worklog/cuda-vulkan-sass-series/exp04_bindless_bda/`

```bash
cmake --build build --target exp04_bindless_bda
./build/exp04_bindless_bda/exp04_bindless_bda
```

# References

- Sebastian Aaltonen, "There Is No Graphics API" — convergence thesis
- [VK_KHR_buffer_device_address](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_buffer_device_address.html)
- [GL_EXT_buffer_reference](https://github.com/KhronosGroup/GLSL/blob/master/extensions/ext/GLSL_EXT_buffer_reference.txt)
- [NVIDIA Vulkan BDA Usage Guide](https://developer.nvidia.com/blog/new-vulkan-device-memory-features/)

# Next

→ Worklog #07: JIT and pipeline caching — the compilation cost that hides behind the first dispatch.
