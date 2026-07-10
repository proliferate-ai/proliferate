"""Service layer for function-invocation CRUD (track 1b phase 3 settings surface).

A thin layer over ``db.store.function_invocations`` that adds request validation
(name shape, method enum, JSON-Schema well-formedness) the store itself doesn't
own. Invocations are person-scoped (``owner_user_id``) — every operation here is
scoped to the acting user, never cross-user (Part II mental-model §1).
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

import jsonschema
from jsonschema.validators import validator_for
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    FUNCTION_INVOCATION_NAME_MAX_LENGTH,
    FUNCTION_INVOCATION_SUPPORTED_METHODS,
)
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.function_invocations import FunctionInvocationRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.function_invocations.models import (
    FunctionInvocationResponse,
)

_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _response(record: FunctionInvocationRecord) -> FunctionInvocationResponse:
    return FunctionInvocationResponse(
        id=record.id,
        name=record.name,
        display_name=record.display_name,
        description=record.description,
        endpoint_url=record.endpoint_url,
        method=record.method,
        args_schema=record.args_schema_json,
        chat_scope_enabled=record.chat_scope_enabled,
        has_headers=record.has_headers,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _validate_name_or_raise(name: str) -> str:
    name = name.strip()
    if len(name) > FUNCTION_INVOCATION_NAME_MAX_LENGTH or not _NAME_PATTERN.fullmatch(name):
        raise CloudApiError(
            "invalid_payload",
            f"Name must be 1-{FUNCTION_INVOCATION_NAME_MAX_LENGTH} lowercase "
            "alphanumeric or '_' characters and start with a letter — this is the "
            "gateway tool address the agent calls.",
            status_code=400,
        )
    return name


def _validate_method_or_raise(method: str) -> str:
    method = method.strip().lower()
    if method not in FUNCTION_INVOCATION_SUPPORTED_METHODS:
        supported = ", ".join(sorted(FUNCTION_INVOCATION_SUPPORTED_METHODS))
        raise CloudApiError(
            "invalid_payload",
            f"Method must be one of: {supported}.",
            status_code=400,
        )
    return method


def _validate_endpoint_url_or_raise(endpoint_url: str) -> str:
    endpoint_url = endpoint_url.strip()
    from urllib.parse import urlsplit

    parsed = urlsplit(endpoint_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise CloudApiError(
            "invalid_payload",
            "Endpoint URL must be a valid http(s) URL.",
            status_code=400,
        )
    return endpoint_url


def _validate_args_schema_or_raise(args_schema: dict[str, Any]) -> dict[str, Any]:
    """Confirm the authored schema is itself well-formed JSON Schema — the same
    ``jsonschema`` dependency the gateway uses to validate the agent's call args
    at dispatch time (Part II §11)."""
    if not isinstance(args_schema, dict):
        raise CloudApiError(
            "invalid_payload", "Args schema must be a JSON object.", status_code=400
        )
    if not args_schema:
        return args_schema
    try:
        validator_cls = validator_for(args_schema)
        validator_cls.check_schema(args_schema)
    except jsonschema.SchemaError as exc:
        raise CloudApiError(
            "invalid_payload",
            f"Args schema is not a valid JSON Schema: {exc.message}",
            status_code=400,
        ) from None
    return args_schema


async def list_function_invocations(
    db: AsyncSession, *, owner_user_id: UUID
) -> list[FunctionInvocationResponse]:
    records = await invocations_store.list_for_owner(db, owner_user_id)
    return [_response(record) for record in records]


async def create_function_invocation(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
    name: str,
    endpoint_url: str,
    method: str,
    args_schema: dict[str, Any],
    headers: dict[str, str] | None,
    display_name: str | None,
    description: str | None,
) -> FunctionInvocationResponse:
    name = _validate_name_or_raise(name)
    method = _validate_method_or_raise(method)
    endpoint_url = _validate_endpoint_url_or_raise(endpoint_url)
    args_schema = _validate_args_schema_or_raise(args_schema)

    existing = await invocations_store.get_by_name(db, owner_user_id=owner_user_id, name=name)
    if existing is not None:
        raise CloudApiError(
            "function_invocation_name_taken",
            f"You already have a function invocation named '{name}'.",
            status_code=409,
        )

    record = await invocations_store.create(
        db,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=owner_user_id,
        name=name,
        endpoint_url=endpoint_url,
        method=method,
        args_schema_json=args_schema,
        headers=headers,
        display_name=display_name.strip() if display_name else None,
        description=description.strip() if description else None,
        chat_scope_enabled=False,  # §2: workflow-only until explicitly enabled for chat
    )
    return _response(record)


UNSET = invocations_store.UNSET  # the shared "not supplied" sentinel


async def update_function_invocation(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    name: str,
    display_name: str | None | object = UNSET,
    description: str | None | object = UNSET,
    endpoint_url: str | None = None,
    method: str | None = None,
    args_schema: dict[str, Any] | None = None,
) -> FunctionInvocationResponse:
    """Only fields the caller explicitly supplied are changed. ``display_name``/
    ``description`` use the shared ``UNSET`` sentinel to distinguish "not
    supplied" from "explicitly cleared to None"; ``endpoint_url``/``method``/
    ``args_schema`` default to ``None`` meaning "unchanged" since an empty-string
    clear is not meaningful for those fields."""
    record = await invocations_store.update(
        db,
        owner_user_id=owner_user_id,
        name=name,
        display_name=(
            (display_name.strip() if display_name else None)
            if display_name is not UNSET
            else UNSET
        ),
        description=(
            (description.strip() if description else None)
            if description is not UNSET
            else UNSET
        ),
        endpoint_url=_validate_endpoint_url_or_raise(endpoint_url) if endpoint_url else None,
        method=_validate_method_or_raise(method) if method else None,
        args_schema_json=_validate_args_schema_or_raise(args_schema)
        if args_schema is not None
        else None,
    )
    if record is None:
        raise CloudApiError(
            "not_found", f"No function invocation named '{name}'.", status_code=404
        )
    return _response(record)


async def rotate_function_invocation_headers(
    db: AsyncSession, *, owner_user_id: UUID, name: str, headers: dict[str, str] | None
) -> FunctionInvocationResponse:
    record = await invocations_store.rotate_headers(
        db, owner_user_id=owner_user_id, name=name, headers=headers
    )
    if record is None:
        raise CloudApiError(
            "not_found", f"No function invocation named '{name}'.", status_code=404
        )
    return _response(record)


async def set_function_invocation_chat_scope_enabled(
    db: AsyncSession, *, owner_user_id: UUID, name: str, enabled: bool
) -> FunctionInvocationResponse:
    record = await invocations_store.set_chat_scope_enabled(
        db, owner_user_id=owner_user_id, name=name, enabled=enabled
    )
    if record is None:
        raise CloudApiError(
            "not_found", f"No function invocation named '{name}'.", status_code=404
        )
    return _response(record)


async def archive_function_invocation(
    db: AsyncSession, *, owner_user_id: UUID, name: str
) -> None:
    archived = await invocations_store.archive(db, owner_user_id=owner_user_id, name=name)
    if not archived:
        raise CloudApiError(
            "not_found", f"No function invocation named '{name}'.", status_code=404
        )
