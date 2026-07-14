#!/usr/bin/env python3
"""Verify the ProductClient move ledger against `apps/desktop/src` on disk.

Checks the ledger at
`specs/codebase/features/web-desktop-product-client-move-ledger.md`:

  (a) every current file under apps/desktop/src is classified exactly once;
  (b) move/split targets are unique (no two sources map to one target);
  (c) every classified source path exists on disk;
  (d) targets are well-formed
      (move/split -> apps/packages/product-client/src/<same relpath>;
       retain/delete -> empty).

Exits non-zero and lists every violation on failure.

Usage:
    python3 scripts/check-product-client-move-ledger.py

CI wiring: NOT wired into the standing `repo-shape` CI job. This is an interim,
pre-move gate: its source paths (the product files under apps/desktop/src) stop
existing on disk the moment [[Move the Desktop Product into ProductClient]]
relocates them, so a standing CI step would fail as soon as the move lands. Run
it manually while iterating on the ledger, and as a pre-flight in the move PR
(before the move executes) to confirm the ledger still matches the tree. If a
future maintainer wants it enforced, gate it on the branch/PR that owns the
ledger, not on `main`.
"""
from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(
    REPO_ROOT,
    "specs",
    "codebase",
    "features",
    "web-desktop-product-client-move-ledger.md",
)
SRC_ROOT = os.path.join(REPO_ROOT, "apps", "desktop", "src")
TARGET_PREFIX = "apps/packages/product-client/src/"
VALID = {"move", "split", "retain", "delete"}
FENCE = "```ledger"


def parse_ledger(path: str):
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    rows = []
    inside = False
    for i, line in enumerate(lines, 1):
        if not inside:
            if line.strip() == FENCE:
                inside = True
            continue
        if line.strip() == "```":
            inside = False
            continue
        if not line.strip():
            continue
        parts = line.split("\t")
        rows.append((i, parts))
    if inside:
        raise SystemExit("ERROR: unterminated ```ledger block")
    return rows


def disk_sources(root: str):
    out = set()
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            out.add(rel.replace(os.sep, "/"))
    return out


def main() -> int:
    if not os.path.isfile(LEDGER):
        print(f"ERROR: ledger not found: {LEDGER}")
        return 1
    if not os.path.isdir(SRC_ROOT):
        print(f"ERROR: source root not found: {SRC_ROOT}")
        return 1

    violations: list[str] = []
    rows = parse_ledger(LEDGER)
    if not rows:
        print("ERROR: no ledger rows parsed (missing ```ledger block?)")
        return 1

    seen_src: dict[str, int] = {}
    seen_tgt: dict[str, str] = {}
    ledger_srcs: set[str] = set()

    for lineno, parts in rows:
        if len(parts) < 4:
            violations.append(
                f"L{lineno}: expected 4 tab-separated fields, got {len(parts)}: {parts!r}"
            )
            continue
        src, cls, tgt, _reason = parts[0], parts[1], parts[2], "\t".join(parts[3:])

        if cls not in VALID:
            violations.append(f"L{lineno}: invalid classification {cls!r} for {src}")

        if src in seen_src:
            violations.append(
                f"L{lineno}: source classified more than once: {src} (first at L{seen_src[src]})"
            )
        else:
            seen_src[src] = lineno
        ledger_srcs.add(src)

        if cls in ("move", "split"):
            expected = TARGET_PREFIX + src
            if tgt != expected:
                violations.append(
                    f"L{lineno}: {cls} target must be {expected!r}, got {tgt!r} ({src})"
                )
            if tgt in seen_tgt:
                violations.append(
                    f"L{lineno}: duplicate target {tgt} (also {seen_tgt[tgt]})"
                )
            else:
                seen_tgt[tgt] = src
        elif cls in ("retain", "delete"):
            if tgt != "":
                violations.append(
                    f"L{lineno}: {cls} row must have empty target, got {tgt!r} ({src})"
                )

        # (c) classified source must exist on disk
        if not os.path.isfile(os.path.join(SRC_ROOT, src)):
            violations.append(f"L{lineno}: source path not on disk: {src}")

    # (a) every disk file classified exactly once
    disk = disk_sources(SRC_ROOT)
    for missing in sorted(disk - ledger_srcs):
        violations.append(f"unclassified disk file (missing from ledger): {missing}")

    if violations:
        print(f"FAIL: {len(violations)} ledger violation(s):")
        for v in violations:
            print(f"  - {v}")
        return 1

    counts: dict[str, int] = {}
    for _lineno, parts in rows:
        counts[parts[1]] = counts.get(parts[1], 0) + 1
    print(
        "OK: ledger matches apps/desktop/src "
        f"({len(ledger_srcs)} files; "
        + ", ".join(f"{k}={counts.get(k, 0)}" for k in ("move", "split", "retain", "delete"))
        + ")"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
