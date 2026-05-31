from __future__ import annotations

import pytest
from starlette.requests import Request

from proliferate.middleware import request_telemetry
from proliferate.middleware.request_context import with_correlation_context
from proliferate.middleware.request_telemetry import RequestTelemetryMiddleware


def _request(path: str = "/v1/support/reports/report123/complete") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("testclient", 123),
            "query_string": b"",
        }
    )


@pytest.mark.asyncio
async def test_request_telemetry_sets_correlation_context_when_handler_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, str] = {}

    def fake_set_server_sentry_correlation_context(context: dict[str, str]) -> None:
        captured.update(context)

    monkeypatch.setattr(
        request_telemetry,
        "set_server_sentry_correlation_context",
        fake_set_server_sentry_correlation_context,
    )
    monkeypatch.setattr(request_telemetry, "set_server_sentry_tag", lambda *_args: None)

    middleware = RequestTelemetryMiddleware(app=lambda _scope, _receive, _send: None)

    async def raise_error(_request: Request):
        raise RuntimeError("boom")

    with (
        with_correlation_context(request_id="req-1", support_report_id="report-1"),
        pytest.raises(RuntimeError, match="boom"),
    ):
        await middleware.dispatch(_request(), raise_error)

    assert captured["request_id"] == "req-1"
    assert captured["support_report_id"] == "report-1"
