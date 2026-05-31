from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

_request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
_user_id_var: ContextVar[str | None] = ContextVar("user_id", default=None)
_organization_id_var: ContextVar[str | None] = ContextVar("organization_id", default=None)
_tenant_id_var: ContextVar[str | None] = ContextVar("tenant_id", default=None)
_support_report_id_var: ContextVar[str | None] = ContextVar("support_report_id", default=None)
_cloud_workspace_id_var: ContextVar[str | None] = ContextVar("cloud_workspace_id", default=None)
_cloud_target_id_var: ContextVar[str | None] = ContextVar("cloud_target_id", default=None)
_sandbox_profile_id_var: ContextVar[str | None] = ContextVar("sandbox_profile_id", default=None)
_cloud_sandbox_id_var: ContextVar[str | None] = ContextVar("cloud_sandbox_id", default=None)
_external_sandbox_id_var: ContextVar[str | None] = ContextVar("external_sandbox_id", default=None)
_anyharness_workspace_id_var: ContextVar[str | None] = ContextVar(
    "anyharness_workspace_id",
    default=None,
)
_session_id_var: ContextVar[str | None] = ContextVar("session_id", default=None)
_interaction_id_var: ContextVar[str | None] = ContextVar("interaction_id", default=None)
_command_id_var: ContextVar[str | None] = ContextVar("command_id", default=None)
_worker_id_var: ContextVar[str | None] = ContextVar("worker_id", default=None)
_slot_generation_var: ContextVar[str | None] = ContextVar("slot_generation", default=None)

_CORRELATION_VARS: dict[str, ContextVar[str | None]] = {
    "request_id": _request_id_var,
    "user_id": _user_id_var,
    "organization_id": _organization_id_var,
    "tenant_id": _tenant_id_var,
    "support_report_id": _support_report_id_var,
    "cloud_workspace_id": _cloud_workspace_id_var,
    "cloud_target_id": _cloud_target_id_var,
    "sandbox_profile_id": _sandbox_profile_id_var,
    "cloud_sandbox_id": _cloud_sandbox_id_var,
    "external_sandbox_id": _external_sandbox_id_var,
    "anyharness_workspace_id": _anyharness_workspace_id_var,
    "session_id": _session_id_var,
    "interaction_id": _interaction_id_var,
    "command_id": _command_id_var,
    "worker_id": _worker_id_var,
    "slot_generation": _slot_generation_var,
}


def get_request_id() -> str | None:
    return _request_id_var.get()


def get_correlation_context() -> dict[str, str]:
    return {
        key: value
        for key, context_var in _CORRELATION_VARS.items()
        if (value := context_var.get()) is not None
    }


def capture_correlation_context() -> dict[str, str]:
    return get_correlation_context()


def set_authenticated_user_context(user_id: str | None) -> None:
    _user_id_var.set(str(user_id) if user_id else None)


def set_resource_tenant_context(
    *,
    organization_id: str | None = None,
    tenant_id: str | None = None,
) -> None:
    _organization_id_var.set(str(organization_id) if organization_id else None)
    _tenant_id_var.set(str(tenant_id) if tenant_id else None)


def set_support_report_context(report_id: str | None) -> None:
    _support_report_id_var.set(str(report_id) if report_id else None)


@contextmanager
def with_correlation_context(**fields: object) -> Iterator[None]:
    tokens: list[tuple[ContextVar[str | None], Token[str | None]]] = []
    try:
        for key, value in fields.items():
            context_var = _CORRELATION_VARS.get(key)
            if context_var is None:
                continue
            tokens.append(
                (context_var, context_var.set(str(value) if value is not None else None))
            )
        yield
    finally:
        for context_var, token in reversed(tokens):
            context_var.reset(token)


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid4())
        tokens: list[tuple[ContextVar[str | None], Token[str | None]]] = []
        for key, context_var in _CORRELATION_VARS.items():
            tokens.append(
                (context_var, context_var.set(request_id if key == "request_id" else None))
            )
        request.state.request_id = request_id

        try:
            response = await call_next(request)
        finally:
            for context_var, token in reversed(tokens):
                context_var.reset(token)

        response.headers["X-Request-ID"] = request_id
        return response
