"""Poll-endpoint contract models + item-data schema validation (spec 4.2).

The contract is LOCKED (issue-autofix-system-v1 §2, restated verbatim in the
architecture doc §4.2):

    GET /poll?cursor=<opaque>&limit=50
    Authorization: <configured header>

    200 -> {
      "items": [
        {"id": "...", "kind": "...", "occurred_at": "...", "data": { ... }}
      ],
      "cursor": "<opaque, server-owned; echoed next poll>",
      "has_more": false
    }

``id`` is the idempotency key; ``data`` is validated against the trigger's item
schema before an item ever reaches an agent. The cursor is opaque — Proliferate
stores and echoes it, never interprets it.

``validate_item_data`` implements a small, dependency-free subset of JSON Schema
(the server has no ``jsonschema`` dependency): ``type``, ``required``,
``properties``, ``items``, ``enum``, ``minLength``/``maxLength``,
``minItems``/``maxItems``, and ``minimum``/``maximum``. A ``None``/empty schema
accepts anything. It returns a human-readable error string on the first failure,
or ``None`` when the data conforms.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, TypeGuard

from pydantic import BaseModel, ConfigDict, Field

from proliferate.constants.workflows import (
    WORKFLOW_INPUT_TYPE_BOOLEAN,
    WORKFLOW_INPUT_TYPE_CHOICE,
    WORKFLOW_INPUT_TYPE_NUMBER,
    WORKFLOW_INPUT_TYPE_TEXT,
)

if TYPE_CHECKING:
    from proliferate.server.cloud.workflows.domain.interpolation import ArgSpec


class PollItem(BaseModel):
    """One poll item. ``id`` is the stable, unique idempotency key."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=255)
    kind: str | None = None
    occurred_at: str | None = None
    data: dict[str, object] = Field(default_factory=dict)


class PollPage(BaseModel):
    """One page of the poll response. ``cursor`` is opaque + echoed verbatim."""

    model_config = ConfigDict(extra="ignore")

    items: list[PollItem] = Field(default_factory=list)
    cursor: str | None = None
    has_more: bool = False


# --- JSON Schema subset validation ---------------------------------------------

_JSON_TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    # bool is an int subclass in Python; a JSON number must not accept booleans.
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def _is_int(value: object) -> TypeGuard[int]:
    # bool is an int subclass; a JSON Schema integer keyword must not accept it.
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate(value: object, schema: dict[str, object], *, path: str) -> str | None:
    where = path or "data"

    declared_type = schema.get("type")
    if isinstance(declared_type, str):
        check = _JSON_TYPE_CHECKS.get(declared_type)
        if check is not None and not check(value):
            return f"{where} must be of type '{declared_type}'."
    elif isinstance(declared_type, list):
        if not any(
            (_JSON_TYPE_CHECKS.get(t) or (lambda _v: False))(value) for t in declared_type
        ):
            return f"{where} must be one of types {declared_type}."

    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        return f"{where} must be one of {enum}."

    if isinstance(value, str):
        min_length = schema.get("minLength")
        if _is_int(min_length) and len(value) < min_length:
            return f"{where} must be at least {min_length} characters."
        max_length = schema.get("maxLength")
        if _is_int(max_length) and len(value) > max_length:
            return f"{where} must be at most {max_length} characters."

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        if _is_number(minimum) and value < minimum:
            return f"{where} must be >= {minimum}."
        maximum = schema.get("maximum")
        if _is_number(maximum) and value > maximum:
            return f"{where} must be <= {maximum}."

    if isinstance(value, dict):
        required = schema.get("required")
        if isinstance(required, list):
            for key in required:
                if key not in value:
                    return f"{where} is missing required property '{key}'."
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for key, sub_schema in properties.items():
                if key in value and isinstance(sub_schema, dict):
                    error = _validate(value[key], sub_schema, path=f"{where}.{key}")
                    if error is not None:
                        return error

    if isinstance(value, list):
        min_items = schema.get("minItems")
        if _is_int(min_items) and len(value) < min_items:
            return f"{where} must have at least {min_items} item(s)."
        max_items = schema.get("maxItems")
        if _is_int(max_items) and len(value) > max_items:
            return f"{where} must have at most {max_items} item(s)."
        items_schema = schema.get("items")
        if isinstance(items_schema, dict):
            for index, element in enumerate(value):
                error = _validate(element, items_schema, path=f"{where}[{index}]")
                if error is not None:
                    return error

    return None


def validate_item_data(data: object, schema_json: dict[str, object] | None) -> str | None:
    """Validate a poll item's ``data`` against the trigger's item schema.

    Returns a human-readable error string on the first violation, or ``None`` when
    the data conforms. A ``None``/empty schema accepts any data.
    """

    if not schema_json:
        return None
    if not isinstance(schema_json, dict):
        return "Item schema is not a valid JSON Schema object."
    return _validate(data, schema_json, path="data")


# --- Item schema derivation (D17: derived from inputs, no authoring surface) ----

_INPUT_TYPE_TO_JSON_TYPE = {
    WORKFLOW_INPUT_TYPE_TEXT: "string",
    WORKFLOW_INPUT_TYPE_NUMBER: "number",
    WORKFLOW_INPUT_TYPE_BOOLEAN: "boolean",
    WORKFLOW_INPUT_TYPE_CHOICE: "string",
}


def derive_item_schema(
    arg_specs: Sequence[ArgSpec], *, covered_names: Iterable[str] = ()
) -> dict[str, object]:
    """Project the workflow's declared inputs into the poll item-data schema.

    There is no authoring surface for the poll item schema (D17): it is a pure
    function of the inputs. Each input becomes a ``properties`` entry typed to
    match its input type (choice inputs also carry the ``enum`` constraint). An
    input is ``required`` on each item's ``data`` unless it is already covered by
    a static preset (``covered_names``) or its own default — those inputs may be
    absent from ``data`` because the preset/default supplies them.

    The ``properties`` keys are exactly the declared input names, which is also
    the set the poller overlays from ``item.data`` by name.
    """

    properties: dict[str, object] = {}
    required: list[str] = []
    covered = set(covered_names)
    for spec in arg_specs:
        json_type = _INPUT_TYPE_TO_JSON_TYPE.get(spec.type, "string")
        prop: dict[str, object] = {"type": json_type}
        if spec.type == WORKFLOW_INPUT_TYPE_CHOICE and spec.enum_values:
            prop["enum"] = list(spec.enum_values)
        properties[spec.name] = prop
        if spec.required and not spec.has_default and spec.name not in covered:
            required.append(spec.name)
    schema: dict[str, object] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema
