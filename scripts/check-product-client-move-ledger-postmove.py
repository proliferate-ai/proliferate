#!/usr/bin/env python3
"""Post-move completion proof for the ProductClient move ledger.

The sibling `check-product-client-move-ledger.py` is a PRE-move gate: it verifies
the ledger against `apps/desktop/src` while the product source still lives there.
Once [[Move the Desktop Product into ProductClient]] executes the `git mv`s, those
source paths stop existing and the pre-move checker necessarily fails.

This script is the POST-move counterpart. It reads the same `` ```ledger `` block
and confirms, per classification, that the move landed exactly once:

  move   (N): target exists under apps/packages/product-client/src/<relpath>;
              original source path no longer exists under apps/desktop/src.
  delete (N): source path no longer exists under apps/desktop/src.
  retain (N): source path still exists under apps/desktop/src.
  split  (N): the file has a host part that stays and a product part that moves;
              its final resolution is the S2 seam step. Reported separately as
              "pending" when the target does not yet exist, "resolved" when it
              does. Splits are NOT counted as violations here (S2 is a distinct
              stage); they are surfaced so the completion proof is honest about
              what remains.

Exit 0 only when every move/delete/retain row is satisfied. Splits are always
reported but never fail this check.

Usage:
    python3 scripts/check-product-client-move-ledger-postmove.py
"""
from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(
    REPO_ROOT,
    "specs",
    "codebase",
    "systems",
    "product",
    "clients",
    "web-desktop-unification",
    "move-ledger.md",
)
DESKTOP_SRC = os.path.join(REPO_ROOT, "apps", "desktop", "src")
TARGET_PREFIX = "apps/packages/product-client/src/"
FENCE = "```ledger"
FENCE_AMEND = "```ledger-amendments"


def _parse_fenced(path: str, fence: str):
    """Return `(lineno, tab-split-fields)` for every non-blank row inside the
    first fenced block opened by `fence` and closed by a bare ```."""
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    rows = []
    inside = False
    for i, line in enumerate(lines, 1):
        if not inside:
            if line.strip() == fence:
                inside = True
            continue
        if line.strip() == "```":
            inside = False
            continue
        if not line.strip():
            continue
        rows.append((i, line.split("\t")))
    if inside:
        raise SystemExit(f"ERROR: unterminated {fence} block")
    return rows


def parse_ledger(path: str):
    return _parse_fenced(path, FENCE)


def parse_amendments(path: str):
    """Ratified reclassifications applied during the move (see the ledger's
    "Amendments (ratified during the move)" section). Each row is
    `src<TAB>new_class<TAB>evidence`; the checker treats `src` as `new_class`
    instead of the binding ledger's original classification. This lets the
    completion proof track owner-blessed retain->move relocations without
    silently rewriting the binding ledger rows. Returns `{src: new_class}`."""
    amendments: dict[str, str] = {}
    for lineno, parts in _parse_fenced(path, FENCE_AMEND):
        if len(parts) < 3:
            raise SystemExit(
                f"ERROR: malformed amendment row at L{lineno}: {parts!r} "
                "(expected src<TAB>new_class<TAB>evidence)"
            )
        src, new_class = parts[0], parts[1]
        if new_class not in {"move", "split", "retain", "delete"}:
            raise SystemExit(
                f"ERROR: unknown amendment classification {new_class!r} at L{lineno}"
            )
        amendments[src] = new_class
    return amendments


def main() -> int:
    allow_pending = "--allow-pending-splits" in sys.argv
    rows = parse_ledger(LEDGER)
    amendments = parse_amendments(LEDGER)
    seen_amendment_srcs: set[str] = set()
    ledger_srcs = {parts[0] for _, parts in rows if len(parts) >= 2}
    for src in amendments:
        if src not in ledger_srcs:
            raise SystemExit(
                f"ERROR: amendment references unknown ledger row: {src}"
            )
    violations: list[str] = []
    splits_pending: list[str] = []
    splits_resolved: list[str] = []
    counts = {"move": 0, "split": 0, "retain": 0, "delete": 0}
    amended = 0

    for lineno, parts in rows:
        if len(parts) < 4:
            violations.append(f"L{lineno}: malformed row: {parts!r}")
            continue
        src, cls = parts[0], parts[1]
        if src in amendments:
            cls = amendments[src]
            seen_amendment_srcs.add(src)
            amended += 1
        counts[cls] = counts.get(cls, 0) + 1
        src_on_disk = os.path.isfile(os.path.join(DESKTOP_SRC, src))
        tgt_abs = os.path.join(REPO_ROOT, TARGET_PREFIX + src)
        tgt_on_disk = os.path.isfile(tgt_abs)

        if cls == "move":
            if not tgt_on_disk:
                violations.append(f"L{lineno}: move target missing: {TARGET_PREFIX + src}")
            if src_on_disk:
                violations.append(f"L{lineno}: move source still present in apps/desktop/src: {src}")
        elif cls == "delete":
            if src_on_disk:
                violations.append(f"L{lineno}: delete source still present: {src}")
        elif cls == "retain":
            if not src_on_disk:
                violations.append(f"L{lineno}: retain source missing from apps/desktop/src: {src}")
        elif cls == "split":
            if tgt_on_disk:
                splits_resolved.append(src)
            else:
                splits_pending.append(src)
        else:
            violations.append(f"L{lineno}: unknown classification {cls!r}: {src}")

    print(
        f"ledger rows: move={counts['move']} split={counts['split']} "
        f"retain={counts['retain']} delete={counts['delete']} "
        f"(ratified amendments applied: {amended})"
    )
    print(f"splits resolved (product target present): {len(splits_resolved)}")
    print(f"splits pending  (S2 seam step, target absent): {len(splits_pending)}")
    for s in splits_pending:
        print(f"    pending split: {s}")

    if violations:
        print(f"\nFAIL: {len(violations)} move/delete/retain violation(s):")
        for v in violations[:80]:
            print(f"  - {v}")
        if len(violations) > 80:
            print(f"  ... and {len(violations) - 80} more")
        return 1

    if splits_pending and not allow_pending:
        print(
            f"\nFAIL: {len(splits_pending)} split row(s) unresolved. The final move "
            "requires every planned path completed exactly once; pass "
            "--allow-pending-splits only for intermediate seam rounds."
        )
        return 1

    print("\nOK: every move/delete/retain row landed exactly once and all splits are resolved."
          if not splits_pending else
          "\nOK (intermediate): move/delete/retain rows landed; pending splits allowed by flag.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
