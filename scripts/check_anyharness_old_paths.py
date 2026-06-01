#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

BLOCKED_PATHS = [
    "anyharness/crates/anyharness-lib/src/sessions/mcp.rs",
    "anyharness/crates/anyharness-lib/src/sessions/runtime.rs",
    "anyharness/crates/anyharness-lib/src/sessions/store.rs",
    "anyharness/crates/anyharness-lib/src/terminals",
    "anyharness/crates/anyharness-lib/src/acp/background_work",
    "anyharness/crates/anyharness-lib/src/acp/event_sink",
    "anyharness/crates/anyharness-lib/src/acp/event_sink.rs",
    "anyharness/crates/anyharness-lib/src/acp/manager.rs",
    "anyharness/crates/anyharness-lib/src/acp/mcp_elicitation",
    "anyharness/crates/anyharness-lib/src/acp/permission_broker",
    "anyharness/crates/anyharness-lib/src/acp/permission_broker.rs",
    "anyharness/crates/anyharness-lib/src/acp/replay_actor.rs",
    "anyharness/crates/anyharness-lib/src/acp/runtime_client.rs",
    "anyharness/crates/anyharness-lib/src/acp/session_actor.rs",
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
