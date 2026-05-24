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
    litellm_topology: str,
    customer_secret_isolation_verified: bool,
    isolation_proof_ref: str | None = None,
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
        litellm_topology=litellm_topology,
        customer_secret_isolation_verified=customer_secret_isolation_verified,
        isolation_proof_ref=isolation_proof_ref,
    ):
        return GatewayByokVerdict(
            allowed=False,
            code="gateway_byok_route_isolation_unverified",
            message="Gateway BYOK requires a verified LiteLLM route-isolation proof.",
        )
    return GatewayByokVerdict(allowed=True, code=None, message=None)


def gateway_route_isolation_ready(
    *,
    litellm_topology: str,
    customer_secret_isolation_verified: bool,
    isolation_proof_ref: str | None = None,
) -> bool:
    topology = litellm_topology.strip().lower()
    if topology != "enterprise_shared":
        return False
    return customer_secret_isolation_verified and bool((isolation_proof_ref or "").strip())
