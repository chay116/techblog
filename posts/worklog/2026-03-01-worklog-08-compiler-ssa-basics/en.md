---
title: "Worklog #08 - SSA Basics in Compiler IR"
date: "2026-03-01"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "tooling"
series: "compiler"
tags: ["compiler", "ssa", "llvm", "ir", "optimization"]
---

# 1. Executive Summary

- Core claim: SSA is the minimum abstraction required to reason about compiler optimization behavior with confidence.
- Main number: benchmark not included yet in this post (concept foundation only).
- Confidence: high for semantics, medium for downstream performance implication until measured on real workloads.
- Caveat: this post focuses on IR semantics, not a full pass-by-pass performance study.

# 2. Problem Statement

When reading optimization output, many analyses fail because value identity is ambiguous after repeated reassignments.
Without a strict value model, it is hard to answer:

- Which exact definition feeds this use?
- Where does control-flow merge change data flow?
- Why did a pass remove, fold, or move a computation?

For vAI, this matters because we need deterministic reasoning from source-level transformations to final machine code behavior.

# 3. Hypothesis

- Primary hypothesis: if we rewrite the mental model in SSA terms, optimization outcomes become mechanically explainable.
- Secondary hypothesis: SSA-level understanding improves low-level debugging quality (IR -> ISA) for GPU-oriented workloads.
- Rationale: explicit def-use chains and phi-based merges reduce ambiguity in both correctness and optimization reasoning.

# 4. Environment and Reproducibility

| Item | Value |
|---|---|
| Compiler ecosystem | LLVM/Clang model |
| Target representation | LLVM IR (SSA-based) |
| Scope | semantics and analysis workflow |
| Measurement | qualitative proof + IR inspection commands |

# 5. Baseline

## 5.1 Reassignment model (non-SSA mental model)

```text
y = 1
y = 2
x = y
```

In this representation, the symbol `y` is overloaded over time, so data provenance must be inferred from sequence context.

## 5.2 SSA representation

```text
y1 = 1
y2 = 2
x1 = y2
```

Here, provenance is explicit: `x1` depends on `y2`, not `y1`.

# 6. Change Introduced

This post introduces one strict rule set:

1. each variable version is defined exactly once;
2. every use is dominated by its definition;
3. control-flow merges use `phi` nodes.

Branch merge example:

```c
if (cond) {
  y = 10;
} else {
  y = 20;
}
x = y + 1;
```

SSA-like form:

```text
if (cond) {
  y1 = 10
} else {
  y2 = 20
}
y3 = phi(y1, y2)
x1 = y3 + 1
```

# 7. Experiment Matrix (Concept Validation)

| Case ID | Question | Expected signal |
|---|---|---|
| A | Can each use map to one unique definition? | yes |
| B | Can branch merge dependencies be represented without ambiguity? | yes (`phi`) |
| C | Can classic optimization preconditions be checked locally on def-use graph? | yes |

# 8. Results

| Metric | Baseline | Current | Delta | Delta % |
|---|---:|---:|---:|---:|
| Definition provenance ambiguity | high | low | qualitative improvement | n/a |
| Merge-point clarity | low | high | qualitative improvement | n/a |
| Optimization precondition readability | medium | high | qualitative improvement | n/a |

# 9. Evidence

## 9.1 Optimization Pass Affinity

SSA directly supports reasoning for:

- Constant Propagation
- Dead Code Elimination (DCE)
- Global Value Numbering (GVN)
- Loop-Invariant Code Motion (LICM)

Shared reason: explicit def-use graph with reduced alias-like ambiguity at the value level.

## 9.2 LLVM Perspective

LLVM IR is SSA-based. Memory-shaped forms (`alloca/load/store`) are promoted toward register SSA by passes like `mem2reg`.
This is why understanding SSA is not optional when reading LLVM optimization behavior.

## 9.3 Link to GPU/ISA Analysis

SSA literacy is useful when debugging GPU code generation:

- branch merge values and predication interactions
- value lifetime pressure that maps to register pressure
- IR transform effects that later appear in ISA (for example SASS)

# 10. Analysis

The biggest gain is not speed by itself; it is interpretability.
Once data flow is explicit, pass outcomes become explainable and regressions are easier to isolate.

Main limitation of this post: no quantitative benchmark yet. Performance claims must be validated in a follow-up with actual kernels.

# 11. Decision

- Adopt: yes.
- Scope: use SSA-first explanation style for compiler-oriented worklogs from now on.
- Fallback: if source-level explanation is unclear, inspect emitted LLVM IR and rebuild reasoning from def-use chain.

# 12. Next Actions

1. Build a tiny `alloca/load/store` example and show concrete `mem2reg` before/after IR.
2. Connect one SSA-level transform to measurable ISA-level change in a GPU case study.
3. Add one regression checklist item: each optimization claim must identify the relevant def-use chain.

# 13. Code to Inspect

- Repo: this blog repository
- Branch/Commit: `main` / current head
- Paths:
  - `posts/worklog/2026-03-01-worklog-08-compiler-ssa-basics/`
- Key symbols:
  - `phi`
  - `mem2reg`
  - def-use chain

# 14. Reference Materials

| Type | Title | Link | Why it matters |
|---|---|---|---|
| note | SSA overview note | https://lifeisforu.tistory.com/507 | baseline Korean summary used as seed |
| doc | LLVM Language Reference Manual | https://llvm.org/docs/LangRef.html | authoritative IR semantics |
| doc | LLVM Passes Reference | https://llvm.org/docs/Passes.html | pass-level mapping to SSA usage |
| article | Static single-assignment form | https://en.wikipedia.org/wiki/Static_single-assignment_form | quick concept refresher |

# 15. Diagram (Optional)

```plantuml
@startuml
title SSA reasoning path
Source code --> IR
IR --> SSA def-use graph
SSA def-use graph --> Optimization pass
Optimization pass --> Lowered ISA
@enduml
```

# 16. Appendix

## 16.1 Minimal Inspection Commands

```bash
# Emit LLVM IR
clang -S -emit-llvm sample.c -o sample.ll

# Run mem2reg
opt -passes=mem2reg sample.ll -S -o sample.mem2reg.ll
```
