from __future__ import annotations

from proliferate.errors import ProliferateError
from proliferate.server.billing.errors import BillingServiceError


def test_billing_service_error_is_product_error() -> None:
    error = BillingServiceError(
        "billing_failed",
        "Billing operation failed.",
        status_code=409,
    )

    assert isinstance(error, ProliferateError)
    assert error.code == "billing_failed"
    assert error.message == "Billing operation failed."
    assert error.status_code == 409
    assert str(error) == "Billing operation failed."
