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

import re
from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, TypeGuard
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field

from proliferate.constants.workflows import (
    WORKFLOW_INPUT_TYPE_BOOLEAN,
    WORKFLOW_INPUT_TYPE_CHOICE,
    WORKFLOW_INPUT_TYPE_NUMBER,
    WORKFLOW_INPUT_TYPE_TEXT,
    WORKFLOW_MAX_ARGS,
    WORKFLOW_POLL_ERROR_MAX_LENGTH,
    WORKFLOW_SHORT_TEXT_MAX_LENGTH,
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
        if not any((_JSON_TYPE_CHECKS.get(t) or (lambda _v: False))(value) for t in declared_type):
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


def diff_item_against_schema(data: object, schema_json: dict[str, object] | None) -> list[str]:
    """Every way a sample item's ``data`` fails the derived item schema, field by
    field (mental-model §5 setup flow 2: "render exactly how their response doesn't
    track — field-by-field diff").

    ``validate_item_data`` short-circuits on the first violation, which is the right
    runtime backstop but a poor setup-time UX. This collects one message per
    declared input so the poll-trigger-from-workflow flow can show the whole diff.
    An empty list means the item conforms. A ``None``/empty schema accepts anything.
    """

    if not schema_json or not isinstance(schema_json, dict):
        return []
    if not isinstance(data, dict):
        return ["item 'data' must be a JSON object."]

    required = schema_json.get("required")
    required_set = set(required) if isinstance(required, list) else set()
    properties = schema_json.get("properties")
    props = properties if isinstance(properties, dict) else {}

    mismatches: list[str] = []
    for name, sub_schema in props.items():
        if name not in data:
            if name in required_set:
                mismatches.append(f"data is missing required property '{name}'.")
            continue
        value = data[name]
        # A null value is treated like an absent one (same required semantics): it
        # only fails when the field is required. A ``null`` on an OPTIONAL scalar
        # field must not hard-fail an otherwise-matching schema — this keeps the
        # derive→diff round-trip clean when a sample carries an explicit null for a
        # non-required field (mental-model §5 flow 2). ``derive_item_schema`` marks a
        # field required exactly when its input is required + uncovered + defaultless.
        if value is None:
            if name in required_set:
                mismatches.append(f"data.{name} must not be null (it is a required field).")
            continue
        if isinstance(sub_schema, dict):
            error = _validate(value, sub_schema, path=f"data.{name}")
            if error is not None:
                mismatches.append(error)
    # Required names with no declared property shape (defensive; derive_item_schema
    # always emits a property for every required input).
    for name in required_set - set(props):
        if name not in data:
            mismatches.append(f"data is missing required property '{name}'.")
    return mismatches


def overlay_item_inputs(
    item_data: object,
    *,
    static_inputs: dict[str, object],
    item_schema: dict[str, object] | None,
) -> dict[str, object]:
    """Static presets ⊕ the item's own fields, taken directly by name (D17).

    The trigger's static ``args_json`` presets are the base; each declared input
    the item's ``data`` carries overrides its preset. There is no dot-path
    mapping — a field named ``issue_id`` in ``data`` fills the ``issue_id`` input,
    nothing else. The declared input names are the ``properties`` keys of the
    derived item schema; fields in ``data`` that are not declared inputs are
    ignored (``start_run`` rejects unknown inputs). Item shape is validated
    against the (derived) schema before this overlay, so this never fails.

    Shared by the legacy poller loop (``poller.py``) and the WS4b beat-driven
    poll worker (``worker/polls.py``) — the overlay rule is pure and identical
    on both paths.
    """

    inputs: dict[str, object] = dict(static_inputs or {})
    declared = set((item_schema or {}).get("properties", {}) or {})
    if isinstance(item_data, dict):
        for name in declared:
            if name in item_data:
                inputs[name] = item_data[name]
    return inputs


def bound_error_message(message: str, *, max_length: int = WORKFLOW_POLL_ERROR_MAX_LENGTH) -> str:
    """Whitespace-normalize + truncate an error string to a bounded length.

    Shared truncation rule for every poll-lane error surface (HTTP/transport
    failure, item schema-validation failure, ``start_run`` failure): a third-party
    endpoint or a pathological item payload must never let an unbounded string
    land on the trigger/inbox row.
    """

    normalized = " ".join(message.split())
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 1] + "…"


def init_probe_url(feed_url: str) -> str:
    """The reserved ``GET <endpoint>/init`` path (mental-model §5, RULED 2026-07-09).

    A conforming poll endpoint MUST also serve ``<endpoint>/init`` returning a
    sample item. Proliferate hits it at setup + re-validation only (to infer/verify
    the item shape); poll cycles hit the real feed URL unchanged. Deriving the init
    path here keeps the reserved-path convention in one place.

    Built via ``urlsplit``/``urlunsplit`` (never string concat): ``/init`` is
    appended to the PATH, and any fragment is dropped. A naive
    ``feed_url + "/init"`` would append ``/init`` INSIDE a ``#fragment`` — which is
    never sent on the wire — so the "probe" would silently GET the real feed. The
    stored feed URL is separately guaranteed fragment-free at save time
    (``_validate_poll_config``), so this is belt-and-suspenders.
    """

    parts = urlsplit(feed_url)
    path = parts.path.rstrip("/") + "/init"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))


# --- Inputs derivation from a sample item (workflow-from-poll, mental-model §5) -

# A v2 input name must be an identifier (definition.py._IDENTIFIER_RE). A sample
# feed's field names are arbitrary JSON keys, so they are sanitized into legal
# identifiers before becoming input names.
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_NON_IDENTIFIER_CHARS = re.compile(r"[^A-Za-z0-9_]")


def _sanitize_input_name(raw_name: str) -> str | None:
    """Coerce a sample field name into a legal v2 input identifier, or ``None`` if
    nothing usable survives. Non-identifier characters collapse to ``_`` and a
    leading digit is prefixed so the result matches ``_IDENTIFIER_RE`` and passes
    the real definition validator (``_parse_inputs``)."""

    candidate = _NON_IDENTIFIER_CHARS.sub("_", raw_name.strip())
    if candidate and candidate[0].isdigit():
        candidate = f"_{candidate}"
    candidate = candidate[:WORKFLOW_SHORT_TEXT_MAX_LENGTH]
    if not candidate or not _IDENTIFIER_RE.match(candidate):
        return None
    return candidate


def _scalar_input_type(value: object) -> str | None:
    """Map a sample JSON *scalar* to a v2 input type, or ``None`` when the value is
    not a scalar (array/object/null).

    The v2 input types are a CLOSED union — text/number/boolean/choice only
    (choice has no JSON-type signature, so derivation only ever produces the first
    three). ``bool`` is checked before number because ``bool`` is an ``int``
    subclass. Arrays, objects and ``null`` have no scalar input type: an earlier
    version mapped them to ``text``, but ``text`` coerces to ``string`` and string
    coercion REJECTS a dict/list — so a derived ``text`` input would immediately
    fail its own sample on the flow-2 diff. Returning ``None`` lets the caller SKIP
    such fields instead of mistyping them (see ``derive_inputs_from_sample`` /
    ``skipped_sample_fields``)."""

    if isinstance(value, bool):
        return WORKFLOW_INPUT_TYPE_BOOLEAN
    if isinstance(value, (int, float)):
        return WORKFLOW_INPUT_TYPE_NUMBER
    if isinstance(value, str):
        return WORKFLOW_INPUT_TYPE_TEXT
    return None


def _non_scalar_skip_reason(value: object) -> str:
    """Why a non-scalar sample field can't become a v2 input.

    Worded against how a sample field actually reaches a run: the poller's
    ``overlay_item_inputs`` only overlays DECLARED inputs onto a run, by name — so
    a field that isn't a declared input is not forwarded to the run at all. These
    reasons say what happened (skipped) and why (non-scalar), not that the value is
    magically still available."""

    if isinstance(value, list):
        return (
            "Array fields can't become a workflow input "
            "(inputs are text, number, boolean, or choice)."
        )
    if isinstance(value, dict):
        return (
            "Object fields can't become a workflow input "
            "(inputs are text, number, boolean, or choice)."
        )
    # ``None`` (JSON null): the type can't be inferred from a null sample.
    return (
        "This field was null in the sample, so its input type can't be inferred; "
        "add it by hand if the feed sends a value."
    )


def derive_inputs_from_sample(sample_data: object) -> list[dict[str, object]]:
    """A v2 ``inputs`` block skeleton derived from a poll sample item's ``data``.

    Flow 1 (workflow-from-poll, mental-model §5): after ``GET <endpoint>/init``
    returns a sample item, its ``data`` fields seed a brand-new workflow's declared
    inputs — one input per SCALAR field, typed by the field's JSON type, named after
    the field (sanitized to a legal identifier). The result is a list of canonical
    input dicts (``{name, type, required}``) that passes the real definition
    validator, so the client can drop it straight into a new definition's
    ``inputs``. Non-dict/empty samples derive nothing.

    Non-scalar fields (arrays, objects, ``null``) are SKIPPED, not mistyped — see
    ``skipped_sample_fields`` for the companion list the UI shows. Each derived
    input is ``required`` (the field is present in the sample feed, so the workflow
    expects it per-item); the author can relax it in the editor. Field names that
    can't be sanitized into an identifier, and duplicates that collapse to the same
    identifier, are skipped. Capped at ``WORKFLOW_MAX_ARGS``.
    """

    if not isinstance(sample_data, dict):
        return []
    inputs: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_name, value in sample_data.items():
        if len(inputs) >= WORKFLOW_MAX_ARGS:
            break
        input_type = _scalar_input_type(value)
        if input_type is None:
            continue  # non-scalar — surfaced via skipped_sample_fields, not typed
        name = _sanitize_input_name(str(raw_name))
        if name is None or name in seen:
            continue
        seen.add(name)
        inputs.append({"name": name, "type": input_type, "required": True})
    return inputs


def skipped_sample_fields(sample_data: object) -> list[dict[str, str]]:
    """The sample fields ``derive_inputs_from_sample`` could NOT turn into an input,
    each as ``{"name", "reason"}`` (mental-model §5 flow 1).

    A closed v2 input union (text/number/boolean/choice) can't represent an array,
    object, or ``null`` sample value, so those fields are skipped rather than
    mistyped. The UI renders this as a quiet informational list so the author knows
    which sample fields didn't become inputs. Kept in sample order and capped only
    by the sample itself."""

    if not isinstance(sample_data, dict):
        return []
    skipped: list[dict[str, str]] = []
    for raw_name, value in sample_data.items():
        if _scalar_input_type(value) is None:
            skipped.append({"name": str(raw_name), "reason": _non_scalar_skip_reason(value)})
    return skipped


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
