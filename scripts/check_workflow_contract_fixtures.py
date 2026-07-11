#!/usr/bin/env python3
"""Cross-language workflow contract fixture check (T1-WF-CONTRACT-01).

Exercises the shared golden fixtures under `tests/contracts/workflows/fixtures`
in all three contract languages and fails loudly on any drift:

  1. Python  — `uv run python -m proliferate.server.cloud.workflows.contracts.verify`
  2. Rust    — `cargo test -p anyharness-contract workflow_contract_fixtures`
  3. TypeScript — vitest over the product-domain contract test

Each language owns the strict parse/serialize round-trip for every fixture;
Python and TypeScript additionally recompute the RFC 8785 + SHA-256
plan/binding/checkpoint hashes and the deterministic legacy UUIDv5, so the
canonical bytes are proven identical across implementations. Any nonzero leg
fails the whole check.

Usage: python3 scripts/check_workflow_contract_fixtures.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


class Leg:
    def __init__(self, name: str, cmd: list[str], cwd: Path, env: dict[str, str] | None = None):
        self.name = name
        self.cmd = cmd
        self.cwd = cwd
        self.env = env


def _legs() -> list[Leg]:
    import os

    py_env = dict(os.environ)
    # The server settings loader requires debug mode outside production.
    py_env.setdefault("DEBUG", "true")
    return [
        Leg(
            "python",
            [
                "uv",
                "run",
                "python",
                "-m",
                "proliferate.server.cloud.workflows.contracts.verify",
            ],
            REPO_ROOT / "server",
            py_env,
        ),
        Leg(
            "rust",
            [
                "cargo",
                "test",
                "-p",
                "anyharness-contract",
                "workflow_contract_fixtures",
            ],
            REPO_ROOT,
        ),
        Leg(
            "typescript",
            [
                "pnpm",
                "--filter",
                "@proliferate/product-domain",
                "exec",
                "vitest",
                "run",
                "src/workflows/contracts/contracts.test.ts",
            ],
            REPO_ROOT,
        ),
    ]


def main() -> int:
    failures: list[str] = []
    for leg in _legs():
        print(f"\n=== workflow contract check: {leg.name} ===", flush=True)
        print(f"$ {' '.join(leg.cmd)}  (cwd={leg.cwd})", flush=True)
        result = subprocess.run(leg.cmd, cwd=leg.cwd, env=leg.env)
        if result.returncode != 0:
            failures.append(leg.name)

    print("\n=== summary ===", flush=True)
    if failures:
        print(f"FAILED legs: {', '.join(failures)}", file=sys.stderr, flush=True)
        return 1
    print("all three languages parse/serialize/hash the workflow contract fixtures identically")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
