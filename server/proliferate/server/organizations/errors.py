from __future__ import annotations

from proliferate.errors import ProliferateError


class OrganizationServiceError(ProliferateError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        extra_detail: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message=message, code=code, status_code=status_code)
        self.extra_detail = dict(extra_detail or {})


class InstanceOrganizationAlreadyClaimed(OrganizationServiceError):
    """Raised when the first-run claim path finds an instance org already exists."""

    def __init__(self) -> None:
        super().__init__(
            code="instance_already_claimed",
            message="This Proliferate instance has already been set up.",
            status_code=409,
        )


class InstanceOrganizationAccessRemoved(OrganizationServiceError):
    """Raised when a removed instance-org member tries to regain access.

    An admin removed this user's membership from the instance organization.
    Login and read paths fail closed with this error instead of silently
    reactivating the membership. The only reinstatement paths are a fresh
    invitation from an admin and the ADMIN_EMAILS floor (the documented
    lockout-recovery mechanism).
    """

    def __init__(self) -> None:
        super().__init__(
            code="instance_access_removed",
            message=(
                "Your access to this instance has been removed. "
                "Contact an admin of this instance to be re-invited."
            ),
            status_code=403,
        )


class InstanceOrganizationNotClaimed(OrganizationServiceError):
    """Raised when single-org mode is on but the instance org does not exist yet.

    In single-org deployments the instance organization is created once, by the
    first-run claim flow. Until that happens the membership policy fails closed
    rather than silently minting a personal organization.
    """

    def __init__(self) -> None:
        super().__init__(
            code="instance_not_claimed",
            message=(
                "This Proliferate instance has not been set up yet. "
                "Complete first-run setup before signing in."
            ),
            status_code=503,
        )
