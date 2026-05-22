"""Direct-attach JWT claim construction."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass(frozen=True)
class DirectAttachJwtClaims:
    iss: str
    aud: str
    sub: str
    exp: int
    nbf: int
    iat: int
    jti: str
    org_id: str
    target_id: str
    cloud_workspace_id: str
    anyharness_workspace_id: str
    cloud_session_id: str | None
    anyharness_session_id: str | None
    claim_id: str
    permissions: list[str]


def timestamp_seconds(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp())


def direct_attach_claims_payload(claims: DirectAttachJwtClaims) -> dict[str, object]:
    payload: dict[str, object] = {
        "iss": claims.iss,
        "aud": claims.aud,
        "sub": claims.sub,
        "exp": claims.exp,
        "nbf": claims.nbf,
        "iat": claims.iat,
        "jti": claims.jti,
        "org_id": claims.org_id,
        "target_id": claims.target_id,
        "cloud_workspace_id": claims.cloud_workspace_id,
        "anyharness_workspace_id": claims.anyharness_workspace_id,
        "claim_id": claims.claim_id,
        "permissions": claims.permissions,
    }
    if claims.cloud_session_id is not None:
        payload["cloud_session_id"] = claims.cloud_session_id
    if claims.anyharness_session_id is not None:
        payload["anyharness_session_id"] = claims.anyharness_session_id
    return payload
