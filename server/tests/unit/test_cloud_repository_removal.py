from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from proliferate.server.repositories import service

# The workspaces-in-use delete guard died with the cloud workspace stack
# (cull part 2); these pins cover the surviving desktop-live removal behind
# DELETE /v1/cloud/repositories/{git_owner}/{git_repo_name}/environment.


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
async def test_remove_cloud_repo_environment_deletes_unused_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment_id = uuid.uuid4()
    calls: list[tuple[str, str]] = []

    async def get_environment(*args: object, **kwargs: object) -> SimpleNamespace:
        del args, kwargs
        return SimpleNamespace(id=environment_id)

    async def remove_row(*args: object, **kwargs: object) -> bool:
        del args
        calls.append((str(kwargs["git_owner"]), str(kwargs["git_repo_name"])))
        return True

    monkeypatch.setattr(service, "get_cloud_repo_environment", get_environment)
    monkeypatch.setattr(service, "remove_cloud_repo_environment_row", remove_row)

    await service.remove_cloud_repo_environment(
        object(),
        user_id=uuid.uuid4(),
        git_owner="acme",
        git_repo_name="rocket",
    )

    assert calls == [("acme", "rocket")]
