"""Agent-auth free credits concern."""

from __future__ import annotations

import json
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.billing_subjects import (
    ensure_agent_gateway_free_credit_allocation,
)
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentGatewayPolicyRecord,
)
from proliferate.server.cloud.agent_auth.budget_reconciliation import (
    _reconcile_managed_budget_subject,
)
from proliferate.server.cloud.agent_auth.deployment_plans import _deployment_fingerprint
from proliferate.server.cloud.agent_auth.gateway_policies import _ensure_managed_policy
from proliferate.server.cloud.agent_auth.managed_credit_rules import (
    _managed_credit_agent_kinds,
    _managed_credit_deployments_for_agent,
    _user_free_credit_budget_duration,
    _user_free_credit_entitlement_budget,
    _user_free_credit_period_key,
)
from proliferate.server.cloud.agent_auth.models import (
    EnsureFreeManagedCreditsRequest,
)
from proliferate.server.cloud.agent_auth.registry import (
    credential_provider_id_for_provider_kind,
    default_auth_slot_id,
)
from proliferate.server.cloud.agent_auth.results import (
    EnsureFreeManagedCreditsResult,
    FreeManagedCreditReadyAgentModel,
)
from proliferate.server.cloud.agent_auth.selections import select_credential_for_profile

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


async def ensure_free_managed_credits_for_user(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    body: EnsureFreeManagedCreditsRequest,
) -> EnsureFreeManagedCreditsResult:
    budget_amount = _user_free_credit_entitlement_budget(require_positive=False)
    period_key = _user_free_credit_period_key()
    requested_agent_kinds = _managed_credit_agent_kinds()
    if body.agent_kind is not None:
        requested_agent_kinds = (
            (body.agent_kind,) if body.agent_kind in requested_agent_kinds else ()
        )
    existing_entitlement = await store.get_free_credit_entitlement(
        db,
        user_id=actor_user_id,
        source=_USER_FREE_CREDIT_SOURCE,
        period_key=period_key,
    )
    existing_budget = await store.get_user_managed_budget_subject(db, actor_user_id)
    if not settings.agent_gateway_enabled:
        return EnsureFreeManagedCreditsResult(
            status="gateway_disabled",
            launch_enabled=False,
            primary_action="disabled",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="agent_gateway_disabled",
            last_error_message="Agent Gateway is disabled.",
        )
    if not settings.agent_gateway_user_free_credit_enabled or Decimal(budget_amount) <= 0:
        return EnsureFreeManagedCreditsResult(
            status="not_entitled",
            launch_enabled=False,
            primary_action="none",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="free_credits_not_entitled",
            last_error_message="Free managed credits are not enabled for this user.",
        )
    if existing_entitlement is not None and existing_entitlement.status in {
        "exhausted",
        "expired",
        "revoked",
    }:
        return EnsureFreeManagedCreditsResult(
            status=existing_entitlement.status,
            launch_enabled=False,
            primary_action="none",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code=existing_entitlement.last_error_code
            or f"free_credits_{existing_entitlement.status}",
            last_error_message=existing_entitlement.last_error_message
            or "Free managed credits are not available for this period.",
        )
    if body.agent_kind is not None and not requested_agent_kinds:
        return EnsureFreeManagedCreditsResult(
            status="agent_not_configured",
            launch_enabled=False,
            primary_action="none",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="managed_credit_agent_not_configured",
            last_error_message=(
                f"Proliferate free credits are not configured for {body.agent_kind}."
            ),
        )
    if not await ensure_agent_gateway_free_credit_allocation(
        db,
        user_id=actor_user_id,
        period_key=period_key,
    ):
        return EnsureFreeManagedCreditsResult(
            status="not_entitled",
            launch_enabled=False,
            primary_action="connect_github",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="free_credits_github_allocation_unavailable",
            last_error_message=(
                "Free managed credits require a linked GitHub account that has not "
                "already received this allocation."
            ),
        )

    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        created_by_user_id=actor_user_id,
    )
    entitlement = await store.ensure_free_credit_entitlement(
        db,
        user_id=actor_user_id,
        source=_USER_FREE_CREDIT_SOURCE,
        period_key=period_key,
        included_budget_usd=budget_amount,
        status="provisioning",
    )
    budget_duration = _user_free_credit_budget_duration()
    managed_deployments = tuple(
        deployment
        for agent_kind in requested_agent_kinds
        for deployment in _managed_credit_deployments_for_agent(agent_kind)[1]
    )
    sync_status = "failed"
    status = "invalid"
    fingerprint = existing_budget.litellm_sync_fingerprint if existing_budget else None
    error_code = "bifrost_not_configured"
    error_message = "Bifrost provisioning is not configured."
    if existing_budget is not None and existing_budget.litellm_team_id:
        expected_fingerprint = _deployment_fingerprint(
            policy_kind="proliferate_managed",
            router_object_id=existing_budget.litellm_team_id,
            budget_subject_id=None,
            provider_kind="proliferate_managed",
            deployments=managed_deployments,
        )
        if (
            managed_deployments
            and existing_budget.status == "ready"
            and existing_budget.litellm_sync_status == "synced"
            and existing_budget.included_budget_usd == budget_amount
            and existing_budget.budget_duration == budget_duration
            and existing_budget.entitlement_source == _USER_FREE_CREDIT_SOURCE
            and existing_budget.entitlement_period_key == period_key
            and existing_budget.litellm_sync_fingerprint == expected_fingerprint
        ):
            sync_status = "synced"
            status = "ready"
            fingerprint = expected_fingerprint
            error_code = None
            error_message = None
    if not managed_deployments:
        error_code = "managed_credit_models_not_configured"
        error_message = "No managed-credit model deployments are configured."

    budget = await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        included_budget_usd=budget_amount,
        budget_duration=budget_duration,
        entitlement_source=_USER_FREE_CREDIT_SOURCE,
        entitlement_period_key=period_key,
        litellm_team_id=existing_budget.litellm_team_id if existing_budget else None,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )
    budget = await _reconcile_managed_budget_subject(db, budget=budget)
    sync_status = budget.litellm_sync_status
    status = budget.status
    fingerprint = budget.litellm_sync_fingerprint
    error_code = budget.last_error_code
    error_message = budget.last_error_message
    entitlement = await store.ensure_free_credit_entitlement(
        db,
        user_id=actor_user_id,
        source=_USER_FREE_CREDIT_SOURCE,
        period_key=period_key,
        included_budget_usd=budget_amount,
        budget_subject_id=budget.id,
        status="active" if status == "ready" else "provisioning",
        last_error_code=error_code,
        last_error_message=error_message,
    )

    credentials: list[AgentAuthCredentialRecord] = []
    policies: list[AgentGatewayPolicyRecord] = []
    ready_models: list[FreeManagedCreditReadyAgentModel] = []
    seen_credential_ids: set[UUID] = set()
    seen_policy_ids: set[UUID] = set()
    existing_selections = {
        (selection.agent_kind, selection.auth_slot_id): selection
        for selection in await store.list_selections_for_profile(db, profile.id)
    }
    for agent_kind in requested_agent_kinds:
        provider_kind, deployments = _managed_credit_deployments_for_agent(agent_kind)
        if not deployments:
            continue
        auth_slot_id = default_auth_slot_id(agent_kind)
        if auth_slot_id is None:
            continue
        credential_provider_id = credential_provider_id_for_provider_kind(provider_kind)
        credential = await store.get_managed_gateway_credential_for_owner(
            db,
            owner_scope="personal",
            owner_user_id=actor_user_id,
            organization_id=None,
            credential_provider_id=credential_provider_id,
        )
        redacted_summary_json = json.dumps(
            {
                "providerKind": provider_kind,
                "budgetSubjectId": str(budget.id),
                "freeCreditEntitlementId": str(entitlement.id),
            },
            sort_keys=True,
        )
        if credential is None:
            credential = await store.create_agent_auth_credential(
                db,
                owner_scope="personal",
                owner_user_id=actor_user_id,
                organization_id=None,
                created_by_user_id=actor_user_id,
                credential_provider_id=credential_provider_id,
                credential_kind="managed_gateway",
                display_name="Proliferate free credits",
                redacted_summary_json=redacted_summary_json,
                status="ready" if status == "ready" else "invalid",
            )
        else:
            desired_credential_status = "ready" if status == "ready" else "invalid"
            if (
                credential.status != desired_credential_status
                or credential.redacted_summary_json != redacted_summary_json
            ):
                credential = (
                    await store.update_credential_status(
                        db,
                        credential_id=credential.id,
                        status=desired_credential_status,
                        redacted_summary_json=redacted_summary_json,
                    )
                    or credential
                )
        policy = await _ensure_managed_policy(
            db,
            credential=credential,
            budget=budget,
            sync_status=sync_status,
            status=status,
            fingerprint=fingerprint,
            error_code=error_code,
            error_message=error_message,
            existing_policy=await store.get_gateway_policy_for_credential(db, credential.id),
        )
        desired_policy_credential_status = "ready" if policy.status == "ready" else "invalid"
        if credential.status != desired_policy_credential_status:
            credential = (
                await store.update_credential_status(
                    db,
                    credential_id=credential.id,
                    status=desired_policy_credential_status,
                )
                or credential
            )
        if credential.id not in seen_credential_ids:
            credentials.append(credential)
            seen_credential_ids.add(credential.id)
        if policy.id not in seen_policy_ids:
            policies.append(policy)
            seen_policy_ids.add(policy.id)
        if policy.status == "ready" and policy.litellm_sync_status == "synced":
            ready_models.append(
                FreeManagedCreditReadyAgentModel(
                    agent_kind=agent_kind,
                    public_model_names=tuple(
                        deployment.public_model_name for deployment in deployments
                    ),
                    credential_id=credential.id,
                )
            )
            existing_selection = existing_selections.get((agent_kind, auth_slot_id))
            should_select_managed_credential = existing_selection is None
            if existing_selection is not None:
                existing_credential = await store.get_credential(
                    db,
                    existing_selection.credential_id,
                )
                existing_is_managed_gateway = (
                    existing_credential is not None
                    and existing_credential.credential_kind == "managed_gateway"
                )
                managed_selection_needs_refresh = existing_is_managed_gateway and (
                    existing_selection.status != "active"
                    or existing_selection.credential_id != credential.id
                    or existing_selection.credential_share_id is not None
                    or existing_selection.materialization_mode != "gateway_env"
                    or existing_selection.selected_revision != credential.revision
                    or existing_selection.last_error_code is not None
                    or existing_selection.last_error_message is not None
                )
                explicit_agent_refresh = body.agent_kind == agent_kind and (
                    existing_credential is None
                    or existing_credential.credential_kind != "managed_gateway"
                    or existing_selection.credential_id != credential.id
                )
                should_select_managed_credential = (
                    managed_selection_needs_refresh or explicit_agent_refresh
                )
            if should_select_managed_credential:
                await select_credential_for_profile(
                    db,
                    actor_user_id=actor_user_id,
                    sandbox_profile_id=profile.id,
                    agent_kind=agent_kind,
                    auth_slot_id=auth_slot_id,
                    credential_id=credential.id,
                    credential_share_id=None,
                    force_restart=existing_selection is not None,
                )

    launch_enabled = bool(ready_models)
    await store.record_audit_event(
        db,
        action="free_credits.ensure",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        sandbox_profile_id=profile.id,
        metadata_json=json.dumps(
            {
                "includedBudgetUsd": budget_amount,
                "agentKinds": list(requested_agent_kinds),
                "litellmSyncStatus": sync_status,
                "launchEnabled": launch_enabled,
            },
            sort_keys=True,
        ),
    )
    return EnsureFreeManagedCreditsResult(
        status="ready" if launch_enabled else "provisioning",
        launch_enabled=launch_enabled,
        primary_action="launch" if launch_enabled else "retry",
        ready_agent_models=tuple(ready_models),
        entitlement=entitlement,
        budget_subject=budget,
        credentials=tuple(credentials),
        policies=tuple(policies),
        last_error_code=error_code,
        last_error_message=error_message,
    )
