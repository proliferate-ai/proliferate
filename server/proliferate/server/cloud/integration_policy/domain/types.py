"""Internal models for organization integration catalog policy."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class OrganizationIntegrationPolicyEntry:
    catalog_entry_id: str
    enabled: bool
    updated_at: datetime | None
    updated_by_user_id: UUID | None


@dataclass(frozen=True)
class OrganizationIntegrationPolicySnapshot:
    organization_id: UUID
    entries: tuple[OrganizationIntegrationPolicyEntry, ...]
