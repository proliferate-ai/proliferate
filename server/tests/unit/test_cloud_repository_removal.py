from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repositories import service


@pytest.mark.asyncio
async def test_remove_cloud_repo_environment_is_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    removed = False

    async def get_environment(*args: object, **kwargs: object) -> None:
        del args, kwargs
        return None

    async def remove_row(*args: object, **kwargs: object) -> None:
        del args, kwargs
        nonlocal removed
        removed = True

    monkeypatch.setattr(service, "get_cloud_repo_environment", get_environment)
    monkeypatch.setattr(service, "remove_cloud_repo_environment_row", remove_row)

    await service.remove_cloud_repo_environment(
        object(),
        user_id=uuid.uuid4(),
        git_owner="acme",
        git_repo_name="rocket",
    )

    assert removed is False


@pytest.mark.asyncio
async def test_remove_cloud_repo_environment_blocks_preserved_workspaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment_id = uuid.uuid4()

    async def get_environment(*args: object, **kwargs: object) -> SimpleNamespace:
        del args, kwargs
        return SimpleNamespace(id=environment_id)

    async def has_workspaces(*args: object, **kwargs: object) -> bool:
        del args, kwargs
        return True

    monkeypatch.setattr(service, "get_cloud_repo_environment", get_environment)
    monkeypatch.setattr(
        service.cloud_workspaces_store,
        "repo_environment_has_workspaces",
        has_workspaces,
    )

    with pytest.raises(CloudApiError) as raised:
        await service.remove_cloud_repo_environment(
            object(),
            user_id=uuid.uuid4(),
            git_owner="acme",
            git_repo_name="rocket",
        )

    assert raised.value.code == "cloud_repository_in_use"
    assert raised.value.status_code == 409


@pytest.mark.asyncio
async def test_remove_cloud_repo_environment_deletes_unused_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment_id = uuid.uuid4()
    calls: list[tuple[str, str]] = []

    async def get_environment(*args: object, **kwargs: object) -> SimpleNamespace:
        del args, kwargs
        return SimpleNamespace(id=environment_id)

    async def has_workspaces(*args: object, **kwargs: object) -> bool:
        del args, kwargs
        return False

    async def has_automations(*args: object, **kwargs: object) -> bool:
        del args, kwargs
        return False

    async def remove_row(*args: object, **kwargs: object) -> bool:
        del args
        calls.append((str(kwargs["git_owner"]), str(kwargs["git_repo_name"])))
        return True

    monkeypatch.setattr(service, "get_cloud_repo_environment", get_environment)
    monkeypatch.setattr(
        service.cloud_workspaces_store,
        "repo_environment_has_workspaces",
        has_workspaces,
    )
    monkeypatch.setattr(
        service.automations_store,
        "repo_environment_has_automation_references",
        has_automations,
    )
    monkeypatch.setattr(service, "remove_cloud_repo_environment_row", remove_row)

    await service.remove_cloud_repo_environment(
        object(),
        user_id=uuid.uuid4(),
        git_owner="acme",
        git_repo_name="rocket",
    )

    assert calls == [("acme", "rocket")]


@pytest.mark.asyncio
async def test_remove_cloud_repo_environment_blocks_automation_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment_id = uuid.uuid4()

    async def get_environment(*args: object, **kwargs: object) -> SimpleNamespace:
        del args
        assert kwargs["lock_mode"] == "update"
        return SimpleNamespace(id=environment_id)

    async def no_workspaces(*args: object, **kwargs: object) -> bool:
        del args, kwargs
        return False

    async def has_automations(*args: object, **kwargs: object) -> bool:
        del args, kwargs
        return True

    monkeypatch.setattr(service, "get_cloud_repo_environment", get_environment)
    monkeypatch.setattr(
        service.cloud_workspaces_store,
        "repo_environment_has_workspaces",
        no_workspaces,
    )
    monkeypatch.setattr(
        service.automations_store,
        "repo_environment_has_automation_references",
        has_automations,
    )

    with pytest.raises(CloudApiError) as raised:
        await service.remove_cloud_repo_environment(
            object(),
            user_id=uuid.uuid4(),
            git_owner="acme",
            git_repo_name="rocket",
        )

    assert raised.value.code == "cloud_repository_in_use"
