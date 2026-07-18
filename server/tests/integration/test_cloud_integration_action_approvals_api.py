"""Durable, product-authenticated, one-time integration action approvals."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.integration_approvals import (
    CloudIntegrationActionApproval,
    CloudIntegrationActionApprovalEvent,
)
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.integration_gateway.domain.execution_session import (
    verify_execution_session_token,
)
from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    ToolCallRequiresApproval,
    decide_tool_call,
)
from proliferate.server.cloud.integrations.action_approvals.domain.actions import (
    canonical_payload_digest,
)
from proliferate.server.cloud.integrations.action_approvals.transactions import (
    consume_action_for_execution_committed,
)
from proliferate.utils.crypto import encrypt_json
from tests.integration.test_cloud_integration_gateway_api import (
    GATEWAY_URL,
    _authed_user,
    _tool_call,
)
from tests.integration.test_cloud_integration_gateway_tool_policy_api import (
    _seed_ready_slack_account,
)

APPROVALS_URL = "/v1/cloud/integrations/action-approvals"
MCP_SESSION_HEADER = "Mcp-Session-Id"
WORKSPACE_HEADER = "Proliferate-Workspace-Id"
ANYHARNESS_SESSION_HEADER = "Proliferate-Session-Id"


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


@dataclass(frozen=True)
class ActionContext:
    auth: object
    worker_token: str
    gateway_bearer: str
    gateway_session_token: str
    gateway_session_id: uuid.UUID
    workspace_id: str
    anyharness_session_id: str
    worker_id: uuid.UUID
    user_id: uuid.UUID
    organization_id: uuid.UUID | None
    account_id: uuid.UUID
    account_auth_version: int

    @property
    def grant(self) -> IntegrationGatewayGrant:
        return IntegrationGatewayGrant(
            runtime_worker_id=self.worker_id,
            runtime_kind="desktop",
            owner_user_id=self.user_id,
            organization_id=self.organization_id,
        )

    @property
    def gateway_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.gateway_bearer}",
            MCP_SESSION_HEADER: self.gateway_session_token,
            WORKSPACE_HEADER: self.workspace_id,
            ANYHARNESS_SESSION_HEADER: self.anyharness_session_id,
        }


async def _initialize_gateway_session(
    client: AsyncClient,
    *,
    gateway_bearer: str,
    worker_id: uuid.UUID,
    workspace_id: str,
    anyharness_session_id: str,
) -> tuple[str, uuid.UUID]:
    initialized = await client.post(
        GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {gateway_bearer}",
            WORKSPACE_HEADER: workspace_id,
            ANYHARNESS_SESSION_HEADER: anyharness_session_id,
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert initialized.status_code == 200, initialized.text
    token = initialized.headers[MCP_SESSION_HEADER]
    session_id = verify_execution_session_token(
        secret=settings.cloud_secret_key,
        runtime_worker_id=worker_id,
        token=token,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
    )
    assert session_id is not None
    return token, session_id


async def _setup_context(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    prefix: str,
    organization_scoped: bool = False,
) -> ActionContext:
    auth = await _authed_user(client, db_session, prefix=prefix)
    user_id = uuid.UUID(auth.user_id)
    organization_id: uuid.UUID | None = None
    if organization_scoped:
        organizations = await organizations_store.list_organizations_for_user(
            db_session,
            user_id,
        )
        assert organizations
        organization_id = organizations[0].organization.id
    enrollment_body = {"desktopInstallId": f"install-{prefix}"}
    if organization_id is not None:
        enrollment_body["organizationId"] = str(organization_id)
    enrollment = await client.post(
        "/v1/cloud/workers/desktop/enrollment",
        headers=auth.headers,
        json=enrollment_body,
    )
    assert enrollment.status_code == 200, enrollment.text
    enrolled = await client.post(
        "/v1/cloud/worker/enroll",
        json={"enrollmentToken": enrollment.json()["enrollmentToken"]},
    )
    assert enrolled.status_code == 200, enrolled.text
    await _seed_ready_slack_account(db_session, user_id=user_id)
    worker = (
        await db_session.execute(
            select(CloudRuntimeWorker).where(CloudRuntimeWorker.owner_user_id == user_id)
        )
    ).scalar_one()
    account = (await accounts_store.list_accounts_for_user(db_session, user_id))[0]
    gateway_bearer = enrolled.json()["integrationGateway"]["authorization"].removeprefix("Bearer ")
    workspace_id = f"workspace-{prefix}"
    anyharness_session_id = f"session-{prefix}"
    gateway_session_token, gateway_session_id = await _initialize_gateway_session(
        client,
        gateway_bearer=gateway_bearer,
        worker_id=worker.id,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
    )
    return ActionContext(
        auth=auth,
        worker_token=enrolled.json()["workerToken"],
        gateway_bearer=gateway_bearer,
        gateway_session_token=gateway_session_token,
        gateway_session_id=gateway_session_id,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
        worker_id=worker.id,
        user_id=user_id,
        organization_id=worker.organization_id,
        account_id=account.id,
        account_auth_version=account.auth_version,
    )


def _approval_verdict(
    *, provider: str = "slack", tool: str = "slack_send_message"
) -> ToolCallRequiresApproval:
    decision = decide_tool_call(provider=provider, tool=tool)
    assert isinstance(decision, ToolCallRequiresApproval)
    return decision


async def _request_action(
    client: AsyncClient,
    context: ActionContext,
    *,
    arguments: dict[str, object],
    tool: str = "slack_send_message",
    headers: dict[str, str] | None = None,
) -> dict[str, object]:
    result = await _tool_call(
        client,
        headers or context.gateway_headers,
        name="integrations.call_tool",
        arguments={"provider": "slack", "tool": tool, "arguments": arguments},
    )
    assert result["isError"] is True
    error = result["structuredContent"]["error"]
    assert error["code"] == "integration_tool_approval_required"
    return error["approval"]


async def _consume(
    context: ActionContext,
    *,
    approval_id: str,
    arguments: dict[str, object],
    grant: IntegrationGatewayGrant | None = None,
    gateway_session_id: uuid.UUID | None = None,
    workspace_id: str | None = None,
    anyharness_session_id: str | None = None,
    integration_account_id: uuid.UUID | None = None,
    integration_account_auth_version: int | None = None,
    verdict: ToolCallRequiresApproval | None = None,
):
    return await consume_action_for_execution_committed(
        approval_id=uuid.UUID(approval_id),
        grant=grant or context.grant,
        gateway_session_id=gateway_session_id or context.gateway_session_id,
        workspace_id=workspace_id or context.workspace_id,
        anyharness_session_id=anyharness_session_id or context.anyharness_session_id,
        integration_account_id=integration_account_id or context.account_id,
        integration_account_auth_version=(
            context.account_auth_version
            if integration_account_auth_version is None
            else integration_account_auth_version
        ),
        verdict=verdict or _approval_verdict(),
        arguments=arguments,
    )


async def _approve(client: AsyncClient, context: ActionContext, approval_id: str) -> dict:
    response = await client.post(
        f"{APPROVALS_URL}/{approval_id}/approve",
        headers=context.auth.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_gateway_requires_trusted_session_then_persists_one_safe_bound_retry(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = await _setup_context(client, db_session, prefix="approval-request")
    arguments = {
        "channel_id": "#ghp_abcdefghijklmnopqrstuvwxyz1234567890",
        "channel": "C-actual",
        "message": "Ship the release",
        "text": "authorization: Basic dXNlcjpwYXNz",
        "blocks": [{"type": "section", "text": "AWS key AKIAIOSFODNN7EXAMPLE"}],
        "metadata": {"approvalToken": "must-not-leak", "b": 2, "a": 1},
    }

    async def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("approval-gated action entered credential or provider access")

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.resolve_launch", forbidden
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.account_for_provider",
        forbidden,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool", forbidden
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.integrations.action_approvals.service."
        "accounts_store.get_ready_account_for_provider",
        forbidden,
    )

    without_session = await _tool_call(
        client,
        {"Authorization": f"Bearer {context.gateway_bearer}"},
        name="integrations.call_tool",
        arguments={
            "provider": "slack",
            "tool": "slack_send_message",
            "arguments": arguments,
        },
    )
    assert without_session["structuredContent"]["error"]["code"] == (
        "integration_gateway_session_required"
    )

    legacy_initialize = await client.post(
        GATEWAY_URL,
        headers={"Authorization": f"Bearer {context.gateway_bearer}"},
        json={"jsonrpc": "2.0", "id": 2, "method": "initialize"},
    )
    assert legacy_initialize.status_code == 200
    unbound_session = await _tool_call(
        client,
        {
            "Authorization": f"Bearer {context.gateway_bearer}",
            MCP_SESSION_HEADER: legacy_initialize.headers[MCP_SESSION_HEADER],
        },
        name="integrations.call_tool",
        arguments={
            "provider": "slack",
            "tool": "slack_send_message",
            "arguments": arguments,
        },
    )
    assert unbound_session["structuredContent"]["error"]["code"] == (
        "integration_gateway_session_required"
    )
    assert not list((await db_session.execute(select(CloudIntegrationActionApproval))).scalars())

    first, retry = await asyncio.gather(
        _request_action(client, context, arguments=arguments),
        _request_action(
            client,
            context,
            arguments={
                "blocks": [{"text": "AWS key AKIAIOSFODNN7EXAMPLE", "type": "section"}],
                "channel": "C-actual",
                "metadata": {"a": 1, "b": 2, "approvalToken": "must-not-leak"},
                "message": "Ship the release",
                "channel_id": "#ghp_abcdefghijklmnopqrstuvwxyz1234567890",
                "text": "authorization: Basic dXNlcjpwYXNz",
            },
        ),
    )
    assert first["id"] == retry["id"]
    assert first["status"] == retry["status"] == "pending"
    assert first["payloadDigest"] == canonical_payload_digest(arguments)
    assert first["integrationAccountId"] == str(context.account_id)
    assert first["integrationAccountAuthVersion"] == context.account_auth_version
    assert first["executionSessionId"] == str(context.gateway_session_id)
    assert first["workspaceId"] == context.workspace_id
    assert first["anyharnessSessionId"] == context.anyharness_session_id
    assert first["target"] is None
    assert first["contentPreview"] is None
    assert first["contentCharacterCount"] is None
    assert "must-not-leak" not in str(first)
    assert "dXNlcjpwYXNz" not in str(first)
    assert "AKIAIOSFODNN7EXAMPLE" not in str(first)
    assert "ghp_abcdefghijklmnopqrstuvwxyz1234567890" not in str(first)

    approvals = list(
        (await db_session.execute(select(CloudIntegrationActionApproval))).scalars().all()
    )
    assert len(approvals) == 1
    approval = approvals[0]
    assert approval.owner_user_id == context.user_id
    assert approval.organization_id == context.organization_id
    assert approval.integration_account_id == context.account_id
    assert approval.integration_account_auth_version == context.account_auth_version
    assert approval.runtime_worker_id == context.worker_id
    assert approval.gateway_session_id == context.gateway_session_id
    assert approval.workspace_id == context.workspace_id
    assert approval.anyharness_session_id == context.anyharness_session_id
    assert approval.provider_namespace == "slack"
    assert approval.tool_name == "slack_send_message"
    assert approval.payload_digest == canonical_payload_digest(arguments)
    assert approval.safe_target is None
    assert approval.safe_content_preview is None
    assert approval.safe_content_character_count is None

    events = list(
        (await db_session.execute(select(CloudIntegrationActionApprovalEvent))).scalars()
    )
    assert len(events) == 1
    assert (events[0].from_status, events[0].to_status) == (None, "pending")
    assert events[0].actor_type == "runtime_worker"
    assert events[0].actor_runtime_worker_id == context.worker_id


@pytest.mark.asyncio
async def test_only_product_owner_can_decide_and_decisions_are_idempotent(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await _setup_context(client, db_session, prefix="approval-owner")
    approval = await _request_action(client, context, arguments={"message": "hello"})
    approval_id = str(approval["id"])

    for machine_token in (context.worker_token, context.gateway_bearer):
        denied = await client.post(
            f"{APPROVALS_URL}/{approval_id}/approve",
            headers={"Authorization": f"Bearer {machine_token}"},
        )
        assert denied.status_code == 401

    outsider = await _authed_user(client, db_session, prefix="approval-outsider")
    outsider_decision = await client.post(
        f"{APPROVALS_URL}/{approval_id}/approve",
        headers=outsider.headers,
    )
    assert outsider_decision.status_code == 404

    listed = await client.get(APPROVALS_URL, headers=context.auth.headers)
    assert listed.status_code == 200
    listed_approval = listed.json()["items"][0]
    assert listed_approval["approvalId"] == approval_id
    assert listed_approval["accountLabel"].startswith("Slack connection ")
    assert listed_approval["sourceLabel"].startswith("Desktop workspace ")

    first = await _approve(client, context, approval_id)
    second = await _approve(client, context, approval_id)
    assert first["result"] == "applied"
    assert first["approval"]["status"] == "approved"
    assert second["result"] == "already_applied"


@pytest.mark.asyncio
async def test_exact_binding_mismatches_then_committed_consumption_and_replay(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await _setup_context(client, db_session, prefix="approval-binding")
    arguments = {"channel_id": "C1", "message": "exact"}
    approval = await _request_action(client, context, arguments=arguments)
    approval_id = str(approval["id"])
    await _approve(client, context, approval_id)

    grant_overrides = (
        IntegrationGatewayGrant(
            runtime_worker_id=context.worker_id,
            runtime_kind="desktop",
            owner_user_id=uuid.uuid4(),
            organization_id=context.organization_id,
        ),
        IntegrationGatewayGrant(
            runtime_worker_id=uuid.uuid4(),
            runtime_kind="desktop",
            owner_user_id=context.user_id,
            organization_id=context.organization_id,
        ),
        IntegrationGatewayGrant(
            runtime_worker_id=context.worker_id,
            runtime_kind="desktop",
            owner_user_id=context.user_id,
            organization_id=uuid.uuid4(),
        ),
    )
    for grant in grant_overrides:
        assert (
            await _consume(
                context,
                approval_id=approval_id,
                arguments=arguments,
                grant=grant,
            )
        ).result == "mismatch"

    mismatch_calls = (
        {"gateway_session_id": uuid.uuid4()},
        {"workspace_id": "workspace-other"},
        {"anyharness_session_id": "session-other"},
        {"integration_account_id": uuid.uuid4()},
        {"integration_account_auth_version": context.account_auth_version + 1},
        {"verdict": ToolCallRequiresApproval(provider="slack", tool="slack_edit_message")},
        {"arguments": {"channel_id": "C1", "message": "different"}},
    )
    for override in mismatch_calls:
        call_arguments = override.pop("arguments", arguments)
        assert (
            await _consume(
                context,
                approval_id=approval_id,
                arguments=call_arguments,
                **override,
            )
        ).result == "mismatch"

    with pytest.raises(TypeError, match="typed approval-required"):
        await _consume(
            context,
            approval_id=approval_id,
            arguments=arguments,
            verdict=ToolCallRequiresApproval(provider="Slack", tool="slack_send_message"),
        )

    consumed = await _consume(context, approval_id=approval_id, arguments=arguments)
    replay = await _consume(context, approval_id=approval_id, arguments=arguments)
    assert consumed.result == "consumed"
    assert replay.result == "already_consumed"

    # The public admission seam returns only after the CAS and event commit.
    await db_session.rollback()
    persisted = await db_session.get(CloudIntegrationActionApproval, uuid.UUID(approval_id))
    assert persisted is not None and persisted.status == "consumed"


@pytest.mark.asyncio
async def test_different_mcp_sessions_never_share_identical_action_approval(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await _setup_context(client, db_session, prefix="approval-session")
    arguments = {"message": "same action"}
    first = await _request_action(client, context, arguments=arguments)
    second_token, second_session_id = await _initialize_gateway_session(
        client,
        gateway_bearer=context.gateway_bearer,
        worker_id=context.worker_id,
        workspace_id=context.workspace_id,
        anyharness_session_id="session-second",
    )
    second = await _request_action(
        client,
        context,
        arguments=arguments,
        headers={
            "Authorization": f"Bearer {context.gateway_bearer}",
            MCP_SESSION_HEADER: second_token,
            WORKSPACE_HEADER: context.workspace_id,
            ANYHARNESS_SESSION_HEADER: "session-second",
        },
    )
    assert first["id"] != second["id"]
    assert first["executionSessionId"] == str(context.gateway_session_id)
    assert second["executionSessionId"] == str(second_session_id)


@pytest.mark.asyncio
async def test_account_credential_rotation_invalidates_prior_approval(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await _setup_context(client, db_session, prefix="approval-account-version")
    arguments = {"message": "bound to account revision"}
    approval = await _request_action(client, context, arguments=arguments)
    approval_id = str(approval["id"])
    await _approve(client, context, approval_id)

    rotated = await accounts_store.set_account_credentials(
        db_session,
        account_id=context.account_id,
        credential_ciphertext=encrypt_json(
            {
                "accessToken": "rotated-token",
                "refreshToken": "rotated-refresh",
                "expiresAt": None,
                "scopes": [],
            }
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
        expected_auth_version=context.account_auth_version,
    )
    assert rotated is not None
    await db_session.commit()

    old_revision = await _consume(context, approval_id=approval_id, arguments=arguments)
    new_revision = await _consume(
        context,
        approval_id=approval_id,
        arguments=arguments,
        integration_account_auth_version=rotated.auth_version,
    )
    assert old_revision.result == new_revision.result == "mismatch"

    replacement = await _request_action(client, context, arguments=arguments)
    assert replacement["id"] != approval_id
    assert replacement["integrationAccountAuthVersion"] == rotated.auth_version
