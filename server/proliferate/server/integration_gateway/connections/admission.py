"""Per-operation integration admission under the committed account lock."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import (
    definition_security_revisions as security_revisions_store,
)
from proliferate.db.store.integrations import oauth_clients as oauth_clients_store
from proliferate.db.store.integrations.accounts import IntegrationAccountRecord
from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.integrations.integration_oauth import normalize_resource_url
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections import (
    transactions as integration_transactions,
)
from proliferate.server.integration_gateway.connections.config import (
    parse_definition_config,
    render_mcp_url,
)


@dataclass(frozen=True)
class IntegrationOperationLease:
    account: IntegrationAccountRecord
    definition: IntegrationDefinitionRecord
    owner_user_id: UUID
    organization_id: UUID | None
    runtime_worker_id: UUID
    workspace_id: str | None
    anyharness_session_id: str | None
    admitted_at: datetime


def _denied(code: str, message: str) -> CloudApiError:
    return CloudApiError(code, message, status_code=404)


def _org_allows(
    grant: IntegrationGatewayGrant,
    row: accounts_store.ReadyAccountRow,
) -> bool:
    if grant.organization_id is None:
        return True
    if row.org_policy_enabled is not None:
        return row.org_policy_enabled
    return row.definition.enabled_by_default


async def _validate_pinned_authority(
    db: AsyncSession,
    *,
    account: IntegrationAccountRecord,
    definition: IntegrationDefinitionRecord,
) -> None:
    if account.auth_kind != definition.auth_kind:
        raise _denied(
            "integration_authority_changed",
            "Integration authority changed; reconnect before using it.",
        )

    # Nullable pins are the explicit PR1 compatibility window for connections
    # created before lifecycle revisions existed. PR5 migrates them and removes
    # this branch; every newly committed account carries exact pins.
    if account.definition_security_revision_id is not None:
        revision = await security_revisions_store.get_definition_security_revision_by_id(
            db,
            account.definition_security_revision_id,
        )
        if (
            revision is None
            or revision.definition_id != definition.id
            or revision.auth_kind != definition.auth_kind
            or revision.oauth_client_mode != definition.oauth_client_mode
            or revision.config_json != definition.config_json
        ):
            raise _denied(
                "integration_definition_changed",
                "Integration definition changed; reconnect before using it.",
            )

        try:
            raw_settings = json.loads(account.settings_json)
            if not isinstance(raw_settings, dict):
                raise ValueError("connection settings are not an object")
            config = parse_definition_config(definition.config_json)
            if definition.auth_kind == "oauth2":
                if account.provider_client_id is None or not account.credential_audience:
                    raise ValueError("OAuth authority pins are incomplete")
            else:
                expected_audience = normalize_resource_url(render_mcp_url(config, raw_settings))
                if account.credential_audience != expected_audience:
                    raise ValueError("connection audience no longer matches")
        except (json.JSONDecodeError, ValueError) as exc:
            raise _denied(
                "integration_audience_changed",
                "Integration audience changed; reconnect before using it.",
            ) from exc

    if account.provider_client_id is not None:
        client = await oauth_clients_store.get_oauth_client_by_id(
            db,
            account.provider_client_id,
        )
        if (
            client is None
            or client.definition_id != definition.id
            or client.lifecycle_state not in {"active", "retiring"}
            or (client.resource or "") != (account.credential_audience or "")
        ):
            raise _denied(
                "integration_client_changed",
                "Integration OAuth client changed; reconnect before using it.",
            )


async def admit_provider_operation(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
    workspace_id: str | None = None,
    anyharness_session_id: str | None = None,
) -> IntegrationOperationLease:
    """Linearize one provider operation with policy, authority, and cutoff."""

    row = await accounts_store.get_ready_account_for_provider(
        db,
        grant.owner_user_id,
        provider,
        organization_id=grant.organization_id,
        for_update=True,
    )
    if row is None:
        raise _denied(
            "integration_provider_not_found",
            f"No connected integration provider '{provider}'.",
        )
    if not _org_allows(grant, row):
        raise _denied(
            "integration_provider_disabled",
            f"Integration provider '{provider}' is disabled by your organization's policy.",
        )
    if grant.organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=grant.organization_id,
            user_id=grant.owner_user_id,
        )
        if membership is None:
            raise _denied(
                "integration_membership_required",
                "Integration access requires active organization membership.",
            )
    await _validate_pinned_authority(
        db,
        account=row.account,
        definition=row.definition,
    )
    lease = IntegrationOperationLease(
        account=row.account,
        definition=row.definition,
        owner_user_id=grant.owner_user_id,
        organization_id=grant.organization_id,
        runtime_worker_id=grant.runtime_worker_id,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
        admitted_at=utcnow(),
    )
    await integration_transactions.release_integration_transaction(db)
    return lease
