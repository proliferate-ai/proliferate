#!/usr/bin/env python3
"""Product-client directory-fence checker.

The layer rules (`lints/frontend/product-client.toml`) govern the DIRECTION
imports may flow; this checker governs the EDGE SET: which top-level directory
of `apps/packages/product-client/src` may import which. One record under
`lints/frontend/fences.toml` owns the rule:

- FE-FENCE-001: a top-level directory may import another only along an edge
  declared in the `[[edge]]` baseline of the record file. The baseline is the
  measured directory→directory graph at fence introduction — permissive by
  construction, shrink-only afterwards. A new edge and a stale baseline row
  are both failures, so the baseline always equals reality exactly.

- FE-FENCE-002: the cloud-compute gate tokens (`cloudActive`,
  `cloudComputeEnabled`) may appear only in non-test source files declared in
  the `[[cloud_gate_consumer]]` baseline of the same record file. The same
  regression — a control-plane feature wrongly coupled to the cloud-compute
  kill switch — was fixed four separate times (`shouldSyncLocalAuthState`,
  the settings `authGate`, #2133, IG-1); this rule makes the fifth attempt a
  visible amendment instead of a silent production outage. Comments and
  string literals do not count; test files are exempt (they mock the gate).

`--warn` reports everything and exits 0: the checker's non-blocking
introduction mode, dropped when the baseline is ready to enforce.
"""

from __future__ import annotations

import argparse
import posixpath
import re
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
from scripts.frontend_imports import (  # noqa: E402
    collect_module_specifiers,
    tokenize_typescript,
)

CHECKER = "scripts/check_frontend_fences.py"
PC_SRC_RELATIVE = ("apps", "packages", "product-client", "src")
FENCES_RECORD_RELATIVE = ("lints", "frontend", "fences.toml")
EDGE_RULE = "FE-FENCE-001"
GATE_RULE = "FE-FENCE-002"
# The cloud-compute gate tokens. `cloudActive = cloudComputeEnabled &&
# authenticated` folds in the CLOUD_COMPUTE_TEMPORARILY_DISABLED kill switch,
# so a control-plane feature that consumes either token is dead for every
# production user while the switch is on.
GATE_TOKEN_RE = re.compile(r"\b(cloudActive|cloudComputeEnabled)\b")
ALIAS_PREFIX = "#product/"
SELF_PACKAGE_PREFIX = "@proliferate/product-client/"
INTERNAL_SUBPATH = "internal/"
# The package's non-internal subpath exports and the src directory each ships
# from, per apps/packages/product-client/package.json "exports": ./host/* ships
# src/host/*, and both ./infra/* entries ship modules that live under src/lib/.
# ./ProductClient ships a src-root file, which is outside every top directory
# (src-root files are a known limit: the fence governs top-level directories
# only, and src/App.tsx + src/ProductClient.tsx sit above them).
SELF_EXPORT_TOPS = {"host": "host", "infra": "lib"}
# Gitignored build output under src/ (written by
# apps/packages/product-client/scripts/copy-product-client-assets.mjs). It is
# data, not a source directory, and it exists only on a built checkout — a
# top set that included it would differ between a developer machine and CI.
BUILD_OUTPUT_DIRS = {"generated"}
SOURCE_SUFFIXES = {".ts", ".tsx"}

RULES = lint_records.load("frontend")


@dataclass(frozen=True)
class Violation:
    relative_path: str
    lineno: int
    site: str
    detail: str
    rule_id: str = EDGE_RULE

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
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


def load_cloud_gate_baseline(root: Path) -> set[str]:
    """The declared cloud-gate consumer set (paths relative to src).

    Tolerates a missing record file (the fabricated trees in unit tests) —
    the edge loader on the same file already fails a real run loudly.
    """
    path = root.joinpath(*FENCES_RECORD_RELATIVE)
    if not path.is_file():
        return set()
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    consumers: set[str] = set()
    for entry in data.get("cloud_gate_consumer", []):
        if "path" not in entry:
            raise SystemExit(
                f"{CHECKER}: {path}: [[cloud_gate_consumer]] entry missing path: {entry}"
            )
        consumers.add(entry["path"])
    return consumers


def is_test_relative_path(src_relative: str) -> bool:
    """Test files may mock the gate tokens freely; the fence governs
    shipped source only."""
    parts = src_relative.split("/")
    name = parts[-1]
    return "__tests__" in parts or "test" in parts or ".test." in name or ".stories." in name


def code_only_lines(text: str, *, jsx: bool) -> list[str]:
    """The file's lines with comments and string literals blanked, so a
    token mention in a doc comment or a log key never counts as consumption."""
    masked = ["\n" if char == "\n" else " " for char in text]
    for token in tokenize_typescript(text, jsx=jsx):
        if token.kind == "string":
            continue
        masked[token.start : token.end] = text[token.start : token.end]
    return "".join(masked).splitlines()


def resolve_target_top(specifier: str, source_dir: PurePosixPath, tops: set[str]) -> str | None:
    """The top-level directory a specifier lands in, or None if it leaves src.

    Handles the in-package spellings: the `#product/` alias, the self-package
    `@proliferate/product-client/internal/*` subpath, the package's
    non-internal subpath exports (SELF_EXPORT_TOPS), and relative paths
    (normalized against the importing file's directory).
    """
    if specifier.startswith(ALIAS_PREFIX):
        segment = specifier[len(ALIAS_PREFIX) :].split("/", 1)[0]
        return segment if segment in tops else None
    if specifier.startswith(SELF_PACKAGE_PREFIX):
        subpath = specifier[len(SELF_PACKAGE_PREFIX) :]
        if subpath.startswith(INTERNAL_SUBPATH):
            segment = subpath[len(INTERNAL_SUBPATH) :].split("/", 1)[0]
            return segment if segment in tops else None
        segment = SELF_EXPORT_TOPS.get(subpath.split("/", 1)[0])
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
    stale_gate_consumers: set[str]
    gate_consumers_seen: set[str]


def collect_violations(
    root: Path | None = None,
    baseline: set[tuple[str, str]] | None = None,
    gate_baseline: set[str] | None = None,
) -> ScanResult:
    """Scan product-client against the directory-edge and cloud-gate baselines."""
    base = Path(root).resolve() if root is not None else REPO_ROOT
    src = base.joinpath(*PC_SRC_RELATIVE)
    if not src.is_dir():
        raise SystemExit(f"{CHECKER}: missing package tree {src}")
    if baseline is None:
        baseline = load_edge_baseline(base)
    if gate_baseline is None:
        gate_baseline = load_cloud_gate_baseline(base)
    tops = {
        entry.name
        for entry in src.iterdir()
        if entry.is_dir() and entry.name not in BUILD_OUTPUT_DIRS
    }
    violations: list[Violation] = []
    edges_seen: set[tuple[str, str]] = set()
    gate_consumers_seen: set[str] = set()

    for top in sorted(tops):
        for path in sorted((src / top).rglob("*")):
            if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
                continue
            relative = path.relative_to(base).as_posix()
            src_relative = path.relative_to(src).as_posix()
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

            if is_test_relative_path(src_relative):
                continue
            file_hits = False
            for lineno, line in enumerate(
                code_only_lines(text, jsx=path.suffix == ".tsx"), start=1
            ):
                match = GATE_TOKEN_RE.search(line)
                if match is None:
                    continue
                if not file_hits and src_relative not in gate_baseline:
                    violations.append(
                        Violation(
                            relative,
                            lineno,
                            match.group(0),
                            f"undeclared cloud-gate consumer: {match.group(0)!r} "
                            f"outside the [[cloud_gate_consumer]] baseline",
                            rule_id=GATE_RULE,
                        )
                    )
                file_hits = True
            if file_hits:
                gate_consumers_seen.add(src_relative)

    return ScanResult(
        violations,
        baseline - edges_seen,
        edges_seen,
        gate_baseline - gate_consumers_seen,
        gate_consumers_seen,
    )


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
    ] + [
        f"lints/frontend/fences.toml: stale [[cloud_gate_consumer]] {path} — "
        f"the file no longer consumes a cloud-gate token; remove the row"
        for path in sorted(result.stale_gate_consumers)
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
