from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from proliferate.constants.automations import (
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
)
from proliferate.db.store.cloud_agent_run_config.configs import CloudAgentRunConfigRecord
from proliferate.server.catalogs.service import read_agent_catalog
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    ResolvedAgentRunConfig,
    canonical_model_id_for_config,
    resolve_runtime_values,
    validate_config_execution_scope,
    validate_config_values,
)
from proliferate.server.cloud.agent_run_config import service
from proliferate.server.cloud.agent_run_config.models import (
    AgentRunConfigCreateRequest,
    AgentRunConfigUpdateRequest,
)
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


def _run_config_record(**overrides: object) -> CloudAgentRunConfigRecord:
    now = datetime.now(UTC)
    values = {
        "id": uuid.uuid4(),
        "owner_scope": CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
        "owner_user_id": uuid.uuid4(),
        "organization_id": None,
        "created_by_user_id": uuid.uuid4(),
        "name": "Legacy config",
        "agent_kind": "cursor",
        "model_id": "composer-2-fast",
        "control_values_json": {},
        "usable_in_personal_sandboxes": True,
        "usable_in_shared_sandboxes": False,
        "seed_key": None,
        "system_default_rank": None,
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "archived_at": None,
    }
    values.update(overrides)
    return CloudAgentRunConfigRecord(**values)  # type: ignore[arg-type]


def test_model_aliases_validate_and_resolve_to_canonical_catalog_ids() -> None:
    catalog = read_agent_catalog().catalog
    cases = [
        ("cursor", "default[]", "auto"),
        ("cursor", "composer-2-fast", "composer-2.5-fast"),
        ("cursor", "composer-2", "composer-2.5"),
        (
            "cursor",
            "gpt-5.3-codex[reasoning=medium,fast=false]",
            "gpt-5.3-codex",
        ),
        ("cursor", "gpt-5.3-codex-spark-preview-low", "gpt-5.3-codex-low"),
        ("cursor", "gpt-5.3-codex-spark-preview", "gpt-5.3-codex"),
        ("cursor", "gpt-5.3-codex-spark-preview-high", "gpt-5.3-codex-high"),
        ("cursor", "gpt-5.3-codex-spark-preview-xhigh", "gpt-5.3-codex-xhigh"),
    ]

    for agent_kind, legacy_model_id, canonical_model_id in cases:
        assert validate_config_values(
            catalog,
            agent_kind=agent_kind,
            model_id=legacy_model_id,
            control_values={},
        ) is None
        assert canonical_model_id_for_config(
            catalog,
            agent_kind=agent_kind,
            model_id=legacy_model_id,
        ) == canonical_model_id

        resolved = resolve_runtime_values(
            catalog,
            _run_config_record(agent_kind=agent_kind, model_id=legacy_model_id),
        )

        assert isinstance(resolved, ResolvedAgentRunConfig)
        assert resolved.model_id == canonical_model_id


@pytest.mark.asyncio
async def test_create_agent_run_config_stores_canonical_model_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def fake_create_config(*args: object, **kwargs: object) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(**kwargs, id=uuid.uuid4())

    monkeypatch.setattr(service.config_store, "create_config", fake_create_config)

    await service.create_agent_run_config(
        None,  # type: ignore[arg-type]
        SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
        AgentRunConfigCreateRequest(
            ownerScope=CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
            name="Cursor legacy",
            agentKind="cursor",
            modelId="composer-2-fast",
            controlValues={},
        ),
    )

    assert captured["model_id"] == "composer-2.5-fast"


@pytest.mark.asyncio
async def test_update_agent_run_config_stores_canonical_model_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_id = uuid.uuid4()
    user_id = uuid.uuid4()
    existing = _run_config_record(
        id=config_id,
        owner_user_id=user_id,
        created_by_user_id=user_id,
        agent_kind="cursor",
        model_id="composer-2.5-fast",
    )
    captured: dict[str, object] = {}

    async def fake_visible_config(*args: object, **kwargs: object) -> CloudAgentRunConfigRecord:
        return existing

    async def fake_update_config(*args: object, **kwargs: object) -> CloudAgentRunConfigRecord:
        captured.update(kwargs)
        return _run_config_record(
            id=config_id,
            owner_user_id=user_id,
            created_by_user_id=user_id,
            agent_kind="cursor",
            model_id=str(kwargs["model_id"]),
        )

    monkeypatch.setattr(service, "_visible_config", fake_visible_config)
    monkeypatch.setattr(service.config_store, "update_config", fake_update_config)

    await service.update_agent_run_config(
        None,  # type: ignore[arg-type]
        SimpleNamespace(id=user_id),  # type: ignore[arg-type]
        config_id,
        AgentRunConfigUpdateRequest(modelId="gpt-5.3-codex-spark-preview"),
    )

    assert captured["model_id"] == "gpt-5.3-codex"


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
