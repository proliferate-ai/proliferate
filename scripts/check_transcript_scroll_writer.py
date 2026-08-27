#!/usr/bin/env python3
"""Enforce the single-scroll-writer discipline recorded as FE-CHATSCROLL-1.

The Chat Scroll ADR (rung 3) made the transcript's stick-to-bottom engine the
sole sanctioned writer of the transcript viewport. This checker is the engine;
the rule itself is the record under lints/frontend/chat-scroll.toml, and the
sanctioned writer files are a shrink-only allowlist in
lints/frontend/ratchets.toml `[[transcript_scroll_writer]]`.

A non-test product-client source file that mutates scroll position — assigns
`.scrollTop`, calls `.scrollTo(` or `.scrollIntoView(`, or sets
`overflow-anchor` / `overflowAnchor` — must appear in that allowlist. A file not
in the allowlist fails as a net-new writer; an allowlist entry whose file no
longer writes scroll (or is gone) is stale and fails too. Diagnostics render
from the record via scripts/lint_records.py.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402 - repo-root bootstrap above

CHECKER = "scripts/check_transcript_scroll_writer.py"
RULE_ID = "FE-CHATSCROLL-1"

SCAN_ROOT = "apps/packages/product-client/src"
EXTENSIONS = {".ts", ".tsx", ".css", ".scss"}

# Scroll-position mutations. Each pattern matches a write, not a read: an
# assignment to scrollTop (not the `==`/`===` comparison), or a call to a
# scroll method, or an overflow-anchor style declaration.
WRITE_PATTERNS = [
    ("scrollTop assignment", re.compile(r"\.scrollTop\s*=(?!=)")),
    ("scrollTo call", re.compile(r"\.scrollTo\s*\(")),
    ("scrollIntoView call", re.compile(r"\.scrollIntoView\s*\(")),
    ("overflow-anchor", re.compile(r"overflow-?[Aa]nchor")),
]


@dataclass(frozen=True)
class AllowEntry:
    path: str
    reason: str


def load_allowlist() -> dict[str, AllowEntry]:
    """The `[[transcript_scroll_writer]]` allowlist from frontend ratchets.toml."""
    source = "lints/frontend/ratchets.toml"
    entries: dict[str, AllowEntry] = {}
    for raw in lint_records.load_ratchets("frontend").get("transcript_scroll_writer", []):
        missing = [key for key in ("path", "reason") if key not in raw]
        if missing:
            raise ValueError(f"{source}: entry missing fields: {', '.join(missing)} ({raw})")
        entry_path = raw["path"]
        if entry_path in entries:
            raise ValueError(f"{source}: {entry_path} is listed twice")
        entries[entry_path] = AllowEntry(path=entry_path, reason=raw["reason"])
    return entries


def is_test_file(relative_path: str) -> bool:
    name = Path(relative_path).name
    return (
        name.endswith(".test.ts") or name.endswith(".test.tsx") or "/__tests__/" in relative_path
    )


def first_write(path: Path) -> tuple[int, str] | None:
    """Return (lineno, description) of the first scroll write, or None."""
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        for description, pattern in WRITE_PATTERNS:
            if pattern.search(line):
                return lineno, description
    return None


def iter_writer_files() -> dict[str, tuple[int, str]]:
    """Every non-test scanned file that mutates scroll, mapped to its first hit."""
    writers: dict[str, tuple[int, str]] = {}
    root_path = REPO_ROOT / SCAN_ROOT
    for path in sorted(root_path.rglob("*")):
        if not path.is_file() or path.suffix not in EXTENSIONS:
            continue
        relative = path.relative_to(REPO_ROOT).as_posix()
        if is_test_file(relative):
            continue
        hit = first_write(path)
        if hit is not None:
            writers[relative] = hit
    return writers


def main() -> int:
    ruleset = lint_records.load("frontend")
    rule = ruleset.rule(RULE_ID)
    if rule.enforced_by != CHECKER:
        raise ValueError(f"{RULE_ID}.enforced_by is {rule.enforced_by!r}, expected {CHECKER!r}")

    allowlist = load_allowlist()
    writers = iter_writer_files()

    diagnostics: list[str] = []
    for relative_path, (lineno, description) in sorted(writers.items()):
        if relative_path not in allowlist:
            diagnostics.append(
                lint_records.render_diagnostic(
                    rule,
                    f"{relative_path}:{lineno}",
                    f"net-new scroll writer ({description}) not in the "
                    f"[[transcript_scroll_writer]] allowlist",
                )
            )

    stale = sorted(
        f"{path} (lints/frontend/ratchets.toml) — no scroll write found"
        + ("" if (REPO_ROOT / path).exists() else " (file is gone)")
        for path in allowlist
        if path not in writers
    )

    if not diagnostics and not stale:
        print(
            f"Transcript scroll-writer check passed "
            f"({len(writers)} sanctioned writers, all allowlisted)."
        )
        return 0

    if diagnostics:
        print("Scroll-position writers with no [[transcript_scroll_writer]] allowlist entry:")
        for diagnostic in diagnostics:
            print(diagnostic)
            print()

    if stale:
        print(
            "Stale transcript scroll-writer allowlist entries — these files no "
            "longer write scroll (or are gone); delete the entries in this change:"
        )
        for entry_line in stale:
            print(f"  {entry_line}")

    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2)
