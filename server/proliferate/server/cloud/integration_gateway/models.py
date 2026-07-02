"""Value types for the integration gateway."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.db.store.integrations.accounts import IntegrationAccountRecord
from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord


@dataclass(frozen=True)
class GatewayProviderAccount:
    """A ready integration account paired with its definition."""

    account: IntegrationAccountRecord
    definition: IntegrationDefinitionRecord
