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

Memory access patterns dominate GPU kernel performance. This post compares AoS (Array of Structures) vs SoA (Structure of Arrays) layouts in both CUDA and Vulkan at the SASS level, focusing on the load instructions the compiler generates.

# The Problem: Reading One Field From 4-Component Data

Given N particles with `{x, y, z, w}` fields, we want to read only the `x` field:

- **AoS**: `struct { float x, y, z, w; } particles[N]` — reading `x` has stride 16 bytes
- **SoA**: `float x[N], y[N], z[N], w[N]` — reading `x` is contiguous, stride 4 bytes

On NVIDIA hardware, the memory controller coalesces requests from threads in a warp into 128-byte cache line transactions. SoA gives perfect coalescing; AoS wastes 75% of bandwidth reading unused `y, z, w` fields.

# Kernel Source

## AoS Read (CUDA)

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

## SoA Read (CUDA)

```cuda
extern "C" __global__
void read_soa_x(const float* x, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = x[idx];
    }
}
```

# SASS Analysis: What to Look For

## AoS Pattern — Expected SASS

```
// TBD — cuobjdump output for read_aos_x
// Key instruction to look for:
//   LDG.E R0, [Raddr]          ← 4-byte load from stride-16 addresses
// The address calculation will include a multiply by sizeof(Particle)=16
//   IMAD Raddr, Ridx, 16, Rbase
// Warp threads access addresses: base+0, base+16, base+32, ...
// → 4 cache line transactions per 32 threads (only 25% utilization)
```

## SoA Pattern — Expected SASS

```
// TBD — cuobjdump output for read_soa_x
// Key instruction to look for:
//   LDG.E R0, [Raddr]          ← same 4-byte load but contiguous
// Address calculation: simple idx*4
//   IMAD Raddr, Ridx, 4, Rbase
// Warp threads access addresses: base+0, base+4, base+8, ...
// → 1 cache line transaction per 32 threads (100% utilization)
```

## Wide Load Optimization (LDG.E.128)

The compiler may use `LDG.E.128` (128-bit / 16-byte load) for the AoS case, loading the entire struct in one transaction:

```
// If the compiler recognizes the struct layout:
//   LDG.E.128 R0:R3, [Raddr]   ← loads x,y,z,w in one 16-byte load
// Then extracts just R0 (the x field)
```

This would reduce AoS load transactions but still wastes register file and bandwidth reading unused fields.

# Coalescing Efficiency Table

| Layout | Bytes loaded per warp | Bytes useful per warp | Efficiency |
|---|---:|---:|---:|
| AoS (stride-16) | 4 × 128B = 512B | 32 × 4B = 128B | 25% |
| SoA (stride-4) | 1 × 128B = 128B | 32 × 4B = 128B | 100% |

# Performance Results

| Variant | CUDA (ms) | Vulkan (ms) | Bandwidth (GB/s) |
|---|---:|---:|---:|
| AoS | TBD | TBD | TBD |
| SoA | TBD | TBD | TBD |

Expected: SoA should be roughly 3-4x faster due to 4x better bandwidth efficiency.

# SASS Comparison: CUDA vs Vulkan

| Aspect | CUDA AoS | Vulkan AoS | Difference |
|---|---|---|---|
| Load instruction | TBD | TBD | Expected same |
| Address calc | TBD | TBD | Expected same |
| Stride | ×16 | ×16 | Same |

| Aspect | CUDA SoA | Vulkan SoA | Difference |
|---|---|---|---|
| Load instruction | TBD | TBD | Expected same |
| Address calc | TBD | TBD | Expected same |
| Stride | ×4 | ×4 | Same |

# Code

Experiment code: `posts/worklog/cuda-vulkan-sass-series/exp03_memory_coalescing/`

```bash
cmake --build build --target exp03_memory_coalescing
./build/exp03_memory_coalescing/exp03_memory_coalescing
```

# References

- [NVIDIA CUDA C++ Best Practices Guide: Coalesced Access](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory)
- gkseofla7's memory coalescing blog post (실측 비교)
- [NVIDIA GPU Architecture: Memory Hierarchy](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#device-memory-accesses)

# Next

→ Worklog #06: Bindless access and BDA — does Vulkan with buffer device addresses converge to CUDA-style pointer arithmetic in SASS?
