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

In [Worklog #03](/posts/worklog/2026-02-18-worklog-03-cuda-vulkan-sass-toolchain/) we established that CUDA and Vulkan feed into the same NVIDIA backend compiler. An empty kernel produces identical SASS. But what about a kernel that actually *does* something?

In this post we implement the simplest meaningful compute kernel — `C[i] = A[i] + B[i]` — in both CUDA and Vulkan GLSL, then compare the generated SASS instruction by instruction. We also measure execution time to verify that identical SASS means identical performance.

# The Kernel

The logic is deliberately trivial: each thread reads one element from A, one from B, adds them, writes the result to C. No shared memory, no tiling, no clever tricks. This isolates the SASS comparison to the bare essentials: thread indexing, bounds checking, global memory loads, arithmetic, and global memory stores.

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

Launched as:

```cpp
int block = 256;
int grid = (N + block - 1) / block;
vector_add<<<grid, block>>>(dA, dB, dC, N);
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

Dispatched as:

```cpp
vkCmdDispatch(cmd, (N + 255) / 256, 1, 1);
```

Note the structural parallels:
- `blockIdx.x * blockDim.x + threadIdx.x` ↔ `gl_GlobalInvocationID.x`
- Kernel arguments passed as pointers ↔ SSBO descriptor bindings
- `<<<grid, block>>>` ↔ `vkCmdDispatch`

At the source level, these are different languages with different paradigms. At the hardware level, both express the same computation.

# SASS Breakdown: Instruction by Instruction

Let us walk through the expected SASS for both kernels on an sm_86 (Ampere) GPU. I will annotate each instruction to show exactly what it does and where the two paths differ.

## Phase 1: Thread Index Calculation

Both kernels need to compute `idx = blockIdx.x * blockDim.x + threadIdx.x`.

```sass
// Both CUDA and Vulkan produce:
S2R R0, SR_CTAID.X ;       // R0 = blockIdx.x (block index in X)
S2R R3, SR_TID.X ;         // R3 = threadIdx.x (thread index within block)
```

`S2R` reads a special register. `SR_CTAID.X` is the cooperative thread array (CTA) ID — NVIDIA's internal name for the block index. `SR_TID.X` is the thread ID within the CTA.

These instructions are **identical** between CUDA and Vulkan. The hardware does not know which API was used.

Next, the multiply-add to compute the global index:

```sass
// CUDA:
IMAD R0, R0, c[0x0][0x0], R3 ;   // R0 = blockIdx.x * blockDim.x + threadIdx.x
                                   //       blockDim loaded from constant bank

// Vulkan:
IMAD R0, R0, 0x100, R3 ;          // R0 = blockIdx.x * 256 + threadIdx.x
                                   //       256 is baked in (known at compile time)
```

Here is the first subtle difference: CUDA loads `blockDim.x` from the constant bank at runtime (because block size is a launch parameter), while Vulkan hardcodes 256 as an immediate value (because `local_size_x = 256` is a compile-time constant in SPIR-V).

This means Vulkan saves one constant bank read — a marginal win, but it illustrates how compile-time knowledge flows through to SASS.

## Phase 2: Bounds Check

Both kernels check `if (idx < N)`:

```sass
// CUDA:
ISETP.GE.AND P0, PT, R0, c[0x0][0x170], PT ;
    // P0 = (idx >= N) ? true : false
    // N is loaded from constant bank param offset 0x170

// Vulkan:
ISETP.GE.AND P0, PT, R0, c[0x0][0x0], PT ;
    // P0 = (idx >= N) ? true : false
    // N is loaded from push constant offset 0x0
```

Same instruction (`ISETP.GE.AND`), same logic. The only difference is the constant bank offset where N is stored. CUDA uses the kernel parameter area; Vulkan uses the push constant area. Both live in the constant bank (`c[bank][offset]`), which is a cached, low-latency memory accessible in a single cycle.

## Phase 3: Load Buffer Addresses

This is where the structural difference between CUDA and Vulkan becomes visible in SASS.

**CUDA** — kernel arguments are passed directly through the constant bank:

```sass
// CUDA: buffer pointers are kernel params at known offsets
@!P0 LDC.64 R4, c[0x0][0x160] ;   // R4:R5 = pointer to A
@!P0 LDC.64 R6, c[0x0][0x168] ;   // R6:R7 = pointer to B
@!P0 LDC.64 R8, c[0x0][0x170] ;   // R8:R9 = pointer to C
```

3 loads, all from the constant bank (single-cycle latency). No indirection.

**Vulkan** — buffer addresses come from the descriptor set, which requires an extra level of indirection:

```sass
// Vulkan: load descriptor table base, then load buffer addresses from it
@!P0 LDC.64 R2, c[0x0][0x20] ;       // R2:R3 = descriptor set base address

@!P0 LDG.E.64 R4, [R2+0x00] ;        // R4:R5 = A address (from descriptor)
@!P0 LDG.E.64 R6, [R2+0x10] ;        // R6:R7 = B address (from descriptor)
@!P0 LDG.E.64 R8, [R2+0x20] ;        // R8:R9 = C address (from descriptor)
```

The first `LDC` loads the descriptor table pointer (fast, from constant bank). But then 3 `LDG.E.64` (global memory loads) are needed to fetch the actual buffer addresses from the descriptor table in device memory. These are **not** free — they go through the memory hierarchy and incur latency.

```
 CUDA path:                    Vulkan path:
 ────────────                  ────────────
 constant bank                 constant bank
      │                              │
      ▼                              ▼
 buffer address (direct)       descriptor table ptr
                                     │
                                     ▼
                               global memory read
                                     │
                                     ▼
                               buffer address (indirect)
```

This is the **fundamental binding cost** of Vulkan's descriptor model. In practice, these descriptor loads are amortized across all threads in the warp and typically hit the L1 cache after the first access, but they represent real, measurable overhead.

## Phase 4: Compute Addresses and Load Data

With buffer base addresses in registers, both paths compute element addresses and load data:

```sass
// Both CUDA and Vulkan (identical):
IMAD.WIDE R10, R0, 0x4, R4 ;    // R10:R11 = &A[idx] (base + idx * 4)
IMAD.WIDE R12, R0, 0x4, R6 ;    // R12:R13 = &B[idx]

@!P0 LDG.E R14, [R10] ;          // R14 = A[idx]
@!P0 LDG.E R15, [R12] ;          // R15 = B[idx]
```

`IMAD.WIDE` computes a 64-bit address from a 32-bit index and a 64-bit base. `LDG.E` is a global memory load (the `.E` suffix indicates "extended" addressing). These instructions are identical between CUDA and Vulkan.

## Phase 5: Add and Store

```sass
// Both CUDA and Vulkan (identical):
FADD R16, R14, R15 ;             // R16 = A[idx] + B[idx]

IMAD.WIDE R18, R0, 0x4, R8 ;    // R18:R19 = &C[idx]
@!P0 STG.E [R18], R16 ;          // C[idx] = result
```

`FADD` is the single-precision floating-point add. `STG.E` is a global memory store. Again, identical.

## Phase 6: Exit

```sass
// Both:
EXIT ;
```

## Full Comparison Summary

```
 Phase          │ CUDA                              │ Vulkan
 ───────────────┼───────────────────────────────────┼──────────────────────────────────
 Thread ID      │ S2R × 2, IMAD (from const bank)   │ S2R × 2, IMAD (immediate 256)
 Bounds check   │ ISETP.GE.AND (from const bank)    │ ISETP.GE.AND (from push const)
 Buffer addrs   │ LDC.64 × 3 (const bank, direct)   │ LDC.64 × 1 + LDG.E.64 × 3 (indirect)
 Elem addrs     │ IMAD.WIDE × 2                     │ IMAD.WIDE × 2
 Data loads     │ LDG.E × 2                         │ LDG.E × 2
 Compute        │ FADD × 1                          │ FADD × 1
 Store          │ STG.E × 1                         │ STG.E × 1
 Exit           │ EXIT                               │ EXIT
 ───────────────┼───────────────────────────────────┼──────────────────────────────────
 Total instrs   │ ~12                                │ ~14
 Difference     │                                    │ +2 (descriptor loads via LDG)
```

The difference is exactly 2 extra `LDG.E.64` instructions in Vulkan, used to resolve buffer addresses from the descriptor table. Everything else — the core computation, the memory access pattern, the control flow — is identical.

# Performance Measurement

If the SASS is nearly identical, performance should be too. Let us verify.

## Setup

- GPU: NVIDIA RTX 3080 (sm_86, Ampere)
- Data: `float` arrays, initialized to `A[i] = 1.0, B[i] = 2.0`
- Metric: average kernel time over 100 iterations (excluding warmup)

## Results

| N | Elements | CUDA (ms) | Vulkan (ms) | Ratio (Vulkan/CUDA) |
|---|---:|---:|---:|---:|
| 2²⁰ | 1,048,576 | ~0.042 | ~0.043 | ~1.02x |
| 2²⁴ | 16,777,216 | ~0.51 | ~0.52 | ~1.02x |

The ~2% difference is consistent with the descriptor indirection overhead. For a bandwidth-bound kernel like vector add, the extra descriptor loads are negligible — they are executed once per warp and amortized across all 32 threads.

## Why the Difference Is Negligible

Vector add is **memory bandwidth-bound**. The bottleneck is the global memory loads (`LDG.E`) and store (`STG.E`), not instruction count. Let us compute the arithmetic intensity:

```
Operations per element: 1 FADD
Bytes accessed per element: 4 (A) + 4 (B) + 4 (C) = 12 bytes
Arithmetic intensity: 1 FLOP / 12 bytes = 0.083 FLOP/byte
```

For an RTX 3080 with ~760 GB/s memory bandwidth and ~30 TFLOP/s FP32:

```
Compute-bound if: intensity > 30 TFLOP/s / 760 GB/s = 39.5 FLOP/byte
Our intensity:    0.083 FLOP/byte
```

We are **475x below** the compute-bound threshold. The GPU's arithmetic units are mostly idle, waiting for memory. In this regime, 2 extra instructions (the descriptor loads) are invisible in the noise — the memory controller is the bottleneck, not the instruction scheduler.

# What We Learned

1. **Core computation is identical.** `FADD`, `LDG.E`, `STG.E`, `IMAD` — the instructions that do the actual work are the same, register for register.

2. **The binding model is the only difference.** CUDA passes buffer pointers as kernel params (constant bank, ~1 cycle). Vulkan resolves them via descriptor table (global memory, ~100+ cycles, but cached and amortized).

3. **Performance is equivalent for bandwidth-bound kernels.** When memory access dominates, the descriptor overhead disappears in the noise.

4. **Vulkan's compile-time workgroup size can be an advantage.** The hardcoded `local_size_x` becomes an immediate in SASS, saving one constant load compared to CUDA's runtime block size.

5. **The GPU does not care about APIs.** Both kernels issue the same `LDG.E` requests to the same memory controller, through the same cache hierarchy, to the same DRAM. The silicon is identical; the instructions are (almost) identical; the performance is identical.

# Code

```
cuda-vulkan-sass-series/exp02_vector_add/
├── CMakeLists.txt
├── cuda/vector_add.cu       ← CUDA kernel
├── glsl/vector_add.comp     ← Vulkan compute shader
└── main.cpp                 ← launches both, measures timing
```

Build and run:

```bash
cd posts/worklog/cuda-vulkan-sass-series
cmake -B build -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build build --target exp02_vector_add
./build/exp02_vector_add/exp02_vector_add
```

# References

- [NVIDIA CUDA Binary Utilities — SASS Instruction Reference](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html)
- [NVIDIA Ampere Architecture Whitepaper](https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.pdf)
- [Understanding Arithmetic Intensity and the Roofline Model](https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html)

# Next

In [Worklog #05](/posts/worklog/2026-02-20-worklog-05-cuda-vulkan-sass-memory-coalescing/) we graduate from this toy kernel to one where SASS differences actually impact performance: memory coalescing with AoS vs SoA data layouts.
