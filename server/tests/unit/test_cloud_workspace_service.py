from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.auth.authorization import OwnerContext
from proliferate.constants.billing import (
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
)
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service as workspace_service


def _denied_start_authorization(*, blocked_reason: str) -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=False,
        billing_subject_id=uuid4(),
        start_blocked=True,
        start_block_reason=blocked_reason,
        active_spend_hold=blocked_reason != WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
        hold_reason=(
            None
            if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
            else blocked_reason
        ),
        message=(
            "Sandbox limit reached. Archive or delete another cloud workspace before starting "
            "a new one."
            if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
            else "Cloud usage is paused because your included sandbox hours are exhausted."
        ),
        active_sandbox_count=(
            2 if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT else 0
        ),
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


def _billing_snapshot_from_authorization(
    authorization: SandboxStartAuthorization,
) -> SimpleNamespace:
    return SimpleNamespace(
        billing_subject_id=authorization.billing_subject_id,
        plan="free",
        payment_healthy=authorization.allowed,
        remaining_seconds=authorization.remaining_seconds,
        start_blocked=authorization.start_blocked,
        start_block_reason=authorization.start_block_reason,
    )


@pytest.mark.asyncio
async def test_org_cloud_workspace_create_uses_org_profile_and_managed_creator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    organization_id = uuid4()
    profile_id = uuid4()
    target_id = uuid4()
    workspace_id = uuid4()
    calls: dict[str, object] = {}

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

    async def _ensure_org_profile(db, *, user, organization_id):
        calls["ensure_org_profile"] = (db, user.id, organization_id)
        return SimpleNamespace(id=profile_id, primary_target_id=target_id)

    async def _resolve_managed_create(_user, **kwargs):
        calls["resolve_managed_create"] = (_user.id, kwargs)
        return workspace_service.ResolvedCloudWorkspaceCreate(
            git_provider=kwargs["git_provider"],
            git_owner=kwargs["git_owner"],
            git_repo_name=kwargs["git_repo_name"],
            git_branch=kwargs["branch_name"],
            git_base_branch=kwargs["base_branch"],
            display_name=kwargs["display_name"],
            active_sandbox_count=0,
            selected_agent_kinds=(),
            cloud_repo_limit=10,
        )

    async def _create_managed_workspace(db, **kwargs):
        calls["create_managed_workspace"] = (db, kwargs)
        return SimpleNamespace(id=workspace_id)

    async def _build_workspace_detail(workspace):
        calls["build_workspace_detail"] = workspace.id
        return SimpleNamespace(id=workspace.id)

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("org cloud create must not use personal cloud helpers")

    class _Db:
        async def commit(self) -> None:
            calls["commit"] = True

        async def refresh(self, workspace) -> None:
            calls["refresh"] = workspace.id

    monkeypatch.setattr(workspace_service, "resolve_owner_context", _resolve_owner_context)
    monkeypatch.setattr(
        workspace_service,
        "ensure_organization_sandbox_profile",
        _ensure_org_profile,
    )
    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_managed_cloud_workspace_create",
        _resolve_managed_create,
    )
    monkeypatch.setattr(
        workspace_service,
        "create_managed_cloud_workspace_for_profile",
        _create_managed_workspace,
    )
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda _workspace_id: None,
    )
    monkeypatch.setattr(
        workspace_service,
        "get_configured_sandbox_provider",
        lambda: SimpleNamespace(template_version="test-template"),
    )
    monkeypatch.setattr(workspace_service, "_resolve_new_cloud_workspace_create", _unexpected)
    monkeypatch.setattr(workspace_service, "create_cloud_workspace_for_user", _unexpected)

    db = _Db()
    result = await workspace_service.create_cloud_workspace(
        user,
        db=db,  # type: ignore[arg-type]
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        base_branch="main",
        branch_name="feature/cloud",
        display_name=None,
        owner_selection=workspace_service.OwnerSelection(
            owner_scope="organization",
            organization_id=organization_id,
        ),
    )

    assert result.id == workspace_id
    assert calls["ensure_org_profile"] == (db, user.id, organization_id)
    resolved_user_id, resolved_kwargs = calls["resolve_managed_create"]  # type: ignore[misc]
    assert resolved_user_id == user.id
    assert resolved_kwargs["sandbox_profile_id"] == profile_id
    assert resolved_kwargs["target_id"] == target_id
    _, create_kwargs = calls["create_managed_workspace"]  # type: ignore[misc]
    assert create_kwargs["sandbox_profile_id"] == profile_id
    assert create_kwargs["target_id"] == target_id
    assert create_kwargs["created_by_user_id"] == user.id
    assert create_kwargs["template_version"] == "test-template"
    assert calls["commit"] is True
    assert calls["refresh"] == workspace_id


@pytest.mark.asyncio
async def test_create_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _existing_workspace(**_kwargs):
        return None

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("downstream workspace creation should not run when billing blocks")

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, env_vars={}, default_branch=None)

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "_load_personal_agent_auth_agent_kinds", _unexpected)
    monkeypatch.setattr(workspace_service, "create_cloud_workspace_for_user", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.create_cloud_workspace(
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

    async def _existing_workspace(**_kwargs):
        return None

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _billing_snapshot(_billing_subject_id):
        return SimpleNamespace()

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, default_branch="main")

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot_for_subject", _billing_snapshot)
    monkeypatch.setattr(workspace_service, "repo_limit_for_billing_snapshot", lambda _snapshot: 4)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service._resolve_new_cloud_workspace_create(
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
        workspace_service,
        "_resolve_new_cloud_workspace_create",
        _unexpected,
    )
    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_managed_cloud_workspace_create",
        _unexpected,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.create_cloud_workspace_for_automation_run(
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
async def test_launch_preflight_reports_compute_billing_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    billing_subject_id = uuid4()
    authorization = _denied_start_authorization(
        blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
    )

    async def _resolve_owner_context(_user, owner_selection, *, db):
        assert owner_selection.owner_scope == "personal"
        assert db is not None
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=user.id,
            owner_user_id=user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=billing_subject_id,
        )

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return authorization

    async def _snapshot(_billing_subject_id):
        assert _billing_subject_id == authorization.billing_subject_id
        return _billing_snapshot_from_authorization(authorization)

    monkeypatch.setattr(workspace_service, "resolve_owner_context", _resolve_owner_context)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot_for_subject", _snapshot)

    result = await workspace_service.launch_cloud_workspace_preflight(
        object(),  # type: ignore[arg-type]
        user,  # type: ignore[arg-type]
        workspace_service.CloudWorkspaceLaunchPreflightRequest(),
    )

    assert result.launch_allowed is False
    assert result.blocked_reason == "compute_credits_exhausted"
    assert result.blocked_resource == "compute"
    assert result.billing.billing_subject_id == str(authorization.billing_subject_id)


@pytest.mark.asyncio
async def test_launch_preflight_reports_missing_personal_agent_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    billing_subject_id = uuid4()
    authorization = _allowed_start_authorization()

    async def _resolve_owner_context(_user, owner_selection, *, db):
        assert owner_selection.owner_scope == "personal"
        assert db is not None
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=user.id,
            owner_user_id=user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=billing_subject_id,
        )

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return authorization

    async def _snapshot(_billing_subject_id):
        assert _billing_subject_id == authorization.billing_subject_id
        return _billing_snapshot_from_authorization(authorization)

    async def _agent_kinds(_user_id):
        assert _user_id == user.id
        return ()

    monkeypatch.setattr(workspace_service, "resolve_owner_context", _resolve_owner_context)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot_for_subject", _snapshot)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_kinds,
    )

    result = await workspace_service.launch_cloud_workspace_preflight(
        object(),  # type: ignore[arg-type]
        user,  # type: ignore[arg-type]
        workspace_service.CloudWorkspaceLaunchPreflightRequest(
            requiredManagedResources=["llm"],
            requiredAgentKind="codex",
        ),
    )

    assert result.launch_allowed is False
    assert result.blocked_reason == "managed_credit_agent_not_configured"
    assert result.blocked_resource == "llm"
    assert result.billing.managed_llm_status == "agent_auth_missing"


@pytest.mark.asyncio
async def test_create_cloud_workspace_returns_pending_after_queueing_provision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(id=uuid4(), status=workspace_service.CloudWorkspaceStatus.pending)
    scheduled: list[object] = []

    async def _resolve_new_cloud_workspace_create(*_args, **_kwargs):
        return workspace_service.ResolvedCloudWorkspaceCreate(
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

    async def _create_cloud_workspace_for_user(**_kwargs):
        return workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_cloud_workspace_create",
        _resolve_new_cloud_workspace_create,
    )
    monkeypatch.setattr(
        workspace_service,
        "create_cloud_workspace_for_user",
        _create_cloud_workspace_for_user,
    )
    monkeypatch.setattr(
        workspace_service,
        "get_configured_sandbox_provider",
        lambda: SimpleNamespace(template_version="v1"),
    )
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id: scheduled.append(workspace_id),
    )
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)

    payload = await workspace_service.create_cloud_workspace(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        base_branch="main",
        branch_name="feature/cloud",
        display_name=None,
    )

    assert payload.status == workspace_service.CloudWorkspaceStatus.pending
    assert scheduled == [workspace.id]


@pytest.mark.asyncio
async def test_delete_cloud_workspace_destroys_runtime_before_archiving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(id=workspace_id)
    calls: list[tuple[str, object]] = []

    async def _cloud_workspace_user_can_archive(_user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        calls.append(("load", _workspace_id))
        return workspace

    async def _revoke_claim_tokens_for_workspace(_workspace, *, reason: str) -> None:
        assert _workspace is workspace
        calls.append(("revoke", reason))

    async def _destroy_workspace_runtime(_workspace) -> None:
        assert _workspace is workspace
        calls.append(("destroy", _workspace.id))

    async def _delete_cloud_workspace_records_for_workspace(_workspace) -> None:
        assert _workspace is workspace
        calls.append(("archive", _workspace.id))

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_archive",
        _cloud_workspace_user_can_archive,
    )
    monkeypatch.setattr(
        workspace_service,
        "_revoke_claim_tokens_for_workspace",
        _revoke_claim_tokens_for_workspace,
    )
    monkeypatch.setattr(
        workspace_service,
        "_destroy_workspace_runtime",
        _destroy_workspace_runtime,
    )
    monkeypatch.setattr(
        workspace_service,
        "delete_cloud_workspace_records_for_workspace",
        _delete_cloud_workspace_records_for_workspace,
    )

    await workspace_service.delete_cloud_workspace(user_id, workspace_id)

    assert calls == [
        ("load", workspace_id),
        ("revoke", "workspace_deleted"),
        ("destroy", workspace_id),
        ("archive", workspace_id),
    ]


@pytest.mark.asyncio
async def test_destroy_workspace_runtime_skips_shared_profile_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = SimpleNamespace(
        id=uuid4(),
        active_sandbox_id=None,
        status=workspace_service.CloudWorkspaceStatus.ready.value,
        status_detail="Ready",
        updated_at=None,
    )
    calls: list[str] = []

    async def _load_cloud_sandbox_by_id(_sandbox_id):
        raise AssertionError("shared profile slot should not be loaded from workspace destroy")

    async def _persist_workspace_destroy_state(_workspace) -> None:
        assert _workspace is workspace
        calls.append("persist")

    monkeypatch.setattr(
        workspace_service,
        "load_cloud_sandbox_by_id",
        _load_cloud_sandbox_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "persist_workspace_destroy_state",
        _persist_workspace_destroy_state,
    )

    await workspace_service._destroy_workspace_runtime(workspace)

    assert calls == ["persist"]
    assert workspace.status == workspace_service.CloudWorkspaceStatus.archived.value


@pytest.mark.asyncio
async def test_start_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        status="stopped",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
    )

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("workspace start should stop before credential/runtime work")

    monkeypatch.setattr(workspace_service, "cloud_workspace_user_can_interact", _require_workspace)
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "_load_personal_agent_auth_agent_kinds", _unexpected)
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.start_cloud_workspace(user, uuid4())

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "Sandbox limit reached" in exc_info.value.message


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_error_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.error.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error="old error",
        status_detail="Error",
        ready_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    saved_statuses: list[tuple[object, object]] = []
    scheduled: list[object] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
    )

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert workspace.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert workspace.last_error is None
    assert saved_statuses == [(workspace_service.CloudWorkspaceStatus.materializing.value, None)]
    assert scheduled == [workspace.id]


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_queued_workspace_for_mobility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.pending.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        last_error="stale error",
        ready_at=None,
    )
    scheduled: list[tuple[object, object]] = []
    saved_statuses: list[tuple[object, object]] = []
    refreshed_env_snapshots: list[object] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _refresh_repo_env_snapshot_for_workspace(_workspace):
        refreshed_env_snapshots.append(_workspace.id)
        return _workspace

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(
        workspace_service,
        "_refresh_repo_env_snapshot_for_workspace",
        _refresh_repo_env_snapshot_for_workspace,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **kwargs: scheduled.append(
            (workspace_id, kwargs.get("requested_base_sha"))
        ),
    )

    payload = await workspace_service.start_cloud_workspace(
        user,
        workspace.id,
        requested_base_sha="abc123",
    )

    assert payload.status == workspace_service.CloudWorkspaceStatus.pending.value
    assert refreshed_env_snapshots == [workspace.id]
    assert saved_statuses == [(workspace_service.CloudWorkspaceStatus.pending.value, None)]
    assert scheduled == [(workspace.id, "abc123")]


@pytest.mark.asyncio
async def test_start_cloud_workspace_returns_ready_workspace_without_requeue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.ready.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error=None,
        status_detail="Stopped",
        updated_at=datetime.now(UTC),
        ready_at=datetime.now(UTC),
    )

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("ready workspace should not schedule provisioning work")

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)
    monkeypatch.setattr(workspace_service, "schedule_workspace_provision", _unexpected)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.CloudWorkspaceStatus.ready.value
    assert workspace.status == workspace_service.CloudWorkspaceStatus.ready.value
