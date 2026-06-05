from __future__ import annotations

import hashlib

from proliferate.db.store.cloud_runtime_config import artifacts as artifact_store
from proliferate.server.cloud.errors import CloudApiError


def raise_if_artifact_integrity_invalid(
    artifact: artifact_store.SandboxProfileRuntimeConfigArtifactSnapshot,
    *,
    payload: dict[str, object],
    content: str,
) -> None:
    expected_hash = artifact.artifact_hash
    byte_size = len(content.encode("utf-8"))
    payload_hash = payload.get("hash")
    payload_content_type = payload.get("contentType")
    if (
        byte_size != artifact.byte_size
        or _artifact_content_hash(content) != expected_hash
        or (payload_hash is not None and payload_hash != expected_hash)
        or (payload_content_type is not None and payload_content_type != artifact.content_type)
    ):
        raise CloudApiError(
            "runtime_config_artifact_integrity_mismatch",
            "Runtime config artifact payload does not match its recorded hash.",
            status_code=500,
        )


def _artifact_content_hash(content: str) -> str:
    return f"sha256:{hashlib.sha256(content.encode('utf-8')).hexdigest()}"
