---
title: "Comparison - CUDA vs HIP vs GLSL"
date: "2026-02-14"
status: "wip"
project: "vAI"
tags: ["comparison", "cuda", "hip", "glsl", "gpu"]
---

# Scope

- Comparison target: CUDA vs HIP vs GLSL compute workflows
- Workload domain: vAI optimization and portability
- Decision context: vendor lock-in, ecosystem maturity, and maintenance cost

# Mental Model Mapping

| Axis | CUDA | HIP | GLSL Compute | Notes for vAI |
|---|---|---|---|---|
| Vendor reach | NVIDIA | AMD + some portability path | Broad via Vulkan/OpenGL stacks |  |
| Low-level tuning depth | High | Medium-high | Medium |  |
| Tooling maturity | Very strong | improving | mixed |  |
| Portability overhead | Higher lock-in risk | moderate | broad API portability |  |

# Initial Position

- CUDA-first can maximize short-term NVIDIA performance.
- HIP path can reduce long-term vendor concentration risk.
- GLSL/Vulkan compute can align with graphics pipeline integration requirements.

# Code to Inspect

- Repo: `vAI` (fill repository URL/path)
- Branch/Commit: (pin exact commit used for cross-platform runs)
- Paths:
  - `src/compute/cuda/`
  - `src/compute/hip/`
  - `src/compute/glsl/`
  - `benchmarks/`
- Key symbols:
  - CUDA kernel launch and stream APIs
  - HIP kernel launch and memory APIs
  - GLSL compute shader entry points and dispatch sites

# Reference Materials

| Type | Title | Link | Why it matters |
|---|---|---|---|
| doc | NVIDIA CUDA C++ Programming Guide | https://docs.nvidia.com/cuda/cuda-c-programming-guide/ | CUDA execution and optimization model |
| doc | AMD ROCm HIP Documentation | https://rocmdocs.amd.com/projects/HIP/en/latest/ | HIP portability model and API behavior |
| spec | OpenGL Shading Language Spec | https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.4.60.pdf | GLSL language semantics reference |
| spec | Vulkan 1.3 Specification | https://registry.khronos.org/vulkan/specs/1.3-extensions/html/ | Compute dispatch and synchronization rules for Vulkan GLSL/SPIR-V paths |
| tooling | Nsight Compute Docs | https://docs.nvidia.com/nsight-compute/ | NVIDIA performance verification baseline |

# Evidence Mapping

| Claim | Backing code path | Reference |
|---|---|---|
| CUDA provides strongest NVIDIA-first tuning path | `src/compute/cuda/` | CUDA C++ Programming Guide |
| HIP reduces vendor lock-in for kernel code | `src/compute/hip/` | ROCm HIP Documentation |
| GLSL path aligns with graphics pipeline integration | `src/compute/glsl/` | Vulkan 1.3 Specification |

# Open Questions

1. Which kernels justify CUDA-only optimization?
2. Which modules should stay in portable compute paths?
