"""Agent-auth Bifrost client construction helpers."""

from __future__ import annotations

import sys

from proliferate.integrations.bifrost import BifrostAdminClient


def new_bifrost_admin_client() -> BifrostAdminClient:
    """Build a Bifrost admin client through the stable service import surface."""
    service_module = sys.modules.get("proliferate.server.cloud.agent_auth.service")
    factory = getattr(service_module, "BifrostAdminClient", BifrostAdminClient)
    return factory()
