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

In [Worklog #04](/posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/) we identified the one structural SASS difference between CUDA and Vulkan: the descriptor indirection. CUDA passes buffer addresses directly through the constant bank. Vulkan fetches them from a descriptor table in global memory, adding extra `LDG` instructions.

Sebastian Aaltonen's "There Is No Graphics API" thesis argues that modern Vulkan is converging with CUDA at the hardware level. The evidence for this claim is `VK_KHR_buffer_device_address` (BDA) — a Vulkan extension that lets shaders receive raw 64-bit GPU pointers through push constants, bypassing the descriptor table entirely.

If BDA works as theorized, the Vulkan SASS should become structurally identical to CUDA's. No descriptor indirection. No extra loads. The same register-based pointer arithmetic.

Let us test this.

# Three Resource Binding Models

Here is how buffer addresses reach the shader in each model:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                    CUDA: Raw Pointer                            │
 │                                                                  │
 │  Host: cuLaunchKernel(func, ..., &args, ...)                    │
 │                       │                                          │
 │                       ▼                                          │
 │  Constant bank: c[0x0][0x160] = buffer_ptr (64-bit)             │
 │                       │                                          │
 │  SASS: LDC.64 R2, c[0x0][0x160]  ← 1 load, ~1 cycle           │
 │                       │                                          │
 │  Kernel: R2 is the buffer pointer. Done.                        │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │               Vulkan: Descriptor-Bound SSBO                     │
 │                                                                  │
 │  Host: vkUpdateDescriptorSets → vkCmdBindDescriptorSets         │
 │                       │                                          │
 │                       ▼                                          │
 │  Constant bank: c[0x0][0x20] = descriptor_table_ptr             │
 │                       │                                          │
 │  SASS: LDC.64 R2, c[0x0][0x20]    ← load table base            │
 │        LDG.E.64 R4, [R2+0x10]     ← load buffer addr from table│
 │                       │               (~100 cycles, but cached)  │
 │  Kernel: R4 is the buffer pointer.                              │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │          Vulkan: Buffer Device Address (BDA)                    │
 │                                                                  │
 │  Host: vkCmdPushConstants(cmd, ..., &device_address, 8)         │
 │                       │                                          │
 │                       ▼                                          │
 │  Constant bank: c[0x0][0x0] = buffer_ptr (64-bit, via push)    │
 │                       │                                          │
 │  SASS: LDC.64 R2, c[0x0][0x0]    ← 1 load, ~1 cycle           │
 │                       │                                          │
 │  Kernel: R2 is the buffer pointer. Done.                        │
 │                                                                  │
 │  ✓ Same as CUDA!                                                │
 └─────────────────────────────────────────────────────────────────┘
```

The key insight: push constants in Vulkan are stored in the **same constant bank** that CUDA uses for kernel parameters. When you pass a 64-bit device address via push constants, the shader accesses it with the same `LDC.64` instruction CUDA uses. No descriptor table. No extra global memory load.

# The Kernels

All three kernels do the same operation: `out[idx] = data[idx] * 2.0`.

## CUDA — Raw Pointer

```cuda
extern "C" __global__
void read_via_pointer(const float* data, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = data[idx] * 2.0f;
    }
}
```

This is the natural CUDA way. `data` and `out` are raw device pointers. The compiler knows they point to global memory.

## Vulkan — Descriptor-Bound SSBO

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

The traditional Vulkan approach. Buffer addresses are resolved through descriptor sets at dispatch time.

## Vulkan — BDA (Buffer Device Address)

```glsl
#version 450
#extension GL_EXT_buffer_reference : require
#extension GL_EXT_buffer_reference2 : require

layout(local_size_x = 256) in;

layout(buffer_reference, std430, buffer_reference_align = 4)
    readonly buffer FloatBufIn { float data[]; };

layout(buffer_reference, std430, buffer_reference_align = 4)
    writeonly buffer FloatBufOut { float data[]; };

layout(push_constant) uniform PushConstants {
    FloatBufIn inPtr;     // 64-bit device address
    FloatBufOut outPtr;   // 64-bit device address
    int N;
};

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        outPtr.data[idx] = inPtr.data[idx] * 2.0;
    }
}
```

The BDA approach. `FloatBufIn` and `FloatBufOut` are **buffer references** — GLSL's way of declaring a pointer type. The 64-bit addresses are passed through push constants, which map directly to the constant bank.

On the host side:

```cpp
// Get the device address
VkBufferDeviceAddressInfo addrInfo{VK_STRUCTURE_TYPE_BUFFER_DEVICE_ADDRESS_INFO};
addrInfo.buffer = inputBuffer;
uint64_t inputAddr = vkGetBufferDeviceAddress(device, &addrInfo);

// Push it to the shader
struct PushData { uint64_t inPtr; uint64_t outPtr; int N; };
PushData push = { inputAddr, outputAddr, N };
vkCmdPushConstants(cmd, layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(push), &push);
```

This is remarkably similar to how CUDA passes device pointers as kernel arguments. The conceptual model is the same: "here is a 64-bit address, do pointer arithmetic on it."

# SASS Comparison

## CUDA — Raw Pointer SASS

```sass
// Thread index
S2R R0, SR_CTAID.X ;
S2R R3, SR_TID.X ;
IMAD R0, R0, c[0x0][0x0], R3 ;
ISETP.GE.AND P0, PT, R0, c[0x0][0x178], PT ;   // bounds check (N)

// Load input address from constant bank (kernel param)
@!P0 LDC.64 R4, c[0x0][0x160] ;        // R4:R5 = data pointer
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;       // R6:R7 = &data[idx]
@!P0 LDG.E R8, [R6] ;                  // R8 = data[idx]

// Compute
@!P0 FMUL R8, R8, 2.0 ;               // R8 = data[idx] * 2.0

// Store
@!P0 LDC.64 R10, c[0x0][0x168] ;       // R10:R11 = out pointer
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;     // R12:R13 = &out[idx]
@!P0 STG.E [R12], R8 ;                 // out[idx] = result

EXIT ;
```

**Pattern: `LDC.64` → `IMAD.WIDE` → `LDG.E` → compute → `STG.E`**

## Vulkan — Descriptor SSBO SASS

```sass
// Thread index (identical)
S2R R0, SR_CTAID.X ;
S2R R3, SR_TID.X ;
IMAD R0, R0, 0x100, R3 ;               // 256 hardcoded
ISETP.GE.AND P0, PT, R0, c[0x0][0x0], PT ;  // N from push const

// Load descriptor table base
@!P0 LDC.64 R2, c[0x0][0x20] ;          // descriptor table pointer

// Load input address FROM descriptor table (extra indirection!)
@!P0 LDG.E.64 R4, [R2+0x00] ;          // R4:R5 = data_in address ← EXTRA LOAD
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;
@!P0 LDG.E R8, [R6] ;                  // R8 = data_in[idx]

@!P0 FMUL R8, R8, 2.0 ;

// Load output address FROM descriptor table (extra indirection!)
@!P0 LDG.E.64 R10, [R2+0x10] ;         // R10:R11 = data_out address ← EXTRA LOAD
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;

EXIT ;
```

**Pattern: `LDC.64` → `LDG.E.64` → `IMAD.WIDE` → `LDG.E` → compute → `STG.E`**

Two extra `LDG.E.64` instructions for descriptor resolution.

## Vulkan — BDA SASS

```sass
// Thread index (identical)
S2R R0, SR_CTAID.X ;
S2R R3, SR_TID.X ;
IMAD R0, R0, 0x100, R3 ;
ISETP.GE.AND P0, PT, R0, c[0x0][0x10], PT ;   // N from push const

// Load input address from push constant (constant bank!)
@!P0 LDC.64 R4, c[0x0][0x0] ;          // R4:R5 = inPtr (from push constant)
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;       // &inPtr.data[idx]
@!P0 LDG.E R8, [R6] ;                  // data[idx]

@!P0 FMUL R8, R8, 2.0 ;

// Load output address from push constant (constant bank!)
@!P0 LDC.64 R10, c[0x0][0x8] ;         // R10:R11 = outPtr (from push constant)
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;

EXIT ;
```

**Pattern: `LDC.64` → `IMAD.WIDE` → `LDG.E` → compute → `STG.E`**

This is **structurally identical to CUDA**. The buffer addresses come from the constant bank via `LDC.64`, exactly like CUDA's kernel parameters. No descriptor table. No extra global memory loads.

# The Convergence Table

```
 Instruction sequence comparison:
 ─────────────────────────────────────────────────────────────────────
           CUDA Pointer    Vulkan SSBO         Vulkan BDA
 ─────────────────────────────────────────────────────────────────────
 idx calc  S2R + IMAD      S2R + IMAD          S2R + IMAD
 bounds    ISETP           ISETP               ISETP
 get addr  LDC.64          LDC.64 + LDG.E.64  LDC.64
 elem addr IMAD.WIDE       IMAD.WIDE           IMAD.WIDE
 load      LDG.E           LDG.E               LDG.E
 compute   FMUL            FMUL                FMUL
 store     STG.E           STG.E               STG.E
 ─────────────────────────────────────────────────────────────────────
 Total     ~11 instrs      ~13 instrs          ~11 instrs
 Extra     baseline        +2 (descriptor)     +0 ✓
 ─────────────────────────────────────────────────────────────────────
```

**BDA eliminates the descriptor indirection.** At the SASS level, Vulkan BDA and CUDA produce functionally equivalent code.

# Performance Measurement

GPU: NVIDIA RTX 3080 (sm_86), N = 1M, 100 iterations.

| Model | Time (ms) | vs CUDA |
|---|---:|---:|
| CUDA raw pointer | ~0.038 | 1.00x |
| Vulkan SSBO | ~0.039 | ~1.03x |
| Vulkan BDA | ~0.038 | ~1.00x |

The SSBO overhead (~3%) comes from the descriptor table loads. BDA eliminates it completely, matching CUDA.

For bandwidth-bound kernels (most real workloads), even the SSBO overhead is negligible. But for latency-sensitive kernels or tight loops with many buffer accesses, BDA provides measurably better performance.

# Why This Matters: Aaltonen's Convergence Thesis

Sebastian Aaltonen argued that graphics APIs are converging toward compute APIs at the hardware level. BDA is the strongest evidence for this:

```
Evolution of Vulkan buffer access:
─────────────────────────────────────────────────────
2016  Vulkan 1.0     Descriptor sets only          Far from CUDA
2019  VK 1.2 + BDA   Push raw pointers via push    ≈ CUDA pointers
2023  VK 1.3 + desc  Descriptor buffer + BDA       ≈ CUDA pointers
─────────────────────────────────────────────────────
```

With BDA, the Vulkan programming model for compute becomes:
1. Allocate buffers
2. Get device addresses (`vkGetBufferDeviceAddress`)
3. Push addresses to shaders
4. Do pointer arithmetic in the shader

This is exactly the CUDA model, just with different API names. And as we have shown, the SASS is identical.

# When to Use Each Model

| Model | Use Case | Trade-off |
|---|---|---|
| Vulkan SSBO | Standard graphics pipelines, compatibility | Extra indirection, but well-supported |
| Vulkan BDA | Compute-heavy, many buffers, ray tracing | Requires Vulkan 1.2+, manual lifetime management |
| CUDA pointer | CUDA ecosystem | NVIDIA-only, no cross-vendor |

For vAI, BDA is the clear choice for the Vulkan compute backend. It gives us CUDA-equivalent performance with the portability of Vulkan (when targeting non-NVIDIA GPUs, we fall back to SSBOs).

# Code

```
cuda-vulkan-sass-series/exp04_bindless_bda/
├── CMakeLists.txt
├── cuda/raw_ptr.cu           ← CUDA raw pointer kernel
├── glsl/ubo_access.comp      ← Vulkan SSBO kernel
├── glsl/bda_access.comp      ← Vulkan BDA kernel
└── main.cpp                  ← runs all 3, compares timing
```

# References

- Sebastian Aaltonen, "There Is No Graphics API"
- [VK_KHR_buffer_device_address — Vulkan Spec](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_buffer_device_address.html)
- [GL_EXT_buffer_reference — GLSL Extension](https://github.com/KhronosGroup/GLSL/blob/master/extensions/ext/GLSL_EXT_buffer_reference.txt)
- [NVIDIA Blog: New Vulkan Device Memory Features](https://developer.nvidia.com/blog/new-vulkan-device-memory-features/)
- [Vulkan Guide: Buffer Device Address](https://docs.vulkan.org/guide/latest/extensions/VK_KHR_buffer_device_address.html)

# Next

In [Worklog #07](/posts/worklog/2026-02-22-worklog-07-cuda-vulkan-sass-jit-pipeline-cache/) we examine the last major difference: compilation caching. The SASS may be identical, but how much does it cost to produce that SASS, and how do CUDA and Vulkan cache the result?
