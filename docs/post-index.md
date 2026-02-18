# Post Index

This page is the single entry point for finding posts by category, track, and tags.

## All Posts

| Date | Title | Category | Track | Status | Directory |
|---|---|---|---|---|---|
| 2026-02-14 | Worklog #01 - CUDA vs Vulkan Initialization on NVIDIA | worklog | api-language | wip | `posts/worklog/2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/` |
| 2026-02-15 | Worklog #02 - Vulkan Barrier Audit for Compute | worklog | api-language | wip | `posts/worklog/2026-02-15-worklog-02-vulkan-barrier-audit/` |
| 2026-02-16 | Comparison - CUDA vs Vulkan Initialization | comparison | api-language | wip | `posts/comparison/api-language/2026-02-16-comparison-cuda-vs-vulkan-init/` |
| 2026-02-17 | Comparison - NVIDIA Ampere vs Ada (Template) | comparison | gpu-architecture | wip | `posts/comparison/gpu-architecture/2026-02-17-comparison-nvidia-ampere-vs-ada-template/` |
| 2026-02-18 | Worklog #03 - CUDA vs Vulkan: Compilation Toolchain Anatomy | worklog | api-language | wip | `posts/worklog/2026-02-18-worklog-03-cuda-vulkan-sass-toolchain/` |
| 2026-02-19 | Worklog #04 - Hello SASS: Vector Add | worklog | api-language | wip | `posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/` |
| 2026-02-20 | Worklog #05 - Memory Coalescing at SASS Level | worklog | api-language | wip | `posts/worklog/2026-02-20-worklog-05-cuda-vulkan-sass-memory-coalescing/` |
| 2026-02-21 | Worklog #06 - Bindless, BDA, Raw Pointers | worklog | api-language | wip | `posts/worklog/2026-02-21-worklog-06-cuda-vulkan-sass-bindless-bda/` |
| 2026-02-22 | Worklog #07 - JIT Cache vs Pipeline Cache | worklog | api-language | wip | `posts/worklog/2026-02-22-worklog-07-cuda-vulkan-sass-jit-pipeline-cache/` |

## Find by Category

### Worklog

- `posts/worklog/2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/`
- `posts/worklog/2026-02-15-worklog-02-vulkan-barrier-audit/`
- `posts/worklog/2026-02-18-worklog-03-cuda-vulkan-sass-toolchain/`
- `posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/`
- `posts/worklog/2026-02-20-worklog-05-cuda-vulkan-sass-memory-coalescing/`
- `posts/worklog/2026-02-21-worklog-06-cuda-vulkan-sass-bindless-bda/`
- `posts/worklog/2026-02-22-worklog-07-cuda-vulkan-sass-jit-pipeline-cache/`

### Comparison

- `posts/comparison/api-language/2026-02-16-comparison-cuda-vs-vulkan-init/`
- `posts/comparison/gpu-architecture/2026-02-17-comparison-nvidia-ampere-vs-ada-template/`

## Find by Track

### api-language

- `posts/worklog/2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/`
- `posts/worklog/2026-02-15-worklog-02-vulkan-barrier-audit/`
- `posts/comparison/api-language/2026-02-16-comparison-cuda-vs-vulkan-init/`
- `posts/worklog/2026-02-18-worklog-03-cuda-vulkan-sass-toolchain/`
- `posts/worklog/2026-02-19-worklog-04-cuda-vulkan-sass-vector-add/`
- `posts/worklog/2026-02-20-worklog-05-cuda-vulkan-sass-memory-coalescing/`
- `posts/worklog/2026-02-21-worklog-06-cuda-vulkan-sass-bindless-bda/`
- `posts/worklog/2026-02-22-worklog-07-cuda-vulkan-sass-jit-pipeline-cache/`

### gpu-architecture

- `posts/comparison/gpu-architecture/2026-02-17-comparison-nvidia-ampere-vs-ada-template/`

## Find by Tag

- `cuda`: 7 posts
- `vulkan`: 8 posts
- `nvidia`: 8 posts
- `sass`: 5 posts
- `gpu-architecture`: 1 post
- `barrier`: 1 post
- `initialization`: 2 posts
- `toolchain`: 1 post
- `vector-add`: 1 post
- `memory-coalescing`: 1 post
- `bda`: 1 post
- `bindless`: 1 post
- `jit`: 1 post
- `pipeline-cache`: 1 post

## Quick CLI Search

```bash
# category
rg -n 'category: "worklog"' posts/ -g 'en.md'

# track
rg -n 'track: "api-language"' posts/ -g 'en.md'

# tag keyword
rg -n 'cuda|vulkan|hip|glsl' posts/ -g '*.md'
```
