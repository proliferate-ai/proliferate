#!/usr/bin/env python3

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKER_SRC = REPO_ROOT / "anyharness" / "crates" / "proliferate-worker" / "src"

# The worker is deliberately slim post gateway-token rebuild: enroll once,
# write the integration-gateway dotfile, heartbeat. The old command/tail/
# reconcile/update machinery must not return.
BLOCKED_PATHS = (
    WORKER_SRC / "commands",
    WORKER_SRC / "sync",
    WORKER_SRC / "updates",
    WORKER_SRC / "control",
    WORKER_SRC / "tail",
    WORKER_SRC / "inventory.rs",
)

REQUIRED_FILES = (
    WORKER_SRC / "cloud_client" / "mod.rs",
    WORKER_SRC / "cloud_client" / "auth.rs",
    WORKER_SRC / "cloud_client" / "heartbeat.rs",
    WORKER_SRC / "identity" / "mod.rs",
    WORKER_SRC / "identity" / "credentials.rs",
    WORKER_SRC / "identity" / "enrollment.rs",
    WORKER_SRC / "identity" / "fingerprint.rs",
    WORKER_SRC / "integration_gateway.rs",
    WORKER_SRC / "lifecycle" / "heartbeat.rs",
    WORKER_SRC / "store" / "connection.rs",
    WORKER_SRC / "store" / "identity.rs",
    WORKER_SRC / "store" / "migrations.rs",
    WORKER_SRC / "config.rs",
    WORKER_SRC / "process_lock.rs",
    WORKER_SRC / "runtime.rs",
    WORKER_SRC / "self_update.rs",
)

BLOCKED_IMPORT_RE = re.compile(r"\bcrate::(?:commands|sync|updates|control|tail|inventory)\b")
BLOCKED_ROOT_MOD_RE = re.compile(r"^\s*mod\s+(?:commands|sync|updates|control|tail|inventory)\s*;")


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
