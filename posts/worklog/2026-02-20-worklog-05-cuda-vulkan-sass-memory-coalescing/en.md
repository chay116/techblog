---
title: "Worklog #05 - Memory Coalescing at SASS Level"
date: "2026-02-20"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "api-language"
tags: ["cuda", "vulkan", "nvidia", "sass", "memory-coalescing"]
---

In the previous two posts, we saw that CUDA and Vulkan produce nearly identical SASS for simple kernels, with the only difference being descriptor binding overhead. But for the vector add kernel, that did not matter because the kernel was purely bandwidth-bound and the computation was trivial.

Now let us look at a case where the *memory access pattern* — how threads in a warp access addresses — makes a dramatic difference in performance. The hardware is the same. The SASS instruction (`LDG.E`) is the same. But depending on how addresses are laid out, the memory controller will execute 1 transaction or 4 transactions for the same warp. This is where understanding coalescing at the ISA level pays off.

# The Problem: AoS vs SoA

Imagine we have N particles, each with 4 float fields: `x, y, z, w`. We want to read only the `x` field.

## Array of Structures (AoS)

```
Memory layout (AoS):
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───
│ x₀   │ y₀   │ z₀   │ w₀   │ x₁   │ y₁   │ z₁   │ w₁   │ ...
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴───
  4B     4B     4B     4B     4B     4B     4B     4B

Thread 0 reads x₀ at offset 0
Thread 1 reads x₁ at offset 16
Thread 2 reads x₂ at offset 32
...

Stride between consecutive threads: 16 bytes
```

## Structure of Arrays (SoA)

```
Memory layout (SoA):
┌──────┬──────┬──────┬──────┬──────┬──────┬───
│ x₀   │ x₁   │ x₂   │ x₃   │ x₄   │ x₅   │ ...
└──────┴──────┴──────┴──────┴──────┴──────┴───
  4B     4B     4B     4B     4B     4B

Thread 0 reads x₀ at offset 0
Thread 1 reads x₁ at offset 4
Thread 2 reads x₂ at offset 8
...

Stride between consecutive threads: 4 bytes
```

# How NVIDIA Memory Coalescing Works

On NVIDIA GPUs, the memory controller serves requests at the granularity of **128-byte cache line sectors**. When a warp (32 threads) issues a load instruction, the hardware coalesces individual thread requests into the minimum number of 128-byte transactions:

```
One 128-byte cache line = 32 × 4-byte floats

SoA pattern (stride 4B):
┌────────────────────── 128 bytes ──────────────────────┐
│ x₀  x₁  x₂  x₃  x₄  x₅  ... x₃₁                    │
└───────────────────────────────────────────────────────┘
Thread: 0   1   2   3   4   5       31
→ 1 transaction, 128 bytes loaded, 128 bytes useful = 100% efficiency

AoS pattern (stride 16B):
┌────────────── 128 bytes ──────────────┐
│ x₀ y₀ z₀ w₀  x₁ y₁ z₁ w₁ ... x₇ y₇ z₇ w₇ │
└───────────────────────────────────────┘
Thread: 0          1              7
→ Only 8 threads served per 128B transaction
→ Need 4 transactions for all 32 threads
→ 512 bytes loaded, 128 bytes useful = 25% efficiency
```

Let me draw the full picture:

```
 AoS: 32 threads reading x[idx]              SoA: 32 threads reading x[idx]
 ─────────────────────────────────            ─────────────────────────────────
 Thread  Address        Cache Line            Thread  Address        Cache Line
 ──────  ─────────────  ──────────            ──────  ─────────────  ──────────
 T0      base + 0       Line 0                T0      base + 0       Line 0
 T1      base + 16      Line 0                T1      base + 4       Line 0
 T2      base + 32      Line 0                T2      base + 8       Line 0
 T3      base + 48      Line 0                T3      base + 12      Line 0
 T4      base + 64      Line 0                ...     ...            Line 0
 T5      base + 80      Line 0                T31     base + 124     Line 0
 T6      base + 96      Line 0
 T7      base + 112     Line 0                → 1 transaction, 0% waste
 T8      base + 128     Line 1
 T9      base + 144     Line 1                ─────────────────────────────────
 ...     ...            ...
 T31     base + 496     Line 3

 → 4 transactions, 75% waste
```

# The Kernels

## CUDA — AoS Read

```cuda
struct Particle { float x, y, z, w; };

extern "C" __global__
void read_aos_x(const Particle* particles, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = particles[idx].x;
    }
}
```

## CUDA — SoA Read

```cuda
extern "C" __global__
void read_soa_x(const float* x, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = x[idx];
    }
}
```

## Vulkan — AoS Read

```glsl
#version 450
layout(local_size_x = 256) in;

struct Particle { float x, y, z, w; };

layout(std430, binding = 0) readonly buffer BufIn { Particle particles[]; };
layout(std430, binding = 1) writeonly buffer BufOut { float out_x[]; };

layout(push_constant) uniform PushConstants { int N; };

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        out_x[idx] = particles[idx].x;
    }
}
```

## Vulkan — SoA Read

```glsl
#version 450
layout(local_size_x = 256) in;

layout(std430, binding = 0) readonly buffer BufX { float x_arr[]; };
layout(std430, binding = 1) writeonly buffer BufOut { float out_x[]; };

layout(push_constant) uniform PushConstants { int N; };

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx < N) {
        out_x[idx] = x_arr[idx];
    }
}
```

# SASS Analysis: What the Compiler Does

## SoA — Contiguous Access

The SoA kernel is effectively the same as our vector add from Worklog #04 (just a copy instead of an add). The SASS is clean and simple:

```sass
// SoA read_soa_x — CUDA SASS (sm_86)
S2R R0, SR_CTAID.X ;                 // blockIdx.x
S2R R3, SR_TID.X ;                   // threadIdx.x
IMAD R0, R0, c[0x0][0x0], R3 ;       // idx = blockIdx.x * blockDim + threadIdx
ISETP.GE.AND P0, PT, R0, c[0x0][0x170], PT ;  // if (idx >= N) skip

// Load x[idx] — contiguous 4-byte stride
@!P0 LDC.64 R4, c[0x0][0x160] ;      // R4:R5 = base pointer of x[]
@!P0 IMAD.WIDE R6, R0, 0x4, R4 ;     // R6:R7 = &x[idx]
@!P0 LDG.E R8, [R6] ;                // R8 = x[idx]  ← single coalesced load

// Store out[idx] — also contiguous
@!P0 LDC.64 R10, c[0x0][0x168] ;     // R10:R11 = base pointer of out[]
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;   // R12:R13 = &out[idx]
@!P0 STG.E [R12], R8 ;               // out[idx] = x[idx]

EXIT ;
```

The key instruction is `LDG.E R8, [R6]` — a 4-byte load. With SoA, consecutive threads have consecutive addresses (stride 4), so the memory controller coalesces all 32 thread requests into a single 128-byte transaction.

## AoS — Strided Access

```sass
// AoS read_aos_x — CUDA SASS (sm_86)
S2R R0, SR_CTAID.X ;
S2R R3, SR_TID.X ;
IMAD R0, R0, c[0x0][0x0], R3 ;
ISETP.GE.AND P0, PT, R0, c[0x0][0x170], PT ;

// Load particles[idx].x — stride 16 bytes (sizeof(Particle))
@!P0 LDC.64 R4, c[0x0][0x160] ;      // R4:R5 = base of particles[]
@!P0 IMAD.WIDE R6, R0, 0x10, R4 ;    // R6:R7 = &particles[idx]
                                       //          ^^^ 0x10 = 16 = sizeof(Particle)
@!P0 LDG.E R8, [R6] ;                // R8 = particles[idx].x  ← only reads .x!

@!P0 LDC.64 R10, c[0x0][0x168] ;
@!P0 IMAD.WIDE R12, R0, 0x4, R10 ;
@!P0 STG.E [R12], R8 ;

EXIT ;
```

Look at the `IMAD.WIDE` for the address calculation: the stride is `0x10` (16 bytes) instead of `0x4` (4 bytes). The `LDG.E R8, [R6]` instruction itself is identical — it is still a 4-byte load. But because addresses are now spaced 16 bytes apart, the memory controller needs 4× more transactions.

The SASS instructions are **almost the same length**. The performance difference is entirely in how the memory controller handles the resulting access pattern.

## Potential Compiler Optimization: Wide Load

In some cases, the compiler may recognize the struct layout and emit a wide load:

```sass
// Hypothetical optimized AoS:
@!P0 LDG.E.128 R8, [R6] ;   // Load 16 bytes (x, y, z, w) at once
// Then use only R8 (the x field), discarding R9, R10, R11
```

`LDG.E.128` is a 128-bit (16-byte) load. This would be a single coalesced transaction per thread (since 8 threads × 16B = 128B per cache line), but it wastes bandwidth and register file space loading y, z, w that we never use.

Whether the compiler does this depends on the optimization level, the surrounding code, and sometimes seemingly random factors. Checking the actual SASS output is the only way to know.

# Performance Results

Tested on NVIDIA RTX 3080 (sm_86), N = 4M particles, 100 iterations.

| Variant | Time (ms) | Effective BW (GB/s) | Mem Transactions per Warp |
|---|---:|---:|---:|
| CUDA SoA | ~0.17 | ~95 | 1 (load) + 1 (store) |
| CUDA AoS | ~0.58 | ~28 | 4 (load) + 1 (store) |
| Vulkan SoA | ~0.17 | ~95 | 1 (load) + 1 (store) |
| Vulkan AoS | ~0.59 | ~27 | 4 (load) + 1 (store) |

```
 Performance (lower is better):
 ────────────────────────────────────────────────────
 CUDA  SoA  ████████░░░░░░░░░░░░░░░░  0.17 ms
 CUDA  AoS  ██████████████████████████████  0.58 ms
 Vulk  SoA  ████████░░░░░░░░░░░░░░░░  0.17 ms
 Vulk  AoS  ██████████████████████████████  0.59 ms
 ────────────────────────────────────────────────────
 Speedup SoA over AoS: ~3.4x
```

Observations:

1. **SoA is 3.4× faster than AoS** — close to the theoretical 4× from our coalescing analysis (the gap from 4× is because the store is always coalesced regardless of layout).

2. **CUDA and Vulkan are identical within noise** — same access pattern → same memory controller behavior → same performance.

3. **The SASS instruction count is nearly the same** for AoS and SoA. The performance difference comes entirely from the memory access pattern, not from the instruction stream.

# The Bandwidth Math

Let us verify our numbers against the roofline:

```
Data per element:
  SoA: 4B read (x) + 4B write (out) = 8 bytes
  AoS: 16B read (x,y,z,w) + 4B write (out) = 20 bytes actual
       but we only NEED: 4B read + 4B write = 8 bytes
       → 12 bytes wasted per element

For N = 4M elements:
  SoA transferred: 4M × 8B = 32 MB
  AoS transferred: 4M × 20B = 80 MB

RTX 3080 peak bandwidth: ~760 GB/s

  SoA time: 32 MB / 760 GB/s ≈ 0.042 ms (theoretical min)
  AoS time: 80 MB / 760 GB/s ≈ 0.105 ms (theoretical min)

  Measured SoA: 0.17 ms → ~42% of peak (typical for small kernels)
  Measured AoS: 0.58 ms → ~30% of peak (cache thrashing further hurts)
```

The AoS version achieves lower percentage of peak bandwidth because the scattered access pattern causes more cache line evictions and TLB pressure.

# CUDA vs Vulkan: No Difference in Coalescing

This is the key finding: **the memory coalescing behavior is determined by the access pattern, not the API**. The memory controller sees addresses from warps — it has no concept of "CUDA address" or "Vulkan address". If threads in a warp access consecutive 4-byte addresses, you get perfect coalescing. If they access addresses 16 bytes apart, you get 25% efficiency. The API is irrelevant.

The SASS difference we saw in Worklog #04 (descriptor indirection) is also irrelevant here: the descriptor loads happen once per warp during address setup. The per-element loads and stores — which dominate the runtime — are identical.

# Practical Implications for vAI

For the vAI compute backend, this means:

1. **Always use SoA for data that will be partially read.** If a kernel only needs position data, do not pack it with velocity, mass, and lifetime.

2. **The API choice does not matter for memory patterns.** Pick CUDA or Vulkan based on ecosystem needs, not memory performance.

3. **Profile with Nsight Compute** to check actual L2 sector hit rates: `l1tex__t_sectors_pipe_lsu_mem_global_op_ld.sum` shows the number of sectors fetched.

# Code

```
cuda-vulkan-sass-series/exp03_memory_coalescing/
├── CMakeLists.txt
├── cuda/coalesce_aos.cu      ← AoS read kernel
├── cuda/coalesce_soa.cu      ← SoA read kernel
├── glsl/coalesce_aos.comp    ← Vulkan AoS
├── glsl/coalesce_soa.comp    ← Vulkan SoA
└── main.cpp                  ← runs all 4 variants with timing
```

# References

- [NVIDIA CUDA C++ Best Practices Guide: Coalesced Access to Global Memory](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory)
- [NVIDIA Ampere GA102 Architecture Whitepaper](https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.pdf)
- [Nsight Compute Memory Throughput Analysis](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html)

# Next

In [Worklog #06](/posts/worklog/2026-02-21-worklog-06-cuda-vulkan-sass-bindless-bda/) we tackle the descriptor indirection problem directly: can Vulkan's Buffer Device Address (BDA) eliminate the descriptor table lookup and produce CUDA-identical SASS?
