"""Per-harness legality of an agent-auth selection set (the ONE server validator).

Runs before ``put_auth_selections`` on every write endpoint (contract §2): it
gates the *enabled* set's cardinality per harness, the env-var name shape,
gateway capability, and the cursor "native only" rule. DB-coherence (source
shape, key ownership, duplicate sources) is the store's job; this is the
business layer.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from proliferate.constants.agent_gateway import (
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
)
from proliferate.db.store.agent_gateway.records import DesiredAuthSource

# Harnesses whose launch supports the gateway (virtual-key) recipe. Exactly the
# supported cloud harness kinds; cursor is absent (native login only).
GATEWAY_CAPABLE_HARNESSES = ("claude", "codex", "opencode", "grok")
# Radio harnesses: at most one enabled source (gateway XOR one api_key row).
SINGLE_SOURCE_HARNESSES = ("claude", "codex", "grok")
# Additive harnesses: gateway + any number of api_key rows may all be enabled.
MULTI_SOURCE_HARNESSES = ("opencode",)
# No source may target these; auth is the CLI's own login only.
NATIVE_ONLY_HARNESSES = ("cursor",)

ENV_VAR_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")


class SelectionRuleError(ValueError):
    """A desired selection set violates a per-harness legality rule."""


def validate_auth_selection_set(
    *,
    harness_kind: str,
    sources: Sequence[DesiredAuthSource],
) -> None:
    """Raise ``SelectionRuleError`` unless ``sources`` is legal for the harness."""
    if harness_kind in NATIVE_ONLY_HARNESSES:
        if sources:
            raise SelectionRuleError(
                f"Harness '{harness_kind}' takes no auth sources (native login only)."
            )
        return

    for source in sources:
        if source.source_kind == AGENT_AUTH_SOURCE_GATEWAY:
            if harness_kind not in GATEWAY_CAPABLE_HARNESSES:
                raise SelectionRuleError(
                    f"Harness '{harness_kind}' has no gateway recipe; "
                    "a gateway source is not allowed."
                )
        elif source.source_kind == AGENT_AUTH_SOURCE_API_KEY:
            name = source.env_var_name
            if name is None or ENV_VAR_NAME_RE.match(name) is None:
                raise SelectionRuleError(
                    f"Invalid env var name {name!r}: must match {ENV_VAR_NAME_RE.pattern}."
                )

    # Cardinality gates the ENABLED set only; disabled rows never launch.
    enabled = [source for source in sources if source.enabled]
    if harness_kind not in MULTI_SOURCE_HARNESSES and len(enabled) > 1:
        raise SelectionRuleError(
            f"Harness '{harness_kind}' allows at most one enabled auth source "
            f"(got {len(enabled)})."
        )
