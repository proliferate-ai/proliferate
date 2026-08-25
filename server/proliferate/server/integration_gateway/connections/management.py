"""Authoritative user-facing integration management projection and commands."""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations.accounts import (
    IntegrationAccountRecord,
    list_accounts_for_user,
)
from proliferate.db.store.integrations.authorization_attempts import (
    NONTERMINAL_ATTEMPT_STATUSES,
    IntegrationAuthorizationAttemptRecord,
    expire_authorization_attempt_if_due,
    get_authorization_attempt,
    list_latest_authorization_attempts_for_user,
    terminalize_authorization_attempt,
)
from proliferate.db.store.integrations.definitions import (
    IntegrationDefinitionRecord,
    list_definitions_visible_to_org,
    list_seed_definitions,
)
from proliferate.db.store.integrations.oauth_flows import (
    IntegrationOAuthFlowRecord,
    cancel_oauth_flow_for_user,
    expire_oauth_flow,
    get_oauth_flow_for_attempt,
    list_oauth_flows_for_attempts,
)
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections.health import (
    HealthVerdict,
    IntegrationHealth,
    list_integration_health,
)
from proliferate.server.integration_gateway.connections.models import (
    AuthKind,
    IntegrationAttemptPurpose,
    IntegrationAttemptStatus,
    IntegrationAuthorizationAttemptSummary,
    IntegrationConnectionSummary,
    IntegrationManagementActions,
    IntegrationManagementItem,
    IntegrationPrimaryAction,
    IntegrationProviderAvailability,
    IntegrationSecondaryAction,
)
from proliferate.server.integration_gateway.connections.oauth.clients import (
    oauth_provider_availability,
)
from proliferate.server.integration_gateway.connections.service import build_connect_schema


def _attempt_summary(
    attempt: IntegrationAuthorizationAttemptRecord,
    flow: IntegrationOAuthFlowRecord | None,
) -> IntegrationAuthorizationAttemptSummary:
    return IntegrationAuthorizationAttemptSummary(
        attemptId=attempt.id,
        purpose=cast(IntegrationAttemptPurpose, attempt.purpose),
        method=cast(AuthKind, attempt.method),
        generation=attempt.generation,
        status=cast(IntegrationAttemptStatus, attempt.status),
        authorizationUrl=(
            flow.authorization_url
            if flow is not None
            and flow.status == "active"
            and attempt.status in NONTERMINAL_ATTEMPT_STATUSES
            else None
        ),
        expiresAt=attempt.expires_at,
        failureCode=attempt.failure_code,
    )


def _connection_summary(
    account: IntegrationAccountRecord | None,
    health: IntegrationHealth,
) -> IntegrationConnectionSummary | None:
    if account is None:
        return None
    return IntegrationConnectionSummary(
        accountId=account.id,
        status=account.status,
        enabled=account.enabled,
        health=health.health.value,
        toolCount=health.tool_count,
        tokenExpiresAt=health.token_expires_at,
        lastErrorCode=health.last_error_code,
    )


def _availability(
    definition: IntegrationDefinitionRecord,
    health: IntegrationHealth,
) -> IntegrationProviderAvailability:
    if not health.effective_enabled:
        return IntegrationProviderAvailability(
            available=False,
            reason="disabled_by_org",
        )
    if definition.auth_kind != "oauth2":
        return IntegrationProviderAvailability(available=True, reason=None)
    provider = oauth_provider_availability(definition)
    return IntegrationProviderAvailability(
        available=provider.available,
        reason=provider.reason,
    )


def _actions(
    *,
    availability: IntegrationProviderAvailability,
    account: IntegrationAccountRecord | None,
    health: IntegrationHealth,
    attempt: IntegrationAuthorizationAttemptRecord | None,
    flow: IntegrationOAuthFlowRecord | None,
) -> IntegrationManagementActions:
    secondary: list[IntegrationSecondaryAction] = []
    nonterminal = attempt is not None and attempt.status in NONTERMINAL_ATTEMPT_STATUSES
    if nonterminal:
        secondary.append("cancel")
    if account is not None:
        secondary.append("disconnect")

    primary: IntegrationPrimaryAction
    if not availability["available"] or (account is not None and not account.enabled):
        primary = "none"
    elif nonterminal:
        primary = (
            "open_authorization"
            if attempt is not None
            and attempt.method == "oauth2"
            and flow is not None
            and flow.status == "active"
            else "none"
        )
    elif account is None:
        primary = "connect"
    elif health.health in {
        HealthVerdict.NEEDS_AUTH,
        HealthVerdict.NEEDS_REAUTH,
        HealthVerdict.ERROR,
    }:
        primary = "reconnect"
    else:
        primary = "none"
    return IntegrationManagementActions(primary=primary, secondary=secondary)


async def list_integration_management(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None = None,
) -> list[IntegrationManagementItem]:
    health_items = await list_integration_health(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    definitions = (
        await list_definitions_visible_to_org(db, organization_id)
        if organization_id is not None
        else await list_seed_definitions(db)
    )
    accounts = {
        account.definition_id: account for account in await list_accounts_for_user(db, user_id)
    }
    attempts = {
        attempt.definition_id: attempt
        for attempt in await list_latest_authorization_attempts_for_user(db, user_id)
    }
    flows: dict[UUID, IntegrationOAuthFlowRecord] = {}
    for oauth_flow in await list_oauth_flows_for_attempts(
        db,
        tuple(attempt.id for attempt in attempts.values()),
    ):
        if oauth_flow.attempt_id is not None:
            flows.setdefault(oauth_flow.attempt_id, oauth_flow)
    health_by_definition = {item.definition_id: item for item in health_items}

    items: list[IntegrationManagementItem] = []
    for definition in definitions:
        if definition.archived_at is not None:
            continue
        health = health_by_definition[definition.id]
        account = accounts.get(definition.id)
        attempt = attempts.get(definition.id)
        flow = flows.get(attempt.id) if attempt is not None else None
        if attempt is not None:
            resolved_attempt = await expire_authorization_attempt_if_due(db, attempt.id)
            if resolved_attempt is not None:
                attempt = resolved_attempt
                attempts[definition.id] = resolved_attempt
                if (
                    resolved_attempt.status == "expired"
                    and flow is not None
                    and flow.status in {"active", "exchanging"}
                ):
                    expired_flow = await expire_oauth_flow(db, flow.id)
                    if expired_flow is not None:
                        flow = expired_flow

        availability = _availability(definition, health)
        visible_attempt = (
            attempt if attempt is not None and attempt.status != "succeeded" else None
        )
        items.append(
            IntegrationManagementItem(
                definitionId=definition.id,
                namespace=definition.namespace,
                displayName=definition.display_name,
                description=definition.description,
                authKind=definition.auth_kind,
                connectSchema=build_connect_schema(definition),
                availability=availability,
                connection=_connection_summary(account, health),
                attempt=(
                    _attempt_summary(visible_attempt, flow)
                    if visible_attempt is not None
                    else None
                ),
                actions=_actions(
                    availability=availability,
                    account=account,
                    health=health,
                    attempt=visible_attempt,
                    flow=flow,
                ),
            )
        )
    return items


async def cancel_authorization_attempt(
    db: AsyncSession,
    *,
    user_id: UUID,
    attempt_id: UUID,
) -> IntegrationAuthorizationAttemptSummary:
    current = await get_authorization_attempt(db, attempt_id)
    if current is None or current.owner_user_id != user_id:
        raise CloudApiError(
            "not_found",
            "Authorization attempt was not found.",
            status_code=404,
        )
    if current.status not in NONTERMINAL_ATTEMPT_STATUSES:
        raise CloudApiError(
            "integration_attempt_completed",
            "Authorization attempt is already complete.",
            status_code=409,
        )
    resolved = await terminalize_authorization_attempt(
        db,
        attempt_id=attempt_id,
        status="cancelled",
        failure_code="user_cancelled",
        owner_user_id=user_id,
    )
    if resolved is None:
        raise CloudApiError(
            "not_found",
            "Authorization attempt was not found.",
            status_code=404,
        )
    if resolved.status != "cancelled":
        raise CloudApiError(
            "integration_attempt_completed",
            "Authorization attempt is already complete.",
            status_code=409,
        )
    flow = await get_oauth_flow_for_attempt(db, attempt_id)
    if flow is not None and flow.status in {"active", "exchanging"}:
        flow = await cancel_oauth_flow_for_user(db, user_id, flow.id) or flow
    return _attempt_summary(resolved, flow)
