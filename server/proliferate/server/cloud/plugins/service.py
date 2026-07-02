from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_plugins import (
    CloudPluginConfiguredItemSnapshot,
    delete_plugin_item,
    get_plugin_item,
    list_plugins_for_user,
    patch_plugin_item,
    upsert_personal_plugin_item,
)
from proliferate.db.store.cloud_skills import upsert_personal_skill_item
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import build_connector_catalog
from proliferate.server.cloud.plugins.catalog.domain.types import PluginPackage
from proliferate.server.cloud.plugins.catalog.service import plugin_packages_for_catalog_entries
from proliferate.server.cloud.plugins.models import PatchPluginConfiguredItemRequest
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership


async def list_configured_plugins(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[CloudPluginConfiguredItemSnapshot, ...]:
    return await list_plugins_for_user(db, user_id)


async def install_plugin(
    db: AsyncSession,
    *,
    user_id: UUID,
    plugin_id: str,
) -> CloudPluginConfiguredItemSnapshot:
    package = _plugin_package_or_raise(plugin_id)
    plugin = await upsert_personal_plugin_item(
        db,
        owner_user_id=user_id,
        plugin_id=package.id,
        plugin_version=package.version,
        enabled=True,
    )
    for skill in package.skills:
        if not skill.default_enabled:
            continue
        await upsert_personal_skill_item(
            db,
            owner_user_id=user_id,
            skill_source_kind="plugin",
            skill_id=skill.id,
            skill_version=None,
            plugin_id=package.id,
            plugin_version=package.version,
            enabled=True,
        )
    await _refresh_personal_runtime_config(
        db,
        user_id=user_id,
        reason="plugin_installed",
    )
    return plugin


async def ensure_plugin_installed_for_catalog_entry(
    db: AsyncSession,
    *,
    user_id: UUID,
    catalog_entry_id: str,
) -> CloudPluginConfiguredItemSnapshot | None:
    package = _plugin_package_for_catalog_entry(catalog_entry_id)
    if package is None:
        return None
    existing = next(
        (
            item
            for item in await list_plugins_for_user(db, user_id)
            if item.plugin_id == package.id
        ),
        None,
    )
    if existing is not None:
        return existing
    return await install_plugin(db, user_id=user_id, plugin_id=package.id)


async def patch_configured_plugin(
    db: AsyncSession,
    *,
    user_id: UUID,
    item_id: UUID,
    body: PatchPluginConfiguredItemRequest,
) -> CloudPluginConfiguredItemSnapshot:
    existing = await get_plugin_item(db, item_id=item_id)
    if existing is None or existing.owner_user_id != user_id:
        raise CloudApiError("plugin_not_found", "Plugin was not found.", status_code=404)
    old_public_org_id = existing.public_organization_id
    new_public_org_id = await _authorized_public_org_id(
        db,
        user_id=user_id,
        public_to_org=body.public_to_org,
        requested_org_id=body.public_organization_id,
        existing_org_id=old_public_org_id,
    )
    item = await patch_plugin_item(
        db,
        item_id=item_id,
        enabled=body.enabled,
        public_to_org=body.public_to_org,
        public_organization_id=new_public_org_id,
        public_status=(
            "public"
            if body.public_to_org
            else "private"
            if body.public_to_org is not None
            else None
        ),
        public_updated_by_user_id=user_id if body.public_to_org is not None else None,
    )
    if item is None:
        raise CloudApiError("plugin_not_found", "Plugin was not found.", status_code=404)
    await _refresh_personal_runtime_config(db, user_id=user_id, reason="plugin_updated")
    await _refresh_changed_org_runtime_configs(
        db,
        user_id=user_id,
        old_org_id=old_public_org_id,
        new_org_id=item.public_organization_id,
        reason="plugin_publicization_updated",
    )
    return item


async def uninstall_plugin(
    db: AsyncSession,
    *,
    user_id: UUID,
    item_id: UUID,
) -> None:
    existing = await get_plugin_item(db, item_id=item_id)
    if existing is None or existing.owner_user_id != user_id:
        raise CloudApiError("plugin_not_found", "Plugin was not found.", status_code=404)
    await delete_plugin_item(db, item_id=item_id)
    await _refresh_personal_runtime_config(db, user_id=user_id, reason="plugin_uninstalled")
    await _refresh_changed_org_runtime_configs(
        db,
        user_id=user_id,
        old_org_id=existing.public_organization_id,
        new_org_id=None,
        reason="plugin_uninstalled",
    )


def _plugin_package_or_raise(plugin_id: str) -> PluginPackage:
    entries = tuple(
        entry for entry in build_connector_catalog() if catalog_entry_is_configured(entry)
    )
    packages = {
        package.id: package for package in plugin_packages_for_catalog_entries(list(entries))
    }
    package = packages.get(plugin_id)
    if package is None:
        raise CloudApiError("plugin_not_found", "Plugin package was not found.", status_code=404)
    return package


def _plugin_package_for_catalog_entry(catalog_entry_id: str) -> PluginPackage | None:
    entries = tuple(
        entry for entry in build_connector_catalog() if catalog_entry_is_configured(entry)
    )
    packages = plugin_packages_for_catalog_entries(list(entries))
    return next(
        (package for package in packages if package.catalog_entry_id == catalog_entry_id),
        None,
    )


async def _authorized_public_org_id(
    db: AsyncSession,
    *,
    user_id: UUID,
    public_to_org: bool | None,
    requested_org_id: UUID | None,
    existing_org_id: UUID | None,
) -> UUID | None:
    if public_to_org is None:
        if requested_org_id is not None and requested_org_id != existing_org_id:
            raise CloudApiError(
                "plugin_public_organization_invalid",
                "publicOrganizationId requires publicToOrg.",
                status_code=400,
            )
        return existing_org_id
    if public_to_org is False:
        if existing_org_id is not None:
            await _require_org_admin(db, user_id=user_id, organization_id=existing_org_id)
        return None
    if requested_org_id is None:
        raise CloudApiError(
            "plugin_public_organization_required",
            "publicOrganizationId is required when publicToOrg is true.",
            status_code=400,
        )
    await _require_org_admin(db, user_id=user_id, organization_id=requested_org_id)
    return requested_org_id


async def _require_org_admin(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organizations_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    require_target_admin_membership(membership)


async def _refresh_changed_org_runtime_configs(
    db: AsyncSession,
    *,
    user_id: UUID,
    old_org_id: UUID | None,
    new_org_id: UUID | None,
    reason: str,
) -> None:
    for organization_id in {org_id for org_id in (old_org_id, new_org_id) if org_id is not None}:
        await _refresh_org_runtime_config(
            db,
            user_id=user_id,
            organization_id=organization_id,
            reason=reason,
        )


async def _refresh_personal_runtime_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    reason: str,
) -> None:
    # PARKED: sandbox profiles were removed with the Bifrost gateway teardown
    # (specs/codebase/primitives/agent-auth-litellm.md); there is no profile
    # runtime config left to refresh.
    del db, user_id, reason


async def _refresh_org_runtime_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    reason: str,
) -> None:
    # PARKED: sandbox profiles were removed with the Bifrost gateway teardown
    # (specs/codebase/primitives/agent-auth-litellm.md); there is no profile
    # runtime config left to refresh.
    del db, user_id, organization_id, reason
