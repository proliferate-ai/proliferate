"""Pure desired-state helpers for LiteLLM provisioning."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class LiteLLMModelDeploymentPlan:
    public_model_name: str
    provider_model: str
    litellm_params: Mapping[str, object]


def fingerprint_litellm_policy_state(
    *,
    policy_kind: str,
    litellm_team_id: str | None,
    budget_subject_id: str | None,
    provider_kind: str | None,
    model_deployments: Sequence[LiteLLMModelDeploymentPlan],
) -> str:
    payload = {
        "budgetSubjectId": budget_subject_id,
        "litellmTeamId": litellm_team_id,
        "modelDeployments": [
            {
                "publicModelName": item.public_model_name,
                "providerModel": item.provider_model,
                "litellmParams": dict(item.litellm_params),
            }
            for item in model_deployments
        ],
        "policyKind": policy_kind,
        "providerKind": provider_kind,
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
