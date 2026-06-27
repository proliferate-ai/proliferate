from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.server.cloud.errors import CloudApiError

_AUDIENCE = "proliferate-integration-gateway"
_ISSUER = "proliferate-api"
_TTL = timedelta(hours=8)


@dataclass(frozen=True)
class IntegrationGatewayGrant:
    sandbox_profile_id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None


async def mint_integration_gateway_grant(
    db: AsyncSession,
    *,
    profile_id: UUID,
) -> str:
    profile = await sandbox_profile_store.load_sandbox_profile_by_id(db, profile_id)
    if profile is None:
        raise CloudApiError(
            "sandbox_profile_not_found", "Sandbox profile not found.", status_code=404
        )
    now = datetime.now(UTC)
    payload = {
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + _TTL).timestamp()),
        "sub": str(profile.id),
        "owner_scope": profile.owner_scope,
        "owner_user_id": str(profile.owner_user_id) if profile.owner_user_id else None,
        "organization_id": str(profile.organization_id) if profile.organization_id else None,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_integration_gateway_grant(token: str) -> IntegrationGatewayGrant:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience=_AUDIENCE,
            issuer=_ISSUER,
        )
    except JWTError as exc:
        raise CloudApiError(
            "integration_gateway_unauthorized",
            "Invalid integration gateway token.",
            status_code=401,
        ) from exc
    try:
        profile_id = UUID(str(payload["sub"]))
        owner_scope = str(payload["owner_scope"])
        owner_user_id = (
            UUID(str(payload["owner_user_id"])) if payload.get("owner_user_id") else None
        )
        organization_id = (
            UUID(str(payload["organization_id"])) if payload.get("organization_id") else None
        )
    except (KeyError, ValueError) as exc:
        raise CloudApiError(
            "integration_gateway_unauthorized",
            "Invalid integration gateway token.",
            status_code=401,
        ) from exc
    return IntegrationGatewayGrant(
        sandbox_profile_id=profile_id,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
    )
