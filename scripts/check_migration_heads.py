#!/usr/bin/env python3
"""Enforce the Alembic history rules recorded as SRV-MIGRATE-2/3/4.

The rule statements and rationales are canonical in lints/server/migrations.toml
(see lints/README.md); this module is only the detection engine, and every
diagnostic is rendered from the record through ``lint_records.render_diagnostic``.

Parses revision graphs with ast (no alembic import, no server deps), so it runs
in the repo-shape job.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402 - repo-root bootstrap above

VERSIONS_DIR = REPO_ROOT / "server" / "alembic" / "versions"

REVISION_ID_RULE_ID = "SRV-MIGRATE-2"
DOWN_REVISION_RULE_ID = "SRV-MIGRATE-3"
SINGLE_HEAD_RULE_ID = "SRV-MIGRATE-4"


def _relative(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


_RULESET: lint_records.RuleSet | None = None


def _ruleset() -> lint_records.RuleSet:
    global _RULESET
    if _RULESET is None:
        _RULESET = lint_records.load("server")
    return _RULESET


def _report(rule_id: str, location: str, detail: str) -> None:
    diagnostic = lint_records.render_diagnostic(_ruleset().rule(rule_id), location, detail)
    print(diagnostic, file=sys.stderr)


def _module_constant(tree: ast.Module, name: str) -> object:
    """The literal assigned to a module-level variable, or None if absent."""
    for node in tree.body:
        targets: list[ast.expr] = []
        value: ast.expr | None = None
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        for target in targets:
            if isinstance(target, ast.Name) and target.id == name:
                try:
                    return ast.literal_eval(value)
                except ValueError:
                    return None
    return None


def _parents(value: object) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        return {value}
    if isinstance(value, (tuple, list)):
        return {item for item in value if isinstance(item, str)}
    return set()


def main() -> int:
    revisions: dict[str, Path] = {}
    referenced_parents: set[str] = set()

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        revision = _module_constant(tree, "revision")
        if not isinstance(revision, str):
            _report(
                REVISION_ID_RULE_ID,
                _relative(path),
                "no parseable module-level revision id",
            )
            return 1
        if revision in revisions:
            _report(
                REVISION_ID_RULE_ID,
                _relative(path),
                f"revision id {revision} is already declared by {_relative(revisions[revision])}",
            )
            return 1
        revisions[revision] = path
        referenced_parents |= _parents(_module_constant(tree, "down_revision"))

    unknown = referenced_parents - set(revisions)
    if unknown:
        _report(
            DOWN_REVISION_RULE_ID,
            "server/alembic/versions",
            "down_revision points at unknown revision id(s): " + ", ".join(sorted(unknown)),
        )
        return 1

    heads = sorted(set(revisions) - referenced_parents)
    if len(heads) != 1:
        detail = f"{len(heads)} head revisions: " + ", ".join(
            f"{head} ({revisions[head].name})" for head in heads
        )
        _report(SINGLE_HEAD_RULE_ID, "server/alembic/versions", detail)
        return 1

    print(f"Migration head check passed ({len(revisions)} revisions, head {heads[0]}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
