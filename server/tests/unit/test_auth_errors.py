from __future__ import annotations

import json

import pytest
from fastapi import Request

from proliferate.auth.errors import AuthFlowError
from proliferate.errors import InvalidRequest, ProliferateError
from proliferate.main import _proliferate_error_handler


class _InvalidRequestWithExtraDetail(InvalidRequest):
    def __init__(self) -> None:
        super().__init__("Input was invalid.", code="input_invalid")
        self.extra_detail = {"field": "email"}


def _request() -> Request:
    return Request({"type": "http"})


def test_auth_flow_error_is_typed_and_copies_headers() -> None:
    headers = {"X-Auth-Contract": "preserved"}
    error = AuthFlowError(
        "desktop_auth_failed",
        "Desktop auth failed.",
        status_code=409,
        headers=headers,
    )
    headers["X-Auth-Contract"] = "changed"

    assert isinstance(error, ProliferateError)
    assert error.code == "desktop_auth_failed"
    assert error.message == "Desktop auth failed."
    assert error.status_code == 409
    assert isinstance(error.headers, dict)
    assert error.headers is not headers
    assert error.headers == {"X-Auth-Contract": "preserved"}
    assert str(error) == "Desktop auth failed."


@pytest.mark.asyncio
async def test_global_handler_preserves_auth_flow_error_shape_and_headers() -> None:
    error = AuthFlowError(
        "desktop_auth_failed",
        "Desktop auth failed.",
        status_code=401,
        headers={"X-Auth-Contract": "preserved"},
    )

    response = await _proliferate_error_handler(_request(), error)

    assert response.status_code == 401
    assert json.loads(response.body) == {"detail": "Desktop auth failed."}
    assert response.headers["x-auth-contract"] == "preserved"


@pytest.mark.asyncio
async def test_global_handler_keeps_normal_product_error_envelope() -> None:
    error = InvalidRequest("Input was invalid.", code="input_invalid")

    response = await _proliferate_error_handler(_request(), error)

    assert response.status_code == 400
    assert json.loads(response.body) == {
        "detail": {"code": "input_invalid", "message": "Input was invalid."}
    }


@pytest.mark.asyncio
async def test_global_handler_keeps_normal_extra_detail() -> None:
    error = _InvalidRequestWithExtraDetail()

    response = await _proliferate_error_handler(_request(), error)

    assert response.status_code == 400
    assert json.loads(response.body) == {
        "detail": {
            "code": "input_invalid",
            "message": "Input was invalid.",
            "field": "email",
        }
    }
