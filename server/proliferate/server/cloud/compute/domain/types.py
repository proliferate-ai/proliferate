"""Internal types for cloud compute operational decisions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ComputeTargetAdminDenial = Literal[
    "organization_not_found",
    "permission_denied",
]


@dataclass(frozen=True)
class ComputeTargetAdminVerdict:
    allowed: bool
    denial: ComputeTargetAdminDenial | None = None


@dataclass(frozen=True)
class ComputeRuleError(ValueError):
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class SafeStopVerdict:
    allowed: bool
    reasons: tuple[str, ...]
