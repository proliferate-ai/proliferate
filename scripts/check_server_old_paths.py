#!/usr/bin/env python3

"""Enforce SRV-PATHS-1: completed server path migrations stay closed.

The rule statement and rationale are canonical in lints/server/structure.toml
(see lints/README.md); this module is only the detection engine, and the
diagnostic is rendered from the record.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402 - repo-root bootstrap above

OLD_PATHS_RULE_ID = "SRV-PATHS-1"

BLOCKED_PATHS = ("server/proliferate/utils",)


def _contains_source(path: Path) -> bool:
    if not path.is_dir():
        return path.exists()
    return any(
        candidate.is_file() and "__pycache__" not in candidate.relative_to(path).parts
        for candidate in path.rglob("*")
    )


def existing_blocked_paths(repo_root: Path = REPO_ROOT) -> list[str]:
    return [path for path in BLOCKED_PATHS if _contains_source(repo_root / path)]


def main() -> int:
    existing_paths = existing_blocked_paths()
    if not existing_paths:
        print("Server old-path check passed.")
        return 0

    rule = lint_records.load("server").rule(OLD_PATHS_RULE_ID)
    print("Completed server migrations must not resurrect old paths:")
    for path in existing_paths:
        print(lint_records.render_diagnostic(rule, path, "path exists and contains source"))
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
