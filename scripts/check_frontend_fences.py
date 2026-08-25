#!/usr/bin/env python3
"""Product-client directory-fence checker.

The layer rules (`lints/frontend/product-client.toml`) govern the DIRECTION
imports may flow; this checker governs the EDGE SET: which top-level directory
of `apps/packages/product-client/src` may import which. One record under
`lints/frontend/fences.toml` owns the rule:

- FE-FENCE-001: a top-level directory may import another only along an edge
  declared in the `[[edge]]` baseline of the record file. The baseline is the
  measured directory→directory graph at fence introduction — permissive by
  construction, shrink-only afterwards (the Wave-4 re-fence ratchets it). A new
  edge and a stale baseline row are both failures, so the baseline always
  equals reality exactly.

`--warn` reports everything and exits 0: the non-blocking mode this checker
ships in while the cull-sweep waves move files underneath it.
"""

from __future__ import annotations

import argparse
import posixpath
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_frontend_fences.py` from the repo root,
    # sys.path[0] is scripts/ — the shared modules live one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)
from scripts.frontend_imports import collect_module_specifiers  # noqa: E402

CHECKER = "scripts/check_frontend_fences.py"
PC_SRC_RELATIVE = ("apps", "packages", "product-client", "src")
FENCES_RECORD_RELATIVE = ("lints", "frontend", "fences.toml")
EDGE_RULE = "FE-FENCE-001"
ALIAS_PREFIX = "#product/"
SELF_PACKAGE_PREFIX = "@proliferate/product-client/internal/"
SOURCE_SUFFIXES = {".ts", ".tsx"}

RULES = lint_records.load("frontend")


@dataclass(frozen=True)
class Violation:
    relative_path: str
    lineno: int
    site: str
    detail: str

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(EDGE_RULE),
            f"{self.relative_path}:{self.lineno}",
            self.detail,
        )


def load_edge_baseline(root: Path) -> set[tuple[str, str]]:
    """The declared directory→directory edge set from the fences record file."""
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


def resolve_target_top(
    specifier: str, source_dir: PurePosixPath, tops: set[str]
) -> str | None:
    """The top-level directory a specifier lands in, or None if it leaves src.

    Handles the three in-package spellings: the `#product/` alias, the
    self-package `@proliferate/product-client/internal/` subpath, and relative
    paths (normalized against the importing file's directory).
    """
    if specifier.startswith(ALIAS_PREFIX):
        segment = specifier[len(ALIAS_PREFIX) :].split("/", 1)[0]
        return segment if segment in tops else None
    if specifier.startswith(SELF_PACKAGE_PREFIX):
        segment = specifier[len(SELF_PACKAGE_PREFIX) :].split("/", 1)[0]
        return segment if segment in tops else None
    if specifier.startswith("."):
        normalized = posixpath.normpath((source_dir / specifier).as_posix())
        if normalized.startswith(".."):
            return None
        segment = normalized.split("/", 1)[0]
        return segment if segment in tops else None
    return None


@dataclass(frozen=True)
class ScanResult:
    violations: list[Violation]
    stale_edges: set[tuple[str, str]]
    edges_seen: set[tuple[str, str]]


def collect_violations(
    root: Path | None = None,
    baseline: set[tuple[str, str]] | None = None,
) -> ScanResult:
    """Scan product-client against the directory-edge baseline."""
    base = Path(root).resolve() if root is not None else REPO_ROOT
    src = base.joinpath(*PC_SRC_RELATIVE)
    if not src.is_dir():
        raise SystemExit(f"{CHECKER}: missing package tree {src}")
    if baseline is None:
        baseline = load_edge_baseline(base)
    tops = {entry.name for entry in src.iterdir() if entry.is_dir()}
    violations: list[Violation] = []
    edges_seen: set[tuple[str, str]] = set()

    for top in sorted(tops):
        for path in sorted((src / top).rglob("*")):
            if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
                continue
            relative = path.relative_to(base).as_posix()
            source_dir = PurePosixPath(path.relative_to(src).parent.as_posix())
            text = path.read_text(encoding="utf-8")
            for statement in collect_module_specifiers(path, text):
                target = resolve_target_top(statement.source, source_dir, tops)
                if target is None or target == top:
                    continue
                edges_seen.add((top, target))
                if (top, target) not in baseline:
                    violations.append(
                        Violation(
                            relative,
                            statement.lineno,
                            statement.source,
                            f"undeclared directory edge {top} -> {target}: "
                            f"import of {statement.source!r}",
                        )
                    )

    return ScanResult(violations, baseline - edges_seen, edges_seen)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warn",
        action="store_true",
        help="report violations without failing (non-blocking introduction mode)",
    )
    args = parser.parse_args(argv)

    result = collect_violations()
    violations = result.violations
    stale_edge_reports = [
        f"lints/frontend/fences.toml: stale [[edge]] {source} -> {target} — "
        f"no import crosses that directory edge any more; remove the row"
        for (source, target) in sorted(result.stale_edges)
    ]

    problems = len(violations) + len(stale_edge_reports)
    if problems == 0:
        print(f"{CHECKER}: OK — fence baseline matches reality exactly")
        return 0

    for violation in violations:
        print(violation.format())
        print()
    for report in stale_edge_reports:
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
