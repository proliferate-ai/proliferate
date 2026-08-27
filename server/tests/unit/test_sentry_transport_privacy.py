"""Closed serialized-callback privacy matrix for the Server Sentry adapter.

Every case here drives the two production projector callbacks over already
serialized SDK 2.66.1 shapes. Original-Python-type rejection is owned by the
public ingress and lives in ``test_sentry_integration.py``.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any

import pytest

from proliferate.integrations.sentry import privacy

# Tables below are hand-packed to fit the 600-line ceiling with no case dropped
# and no 13th path; every `ruff check` rule still applies to this file.
# fmt: off

project_event = privacy._project_outbound_event
project_breadcrumb = privacy._project_breadcrumb

SENTINELS = [
    "alice.private@example.invalid", "Private Customer Display Name",
    "PROMPT_SENTINEL_do_not_ship", "TRANSCRIPT_SENTINEL_do_not_ship",
    "TERMINAL_OUTPUT_SENTINEL_do_not_ship", "FILE_CONTENT_SENTINEL_do_not_ship",
    "/Users/private/acme-secret-repo/private.py", "REQUEST_BODY_SENTINEL_do_not_ship",
    "QUERY_SENTINEL_do_not_ship", "HEADER_SENTINEL_do_not_ship",
    "ENV_VALUE_SENTINEL_do_not_ship", "PROVIDER_RESPONSE_SENTINEL_do_not_ship",
    "please_ignore_previous_instructions",
]

TRACE_ID = "0123456789abcdef0123456789abcdef"
SPAN_ID = "0123456789abcdef"
CHILD_SPAN_ID = "fedcba9876543210"
RELEASE = "proliferate-server@1.2.3+0123456789ab"

def _hint() -> dict[str, Any]:
    return {"attachments": [object()]}

def _project(event: dict[str, Any], hint: dict[str, Any] | None = None) -> Any:
    return project_event(event, _hint() if hint is None else hint)

def _error(**overrides: Any) -> dict[str, Any]:
    event: dict[str, Any] = {
        "event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "level": "error",
        "platform": "python",
        "timestamp": 1755600000.0,
        "exception": {"values": [{"type": "ValueError", "module": "builtins"}]},
    }
    event.update(overrides)
    return event

def _flatten(value: Any, path: str = "") -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        return [pair for k, v in value.items() for pair in _flatten(v, f"{path}.{k}")]
    if isinstance(value, list):
        return [pair for item in value for pair in _flatten(item, f"{path}[]")]
    return [(path, value)]

# --- attachment hint ----------------------------------------------------------

class _PlainSubclass(dict):  # type: ignore[type-arg]
    pass

class _Sticky(dict):  # type: ignore[type-arg]
    def __setitem__(self, key: Any, value: Any) -> None:
        super().__setitem__(key, ["still-here"])

class _Frozen(dict):  # type: ignore[type-arg]
    def __setitem__(self, key: Any, value: Any) -> None:
        raise RuntimeError("no")

@pytest.mark.parametrize("hint", [{}, {"attachments": []}, _hint()])
def test_attachments_are_cleared_and_verified_in_the_same_hint(hint: dict[str, Any]) -> None:
    assert project_event(_error(), hint) is not None
    assert hint["attachments"] == []
    assert type(hint["attachments"]) is list

@pytest.mark.parametrize(
    "hint",
    [None, [], "attachments", object(), _PlainSubclass(attachments=[]), _Sticky(), _Frozen()])
def test_non_exact_dict_or_unprovable_hint_fails_closed(hint: Any) -> None:
    assert project_event(_error(), hint) is None

def test_positive_identity_and_exception_shape_survives_byte_for_byte() -> None:
    entry = {
        "type": "Outer.InnerError", "module": "proliferate.server.billing.errors",
        "value": SENTINELS[11], "notes": [SENTINELS[5]],
        "mechanism": {"type": "starlette", "handled": False, "synthetic": True},
        "stacktrace": {
            "frames": [
                {"filename": "/usr/lib/python3.12/asyncio/events.py",
                 "module": "asyncio.events", "function": "run"},
                {"filename": "proliferate/server/billing/service.py",
                 "module": "proliferate.server.billing.service",
                 "function": "factory.<locals>.charge", "lineno": 41,
                 "in_app": True, "vars": {"token": SENTINELS[9]},
                 "context_line": SENTINELS[5], "abs_path": SENTINELS[6]},
            ],
            "frames_omitted": [1, 2],
        },
    }
    event = _error(release=RELEASE, environment="staging", exception={"values": [entry]})
    projected = _project(event)

    assert projected is not None
    assert projected["release"] == RELEASE
    assert projected["environment"] == "staging"
    assert projected["event_id"] == event["event_id"]
    assert projected["timestamp"] == event["timestamp"]
    projected_entry = projected["exception"]["values"][0]
    assert projected_entry["type"] == "Outer.InnerError"
    assert projected_entry["module"] == "proliferate.server.billing.errors"
    assert "value" not in projected_entry and "notes" not in projected_entry
    assert projected_entry["mechanism"] == {"type": "starlette", "handled": False}
    assert projected_entry["stacktrace"] == {
        "frames": [
            {"filename": "proliferate/server/billing/service.py",
             "module": "proliferate.server.billing.service",
             "function": "factory.<locals>.charge", "lineno": 41, "in_app": True}
        ]
    }

@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("message", SENTINELS[2]), ("logentry", {"message": SENTINELS[2]}),
        ("culprit", "proliferate.server.billing.service in charge"),
        ("logger", "proliferate.billing"), ("server_name", "ip-10-0-0-1"), ("dist", "1"),
        ("modules", {"sentry-sdk": "2.66.1"}), ("debug_meta", {"images": []}),
        ("sdk", {"name": "sentry.python"}), ("profile", {"samples": []}),
        ("measurements", {"lcp": {"value": 1}}), ("trace_id", TRACE_ID),
        ("span_id", SPAN_ID), ("parent_span_id", SPAN_ID), ("errors", [{"type": "x"}]),
        ("fingerprint", ["billing", "stripe_webhook_drop", "unhandled_event_type"]),
        ("unknown_top_level", "anything"),
    ],
)
def test_unlisted_or_forbidden_top_level_keys_never_survive(key: str, value: Any) -> None:
    projected = _project(_error(**{key: value}))
    assert projected is not None
    assert key not in projected

@pytest.mark.parametrize("value", ["error", "session", "log", 1, None])
def test_a_present_non_transaction_type_drops_the_event(value: Any) -> None:
    assert _project(_error(type=value)) is None

@pytest.mark.parametrize(
    ("environment", "survives"),
    [("trusted-beta", True), ("staging", True), ("production", True), ("Production", True),
     ("STAGING", False), ("Production ", False), ("development", False), ("", False),
     (None, False), (7, False), ("prod\nuction", False), ("Bearer token", False),
     ("/Users/private/x", False)],
)
def test_environment_row_is_case_sensitive_and_closed(environment: Any, survives: bool) -> None:
    projected = _project(_error(environment=environment))
    assert projected is not None
    assert ("environment" in projected) is survives

@pytest.mark.parametrize(
    ("release", "survives"),
    [(RELEASE, True), ("proliferate-server@1.2.3", True), ("", False),
     ("proliferate-server@1.2", False), ("1.2.3", False), (RELEASE.encode(), False)])
def test_release_row_is_closed(release: Any, survives: bool) -> None:
    projected = _project(_error(release=release))
    assert projected is not None
    assert ("release" in projected) is survives

@pytest.mark.parametrize("factory_name", ["_error", "_transaction"])
def test_empty_release_and_environment_sentinels_are_removed(factory_name: str) -> None:
    factory = globals()[factory_name]
    projected = _project(factory(release="", environment=""))
    assert projected is not None
    assert "release" not in projected and "environment" not in projected

# --- tags, extras, user, request ---------------------------------------------

# Fixed ids (were uuid4() at collection time, which lands in parametrize ids and
# breaks pytest-xdist's requirement that workers agree on collected test names).
VALID_UUID = "c3f1a8d2-5b47-4e19-9a6c-0d8e2f7b41ca"
VALID_UUID_HEX = "0f3c2a9d6b8e4f1aa7c25d3e9b64108f"

@pytest.mark.parametrize(
    ("key", "value", "survives"),
    [
        ("surface", "cloud_api", True), ("surface", "desktop", False),
        ("telemetry_mode", "hosted_product", True), ("telemetry_mode", "self_managed", False),
        ("request_id", VALID_UUID, True), ("request_id", SENTINELS[12], False),
        ("http_method", "POST", True), ("http_method", "post", False),
        ("http_route", "/orgs/{org_id}", True), ("http_route", "/orgs/" + VALID_UUID, False),
        ("user_id", VALID_UUID, True), ("organization_id", VALID_UUID, True),
        ("cloud_workspace_id", VALID_UUID, True), ("cloud_target_id", VALID_UUID, True),
        ("sandbox_profile_id", VALID_UUID, True), ("cloud_sandbox_id", VALID_UUID, True),
        ("enrollment_key_id", VALID_UUID, True), ("user_id", VALID_UUID.upper(), True),
        ("support_report_id", VALID_UUID_HEX, True), ("support_report_id", VALID_UUID, False),
        ("tenant_id", f"user:{VALID_UUID}", True), ("tenant_id", f"org:{VALID_UUID}", True),
        ("tenant_id", f"team:{VALID_UUID}", False), ("critical_failure", "true", True),
        ("critical_failure", "True", False), ("domain", "billing", True),
        ("domain", "billing ", False), ("action", "stripe_webhook_drop", True),
        ("action", "unknown_action", False), ("harness_kind", "codex", True),
        ("harness_kind", "gemini", False), ("fn", "materialize_sandbox", True),
        ("label", f"materialize_sandbox:{VALID_UUID}", True), ("fn", "drop_database", False),
        ("label", f"materialize_other:{VALID_UUID}", False), ("worker_id", "worker-1", False),
        ("external_sandbox_id", "sbx-1", False), ("anyharness_workspace_id", "ws-1", False),
        ("anyharness_workspace_id", VALID_UUID, True), ("session_id", VALID_UUID, True),
        ("session_id", "session-01", False), ("interaction_id", VALID_UUID, True),
        ("command_id", VALID_UUID, True), ("anomaly", "slow", False),
        ("unknown_tag", "value", False),
    ],
)
def test_tag_rows_are_closed(key: str, value: Any, survives: bool) -> None:
    projected = _project(_error(tags={key: value}))
    assert projected is not None
    assert (key in projected.get("tags", {})) is survives
    if survives:
        assert projected["tags"][key] == value

@pytest.mark.parametrize("value", [None, 7, True, b"b", ["b"], {"v": "b"}, "bill\ning"])
def test_retained_tag_rejects_wrong_serialized_types(value: Any) -> None:
    projected = _project(_error(tags={"domain": value}))
    assert projected is not None
    assert "tags" not in projected

@pytest.mark.parametrize(
    ("key", "value", "expected"),
    [
        ("billing_subject_id", VALID_UUID, VALID_UUID), ("owner_user_id", None, None),
        ("subject_id", "nope", "[redacted]"), ("stripe_event_id", "evt_1AbC", "evt_1AbC"),
        ("stripe_event_id", "ch_1AbC", "[redacted]"), ("stripe_object_id", "in_1AbC", "in_1AbC"),
        ("stripe_object_id", "cs_test_1AbC", "cs_test_1AbC"),
        ("stripe_object_id", "cus_1AbC", "[redacted]"),
        ("stripe_subscription_id", "sub_1AbC", "sub_1AbC"),
        ("drop_reason", "unhandled_event_type", "unhandled_event_type"),
        ("drop_reason", "unhandled_event_type_extra", "[redacted]"),
        ("drop_reason", None, "[redacted]"), ("session_mode", "payment", "payment"),
        ("session_mode", "PAYMENT", "[redacted]"), ("event_type", None, None),
        ("monthly_price_class", "legacy_cloud", "legacy_cloud"),
        ("invoice_reason", "quote_accept", "quote_accept"),
        ("subscription_status", "past_due", "past_due"),
        ("subscription_status", "paused", "[redacted]"),
        ("session_purpose", "refill", "[redacted]"),
        ("event_type", "invoice.paid", "[redacted]"), ("paid", True, True),
        ("paid", 1, "[redacted]"), ("has_status", None, None), ("line_item_count", 3, 3),
        ("line_item_count", True, "[redacted]"), ("line_item_count", 10001, "[redacted]"),
    ],
)
def test_extra_rows_are_closed(key: str, value: Any, expected: Any) -> None:
    projected = _project(_error(extra={key: value}))
    assert projected is not None
    assert projected["extra"][key] == expected

@pytest.mark.parametrize("key", ["request_id", "elapsed_ms", "budget_ms", "anomaly", "note"])
def test_unknown_extra_keys_are_removed(key: str) -> None:
    projected = _project(_error(extra={key: SENTINELS[12]}))
    assert projected is not None
    assert key not in projected.get("extra", {})

def test_container_at_a_scalar_extra_path_is_redacted_whole() -> None:
    projected = _project(_error(extra={"subject_id": {"nested": SENTINELS[12]}}))
    assert projected is not None
    assert projected["extra"]["subject_id"] == "[redacted]"

def test_user_is_id_only_and_invalid_user_removes_the_subtree() -> None:
    good = _project(_error(user={"id": VALID_UUID, "email": SENTINELS[0], "ip_address": "x"}))
    bad = _project(_error(user={"id": "anonymous", "email": SENTINELS[0]}))
    assert good is not None and bad is not None
    assert good["user"] == {"id": VALID_UUID}
    assert "user" not in bad

def test_request_keeps_only_a_cataloged_method() -> None:
    request = {"method": "POST", "fragment": "f", "data": SENTINELS[7],
               "url": f"https://u:p@api.example/orgs?{SENTINELS[8]}=1#f",
               "query_string": f"{SENTINELS[8]}=1", "cookies": {"session": SENTINELS[9]},
               "headers": {"authorization": SENTINELS[9]}, "env": {"SECRET": SENTINELS[10]}}
    projected = _project(_error(request=request))
    assert projected is not None
    assert projected["request"] == {"method": "POST"}

@pytest.mark.parametrize(
    "event",
    [
        {"exception": [{"type": "ValueError"}]},
        {"exception": {"values": {"0": {"type": "ValueError"}}}},
        {"exception": {"values": [{"type": "ValueError"}], "other": 1}},
        {"threads": [{"crashed": True}]}, {"threads": {"values": "nope"}},
        {"breadcrumbs": [{"type": "log"}]}, {"stacktrace": {"frames": {"0": {}}}},
        {"stacktrace": [{"filename": "proliferate/x.py"}]},
        {"raw_stacktrace": {"frames": [{"filename": "proliferate/x.py"}]}},
    ],
)
def test_malformed_serialized_containers_are_removed_not_recreated(event: dict[str, Any]) -> None:
    projected = _project({**_error(), **event})
    wrapper = event.get("exception")
    if isinstance(wrapper, dict) and isinstance(wrapper.get("values"), list):
        assert projected is not None
        assert projected["exception"] == {"values": [{"type": "ValueError"}]}
        return
    if "exception" in event:
        # The only exception container is malformed, so nothing anchors the event.
        assert projected is None
        return
    assert projected is not None
    for key in event:
        assert key not in projected
    assert "raw_stacktrace" not in json.dumps(projected, sort_keys=True)

def test_defensive_frame_and_thread_fields_never_survive() -> None:
    projected = _project(
        _error(
            threads={
                "values": [
                    {"id": 7, "main": True, "crashed": False, "current": True,
                     "name": "MainThread", "raw_stacktrace": {"frames": []},
                     "stacktrace": {
                         "frames": [
                             {"filename": "proliferate/main.py", "raw_function": "main",
                              "colno": 4, "stack_start": True, "platform": "python",
                              "instruction_addr": "0x1", "package": "proliferate",
                              "source_link": "https://example/x"}
                         ],
                         "registers": {"rax": 1},
                     }}
                ]
            }
        )
    )
    assert projected is not None
    assert projected["threads"]["values"][0] == {
        "crashed": False, "current": True,
        "stacktrace": {"frames": [{"filename": "proliferate/main.py"}]},
    }

@pytest.mark.parametrize(
    ("container", "entry"),
    [("exception", {"type": "ValueError"}), ("threads", {"crashed": False}),
     ("breadcrumbs", {"type": "log"})])
def test_over_bound_wrapper_sequences_are_removed_whole(container: str, entry: Any) -> None:
    over = {"values": [dict(entry) for _ in range(101)]}
    projected = _project({**_error(), container: over})
    if container == "exception":
        assert projected is None
    else:
        assert projected is not None
        assert container not in projected

def test_over_bound_frame_list_removes_only_that_stack() -> None:
    frames = [{"filename": "proliferate/x.py"} for _ in range(101)]
    entry = {"type": "ValueError", "module": "builtins", "stacktrace": {"frames": frames}}
    projected = _project(_error(exception={"values": [entry]}))
    assert projected is not None
    entry = projected["exception"]["values"][0]
    assert entry["type"] == "ValueError"
    assert "stacktrace" not in entry

def test_projector_wide_failure_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("projector failure")

    monkeypatch.setattr(privacy, "_project_catalog_map", _boom)
    assert _project(_error(tags={"domain": "billing"})) is None

@pytest.mark.parametrize("event", [None, [], "event", 7, {"type": "transaction"}])
def test_non_projectable_events_return_none(event: Any) -> None:
    assert _project(event) is None

def test_message_only_event_with_no_diagnostic_anchor_is_dropped() -> None:
    assert _project({"event_id": "a" * 32, "message": SENTINELS[2]}) is None

def _drop_event(reason: Any, **overrides: Any) -> dict[str, Any]:
    event = _error(
        tags={"domain": "billing", "action": "stripe_webhook_drop"},
        extra={"drop_reason": reason},
        exception={
            "values": [
                {"type": "Exception", "module": "builtins",
                 "value": f"Stripe money-in event dropped without a projection: {reason}"}
            ]
        },
    )
    event.update(overrides)
    return event

@pytest.mark.parametrize("reason", sorted(privacy.DROP_REASONS))
def test_stripe_drop_reasons_synthesize_distinct_fingerprints(reason: str) -> None:
    projected = _project(_drop_event(reason))
    assert projected is not None
    assert projected["fingerprint"] == ["billing", "stripe_webhook_drop", reason]
    assert "value" not in projected["exception"]["values"][0]

def test_distinct_drop_reasons_group_differently() -> None:
    first = _project(_drop_event("unhandled_event_type"))
    second = _project(_drop_event("invoice_not_period_boundary"))
    assert first is not None and second is not None
    assert first["fingerprint"] != second["fingerprint"]

@pytest.mark.parametrize(
    "event",
    [
        _drop_event("unhandled_event_type_lookalike"),
        _drop_event("unhandled_event_type", tags={"domain": "billing"}),
        _drop_event("unhandled_event_type", tags={"domain": "agent_gateway"}),
        _drop_event(None),
    ],
)
def test_no_fingerprint_without_the_complete_validated_tuple(event: dict[str, Any]) -> None:
    projected = _project(event)
    assert projected is not None
    assert "fingerprint" not in projected

def test_incoming_exact_looking_fingerprint_is_never_copied() -> None:
    projected = _project(
        _error(fingerprint=["billing", "stripe_webhook_drop", "unhandled_event_type"])
    )
    assert projected is not None
    assert "fingerprint" not in projected

# --- transactions and spans ---------------------------------------------------

def _transaction(**overrides: Any) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "transaction",
        "event_id": "b" * 32,
        "platform": "python",
        "transaction": "proliferate.server.billing.api.create_checkout",
        "transaction_info": {"source": "component", "origin": "auto.http"},
        "start_timestamp": 1755600000.0,
        "timestamp": 1755600001.5,
        "contexts": {
            "trace": {"trace_id": TRACE_ID, "span_id": SPAN_ID, "op": "http.server",
                      "status": "ok", "description": "POST /orgs/{org_id}",
                      "data": {"url": f"https://u:p@api.example/x?{SENTINELS[8]}=1"},
                      "dynamic_sampling_context": {"release": "x"}},
            "response": {"status_code": 201, "headers": {"x": SENTINELS[9]}},
            "runtime": {"name": "CPython"},
            "customer": {"request_id": SENTINELS[12]},
        },
        "spans": [
            {"trace_id": TRACE_ID, "span_id": CHILD_SPAN_ID, "parent_span_id": SPAN_ID,
             "op": "queue.publish", "status": "ok", "start_timestamp": 1755600000.1,
             "timestamp": 1755600000.9, "description": SENTINELS[11],
             "data": {"request_id": SENTINELS[12]}, "tags": {"http_route": "/raw"},
             "end_timestamp": 1755600000.9}
        ],
        "tags": {"http_route": "/orgs/{org_id}", "http_method": "POST"},
        "request": {"url": "https://u:p@api.example/x", "method": "POST"},
    }
    event.update(overrides)
    return event

def test_transaction_projection_keeps_only_the_proven_surface() -> None:
    projected = _project(_transaction())
    assert projected is not None
    assert projected["type"] == "transaction"
    assert projected["transaction"] == "proliferate.server.billing.api.create_checkout"
    assert projected["transaction_info"] == {"source": "component"}
    assert projected["contexts"]["trace"] == {
        "trace_id": TRACE_ID, "span_id": SPAN_ID, "op": "http.server", "status": "ok",
    }
    assert projected["contexts"]["response"] == {"status_code": 201}
    assert set(projected["contexts"]) == {"trace", "response"}
    assert projected["spans"] == [
        {"trace_id": TRACE_ID, "span_id": CHILD_SPAN_ID, "parent_span_id": SPAN_ID,
         "op": "queue.publish", "status": "ok", "start_timestamp": 1755600000.1,
         "timestamp": 1755600000.9}
    ]
    assert projected["tags"] == {"http_route": "/orgs/{org_id}", "http_method": "POST"}
    assert projected["request"] == {"method": "POST"}
    assert "fingerprint" not in projected

@pytest.mark.parametrize("op", sorted(privacy.SPAN_OPS))
def test_the_five_configured_ops_survive(op: str) -> None:
    event = _transaction()
    event["contexts"]["trace"]["op"] = op
    projected = _project(event)
    assert projected is not None
    assert projected["contexts"]["trace"]["op"] == op

@pytest.mark.parametrize(
    "op",
    ["queue.submit.celery", "middleware.starlette", "middleware.starlette.receive",
     "middleware.starlette.send", "db", "db.redis", "http.client", "cache.get",
     "subprocess", "socket.dns", "function", "ai.chat_completions"],
)
def test_non_produced_ops_are_rejected(op: str) -> None:
    event = _transaction()
    event["contexts"]["trace"]["op"] = op
    projected = _project(event)
    assert projected is not None
    assert "op" not in projected["contexts"]["trace"]

@pytest.mark.parametrize(
    ("name", "source", "survives"),
    [("proliferate.server.billing.api.create_checkout", "component", True),
     ("generic FastAPI request", "route", True), ("/orgs/{org_id}", "route", False),
     ("proliferate.server.billing.api.create_checkout", "route", False),
     ("generic FastAPI request", "component", False), ("GET /orgs/x", "url", False)],
)
def test_transaction_name_pair_is_closed(name: str, source: str, survives: bool) -> None:
    projected = _project(_transaction(transaction=name, transaction_info={"source": source}))
    assert projected is not None
    assert ("transaction" in projected) is survives
    assert ("transaction_info" in projected) is survives

def test_span_without_both_ids_is_dropped() -> None:
    projected = _project(_transaction(spans=[{"trace_id": TRACE_ID, "op": "queue.publish"}]))
    assert projected is not None
    assert "spans" not in projected

def test_over_bound_span_list_is_removed_whole() -> None:
    span = {"trace_id": TRACE_ID, "span_id": CHILD_SPAN_ID}
    projected = _project(_transaction(spans=[dict(span) for _ in range(1001)]))
    assert projected is not None
    assert "spans" not in projected

def test_direct_breadcrumb_callback_keeps_only_safe_fields() -> None:
    moment = dt.datetime(2026, 8, 19, 12, 0, tzinfo=dt.UTC)
    projected = project_breadcrumb(
        {"type": "log", "level": "info", "timestamp": moment, "message": SENTINELS[2],
         "category": "proliferate.server.billing.service",
         "data": {"request_id": SENTINELS[12]}},
        {},
    )
    assert projected == {"type": "log", "level": "info", "timestamp": moment,
                         "category": "proliferate.server.billing.service"}

@pytest.mark.parametrize(
    "breadcrumb",
    [{"message": SENTINELS[2]}, {"data": {"prompt": SENTINELS[2]}}, {"type": "unknown"},
     {"category": "django.request"}, {}, "not-a-mapping", None])
def test_breadcrumbs_without_a_safe_field_are_dropped(breadcrumb: Any) -> None:
    assert project_breadcrumb(breadcrumb, {}) is None

def test_embedded_breadcrumbs_are_reprojected_as_an_outbound_backstop() -> None:
    hostile = {"type": "log", "level": "info", "category": "proliferate",
               "message": SENTINELS[3], "data": {"request_id": SENTINELS[12]}}
    projected = _project(_error(breadcrumbs={"values": [hostile]}))
    assert projected is not None
    assert projected["breadcrumbs"]["values"] == [
        {"type": "log", "level": "info", "category": "proliferate"}
    ]

def test_flat_embedded_breadcrumb_sequence_is_removed() -> None:
    projected = _project(_error(breadcrumbs=[{"type": "log", "category": "proliferate"}]))
    assert projected is not None
    assert "breadcrumbs" not in projected

# --- whole-event guards -------------------------------------------------------

_STACK = "stacktrace.frames[]"
_EXC = ".exception.values[]"
ALLOWED_PATHS = {
    ".event_id", ".release", ".environment", ".timestamp", ".start_timestamp", ".platform",
    ".level", ".type", ".transaction", ".transaction_info.source", ".fingerprint[]",
    ".user.id", ".request.method", ".contexts.trace.trace_id", ".contexts.trace.span_id",
    ".contexts.trace.parent_span_id", ".contexts.trace.op", ".contexts.trace.status",
    ".contexts.response.status_code", ".spans[].trace_id", ".spans[].span_id",
    ".spans[].parent_span_id", ".spans[].op", ".spans[].status", ".spans[].start_timestamp",
    ".spans[].timestamp", ".spans[].same_process_as_parent",
    ".threads.values[].crashed", ".threads.values[].current",
    f".threads.values[].{_STACK}.filename",
    ".breadcrumbs.values[].type", ".breadcrumbs.values[].level",
    ".breadcrumbs.values[].category", ".breadcrumbs.values[].timestamp",
    *(f"{_EXC}.{leaf}" for leaf in ("type", "module")),
    *(f"{_EXC}.mechanism.{leaf}"
      for leaf in ("type", "handled", "is_exception_group", "exception_id", "parent_id")),
    *(f"{_EXC}.{_STACK}.{leaf}"
      for leaf in ("filename", "module", "function", "lineno", "in_app")),
    *(f".tags.{key}" for key in privacy.TAG_VALIDATORS),
    *(f".extra.{key}" for key in privacy.EXTRA_VALIDATORS),
}

def _hostile_error() -> dict[str, Any]:
    event = _drop_event("unhandled_event_type")
    event["tags"].update({"http_route": SENTINELS[6], "request_id": SENTINELS[12]})
    event["extra"].update({"request_id": SENTINELS[12], "detail": SENTINELS[0]})
    event["user"] = {"id": VALID_UUID, "email": SENTINELS[0], "username": SENTINELS[1]}
    event["message"] = SENTINELS[2]
    event["contexts"] = {"customer": {"request_id": SENTINELS[12]}, "state": {"x": SENTINELS[3]}}
    event["breadcrumbs"] = {
        "values": [{"type": "log", "category": "proliferate", "message": SENTINELS[4]}]
    }
    event["exception"]["values"][0]["mechanism"] = {
        "type": "generic", "data": {"request_id": SENTINELS[12]},
    }
    return event

@pytest.mark.parametrize("event_factory", [_hostile_error, _transaction])
def test_no_sentinel_survives_and_paths_stay_in_the_closed_table(event_factory: Any) -> None:
    projected = _project(event_factory())
    assert projected is not None
    dumped = json.dumps(projected, sort_keys=True)
    for sentinel in SENTINELS:
        assert sentinel not in dumped
    for path, _value in _flatten(projected):
        assert path in ALLOWED_PATHS, path
# fmt: on
