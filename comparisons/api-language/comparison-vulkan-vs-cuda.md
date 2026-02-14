---
title: "Comparison - Vulkan vs CUDA"
date: "2026-02-14"
status: "wip"
project: "vAI"
tags: ["comparison", "vulkan", "cuda", "gpu"]
---

# Scope

- Comparison target: Vulkan compute vs CUDA
- Workload domain: vAI optimization path
- Decision context: portability vs peak optimization velocity

# Mental Model Mapping

| Axis | Vulkan Compute | CUDA | Notes for vAI |
|---|---|---|---|
| Execution model | dispatch + workgroup | kernel + grid/block |  |
| Memory model | buffers/images + explicit memory barriers | global/shared/local abstractions |  |
| Synchronization | pipeline barriers + scopes | sync primitives + stream/event model |  |
| Tooling | RenderDoc + validation + vendor tools | Nsight Compute/Systems |  |

# Early Observations

- Vulkan gives strong explicit control and portability.
- CUDA usually offers faster iteration for NVIDIA-specific tuning.
- Performance outcomes depend on occupancy and memory traffic patterns, not API label alone.

# Code to Inspect

- Repo: `vAI` (fill repository URL/path)
- Branch/Commit: (pin exact benchmark commit for reproducibility)
- Paths:
  - `src/compute/vulkan/`
  - `src/compute/cuda/`
  - `benchmarks/`
- Key symbols:
  - `vkCreateInstance`
  - `vkCreateDevice`
  - `vkCmdDispatch`
  - `cudaSetDevice`
  - `cudaMalloc`
  - kernel launch sites

# Reference Materials

| Type | Title | Link | Why it matters |
|---|---|---|---|
| spec | Vulkan 1.3 Specification | https://registry.khronos.org/vulkan/specs/1.3-extensions/html/ | Source of truth for barriers, memory model, and dispatch semantics |
| guide | Vulkan Guide | https://docs.vulkan.org/guide/latest/ | Practical guidance for correct and efficient Vulkan usage |
| doc | NVIDIA CUDA C++ Programming Guide | https://docs.nvidia.com/cuda/cuda-c-programming-guide/ | CUDA execution/memory model and kernel behavior |
| doc | NVIDIA CUDA Runtime API | https://docs.nvidia.com/cuda/cuda-runtime-api/ | Runtime initialization, streams, memory APIs |
| tooling | Nsight Compute Docs | https://docs.nvidia.com/nsight-compute/ | Kernel-level profiling and occupancy diagnostics |
| tooling | RenderDoc Docs | https://renderdoc.org/docs/ | Capture and inspect Vulkan dispatch behavior |

# Evidence Mapping

| Claim | Backing code path | Reference |
|---|---|---|
| Vulkan has more explicit sync control | `src/compute/vulkan/` barrier helpers | Vulkan 1.3 Specification |
| CUDA iteration is faster on NVIDIA | `src/compute/cuda/` benchmark harness | CUDA Runtime API |
| Bottleneck is memory traffic, not API name | `benchmarks/` plus profiler captures | Nsight Compute Docs |

# Open Questions

1. Where does explicit Vulkan control outperform CUDA convenience in vAI kernels?
2. Which bottlenecks are architecture-driven vs API-driven?
