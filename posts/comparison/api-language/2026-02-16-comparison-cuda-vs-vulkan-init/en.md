---
title: "Comparison - CUDA vs Vulkan Initialization"
date: "2026-02-16"
status: "wip"
project: "vAI"
lang: "en"
category: "comparison"
track: "api-language"
tags: ["cuda", "vulkan", "initialization", "nvidia"]
---

# Scope

Initialization complexity and first execution behavior on NVIDIA GPU.

# Quick Comparison

| Axis | CUDA | Vulkan | vAI note |
|---|---|---|---|
| Setup verbosity | lower | higher | Vulkan has explicit object lifecycle overhead |
| Resource control | medium | high | Vulkan can express ownership transitions precisely |
| First-call behavior | lazy init effects | pipeline/build effects | both require warm-up-aware benchmarking |

# Code to Inspect

- `src/compute/cuda/`
- `src/compute/vulkan/`
- `benchmarks/`

# Reference Materials

- Vulkan 1.3 spec: https://registry.khronos.org/vulkan/specs/1.3-extensions/html/
- CUDA C++ Programming Guide: https://docs.nvidia.com/cuda/cuda-c-programming-guide/
- CUDA Runtime API: https://docs.nvidia.com/cuda/cuda-runtime-api/

# Evidence Mapping

| Claim | Code path | Reference |
|---|---|---|
| CUDA init path is shorter in host code | `src/compute/cuda/` | CUDA Runtime API |
| Vulkan sync/resource control is more explicit | `src/compute/vulkan/` | Vulkan 1.3 spec |
