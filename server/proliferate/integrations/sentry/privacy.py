"""Closed-catalog Sentry transport privacy policy.

This module owns every closed catalog shared by public ingress and outbound
projection, the catalog-specific validators, and the two projector callbacks.
The generic scrubbers and scalar validators it builds on live in
:mod:`.scalars`. It imports no product or server layer.
"""

from __future__ import annotations

import re
from typing import Any

from .scalars import (
    REDACTED,
    _bool,
    _catalog,
    _catalog_of,
    _clean_str,
    _exact,
    _int_in,
    _pattern,
    _set,
    app_logger_name,
    app_qualname,
    app_relative_file,
    canonical_uuid,
    exception_qualname,
    hex16,
    hex32,
    python_qualname,
    release_value,
    timestamp,
    uuid4_hex,
    uuid4_value,
)

MAX_SEQUENCE = 100
MAX_SPANS = 1000

# Closed set (ruled 2026-08-26); trusted-beta stays only until in-field 0.4.x builds rotate.
ENVIRONMENTS = _set("local staging production dogfood trusted-beta")
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


_ROUTE_SEGMENT = re.compile(r"\A(?:[a-z0-9][a-z0-9._-]{0,30}|\{[a-z_][a-z0-9_]{0,30}\})\Z")


def http_route_template(value: Any) -> str | None:
    """Admit a bounded route template (``/orgs/{org_id}``), never a raw-id path.

    Literal segments are short lowercase tokens, parameters keep their
    ``{name}`` placeholder form; a canonical UUID (36 bytes) or any other
    id-shaped segment exceeds the per-segment bound and drops the tag.
    """
    cleaned = _clean_str(value, 200)
    if cleaned is None or not cleaned.startswith("/"):
        return None
    segments = [segment for segment in cleaned.split("/") if segment]
    if len(segments) > 16:
        return None
    if any(not _ROUTE_SEGMENT.match(segment) for segment in segments):
        return None
    return cleaned


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
    "http_route": http_route_template,
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
        "llm_topup zero_grant_check orphan_reclaim",
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
