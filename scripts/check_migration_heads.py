#!/usr/bin/env python3
"""Fail when the alembic migration history has more than one head.

Parallel PR stacks each adding a migration off the same parent fork the
history; `alembic upgrade head` then fails everywhere (dev `make run`,
staging deploys, self-host bootstraps) with "Multiple head revisions".
This check catches the fork on the PR that would create it: the pull
request checkout is the merge commit, so a PR based on a stale main sees
both its own migration and the one that landed in the meantime.

Parses revision graphs with ast (no alembic import, no server deps), so it
runs in the repo-shape job. Fix a failure with either a merge revision
(`alembic merge heads`, when some environments may already have applied a
subset) or by re-parenting the unshipped migration onto the other head.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "server" / "alembic" / "versions"


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
            print(f"Could not parse a revision id from {path}", file=sys.stderr)
            return 1
        if revision in revisions:
            print(
                f"Duplicate revision id {revision} in {path} and {revisions[revision]}",
                file=sys.stderr,
            )
            return 1
        revisions[revision] = path
        referenced_parents |= _parents(_module_constant(tree, "down_revision"))

    unknown = referenced_parents - set(revisions)
    if unknown:
        print(
            "down_revision points at unknown revision id(s): " + ", ".join(sorted(unknown)),
            file=sys.stderr,
        )
        return 1

    heads = sorted(set(revisions) - referenced_parents)
    if len(heads) != 1:
        print(
            f"Expected exactly one alembic head, found {len(heads)}:",
            file=sys.stderr,
        )
        for head in heads:
            print(f"  {head} ({revisions[head].name})", file=sys.stderr)
        print(
            "\nParallel migrations forked the history. Rejoin it with a merge "
            "revision (cd server && alembic merge heads -m '...') or re-parent "
            "your unshipped migration onto the other head.",
            file=sys.stderr,
        )
        return 1

    print(f"Migration head check passed ({len(revisions)} revisions, head {heads[0]}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
