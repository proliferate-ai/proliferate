#!/usr/bin/env python3

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKER_SRC = REPO_ROOT / "anyharness" / "crates" / "proliferate-worker" / "src"

BLOCKED_PATHS = (
    WORKER_SRC / "commands",
    WORKER_SRC / "sync",
    WORKER_SRC / "updates",
)

REQUIRED_FILES = (
    WORKER_SRC / "control" / "loop.rs",
    WORKER_SRC / "control" / "commands" / "executor.rs",
    WORKER_SRC / "control" / "commands" / "mapping.rs",
    WORKER_SRC / "control" / "reconcile" / "manager.rs",
    WORKER_SRC / "control" / "reconcile" / "handlers" / "exposures.rs",
    WORKER_SRC / "tail" / "loop.rs",
    WORKER_SRC / "tail" / "cursors.rs",
    WORKER_SRC / "tail" / "mapping.rs",
    WORKER_SRC / "tail" / "backfill.rs",
    WORKER_SRC / "lifecycle" / "heartbeat.rs",
    WORKER_SRC / "lifecycle" / "self_update.rs",
    WORKER_SRC / "lifecycle" / "supervisor_mailbox.rs",
    WORKER_SRC / "store" / "applied_revisions.rs",
    WORKER_SRC / "store" / "connection.rs",
    WORKER_SRC / "store" / "exposure_cache.rs",
    WORKER_SRC / "store" / "identity.rs",
    WORKER_SRC / "store" / "migrations.rs",
    WORKER_SRC / "store" / "pending_command_results.rs",
    WORKER_SRC / "store" / "tail_mappings.rs",
    WORKER_SRC / "store" / "up_cursor.rs",
)

BLOCKED_IMPORT_RE = re.compile(r"\bcrate::(?:commands|sync|updates)\b")
BLOCKED_ROOT_MOD_RE = re.compile(r"^\s*mod\s+(?:commands|sync|updates)\s*;")


def main() -> int:
    violations: list[str] = []
    for path in BLOCKED_PATHS:
        if path.exists():
            violations.append(path.relative_to(REPO_ROOT).as_posix())
    for path in REQUIRED_FILES:
        if not path.is_file():
            relative = path.relative_to(REPO_ROOT).as_posix()
            violations.append(f"{relative}: required worker structure file missing")

    for path in sorted(WORKER_SRC.rglob("*.rs")):
        text = path.read_text()
        for lineno, line in enumerate(text.splitlines(), start=1):
            if BLOCKED_IMPORT_RE.search(line):
                relative = path.relative_to(REPO_ROOT).as_posix()
                violations.append(f"{relative}:{lineno}: old worker top-level module import")

    main_rs = WORKER_SRC / "main.rs"
    for lineno, line in enumerate(main_rs.read_text().splitlines(), start=1):
        if BLOCKED_ROOT_MOD_RE.search(line):
            relative = main_rs.relative_to(REPO_ROOT).as_posix()
            violations.append(f"{relative}:{lineno}: old worker top-level module declaration")

    if not violations:
        print("Proliferate Worker structure check passed.")
        return 0

    print("Proliferate Worker code must use control/, tail/, and lifecycle/ paths:")
    for violation in violations:
        print(f"  {violation}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
