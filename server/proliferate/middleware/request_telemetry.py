from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from proliferate.integrations.sentry import set_server_sentry_tag
from proliferate.middleware.request_context import get_request_id


class RequestTelemetryMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        request_id = get_request_id() or getattr(request.state, "request_id", None)
        if request_id:
            set_server_sentry_tag("request_id", request_id)
        set_server_sentry_tag("http_method", request.method)
        set_server_sentry_tag("http_path", request.url.path)
        return await call_next(request)
