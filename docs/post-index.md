# Post Index

This page is the single entry point for finding posts by category, track, and tags.

## All Posts

| Date | Title | Category | Track | Status | Directory |
|---|---|---|---|---|---|
| 2026-02-14 | Worklog #01 - CUDA vs Vulkan Initialization on NVIDIA | worklog | api-language | wip | `posts/worklog/2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/` |
| 2026-02-15 | Worklog #02 - Vulkan Barrier Audit for Compute | worklog | api-language | wip | `posts/worklog/2026-02-15-worklog-02-vulkan-barrier-audit/` |
| 2026-02-16 | Comparison - CUDA vs Vulkan Initialization | comparison | api-language | wip | `posts/comparison/api-language/2026-02-16-comparison-cuda-vs-vulkan-init/` |
| 2026-02-17 | Comparison - NVIDIA Ampere vs Ada (Template) | comparison | gpu-architecture | wip | `posts/comparison/gpu-architecture/2026-02-17-comparison-nvidia-ampere-vs-ada-template/` |

## Find by Category

### Worklog

- `posts/worklog/2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/`
- `posts/worklog/2026-02-15-worklog-02-vulkan-barrier-audit/`

### Comparison

- `posts/comparison/api-language/2026-02-16-comparison-cuda-vs-vulkan-init/`
- `posts/comparison/gpu-architecture/2026-02-17-comparison-nvidia-ampere-vs-ada-template/`

## Find by Track

### api-language

- `posts/worklog/2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/`
- `posts/worklog/2026-02-15-worklog-02-vulkan-barrier-audit/`
- `posts/comparison/api-language/2026-02-16-comparison-cuda-vs-vulkan-init/`

### gpu-architecture

- `posts/comparison/gpu-architecture/2026-02-17-comparison-nvidia-ampere-vs-ada-template/`

## Find by Tag

- `cuda`: 2 posts
- `vulkan`: 3 posts
- `nvidia`: 3 posts
- `gpu-architecture`: 1 post
- `barrier`: 1 post
- `initialization`: 2 posts

## Quick CLI Search

```bash
# category
rg -n 'category: "worklog"' posts/ -g 'en.md'

# track
rg -n 'track: "api-language"' posts/ -g 'en.md'

# tag keyword
rg -n 'cuda|vulkan|hip|glsl' posts/ -g '*.md'
```
