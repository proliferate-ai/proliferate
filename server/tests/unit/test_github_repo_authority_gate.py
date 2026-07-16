"""The configuration-completeness gate on GitHub cloud repo authority.

PR1-B1 (frozen PR 1 contract): every repository-backed Cloud mutation runs
through ``require_github_cloud_repo_authority``, so the operator-configuration
check lives there — an unconfigured or partially configured deployment must
report ``operator_configuration_required`` with no user action, never send the
user into an authorization flow that cannot work. This must hold even when a
cached user authorization exists from before the App config regressed.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.github_app.api import router as github_app_router

_APP_FIELDS = {
    "github_app_id": "12345",
    "github_app_slug": "acme-cloud",
    "github_app_client_id": "Iv1.app-client",
    "github_app_client_secret": "app-secret",
    "github_app_webhook_secret": "hook-secret",
    "github_app_private_key": "-----BEGIN RSA PRIVATE KEY-----",
    "github_app_private_key_path": "",
}


def _set_app_config(monkeypatch: pytest.MonkeyPatch, **overrides: str) -> None:
    values = {**_APP_FIELDS, **overrides}
    for field, value in values.items():
        monkeypatch.setattr(repo_authority.settings, field, value)


@dataclass(frozen=True)
class _User:
    id: uuid.UUID


def test_gate_passes_when_app_fully_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_app_config(monkeypatch)
    repo_authority.require_github_app_runtime_configured()


def test_gate_rejects_fully_unconfigured_deployment(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_app_config(monkeypatch, **dict.fromkeys(_APP_FIELDS, ""))
    with pytest.raises(CloudApiError) as excinfo:
        repo_authority.require_github_app_runtime_configured()
    assert excinfo.value.code == "github_app_not_configured"
    assert excinfo.value.status_code == 503


_REQUIRED_FIELDS = sorted(set(_APP_FIELDS) - {"github_app_private_key_path"})


@pytest.mark.parametrize("missing_field", _REQUIRED_FIELDS)
def test_gate_rejects_each_partially_configured_deployment(
    monkeypatch: pytest.MonkeyPatch, missing_field: str
) -> None:
    _set_app_config(monkeypatch, **{missing_field: ""})
    with pytest.raises(CloudApiError) as excinfo:
        repo_authority.require_github_app_runtime_configured()
    assert excinfo.value.code == "github_app_not_configured"


def test_gate_accepts_private_key_path_form(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_app_config(
        monkeypatch,
        github_app_private_key="",
        github_app_private_key_path="/etc/proliferate/app.pem",
    )
    repo_authority.require_github_app_runtime_configured()


@pytest.mark.asyncio
async def test_authority_check_reports_operator_state_despite_cached_user_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The regression that motivated the gate: a user authorized while the App
    # was complete, then the operator config regressed. The cached ready
    # authorization must NOT surface missing_user_authorization/authorize_user.
    _set_app_config(monkeypatch, github_app_webhook_secret="")

    async def fail_if_reached(*args: object, **kwargs: object) -> object:
        raise AssertionError("user authorization must not be consulted when App is unconfigured")

    monkeypatch.setattr(
        repo_authority.github_app_store,
        "get_github_app_authorization_for_user",
        fail_if_reached,
    )

    with pytest.raises(CloudApiError) as excinfo:
        await repo_authority.require_github_cloud_repo_authority(
            object(),  # type: ignore[arg-type]  # never touches the db before the gate
            user_id=uuid.uuid4(),
            git_owner="acme",
            git_repo_name="widgets",
        )
    assert excinfo.value.code == "github_app_not_configured"


def _authority_client() -> TestClient:
    app = FastAPI()
    app.include_router(github_app_router)

    async def _fake_session() -> object:
        return object()

    app.dependency_overrides[get_async_session] = _fake_session
    app.dependency_overrides[current_product_user] = lambda: _User(id=uuid.uuid4())
    return TestClient(app)


def test_authority_endpoint_reports_operator_configuration_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Endpoint-level proof: GET .../authority on an unconfigured deployment
    # returns the operator status with a null action over the wire.
    _set_app_config(monkeypatch, **dict.fromkeys(_APP_FIELDS, ""))

    response = _authority_client().get("/github-app/repos/acme/widgets/authority")

    assert response.status_code == 200
    body = response.json()
    assert body["authorized"] is False
    assert body["status"] == "operator_configuration_required"
    assert body["action"] is None


def test_authority_endpoint_reports_user_flow_only_when_app_is_complete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # With a complete App config and no user authorization, the user-side
    # repair (authorize_user) is correct and must be preserved.
    _set_app_config(monkeypatch)

    async def no_authorization(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        repo_authority.github_app_store,
        "get_github_app_authorization_for_user",
        no_authorization,
    )

    response = _authority_client().get("/github-app/repos/acme/widgets/authority")

    assert response.status_code == 200
    body = response.json()
    assert body["authorized"] is False
    assert body["status"] == "missing_user_authorization"
    assert body["action"] == "authorize_user"


@pytest.mark.asyncio
async def test_gate_runs_before_authorization_freshness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Even a fresh, ready cached authorization does not bypass the operator
    # gate: the gate is ordered first inside require_github_cloud_repo_authority.
    _set_app_config(monkeypatch, github_app_id="")

    async def cached_authorization(*args: object, **kwargs: object) -> object:
        raise AssertionError("gate must run before any authorization lookup")

    monkeypatch.setattr(
        repo_authority.github_app_store,
        "get_github_app_authorization_for_user",
        cached_authorization,
    )

    with pytest.raises(CloudApiError) as excinfo:
        await repo_authority.require_github_cloud_repo_authority(
            object(),  # type: ignore[arg-type]
            user_id=uuid.uuid4(),
            git_owner="acme",
            git_repo_name="widgets",
        )
    assert excinfo.value.code == "github_app_not_configured"
