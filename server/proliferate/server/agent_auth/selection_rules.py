"""Per-harness legality of an agent-auth selection set (the ONE server validator).

Runs before ``put_auth_selections`` on every write endpoint (contract §2): it
gates the *enabled* set's cardinality per harness, the env-var name shape, and
gateway capability. DB-coherence (source shape, key ownership, duplicate
sources) is the store's job; this is the business layer.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from proliferate.constants.agent_gateway import (
    AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS,
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
)
from proliferate.db.store.agent_gateway.records import DesiredAuthSource

# Re-exported for existing importers; the canonical tuple lives in
# constants/agent_gateway.py so db/store can consult it too without violating
# the store→server import boundary (check_server_boundaries.py). cursor is
# absent — it has no gateway recipe (agent-auth.md's per-harness recipe
# table: "typed refusal, no gateway route exists for cursor") and stays
# native-for-the-gateway per R13, but it DOES take an api_key source (its
# CURSOR_API_KEY slot) same as any other single-source harness — see
# SINGLE_SOURCE_HARNESSES below.
GATEWAY_CAPABLE_HARNESSES = AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS
# Radio harnesses: at most one enabled source (gateway XOR one api_key row).
# cursor's radio can only ever land on api_key (no gateway row is legal for
# it — enforced below via GATEWAY_CAPABLE_HARNESSES), never a true XOR with
# gateway, but the cardinality rule (at most one enabled source) still applies.
SINGLE_SOURCE_HARNESSES = ("claude", "codex", "grok", "cursor")
# Additive harnesses: gateway + any number of api_key rows may all be enabled.
MULTI_SOURCE_HARNESSES = ("opencode",)

ENV_VAR_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")


class SelectionRuleError(ValueError):
    """A desired selection set violates a per-harness legality rule."""


def validate_auth_selection_set(
    *,
    harness_kind: str,
    sources: Sequence[DesiredAuthSource],
) -> None:
    """Raise ``SelectionRuleError`` unless ``sources`` is legal for the harness."""
    for source in sources:
        if source.source_kind == AGENT_AUTH_SOURCE_GATEWAY:
            if harness_kind not in GATEWAY_CAPABLE_HARNESSES:
                raise SelectionRuleError(
                    f"Harness '{harness_kind}' has no gateway recipe; "
                    "a gateway source is not allowed."
                )
        elif source.source_kind == AGENT_AUTH_SOURCE_API_KEY:
            # env_var_name is optional at this layer: a source referencing a
            # TYPED vault entry (aws_bedrock/azure_openai) carries none by law
            # (the typed kind brings its own env mapping), and only the store
            # can see which vault kind the id references — it enforces
            # bare-requires-one / typed-forbids-one there. This validator only
            # gates the SHAPE of a name when one is supplied.
            name = source.env_var_name
            if name is not None and ENV_VAR_NAME_RE.match(name) is None:
                raise SelectionRuleError(
                    f"Invalid env var name {name!r}: must match {ENV_VAR_NAME_RE.pattern}."
                )
            # The retired env-passthrough form (agent_auth spec ruling,
            # decision "Does env-var passthrough survive as a method?" —
            # deleted): a selection naming an env var WITHOUT a vault row,
            # meaning "use whatever value the machine's own environment holds
            # for that name". First-class plain-words rejection here — THE
            # validator — so the write path refuses it by name instead of the
            # store's generic shape error. The store's write gate and the
            # ck_agent_auth_selection_api_key_shape CHECK stay behind it as
            # the DB-coherence belt; the cleanup migration
            # (retire_env_passthrough_selections) removed any stored rows.
            if source.api_key_id is None:
                named = f"Naming the environment variable {name!r} alone" if name else "Naming an environment variable alone"
                raise SelectionRuleError(
                    f"{named} isn't supported anymore — the machine's own value "
                    "never reaches the launch. Save the key itself and select "
                    "it in the harness's Authentication section."
                )

    # Cardinality gates the ENABLED set only; disabled rows never launch.
    enabled = [source for source in sources if source.enabled]
    if harness_kind not in MULTI_SOURCE_HARNESSES and len(enabled) > 1:
        raise SelectionRuleError(
            f"Harness '{harness_kind}' allows at most one enabled auth source "
            f"(got {len(enabled)})."
        )
