#!/usr/bin/env python3

"""Enforce FE-PATHS-1: completed frontend path migrations stay closed.

The rule statement and rationale are canonical in lints/frontend/structure.toml
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

OLD_PATHS_RULE_ID = "FE-PATHS-1"

PRODUCT_CLIENT = "apps/packages/product-client/src"

BLOCKED_PATHS = (
    # agent_auth slice 3, the client-side derivation of auth truth. The runtime's
    # per-harness status document is the single source and the panes render it
    # verbatim, so a second projection of "what the state means" is the
    # four-sources-of-truth bug coming back. Each path below held a piece of that
    # projection and was deleted with it:
    #
    # the derived evidence summary (isEvidenceGreen, the next-action fold).
    f"{PRODUCT_CLIENT}/lib/domain/settings/agent-auth-evidence.ts",
    # deriveAuthStatus / deriveProvidersStatus — the readiness + cliAuthState
    # fallback ladder itself, and opencode's unconditional green.
    f"{PRODUCT_CLIENT}/components/settings/panes/agents/harness/HarnessAuthStatusBadge.tsx",
    # the client-side rotation projection (the document carries `rotate`,
    # `next_seat_id`, and `cooling_until`; nothing re-derives them).
    f"{PRODUCT_CLIENT}/lib/domain/settings/agent-auth-rotation.ts",
    # the `agentAuthEvidencePanes` flag's module: a flag that chooses between the
    # document and a derivation is the derivation, kept switchable.
    f"{PRODUCT_CLIENT}/config/feature-flags.ts",
    # the ~20s grace-window onboarding step. "The onboarding card is state-bound,
    # never timed" (spec §4 cell 4): a timer that advances the card is a second,
    # invisible source of "setup finished".
    f"{PRODUCT_CLIENT}/hooks/agents/lifecycle/use-auth-setup-onboarding-step.ts",
)


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
        print("Frontend old-path check passed.")
        return 0

    rule = lint_records.load("frontend").rule(OLD_PATHS_RULE_ID)
    print("Completed frontend migrations must not resurrect old paths:")
    for path in existing_paths:
        print(lint_records.render_diagnostic(rule, path, "path exists and contains source"))
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
