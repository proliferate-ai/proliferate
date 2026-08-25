from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.auth.identity.store import upsert_identity_for_user, upsert_provider_grant
from proliferate.auth.identity.types import REQUIRED_GITHUB_SCOPES, VerifiedProviderIdentity
from tests.e2e.cloud.helpers.shared import CloudE2ETestError


async def seed_linked_github_account(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
    account_id: str | None = None,
    account_email: str | None = None,
) -> None:
    user_uuid = uuid.UUID(user_id)
    resolved_account_id = account_id or f"github-{user_id}"
    resolved_account_email = account_email or f"cloud-e2e-{uuid.uuid4().hex[:8]}@example.com"
    account = (
        await db_session.execute(
            select(OAuthAccount)
            .where(
                OAuthAccount.user_id == user_uuid,
                OAuthAccount.oauth_name == "github",
            )
            .order_by(OAuthAccount.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if account is None:
        account = OAuthAccount(user_id=user_uuid, oauth_name="github")
        db_session.add(account)
    account.access_token = access_token
    account.account_id = resolved_account_id
    account.account_email = resolved_account_email

    verified = VerifiedProviderIdentity(
        provider="github",
        provider_subject=resolved_account_id,
        email=resolved_account_email,
        email_verified=True,
        display_name=None,
        provider_login=None,
        avatar_url=None,
        access_token=access_token,
        refresh_token=None,
        expires_at=None,
        expires_at_timestamp=None,
        scopes=frozenset(REQUIRED_GITHUB_SCOPES),
    )
    identity = await upsert_identity_for_user(db_session, user_id=user_uuid, verified=verified)
    await upsert_provider_grant(db_session, identity=identity, verified=verified)
    await db_session.commit()


async def link_github_account(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
) -> None:
    await seed_linked_github_account(
        db_session,
        user_id=user_id,
        access_token=access_token,
    )


async def seed_github_app_authorization(
    db_session: AsyncSession,
    *,
    user_id: str,
) -> None:
    """Seed a REAL GitHub App user authorization for a live-test user.

    The repo-environment write path is gated on a ready GitHub App
    authorization plus the installation cache. Ruled seam (2026-07-09): never
    bypass the gate — plant the outcome the browser callback would produce, by
    refreshing the operator's live App refresh token (which rotates; the
    rotated token is persisted back to the shared state file exactly like
    tests/release/scripts/github_app_seed.py, the source of this pattern).
    """
    import json
    import os
    import tempfile
    from pathlib import Path

    from proliferate.db.store import github_app as github_app_store
    from proliferate.integrations.github.app_user_tokens import (
        refresh_github_app_user_authorization,
    )
    from proliferate.server.github.service import (
        refresh_github_app_installation_cache,
    )
    from proliferate.lib.infra.time.wall_clock import utcnow

    state_path = Path(
        os.environ.get("RELEASE_E2E_GITHUB_APP_SEED_STATE", "").strip()
        or Path.home() / ".proliferate-local" / "dev" / "release-e2e-github-seed.json"
    )
    refresh_token = ""
    if state_path.exists():
        data = json.loads(state_path.read_text(encoding="utf-8"))
        token = data.get("refresh_token")
        if isinstance(token, str):
            refresh_token = token.strip()
    if not refresh_token:
        refresh_token = os.environ.get("RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN", "").strip()
    if not refresh_token:
        raise CloudE2ETestError(
            "No GitHub App seed refresh token available: bootstrap one from a real "
            f"browser-completed App authorization into {state_path} or "
            "RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN."
        )

    authorization = await refresh_github_app_user_authorization(refresh_token=refresh_token)
    if authorization.refresh_token:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "refresh_token": authorization.refresh_token,
            "github_login": authorization.github_login,
            "github_user_id": authorization.github_user_id,
            "rotated_at": utcnow().isoformat(),
        }
        fd, tmp = tempfile.mkstemp(dir=str(state_path.parent), prefix=".seed-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            os.replace(tmp, state_path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=uuid.UUID(user_id),
        authorization=authorization,
    )
    await db_session.commit()
    await refresh_github_app_installation_cache(db_session)
    await db_session.commit()
