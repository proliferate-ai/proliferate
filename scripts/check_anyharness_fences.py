#!/usr/bin/env python3
"""AnyHarness cross-domain fence checker.

The layer checker (`check_anyharness_boundaries.py`) governs which LAYERS may
import which; this checker governs which sibling DOMAINS may import which. Two
records under `lints/anyharness/fences.toml` own the rules:

- AH-FENCE-001: a domain may reference a sibling domain only along an edge
  declared in the `[[edge]]` baseline of the record file. The baseline is the
  measured domain→domain graph at fence introduction — permissive by
  construction, shrink-only afterwards. A new edge and a stale baseline row are
  both failures, so the baseline always equals reality exactly.
- AH-FENCE-002: a domain must not reach a sibling domain's store. Grandfathered
  sites live in `lints/anyharness/exceptions.toml`, one `(path, site)`
  fingerprint per site — never counts.

`--warn` reports everything and exits 0: the checker's non-blocking
introduction mode, dropped when the baseline is ready to enforce.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_anyharness_fences.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_anyharness_fences.py"
DOMAINS_RELATIVE = ("anyharness", "crates", "anyharness-lib", "src", "domains")
FENCES_RECORD_RELATIVE = ("lints", "anyharness", "fences.toml")
EDGE_RULE = "AH-FENCE-001"
STORE_RULE = "AH-FENCE-002"

RULES = lint_records.load("anyharness")

# Any `crate::domains::<name>` reference — use statements and inline qualified
# paths alike. Grouped heads (`use crate::domains::{a, b}`) do not occur in the
# tree today; the unit tests pin that a group head at the domains level is still
# reported rather than silently skipped. The store pattern captures the full
# trailing path so two different store imports in the same scope get distinct
# ledger fingerprints.
DOMAIN_REF_RE = re.compile(r"crate::domains::([A-Za-z_][A-Za-z0-9_]*|\{)")
STORE_REF_RE = re.compile(
    r"crate::domains::([a-z_][a-z0-9_]*)::store\b((?:::[A-Za-z_][A-Za-z0-9_]*)*)"
)
# Multi-line/grouped use statements a single-line path scan cannot see:
# `use crate::{ domains::x::.., .. };` hides `crate::domains::` across the
# brace, and `use crate::domains::x::{store::Y, ..};` hides `::store` behind
# it. Statement heads are detected here and the joined statement re-scanned.
USE_HEAD_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\b")
CRATE_GROUP_DOMAIN_RE = re.compile(r"\bdomains\s*::\s*([a-z_][a-z0-9_]*)")
CRATE_GROUP_STORE_RE = re.compile(r"\bdomains\s*::\s*([a-z_][a-z0-9_]*)\s*::\s*store\b")
DOMAIN_GROUP_STORE_RE = re.compile(r"crate::domains::([a-z_][a-z0-9_]*)\s*::\s*\{[^;]*\bstore\b")
MAX_STATEMENT_LINES = 100

# A violation's fingerprint is `<enclosing symbol>::<content anchor>` — never a
# line number, so a site survives reformatting and moves within its file. Same
# convention as check_anyharness_boundaries.py.
SYMBOL_RES = (
    (re.compile(r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)"), "fn"),
    (re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)"), "mod"),
    (re.compile(r"^\s*impl\b[^{]*?\bfor\s+([A-Za-z_][A-Za-z0-9_]*)"), "impl"),
    (re.compile(r"^\s*impl\b[^{]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\{"), "impl"),
    (
        re.compile(
            r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+"
            r"([A-Za-z_][A-Za-z0-9_]*)"
        ),
        "type",
    ),
)


def strip_line_comment(line: str) -> str:
    return line.split("//", 1)[0]


def enclosing_symbol(lines: list[str], lineno: int) -> str:
    """Nearest declaration above `lineno`, e.g. `fn append` or `mod tests`."""
    for index in range(min(lineno, len(lines)) - 1, -1, -1):
        line = strip_line_comment(lines[index])
        for pattern, kind in SYMBOL_RES:
            match = pattern.search(line)
            if match:
                return f"{kind} {match.group(1)}"
    return ""


def fingerprint(lines: list[str], lineno: int, anchor: str) -> str:
    symbol = enclosing_symbol(lines, lineno)
    return f"{symbol}::{anchor}" if symbol else anchor


@dataclass(frozen=True)
class Violation:
    rule_id: str
    relative_path: str
    lineno: int
    site: str
    detail: str

    @property
    def key(self) -> tuple[str, str]:
        return (self.relative_path, self.site)

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
            f"{self.relative_path}:{self.lineno}",
            self.detail,
        )


def load_edge_baseline(root: Path) -> set[tuple[str, str]]:
    """The declared domain→domain edge set from the fences record file."""
    path = root.joinpath(*FENCES_RECORD_RELATIVE)
    if not path.is_file():
        raise SystemExit(f"{CHECKER}: missing edge baseline record {path}")
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    edges: set[tuple[str, str]] = set()
    for entry in data.get("edge", []):
        missing = [key for key in ("from", "to") if key not in entry]
        if missing:
            raise SystemExit(
                f"{CHECKER}: {path}: [[edge]] entry missing {', '.join(missing)}: {entry}"
            )
        edges.add((entry["from"], entry["to"]))
    return edges


@dataclass(frozen=True)
class ScanResult:
    violations: list[Violation]
    stale_edges: set[tuple[str, str]]
    edges_seen: set[tuple[str, str]]


def collect_violations(
    root: Path | None = None,
    baseline: set[tuple[str, str]] | None = None,
) -> ScanResult:
    """Scan the domain tree against the edge baseline and the store rule."""
    base = Path(root).resolve() if root is not None else REPO_ROOT
    domains_root = base.joinpath(*DOMAINS_RELATIVE)
    if not domains_root.is_dir():
        raise SystemExit(f"{CHECKER}: missing domain tree {domains_root}")
    if baseline is None:
        baseline = load_edge_baseline(base)
    domains = sorted(entry.name for entry in domains_root.iterdir() if entry.is_dir())
    violations: list[Violation] = []
    edges_seen: set[tuple[str, str]] = set()

    for domain in domains:
        for path in sorted((domains_root / domain).rglob("*.rs")):
            relative = path.relative_to(base).as_posix()
            lines = path.read_text(encoding="utf-8").splitlines()
            stripped = [strip_line_comment(raw) for raw in lines]

            # The two helpers below are called only within this iteration; the
            # loop variables are bound as defaults so the closure cannot drift.
            def edge_ref(
                target: str,
                lineno: int,
                detail: str,
                *,
                domain: str = domain,
                relative: str = relative,
                lines: list[str] = lines,
            ) -> None:
                if target == domain or target not in domains:
                    return
                edges_seen.add((domain, target))
                if (domain, target) not in baseline:
                    violations.append(
                        Violation(
                            EDGE_RULE,
                            relative,
                            lineno,
                            fingerprint(lines, lineno, f"crate::domains::{target}"),
                            f"undeclared domain edge {domain} -> {target}: {detail}",
                        )
                    )

            def store_ref(
                target: str,
                lineno: int,
                anchor: str,
                detail: str,
                *,
                domain: str = domain,
                relative: str = relative,
                lines: list[str] = lines,
            ) -> None:
                if target == domain or target not in domains:
                    return
                violations.append(
                    Violation(
                        STORE_RULE,
                        relative,
                        lineno,
                        fingerprint(lines, lineno, anchor),
                        f"cross-domain store reach {domain} -> {target}: {detail}",
                    )
                )

            for lineno, line in enumerate(stripped, 1):
                detail = lines[lineno - 1].strip()[:120]
                for match in DOMAIN_REF_RE.finditer(line):
                    target = match.group(1)
                    if target == "{":
                        # A group opened at the domains level hides its members
                        # from a path-prefix scan; report it instead of guessing.
                        violations.append(
                            Violation(
                                EDGE_RULE,
                                relative,
                                lineno,
                                fingerprint(lines, lineno, "crate::domains::{"),
                                "grouped import at the domains level — expand it "
                                "into per-domain use statements so the fence can "
                                "see the edges",
                            )
                        )
                        continue
                    edge_ref(target, lineno, detail)
                for match in STORE_REF_RE.finditer(line):
                    store_ref(match.group(1), lineno, match.group(0), detail)

            # Statement pass: joined use statements, for the grouped forms the
            # per-line pass cannot see. The forms are disjoint from the per-line
            # matches (a `crate::{..}` group never contains the literal
            # `crate::domains::`, and a `<domain>::{..store..}` group never puts
            # `::store` directly after the domain), so nothing double-counts.
            for index, line in enumerate(stripped):
                if not USE_HEAD_RE.match(line):
                    continue
                statement = line
                cursor = index
                while ";" not in statement and cursor + 1 < len(stripped):
                    cursor += 1
                    statement += " " + stripped[cursor]
                    if cursor - index >= MAX_STATEMENT_LINES:
                        break
                lineno = index + 1
                detail = statement.strip()[:120]
                if re.search(r"crate\s*::\s*\{", statement):
                    for match in CRATE_GROUP_DOMAIN_RE.finditer(statement):
                        edge_ref(match.group(1), lineno, detail)
                    for match in CRATE_GROUP_STORE_RE.finditer(statement):
                        store_ref(
                            match.group(1),
                            lineno,
                            f"crate::domains::{match.group(1)}::store",
                            detail,
                        )
                for match in DOMAIN_GROUP_STORE_RE.finditer(statement):
                    store_ref(
                        match.group(1),
                        lineno,
                        f"crate::domains::{match.group(1)}::{{store}}",
                        detail,
                    )

    # Repeated identical anchors in one scope (e.g. two file-top use statements
    # of the same sibling store module) get occurrence ordinals so every site
    # keeps a distinct ledger fingerprint — the `#2` convention the anyharness
    # ledger already documents.
    seen_keys: dict[tuple[str, str, str], int] = {}
    numbered: list[Violation] = []
    for violation in violations:
        key = (violation.rule_id, violation.relative_path, violation.site)
        count = seen_keys.get(key, 0) + 1
        seen_keys[key] = count
        if count == 1:
            numbered.append(violation)
        else:
            numbered.append(
                Violation(
                    violation.rule_id,
                    violation.relative_path,
                    violation.lineno,
                    f"{violation.site}#{count}",
                    violation.detail,
                )
            )

    return ScanResult(numbered, baseline - edges_seen, edges_seen)


def apply_exceptions(
    violations: list[Violation],
) -> tuple[list[Violation], list[str]]:
    """Split violations into failures and report exception entries gone stale."""
    excused = RULES.exception_sites(STORE_RULE)
    failures = [
        violation
        for violation in violations
        if not (violation.rule_id == STORE_RULE and violation.key in excused)
    ]
    hit = {
        violation.key
        for violation in violations
        if violation.rule_id == STORE_RULE and violation.key in excused
    }
    stale = [
        f"lints/anyharness/exceptions.toml: stale entry for {STORE_RULE} — "
        f"({path}, {site}) no longer matches any site; remove the row"
        for (path, site) in sorted(excused - hit)
    ]
    return failures, stale


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warn",
        action="store_true",
        help="report violations without failing (non-blocking introduction mode)",
    )
    args = parser.parse_args(argv)

    result = collect_violations()
    failures, stale_entries = apply_exceptions(result.violations)
    stale_edge_reports = [
        f"lints/anyharness/fences.toml: stale [[edge]] {source} -> {target} — "
        f"no site references that domain edge any more; remove the row"
        for (source, target) in sorted(result.stale_edges)
    ]

    problems = len(failures) + len(stale_edge_reports) + len(stale_entries)
    if problems == 0:
        print(f"{CHECKER}: OK — fence baseline and ledger match reality exactly")
        return 0

    for violation in failures:
        print(violation.format())
        print()
    for report in stale_edge_reports + stale_entries:
        print(report)
    if args.warn:
        print(
            f"{CHECKER}: WARN MODE — {problems} problem(s) reported, not failing "
            f"(drop --warn to enforce)"
        )
        return 0
    print(f"{CHECKER}: {problems} problem(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
