#!/usr/bin/env python3
"""Server domain fence checker.

The layer checker (`check_server_boundaries.py`) governs which LAYERS may
import which; this checker governs which modules may import the FENCED server
systems. One record under `lints/server/fences.toml` owns the rule:

- SRV-FENCE-001: a module may import a fenced server system (the systems named
  under the record file's `[fence]` table) only along a from→to edge declared
  in the `[[edge]]` baseline. The baseline is the measured importer→system
  graph at fence introduction — permissive by construction, shrink-only
  afterwards. A new edge and a stale baseline row are both failures, so the
  baseline always equals reality exactly. Systems not named under `[fence]`
  are unfenced and never reported.

References are measured over `server/proliferate/**` (the shipped package;
`server/tests/` is outside it) as absolute `proliferate.server.<system>`
IMPORTS — the import style the server standards mandate. String-dotted
references (monkeypatch targets and the like) are deliberately out of scope:
this fence governs the import graph, not string literals. An importer's label
follows `scripts/check_manifests.py`'s `importer_label()`: the top-level
domain under server/ (`billing`), `cloud/<sub>` for the cloud subsystems, the
bare filename for package-root modules (`main.py`), or the first path segment
for code outside server/ (`background`, `integrations`).

`--warn` reports everything and exits 0: the non-blocking introduction mode
the sibling fence checkers share. This fence ships enforcing.
"""

from __future__ import annotations

import argparse
import ast
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_server_fences.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_server_fences.py"
PACKAGE_RELATIVE = ("server", "proliferate")
FENCES_RECORD_RELATIVE = ("lints", "server", "fences.toml")
EDGE_RULE = "SRV-FENCE-001"
FENCED_MODULE_PREFIX = "proliferate.server"

RULES = lint_records.load("server")


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


def load_fence_config(root: Path) -> tuple[tuple[str, ...], set[tuple[str, str]]]:
    """The fenced-system list and declared edge set from the record file."""
    path = root.joinpath(*FENCES_RECORD_RELATIVE)
    if not path.is_file():
        raise SystemExit(f"{CHECKER}: missing fence record {path}")
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    systems = tuple(data.get("fence", {}).get("systems", []))
    if not systems:
        raise SystemExit(
            f"{CHECKER}: {path}: [fence] must name at least one fenced system (systems = [...])"
        )
    edges: set[tuple[str, str]] = set()
    for entry in data.get("edge", []):
        missing = [key for key in ("from", "to") if key not in entry]
        if missing:
            raise SystemExit(
                f"{CHECKER}: {path}: [[edge]] entry missing {', '.join(missing)}: {entry}"
            )
        edges.add((entry["from"], entry["to"]))
    return systems, edges


def importer_label(relative_to_package: Path) -> str:
    """The importer label for a file under server/proliferate/.

    Same semantics as scripts/check_manifests.py's importer_label(), so the
    fence baseline and the manifests' allowed_importers speak one vocabulary.
    """
    parts = relative_to_package.parts
    if parts[0] == "server":
        if len(parts) == 2:
            return parts[1]  # package-root module of the server subpackage
        if parts[1] == "cloud" and len(parts) >= 3 and not parts[2].endswith(".py"):
            return f"cloud/{parts[2]}"
        return parts[1]
    return parts[0]


def fenced_system_for(module: str, systems: tuple[str, ...]) -> str | None:
    """The fenced system `module` belongs to, or None."""
    for system in systems:
        prefix = f"{FENCED_MODULE_PREFIX}.{system}"
        if module == prefix or module.startswith(prefix + "."):
            return system
    return None


def imported_fenced_modules(
    tree: ast.Module, systems: tuple[str, ...]
) -> list[tuple[int, str, str]]:
    """Every fenced-system import in `tree` as (lineno, module, system).

    Covers `import proliferate.server.<sys>[...]`, `from
    proliferate.server.<sys>[...] import x`, and `from proliferate.server
    import <sys>`. Relative imports are out of scope — the server standards
    mandate absolute imports, and the tree carries no parent-relative ones.
    """
    references: list[tuple[int, str, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                system = fenced_system_for(alias.name, systems)
                if system is not None:
                    references.append((node.lineno, alias.name, system))
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            module = node.module or ""
            system = fenced_system_for(module, systems)
            if system is not None:
                references.append((node.lineno, module, system))
            elif module == FENCED_MODULE_PREFIX:
                for alias in node.names:
                    if alias.name in systems:
                        references.append(
                            (
                                node.lineno,
                                f"{FENCED_MODULE_PREFIX}.{alias.name}",
                                alias.name,
                            )
                        )
    return references


@dataclass(frozen=True)
class ScanResult:
    violations: list[Violation]
    stale_edges: set[tuple[str, str]]
    edges_seen: set[tuple[str, str]]


def collect_violations(
    root: Path | None = None,
    baseline: set[tuple[str, str]] | None = None,
    systems: tuple[str, ...] | None = None,
) -> ScanResult:
    """Scan the server package against the fenced-system edge baseline."""
    base = Path(root).resolve() if root is not None else REPO_ROOT
    package_root = base.joinpath(*PACKAGE_RELATIVE)
    if not package_root.is_dir():
        raise SystemExit(f"{CHECKER}: missing server package {package_root}")
    if baseline is None or systems is None:
        loaded_systems, loaded_edges = load_fence_config(base)
        systems = systems if systems is not None else loaded_systems
        baseline = baseline if baseline is not None else loaded_edges

    violations: list[Violation] = []
    edges_seen: set[tuple[str, str]] = set()

    for path in sorted(package_root.rglob("*.py")):
        relative_to_package = path.relative_to(package_root)
        if "__pycache__" in relative_to_package.parts:
            continue
        relative = path.relative_to(base).as_posix()
        text = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError as error:
            raise SystemExit(f"{CHECKER}: {relative}: {error}") from None
        references = imported_fenced_modules(tree, systems)
        if not references:
            continue
        label = importer_label(relative_to_package)
        lines = text.splitlines()
        for lineno, module, system in references:
            if label == system:
                continue  # a fenced system's own files are not an edge
            edges_seen.add((label, system))
            if (label, system) in baseline:
                continue
            source_line = ""
            if 1 <= lineno <= len(lines):
                source_line = lines[lineno - 1].strip()[:120]
            violations.append(
                Violation(
                    EDGE_RULE,
                    relative,
                    lineno,
                    f"{relative}::{module}",
                    f"undeclared fence edge {label} -> {system}: {source_line}",
                )
            )

    # Repeated identical sites in one file (e.g. two imports of the same fenced
    # module) get occurrence ordinals so every site keeps a distinct
    # fingerprint — the `#2` convention the sibling fence checkers use.
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warn",
        action="store_true",
        help="report violations without failing (non-blocking introduction mode)",
    )
    args = parser.parse_args(argv)

    result = collect_violations()
    stale_edge_reports = [
        f"lints/server/fences.toml: stale [[edge]] {source} -> {target} — "
        f"no import crosses that edge any more; remove the row"
        for (source, target) in sorted(result.stale_edges)
    ]

    problems = len(result.violations) + len(stale_edge_reports)
    if problems == 0:
        print(f"{CHECKER}: OK — fence baseline matches reality exactly")
        return 0

    for violation in result.violations:
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
