from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repositories import service
from proliferate.server.cloud.repositories.models import SaveRepoEnvironmentRequest


def _local_body(install_id: str) -> SaveRepoEnvironmentRequest:
    return SaveRepoEnvironmentRequest.model_validate(
        {"kind": "local", "desktopInstallId": install_id, "localPath": "/tmp/rocket"}
    )


@pytest.mark.asyncio
async def test_save_local_environment_rejects_unowned_desktop_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upserted = False

    async def get_worker(*args: object, **kwargs: object) -> None:
        del args, kwargs
        return None

    async def upsert(*args: object, **kwargs: object) -> None:
        del args, kwargs
        nonlocal upserted
        upserted = True

    monkeypatch.setattr(
        service.runtime_workers_store, "get_active_desktop_worker_for_user", get_worker
    )
    monkeypatch.setattr(service, "upsert_local_repo_environment", upsert)

    with pytest.raises(CloudApiError) as raised:
        await service.save_local_environment(
            object(),
            user_id=uuid.uuid4(),
            git_owner="acme",
            git_repo_name="rocket",
            body=_local_body("someone-elses-install"),
        )

    assert raised.value.code == "desktop_install_not_owned"
    assert raised.value.status_code == 403
    assert upserted is False


@pytest.mark.asyncio
async def test_save_local_environment_persists_owned_desktop_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    ownership_lookups: list[tuple[uuid.UUID, str]] = []
    upsert_calls: list[str] = []

    async def get_worker(*args: object, **kwargs: object) -> SimpleNamespace:
        del args
        ownership_lookups.append((kwargs["owner_user_id"], kwargs["desktop_install_id"]))
        return SimpleNamespace(id=uuid.uuid4())

    async def upsert(*args: object, **kwargs: object) -> SimpleNamespace:
        del args
        upsert_calls.append(kwargs["desktop_install_id"])
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(
        service.runtime_workers_store, "get_active_desktop_worker_for_user", get_worker
    )
    monkeypatch.setattr(service, "upsert_local_repo_environment", upsert)

    await service.save_local_environment(
        object(),
        user_id=user_id,
        git_owner="acme",
        git_repo_name="rocket",
        body=_local_body("  desktop-a  "),
    )

    assert ownership_lookups == [(user_id, "desktop-a")]
    assert upsert_calls == ["desktop-a"]
