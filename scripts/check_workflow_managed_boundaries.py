#!/usr/bin/env python3
"""Enforce SRV-WFLOW-1/2: managed Workflows stay off the legacy Cloud planes.

The rule statements and rationales are canonical in lints/server/structure.toml
(see lints/README.md); this module is only the detection engine, and every
diagnostic is rendered from the record.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

WORKFLOWS_ROOT = REPO_ROOT / "server" / "proliferate" / "server" / "workflows"

MODULE_RULE_ID = "SRV-WFLOW-1"
SYMBOL_RULE_ID = "SRV-WFLOW-2"
FORBIDDEN_MODULE_PREFIXES = (
    "proliferate.db.models.cloud.sync",
    "proliferate.db.store.cloud_sync",
    "proliferate.db.store.support_session_diagnostics",
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

    # Imported after the 3.12 re-exec above: the loader needs tomllib.
    from scripts import lint_records

    ruleset = lint_records.load("server")
    # (rule_id, "path:lineno", detail) — deduped and ordered below.
    failures: set[tuple[str, str, str]] = set()
    for path in sorted(WORKFLOWS_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        relative = path.relative_to(REPO_ROOT)
        for node in ast.walk(tree):
            module = None
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith(FORBIDDEN_MODULE_PREFIXES):
                        failures.add(
                            (MODULE_RULE_ID, f"{relative}:{node.lineno}", f"import {alias.name}")
                        )
            if module and module.startswith(FORBIDDEN_MODULE_PREFIXES):
                failures.add((MODULE_RULE_ID, f"{relative}:{node.lineno}", f"from {module}"))
            if isinstance(node, ast.Name) and node.id in FORBIDDEN_SYMBOLS:
                failures.add((SYMBOL_RULE_ID, f"{relative}:{node.lineno}", node.id))
    if failures:
        print("Managed Workflow legacy-plane boundary violations:")
        for rule_id, location, detail in sorted(failures, key=lambda item: (item[1], item[0])):
            print(lint_records.render_diagnostic(ruleset.rule(rule_id), location, detail))
            print()
        return 1
    print("Managed Workflow legacy-plane boundary check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
