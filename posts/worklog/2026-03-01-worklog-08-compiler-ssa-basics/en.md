---
title: "Worklog #08 - SSA Basics in Compiler IR"
date: "2026-03-01"
status: "wip"
project: "vAI"
lang: "en"
category: "worklog"
track: "tooling"
tags: ["compiler", "ssa", "llvm", "ir", "optimization"]
---

SSA (Static Single Assignment) is one of the first concepts to understand when reading compiler IR.
Its core rule is simple.

1. A variable is assigned exactly once.
2. Every use appears after its definition.

The rule is simple, but it makes optimization much easier because value origins become explicit.

# Reassignment vs SSA

Regular code reassigns the same name many times.

```text
y = 1
y = 2
x = y
```

In SSA form, names are split.

```text
y1 = 1
y2 = 2
x1 = y2
```

For the compiler, it is now immediately clear which value `x1` uses.

# Branch Merge and Phi

At control-flow merge points, phi is required.

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

`phi(a, b)` means: select a value based on the incoming control-flow edge.

# Why Optimizations Get Easier

SSA simplifies many passes:

- Constant Propagation
- Dead Code Elimination (DCE)
- Global Value Numbering (GVN)
- Loop-Invariant Code Motion (LICM)

All for the same reason: use-def chains are clear.

# LLVM Perspective

LLVM IR is SSA-based. Early memory-oriented patterns (`alloca/load/store`) are promoted into SSA registers by passes such as `mem2reg`.
So SSA is not just theory; it is the center of real optimization pipelines.

# Link to GPU/Low-Level Analysis

SSA is also useful when analyzing GPU-oriented codegen:

- how branch-merge values propagate
- how value lifetimes affect register pressure
- how IR-level transforms influence final ISA (for example SASS)

Understanding SSA gives a cleaner path from source code to machine code.

# Note

Baseline reference note: https://lifeisforu.tistory.com/507

# Reference Materials

- https://en.wikipedia.org/wiki/Static_single-assignment_form
- https://llvm.org/docs/LangRef.html
- https://llvm.org/docs/Passes.html
