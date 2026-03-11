#!/usr/bin/env python3
"""Audit Unreal summary docs for metadata/path consistency and link integrity.

Checks:
1) Required frontmatter exists for every posts/unreal-summary/*.md file.
2) `track` matches top-level folder name (or Meta for root-level files).
3) Internal markdown links resolve via filesystem, alias map, or basename fallback.

Exit code:
  0 when no issues were found
  1 when one or more issues were found
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNREAL_ROOT = ROOT / "posts" / "unreal-summary"
POST_JS = ROOT / "site" / "post.js"

RE_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
RE_ALIAS = re.compile(
    r'"(posts/unreal-summary/[^"]+\.md)"\s*:\s*"(posts/unreal-summary/[^"]+\.md)"'
)
DENY_BASENAME = {"Compilation.md", "Overview.md"}


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text

    head = text[4:end]
    body = text[end + 5 :]
    out: dict[str, str] = {}
    for line in head.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        out[k.strip()] = v.strip().strip('"')
    return out, body


def normalize_posix(path: str) -> str:
    parts = []
    for part in path.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            if parts and parts[-1] != "..":
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def resolve_link(current_rel: str, href: str) -> str:
    base = "/".join(current_rel.split("/")[:-1])
    joined = f"{base}/{href}" if base else href
    return normalize_posix(joined)


def load_alias_map() -> dict[str, str]:
    if not POST_JS.exists():
        return {}
    text = POST_JS.read_text(encoding="utf-8")
    return {src: dst for src, dst in RE_ALIAS.findall(text)}


def main() -> int:
    if not UNREAL_ROOT.exists():
        print(f"Missing directory: {UNREAL_ROOT}")
        return 1

    files = sorted(UNREAL_ROOT.rglob("*.md"))
    if not files:
        print("No unreal-summary markdown files found.")
        return 1

    alias_map = load_alias_map()
    all_rel = [p.relative_to(ROOT).as_posix() for p in files]
    all_set = set(all_rel)
    basename_index: dict[str, list[str]] = defaultdict(list)
    for rel in all_rel:
        basename_index[Path(rel).name].append(rel)

    metadata_issues: list[str] = []
    link_issues: list[str] = []

    required = {
        "title",
        "date",
        "status",
        "project",
        "lang",
        "category",
        "track",
        "tags",
    }

    for path in files:
        rel_unreal = path.relative_to(UNREAL_ROOT).as_posix()
        rel_repo = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        fm, body = parse_frontmatter(text)

        if not fm:
            metadata_issues.append(f"{rel_repo}\tmissing_frontmatter")
            continue

        for key in sorted(required):
            if not fm.get(key):
                metadata_issues.append(f"{rel_repo}\tmissing_{key}")

        expected_track = Path(rel_unreal).parts[0] if "/" in rel_unreal else "Meta"
        if fm.get("track") != expected_track:
            metadata_issues.append(
                f"{rel_repo}\ttrack_mismatch:{fm.get('track')}!={expected_track}"
            )
        if fm.get("category") != "unreal-summary":
            metadata_issues.append(
                f"{rel_repo}\tbad_category:{fm.get('category')}"
            )

        for href in RE_LINK.findall(body):
            href = href.strip()
            if not href or href.startswith("#"):
                continue
            low = href.lower()
            if low.startswith(("http://", "https://", "mailto:", "tel:")):
                continue

            href_path = href.split("#", 1)[0]
            if not href_path.lower().endswith(".md"):
                continue

            resolved_unreal = resolve_link(rel_unreal, href_path)
            resolved_repo = f"posts/unreal-summary/{resolved_unreal}"
            if resolved_repo in all_set:
                continue

            mapped = alias_map.get(resolved_repo)
            if mapped and mapped in all_set:
                continue

            basename = Path(resolved_repo).name
            candidates = basename_index.get(basename, [])
            if len(candidates) == 1 and basename not in DENY_BASENAME:
                continue

            link_issues.append(
                f"{rel_unreal}\t{href}\t{resolved_repo}"
            )

    print(f"unreal_files\t{len(files)}")
    print(f"metadata_issues\t{len(metadata_issues)}")
    print(f"link_issues\t{len(link_issues)}")

    if metadata_issues:
        print("\n[metadata]")
        for row in metadata_issues[:200]:
            print(row)

    if link_issues:
        print("\n[links]")
        for row in link_issues[:200]:
            print(row)

    return 1 if (metadata_issues or link_issues) else 0


if __name__ == "__main__":
    raise SystemExit(main())
