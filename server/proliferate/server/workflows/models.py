"""Shared wire-model bases for workflow definitions and invocations.

The concrete gen-2 (schema_version 2) request/response models live in
``models_v2``; this module owns only the alias/strictness bases they extend
and the scalar argument type.
"""

from __future__ import annotations

from pydantic import (
    BaseModel,
    ConfigDict,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
)
from pydantic.alias_generators import to_camel


class WorkflowWireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class WorkflowDefinitionWireModel(WorkflowWireModel):
    """Definition JSON accepts only its canonical camel-case wire aliases."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=False,
        validate_by_alias=True,
        validate_by_name=False,
    )


class WorkflowInvocationWireModel(WorkflowWireModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class WorkflowInvocationRequestWireModel(WorkflowInvocationWireModel):
    """Invocation requests accept only canonical camel-case wire aliases."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=False,
        validate_by_alias=True,
        validate_by_name=False,
    )


WorkflowInvocationScalar = StrictBool | StrictInt | StrictFloat | StrictStr
