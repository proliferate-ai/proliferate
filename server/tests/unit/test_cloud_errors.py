from __future__ import annotations

import pytest
from fastapi import HTTPException

from proliferate.errors import ProliferateError
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error


def test_cloud_api_error_is_product_error() -> None:
    error = CloudApiError("cloud_failed", "Cloud operation failed.", status_code=409)

    assert isinstance(error, ProliferateError)
    assert error.code == "cloud_failed"
    assert error.message == "Cloud operation failed."
    assert error.status_code == 409
    assert str(error) == "Cloud operation failed."


def test_raise_cloud_error_keeps_transitional_response_shape() -> None:
    error = CloudApiError("cloud_failed", "Cloud operation failed.", status_code=409)

    with pytest.raises(HTTPException) as exc_info:
        raise_cloud_error(error)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "code": "cloud_failed",
        "message": "Cloud operation failed.",
    }
