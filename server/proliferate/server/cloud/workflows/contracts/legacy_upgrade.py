"""Deterministic UUIDv5 identity derivation for the legacy-definition upgrade
(feature spec §5.1).

Legacy definitions without identities are upgraded by a new immutable version
whose UUIDv5 IDs are derived once from the fixed Proliferate namespace. The old
version is retained for audit and never rewritten.
"""

from __future__ import annotations

import uuid

# Fixed Proliferate workflow-identity namespace (feature spec §5.1).
PROLIFERATE_WORKFLOW_NAMESPACE = uuid.UUID("2b5e907a-2cd8-5b8f-b5ab-5c891bb93263")

_KINDS = frozenset({"slot", "node", "group", "lane", "step"})


def legacy_identity_name(workflow_version_id: str, kind: str, identity: str) -> str:
    """The exact UTF-8 UUIDv5 name string (feature spec §5.1)."""

    if kind not in _KINDS:
        raise ValueError(f"unknown identity kind {kind!r}")
    return f"workflow-version={workflow_version_id}\nkind={kind}\nidentity={identity}"


def derive_legacy_id(workflow_version_id: str, kind: str, identity: str) -> str:
    """Derive the deterministic lowercase UUIDv5 for a legacy structural object."""

    name = legacy_identity_name(workflow_version_id, kind, identity)
    return str(uuid.uuid5(PROLIFERATE_WORKFLOW_NAMESPACE, name))
