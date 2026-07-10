"""Request/response models for the function-invocation CRUD API (track 1b phase 3).

camelCase on the wire, mirroring the rest of the integrations models. Headers are
WRITE-ONLY (D4 posture, Part II mental-model §1/§11): the create/rotate requests
accept a headers map, but no response model ever carries header values — only
``hasHeaders``, a boolean presence flag.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class FunctionInvocationResponse(_CamelModel):
    id: UUID
    name: str
    display_name: str | None = None
    description: str | None = None
    endpoint_url: str
    method: str
    args_schema: dict[str, Any]
    # §2 "default access modes" — a new invocation is workflow-only
    # (``False``) until explicitly enabled for chat.
    chat_scope_enabled: bool
    has_headers: bool
    created_at: datetime
    updated_at: datetime


class FunctionInvocationListResponse(_CamelModel):
    items: list[FunctionInvocationResponse]


class CreateFunctionInvocationRequest(_CamelModel):
    name: str
    display_name: str | None = None
    description: str | None = None
    endpoint_url: str
    method: str
    args_schema: dict[str, Any] = Field(default_factory=dict)
    headers: dict[str, str] | None = None


class UpdateFunctionInvocationRequest(_CamelModel):
    """Every field is optional; only supplied fields are changed. ``name`` and
    headers are not editable here — name is immutable post-create (it's the
    gateway tool address), headers go through the dedicated rotate endpoint."""

    display_name: str | None = None
    description: str | None = None
    endpoint_url: str | None = None
    method: str | None = None
    args_schema: dict[str, Any] | None = None


class SetFunctionInvocationChatScopeEnabledRequest(_CamelModel):
    enabled: bool


class RotateFunctionInvocationHeadersRequest(_CamelModel):
    """``headers=None`` (or ``{}``) clears the stored ciphertext."""

    headers: dict[str, str] | None = None
