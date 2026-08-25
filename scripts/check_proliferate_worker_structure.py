#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402

RULES = lint_records.load("anyharness")

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
)

BLOCKED_IMPORT_RE = re.compile(r"\bcrate::(?:commands|sync|updates|control|tail|inventory)\b")
BLOCKED_ROOT_MOD_RE = re.compile(r"^\s*mod\s+(?:commands|sync|updates|control|tail|inventory)\s*;")


def diagnostic(rule_id: str, location: str, detail: str) -> str:
    return lint_records.render_diagnostic(RULES.rule(rule_id), location, detail)


def main() -> int:
    violations: list[str] = []
    for path in BLOCKED_PATHS:
        if path.exists():
            violations.append(
                diagnostic(
                    "AH-WORKER-1",
                    path.relative_to(REPO_ROOT).as_posix(),
                    "retired worker path exists again",
                )
            )
    for path in REQUIRED_FILES:
        if not path.is_file():
            violations.append(
                diagnostic(
                    "AH-WORKER-2",
                    path.relative_to(REPO_ROOT).as_posix(),
                    "required worker structure file missing",
                )
            )

    for path in sorted(WORKER_SRC.rglob("*.rs")):
        text = path.read_text()
        relative = path.relative_to(REPO_ROOT).as_posix()
        for lineno, line in enumerate(text.splitlines(), start=1):
            match = BLOCKED_IMPORT_RE.search(line)
            if match:
                violations.append(
                    diagnostic("AH-WORKER-3", f"{relative}:{lineno}", match.group(0))
                )

    main_rs = WORKER_SRC / "main.rs"
    main_relative = main_rs.relative_to(REPO_ROOT).as_posix()
    for lineno, line in enumerate(main_rs.read_text().splitlines(), start=1):
        match = BLOCKED_ROOT_MOD_RE.search(line)
        if match:
            violations.append(
                diagnostic(
                    "AH-WORKER-4", f"{main_relative}:{lineno}", match.group(0).strip()
                )
            )

    if not violations:
        print("Proliferate Worker structure check passed.")
        return 0

    for violation in violations:
        print(violation)
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
