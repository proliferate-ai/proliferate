from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token

_rls_actor_user_id_var: ContextVar[str | None] = ContextVar(
    "rls_actor_user_id",
    default=None,
)
_rls_owner_scope_var: ContextVar[str | None] = ContextVar(
    "rls_owner_scope",
    default=None,
)
_rls_organization_id_var: ContextVar[str | None] = ContextVar(
    "rls_organization_id",
    default=None,
)

_RLS_CONTEXT_VARS: tuple[ContextVar[str | None], ...] = (
    _rls_actor_user_id_var,
    _rls_owner_scope_var,
    _rls_organization_id_var,
)


def set_rls_actor_context(user_id: object | None) -> None:
    _rls_actor_user_id_var.set(str(user_id) if user_id else None)


def set_rls_owner_context(
    *,
    owner_scope: str,
    organization_id: object | None,
) -> None:
    _rls_owner_scope_var.set(owner_scope)
    _rls_organization_id_var.set(str(organization_id) if organization_id else None)


def get_rls_context() -> tuple[str | None, str | None, str | None]:
    return (
        _rls_actor_user_id_var.get(),
        _rls_owner_scope_var.get(),
        _rls_organization_id_var.get(),
    )


@contextmanager
def with_rls_context(
    *,
    actor_user_id: object,
    owner_scope: str,
    organization_id: object | None,
) -> Iterator[None]:
    tokens: list[tuple[ContextVar[str | None], Token[str | None]]] = [
        (_rls_actor_user_id_var, _rls_actor_user_id_var.set(str(actor_user_id))),
        (_rls_owner_scope_var, _rls_owner_scope_var.set(owner_scope)),
        (
            _rls_organization_id_var,
            _rls_organization_id_var.set(str(organization_id) if organization_id else None),
        ),
    ]
    try:
        yield
    finally:
        for context_var, token in reversed(tokens):
            context_var.reset(token)


@contextmanager
def with_cleared_rls_context() -> Iterator[None]:
    tokens: list[tuple[ContextVar[str | None], Token[str | None]]] = [
        (context_var, context_var.set(None)) for context_var in _RLS_CONTEXT_VARS
    ]
    try:
        yield
    finally:
        for context_var, token in reversed(tokens):
            context_var.reset(token)
