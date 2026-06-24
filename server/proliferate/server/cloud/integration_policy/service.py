"""Organization integration catalog policy orchestration."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_integration_policy as policy_store
from proliferate.permissions import CurrentOrgUser
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


def _configured_catalog_entry_ids() -> tuple[str, ...]:
    return tuple(
        entry.id
        for entry in build_connector_catalog()
        if catalog_entry_is_configured(entry)
    )


async def get_organization_integration_policy(
    db: AsyncSession,
    *,
    org_user: CurrentOrgUser,
) -> OrganizationIntegrationPolicySnapshot:
    records = await policy_store.list_organization_integration_policy(
        db,
        org_user.organization_id,
    )
    records_by_entry_id = {record.catalog_entry_id: record for record in records}
    entries = []
    for catalog_entry_id in _configured_catalog_entry_ids():
        record = records_by_entry_id.get(catalog_entry_id)
        entries.append(
            OrganizationIntegrationPolicyEntry(
                catalog_entry_id=catalog_entry_id,
                enabled=record.enabled if record is not None else True,
                updated_at=record.updated_at if record is not None else None,
                updated_by_user_id=record.updated_by_user_id if record is not None else None,
            )
        )
    return OrganizationIntegrationPolicySnapshot(
        organization_id=org_user.organization_id,
        entries=tuple(entries),
    )


async def patch_organization_integration_policy(
    db: AsyncSession,
    *,
    org_admin: CurrentOrgUser,
    body: PatchCloudOrganizationIntegrationPolicyRequest,
) -> OrganizationIntegrationPolicySnapshot:
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
        organization_id=org_admin.organization_id,
        catalog_entry_id=catalog_entry_id,
        enabled=body.enabled,
        updated_by_user_id=org_admin.actor_user_id,
    )
    return await get_organization_integration_policy(
        db,
        org_user=org_admin,
    )
