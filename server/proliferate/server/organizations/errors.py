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
