"""The v1 emit JSON Schema profile validator (feature spec §6.2).

V1 accepts only the vocabulary implemented in all three contract languages;
unsupported keywords are rejected at save/compile rather than ignored. This
mirror is byte-for-byte equivalent in behavior to the Rust and TypeScript
validators over the shared golden valid/invalid fixtures.
"""

from __future__ import annotations

import re
from typing import Any

DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"

ALLOWED_KEYWORDS = frozenset(
    {
        "$schema",
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "enum",
        "const",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "title",
        "description",
        "default",
    }
)

_JSON_TYPES = frozenset({"object", "array", "string", "number", "integer", "boolean", "null"})

_ASCII_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class SchemaProfileError(ValueError):
    """A schema violates the v1 emit profile. ``code`` is the stable reason."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _validate_type(node_type: Any) -> None:  # noqa: ANN401 - validates untrusted JSON
    if isinstance(node_type, str):
        if node_type not in _JSON_TYPES:
            raise SchemaProfileError("invalid_type", f"unknown type {node_type!r}")
        return
    if isinstance(node_type, list):
        if len(node_type) != 2 or node_type[1] != "null":
            raise SchemaProfileError(
                "invalid_type",
                'a type union must be a two-item [TYPE, "null"]',
            )
        head = node_type[0]
        if not isinstance(head, str) or head not in _JSON_TYPES or head == "null":
            raise SchemaProfileError("invalid_type", "invalid union head type")
        return
    raise SchemaProfileError("invalid_type", "type must be a string or a two-item union")


def _validate_node(node: Any, *, is_root: bool) -> None:  # noqa: ANN401 - validates untrusted JSON
    if not isinstance(node, dict):
        raise SchemaProfileError("node_not_object", "schema node must be an object")

    for key in node:
        if key not in ALLOWED_KEYWORDS:
            raise SchemaProfileError("unsupported_keyword", f"keyword {key!r} is not permitted")

    schema_dialect = node.get("$schema")
    if is_root:
        if schema_dialect is not None and schema_dialect != DRAFT_2020_12:
            raise SchemaProfileError("wrong_dialect", "root $schema must be draft 2020-12")
        if node.get("type") != "object":
            raise SchemaProfileError("root_type_not_object", "emit root must be type object")
    elif schema_dialect is not None:
        raise SchemaProfileError("unsupported_keyword", "$schema only allowed at the root")

    if "type" in node:
        _validate_type(node["type"])

    for numeric_key in ("minimum", "maximum"):
        if numeric_key in node and not isinstance(node[numeric_key], (int, float)):
            raise SchemaProfileError("invalid_bound", f"{numeric_key} must be a finite number")
    for int_key in ("minLength", "maxLength", "minItems", "maxItems"):
        if int_key in node and (
            not isinstance(node[int_key], int) or isinstance(node[int_key], bool)
        ):
            raise SchemaProfileError("invalid_bound", f"{int_key} must be an integer")

    if "enum" in node and not isinstance(node["enum"], list):
        raise SchemaProfileError("invalid_enum", "enum must be an array")

    properties = node.get("properties")
    if properties is not None:
        if not isinstance(properties, dict):
            raise SchemaProfileError("invalid_properties", "properties must be an object")
        for prop_name, prop_schema in properties.items():
            if is_root and not _ASCII_IDENTIFIER.match(prop_name):
                raise SchemaProfileError(
                    "property_name_not_ascii_identifier",
                    f"top-level property {prop_name!r} is not an ASCII identifier",
                )
            _validate_node(prop_schema, is_root=False)

    required = node.get("required")
    if required is not None and not (
        isinstance(required, list) and all(isinstance(r, str) for r in required)
    ):
        raise SchemaProfileError("invalid_required", "required must be an array of strings")

    items = node.get("items")
    if items is not None:
        _validate_node(items, is_root=False)


def validate_schema_profile(document: Any) -> None:  # noqa: ANN401 - public JSON boundary
    """Raise ``SchemaProfileError`` if ``document`` is not a valid v1 emit schema."""

    _validate_node(document, is_root=True)
