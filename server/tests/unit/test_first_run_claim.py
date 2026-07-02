"""Tests for the first-run claim: setup token lifecycle and the /setup page."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import verify_password
from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import instance_setup as instance_setup_store
from proliferate.server.organizations.domain.profile import default_organization_name
from proliferate.server.setup.domain.tokens import (
    hash_setup_token,
    mint_setup_token,
    setup_token_matches,
)
from proliferate.server.setup.service import ensure_first_run_setup_token

CLAIM_EMAIL = "owner@acme.test"
CLAIM_PASSWORD = "a-strong-enough-password"


def _factory(test_engine):
    return async_sessionmaker(test_engine, expire_on_commit=False)


def _token_file(tmp_path: Path) -> Path:
    return tmp_path / "setup-token"


def _enable_single_org(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    monkeypatch.setattr(settings, "setup_token_file", str(_token_file(tmp_path)))


async def _seed_setup_token(test_engine, tmp_path: Path | None = None) -> str:
    """Simulate the boot-time mint: hash in the database, plaintext in the file."""
    token = mint_setup_token()
    async with _factory(test_engine)() as session:
        await instance_setup_store.save_setup_token_hash(session, hash_setup_token(token))
        await session.commit()
    if tmp_path is not None:
        _token_file(tmp_path).write_text(f"{token}\n")
    return token


@pytest_asyncio.fixture
async def single_org_client(test_engine, monkeypatch, tmp_path):
    """Test client with single-org mode on, mirroring the conftest client."""
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app

    _enable_single_org(monkeypatch, tmp_path)

    original_engine = engine_module.engine
    original_session_factory = engine_module.async_session_factory
    engine_module.engine = test_engine
    engine_module.async_session_factory = _factory(test_engine)

    app = create_app()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    engine_module.engine = original_engine
    engine_module.async_session_factory = original_session_factory


# ---------------------------------------------------------------------------
# Boot-time token mint
# ---------------------------------------------------------------------------


async def test_boot_mint_persists_hash_and_survives_restart(test_engine, monkeypatch, tmp_path):
    _enable_single_org(monkeypatch, tmp_path)
    from proliferate.db import engine as engine_module

    monkeypatch.setattr(engine_module, "async_session_factory", _factory(test_engine))

    await ensure_first_run_setup_token()
    first_token = _token_file(tmp_path).read_text().strip()
    assert first_token

    async with _factory(test_engine)() as session:
        stored_hash = await instance_setup_store.get_setup_token_hash(session)
    assert stored_hash is not None
    assert setup_token_matches(first_token, stored_hash)

    # Restart with an intact token file: nothing rotates.
    await ensure_first_run_setup_token()
    assert _token_file(tmp_path).read_text().strip() == first_token

    # Plaintext lost (volume wiped): the token rotates so it stays printable.
    _token_file(tmp_path).unlink()
    await ensure_first_run_setup_token()
    second_token = _token_file(tmp_path).read_text().strip()
    assert second_token != first_token
    async with _factory(test_engine)() as session:
        rotated_hash = await instance_setup_store.get_setup_token_hash(session)
    assert rotated_hash is not None
    assert setup_token_matches(second_token, rotated_hash)


async def test_boot_mint_is_noop_in_hosted_mode(test_engine, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "single_org_mode_override", False)
    monkeypatch.setattr(settings, "setup_token_file", str(_token_file(tmp_path)))
    from proliferate.db import engine as engine_module

    monkeypatch.setattr(engine_module, "async_session_factory", _factory(test_engine))

    await ensure_first_run_setup_token()

    assert not _token_file(tmp_path).exists()
    async with _factory(test_engine)() as session:
        assert await instance_setup_store.get_setup_token_hash(session) is None


async def test_boot_cleans_up_token_once_claimed(test_engine, monkeypatch, tmp_path):
    _enable_single_org(monkeypatch, tmp_path)
    from proliferate.db import engine as engine_module

    monkeypatch.setattr(engine_module, "async_session_factory", _factory(test_engine))

    await _seed_setup_token(test_engine, tmp_path)
    async with _factory(test_engine)() as session:
        await create_auth_user(session, email=CLAIM_EMAIL, display_name=None, avatar_url=None)
        await session.commit()

    await ensure_first_run_setup_token()

    assert not _token_file(tmp_path).exists()
    async with _factory(test_engine)() as session:
        assert await instance_setup_store.get_setup_token_hash(session) is None


# ---------------------------------------------------------------------------
# Route availability
# ---------------------------------------------------------------------------


async def test_setup_routes_do_not_exist_in_hosted_mode(client):
    assert (await client.get("/setup")).status_code == 404
    response = await client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": CLAIM_PASSWORD, "setup_token": "anything"},
    )
    assert response.status_code == 404


async def test_setup_page_renders_while_unclaimed(single_org_client):
    response = await single_org_client.get("/setup")
    assert response.status_code == 200
    assert 'name="setup_token"' in response.text
    assert 'name="email"' in response.text
    assert 'name="password"' in response.text
    # Optional organization name with the derived default as its placeholder.
    assert 'name="organization_name"' in response.text
    assert 'placeholder="Derived from your email domain"' in response.text


async def test_setup_routes_close_after_claim(single_org_client, test_engine, tmp_path):
    token = await _seed_setup_token(test_engine, tmp_path)
    claimed = await single_org_client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": CLAIM_PASSWORD, "setup_token": token},
    )
    assert claimed.status_code == 200

    assert (await single_org_client.get("/setup")).status_code == 404
    replay = await single_org_client.post(
        "/setup",
        data={"email": "second@acme.test", "password": CLAIM_PASSWORD, "setup_token": token},
    )
    assert replay.status_code == 404


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------


async def test_claim_with_wrong_token_is_403(single_org_client, test_engine, tmp_path):
    await _seed_setup_token(test_engine, tmp_path)
    response = await single_org_client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": CLAIM_PASSWORD, "setup_token": "wrong-token"},
    )
    assert response.status_code == 403

    async with _factory(test_engine)() as session:
        assert await instance_setup_store.count_users(session) == 0


async def test_claim_with_missing_token_is_403(single_org_client, test_engine, tmp_path):
    await _seed_setup_token(test_engine, tmp_path)
    response = await single_org_client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": CLAIM_PASSWORD},
    )
    assert response.status_code == 403

    async with _factory(test_engine)() as session:
        assert await instance_setup_store.count_users(session) == 0


async def test_claim_validates_password(single_org_client, test_engine, tmp_path):
    token = await _seed_setup_token(test_engine, tmp_path)
    response = await single_org_client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": "short", "setup_token": token},
    )
    assert response.status_code == 400

    async with _factory(test_engine)() as session:
        assert await instance_setup_store.count_users(session) == 0


async def test_claim_rejects_oversized_email(single_org_client, test_engine, tmp_path):
    """An email longer than the users column (320) is a 400, not a 500."""
    token = await _seed_setup_token(test_engine, tmp_path)
    oversized_email = f"{'a' * 320}@acme.test"
    response = await single_org_client.post(
        "/setup",
        data={"email": oversized_email, "password": CLAIM_PASSWORD, "setup_token": token},
    )
    assert response.status_code == 400
    assert "valid email" in response.text

    async with _factory(test_engine)() as session:
        assert await instance_setup_store.count_users(session) == 0


async def test_claim_rejects_oversized_organization_name(single_org_client, test_engine, tmp_path):
    token = await _seed_setup_token(test_engine, tmp_path)
    response = await single_org_client.post(
        "/setup",
        data={
            "email": CLAIM_EMAIL,
            "password": CLAIM_PASSWORD,
            "setup_token": token,
            "organization_name": "x" * 500,
        },
    )
    assert response.status_code == 400

    async with _factory(test_engine)() as session:
        assert await instance_setup_store.count_users(session) == 0


# ---------------------------------------------------------------------------
# The claim itself
# ---------------------------------------------------------------------------


async def test_claim_creates_owner_and_instance_org(single_org_client, test_engine, tmp_path):
    token = await _seed_setup_token(test_engine, tmp_path)

    response = await single_org_client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": CLAIM_PASSWORD, "setup_token": token},
    )
    assert response.status_code == 200
    assert "desktop app" in response.text

    async with _factory(test_engine)() as session:
        user = (await session.execute(select(User).where(User.email == CLAIM_EMAIL))).scalar_one()
        assert user.password_set_at is not None
        assert verify_password(CLAIM_PASSWORD, user.hashed_password).verified

        organization = (await session.execute(select(Organization))).scalar_one()
        assert organization.is_instance is True

        membership = (await session.execute(select(OrganizationMembership))).scalar_one()
        assert membership.organization_id == organization.id
        assert membership.user_id == user.id
        assert membership.role == ORGANIZATION_ROLE_OWNER
        assert membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE

        # The token is single-use: the hash row is gone.
        assert await instance_setup_store.get_setup_token_hash(session) is None

    # The plaintext file is removed after commit (deferred callback).
    for _ in range(50):
        if not _token_file(tmp_path).exists():
            break
        await asyncio.sleep(0.02)
    assert not _token_file(tmp_path).exists()


async def test_claim_honors_custom_organization_name(single_org_client, test_engine, tmp_path):
    token = await _seed_setup_token(test_engine, tmp_path)

    response = await single_org_client.post(
        "/setup",
        data={
            "email": CLAIM_EMAIL,
            "password": CLAIM_PASSWORD,
            "setup_token": token,
            "organization_name": "  Wayne Enterprises  ",
        },
    )
    assert response.status_code == 200

    async with _factory(test_engine)() as session:
        organization = (await session.execute(select(Organization))).scalar_one()
        assert organization.name == "Wayne Enterprises"


async def test_claim_blank_organization_name_uses_derived_default(
    single_org_client, test_engine, tmp_path
):
    token = await _seed_setup_token(test_engine, tmp_path)

    response = await single_org_client.post(
        "/setup",
        data={
            "email": CLAIM_EMAIL,
            "password": CLAIM_PASSWORD,
            "setup_token": token,
            "organization_name": "   ",
        },
    )
    assert response.status_code == 200

    async with _factory(test_engine)() as session:
        organization = (await session.execute(select(Organization))).scalar_one()
        assert organization.name == default_organization_name(email=CLAIM_EMAIL, display_name=None)


async def test_claim_error_rerender_shows_derived_name_placeholder(
    single_org_client, test_engine, tmp_path
):
    """The error re-render derives the placeholder from the submitted email."""
    await _seed_setup_token(test_engine, tmp_path)
    response = await single_org_client.post(
        "/setup",
        data={"email": CLAIM_EMAIL, "password": CLAIM_PASSWORD, "setup_token": "wrong-token"},
    )
    assert response.status_code == 403
    derived = default_organization_name(email=CLAIM_EMAIL, display_name=None)
    assert f'placeholder="{derived}"' in response.text


async def test_concurrent_double_claim_yields_exactly_one_owner(
    single_org_client, test_engine, tmp_path
):
    token = await _seed_setup_token(test_engine, tmp_path)

    first, second = await asyncio.gather(
        single_org_client.post(
            "/setup",
            data={"email": "one@acme.test", "password": CLAIM_PASSWORD, "setup_token": token},
        ),
        single_org_client.post(
            "/setup",
            data={"email": "two@acme.test", "password": CLAIM_PASSWORD, "setup_token": token},
        ),
    )

    statuses = sorted([first.status_code, second.status_code])
    assert statuses == [200, 404]

    async with _factory(test_engine)() as session:
        user_count = await instance_setup_store.count_users(session)
        organization_count = int(
            (await session.execute(select(func.count(Organization.id)))).scalar_one()
        )
        owner_count = int(
            (
                await session.execute(
                    select(func.count(OrganizationMembership.id)).where(
                        OrganizationMembership.role == ORGANIZATION_ROLE_OWNER,
                        OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    )
                )
            ).scalar_one()
        )
    assert user_count == 1
    assert organization_count == 1
    assert owner_count == 1
