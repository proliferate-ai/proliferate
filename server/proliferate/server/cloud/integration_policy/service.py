"""Organization integration catalog policy orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store import cloud_integration_policy as policy_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.organization_records import MembershipRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_policy.domain.types import (
    OrganizationIntegrationPolicyEntry,
    OrganizationIntegrationPolicySnapshot,
)
from proliferate.server.cloud.integration_policy.models import (
    PatchCloudOrganizationIntegrationPolicyRequest,
)
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import build_connector_catalog


def _require_org_member(membership: MembershipRecord | None) -> None:
    if membership is None:
        raise CloudApiError(
            "organization_not_found",
            "Organization not found.",
            status_code=404,
        )


def _require_org_admin(membership: MembershipRecord | None) -> None:
    _require_org_member(membership)
    if membership is None:
        return
    if membership.role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "organization_permission_denied",
            "You do not have permission to manage this organization.",
            status_code=403,
        )


async def _active_membership(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
) -> MembershipRecord | None:
    return await organizations_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )


def _configured_catalog_entry_ids() -> tuple[str, ...]:
    return tuple(
        entry.id
        for entry in build_connector_catalog()
        if catalog_entry_is_configured(entry)
    )


async def get_organization_integration_policy(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
) -> OrganizationIntegrationPolicySnapshot:
    membership = await _active_membership(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
    )
    _require_org_member(membership)
    records = await policy_store.list_organization_integration_policy(db, organization_id)
    records_by_entry_id = {record.catalog_entry_id: record for record in records}
    entries = tuple(
        OrganizationIntegrationPolicyEntry(
            catalog_entry_id=catalog_entry_id,
            enabled=records_by_entry_id.get(catalog_entry_id).enabled
            if catalog_entry_id in records_by_entry_id
            else True,
            updated_at=records_by_entry_id.get(catalog_entry_id).updated_at
            if catalog_entry_id in records_by_entry_id
            else None,
            updated_by_user_id=records_by_entry_id.get(catalog_entry_id).updated_by_user_id
            if catalog_entry_id in records_by_entry_id
            else None,
        )
        for catalog_entry_id in _configured_catalog_entry_ids()
    )
    return OrganizationIntegrationPolicySnapshot(
        organization_id=organization_id,
        entries=entries,
    )


async def patch_organization_integration_policy(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    body: PatchCloudOrganizationIntegrationPolicyRequest,
) -> OrganizationIntegrationPolicySnapshot:
    membership = await _active_membership(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
    )
    _require_org_admin(membership)
    catalog_entry_id = body.catalog_entry_id.strip()
    catalog_entry_ids = set(_configured_catalog_entry_ids())
    if catalog_entry_id not in catalog_entry_ids:
        raise CloudApiError(
            "catalog_entry_not_found",
            "Integration catalog entry was not found.",
            status_code=404,
        )
    await policy_store.upsert_organization_integration_policy(
        db,
        organization_id=organization_id,
        catalog_entry_id=catalog_entry_id,
        enabled=body.enabled,
        updated_by_user_id=actor_user_id,
    )
    return await get_organization_integration_policy(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
    )
