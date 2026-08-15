import json
import math
import re
from typing import Never, cast

from proliferate.lib.product.observability.catalog import is_p0_operation
from proliferate.lib.product.observability.contract import (
    ArgumentValueV1,
    RecordsFilterV1,
    RejectionReasonV1,
    SchemaVersionV1,
    TypedArgumentV1,
)
from proliferate.lib.product.observability.limits import (
    CURRENT_SCHEMA_VERSION,
    MAX_ARGUMENT_DEPTH,
    MAX_ARGUMENT_LIST_ITEMS,
    MAX_ARGUMENT_OBJECT_FIELDS,
    MAX_FILTER_VALUES,
    MAX_ID_BYTES,
    MAX_MESSAGE_BYTES,
    MAX_NAME_BYTES,
    MAX_SAFE_INTEGER,
    MAX_STRING_BYTES,
    MIN_SUPPORTED_PRODUCER_MINOR,
)
from proliferate.lib.product.observability.validation_error import (
    DiagnosticsContractErrorV1,
)

COMPONENTS = frozenset(
    {
        "desktop_renderer",
        "desktop_tauri",
        "diagnostics_collector",
        "anyharness",
        "desktop_worker",
        "server",
    }
)
SOURCES = frozenset({"renderer", "tauri", "collector", "anyharness", "worker", "server"})
SEVERITIES = frozenset({"trace", "debug", "info", "warn", "error"})
RECORD_CLASSES = frozenset({"detailed", "lifecycle"})
PRIVACY = frozenset({"operational", "customer_content", "sensitive", "secret"})
REDACTION = frozenset({"none", "structural", "support_export"})
DETAILED_KINDS = frozenset(
    {
        "log",
        "span_event",
        "message",
        "stdio",
        "token_delta",
        "item_delta",
        "heartbeat",
        "progress",
        "transport",
        "milestone",
        "loss_summary",
    }
)
TERMINAL_OUTCOMES = frozenset(
    {"succeeded", "failed", "cancelled", "timed_out", "abandoned", "rejected", "skipped"}
)
METADATA_PHASES = frozenset({"prepare", "invoke", "stream", "complete"})
REJECTION_REASONS = frozenset(
    {
        "invalid_shape",
        "record_too_large",
        "batch_too_large",
        "unsupported_major",
        "unsupported_minor",
        "prohibited_secret",
        "prohibited_metadata",
        "limit_exceeded",
        "conflicting_terminal",
    }
)
SECRET_FIELD_NAMES = frozenset(
    {
        "authorization",
        "authorization_header",
        "cookie",
        "cookies",
        "access_token",
        "refresh_token",
        "raw_token",
        "private_key",
        "secret",
        "environment_values",
        "keychain",
    }
)
PROHIBITED_MODEL_PLUGIN_FIELDS = frozenset(
    {
        "prompt",
        "response",
        "content",
        "tool_arguments",
        "tool_results",
        "arguments",
        "results",
        "raw_payload",
        "provider_response",
        "command",
        "path",
    }
)
TIMESTAMP_PATTERN = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
)
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]*$")
LOOPBACK_PATTERN = re.compile(r"^http://127\.0\.0\.1:([1-9][0-9]{0,4})$")


def _parse_schema_version(value: object) -> SchemaVersionV1:
    raw = _require_dict(value)
    major = _require_nonnegative_int(raw.get("major"))
    minor = _require_nonnegative_int(raw.get("minor"))
    if major != CURRENT_SCHEMA_VERSION["major"]:
        _fail("unsupported_major")
    if minor < MIN_SUPPORTED_PRODUCER_MINOR or minor > CURRENT_SCHEMA_VERSION["minor"]:
        _fail("unsupported_minor")
    return {"major": major, "minor": minor}


def _parse_typed_argument(value: object) -> TypedArgumentV1:
    raw = _require_dict(value)
    privacy = _require_enum(raw.get("privacy"), PRIVACY)
    if privacy == "secret":
        _fail("prohibited_secret")
    return cast(
        TypedArgumentV1,
        {
            "name": _require_name(raw.get("name")),
            "privacy": privacy,
            "value": _parse_argument_value(raw.get("value"), 1),
        },
    )


def _parse_argument_value(value: object, depth: int) -> ArgumentValueV1:
    if depth > MAX_ARGUMENT_DEPTH:
        _fail("limit_exceeded")
    raw = _require_dict(value)
    kind = _require_string(raw.get("type"))
    if kind == "string":
        return cast(
            ArgumentValueV1,
            {"type": kind, "value": _require_bounded_string(raw.get("value"), MAX_STRING_BYTES)},
        )
    if kind == "integer":
        return cast(ArgumentValueV1, {"type": kind, "value": _require_int(raw.get("value"))})
    if kind == "float":
        return cast(
            ArgumentValueV1, {"type": kind, "value": _require_finite_number(raw.get("value"))}
        )
    if kind == "boolean":
        return cast(ArgumentValueV1, {"type": kind, "value": _require_bool(raw.get("value"))})
    if kind == "enum":
        return cast(ArgumentValueV1, {"type": kind, "value": _require_name(raw.get("value"))})
    if kind == "list":
        list_values = _require_list(raw.get("value"))
        if len(list_values) > MAX_ARGUMENT_LIST_ITEMS:
            _fail("limit_exceeded")
        return cast(
            ArgumentValueV1,
            {
                "type": kind,
                "value": [_parse_argument_value(item, depth + 1) for item in list_values],
            },
        )
    if kind == "object":
        object_values = _require_dict(raw.get("value"))
        if len(object_values) > MAX_ARGUMENT_OBJECT_FIELDS:
            _fail("limit_exceeded")
        parsed: dict[str, ArgumentValueV1] = {}
        for key, item in object_values.items():
            _require_name(key)
            parsed[key] = _parse_argument_value(item, depth + 1)
        return cast(ArgumentValueV1, {"type": kind, "value": parsed})
    _fail("invalid_shape")


def _parse_detailed(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    kind = _require_enum(raw.get("kind"), DETAILED_KINDS)
    stream = (
        None
        if raw.get("stream") is None
        else _require_enum(raw.get("stream"), frozenset({"stdout", "stderr"}))
    )
    if (kind == "stdio") != (stream is not None):
        _fail("invalid_shape")
    result: dict[str, object] = {"kind": kind}
    _set_optional(
        result,
        "message",
        None
        if raw.get("message") is None
        else _require_bounded_string(raw.get("message"), MAX_MESSAGE_BYTES),
    )
    _set_optional(result, "stream", stream)
    _set_optional(result, "dropped_count", _optional_nonnegative_int(raw.get("dropped_count")))
    _set_optional(result, "milestone", _optional_name(raw.get("milestone")))
    return result


def _parse_lifecycle(value: object, operation_name: str) -> dict[str, object]:
    raw = _require_dict(value)
    if not is_p0_operation(operation_name):
        _fail("invalid_shape")
    phase = _require_enum(raw.get("phase"), frozenset({"started", "terminal"}))
    outcome = (
        None
        if raw.get("outcome") is None
        else _require_enum(raw.get("outcome"), TERMINAL_OUTCOMES)
    )
    if phase == "started" and outcome is not None or phase == "terminal" and outcome is None:
        _fail("invalid_shape")
    finalizer = _require_enum(raw.get("finalizer"), frozenset({"producer", "collector"}))
    if finalizer == "collector" and outcome != "abandoned":
        _fail("invalid_shape")
    model = None if raw.get("model") is None else _parse_model_metadata(raw["model"])
    plugin = None if raw.get("plugin") is None else _parse_plugin_metadata(raw["plugin"])
    if model is not None and operation_name not in {
        "anyharness.model.request",
        "server.model_gateway.request",
    }:
        _fail("prohibited_metadata")
    if plugin is not None and operation_name != "anyharness.plugin.invoke":
        _fail("prohibited_metadata")
    result: dict[str, object] = {"phase": phase, "finalizer": finalizer}
    _set_optional(result, "outcome", outcome)
    _set_optional(result, "model", model)
    _set_optional(result, "plugin", plugin)
    return result


def _parse_model_metadata(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    result: dict[str, object] = {"model_id": _require_id(raw.get("model_id"))}
    _set_optional(result, "provider_kind", _optional_name(raw.get("provider_kind")))
    _set_optional(
        result,
        "phase",
        None if raw.get("phase") is None else _require_enum(raw.get("phase"), METADATA_PHASES),
    )
    for key in ("input_tokens", "output_tokens", "duration_ms"):
        _set_optional(result, key, _optional_nonnegative_int(raw.get(key)))
    return result


def _parse_plugin_metadata(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    result: dict[str, object] = {"plugin_id": _require_id(raw.get("plugin_id"))}
    _set_optional(result, "kind", _optional_name(raw.get("kind")))
    _set_optional(
        result,
        "phase",
        None if raw.get("phase") is None else _require_enum(raw.get("phase"), METADATA_PHASES),
    )
    _set_optional(result, "duration_ms", _optional_nonnegative_int(raw.get("duration_ms")))
    return result


def _parse_filters(value: object) -> RecordsFilterV1:
    raw = _require_dict(value)
    components = _require_list(raw.get("components"))
    record_classes = _require_list(raw.get("record_classes"))
    severities = _require_list(raw.get("severities"))
    names = _require_list(raw.get("names"))
    outcomes = _require_list(raw.get("outcomes"))
    if any(
        len(values) > MAX_FILTER_VALUES
        for values in (components, record_classes, severities, names, outcomes)
    ):
        _fail("limit_exceeded")
    result: dict[str, object] = {
        "components": [_require_enum(item, COMPONENTS) for item in components],
        "record_classes": [_require_enum(item, RECORD_CLASSES) for item in record_classes],
        "severities": [_require_enum(item, SEVERITIES) for item in severities],
        "names": [_require_name(item) for item in names],
        "outcomes": [_require_enum(item, TERMINAL_OUTCOMES) for item in outcomes],
    }
    _set_optional(
        result,
        "source_time_from",
        None
        if raw.get("source_time_from") is None
        else _require_timestamp(raw.get("source_time_from")),
    )
    _set_optional(
        result,
        "source_time_to",
        None
        if raw.get("source_time_to") is None
        else _require_timestamp(raw.get("source_time_to")),
    )
    for key in (
        "operation_id",
        "parent_operation_id",
        "trace_id",
        "workspace_id",
        "session_id",
        "turn_id",
        "item_id",
        "request_id",
        "target_id",
        "prompt_id",
        "workflow_id",
    ):
        _set_optional(result, key, _optional_id(raw.get(key)))
    _set_optional(result, "error_classification", _optional_name(raw.get("error_classification")))
    return cast(RecordsFilterV1, result)


def _parse_gap(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    result: dict[str, object] = {
        "reason": _require_enum(
            raw.get("reason"),
            frozenset({"evicted", "producer_sequence", "tail_lag", "collector_restart"}),
        ),
        "dropped_records": _require_nonnegative_int(raw.get("dropped_records")),
    }
    for key in (
        "from_cursor",
        "to_cursor",
        "missing_sequence_from",
        "missing_sequence_to",
    ):
        _set_optional(result, key, _optional_nonnegative_int(raw.get(key)))
    _set_optional(
        result,
        "component",
        None if raw.get("component") is None else _require_enum(raw.get("component"), COMPONENTS),
    )
    _set_optional(result, "producer_boot_id", _optional_id(raw.get("producer_boot_id")))
    return result


def _parse_version_count(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    return {
        "version": _parse_schema_version(raw.get("version")),
        "records": _require_nonnegative_int(raw.get("records")),
    }


def _parse_ingest_rejection(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    return {
        "index": _require_nonnegative_int(raw.get("index")),
        "reason": _require_enum(raw.get("reason"), REJECTION_REASONS),
    }


def _parse_producer_health(value: object) -> dict[str, object]:
    raw = _require_dict(value)
    result: dict[str, object] = {
        "component": _require_enum(raw.get("component"), COMPONENTS),
        "producer_boot_id": _require_id(raw.get("producer_boot_id")),
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "gap_count": _require_nonnegative_int(raw.get("gap_count")),
        "liveness": _require_enum(
            raw.get("liveness"), frozenset({"attached", "alive", "dead", "incompatible"})
        ),
    }
    _set_optional(result, "last_sequence", _optional_nonnegative_int(raw.get("last_sequence")))
    return result


def _parse_exporter_health(raw: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {
        "state": _require_enum(raw.get("state"), frozenset({"disabled", "ready", "degraded"})),
        "dropped_records": _require_nonnegative_int(raw.get("dropped_records")),
    }
    _set_optional(
        result, "last_error_classification", _optional_name(raw.get("last_error_classification"))
    )
    return result


def _parse_fallback_health(raw: dict[str, object]) -> dict[str, object]:
    return {
        "state": _require_enum(raw.get("state"), frozenset({"inactive", "active", "degraded"})),
        "bytes": _require_nonnegative_int(raw.get("bytes")),
        "dropped_records": _require_nonnegative_int(raw.get("dropped_records")),
    }


def _reject_secret_fields(value: object) -> None:
    if isinstance(value, list):
        for item in cast(list[object], value):
            _reject_secret_fields(item)
    elif isinstance(value, dict):
        for key, item in cast(dict[object, object], value).items():
            if isinstance(key, str) and key in SECRET_FIELD_NAMES:
                _fail("prohibited_secret")
            _reject_secret_fields(item)


def _reject_prohibited_model_plugin_metadata(record: dict[str, object]) -> None:
    lifecycle_value = record.get("lifecycle")
    if not isinstance(lifecycle_value, dict):
        return
    lifecycle = cast(dict[str, object], lifecycle_value)
    for key in ("model", "plugin"):
        metadata_value = lifecycle.get(key)
        if isinstance(metadata_value, dict) and any(
            field in PROHIBITED_MODEL_PLUGIN_FIELDS
            for field in cast(dict[object, object], metadata_value)
            if isinstance(field, str)
        ):
            _fail("prohibited_metadata")


def _require_dict(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        _fail("invalid_shape")
    return cast(dict[str, object], value)


def _require_list(value: object) -> list[object]:
    if not isinstance(value, list):
        _fail("invalid_shape")
    return cast(list[object], value)


def _require_string(value: object) -> str:
    if not isinstance(value, str):
        _fail("invalid_shape")
    return value


def _require_bounded_string(value: object, limit: int) -> str:
    result = _require_string(value)
    if not result:
        _fail("invalid_shape")
    if _utf8_byte_length(result) > limit:
        _fail("limit_exceeded")
    return result


def _require_name(value: object) -> str:
    result = _require_bounded_string(value, MAX_NAME_BYTES)
    if NAME_PATTERN.fullmatch(result) is None:
        _fail("invalid_shape")
    return result


def _optional_name(value: object) -> str | None:
    return None if value is None else _require_name(value)


def _require_id(value: object) -> str:
    return _require_bounded_string(value, MAX_ID_BYTES)


def _optional_id(value: object) -> str | None:
    return None if value is None else _require_id(value)


def _require_short_string(value: object) -> str:
    return _require_bounded_string(value, MAX_NAME_BYTES)


def _require_timestamp(value: object) -> str:
    result = _require_string(value)
    if len(result) < 20 or len(result) > 35 or TIMESTAMP_PATTERN.fullmatch(result) is None:
        _fail("invalid_shape")
    return result


def _require_bool(value: object) -> bool:
    if not isinstance(value, bool):
        _fail("invalid_shape")
    return value


def _require_finite_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        _fail("invalid_shape")
    return float(value)


def _require_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail("invalid_shape")
    if abs(value) > MAX_SAFE_INTEGER:
        _fail("limit_exceeded")
    return value


def _require_nonnegative_int(value: object) -> int:
    result = _require_int(value)
    if result < 0:
        _fail("invalid_shape")
    return result


def _require_positive_int(value: object) -> int:
    result = _require_nonnegative_int(value)
    if result == 0:
        _fail("invalid_shape")
    return result


def _optional_nonnegative_int(value: object) -> int | None:
    return None if value is None else _require_nonnegative_int(value)


def _require_enum[TString: str](value: object, values: frozenset[TString]) -> TString:
    result = _require_string(value)
    if result not in values:
        _fail("invalid_shape")
    return result


def _set_optional(target: dict[str, object], key: str, value: object | None) -> None:
    if value is not None:
        target[key] = value


def _json_byte_length(value: object) -> int:
    return _utf8_byte_length(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    )


def _utf8_byte_length(value: str) -> int:
    try:
        return len(value.encode("utf-8"))
    except UnicodeEncodeError:
        _fail("invalid_shape")


def _fail(reason: RejectionReasonV1) -> Never:
    raise DiagnosticsContractErrorV1(reason)
