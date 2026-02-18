#!/usr/bin/env python3
"""
Import UnrealSummary markdown docs into this blog repo while preserving folder structure.

Default behavior:
- Copies `*.md` under `D:\\UnrealEngine\\UnrealSummary` into `posts/unreal-summary/`
- Skips `_Archive/` and `_Audit/` by default (often contains engine headers / internal reports)

Usage:
  python scripts/import_unreal_summary.py
  python scripts/import_unreal_summary.py --src D:\\UnrealEngine\\UnrealSummary --dst posts\\unreal-summary
  python scripts/import_unreal_summary.py --include-archive
  python scripts/import_unreal_summary.py --include-audit
  python scripts/import_unreal_summary.py --dry-run
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def _is_excluded(rel: Path, include_archive: bool, include_audit: bool) -> bool:
    parts = rel.parts
    if not parts:
        return False
    top = parts[0]
    if top == "_Archive" and not include_archive:
        return True
    if top == "_Audit" and not include_audit:
        return True
    return False


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]

    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path(r"D:\UnrealEngine\UnrealSummary"))
    ap.add_argument("--dst", type=Path, default=(repo_root / "posts" / "unreal-summary"))
    ap.add_argument("--include-archive", action="store_true")
    ap.add_argument("--include-audit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src_root: Path = args.src
    dst_root: Path = args.dst if args.dst.is_absolute() else (repo_root / args.dst)

    if not src_root.exists():
        raise SystemExit(f"Source path not found: {src_root}")

    copied = 0
    skipped = 0

    for src in sorted(src_root.rglob("*.md")):
        rel = src.relative_to(src_root)
        if _is_excluded(rel, args.include_archive, args.include_audit):
            skipped += 1
            continue

        dst = dst_root / rel
        if args.dry_run:
            print(f"[dry-run] {src} -> {dst}")
            copied += 1
            continue

        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    print(f"Imported {copied} markdown files into {dst_root}")
    if skipped:
        print(f"Skipped {skipped} markdown files due to exclusion rules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
