from __future__ import annotations

import base64
import hashlib
import uuid
from uuid import UUID

import httpx

from proliferate.auth.desktop import service as desktop_service
from proliferate.auth.desktop.models import AuthorizeParams

DEFAULT_PKCE_VERIFIER = "test-code-verifier-that-is-long-enough-for-pkce"


def make_pkce_pair(verifier: str = DEFAULT_PKCE_VERIFIER) -> tuple[str, str]:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


async def create_desktop_auth_code(
    *,
    user_id: str | UUID,
    state: str,
    code_challenge: str,
    code_challenge_method: str = "S256",
    redirect_uri: str = "proliferate://auth/callback",
) -> str:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        auth_code = await desktop_service.create_desktop_auth_code(
            session,
            AuthorizeParams(
                state=state,
                code_challenge=code_challenge,
                code_challenge_method=code_challenge_method,
                redirect_uri=redirect_uri,
            ),
            UUID(str(user_id)),
        )
        await session.commit()
        return auth_code.code


async def mint_desktop_token_payload(
    client: httpx.AsyncClient,
    *,
    user_id: str | UUID,
    state_prefix: str,
    verifier: str = DEFAULT_PKCE_VERIFIER,
) -> dict[str, object]:
    code_verifier, challenge = make_pkce_pair(verifier)
    code = await create_desktop_auth_code(
        user_id=user_id,
        state=f"{state_prefix}-{uuid.uuid4().hex[:8]}",
        code_challenge=challenge,
    )
    token = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": code_verifier,
            "grant_type": "authorization_code",
        },
    )
    token.raise_for_status()
    payload = token.json()
    if not isinstance(payload, dict):
        raise TypeError("Desktop token endpoint returned a non-object payload.")
    return payload
