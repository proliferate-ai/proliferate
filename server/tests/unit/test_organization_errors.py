from __future__ import annotations

from proliferate.errors import ProliferateError
from proliferate.server.organizations.errors import OrganizationServiceError


def test_organization_service_error_is_product_error() -> None:
    error = OrganizationServiceError(
        "organization_not_found",
        "Organization not found.",
        status_code=404,
    )

    assert isinstance(error, ProliferateError)
    assert error.code == "organization_not_found"
    assert error.message == "Organization not found."
    assert error.status_code == 404
    assert str(error) == "Organization not found."
