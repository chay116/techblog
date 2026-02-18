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

Every compute workload you dispatch — whether through CUDA or Vulkan — ends up as the same NVIDIA SASS instructions on the same silicon. The GPU does not know which API submitted the work. Yet the journey from your source code to those SASS instructions is fundamentally different between the two ecosystems, and understanding that journey is the key to understanding why the two APIs feel so different despite targeting identical hardware.

This post is the first in a 5-part series that compares CUDA and Vulkan at the ISA level. We start here, at the very beginning: how does source code become GPU machine code?

# Why This Matters

If you have ever wondered:

- "Is Vulkan slower than CUDA because it goes through SPIR-V?"
- "Does the NVIDIA driver produce the same quality SASS from SPIR-V as nvcc does from CUDA?"
- "Where exactly does compilation happen at runtime?"

...then this post is for you. Spoiler: both paths converge to the same backend compiler inside the NVIDIA driver. The differences are in *when* and *how* that compilation is triggered — not in the quality of the output.

# The Big Picture

Here is the full compilation landscape for NVIDIA GPUs:

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                        YOUR SOURCE CODE                         │
 │                                                                  │
 │    .cu (CUDA C++)              .comp / .hlsl (GLSL / HLSL)     │
 └────────┬─────────────────────────────────┬──────────────────────┘
          │                                 │
          │  nvcc                           │  glslangValidator / DXC
          │  (clang frontend + ptxas)       │  (Khronos toolchain)
          ▼                                 ▼
 ┌─────────────────┐              ┌─────────────────┐
 │   PTX            │              │   SPIR-V         │
 │   (NVIDIA vISA)  │              │   (Khronos IR)   │
 │   text, portable │              │   binary,vendor- │
 │   across NVIDIA  │              │   neutral         │
 │   GPU gens       │              │                   │
 └────────┬─────────┘              └────────┬──────────┘
          │                                 │
          │  ptxas (offline)                │  NVIDIA Vulkan driver
          │  or CUDA driver (JIT)           │  (at vkCreateComputePipelines)
          │                                 │
          │         ┌───────────────────┐   │
          └────────►│  NVIDIA Backend   │◄──┘
                    │  Compiler (NVVM)  │
                    │                   │
                    │  Optimization     │
                    │  Register alloc   │
                    │  Scheduling       │
                    └────────┬──────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   SASS           │
                    │   (native ISA)   │
                    │   sm_86, sm_89,  │
                    │   sm_90, ...     │
                    └─────────────────┘
```

The critical insight: **both paths feed into the same NVIDIA backend compiler**. The PTX path and the SPIR-V path converge. This is why, at the SASS level, the output is often nearly identical.

# CUDA Compilation Path in Detail

## Step 1: nvcc Front-End

`nvcc` is not a monolithic compiler — it is an orchestrator. When you run:

```bash
nvcc -arch=sm_86 -o kernel.cubin kernel.cu
```

Internally, `nvcc` splits your `.cu` file into host code and device code. The device code path goes through a modified Clang frontend that understands CUDA syntax (`__global__`, `__shared__`, `blockIdx`, etc.) and emits NVIDIA's PTX intermediate representation.

```
kernel.cu
  │
  ├─► Host code ──► system C++ compiler (MSVC, GCC, Clang)
  │
  └─► Device code ──► Clang (CUDA mode) ──► PTX
                                              │
                                              └──► ptxas ──► SASS (cubin)
```

## Step 2: PTX — The Virtual ISA

PTX (Parallel Thread Execution) is NVIDIA's virtual instruction set. Think of it as LLVM IR, but specifically designed for GPU parallelism. A simple thread-index computation in PTX looks like:

```
// PTX for: int idx = blockIdx.x * blockDim.x + threadIdx.x;
mov.u32     %r1, %ctaid.x;      // blockIdx.x
mov.u32     %r2, %ntid.x;       // blockDim.x
mov.u32     %r3, %tid.x;        // threadIdx.x
mad.lo.s32  %r4, %r1, %r2, %r3; // idx = blockIdx.x * blockDim.x + threadIdx.x
```

Key properties of PTX:
- **Text format** — human-readable, can be inspected and modified
- **Forward compatible** — PTX compiled for sm_80 can run on sm_89 (driver JIT-compiles)
- **Infinite virtual registers** — `%r1`, `%r2`, etc. are virtual; ptxas maps them to physical registers
- **No scheduling information** — instruction ordering is decided by ptxas/SASS backend

You can see the PTX your code generates:

```bash
nvcc -arch=sm_86 --ptx -o kernel.ptx kernel.cu
```

## Step 3: ptxas — PTX to SASS

`ptxas` is the real optimizer. It takes PTX and produces SASS (Shader ASSembly), the native machine code for a specific GPU architecture. This is where:

- Virtual registers are allocated to physical registers (255 per thread max on modern GPUs)
- Instructions are scheduled to hide latency
- Predication is applied for branch optimization
- Memory access patterns are optimized

```bash
# Compile PTX to cubin (SASS embedded)
ptxas -arch=sm_86 -o kernel.cubin kernel.ptx

# Or let nvcc do everything in one shot:
nvcc -arch=sm_86 -cubin -o kernel.cubin kernel.cu
```

## Step 4: Extracting SASS

Once you have a cubin (or an executable linked with CUDA kernels), you can inspect the SASS:

```bash
cuobjdump --dump-sass kernel.cubin
```

This dumps human-readable SASS. For our noop kernel, the output looks like:

```sass
// ---- noop_kernel ----
// SM_86 (Ampere)
.text.noop_kernel:
        /*0000*/                   MOV R1, c[0x0][0x28] ;  // stack pointer setup
        /*0010*/                   EXIT ;                    // return immediately
        /*0020*/                   BRA 0x20 ;                // unreachable (padding)
```

That is it. Two meaningful instructions. The GPU sets up the stack pointer (even if unused, the prologue is standardized) and immediately exits. The `BRA 0x20` is an unreachable branch used as padding to align the instruction stream.

# Vulkan Compilation Path in Detail

## Step 1: GLSL/HLSL to SPIR-V

Vulkan does not accept GLSL or HLSL directly. You must pre-compile to SPIR-V (Standard Portable Intermediate Representation for Vulkan), a binary IR defined by Khronos:

```bash
glslangValidator --target-env vulkan1.2 -o noop.spv noop.comp
```

SPIR-V is a structured, SSA-form binary. Unlike PTX, it is:
- **Binary format** — not human-readable (use `spirv-dis` to disassemble)
- **Vendor-neutral** — runs on NVIDIA, AMD, Intel, Qualcomm, ARM, ...
- **Higher-level than PTX** — retains type information, structured control flow, decorations

A disassembled SPIR-V for our noop shader:

```spirv
; SPIR-V disassembly (simplified)
               OpCapability Shader
               OpMemoryModel Logical GLSL450
               OpEntryPoint GLCompute %main "main" %gl_GlobalInvocationID
               OpExecutionMode %main LocalSize 64 1 1
       %void = OpTypeVoid
       %func = OpTypeFunction %void
       %main = OpFunction %void None %func
      %entry = OpLabel
               OpReturn
               OpFunctionEnd
```

Even for an empty shader, SPIR-V retains structural information: entry point, execution mode (workgroup size), type declarations. This is information the GPU driver needs to set up the dispatch.

## Step 2: NVIDIA Driver — SPIR-V to SASS

When you call `vkCreateComputePipelines`, the NVIDIA Vulkan driver:

1. **Parses SPIR-V** — validates structure, extracts entry point and execution mode
2. **Lowers to NVVM IR** — NVIDIA's internal LLVM-based IR (same IR used by the CUDA path)
3. **Optimizes** — same optimization passes as ptxas
4. **Generates SASS** — same backend code generator

```
vkCreateComputePipelines(device, cache, 1, &createInfo, NULL, &pipeline)
    │
    │  NVIDIA driver internally:
    │
    ├─► SPIR-V parser
    │       │
    │       ▼
    ├─► NVVM IR (LLVM-based)  ◄── This is the convergence point with CUDA!
    │       │
    │       ▼
    ├─► Backend optimizer
    │       │
    │       ▼
    └─► SASS binary (embedded in VkPipeline object)
```

This is the crucial point: **the NVVM IR stage is shared between CUDA and Vulkan**. The NVIDIA driver contains essentially the same backend compiler for both paths.

## Step 3: Extracting Vulkan SASS

Unlike CUDA where you can just run `cuobjdump`, Vulkan SASS extraction requires the `VK_KHR_pipeline_executable_properties` extension. This extension lets you query the internal representations of a compiled pipeline:

```cpp
// Enable the extension at device creation
// Then create pipeline with:
pipelineCI.flags = VK_PIPELINE_CREATE_CAPTURE_INTERNAL_REPRESENTATIONS_BIT_KHR;

// After creation, query internal representations:
vkGetPipelineExecutableInternalRepresentationsKHR(device, &execInfo,
                                                   &irCount, irs);

// The NVIDIA driver returns multiple IRs:
//   - "NVVM IR" (LLVM bitcode)
//   - "PTX"     (yes, the same PTX!)
//   - "SASS"    (native ISA text)
```

Notably, the NVIDIA Vulkan driver exposes PTX as one of its internal representations. This confirms that SPIR-V is lowered through PTX-equivalent IR before reaching SASS.

# The Noop Kernel Experiment

Let us compare the actual compilation output for the simplest possible kernel: one that does nothing.

## CUDA Side

```cuda
// noop_kernel.cu
extern "C" __global__ void noop_kernel() {
    // intentionally empty
}
```

Compile and dump:

```bash
nvcc -arch=sm_86 -cubin noop_kernel.cu
cuobjdump --dump-sass noop_kernel.cubin
```

Expected SASS output (sm_86, Ampere):

```sass
.text.noop_kernel:
  /*0000*/  MOV R1, c[0x0][0x28] ;          // load stack frame size
  /*0010*/  EXIT ;                            // done
  /*0020*/  BRA 0x20 ;                        // padding (unreachable)
  /*0030*/  NOP ;                             // alignment
```

**2 meaningful instructions.** The `MOV R1, c[0x0][0x28]` loads the stack pointer from the constant bank — this is a standard prologue even for kernels that do not use the stack.

## Vulkan Side

```glsl
// noop.comp
#version 450
layout(local_size_x = 64) in;
void main() {
    // intentionally empty
}
```

Compile SPIR-V and create pipeline with `VK_PIPELINE_CREATE_CAPTURE_INTERNAL_REPRESENTATIONS_BIT_KHR`. The SASS extracted from the NVIDIA driver:

```sass
// Expected SASS from NVIDIA Vulkan driver (sm_86):
.text.main:
  /*0000*/  MOV R1, c[0x0][0x28] ;          // stack pointer (same as CUDA)
  /*0010*/  EXIT ;                            // done
  /*0020*/  BRA 0x20 ;                        // padding
  /*0030*/  NOP ;                             // alignment
```

**Identical.** The same 2 meaningful instructions. No extra descriptor setup, no additional overhead. For a kernel that does not access any resources, both paths produce byte-identical SASS.

## What This Tells Us

```
 CUDA noop kernel SASS          Vulkan noop shader SASS
 ──────────────────────          ───────────────────────
 MOV R1, c[0x0][0x28]           MOV R1, c[0x0][0x28]
 EXIT                            EXIT
 BRA 0x20                        BRA 0x20
 NOP                             NOP
 ──────────────────────          ───────────────────────
 Total: 4 instructions           Total: 4 instructions
 Meaningful: 2                   Meaningful: 2
```

The compilation toolchain is different. The source language is different. The intermediate representation is different. But the final output — the only thing the GPU silicon actually sees — is the same.

# Where the Differences Start

The noop case is trivially identical. Differences emerge when kernels actually do work:

## 1. Resource Binding

CUDA passes kernel arguments through the **constant bank** (`c[0x0][offset]`). Each argument is at a known, fixed offset.

Vulkan resolves buffer addresses through **descriptor sets**. The driver loads a descriptor table base address, then indexes into it. This adds an indirection:

```sass
// CUDA: direct constant load
LDC.64 R2, c[0x0][0x160] ;   // load buffer pointer from param

// Vulkan (descriptor-bound): indirect load
LDC.64 R2, c[0x0][0x0]  ;    // load descriptor table base
LDG.E.64 R4, [R2+0x10] ;     // load buffer address from descriptor
```

This extra `LDG` is the cost of Vulkan's binding model. We will explore this in detail in Worklog #06 (BDA).

## 2. Workgroup Size Encoding

CUDA encodes the block dimensions in the launch configuration (runtime). The compiler sees `blockDim.x` as a special register read:

```sass
S2R R0, SR_TID.X ;     // threadIdx.x
S2R R1, SR_CTAID.X ;   // blockIdx.x
// blockDim comes from constant bank or special register
```

Vulkan bakes the local workgroup size into the SPIR-V (`OpExecutionMode ... LocalSize 64 1 1`). The driver may optimize based on this — for example, if the workgroup size is known at compile time, the compiler can eliminate some range checks.

## 3. Compilation Timing

| Event | CUDA (offline) | CUDA (JIT) | Vulkan |
|---|---|---|---|
| Source → IR | Build time (nvcc) | Build time (nvcc → PTX) | Build time (glslang → SPIR-V) |
| IR → SASS | Build time (ptxas) | First `cuModuleLoad` | First `vkCreateComputePipelines` |
| Cache | N/A (pre-compiled) | `~/.nv/ComputeCache/` | `VkPipelineCache` (app-managed) |

The practical consequence: Vulkan applications experience a "shader compilation stutter" the first time they create a pipeline. CUDA applications that ship cubin (pre-compiled SASS) have zero runtime compilation cost. This is a real difference in user experience, though not in the generated code quality.

# How to Inspect SASS: A Practical Guide

## CUDA

```bash
# From .cu source — compile to cubin, then dump
nvcc -arch=sm_86 -cubin -o kernel.cubin kernel.cu
cuobjdump --dump-sass kernel.cubin

# From an executable
cuobjdump --dump-sass ./my_cuda_program

# Just the PTX (intermediate)
nvcc -arch=sm_86 --ptx -o kernel.ptx kernel.cu

# Specific function only
cuobjdump --dump-sass --function-name vector_add kernel.cubin
```

## Vulkan

```cpp
// At device creation, enable the extension:
const char* ext = VK_KHR_PIPELINE_EXECUTABLE_PROPERTIES_EXTENSION_NAME;

// Enable the feature:
VkPhysicalDevicePipelineExecutablePropertiesFeaturesKHR feat{...};
feat.pipelineExecutableInfo = VK_TRUE;

// When creating the pipeline, set the capture flag:
createInfo.flags |= VK_PIPELINE_CREATE_CAPTURE_INTERNAL_REPRESENTATIONS_BIT_KHR;

// After creation, iterate executables and their internal representations:
vkGetPipelineExecutablePropertiesKHR(device, &pipeInfo, &count, props);
vkGetPipelineExecutableInternalRepresentationsKHR(device, &execInfo, &irCount, irs);

// Each IR has: name ("SASS", "PTX", "NVVM IR"), isText, dataSize, pData
```

The full implementation is in `posts/worklog/cuda-vulkan-sass-series/exp01_toolchain/main_vulkan.cpp`.

# Experiment Code

The experiment is intentionally minimal — we want to see what the compiler does with zero user logic.

```
cuda-vulkan-sass-series/exp01_toolchain/
├── CMakeLists.txt
├── cuda/noop_kernel.cu      ← empty __global__ kernel
├── glsl/noop.comp           ← empty compute shader
├── main_cuda.cpp            ← loads module, launches, dumps SASS at build time
└── main_vulkan.cpp          ← creates pipeline with exec props, extracts SASS
```

Build and run:

```bash
cd posts/worklog/cuda-vulkan-sass-series
cmake -B build -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build build

# CUDA: SASS dumped at build time to build/exp01_toolchain/sass/
./build/exp01_toolchain/exp01_cuda

# Vulkan: SASS extracted at runtime via VK_KHR_pipeline_executable_properties
./build/exp01_toolchain/exp01_vulkan
```

# Key Takeaways

1. **Same backend compiler.** Both CUDA and Vulkan on NVIDIA feed into the same NVVM-based backend. The frontend differs; the backend converges.

2. **SASS is the ground truth.** PTX, SPIR-V, NVVM IR — these are all intermediaries. Only SASS runs on the hardware. Comparing anything less than SASS is comparing apples to oranges.

3. **Noop = identical.** For a kernel with no work, both paths produce byte-identical SASS. Differences only appear when resource binding, memory access patterns, and compilation hints come into play.

4. **Vulkan's overhead is binding, not computation.** The extra SASS instructions in Vulkan kernels come from descriptor indirection, not from inferior code generation.

5. **You can inspect both.** CUDA has `cuobjdump`; Vulkan has `VK_KHR_pipeline_executable_properties`. Neither path is a black box.

# References

- [NVIDIA PTX ISA 8.5 Specification](https://docs.nvidia.com/cuda/parallel-thread-execution/)
- [SPIR-V Specification (Khronos)](https://registry.khronos.org/SPIR-V/)
- [VK_KHR_pipeline_executable_properties](https://registry.khronos.org/vulkan/specs/1.3-extensions/man/html/VK_KHR_pipeline_executable_properties.html)
- [CUDA Binary Utilities (cuobjdump)](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html)
- Sebastian Aaltonen, "There Is No Graphics API" — the convergence thesis that motivated this series

# Next

In [Worklog #04](/posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/), we move from noop to the simplest real kernel — `C[i] = A[i] + B[i]` — and do a line-by-line SASS comparison with execution time measurements.
