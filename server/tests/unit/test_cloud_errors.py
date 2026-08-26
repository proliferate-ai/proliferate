from __future__ import annotations

from proliferate.errors import ProliferateError
from proliferate.server.api_errors import CloudApiError


def test_cloud_api_error_is_product_error() -> None:
    error = CloudApiError("cloud_failed", "Cloud operation failed.", status_code=409)

    assert isinstance(error, ProliferateError)
    assert error.code == "cloud_failed"
    assert error.message == "Cloud operation failed."
    assert error.status_code == 409
    assert str(error) == "Cloud operation failed."
