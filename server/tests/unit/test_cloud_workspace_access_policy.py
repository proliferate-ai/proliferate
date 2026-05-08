from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.auth.authorization import PolicyAllowed, PolicyDenied
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import access as workspace_access
from proliferate.server.cloud.workspaces.domain.policy import can_read_cloud_workspace


def test_can_read_personal_cloud_workspace_for_owner() -> None:
    user_id = uuid4()

    verdict = can_read_cloud_workspace(
        actor_user_id=user_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        has_active_organization_membership=False,
    )

    assert isinstance(verdict, PolicyAllowed)


def test_can_read_personal_cloud_workspace_hides_non_owner() -> None:
    verdict = can_read_cloud_workspace(
        actor_user_id=uuid4(),
        owner_scope="personal",
        owner_user_id=uuid4(),
        organization_id=None,
        has_active_organization_membership=False,
    )

    assert isinstance(verdict, PolicyDenied)
    assert verdict.code == "workspace_not_found"
    assert verdict.status_code == 404


def test_can_read_org_cloud_workspace_keeps_existing_not_ready_policy() -> None:
    verdict = can_read_cloud_workspace(
        actor_user_id=uuid4(),
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        has_active_organization_membership=True,
    )

    assert isinstance(verdict, PolicyDenied)
    assert verdict.code == "org_cloud_not_ready"
    assert verdict.status_code == 409


@pytest.mark.asyncio
async def test_cloud_workspace_access_returns_personal_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = SimpleNamespace(
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
    )

    async def _load_workspace(_workspace_id):
        return workspace

    async def _unexpected_membership(**_kwargs):
        raise AssertionError("personal workspace access must not check org membership")

    monkeypatch.setattr(workspace_access, "load_cloud_workspace_by_id", _load_workspace)
    monkeypatch.setattr(workspace_access, "load_active_membership", _unexpected_membership)

    assert await workspace_access.cloud_workspace_user_can_read(user_id, uuid4()) is workspace


@pytest.mark.asyncio
async def test_cloud_workspace_access_hides_missing_or_forbidden_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _missing_workspace(_workspace_id):
        return None

    monkeypatch.setattr(workspace_access, "load_cloud_workspace_by_id", _missing_workspace)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_access.cloud_workspace_user_can_read(uuid4(), uuid4())

    assert exc_info.value.code == "workspace_not_found"
    assert exc_info.value.status_code == 404

    workspace = SimpleNamespace(
        owner_scope="personal",
        owner_user_id=uuid4(),
        organization_id=None,
    )

    async def _forbidden_workspace(_workspace_id):
        return workspace

    monkeypatch.setattr(workspace_access, "load_cloud_workspace_by_id", _forbidden_workspace)

    with pytest.raises(CloudApiError) as forbidden_exc_info:
        await workspace_access.cloud_workspace_user_can_read(uuid4(), uuid4())

    assert forbidden_exc_info.value.code == "workspace_not_found"
    assert forbidden_exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_cloud_workspace_access_preserves_org_not_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = SimpleNamespace(
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
    )

    async def _load_workspace(_workspace_id):
        return workspace

    async def _active_membership(**_kwargs):
        return object()

    monkeypatch.setattr(workspace_access, "load_cloud_workspace_by_id", _load_workspace)
    monkeypatch.setattr(workspace_access, "load_active_membership", _active_membership)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_access.cloud_workspace_user_can_read(user_id, uuid4())

    assert exc_info.value.code == "org_cloud_not_ready"
    assert exc_info.value.status_code == 409
