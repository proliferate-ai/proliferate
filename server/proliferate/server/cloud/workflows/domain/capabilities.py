"""Pure ``CapabilityRef`` value objects + the canonical ``capability_key`` codec.

WS3a freezes exact capabilities per run+slot at StartRun (feature spec §7.1). An
exact ``CapabilityRef`` is a tagged union — the same shape the WS1 golden
``resolved-plan-v2`` fixture pins:

    {"kind":"integration_tool","providerDefinitionId":...,"providerRevision":...,
     "toolName":...,"inputSchemaHash":"sha256:..."}
    {"kind":"function","definitionId":...,"semanticRevision":3}
    {"kind":"product_mcp","definition":"workflow_peer","policyRevision":1}

This module is deliberately free of FastAPI/DB/HTTP: it is the pure identity
layer both the StartRun resolver (``capability_resolution.py``) and the live
authorization seam (``capability_authz.py``) share.

**canonical ``capability_key`` format** (WS3a defines it; also documented in the
store module ``db/store/workflow_ledger/gateway.py``):

    integration_tool:<providerDefinitionId>:<providerRevision>:<toolName>
    function:<definitionId>:<semanticRevision>
    product_mcp:<definition>:<policyRevision>

Every non-``kind`` component is percent-quoted (``safe=""``) before joining on
``:`` so a component that itself contains a colon (e.g. a timestamp-shaped
``providerRevision``) round-trips unambiguously. ``inputSchemaHash`` is NOT part
of the key: it is carried alongside for audit and MAY be the explicit sentinel
``"unknown"`` until the tool-schema cache is warm (WS3c tightens it when the
receipt path lands — we never invent a fake hash).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from urllib.parse import quote, unquote

CAPABILITY_KIND_INTEGRATION_TOOL = "integration_tool"
CAPABILITY_KIND_FUNCTION = "function"
CAPABILITY_KIND_PRODUCT_MCP = "product_mcp"

# Explicit "schema not yet known" marker for an integration tool's inputSchemaHash
# (E3 forbids a tools/list fetch at mint, so a cold tool cache has no schema).
CAPABILITY_INPUT_SCHEMA_UNKNOWN = "unknown"


def input_schema_hash(schema: dict[str, object] | None) -> str:
    """The ``sha256:``-prefixed hash of a tool's input schema, or the explicit
    ``"unknown"`` sentinel when no schema is available. Canonical JSON (sorted
    keys, no whitespace) so an identical schema always hashes identically."""

    if not schema:
        return CAPABILITY_INPUT_SCHEMA_UNKNOWN
    canonical = json.dumps(schema, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _q(value: object) -> str:
    return quote(str(value), safe="")


@dataclass(frozen=True)
class IntegrationToolRef:
    """A frozen integration-tool capability (§7.1). ``provider_revision`` reuses
    the definition's ``updated_at`` marker (no new column); ``input_schema_hash``
    may be ``"unknown"`` when the tool-schema cache is cold."""

    provider_definition_id: str
    provider_revision: str
    tool_name: str
    input_schema_hash: str = CAPABILITY_INPUT_SCHEMA_UNKNOWN

    kind = CAPABILITY_KIND_INTEGRATION_TOOL

    @property
    def capability_key(self) -> str:
        return ":".join(
            (
                CAPABILITY_KIND_INTEGRATION_TOOL,
                _q(self.provider_definition_id),
                _q(self.provider_revision),
                _q(self.tool_name),
            )
        )

    def plan_ref(self) -> dict[str, object]:
        return {
            "kind": CAPABILITY_KIND_INTEGRATION_TOOL,
            "providerDefinitionId": self.provider_definition_id,
            "providerRevision": self.provider_revision,
            "toolName": self.tool_name,
            "inputSchemaHash": self.input_schema_hash,
        }


@dataclass(frozen=True)
class FunctionRef:
    """A frozen function-invocation capability (§7.1/§7.2). ``semantic_revision``
    bumps on any semantic edit, so a run pins the exact meaning it was resolved
    against — a later edit produces a different key and is denied."""

    definition_id: str
    semantic_revision: int

    kind = CAPABILITY_KIND_FUNCTION

    @property
    def capability_key(self) -> str:
        return ":".join(
            (CAPABILITY_KIND_FUNCTION, _q(self.definition_id), str(int(self.semantic_revision)))
        )

    def plan_ref(self) -> dict[str, object]:
        return {
            "kind": CAPABILITY_KIND_FUNCTION,
            "definitionId": self.definition_id,
            "semanticRevision": self.semantic_revision,
        }


@dataclass(frozen=True)
class ProductMcpRef:
    """A frozen Product MCP peer-policy capability (§7.1). WS3a does not resolve
    these (WS8 owns Product MCP token minting/verification); the codec exists so
    the key format is single-sourced."""

    definition: str
    policy_revision: int

    kind = CAPABILITY_KIND_PRODUCT_MCP

    @property
    def capability_key(self) -> str:
        return ":".join(
            (CAPABILITY_KIND_PRODUCT_MCP, _q(self.definition), str(int(self.policy_revision)))
        )

    def plan_ref(self) -> dict[str, object]:
        return {
            "kind": CAPABILITY_KIND_PRODUCT_MCP,
            "definition": self.definition,
            "policyRevision": self.policy_revision,
        }


@dataclass(frozen=True)
class ParsedCapabilityKey:
    """The identity fields recovered from a ``capability_key`` (the key-encoded
    fields only — ``inputSchemaHash`` is not in the key)."""

    kind: str
    provider_definition_id: str | None = None
    provider_revision: str | None = None
    tool_name: str | None = None
    definition_id: str | None = None
    semantic_revision: int | None = None
    product_mcp_definition: str | None = None
    policy_revision: int | None = None


def parse_capability_key(key: str) -> ParsedCapabilityKey:
    """Inverse of the ``capability_key`` properties. Raises ``ValueError`` on a
    malformed key so a caller never silently authorizes a garbage identity."""

    kind, _, remainder = key.partition(":")
    parts = [unquote(part) for part in remainder.split(":")] if remainder else []
    if kind == CAPABILITY_KIND_INTEGRATION_TOOL:
        if len(parts) != 3:
            raise ValueError(f"malformed integration_tool capability_key: {key!r}")
        return ParsedCapabilityKey(
            kind=kind,
            provider_definition_id=parts[0],
            provider_revision=parts[1],
            tool_name=parts[2],
        )
    if kind == CAPABILITY_KIND_FUNCTION:
        if len(parts) != 2:
            raise ValueError(f"malformed function capability_key: {key!r}")
        return ParsedCapabilityKey(
            kind=kind, definition_id=parts[0], semantic_revision=int(parts[1])
        )
    if kind == CAPABILITY_KIND_PRODUCT_MCP:
        if len(parts) != 2:
            raise ValueError(f"malformed product_mcp capability_key: {key!r}")
        return ParsedCapabilityKey(
            kind=kind, product_mcp_definition=parts[0], policy_revision=int(parts[1])
        )
    raise ValueError(f"unknown capability kind in capability_key: {key!r}")
