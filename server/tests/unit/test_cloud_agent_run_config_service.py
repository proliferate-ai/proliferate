from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from proliferate.constants.automations import (
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
)
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    validate_config_execution_scope,
)
from proliferate.server.cloud.agent_run_config import service
from proliferate.server.cloud.errors import CloudApiError


def _config(**overrides: object) -> SimpleNamespace:
    values = {
        "id": uuid.uuid4(),
        "owner_scope": CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
        "owner_user_id": None,
        "organization_id": uuid.uuid4(),
        "agent_kind": "codex",
        "usable_in_personal_sandboxes": True,
        "usable_in_shared_sandboxes": True,
        "status": "active",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_org_default_rejects_config_from_another_org(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    default_org_id = uuid.uuid4()
    other_org_config = _config(organization_id=uuid.uuid4())

    async def fake_visible_config(*args: object, **kwargs: object) -> SimpleNamespace:
        return other_org_config

    async def fake_require_org_admin(*args: object, **kwargs: object) -> None:
        return None

    async def fail_upsert_default(*args: object, **kwargs: object) -> SimpleNamespace:
        raise AssertionError("cross-org default should not be persisted")

    monkeypatch.setattr(service, "_visible_config", fake_visible_config)
    monkeypatch.setattr(service, "_require_org_admin", fake_require_org_admin)
    monkeypatch.setattr(service.config_store, "upsert_default", fail_upsert_default)

    with pytest.raises(CloudApiError) as exc_info:
        await service.set_agent_run_config_default(
            None,  # type: ignore[arg-type]
            SimpleNamespace(id=user_id),  # type: ignore[arg-type]
            owner_scope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
            organization_id=default_org_id,
            agent_kind="codex",
            config_id=other_org_config.id,
        )

    assert exc_info.value.code == "agent_run_config_not_usable"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_org_default_allows_system_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    default_org_id = uuid.uuid4()
    config = _config(
        owner_scope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
        organization_id=None,
    )
    upserted: dict[str, object] = {}

    async def fake_visible_config(*args: object, **kwargs: object) -> SimpleNamespace:
        return config

    async def fake_require_org_admin(*args: object, **kwargs: object) -> None:
        return None

    async def fake_upsert_default(*args: object, **kwargs: object) -> SimpleNamespace:
        upserted.update(kwargs)
        return SimpleNamespace(**kwargs, id=uuid.uuid4())

    monkeypatch.setattr(service, "_visible_config", fake_visible_config)
    monkeypatch.setattr(service, "_require_org_admin", fake_require_org_admin)
    monkeypatch.setattr(service.config_store, "upsert_default", fake_upsert_default)

    result = await service.set_agent_run_config_default(
        None,  # type: ignore[arg-type]
        SimpleNamespace(id=user_id),  # type: ignore[arg-type]
        owner_scope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
        organization_id=default_org_id,
        agent_kind="codex",
        config_id=config.id,
    )

    assert result.organization_id == default_org_id
    assert upserted["owner_user_id"] is None
    assert upserted["organization_id"] == default_org_id


def test_execution_scope_rejects_archived_config() -> None:
    issue = validate_config_execution_scope(
        _config(status="archived"),
        actor_user_id=uuid.uuid4(),
        owner_scope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
        organization_id=uuid.uuid4(),
        usable_in="shared_sandboxes",
    )

    assert issue is not None
    assert issue.code == "agent_run_config_not_found"


def test_execution_scope_rejects_personal_config_for_shared_sandbox() -> None:
    user_id = uuid.uuid4()
    issue = validate_config_execution_scope(
        _config(
            owner_scope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
            owner_user_id=user_id,
            organization_id=None,
        ),
        actor_user_id=user_id,
        owner_scope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
        organization_id=uuid.uuid4(),
        usable_in="shared_sandboxes",
    )

    assert issue is not None
    assert issue.code == "agent_run_config_not_usable"
