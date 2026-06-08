from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.auth.authorization import OwnerContext, OwnerSelection
from proliferate.constants.billing import WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.provisioning import models as provisioning_models
from proliferate.server.cloud.workspaces.provisioning import preflight as provisioning_preflight
from proliferate.server.cloud.workspaces.provisioning import service as provisioning_service
from tests.unit.db_session_helpers import NoopDb, patch_async_session_factory


def _patch_session_factory(monkeypatch: pytest.MonkeyPatch) -> NoopDb:
    return patch_async_session_factory(monkeypatch, provisioning_service.db_session.db_engine)


def _denied_start_authorization(*, blocked_reason: str) -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=False,
        billing_subject_id=uuid4(),
        start_blocked=True,
        start_block_reason=blocked_reason,
        active_spend_hold=True,
        hold_reason=blocked_reason,
        message="Cloud usage is paused because your included sandbox hours are exhausted.",
        active_sandbox_count=0,
        remaining_seconds=0.0,
    )


def _allowed_start_authorization() -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=True,
        billing_subject_id=uuid4(),
        start_blocked=False,
        start_block_reason=None,
        active_spend_hold=False,
        hold_reason=None,
        message=None,
        active_sandbox_count=0,
        remaining_seconds=19.0 * 3600.0,
    )


@pytest.mark.asyncio
async def test_org_cloud_workspace_create_fails_before_personal_helpers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    organization_id = uuid4()

    async def _resolve_owner_context(_user, owner_selection, *, db):
        assert db is not None
        assert owner_selection.owner_scope == "organization"
        assert owner_selection.organization_id == organization_id
        return OwnerContext(
            owner_scope="organization",
            actor_user_id=user.id,
            owner_user_id=None,
            organization_id=organization_id,
            membership_id=uuid4(),
            membership_role="owner",
            billing_subject_id=uuid4(),
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("org cloud create must fail before personal cloud helpers")

    monkeypatch.setattr(
        provisioning_service,
        "resolve_owner_context",
        _resolve_owner_context,
    )
    monkeypatch.setattr(
        provisioning_service,
        "resolve_new_cloud_workspace_create",
        _unexpected,
    )
    monkeypatch.setattr(
        provisioning_service,
        "create_cloud_workspace_for_user",
        _unexpected,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await provisioning_service.create_cloud_workspace(
            user,
            db=object(),  # type: ignore[arg-type]
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch="main",
            branch_name="feature/cloud",
            display_name=None,
            owner_selection=OwnerSelection(
                owner_scope="organization",
                organization_id=organization_id,
            ),
        )

    assert exc_info.value.code == "org_cloud_not_ready"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_create_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"], default_branch="main")

    async def _existing_workspace(*_args, **_kwargs):
        return None

    async def _active_cloud_branches(*_args, **_kwargs):
        return set()

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("downstream workspace creation should not run when billing blocks")

    async def _repo_config_value(*_args, **_kwargs):
        return SimpleNamespace(configured=True, env_vars={}, default_branch=None)

    monkeypatch.setattr(
        provisioning_preflight,
        "get_linked_github_account",
        lambda _user: object(),
    )
    monkeypatch.setattr(provisioning_preflight, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(
        provisioning_preflight,
        "get_existing_cloud_workspace",
        _existing_workspace,
    )
    monkeypatch.setattr(
        provisioning_preflight,
        "list_active_cloud_workspace_branches_for_user_repo",
        _active_cloud_branches,
    )
    monkeypatch.setattr(provisioning_preflight, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(provisioning_preflight, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_preflight,
        "load_personal_agent_auth_agent_kinds",
        _unexpected,
    )
    monkeypatch.setattr(
        provisioning_service,
        "create_cloud_workspace_for_user",
        _unexpected,
    )
    _patch_session_factory(monkeypatch)

    with pytest.raises(CloudApiError) as exc_info:
        await provisioning_service.create_cloud_workspace(
            user,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch="main",
            branch_name="feature/cloud",
            display_name=None,
        )

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "sandbox hours are exhausted" in exc_info.value.message


@pytest.mark.asyncio
async def test_automation_workspace_requires_selected_agent_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"], default_branch="main")

    async def _existing_workspace(*_args, **_kwargs):
        return None

    async def _active_cloud_branches(*_args, **_kwargs):
        return set()

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _billing_snapshot(_billing_subject_id):
        return SimpleNamespace()

    async def _repo_config_value(*_args, **_kwargs):
        return SimpleNamespace(configured=True, default_branch="main")

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    monkeypatch.setattr(
        provisioning_preflight,
        "get_linked_github_account",
        lambda _user: object(),
    )
    monkeypatch.setattr(provisioning_preflight, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(
        provisioning_preflight,
        "get_existing_cloud_workspace",
        _existing_workspace,
    )
    monkeypatch.setattr(
        provisioning_preflight,
        "list_active_cloud_workspace_branches_for_user_repo",
        _active_cloud_branches,
    )
    monkeypatch.setattr(provisioning_preflight, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(provisioning_preflight, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_preflight,
        "get_billing_snapshot_for_subject",
        _billing_snapshot,
    )
    monkeypatch.setattr(
        provisioning_preflight,
        "repo_limit_for_billing_snapshot",
        lambda _snapshot: 4,
    )
    monkeypatch.setattr(
        provisioning_preflight,
        "load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    _patch_session_factory(monkeypatch)

    with pytest.raises(CloudApiError) as exc_info:
        await provisioning_preflight.resolve_new_cloud_workspace_create(
            user,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch=None,
            branch_name="automation/run-123",
            display_name=None,
            required_agent_kind="codex",
        )

    assert exc_info.value.code == "missing_agent_credentials"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_automation_workspace_requires_managed_target_and_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("automation workspace must not fall back to legacy creation")

    monkeypatch.setattr(
        provisioning_service,
        "resolve_new_cloud_workspace_create",
        _unexpected,
    )
    monkeypatch.setattr(
        provisioning_service,
        "resolve_new_managed_cloud_workspace_create",
        _unexpected,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await provisioning_service.create_cloud_workspace_for_automation_run(
            user,  # type: ignore[arg-type]
            run_id=uuid4(),
            claim_id=uuid4(),
            target_id=uuid4(),
            sandbox_profile_id=None,
            git_owner="acme",
            git_repo_name="rocket",
            branch_name="automation/run-123",
            display_name="Automation run",
            required_agent_kind="codex",
        )

    assert exc_info.value.code == "target_required"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_create_cloud_workspace_returns_pending_after_queueing_provision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(id=uuid4(), status=CloudWorkspaceStatus.pending)
    scheduled: list[object] = []
    create_kwargs: dict[str, object] = {}

    async def _resolve_new_cloud_workspace_create(*_args, **_kwargs):
        return provisioning_models.ResolvedCloudWorkspaceCreate(
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="feature/cloud",
            git_base_branch="main",
            display_name=None,
            active_sandbox_count=0,
            selected_agent_kinds=("claude",),
            cloud_repo_limit=4,
        )

    async def _create_cloud_workspace_for_user(*_args, **_kwargs):
        create_kwargs.update(_kwargs)
        return workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        provisioning_service,
        "resolve_new_cloud_workspace_create",
        _resolve_new_cloud_workspace_create,
    )
    monkeypatch.setattr(
        provisioning_service,
        "create_cloud_workspace_for_user",
        _create_cloud_workspace_for_user,
    )
    monkeypatch.setattr(
        provisioning_service,
        "get_configured_sandbox_provider",
        lambda: SimpleNamespace(template_version="v1"),
    )
    monkeypatch.setattr(
        provisioning_service,
        "schedule_workspace_provision",
        lambda workspace_id: scheduled.append(workspace_id),
    )
    monkeypatch.setattr(provisioning_service, "build_workspace_detail", _build_workspace_detail)
    _patch_session_factory(monkeypatch)

    payload = await provisioning_service.create_cloud_workspace(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        base_branch="main",
        branch_name="feature/cloud",
        display_name=None,
        source="mobile",
    )

    assert payload.status == CloudWorkspaceStatus.pending
    assert scheduled == [workspace.id]
    assert create_kwargs["origin"] == "manual_mobile"
    assert create_kwargs["origin_json"] == '{"kind":"human","entrypoint":"mobile"}'


@pytest.mark.asyncio
async def test_ensure_cloud_workspace_replaces_failed_unmaterialized_retry_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    failed_workspace = SimpleNamespace(
        id=uuid4(),
        status=CloudWorkspaceStatus.error.value,
        anyharness_workspace_id=None,
        last_error="mobility destination conflict: destination path already exists",
    )
    created_workspace = SimpleNamespace(id=uuid4())
    archived: list[object] = []
    created: list[dict[str, object]] = []

    async def _get_existing_cloud_workspace(*_args, **_kwargs):
        return failed_workspace

    async def _archive_failed(workspace_id):
        archived.append(workspace_id)

    async def _load_repo_config_value(*_args, **_kwargs):
        return SimpleNamespace(configured=True)

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _get_billing_snapshot_for_subject(_subject_id):
        return SimpleNamespace()

    def _repo_limit_for_billing_snapshot(_snapshot):
        return 10

    async def _create_cloud_workspace_for_user(*_args, **kwargs):
        created.append(kwargs)
        return created_workspace

    monkeypatch.setattr(
        provisioning_service,
        "get_linked_github_account",
        lambda _user: SimpleNamespace(),
    )
    monkeypatch.setattr(
        provisioning_service,
        "get_existing_cloud_workspace",
        _get_existing_cloud_workspace,
    )
    monkeypatch.setattr(
        provisioning_service.lifecycle_service,
        "archive_failed_cloud_workspace_for_mobility_retry",
        _archive_failed,
    )
    monkeypatch.setattr(
        provisioning_service,
        "load_repo_config_value_tx",
        _load_repo_config_value,
    )
    monkeypatch.setattr(provisioning_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        provisioning_service,
        "get_billing_snapshot_for_subject",
        _get_billing_snapshot_for_subject,
    )
    monkeypatch.setattr(
        provisioning_service,
        "repo_limit_for_billing_snapshot",
        _repo_limit_for_billing_snapshot,
    )
    monkeypatch.setattr(
        provisioning_service,
        "create_cloud_workspace_for_user",
        _create_cloud_workspace_for_user,
    )

    result = await provisioning_service.ensure_cloud_workspace_for_existing_branch(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        branch_name="feature/cloud",
        display_name="Rocket",
    )

    assert result is created_workspace
    assert archived == [failed_workspace.id]
    assert created
    assert created[0]["git_branch"] == "feature/cloud"
    assert created[0]["display_name"] == "Rocket"


@pytest.mark.asyncio
async def test_ensure_cloud_workspace_reuses_materialized_error_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    existing_workspace = SimpleNamespace(
        id=uuid4(),
        status=CloudWorkspaceStatus.error.value,
        anyharness_workspace_id="workspace-1",
        last_error="agent runtime failed",
    )

    async def _get_existing_cloud_workspace(*_args, **_kwargs):
        return existing_workspace

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("materialized error workspace should be reused for start retry")

    monkeypatch.setattr(
        provisioning_service,
        "get_linked_github_account",
        lambda _user: SimpleNamespace(),
    )
    monkeypatch.setattr(
        provisioning_service,
        "get_existing_cloud_workspace",
        _get_existing_cloud_workspace,
    )
    monkeypatch.setattr(
        provisioning_service.lifecycle_service,
        "archive_failed_cloud_workspace_for_mobility_retry",
        _unexpected,
    )
    monkeypatch.setattr(
        provisioning_service,
        "create_cloud_workspace_for_user",
        _unexpected,
    )
    _patch_session_factory(monkeypatch)

    result = await provisioning_service.ensure_cloud_workspace_for_existing_branch(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        branch_name="feature/cloud",
        display_name="Rocket",
    )

    assert result is existing_workspace
