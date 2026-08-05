#!/usr/bin/env python3

"""Prevent completed server path migrations from regaining compatibility shims."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

BLOCKED_PATHS = (
    "server/proliferate/utils/logging.py",
)


def existing_blocked_paths(repo_root: Path = REPO_ROOT) -> list[str]:
    return [path for path in BLOCKED_PATHS if (repo_root / path).exists()]


def main() -> int:
    existing_paths = existing_blocked_paths()
    if not existing_paths:
        print("Server old-path check passed.")
        return 0

    print("Completed server migrations must not resurrect old paths:")
    for path in existing_paths:
        print(f"  {path}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
