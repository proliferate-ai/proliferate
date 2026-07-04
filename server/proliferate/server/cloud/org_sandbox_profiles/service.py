"""Service layer for org-owned sandbox profiles.

Reuses the existing personal-profile provisioning path with
owner_scope=organization. Org billing subject is bound on create.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import billing_subjects
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.errors import CloudApiError


async def list_org_sandbox_profiles(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> list[CloudSandboxValue]:
    """List all active (non-destroyed) org sandbox profiles. Member-visible."""
    return await sandbox_store.list_organization_cloud_sandboxes(db, organization_id)


async def create_org_sandbox_profile(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID,
    display_name: str,
) -> CloudSandboxValue:
    """Create an org-scoped sandbox profile. Org-admin gated by caller."""
    await sandbox_store.acquire_cloud_sandbox_owner_lock(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
    )
    billing_subject = await billing_subjects.ensure_organization_billing_subject(
        db, organization_id
    )
    return await sandbox_store.ensure_organization_cloud_sandbox(
        db,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="e2b",
        display_name=display_name,
    )


async def get_org_sandbox_profile(
    db: AsyncSession,
    *,
    organization_id: UUID,
    sandbox_id: UUID,
) -> CloudSandboxValue:
    """Load a specific org sandbox profile. Member-visible."""
    sandbox = await sandbox_store.load_organization_cloud_sandbox(
        db, organization_id, sandbox_id=sandbox_id
    )
    if sandbox is None:
        raise CloudApiError(
            "org_sandbox_profile_not_found",
            "Organization sandbox profile not found.",
            status_code=404,
        )
    return sandbox
