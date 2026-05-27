"""Pure desired-state helpers for gateway router provisioning."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class GatewayModelDeploymentPlan:
    public_model_name: str
    provider_model: str
    provider_params: Mapping[str, object]


def fingerprint_gateway_policy_state(
    *,
    policy_kind: str,
    router_object_id: str | None,
    budget_subject_id: str | None,
    provider_kind: str | None,
    model_deployments: Sequence[GatewayModelDeploymentPlan],
) -> str:
    payload = {
        "budgetSubjectId": budget_subject_id,
        "modelDeployments": [
            {
                "publicModelName": item.public_model_name,
                "providerModel": item.provider_model,
                "providerParams": dict(item.provider_params),
            }
            for item in model_deployments
        ],
        "policyKind": policy_kind,
        "providerKind": provider_kind,
        "routerObjectId": router_object_id,
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
