"""AWS integration payload models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BedrockAssumeRoleValidation:
    role_arn: str
    region: str
    external_id: str
    account_id: str
