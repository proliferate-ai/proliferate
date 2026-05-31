from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from proliferate.integrations.sentry import (
    set_server_sentry_correlation_context,
    set_server_sentry_tag,
)
from proliferate.middleware.request_context import get_correlation_context, get_request_id

_UUIDISH_SEGMENT_LENGTH = 24


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
        set_server_sentry_tag("http_route", _sanitized_route(request))
        response = await call_next(request)
        set_server_sentry_correlation_context(get_correlation_context())
        return response


def _sanitized_route(request: Request) -> str:
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if isinstance(route_path, str) and route_path:
        return route_path
    parts = []
    for segment in request.url.path.split("/"):
        if not segment:
            continue
        parts.append("{id}" if _looks_dynamic_segment(segment) else segment)
    return "/" + "/".join(parts)


def _looks_dynamic_segment(segment: str) -> bool:
    if len(segment) >= _UUIDISH_SEGMENT_LENGTH:
        return True
    if len(segment) >= 16 and any(char.isdigit() for char in segment):
        return True
    return segment.startswith(("cloud:", "client-session:"))
