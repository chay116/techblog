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
SERIES_ORDER = ["compiler", "gpu", "gpu-lab", "other"]
SERIES_ALIASES = {
    "compiler-series": "compiler",
    "compilers": "compiler",
    "gpu-series": "gpu",
    "gpu-lab-series": "gpu-lab",
    "gpu-notes": "gpu-lab",
    "gpu-archive": "gpu-lab",
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
SERIES_BOOK_TITLES = {
    "compiler": "Compiler Series",
    "gpu": "GPU Series",
    "gpu-lab": "GPU Lab",
    "other": "General Series",
}


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


UNREAL_PUBLIC_ENABLED = env_flag("UNREAL_PUBLIC_ENABLED", default=True)


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


def parse_int(value):
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def normalize_book(value, series):
    if isinstance(value, str) and value.strip():
        return value.strip()
    return SERIES_BOOK_TITLES.get(series, "General Series")


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


def normalize_unreal_metadata(path: Path, title: str, tags, summary: str):
    tags = list(tags or [])

    # Keep RayTracing/PathTracing naming consistent in the public viewer.
    if path.name == "PathTracing.md":
        title = "Path Tracing Deep Dive"
        if "PathTracing" not in tags:
            tags.append("PathTracing")
        if not summary or summary.startswith("**Hardware Ray Tracing**"):
            summary = (
                "Path tracing in Unreal Engine is best treated as a "
                "reference-quality renderer for ground-truth lighting and lookdev validation."
            )

    return title, tags, summary


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
            series = infer_series(frontmatter, tags)
            order = parse_int(frontmatter.get("order"))
            track = frontmatter.get("track", "Meta")
            title = frontmatter.get("title", path.stem)
            summary = extract_summary(body)
            title, tags, summary = normalize_unreal_metadata(path, title, tags, summary)

            post = {
                "title": title,
                "date": frontmatter.get("date", ""),
                "status": frontmatter.get("status", "stable"),
                "project": frontmatter.get("project", "UnrealEngine"),
                "lang": frontmatter.get("lang", "ko"),
                "category": frontmatter.get("category", "unreal-summary"),
                "track": track,
                "series": series,
                "book": normalize_book(frontmatter.get("book"), series),
                "part": str(frontmatter.get("part", track)).strip() or "General",
                "chapter": str(frontmatter.get("chapter", title)).strip() or title,
                "order": order,
                "tags": tags,
                "path": rel,
                "summary": summary,
            }
            posts.append(post)
            continue

        # Default blog posts: only include per-post en.md/ko.md files.
        if path.name not in ("en.md", "ko.md"):
            continue

        tags = frontmatter.get("tags", [])
        if isinstance(tags, str):
            tags = [tags]
        series = infer_series(frontmatter, tags)
        order = parse_int(frontmatter.get("order"))
        track = frontmatter.get("track", "other")
        title = frontmatter.get("title", path.parent.name)
        post = {
            "title": title,
            "date": frontmatter.get("date", ""),
            "status": frontmatter.get("status", "wip"),
            "project": frontmatter.get("project", ""),
            "lang": frontmatter.get("lang", "en"),
            "category": frontmatter.get("category", "other"),
            "track": track,
            "series": series,
            "book": normalize_book(frontmatter.get("book"), series),
            "part": str(frontmatter.get("part", track)).strip() or "General",
            "chapter": str(frontmatter.get("chapter", title)).strip() or title,
            "order": order,
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


def chapter_sort_key(post):
    order = post.get("order")
    date = str(post.get("date", ""))
    title = str(post.get("title", ""))
    path = str(post.get("path", ""))
    if order is not None:
        return (0, order, date, title, path)
    return (1, date, title, path)


def build_series_toc(posts):
    series_toc = {}
    series_list = build_series(posts)

    for series in series_list:
        series_posts = [
            p
            for p in posts
            if p.get("series") == series and p.get("category") != "unreal-summary"
        ]
        if not series_posts:
            continue

        by_lang = {}
        langs = sorted({p.get("lang", "en") for p in series_posts})
        for lang in langs:
            lang_posts = [p for p in series_posts if p.get("lang", "en") == lang]
            lang_posts.sort(key=chapter_sort_key)

            entries = []
            total = len(lang_posts)
            for idx, post in enumerate(lang_posts):
                prev_path = lang_posts[idx - 1]["path"] if idx > 0 else None
                next_path = lang_posts[idx + 1]["path"] if idx + 1 < total else None
                entries.append(
                    {
                        "index": idx + 1,
                        "total": total,
                        "path": post["path"],
                        "title": post.get("title", ""),
                        "date": post.get("date", ""),
                        "lang": post.get("lang", "en"),
                        "category": post.get("category", "other"),
                        "track": post.get("track", "other"),
                        "status": post.get("status", "wip"),
                        "book": post.get("book", SERIES_BOOK_TITLES.get(series, "General Series")),
                        "part": post.get("part", "General"),
                        "chapter": post.get("chapter", post.get("title", "")),
                        "order": post.get("order"),
                        "prev_path": prev_path,
                        "next_path": next_path,
                    }
                )

            by_lang[lang] = entries

        series_toc[series] = by_lang

    return series_toc


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
        "series_toc": build_series_toc(posts),
        "tags": build_tags(posts),
    }
    (SITE_DIR / "posts.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    materialize_content(posts)
    print(f"Built site data with {len(posts)} posts")


if __name__ == "__main__":
    main()
