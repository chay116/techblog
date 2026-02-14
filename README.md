# Blog Research Log

This repository is a research-oriented blog for optimization work, especially around vAI, GPU systems, and compute/render APIs.

## Structure

- `posts/`: publish-ready temporary/final blog entries
  - `worklog/`
  - `comparison/api-language/`
  - `comparison/gpu-architecture/`
- `worklog/`: date-based experiment logs (WIP-friendly)
- `comparisons/`: stable comparison notes (concept and performance oriented)
  - `gpu-architecture/`: architecture-level comparisons (e.g., NVIDIA vs AMD generations)
  - `api-language/`: Vulkan/CUDA/HIP/GLSL model comparisons
  - `runtime-framework/`: runtime and framework behavior comparisons
  - `tooling/`: profiler/debugger workflow comparisons
- `notes/`: raw notes and idea capture
- `assets/`: images, charts, benchmark captures
- `templates/`: writing templates
- `docs/`: process docs and indexes

## Writing Flow

1. Capture ideas in `notes/`.
2. Promote validated experiments to `worklog/` entries.
3. Merge stable findings into `comparisons/` pages.
4. Keep indexes current in `docs/`.

## Naming Conventions

- Worklog: `worklog-YYYY-MM-DD-<topic>.md`
- Comparison: `comparison-<domain>-<topic>.md`
- Notes: `note-YYYY-MM-DD-<topic>.md`

## Frontmatter Baseline

Use this baseline at the top of each publish-ready document:

```yaml
---
title: ""
date: "YYYY-MM-DD"
status: "wip" # wip | stable
project: "vAI"
tags: ["gpu", "optimization"]
---
```

## Weekly Maintenance

Run the checklist in `docs/weekly-review-checklist.md` once per week.

## Browse Posts

- Main index: `docs/post-index.md`
- Post template: `docs/post-template.md`

## Comparison Document Policy

Every file under `comparisons/` must include:

1. `# Code to Inspect` with repository path(s), commit/branch, and key symbols.
2. `# Reference Materials` with direct links to specs/docs/articles.
3. `# Evidence Mapping` connecting claims to code paths and references.
