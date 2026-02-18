#!/usr/bin/env python3
"""One-shot script to inject YAML frontmatter into posts/unreal-summary/ markdown files.

Two file patterns are handled:

Type A (blockquote metadata — Deep Dive files):
    # Title
    > **작성일**: 2025-01-22
    > **엔진 버전**: Unreal Engine 5.7
    > **분석 대상**: description
    ---

Type B (no metadata — Overview.md, Core/ files, etc.):
    # Title
    ## 🧭 개요

Usage:
    python scripts/inject_frontmatter.py            # inject for real
    python scripts/inject_frontmatter.py --dry-run   # preview only
"""
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNREAL_SUMMARY_DIR = ROOT / "posts" / "unreal-summary"

# Regex for Type A blockquote metadata lines
RE_DATE = re.compile(r"작성일[^\d]*(\d{4}-\d{2}-\d{2})")
RE_ENGINE = re.compile(r"엔진\s*버전[^:]*:\s*(.+)")
RE_HANGUL = re.compile(r"[\uac00-\ud7a3]")


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        ln = line.strip()
        if ln.startswith("# "):
            return ln[2:].strip() or fallback
    return fallback


def detect_lang(text: str) -> str:
    return "ko" if RE_HANGUL.search(text) else "en"


def mtime_date(path: Path) -> str:
    dt = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).astimezone()
    return dt.date().isoformat()


def parse_blockquote_meta(text: str):
    """Extract date and engine_version from Type A blockquote header."""
    date = None
    engine_version = None
    # Only scan the first 20 lines for blockquote metadata.
    for line in text.splitlines()[:20]:
        ln = line.strip()
        if not ln.startswith(">"):
            continue
        m = RE_DATE.search(ln)
        if m:
            date = m.group(1)
        m = RE_ENGINE.search(ln)
        if m:
            engine_version = m.group(1).strip().rstrip("*").strip()
    return date, engine_version


def find_blockquote_end(lines: list[str]) -> int | None:
    """Find the end index of the blockquote+hr block after the title.

    Returns the index of the line AFTER the `---` that follows the blockquote,
    or None if no such block is found.
    """
    in_blockquote = False
    for i, raw in enumerate(lines):
        ln = raw.strip()
        # Skip empty lines and the title line
        if not ln or ln.startswith("# "):
            continue
        if ln.startswith(">"):
            in_blockquote = True
            continue
        if in_blockquote and ln == "---":
            return i + 1  # line after the ---
        break
    return None


def build_frontmatter(path: Path, text: str) -> str:
    """Build YAML frontmatter string for a given file."""
    rel = path.relative_to(UNREAL_SUMMARY_DIR)
    parts = rel.parts

    # track = first directory
    if len(parts) >= 2:
        track = parts[0]
        extra_tags = [p for p in parts[1:-1] if p]
    else:
        track = "Meta"
        extra_tags = []

    title = extract_title(text, path.stem)
    lang = detect_lang(text)
    date, engine_version = parse_blockquote_meta(text)
    if not date:
        date = mtime_date(path)

    tags = ["unreal", track] + extra_tags
    # De-duplicate while preserving order
    tags = list(dict.fromkeys(tags))

    fm_lines = [
        "---",
        f'title: "{title}"',
        f'date: "{date}"',
        'status: "stable"',
        'project: "UnrealEngine"',
        f'lang: "{lang}"',
        'category: "unreal-summary"',
        f'track: "{track}"',
        f'tags: [{", ".join(f"\"{t}\"" for t in tags)}]',
    ]
    if engine_version:
        fm_lines.append(f'engine_version: "{engine_version}"')
    fm_lines.append("---")
    return "\n".join(fm_lines) + "\n"


def strip_blockquote_header(lines: list[str]) -> list[str]:
    """Remove the Type A blockquote+hr block, keeping the # title and body."""
    end = find_blockquote_end(lines)
    if end is None:
        return lines

    # Keep everything before blockquote and after the hr
    result = []
    in_blockquote = False
    for i, raw in enumerate(lines):
        if i >= end:
            result.append(raw)
            continue
        ln = raw.strip()
        if ln.startswith(">"):
            in_blockquote = True
            continue
        if in_blockquote and ln == "---":
            continue
        if in_blockquote and not ln:
            # Skip blank lines within blockquote region
            continue
        result.append(raw)
    return result


def process_file(path: Path, dry_run: bool) -> str:
    """Process a single file. Returns status string."""
    text = path.read_text(encoding="utf-8")

    # Skip files that already have frontmatter
    if text.startswith("---\n"):
        return "skip (has frontmatter)"

    frontmatter = build_frontmatter(path, text)

    lines = text.splitlines(keepends=True)

    # For Type A: remove blockquote metadata block from body
    _, engine_version = parse_blockquote_meta(text)
    if engine_version or RE_DATE.search("\n".join(text.splitlines()[:20])):
        # Type A — strip the blockquote+hr
        clean_lines = strip_blockquote_header(text.splitlines())
        body = "\n".join(clean_lines)
        # Ensure single newline between title and rest
        body = re.sub(r"(^# .+\n)\n{2,}", r"\1\n", body)
    else:
        body = text

    new_text = frontmatter + body

    if dry_run:
        return "would inject"
    else:
        path.write_text(new_text, encoding="utf-8")
        return "injected"


def main():
    parser = argparse.ArgumentParser(description="Inject YAML frontmatter into unreal-summary markdown files")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    if not UNREAL_SUMMARY_DIR.exists():
        print(f"Directory not found: {UNREAL_SUMMARY_DIR}")
        return

    files = sorted(UNREAL_SUMMARY_DIR.rglob("*.md"))
    counts = {"injected": 0, "would inject": 0, "skip (has frontmatter)": 0}

    for f in files:
        status = process_file(f, args.dry_run)
        counts[status] = counts.get(status, 0) + 1
        if args.dry_run:
            rel = f.relative_to(ROOT).as_posix()
            print(f"  [{status}] {rel}")

    mode = "DRY RUN" if args.dry_run else "DONE"
    print(f"\n{mode}: {len(files)} files processed")
    for k, v in counts.items():
        if v:
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
