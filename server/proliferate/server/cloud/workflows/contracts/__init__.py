"""Workflow cross-language contract spine (WS1).

Pure contract-shape models, canonical JSON hashing, the v1 emit schema profile,
and the deterministic legacy UUIDv5 upgrade. Not wired to routers or OpenAPI in
this packet.
"""

from .canonical import canonicalize, content_hash, hash_excluding, sha256_hex
from .legacy_upgrade import (
    PROLIFERATE_WORKFLOW_NAMESPACE,
    derive_legacy_id,
    legacy_identity_name,
)
from .schema_profile import SchemaProfileError, validate_schema_profile

__all__ = [
    "canonicalize",
    "content_hash",
    "hash_excluding",
    "sha256_hex",
    "PROLIFERATE_WORKFLOW_NAMESPACE",
    "derive_legacy_id",
    "legacy_identity_name",
    "SchemaProfileError",
    "validate_schema_profile",
]
