"""Binding actor authentication confused-credential tests."""

from __future__ import annotations

import pytest
from starlette.requests import Request

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.binding import access

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("token", ["stale-worker-token", "jwt.shaped.invalid"])
async def test_invalid_worker_bearer_never_falls_back_to_another_actor(
    monkeypatch: pytest.MonkeyPatch,
    token: str,
) -> None:
    async def missing_worker(*_args: object, **_kwargs: object):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(access.worker_store, "get_worker_by_token_hash", missing_worker)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/runs/1/materialization-offer",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
        }
    )

    with pytest.raises(CloudApiError) as caught:
        await access.authenticate_binding_actor(request, object())  # type: ignore[arg-type]
    assert caught.value.code == "workflow_binding_unauthorized"
    assert caught.value.status_code == 401
