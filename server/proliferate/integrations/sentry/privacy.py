"""Closed-catalog Sentry transport privacy policy.

This module owns the generic defense-in-depth scrubbers, every closed validator
and catalog shared by public ingress and outbound projection, and the two
projector callbacks. It imports no product or server layer.
"""

from __future__ import annotations

import datetime as _datetime
import re
import uuid
from typing import Any

SENSITIVE_KEY_PATTERN = re.compile(
    r"(authorization|cookie|token|secret|password|api[_-]?key|credential|"
    r"prompt|content|stdout|stderr|request_body|body|env|file_path|path)",
    re.IGNORECASE,
)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?:/Users/[^\s]+|/home/[^\s]+|[A-Za-z]:\\[^\s]+)")
BEARER_TOKEN_PATTERN = re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b")


def _set(text: str) -> frozenset[str]:
    """Split a space-separated closed catalog into its exact values."""
    return frozenset(text.split())


REDACTED = "[redacted]"
MAX_SEQUENCE = 100
MAX_SPANS = 1000


def _scrub_string_patterns(value: str) -> str:
    tokens = BEARER_TOKEN_PATTERN.sub("[redacted-token]", value)
    return tokens.replace("\r\n", "\n").replace("\r", "\n")


def scrub_text(value: str) -> str:
    paths = ABSOLUTE_PATH_PATTERN.sub("[redacted-path]", _scrub_string_patterns(value))
    return JWT_PATTERN.sub("[redacted-jwt]", paths)


def scrub_value(value: Any, key: str | None = None) -> Any:
    if value is None:
        return None
    if key and SENSITIVE_KEY_PATTERN.search(key):
        return REDACTED
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, list):
        return [scrub_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(scrub_value(item) for item in value)
    if isinstance(value, dict):
        return {inner: scrub_value(item, inner) for inner, item in value.items()}
    return value


def scrub_mapping(value: dict[str, Any] | None) -> dict[str, Any] | None:
    return None if value is None else scrub_value(value)


# --- closed scalar validators -------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_PY_NAME = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]*\Z")
_ANGLE_NAMES = _set("<module> <locals> <lambda> <genexpr> <listcomp> <dictcomp> <setcomp>")
_FILE_SEGMENT = re.compile(r"\A[A-Za-z0-9_.-]+\Z")
_RFC3339 = re.compile(r"\A\d{4}-\d\d-\d\d[Tt ]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)\Z")


def _clean_str(value: Any, limit: int) -> str | None:
    """Return ``value`` only when it is an exact, control-free, scrub-stable ``str``."""
    if type(value) is not str:
        return None
    if _CONTROL.search(value) or scrub_text(value) != value:
        return None
    return value if len(value.encode("utf-8")) <= limit else None


def _exact(value: Any, allowed: frozenset[str], limit: int = 128) -> str | None:
    cleaned = _clean_str(value, limit)
    return cleaned if cleaned is not None and cleaned in allowed else None


def _pattern(regex: str, limit: int) -> Any:
    """Build a validator admitting only a clean string fully matching ``regex``."""
    compiled = re.compile(regex)

    def _check(value: Any) -> str | None:
        cleaned = _clean_str(value, limit)
        return cleaned if cleaned is not None and compiled.match(cleaned) else None

    return _check


hex32 = _pattern(r"\A[0-9a-fA-F]{32}\Z", 32)
hex16 = _pattern(r"\A[0-9a-fA-F]{16}\Z", 16)
_RELEASE = r"\Aproliferate-server@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9a-f]{12})?\Z"
release_value = _pattern(_RELEASE, 128)
_uuid_shape = _pattern(r"\A[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z", 36)
_uuid4_hex_shape = _pattern(r"\A[0-9a-f]{32}\Z", 32)


def _parsed_uuid(cleaned: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(cleaned)
    except ValueError:
        return None


def canonical_uuid(value: Any) -> str | None:
    cleaned = _uuid_shape(value)
    if cleaned is None:
        return None
    parsed = _parsed_uuid(cleaned)
    return cleaned if parsed is not None and str(parsed) == cleaned.lower() else None


def uuid4_value(value: Any) -> str | None:
    cleaned = canonical_uuid(value)
    if cleaned is None:
        return None
    parsed = _parsed_uuid(cleaned)
    return cleaned if parsed is not None and parsed.version == 4 else None


def uuid4_hex(value: Any) -> str | None:
    cleaned = _uuid4_hex_shape(value)
    if cleaned is None:
        return None
    parsed = _parsed_uuid(cleaned)
    return cleaned if parsed is not None and parsed.version == 4 else None


def _qualname_ok(cleaned: str) -> bool:
    if any(ch in cleaned for ch in ("/", "\\", ":")) or re.search(r"\s", cleaned):
        return False
    return all(seg in _ANGLE_NAMES or bool(_PY_NAME.match(seg)) for seg in cleaned.split("."))


def python_qualname(value: Any) -> str | None:
    cleaned = _clean_str(value, 256)
    return cleaned if cleaned is not None and _qualname_ok(cleaned) else None


def exception_qualname(value: Any) -> str | None:
    cleaned = python_qualname(value)
    if cleaned is None:
        return None
    return cleaned if _PY_NAME.match(cleaned.rsplit(".", 1)[-1]) else None


def app_qualname(value: Any) -> str | None:
    cleaned = python_qualname(value)
    return cleaned if cleaned is not None and cleaned.startswith("proliferate.") else None


def app_logger_name(value: Any) -> str | None:
    return value if _clean_str(value, 11) == "proliferate" else app_qualname(value)


def app_relative_file(value: Any) -> str | None:
    cleaned = _clean_str(value, 512)
    if cleaned is None:
        return None
    if not cleaned.startswith(("proliferate/", "server/proliferate/")):
        return None
    segments = cleaned.split("/")
    if any(seg in ("", ".", "..") or not _FILE_SEGMENT.match(seg) for seg in segments):
        return None
    return cleaned


def timestamp(value: Any) -> Any | None:
    """Admit an epoch number, an RFC 3339 string, or a timezone-aware ``datetime``."""
    if type(value) is bool:
        return None
    if type(value) in (int, float):
        return value if 0 <= value <= 253402300799 else None
    if type(value) is str:
        cleaned = _clean_str(value, 40)
        return cleaned if cleaned is not None and _RFC3339.match(cleaned) else None
    if type(value) is _datetime.datetime and value.utcoffset() is not None:
        try:
            epoch = value.timestamp()
        except (OverflowError, OSError, ValueError):  # pragma: no cover - fail closed
            return None
        return value if 0 <= epoch <= 253402300799 else None
    return None


def _bool(value: Any) -> bool | None:
    return value if type(value) is bool else None


def _int_in(value: Any, low: int, high: int) -> int | None:
    if type(value) is not int or type(value) is bool:
        return None
    return value if low <= value <= high else None


def _catalog(allowed: str, limit: int) -> Any:
    """Build a validator admitting only the exact space-separated catalog values."""
    values = frozenset(allowed.split())
    return lambda value: _exact(value, values, limit)


def _catalog_of(allowed: frozenset[str], limit: int) -> Any:
    return lambda value: _exact(value, allowed, limit)


ENVIRONMENTS = _set("trusted-beta staging production Production")
EVENT_LEVELS = _set("debug info warning error critical fatal")
HTTP_METHODS = _set("GET HEAD POST PUT PATCH DELETE OPTIONS TRACE CONNECT")
MECHANISM_TYPES = _set("generic chained starlette threading excepthook celery")
BREADCRUMB_TYPES = _set("default debug error http info navigation query transaction ui user log")
SPAN_OPS = _set("http.server websocket.server queue.task.celery queue.process queue.publish")
SPAN_STATUSES = _set(
    "ok cancelled unknown_error invalid_argument deadline_exceeded not_found already_exists "
    "permission_denied resource_exhausted failed_precondition aborted out_of_range "
    "unimplemented internal_error unavailable data_loss unauthenticated"
)
DROP_REASONS = _set(
    "invoice_id_not_string invoice_no_cloud_subscription_line invoice_subject_unresolved "
    "invoice_period_grant_gate_closed invoice_not_period_boundary unhandled_event_type "
    "checkout_session_unhandled_mode_or_purpose checkout_session_id_not_string "
    "checkout_session_subject_unresolved checkout_session_refill_price_missing "
    "subscription_fields_not_strings subscription_subject_unresolved "
    "payment_failed_subject_unresolved payment_hold_subject_unresolved"
)
environment_value = _catalog_of(ENVIRONMENTS, 12)
_LABEL_PREFIXES = _set(
    "materialize_sandbox materialize_repo_environment "
    "materialize_secret_set materialize_agent_auth"
)


def _prefixed_uuid(value: Any, prefixes: frozenset[str], limit: int) -> str | None:
    """Admit exactly ``<listed prefix>:<canonical uuid>`` within the byte bound."""
    cleaned = _clean_str(value, limit)
    if cleaned is None or ":" not in cleaned:
        return None
    prefix, _, tail = cleaned.partition(":")
    if prefix not in prefixes:
        return None
    return cleaned if canonical_uuid(tail) else None


def _tenant_id(value: Any) -> str | None:
    return _prefixed_uuid(value, _set("user org"), 41)


def _label(value: Any) -> str | None:
    return _prefixed_uuid(value, _LABEL_PREFIXES, 65)


_UUID_TAGS = _set(
    "user_id organization_id cloud_workspace_id cloud_target_id "
    "sandbox_profile_id cloud_sandbox_id enrollment_key_id "
    "session_id interaction_id command_id anyharness_workspace_id"
)
TAG_VALIDATORS: dict[str, Any] = {
    **{key: canonical_uuid for key in _UUID_TAGS},
    "surface": _catalog("cloud_api", 9),
    "telemetry_mode": _catalog("hosted_product", 14),
    "request_id": uuid4_value,
    "http_method": _catalog_of(HTTP_METHODS, 7),
    "support_report_id": uuid4_hex,
    "tenant_id": _tenant_id,
    "critical_failure": _catalog("true", 4),
    "domain": _catalog(
        "anonymous_telemetry billing agent_gateway cloud_materialization "
        "cloud_materialization_failure_persistence",
        41,
    ),
    "action": _catalog(
        "heartbeat_start heartbeat_loop authorization_read reconcile_loop "
        "stripe_webhook_drop verification enrollment_backfill usage_import "
        "llm_topup zero_grant_check",
        19,
    ),
    "harness_kind": _catalog("claude codex opencode grok", 8),
    "label": _label,
    "fn": _catalog(
        "_repair_materialize_sandbox materialize_sandbox materialize_repo_environment "
        "materialize_secret_set materialize_agent_auth",
        28,
    ),
}

_UUID_EXTRAS = _set("billing_subject_id owner_user_id subject_id")
_BOOL_EXTRAS = _set(
    "subject_resolved pro_pricing_enabled has_subscription_record "
    "has_period_start reason_recognized paid has_subscription_id "
    "has_customer_id has_status"
)

EXTRA_VALIDATORS: dict[str, Any] = {
    **{key: canonical_uuid for key in _UUID_EXTRAS},
    **{key: _bool for key in _BOOL_EXTRAS},
    "stripe_event_id": _pattern(r"\Aevt_[A-Za-z0-9]{1,123}\Z", 128),
    "stripe_object_id": _pattern(
        r"\A(?:(?:in_|sub_)[A-Za-z0-9]{1,123}|cs_(?:test_|live_)?[A-Za-z0-9]{1,119})\Z", 128
    ),
    "stripe_subscription_id": _pattern(r"\Asub_[A-Za-z0-9]{1,123}\Z", 128),
    "drop_reason": _catalog_of(DROP_REASONS, 64),
    "session_mode": _catalog("payment subscription", 12),
    "monthly_price_class": _catalog("pro legacy_cloud unknown", 12),
    "invoice_reason": _catalog(
        "subscription_update subscription_threshold manual upcoming "
        "quote_accept automatic_pending_invoice_item_invoice",
        44,
    ),
    "subscription_status": _catalog("active trialing past_due unpaid canceled", 9),
    "session_purpose": lambda _value: None,
    "event_type": lambda _value: None,
    "line_item_count": lambda value: _int_in(value, 0, 10000),
    "zero_grant_organization_ids": lambda value: _project_sequence(value, 50, canonical_uuid),
}
_NULLABLE_EXTRAS = frozenset(EXTRA_VALIDATORS) - {"drop_reason", "line_item_count"}


def project_extra_value(key: str, value: Any) -> Any:
    """Return the projected value for a listed extra key, or ``[redacted]``."""
    if value is None and key in _NULLABLE_EXTRAS:
        return None
    projected = EXTRA_VALIDATORS[key](value)
    return REDACTED if projected is None else projected


# --- structural projection ----------------------------------------------------


def _is_map(value: Any) -> bool:
    return type(value) is dict


def _project_map(source: Any, table: dict[str, Any]) -> dict[str, Any]:
    """Build a new mapping from only the listed keys whose validator admits them."""
    if not _is_map(source):
        return {}
    checked = ((key, table[key](source[key])) for key in table if key in source)
    return {key: value for key, value in checked if value is not None}


def _project_catalog_map(source: Any, validators: dict[str, Any]) -> dict[str, Any]:
    """Project every entry whose exact key is in the closed catalog table."""
    if not _is_map(source):
        return {}
    listed = (key for key in source if type(key) is str and key in validators)
    checked = ((key, validators[key](source[key])) for key in listed)
    return {key: value for key, value in checked if value is not None}


def _project_extras(source: Any) -> dict[str, Any]:
    if not _is_map(source):
        return {}
    return {
        key: project_extra_value(key, value)
        for key, value in source.items()
        if type(key) is str and key in EXTRA_VALIDATORS
    }


def _project_sequence(source: Any, limit: int, project: Any) -> list[Any] | None:
    if type(source) is not list or len(source) > limit:
        return None
    projected = [item for item in (project(entry) for entry in source) if item is not None]
    return projected or None


def _project_wrapper(source: Any, project: Any) -> dict[str, Any] | None:
    if not _is_map(source):
        return None
    entries = _project_sequence(source.get("values"), MAX_SEQUENCE, project)
    return {"values": entries} if entries else None


_FRAME_TABLE = {
    "filename": app_relative_file,
    "module": app_qualname,
    "function": python_qualname,
    "lineno": lambda value: _int_in(value, 1, 10000000),
    "in_app": _bool,
}
_MECHANISM_TABLE = {
    "handled": _bool,
    "is_exception_group": _bool,
    "exception_id": lambda value: _int_in(value, 0, 2**31 - 1),
    "parent_id": lambda value: _int_in(value, 0, 2**31 - 1),
}
_BREADCRUMB_TABLE = {
    "type": _catalog_of(BREADCRUMB_TYPES, 11),
    "level": _catalog_of(EVENT_LEVELS, 8),
    "timestamp": timestamp,
    "category": app_logger_name,
}
_TRACE_TABLE = {
    "parent_span_id": hex16,
    "op": _catalog_of(SPAN_OPS, 28),
    "status": _catalog_of(SPAN_STATUSES, 19),
}
_SPAN_TABLE = {
    **_TRACE_TABLE,
    "start_timestamp": timestamp,
    "timestamp": timestamp,
    "same_process_as_parent": _bool,
}
_TOP_LEVEL_TABLE = {
    "event_id": hex32,
    "release": release_value,
    "environment": environment_value,
    "timestamp": timestamp,
    "start_timestamp": timestamp,
    "platform": _catalog("python", 6),
    "level": _catalog_of(EVENT_LEVELS, 8),
}
_REQUEST_TABLE = {"method": _catalog_of(HTTP_METHODS, 7)}
_RESPONSE_TABLE = {"status_code": lambda value: _int_in(value, 100, 599)}


def _project_frame(entry: Any) -> dict[str, Any] | None:
    """Admit a frame only when a Server application filename or module anchors it."""
    projected = _project_map(entry, _FRAME_TABLE)
    if "filename" not in projected and "module" not in projected:
        return None
    return projected


def _project_stacktrace(source: Any) -> dict[str, Any] | None:
    if not _is_map(source):
        return None
    frames = _project_sequence(source.get("frames"), MAX_SEQUENCE, _project_frame)
    return {"frames": frames} if frames else None


def _project_mechanism(source: Any) -> dict[str, Any] | None:
    if not _is_map(source):
        return None
    kind = _exact(source.get("type"), MECHANISM_TYPES, 11)
    if kind is None:
        return None
    return {**_project_map(source, _MECHANISM_TABLE), "type": kind}


def _project_exception_entry(entry: Any) -> dict[str, Any] | None:
    if not _is_map(entry):
        return None
    projected = _project_map(entry, {"type": exception_qualname, "module": python_qualname})
    stack = _project_stacktrace(entry.get("stacktrace"))
    if stack:
        projected["stacktrace"] = stack
    mechanism = _project_mechanism(entry.get("mechanism"))
    if mechanism:
        projected["mechanism"] = mechanism
    return projected or None


def _project_thread_entry(entry: Any) -> dict[str, Any] | None:
    if not _is_map(entry):
        return None
    projected = _project_map(entry, {"crashed": _bool, "current": _bool})
    stack = _project_stacktrace(entry.get("stacktrace"))
    if stack:
        projected["stacktrace"] = stack
    return projected or None


def _project_breadcrumb(breadcrumb: Any, _hint: Any = None) -> dict[str, Any] | None:
    """Project one breadcrumb; registered as ``before_breadcrumb`` and reused inline."""
    try:
        return _project_map(breadcrumb, _BREADCRUMB_TABLE) or None
    except Exception:  # pragma: no cover - fail closed
        return None


def _project_identified(entry: Any, table: dict[str, Any]) -> dict[str, Any] | None:
    """Project a trace context or child span; both IDs must validate or it is dropped."""
    if not _is_map(entry):
        return None
    trace_id = hex32(entry.get("trace_id"))
    span_id = hex16(entry.get("span_id"))
    if trace_id is None or span_id is None:
        return None
    return {**_project_map(entry, table), "trace_id": trace_id, "span_id": span_id}


def _project_span(entry: Any) -> dict[str, Any] | None:
    return _project_identified(entry, _SPAN_TABLE)


def _project_contexts(source: Any) -> dict[str, Any]:
    if not _is_map(source):
        return {}
    projected: dict[str, Any] = {}
    trace = _project_identified(source.get("trace"), _TRACE_TABLE)
    if trace:
        projected["trace"] = trace
    response = _project_map(source.get("response"), _RESPONSE_TABLE)
    if response:
        projected["response"] = response
    return projected


def _project_transaction(event: dict[str, Any]) -> dict[str, Any]:
    """Retain only a validated application endpoint symbol or the exact generic pair."""
    name = event.get("transaction")
    info = event.get("transaction_info")
    source = info.get("source") if _is_map(info) else None
    component = app_qualname(name) is not None and source == "component"
    generic = name == "generic FastAPI request" and source == "route"
    if not (component or generic):
        return {}
    return {"transaction": name, "transaction_info": {"source": source}}


def _project_user(source: Any) -> dict[str, str] | None:
    if not _is_map(source):
        return None
    user_id = canonical_uuid(source.get("id"))
    return {"id": user_id} if user_id is not None else None


def _clear_attachments(hint: Any) -> bool:
    """Replace the SDK attachment hint with an exact empty list and prove the clear."""
    if type(hint) is not dict:
        return False
    try:
        hint["attachments"] = []
        readback = hint["attachments"]
    except Exception:  # pragma: no cover - hostile hint
        return False
    return type(readback) is list and len(readback) == 0


def _synthesize_fingerprint(tags: dict[str, str], extras: dict[str, Any]) -> list[str] | None:
    if tags.get("domain") != "billing" or tags.get("action") != "stripe_webhook_drop":
        return None
    reason = extras.get("drop_reason")
    if type(reason) is not str or reason not in DROP_REASONS:
        return None
    return ["billing", "stripe_webhook_drop", reason]


def _project_outbound_event(event: Any, hint: Any = None) -> dict[str, Any] | None:
    """Project one serialized SDK event; both event callbacks share this callable."""
    if not _clear_attachments(hint):
        return None
    try:
        return _project_event_body(event)
    except Exception:  # pragma: no cover - fail closed
        return None


def _project_event_body(event: Any) -> dict[str, Any] | None:
    if not _is_map(event):
        return None
    if "type" in event:
        if event["type"] != "transaction":
            return None
        is_transaction = True
    else:
        is_transaction = False

    projected = _project_map(event, _TOP_LEVEL_TABLE)
    projected.update(_project_transaction(event))
    tags = _project_catalog_map(event.get("tags"), TAG_VALIDATORS)
    extras = _project_extras(event.get("extra"))
    subtrees: dict[str, Any] = {
        "user": _project_user(event.get("user")),
        "request": _project_map(event.get("request"), _REQUEST_TABLE),
        "tags": tags,
        "extra": extras,
        "contexts": _project_contexts(event.get("contexts")),
        "stacktrace": _project_stacktrace(event.get("stacktrace")),
        "exception": _project_wrapper(event.get("exception"), _project_exception_entry),
        "threads": _project_wrapper(event.get("threads"), _project_thread_entry),
        "breadcrumbs": _project_wrapper(event.get("breadcrumbs"), _project_breadcrumb),
    }
    if is_transaction:
        projected["type"] = "transaction"
        subtrees["spans"] = _project_sequence(event.get("spans"), MAX_SPANS, _project_span)
    projected.update({key: value for key, value in subtrees.items() if value})

    if not is_transaction:
        fingerprint = _synthesize_fingerprint(tags, extras)
        if fingerprint is not None:
            projected["fingerprint"] = fingerprint
    return projected if _has_diagnostic_content(is_transaction, projected) else None


def _has_diagnostic_content(is_transaction: bool, projected: dict[str, Any]) -> bool:
    """Drop an event whose projection retained no diagnostic anchor at all."""
    if is_transaction:
        return "transaction" in projected or "contexts" in projected
    anchors = {"exception", "threads", "stacktrace", "contexts", "transaction"}
    return bool(projected.keys() & anchors)
