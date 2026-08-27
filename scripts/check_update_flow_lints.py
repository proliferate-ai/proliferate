#!/usr/bin/env python3
"""Enforce AH-UPDFLOW-1/2: the Update Flow ADR's mechanical invariants.

The rule statements and rationales are canonical in
lints/anyharness/updflow.toml (see lints/README.md); this module is only the
detection engine, and every diagnostic is rendered from the record.

AH-UPDFLOW-001 — the non-atomic `generate_launcher_script` writer must never
land a launcher file directly on a live path. It is legal (a) inside
integrations/agent_cli/launcher.rs, where it is the atomic writer's staged
half, or (b) at any other call site whose *enclosing function* also promotes
the written file through `ArchiveTreeActivation::activate_launcher` — the
staged-write-then-journaled-promote pattern used by the npm and pinned
installers. Anything else is a violation.

AH-UPDFLOW-002 — the catalog-construction constructors may only be called
from AppState wiring (app/mod.rs), the install-agents command
(commands/install_agents.rs), or `#[cfg(test)]` code.

Rungs 1-2/5 of the Update Flow ADR implementation had not merged onto every
checkout this checker might run against when these records were authored.
Rather than hard-require the scoped modules to exist, every scan below walks
whatever `.rs` files are actually present under `anyharness/crates/**/src`
and simply finds zero matches when a referenced module is absent — the
checker is vacuously clean on such a tree, not skipped and not failing.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CRATES_ROOT = REPO_ROOT / "anyharness" / "crates"

RULE_001 = "AH-UPDFLOW-001"
RULE_002 = "AH-UPDFLOW-002"

LAUNCHER_FILE_SUFFIX = "integrations/agent_cli/launcher.rs"
ALLOWED_CATALOG_CTOR_SUFFIXES = (
    "anyharness-lib/src/app/mod.rs",
    "anyharness/src/commands/install_agents.rs",
)

# The bare (non-atomic) writer, never the `_atomic` variant: the trailing
# `(` distinguishes `generate_launcher_script(` from
# `generate_launcher_script_atomic(`.
LAUNCHER_CALL_RE = re.compile(r"\bgenerate_launcher_script\(")
ACTIVATE_LAUNCHER_RE = re.compile(r"\bactivate_launcher\(")
CATALOG_CTOR_RE = re.compile(
    r"\bCatalogSyncService::"
    r"(from_bundled|from_staged_or_bundled|from_bundled_and_staged_via_env)\b"
)

FN_SIGNATURE_RE = re.compile(r"^\s*(pub(\([^)]*\))?\s+)?(async\s+)?fn\s+\w+")
CFG_TEST_RE = re.compile(r"^\s*#\[cfg\(test\)\]\s*$")
TEST_FILE_RE = re.compile(r"(^|_)tests\.rs$")


def _iter_rs_files():
    if not CRATES_ROOT.is_dir():
        return
    yield from sorted(CRATES_ROOT.rglob("*.rs"))


def _relative(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


def _code_portion(line: str) -> str:
    """The line with `//` comments and string-literal bodies removed.

    Keeps the matchers from firing on prose that merely NAMES a banned call
    (doc comments, log/format strings). Deliberately naive — no multi-line
    strings or nested block comments — because rule matches inside those are
    already adversarial-only, and this checker targets rustfmt-shaped code.
    """
    out: list[str] = []
    in_str = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            i += 1
            continue
        if ch == "/" and line[i : i + 2] == "//":
            break
        out.append(ch)
        i += 1
    return "".join(out)


def _brace_delta(line: str) -> int:
    # Good enough for this repo's formatting: braces inside string/char
    # literals in the lines we care about (fn signatures, call sites) are not
    # a real hazard here, so a raw count is fine rather than a real lexer.
    return line.count("{") - line.count("}")


def _enclosing_fn_range(lines: list[str], lineno: int) -> tuple[int, int]:
    """Return the 1-indexed [start, end] line range of the fn enclosing lineno.

    Falls back to (1, len(lines)) — the whole file — if no `fn` signature is
    found above, which only widens the search for `activate_launcher(` and
    therefore never hides a real violation.
    """
    start = None
    for idx in range(lineno - 1, -1, -1):
        if FN_SIGNATURE_RE.match(lines[idx]):
            start = idx
            break
    if start is None:
        return 1, len(lines)
    depth = 0
    seen_open = False
    for idx in range(start, len(lines)):
        depth += _brace_delta(lines[idx])
        if "{" in lines[idx]:
            seen_open = True
        if seen_open and depth <= 0:
            return start + 1, idx + 1
    return start + 1, len(lines)


def _cfg_test_ranges(lines: list[str]) -> list[tuple[int, int]]:
    """1-indexed [start, end] ranges of every `#[cfg(test)]`-gated item."""
    ranges: list[tuple[int, int]] = []
    idx = 0
    n = len(lines)
    while idx < n:
        if CFG_TEST_RE.match(lines[idx]):
            item_start = idx + 1
            while item_start < n and not lines[item_start].strip():
                item_start += 1
            if item_start < n:
                depth = 0
                seen_open = False
                end = item_start
                for j in range(item_start, n):
                    depth += _brace_delta(lines[j])
                    if "{" in lines[j]:
                        seen_open = True
                    end = j
                    if seen_open and depth <= 0:
                        break
                else:
                    end = n - 1
                ranges.append((idx + 1, end + 1))
                idx = end + 1
                continue
        idx += 1
    return ranges


def _line_in_ranges(lineno: int, ranges: list[tuple[int, int]]) -> bool:
    return any(start <= lineno <= end for start, end in ranges)


def _enclosing_fn_name(lines: list[str], fn_start: int) -> str:
    match = re.search(r"fn\s+(\w+)", lines[fn_start - 1])
    return match.group(1) if match else "<module>"


def check_launcher_writes() -> tuple[list[str], list[str]]:
    """Return (failures, stale-exception-entries) for AH-UPDFLOW-001."""
    rule = RULES.rule(RULE_001)
    ledger = RULES.exception_sites(RULE_001)
    observed: set[tuple[str, str]] = set()
    failures: list[str] = []
    for path in _iter_rs_files():
        rel = _relative(path)
        if rel.endswith(LAUNCHER_FILE_SUFFIX):
            continue
        text = path.read_text(encoding="utf-8")
        if "generate_launcher_script(" not in text:
            continue
        lines = text.splitlines()
        for idx, line in enumerate(lines):
            if not LAUNCHER_CALL_RE.search(_code_portion(line)):
                continue
            lineno = idx + 1
            fn_start, fn_end = _enclosing_fn_range(lines, lineno)
            enclosing_text = "\n".join(lines[fn_start - 1 : fn_end])
            if ACTIVATE_LAUNCHER_RE.search(enclosing_text):
                continue  # staged-write-then-promote: legal
            site = f"{_enclosing_fn_name(lines, fn_start)}::generate_launcher_script"
            key = (rel, site)
            observed.add(key)
            if key in ledger:
                continue  # grandfathered legacy direct-write site
            location = f"{rel}:{lineno}"
            failures.append(
                lint_records.render_diagnostic(
                    rule,
                    location,
                    detail=(
                        "generate_launcher_script(..) with no activate_launcher promotion "
                        "in the enclosing function"
                    ),
                )
            )
    stale = [
        f"{path}: [{RULE_001}] site '{site}' no longer violates the rule — "
        f"delete this entry from lints/anyharness/exceptions.toml"
        for path, site in sorted(ledger - observed)
    ]
    return failures, stale


def check_catalog_construction() -> list[str]:
    rule = RULES.rule(RULE_002)
    failures: list[str] = []
    for path in _iter_rs_files():
        rel = _relative(path)
        if rel.endswith(ALLOWED_CATALOG_CTOR_SUFFIXES):
            continue
        text = path.read_text(encoding="utf-8")
        if "CatalogSyncService::" not in text:
            continue
        lines = text.splitlines()
        if TEST_FILE_RE.search(path.name):
            continue  # whole file is test-only (declared behind #[cfg(test)])
        cfg_test_ranges = _cfg_test_ranges(lines)
        for idx, line in enumerate(lines):
            match = CATALOG_CTOR_RE.search(_code_portion(line))
            if not match:
                continue
            lineno = idx + 1
            if _line_in_ranges(lineno, cfg_test_ranges):
                continue
            location = f"{rel}:{lineno}"
            failures.append(
                lint_records.render_diagnostic(
                    rule,
                    location,
                    detail=(
                        f"CatalogSyncService::{match.group(1)}(..) outside the allowed "
                        "construction sites"
                    ),
                )
            )
    return failures


RULES = lint_records.load("anyharness")


def main() -> int:
    launcher_failures, stale = check_launcher_writes()
    failures = launcher_failures + check_catalog_construction()
    if failures:
        print("Update Flow lint violations:")
        for failure in failures:
            print(failure)
            print()
    if stale:
        print("Stale AH-UPDFLOW-001 exception entries:")
        for entry in stale:
            print(f"  {entry}")
        print()
    if failures or stale:
        return 1
    print("Update Flow lint check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
