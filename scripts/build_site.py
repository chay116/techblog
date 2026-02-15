#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS_DIRS = [ROOT / "posts", ROOT / "posts-ko"]
SITE_DIR = ROOT / "site"


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
    lines = [ln.strip() for ln in body.splitlines()]
    for ln in lines:
        if not ln:
            continue
        if ln.startswith("#"):
            continue
        if ln.startswith("|"):
            continue
        return ln
    return ""


def collect_posts():
    posts = []
    for posts_dir in POSTS_DIRS:
        if not posts_dir.exists():
            continue
        for path in sorted(posts_dir.rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            frontmatter, body = parse_frontmatter(text)
            rel = path.relative_to(ROOT).as_posix()
            tags = frontmatter.get("tags", [])
            if isinstance(tags, str):
                tags = [tags]
            post = {
                "title": frontmatter.get("title", path.stem),
                "date": frontmatter.get("date", ""),
                "status": frontmatter.get("status", "wip"),
                "project": frontmatter.get("project", ""),
                "lang": frontmatter.get("lang", "en"),
                "category": frontmatter.get("category", "other"),
                "track": frontmatter.get("track", "other"),
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


def main():
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    posts = collect_posts()
    payload = {
        "posts": posts,
        "languages": sorted({p["lang"] for p in posts}),
        "categories": sorted({p["category"] for p in posts}),
        "tracks": sorted({p["track"] for p in posts}),
        "tags": build_tags(posts),
    }
    (SITE_DIR / "posts.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Built site data with {len(posts)} posts")


if __name__ == "__main__":
    main()
