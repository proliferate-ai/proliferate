"""Agent-auth router materializations concern."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayRouterMaterializationRecord,
    SandboxAgentAuthSelectionRecord,
)
from proliferate.integrations.bifrost import (
    BifrostAdminClient,
    BifrostIntegrationError,
)
from proliferate.server.cloud.agent_auth.bifrost_clients import new_bifrost_admin_client
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.provider_keys import (
    _bifrost_provider_name_for_provider_kind,
)
from proliferate.server.cloud.agent_auth.value_redaction import _safe_error_message

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


async def _disable_bifrost_virtual_keys_for_budget(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> None:
    materializations = await store.list_active_router_virtual_key_materializations_for_budget(
        db,
        router_kind="bifrost",
        budget_subject_id=budget.id,
    )
    if not materializations:
        return
    client = new_bifrost_admin_client()
    for materialization in materializations:
        await _disable_bifrost_virtual_key_materialization(
            db,
            client=client,
            materialization=materialization,
            error_code="bifrost_virtual_key_disable_failed",
            raise_on_failure=False,
        )


async def _disable_bifrost_virtual_key_materialization(
    db: AsyncSession,
    *,
    client: BifrostAdminClient,
    materialization: AgentGatewayRouterMaterializationRecord,
    error_code: str,
    raise_on_failure: bool,
) -> bool:
    virtual_key_id = materialization.router_object_id
    if not virtual_key_id:
        return True
    try:
        await client.disable_virtual_key(virtual_key_id)
    except BifrostIntegrationError as exc:
        await store.update_router_materialization_status(
            db,
            materialization_id=materialization.id,
            status="active",
            sync_status="failed",
            last_error_code=error_code,
            last_error_message=_safe_error_message(str(exc), {}),
        )
        if raise_on_failure:
            raise AgentAuthError(
                "Bifrost virtual key could not be disabled.",
                code=error_code,
                status_code=502,
            ) from exc
        return False
    await store.update_router_materialization_status(
        db,
        materialization_id=materialization.id,
        status="disabled",
        sync_status="synced",
        last_error_code=None,
        last_error_message=None,
    )
    return True


async def _disable_bifrost_runtime_materializations_for_selection(
    db: AsyncSession,
    *,
    selection: SandboxAgentAuthSelectionRecord,
) -> None:
    materializations = await store.list_active_runtime_router_materializations_for_selection(
        db,
        router_kind="bifrost",
        selection_id=selection.id,
    )
    if not materializations:
        return
    client = new_bifrost_admin_client()
    for materialization in materializations:
        await _disable_bifrost_virtual_key_materialization(
            db,
            client=client,
            materialization=materialization,
            error_code="bifrost_selection_virtual_key_disable_failed",
            raise_on_failure=True,
        )


async def _disable_bifrost_router_materializations_for_credential(
    db: AsyncSession,
    *,
    credential: AgentAuthCredentialRecord,
) -> None:
    policy = await store.get_gateway_policy_for_credential(db, credential.id)
    if policy is None:
        return
    materializations = await store.list_active_router_materializations_for_policy(
        db,
        router_kind="bifrost",
        policy_id=policy.id,
    )
    if not materializations:
        return
    provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
    provider_name = (
        _bifrost_provider_name_for_provider_kind(provider_credential.provider_kind)
        if provider_credential is not None
        else None
    )
    client = new_bifrost_admin_client()
    failures: list[str] = []
    for materialization in materializations:
        router_object_id = materialization.router_object_id
        if not router_object_id:
            continue
        try:
            if materialization.router_object_kind == "virtual_key":
                await client.disable_virtual_key(router_object_id)
            elif materialization.router_object_kind == "provider_key":
                if provider_name is None:
                    continue
                await client.disable_provider_key(
                    provider=provider_name,
                    key_id=router_object_id,
                )
            else:
                continue
            await store.update_router_materialization_status(
                db,
                materialization_id=materialization.id,
                status="disabled",
                sync_status="synced",
                last_error_code=None,
                last_error_message=None,
            )
        except BifrostIntegrationError as exc:
            failures.append(str(exc))
            await store.update_router_materialization_status(
                db,
                materialization_id=materialization.id,
                status="active",
                sync_status="failed",
                last_error_code="bifrost_materialization_disable_failed",
                last_error_message=_safe_error_message(str(exc), {}),
            )
    if failures:
        raise AgentAuthError(
            "Credential revocation could not disable all Bifrost router materializations.",
            code="bifrost_revocation_failed",
            status_code=502,
        )
