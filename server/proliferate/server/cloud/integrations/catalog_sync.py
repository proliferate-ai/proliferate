from __future__ import annotations

from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_integrations import definitions as definition_store
from proliferate.server.cloud.integrations.domain.catalog_schema import (
    definition_config_json,
    definition_content_hash,
    load_catalog,
)

_CATALOG_PATH = (
    Path(__file__).resolve().parents[5] / "catalogs" / "integrations" / "v1" / "catalog.yaml"
)


async def sync_seed_integration_catalog(db: AsyncSession) -> int:
    catalog = load_catalog(_CATALOG_PATH)
    active_keys: set[str] = set()
    changed = 0
    for definition in catalog.definitions:
        active_keys.add(definition.key)
        existing = await definition_store.get_definition_by_key(db, key=definition.key)
        content_hash = definition_content_hash(definition)
        record = await definition_store.upsert_seed_definition(
            db,
            key=definition.key,
            source_version=catalog.version,
            content_hash=content_hash,
            display_name=definition.display_name,
            namespace=definition.namespace,
            provider_group=definition.provider_group,
            transport=definition.transport,
            implementation=definition.implementation,
            config_json=definition_config_json(definition),
            enabled_by_default=definition.default_enabled,
        )
        if existing is None or existing.content_hash != record.content_hash:
            changed += 1
    changed += await definition_store.archive_missing_seed_definitions(
        db,
        active_keys=active_keys,
    )
    return changed
