#!/usr/bin/env python3
"""Keep managed Workflows off legacy Cloud command/session/event planes."""

from __future__ import annotations

import ast
import os
from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS_ROOT = REPO_ROOT / "server" / "proliferate" / "server" / "workflows"
FORBIDDEN_MODULE_PREFIXES = (
    "proliferate.db.models.cloud.sync",
    "proliferate.db.store.cloud_sync",
    "proliferate.db.store.support_session_diagnostics",
    "proliferate.server.automations.worker.cloud_execution",
    "proliferate.server.automations.worker.cloud_executor_commands",
    "proliferate.server.cloud.commands",
    "proliferate.server.cloud.gateway.proxy",
)
FORBIDDEN_SYMBOLS = {
    "CloudCommandKind",
    "CloudCommandSnapshot",
    "CloudSessionEvent",
    "CloudSessionProjection",
    "CloudTranscriptItem",
}


def main() -> int:
    if sys.version_info < (3, 12):
        python_312 = shutil.which("python3.12")
        if python_312 is None:
            print("Managed Workflow boundary check requires Python 3.12+.")
            return 2
        os.execv(python_312, [python_312, *sys.argv])
    failures: list[str] = []
    for path in sorted(WORKFLOWS_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            module = None
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith(FORBIDDEN_MODULE_PREFIXES):
                        failures.append(f"{path.relative_to(REPO_ROOT)}:{node.lineno}")
            if module and module.startswith(FORBIDDEN_MODULE_PREFIXES):
                failures.append(f"{path.relative_to(REPO_ROOT)}:{node.lineno}")
            if isinstance(node, ast.Name) and node.id in FORBIDDEN_SYMBOLS:
                failures.append(f"{path.relative_to(REPO_ROOT)}:{node.lineno}")
    if failures:
        print("Managed Workflow legacy-plane boundary violations:")
        for failure in sorted(set(failures)):
            print(f"  {failure}")
        return 1
    print("Managed Workflow legacy-plane boundary check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
