"""Cloud Secrets route-access ownership regressions."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.errors import ProliferateError
from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.secrets import access, api, service
from proliferate.server.cloud.secrets.models import CloudSecretsResponse


def _assert_error(
    error: CloudApiError,
    *,
    code: str,
    message: str,
    status_code: int,
) -> None:
    assert error.code == code
    assert error.message == message
    assert error.status_code == status_code


@pytest.mark.asyncio
async def test_organization_member_access_returns_exact_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    db = SimpleNamespace()
    calls: list[tuple[object, uuid.UUID, uuid.UUID]] = []

    async def get_membership(
        received_db: object,
        *,
        organization_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> object:
        calls.append((received_db, organization_id, user_id))
        return SimpleNamespace(role="member")

    monkeypatch.setattr(access.organization_store, "get_active_membership", get_membership)
    result = await access.organization_secrets_member_access(
        organization_id,
        user=SimpleNamespace(id=actor_id),  # type: ignore[arg-type]
        db=db,  # type: ignore[arg-type]
    )

    assert result == access.OrganizationSecretsAccess(actor_id, organization_id, "member")
    assert calls == [(db, organization_id, actor_id)]


@pytest.mark.asyncio
async def test_organization_member_access_preserves_missing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def missing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(access.organization_store, "get_active_membership", missing)
    with pytest.raises(CloudApiError) as exc_info:
        await access.organization_secrets_member_access(
            uuid.uuid4(),
            user=SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
            db=SimpleNamespace(),  # type: ignore[arg-type]
        )
    _assert_error(
        exc_info.value,
        code="organization_secrets_not_found",
        message="Organization secrets not found.",
        status_code=404,
    )


@pytest.mark.asyncio
async def test_organization_admin_access_is_pure_and_preserves_denial() -> None:
    owner = access.OrganizationSecretsAccess(uuid.uuid4(), uuid.uuid4(), "owner")
    admin = access.OrganizationSecretsAccess(uuid.uuid4(), uuid.uuid4(), "admin")
    member = access.OrganizationSecretsAccess(uuid.uuid4(), uuid.uuid4(), "member")

    assert await access.organization_secrets_admin_access(owner) is owner
    assert await access.organization_secrets_admin_access(admin) is admin
    with pytest.raises(CloudApiError) as exc_info:
        await access.organization_secrets_admin_access(member)
    _assert_error(
        exc_info.value,
        code="organization_secrets_permission_denied",
        message="You do not have permission to manage organization secrets.",
        status_code=403,
    )


@pytest.mark.asyncio
async def test_workspace_access_resolves_exact_path_and_preserves_missing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id = uuid.uuid4()
    environment_id = uuid.uuid4()
    db = SimpleNamespace()
    calls: list[tuple[object, uuid.UUID, str, str]] = []

    async def configured(
        received_db: object,
        *,
        user_id: uuid.UUID,
        git_owner: str,
        git_repo_name: str,
    ) -> object:
        calls.append((received_db, user_id, git_owner, git_repo_name))
        return SimpleNamespace(id=environment_id)

    monkeypatch.setattr(access.repositories_store, "get_cloud_repo_environment", configured)
    result = await access.workspace_secrets_access(
        "ExactOwner",
        "ExactRepo",
        user=SimpleNamespace(id=actor_id),  # type: ignore[arg-type]
        db=db,  # type: ignore[arg-type]
    )
    assert result == access.WorkspaceSecretsAccess(actor_id, environment_id)
    assert calls == [(db, actor_id, "ExactOwner", "ExactRepo")]

    async def missing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(access.repositories_store, "get_cloud_repo_environment", missing)
    with pytest.raises(CloudApiError) as exc_info:
        await access.workspace_secrets_access(
            "ExactOwner",
            "ExactRepo",
            user=SimpleNamespace(id=actor_id),  # type: ignore[arg-type]
            db=db,  # type: ignore[arg-type]
        )
    _assert_error(
        exc_info.value,
        code="cloud_repo_environment_not_configured",
        message="Configure this GitHub repo for cloud before managing workspace secrets.",
        status_code=404,
    )


def _response() -> CloudSecretsResponse:
    return CloudSecretsResponse(
        scope_kind="organization",
        version=0,
        env_vars=[],
        files=[],
        materialization=None,
    )


def _test_app(db: object) -> FastAPI:
    app = FastAPI()

    async def session() -> AsyncIterator[object]:
        yield db

    async def error_handler(_request: Request, error: ProliferateError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": {"code": error.code, "message": error.message}},
        )

    app.include_router(api.router)
    app.add_exception_handler(ProliferateError, error_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_async_session] = session
    return app


@pytest.mark.asyncio
async def test_router_passes_only_preauthorized_ids_and_same_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = SimpleNamespace()
    app = _test_app(db)
    actor_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    environment_id = uuid.uuid4()
    events: list[tuple[str, dict[str, object]]] = []

    async def organization_member() -> access.OrganizationSecretsAccess:
        events.append(("organization_access", {}))
        return access.OrganizationSecretsAccess(actor_id, organization_id, "member")

    async def organization_admin() -> access.OrganizationSecretsAccess:
        events.append(("organization_access", {}))
        return access.OrganizationSecretsAccess(actor_id, organization_id, "admin")

    async def workspace() -> access.WorkspaceSecretsAccess:
        events.append(("workspace_access", {}))
        return access.WorkspaceSecretsAccess(actor_id, environment_id)

    async def observed(
        event_name: str,
        received_db: object,
        **kwargs: object,
    ) -> tuple[object, None]:
        assert received_db is db
        events.append((event_name, kwargs))
        return object(), None

    monkeypatch.setattr(
        api.service,
        "get_organization_secrets",
        lambda received_db, **kwargs: observed("organization_get", received_db, **kwargs),
    )
    monkeypatch.setattr(
        api.service,
        "set_organization_secret_env_var",
        lambda received_db, **kwargs: observed("organization_put", received_db, **kwargs),
    )
    monkeypatch.setattr(
        api.service,
        "get_workspace_secrets",
        lambda received_db, **kwargs: observed("workspace_get", received_db, **kwargs),
    )
    monkeypatch.setattr(
        api.service,
        "set_workspace_secret_env_var",
        lambda received_db, **kwargs: observed("workspace_put", received_db, **kwargs),
    )
    monkeypatch.setattr(api, "cloud_secrets_payload", lambda *_args, **_kwargs: _response())
    app.dependency_overrides[access.organization_secrets_member_access] = organization_member
    app.dependency_overrides[access.organization_secrets_admin_access] = organization_admin
    app.dependency_overrides[access.workspace_secrets_access] = workspace

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        assert (await client.get(f"/organizations/{organization_id}/secrets")).status_code == 200
        assert (
            await client.put(
                f"/organizations/{organization_id}/secrets/env-vars/KEY",
                json={"value": "value"},
            )
        ).status_code == 200
        assert (await client.get("/repos/ExactOwner/ExactRepo/secrets")).status_code == 200
        assert (
            await client.put(
                "/repos/ExactOwner/ExactRepo/secrets/env-vars/KEY",
                json={"value": "value"},
            )
        ).status_code == 200

    assert events == [
        ("organization_access", {}),
        ("organization_get", {"user_id": actor_id, "organization_id": organization_id}),
        ("organization_access", {}),
        (
            "organization_put",
            {
                "user_id": actor_id,
                "organization_id": organization_id,
                "name": "KEY",
                "value": "value",
            },
        ),
        ("workspace_access", {}),
        ("workspace_get", {"user_id": actor_id, "repo_environment_id": environment_id}),
        ("workspace_access", {}),
        (
            "workspace_put",
            {
                "user_id": actor_id,
                "repo_environment_id": environment_id,
                "name": "KEY",
                "value": "value",
            },
        ),
    ]


@pytest.mark.asyncio
async def test_denied_router_access_never_calls_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _test_app(SimpleNamespace())

    async def denied() -> access.OrganizationSecretsAccess:
        raise CloudApiError(
            "organization_secrets_permission_denied",
            "You do not have permission to manage organization secrets.",
            status_code=403,
        )

    async def never(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("service must not run")

    app.dependency_overrides[access.organization_secrets_admin_access] = denied
    monkeypatch.setattr(api.service, "set_organization_secret_env_var", never)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.put(
            f"/organizations/{uuid.uuid4()}/secrets/env-vars/KEY",
            json={"value": "value"},
        )
    assert response.status_code == 403
    assert response.json() == {
        "detail": {
            "code": "organization_secrets_permission_denied",
            "message": "You do not have permission to manage organization secrets.",
        }
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("route", "access_name"),
    [
        ("/organizations/{resource}/secrets/files/upload", "organization"),
        ("/repos/{resource}/repo/secrets/files/upload", "workspace"),
    ],
)
async def test_multipart_invalid_utf8_precedes_resource_access(
    monkeypatch: pytest.MonkeyPatch,
    route: str,
    access_name: str,
) -> None:
    db = SimpleNamespace()
    app = _test_app(db)
    events: list[str] = []
    actor = SimpleNamespace(id=uuid.uuid4())

    async def actor_dependency() -> object:
        events.append("authenticate")
        return actor

    original_reader = api._read_uploaded_secret_file

    async def observed_reader(file: object) -> str:
        events.append("decode")
        return await original_reader(file)  # type: ignore[arg-type]

    async def forbidden_access(*_args: object, **_kwargs: object) -> Any:
        events.append(f"{access_name}_access")
        raise CloudApiError("denied", "Denied.", status_code=403)

    app.dependency_overrides[current_product_user] = actor_dependency
    monkeypatch.setattr(api, "_read_uploaded_secret_file", observed_reader)
    if access_name == "organization":
        monkeypatch.setattr(api.access, "organization_secrets_member_access", forbidden_access)
    else:
        monkeypatch.setattr(api.access, "workspace_secrets_access", forbidden_access)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.put(
            route.format(resource=uuid.uuid4() if access_name == "organization" else "owner"),
            data={"path": "/secret.txt"},
            files={"file": ("secret.txt", b"\xff", "text/plain")},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_secret_file_upload"
    assert events == ["authenticate", "decode"]

    events.clear()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.put(
            route.format(resource=uuid.uuid4() if access_name == "organization" else "owner"),
            data={"path": "/secret.txt"},
            files={"file": ("secret.txt", b"valid", "text/plain")},
        )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "denied"
    assert events == ["authenticate", "decode", f"{access_name}_access"]


@pytest.mark.asyncio
async def test_trusted_service_call_performs_no_access_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    secret_set = SimpleNamespace(
        id=uuid.uuid4(),
        scope_kind="organization",
        user_id=None,
        organization_id=organization_id,
        repo_environment_id=None,
        version=0,
        env_vars=(),
        files=(),
    )

    async def get_secret_set(*_args: object, **_kwargs: object) -> object:
        return secret_set

    async def no_materialization(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        service.secret_store,
        "get_or_create_organization_secret_set",
        get_secret_set,
    )
    monkeypatch.setattr(service, "_load_user_global_materialization", no_materialization)

    value, materialization = await service.get_organization_secrets(
        SimpleNamespace(),  # type: ignore[arg-type]
        user_id=actor_id,
        organization_id=organization_id,
    )
    assert value is secret_set
    assert materialization is None
