"""Policy decisions for cloud compute target operations."""

from __future__ import annotations

from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.server.cloud.compute.domain.types import ComputeTargetAdminVerdict


def decide_compute_target_admin_membership(
    membership_role: str | None,
) -> ComputeTargetAdminVerdict:
    if membership_role is None:
        return ComputeTargetAdminVerdict(allowed=False, denial="organization_not_found")
    if membership_role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        return ComputeTargetAdminVerdict(allowed=False, denial="permission_denied")
    return ComputeTargetAdminVerdict(allowed=True)
