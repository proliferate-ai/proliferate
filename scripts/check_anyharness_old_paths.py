#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

BLOCKED_PATHS = [
    "anyharness/crates/anyharness-lib/src/sessions",
    "anyharness/crates/anyharness-lib/src/sessions.rs",
    "anyharness/crates/anyharness-lib/src/workspaces",
    "anyharness/crates/anyharness-lib/src/workspaces.rs",
    "anyharness/crates/anyharness-lib/src/repo_roots",
    "anyharness/crates/anyharness-lib/src/repo_roots.rs",
    "anyharness/crates/anyharness-lib/src/live/sessions/connection",
    "anyharness/crates/anyharness-lib/src/live/sessions/connection.rs",
    "anyharness/crates/anyharness-lib/src/adapters/git/branch_base.rs",
    "anyharness/crates/anyharness-lib/src/adapters/git/diff.rs",
    "anyharness/crates/anyharness-lib/src/adapters/git/operation.rs",
    "anyharness/crates/anyharness-lib/src/adapters/git/revert_patches.rs",
    "anyharness/crates/anyharness-lib/src/terminals",
    "anyharness/crates/anyharness-lib/src/terminals.rs",
    # Grid PR 2 moved the whole `acp/` module to `integrations/acp/`. Banning the
    # directory itself makes every previously-listed `src/acp/<sub>` entry from
    # the older manager/broker/actor split redundant -- none of those subpaths
    # (or a resurrected mod.rs) can exist without the parent directory existing
    # first -- so they are folded into this single entry rather than kept
    # alongside it.
    "anyharness/crates/anyharness-lib/src/acp",
]


def main() -> int:
    existing_paths = [path for path in BLOCKED_PATHS if (REPO_ROOT / path).exists()]
    if not existing_paths:
        print("AnyHarness old-path check passed.")
        return 0

    print("Completed AnyHarness splits must not resurrect old paths:")
    for path in existing_paths:
        print(f"  {path}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
