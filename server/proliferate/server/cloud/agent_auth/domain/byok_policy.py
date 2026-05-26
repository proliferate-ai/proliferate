"""Pure availability rules for gateway BYOK policies."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GatewayByokVerdict:
    allowed: bool
    code: str | None
    message: str | None


def gateway_byok_policy_verdict(
    *,
    policy_kind: str,
    gateway_byok_enabled: bool,
    personal_byok_enabled: bool,
    bifrost_isolation_verified: bool = False,
) -> GatewayByokVerdict:
    if not gateway_byok_enabled:
        return GatewayByokVerdict(
            allowed=False,
            code="gateway_byok_disabled",
            message="Gateway BYOK provider credentials are disabled.",
        )
    if policy_kind == "personal_byok" and not personal_byok_enabled:
        return GatewayByokVerdict(
            allowed=False,
            code="personal_byok_disabled",
            message="Personal BYOK is not enabled for cloud use.",
        )
    if policy_kind in {"personal_byok", "org_byok"} and not gateway_route_isolation_ready(
        bifrost_isolation_verified=bifrost_isolation_verified,
    ):
        return GatewayByokVerdict(
            allowed=False,
            code="gateway_byok_route_isolation_unverified",
            message="Gateway BYOK requires verified router secret isolation.",
        )
    return GatewayByokVerdict(allowed=True, code=None, message=None)


def gateway_route_isolation_ready(
    *,
    bifrost_isolation_verified: bool = False,
) -> bool:
    return bifrost_isolation_verified
