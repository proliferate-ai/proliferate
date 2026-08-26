from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from proliferate.integrations.sentry import (
    clear_server_sentry_user,
    set_server_sentry_correlation_context,
    set_server_sentry_tag,
)
from proliferate.integrations.sentry.privacy import canonical_uuid
from proliferate.middleware.request_context import (
    get_correlation_context,
    get_request_id,
    with_correlation_context,
)

_UUIDISH_SEGMENT_LENGTH = 24
_SESSION_PATH_SEGMENT = "sessions"


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
        # The runtime gateway proxies session routes verbatim, so the path is
        # the only place this middleware can learn which session a request
        # serves; only a canonical UUID is ever bound.
        with with_correlation_context(session_id=session_id_from_path(request.url.path)):
            try:
                response = await call_next(request)
            finally:
                set_server_sentry_correlation_context(get_correlation_context())
                # Clear the authenticated user from the scope at request teardown so
                # it cannot bleed onto the next request handled by this worker.
                clear_server_sentry_user()
        return response


def session_id_from_path(path: str) -> str | None:
    segments = [segment for segment in path.split("/") if segment]
    for index, segment in enumerate(segments[:-1]):
        if segment == _SESSION_PATH_SEGMENT:
            return canonical_uuid(segments[index + 1])
    return None


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
