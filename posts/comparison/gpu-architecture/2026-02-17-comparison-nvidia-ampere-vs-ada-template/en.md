---
title: "Comparison - NVIDIA Ampere vs Ada (Template)"
date: "2026-02-17"
status: "wip"
project: "vAI"
lang: "en"
category: "comparison"
track: "gpu-architecture"
series: "gpu-lab"
tags: ["nvidia", "gpu-architecture", "ampere", "ada"]
---
# 1. Executive Summary

- Core claim: Architecture-level differences that may affect vAI kernels.
- Primary metric: `kernel time (ms) or throughput (ops/s)`
- Baseline -> current: `TBD -> TBD` (delta `TBD%`)
- Evidence status: `in progress (wip)`; attach profiler/IR/benchmark logs before marking stable.

# 2. Problem and Scope

- Problem statement: this post documents a concrete issue and the reasoning path used to analyze it.
- In scope: the key mechanism, evidence path, and practical implications.
- Out of scope: exhaustive architecture-wide benchmarking unless explicitly included below.

# 3. Method and Setup

- Category/Track/Series: `comparison` / `gpu-architecture` / `gpu`
- Validation approach: tie claims to code, metrics, and profiler or compiler evidence where available.
- Reproducibility target: make each major claim testable with explicit setup and follow-up actions.

# 4. Detailed Notes

# Scope

Architecture-level differences that may affect vAI kernels.

# Comparison Axes

| Axis | Ampere | Ada | vAI impact |
|---|---|---|---|
| SM behavior | TBD | TBD | TBD |
| Cache hierarchy | TBD | TBD | TBD |
| Tensor path | TBD | TBD | TBD |
| Memory behavior | TBD | TBD | TBD |

# Code to Inspect

- `benchmarks/`
- architecture-specific kernel configs

# Reference Materials

- NVIDIA architecture whitepapers
- Nsight Compute metric reference

# Evidence Mapping

| Claim | Code path | Reference |
|---|---|---|
| TBD | TBD | TBD |

# 5. Decision and Next Actions

- Decision: keep this post as `wip` until all major claims are backed by explicit measurable evidence.

1. Convert the key claims above into a compact metric or evidence table.
2. Add at least one reproducible command sequence (build/run/profile).
3. Add one explicit follow-up experiment with pass/fail criteria.

# 6. Diagram (Optional)

```plantuml
@startuml
title Analysis flow
Problem --> Method
Method --> Evidence
Evidence --> Decision
@enduml
```
