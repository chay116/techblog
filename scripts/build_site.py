#!/usr/bin/env python3
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "posts"
SITE_DIR = ROOT / "site"
UNREAL_SUMMARY_DIR = POSTS_DIR / "unreal-summary"
CONTENT_DIR = SITE_DIR / "content"
SERIES_ORDER = ["compiler", "gpu", "other"]
SERIES_ALIASES = {
    "compiler-series": "compiler",
    "compilers": "compiler",
    "gpu-series": "gpu",
    "graphics": "gpu",
    "general": "other",
    "misc": "other",
}
SERIES_BY_TRACK = {
    "gpu-architecture": "gpu",
    "api-language": "gpu",
    "runtime-framework": "gpu",
}
COMPILER_TAG_HINTS = {"compiler", "ssa", "llvm", "ir", "optimization"}
GPU_TAG_HINTS = {"gpu", "cuda", "vulkan", "glsl", "sass", "shader", "nvidia", "amd"}


def env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    val = raw.strip().lower()
    if val in {"1", "true", "yes", "on"}:
        return True
    if val in {"0", "false", "no", "off"}:
        return False
    return default


UNREAL_PUBLIC_ENABLED = env_flag("UNREAL_PUBLIC_ENABLED", default=False)


def parse_frontmatter(text: str):
    if not text.startswith("---\n"):
        return {}, text

    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return {}, text

    header, body = parts
    lines = header.splitlines()[1:]

    data = {}
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        elif value.startswith("[") and value.endswith("]"):
            items = [x.strip().strip('"').strip("'") for x in value[1:-1].split(",") if x.strip()]
            value = items
        data[key] = value

    return data, body


def extract_summary(body: str):
    lines = [ln.rstrip("\n") for ln in body.splitlines()]
    in_code_block = False
    for raw in lines:
        ln = raw.strip()
        if not ln:
            continue

        if ln.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        # Skip headings, tables, block quotes, and horizontal rules.
        if ln.startswith("#"):
            continue
        if ln.startswith("|"):
            continue
        if ln.startswith(">"):
            continue
        if ln in ("---", "***", "___"):
            continue

        return ln
    return ""


def normalize_series(value):
    if not isinstance(value, str):
        return None
    slug = value.strip().lower().replace(" ", "-")
    if slug in SERIES_ALIASES:
        slug = SERIES_ALIASES[slug]
    if slug in SERIES_ORDER:
        return slug
    return None


def infer_series(frontmatter, tags):
    explicit = normalize_series(frontmatter.get("series"))
    if explicit:
        return explicit

    lowered_tags = {str(tag).strip().lower() for tag in tags}
    if lowered_tags & COMPILER_TAG_HINTS:
        return "compiler"
    if lowered_tags & GPU_TAG_HINTS:
        return "gpu"

    track = str(frontmatter.get("track", "")).strip().lower()
    if track in SERIES_BY_TRACK:
        return SERIES_BY_TRACK[track]
    return "other"


def collect_posts():
    posts = []
    if not POSTS_DIR.exists():
        return posts
    for path in sorted(POSTS_DIR.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(text)
        rel = path.relative_to(ROOT).as_posix()

        if path.is_relative_to(UNREAL_SUMMARY_DIR):
            if not UNREAL_PUBLIC_ENABLED:
                continue
            # unreal-summary accepts any .md filename (not just en.md/ko.md).
            # All metadata comes from frontmatter injected by inject_frontmatter.py.
            if not frontmatter:
                continue  # skip files without frontmatter

            tags = frontmatter.get("tags", [])
            if isinstance(tags, str):
                tags = [tags]

            post = {
                "title": frontmatter.get("title", path.stem),
                "date": frontmatter.get("date", ""),
                "status": frontmatter.get("status", "stable"),
                "project": frontmatter.get("project", "UnrealEngine"),
                "lang": frontmatter.get("lang", "ko"),
                "category": frontmatter.get("category", "unreal-summary"),
                "track": frontmatter.get("track", "Meta"),
                "series": infer_series(frontmatter, tags),
                "tags": tags,
                "path": rel,
                "summary": extract_summary(body),
            }
            posts.append(post)
            continue

        # Default blog posts: only include per-post en.md/ko.md files.
        if path.name not in ("en.md", "ko.md"):
            continue

        tags = frontmatter.get("tags", [])
        if isinstance(tags, str):
            tags = [tags]
        post = {
            "title": frontmatter.get("title", path.parent.name),
            "date": frontmatter.get("date", ""),
            "status": frontmatter.get("status", "wip"),
            "project": frontmatter.get("project", ""),
            "lang": frontmatter.get("lang", "en"),
            "category": frontmatter.get("category", "other"),
            "track": frontmatter.get("track", "other"),
            "series": infer_series(frontmatter, tags),
            "tags": tags,
            "path": rel,
            "summary": extract_summary(body),
        }
        posts.append(post)

    posts.sort(key=lambda x: (x["date"], x["title"]), reverse=True)
    return posts


def build_tags(posts):
    out = {}
    for p in posts:
        for t in p.get("tags", []):
            out[t] = out.get(t, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def build_series(posts):
    present = {p.get("series", "other") for p in posts}
    ordered = [series for series in SERIES_ORDER if series in present]
    extras = sorted(series for series in present if series not in SERIES_ORDER)
    return ordered + extras


def materialize_content(posts):
    # Copy publishable markdown into site/ so local preview doesn't depend on GitHub raw URLs.
    if CONTENT_DIR.exists():
        shutil.rmtree(CONTENT_DIR)
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)

    copied = 0
    missing = 0
    for p in posts:
        rel = Path(p["path"])
        src = ROOT / rel
        dst = CONTENT_DIR / rel
        if not src.exists():
            missing += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    if missing:
        print(f"Materialized content: {copied} copied, {missing} missing")
    else:
        print(f"Materialized content: {copied} copied")


def main():
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    posts = collect_posts()
    payload = {
        "posts": posts,
        "languages": sorted({p["lang"] for p in posts}),
        "categories": sorted({p["category"] for p in posts}),
        "tracks": sorted({p["track"] for p in posts}),
        "series": build_series(posts),
        "tags": build_tags(posts),
    }
    (SITE_DIR / "posts.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    materialize_content(posts)
    print(f"Built site data with {len(posts)} posts")


if __name__ == "__main__":
    main()
