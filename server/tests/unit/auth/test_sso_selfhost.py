"""Self-host auth hardening unit tests (Task 05): SSO discovery only advertises
usable configs, the OIDC-completeness predicate, the JIT-disabled callback code,
and GitHub sign-in availability. Split from `test_sso.py` to stay under the
600-line source cap; reuses that module's `_connection`/`_FakeDb` fixtures.
"""

from __future__ import annotations

from dataclasses import replace
from typing import cast

import pytest
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.sso import api as sso_api
from proliferate.auth.sso import service as sso_service
from proliferate.auth.sso.types import SsoScope
from proliferate.config import settings

from tests.unit.auth.test_sso import _FakeDb, _connection

# ── Task 05: discovery advertises only usable configs (in-scope #2), JIT
# rejection returns a specific error (in-scope #4), and the config-validation
# predicate the deployment doctor consumes. ──


def test_oidc_configuration_error_flags_each_missing_field() -> None:
    from proliferate.auth.sso.policy import oidc_configuration_error

    complete = _connection(allowed_domains=())
    assert oidc_configuration_error(complete) is None

    assert (
        oidc_configuration_error(replace(complete, oidc_client_id=None))
        == "oidc_client_id_missing"
    )
    assert (
        oidc_configuration_error(replace(complete, oidc_client_secret=None))
        == "oidc_client_secret_missing"
    )
    # A public client (token_endpoint_auth_method="none") needs no secret.
    assert (
        oidc_configuration_error(
            replace(
                complete,
                oidc_client_secret=None,
                oidc_token_endpoint_auth_method="none",
            )
        )
        is None
    )
    # No issuer AND no discovery URL AND no full static endpoint set.
    assert (
        oidc_configuration_error(replace(complete, oidc_issuer_url=None, oidc_discovery_url=None))
        == "oidc_endpoints_missing"
    )


@pytest.mark.asyncio
async def test_discover_sso_hides_enabled_but_incomplete_deployment_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # SSO_ENABLED=true with a blank client secret must NOT advertise a usable
    # button (it would only fail at the provider). Discovery reports the
    # specific reason instead of enabled=true.
    monkeypatch.setattr(settings, "sso_enabled", True)
    monkeypatch.setattr(settings, "sso_protocol", "oidc")
    monkeypatch.setattr(settings, "sso_oidc_issuer_url", "https://idp.example.test")
    monkeypatch.setattr(settings, "sso_oidc_discovery_url", "")
    monkeypatch.setattr(settings, "sso_oidc_authorization_endpoint", "")
    monkeypatch.setattr(settings, "sso_oidc_token_endpoint", "")
    monkeypatch.setattr(settings, "sso_oidc_jwks_uri", "")
    monkeypatch.setattr(settings, "sso_oidc_client_id", "client-id")
    monkeypatch.setattr(settings, "sso_oidc_client_secret", "")
    monkeypatch.setattr(settings, "sso_oidc_token_endpoint_auth_method", "client_secret_basic")

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, _FakeDb()),
        email=None,
        organization_id=None,
        connection_id=None,
    )
    assert discovery.enabled is False
    assert discovery.reason == "oidc_client_secret_missing"


@pytest.mark.asyncio
async def test_discover_sso_advertises_a_complete_deployment_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "sso_enabled", True)
    monkeypatch.setattr(settings, "sso_protocol", "oidc")
    monkeypatch.setattr(settings, "sso_oidc_issuer_url", "https://idp.example.test")
    monkeypatch.setattr(settings, "sso_oidc_discovery_url", "")
    monkeypatch.setattr(settings, "sso_oidc_authorization_endpoint", "")
    monkeypatch.setattr(settings, "sso_oidc_token_endpoint", "")
    monkeypatch.setattr(settings, "sso_oidc_jwks_uri", "")
    monkeypatch.setattr(settings, "sso_oidc_client_id", "client-id")
    monkeypatch.setattr(settings, "sso_oidc_client_secret", "client-secret")
    monkeypatch.setattr(settings, "sso_oidc_token_endpoint_auth_method", "client_secret_basic")

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, _FakeDb()),
        email=None,
        organization_id=None,
        connection_id=None,
    )
    assert discovery.enabled is True
    assert discovery.reason is None
    assert discovery.scope is SsoScope.DEPLOYMENT


def test_deployment_sso_configuration_error_predicate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from proliferate.auth.sso.deployment_config import deployment_sso_configuration_error

    # SSO off → no issue.
    monkeypatch.setattr(settings, "sso_enabled", False)
    assert deployment_sso_configuration_error() is None

    # Enabled but no client id → a specific reason (the doctor signal).
    monkeypatch.setattr(settings, "sso_enabled", True)
    monkeypatch.setattr(settings, "sso_protocol", "oidc")
    monkeypatch.setattr(settings, "sso_oidc_issuer_url", "https://idp.example.test")
    monkeypatch.setattr(settings, "sso_oidc_client_id", "")
    monkeypatch.setattr(settings, "sso_oidc_client_secret", "client-secret")
    assert deployment_sso_configuration_error() == "oidc_client_id_missing"

    # Fully configured → no issue.
    monkeypatch.setattr(settings, "sso_oidc_client_id", "client-id")
    assert deployment_sso_configuration_error() is None


@pytest.mark.asyncio
async def test_oidc_sso_callback_maps_jit_disabled_to_specific_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A first-time SSO user under the default SSO_JIT_POLICY=disabled is rejected
    # with "SSO user provisioning is disabled."; that must reach the auth-error
    # screen as a specific, actionable code — never the generic callback error.
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    async def fake_complete_oidc_sso_callback(*_args: object, **_kwargs: object) -> str:
        raise HTTPException(status_code=403, detail="SSO user provisioning is disabled.")

    monkeypatch.setattr(
        sso_api,
        "complete_oidc_sso_callback",
        fake_complete_oidc_sso_callback,
    )
    db = _FakeDb()

    response = await sso_api.oidc_sso_callback(
        cast(Request, object()),
        state="state",
        code="code",
        db=cast(AsyncSession, db),
    )

    assert response.status_code == 302
    assert (
        response.headers["location"] == "https://app.example.test/auth/error?code=sso_jit_disabled"
    )
    assert db.rolled_back is True
    assert db.committed is False


def test_github_oauth_availability_requires_both_id_and_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The desktop /methods probe advertises GitHub only when the OAuth app is
    # FULLY configured — a client id without a secret is a button that only
    # fails at the provider.
    from proliferate.auth.desktop.service import github_oauth_enabled

    monkeypatch.setattr(settings, "github_oauth_client_id", "")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "")
    assert github_oauth_enabled() is False

    monkeypatch.setattr(settings, "github_oauth_client_id", "gh-client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "")
    assert github_oauth_enabled() is False

    monkeypatch.setattr(settings, "github_oauth_client_secret", "gh-client-secret")
    assert github_oauth_enabled() is True
