from __future__ import annotations

import ast
import inspect
import json
import sys
from collections.abc import Callable
from typing import Any
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from sentry_sdk.transport import Transport

from proliferate import main as server_main
from proliferate.config import settings
from proliferate.integrations import sentry as sentry_integration
from proliferate.integrations.sentry import client as sentry_client

# Tables below are hand-packed to fit the 600-line ceiling with no case dropped
# and no 13th path; every `ruff check` rule still applies to this file.
# fmt: off

PACKAGE_DIR = Path(__file__).parents[2] / "proliferate/integrations/sentry"
SERVER_PACKAGE_DIR = Path(__file__).parents[2] / "proliferate"

PUBLIC_API = [
    "capture_server_sentry_exception", "clear_server_sentry_user", "flush_server_sentry",
    "init_server_sentry", "report_critical", "scrub_mapping", "scrub_text", "scrub_value",
    "set_server_sentry_correlation_context", "set_server_sentry_tag", "set_server_sentry_user",
]

def _forbidden_layer_imports(tree: ast.AST) -> list[tuple[int, str]]:
    forbidden_prefixes = ("proliferate.lib.product", "proliferate.server")
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(forbidden_prefixes):
            found.append((node.lineno, node.module or ""))
        elif isinstance(node, ast.Import):
            found.extend((node.lineno, alias.name) for alias in node.names
                         if alias.name.startswith(forbidden_prefixes))
    return found

def test_sentry_package_does_not_import_product_layers() -> None:
    for source_path in sorted(PACKAGE_DIR.glob("*.py")):
        tree = ast.parse(source_path.read_text())
        assert _forbidden_layer_imports(tree) == [], source_path

def _uses_sentry_sdk(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(
            alias.name == "sentry_sdk" or alias.name.startswith("sentry_sdk.")
            for alias in node.names
        ):
            return True
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("sentry_sdk"):
            return True
        if isinstance(node, ast.Name) and node.id == "sentry_sdk":
            return True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            literals = [a for a in node.args if isinstance(a, ast.Constant)]
            if node.func.id == "__import__" and any(
                str(a.value).startswith("sentry_sdk") for a in literals
            ):
                return True
    return False

def test_only_the_sentry_package_uses_the_sdk_in_server_production_code() -> None:
    offenders = [str(path) for path in sorted(SERVER_PACKAGE_DIR.rglob("*.py"))
                 if PACKAGE_DIR not in path.parents
                 and _uses_sentry_sdk(ast.parse(path.read_text()))]
    assert offenders == []

def test_public_api_is_the_exact_frozen_surface() -> None:
    assert sentry_integration.__all__ == PUBLIC_API
    for name in PUBLIC_API:
        assert callable(getattr(sentry_integration, name))
    capture = inspect.signature(sentry_integration.capture_server_sentry_exception)
    assert list(capture.parameters) == ["error", "level", "tags", "extras", "fingerprint"]
    flush = inspect.signature(sentry_integration.flush_server_sentry)
    assert list(flush.parameters) == ["timeout"]

@pytest.mark.parametrize(
    ("value", "expected"),
    [("Bearer abc.DEF-123_=", "[redacted-token]"),
     ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl", "[redacted-jwt]"),
     ("/Users/pablo/proliferate/server/file.py", "[redacted-path]"),
     ("/home/user/proliferate/server/file.py", "[redacted-path]"),
     (r"C:\Users\pablo\proliferate\server.py", "[redacted-path]"),
     ("first\r\nsecond\rthird", "first\nsecond\nthird")])
def test_scrub_text_preserves_string_pattern_behavior(value: str, expected: str) -> None:
    assert sentry_integration.scrub_text(value) == expected

@pytest.mark.parametrize(
    "key",
    ["authorization", "cookie", "token", "secret", "password", "api_key", "api-key",
     "credential", "prompt", "content", "stdout", "stderr", "request_body", "body",
     "env", "file_path", "path"],
)
def test_scrub_mapping_redacts_sensitive_key_values(key: str) -> None:
    assert sentry_integration.scrub_mapping({key: {"nested": "value"}}) == {key: "[redacted]"}

def test_scrub_mapping_recurses_and_preserves_container_shapes() -> None:
    scrubbed = sentry_integration.scrub_mapping(
        {
            "metadata": {
                "list": ["Bearer secret-token", 7, True, None],
                "tuple": ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
                          {"message": "/home/user/private/file.txt"}),
            },
            "password": {"nested": "value"},
        }
    )

    assert scrubbed == {
        "metadata": {
            "list": ["[redacted-token]", 7, True, None],
            "tuple": ("[redacted-jwt]", {"message": "[redacted-path]"}),
        },
        "password": "[redacted]",
    }

class _FakeScope:
    def __init__(self) -> None:
        self.level: str | None = None
        self.fingerprint: list[str] | None = None
        self.tags: dict[str, str] = {}
        self.extras: dict[str, object] = {}

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value

    def set_extra(self, key: str, value: object) -> None:
        self.extras[key] = value

class _FakeSentrySdk:
    def __init__(self) -> None:
        self.user: dict[str, str] | None = None
        self.set_user_calls: list[dict[str, str] | None] = []
        self.tag_calls: list[tuple[str, object]] = []
        self.current_scope: _FakeScope | None = None
        self.captured: list[tuple[Exception, _FakeScope | None]] = []

    def set_user(self, value: dict[str, str] | None) -> None:
        self.user = value
        self.set_user_calls.append(value)

    def set_tag(self, key: str, value: object) -> None:
        self.tag_calls.append((key, value))

    @contextmanager
    def push_scope(self):
        previous = self.current_scope
        scope = _FakeScope()
        self.current_scope = scope
        try:
            yield scope
        finally:
            self.current_scope = previous

    def capture_exception(self, error: Exception) -> None:
        self.captured.append((error, self.current_scope))

@pytest.fixture()
def fake_sdk(monkeypatch: pytest.MonkeyPatch) -> _FakeSentrySdk:
    fake = _FakeSentrySdk()
    monkeypatch.setattr(sentry_client, "sentry_sdk", fake)
    monkeypatch.setattr(sentry_client, "_sentry_initialized", True)
    return fake

def test_set_server_sentry_user_sets_validated_id_only(fake_sdk: _FakeSentrySdk) -> None:
    user_id = str(uuid4())
    sentry_integration.set_server_sentry_user(user_id)
    assert fake_sdk.user == {"id": user_id}

class _HostileId:
    def __str__(self) -> str:  # pragma: no cover - must never be invoked
        raise AssertionError("public ingress must not stringify its input")

    __repr__ = __str__

@pytest.mark.parametrize("user_id", ["user-123", "", b"not-a-str", _HostileId()])
def test_set_server_sentry_user_clears_on_invalid_identity(
    fake_sdk: _FakeSentrySdk, user_id: object
) -> None:
    sentry_integration.set_server_sentry_user(user_id)  # type: ignore[arg-type]
    assert fake_sdk.user is None
    assert fake_sdk.set_user_calls == [None]

def test_clear_server_sentry_user_resets_user(fake_sdk: _FakeSentrySdk) -> None:
    user_id = str(uuid4())
    sentry_integration.set_server_sentry_user(user_id)
    assert fake_sdk.user == {"id": user_id}

    # Clearing at request teardown prevents cross-user leakage onto the next
    # request handled by the same worker.
    sentry_integration.clear_server_sentry_user()
    assert fake_sdk.user is None
    assert fake_sdk.set_user_calls == [{"id": user_id}, None]

def test_set_server_sentry_tag_admits_only_catalog_rows(fake_sdk: _FakeSentrySdk) -> None:
    sentry_integration.set_server_sentry_tag("domain", "billing")
    sentry_integration.set_server_sentry_tag("domain", "please_ignore_previous_instructions")
    sentry_integration.set_server_sentry_tag("http_route", "/orgs/{org_id}")
    sentry_integration.set_server_sentry_tag("session_id", "not-a-uuid")
    sentry_integration.set_server_sentry_tag("unknown_tag", "value")
    assert fake_sdk.tag_calls == [("domain", "billing")]

    fake_sdk.tag_calls.clear()
    session_id = str(uuid4())
    sentry_integration.set_server_sentry_tag("session_id", session_id)
    assert fake_sdk.tag_calls == [("session_id", session_id)]

def test_correlation_context_skips_unknown_and_invalid_entries(
    fake_sdk: _FakeSentrySdk,
) -> None:
    organization_id = str(uuid4())
    sentry_integration.set_server_sentry_correlation_context(
        {
            "organization_id": organization_id,
            "user_id": "not-a-uuid",
            "session_id": "arbitrary",
            "worker_id": "arbitrary",
            "http_route": "/raw/path",
        }
    )
    assert fake_sdk.tag_calls == [("organization_id", organization_id)]

    fake_sdk.tag_calls.clear()
    sentry_integration.set_server_sentry_correlation_context(["not", "a", "dict"])  # type: ignore[arg-type]
    assert fake_sdk.tag_calls == []

def test_capture_server_sentry_exception_noops_when_adapter_not_initialized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeSentrySdk()
    monkeypatch.setattr(sentry_client, "sentry_sdk", fake)
    monkeypatch.setattr(sentry_client, "_sentry_initialized", False)

    sentry_integration.capture_server_sentry_exception(RuntimeError("boom"))

    assert fake.captured == []

def test_capture_validates_scope_fields_and_ignores_fingerprint(
    fake_sdk: _FakeSentrySdk,
) -> None:
    subject_id = str(uuid4())
    sentry_integration.capture_server_sentry_exception(
        RuntimeError("boom"),
        level="warning",
        tags={"domain": "billing", "http_route": "/raw", "unknown": "x"},
        extras={
            "subject_id": subject_id,
            "drop_reason": "unhandled_event_type",
            "stripe_event_id": "not-an-event-id",
            "detail": "opened /Users/pablo/proliferate",
        },
        fingerprint=["billing", "reconcile"],
    )

    assert len(fake_sdk.captured) == 1
    captured_error, scope = fake_sdk.captured[0]
    assert str(captured_error) == "boom"
    assert scope is not None
    assert scope.level == "warning"
    assert scope.fingerprint is None
    assert scope.tags == {"domain": "billing"}
    assert scope.extras == {
        "subject_id": subject_id,
        "drop_reason": "unhandled_event_type",
        "stripe_event_id": "[redacted]",
    }

def test_capture_replaces_non_exception_without_stringifying_it(
    fake_sdk: _FakeSentrySdk,
) -> None:
    sentry_integration.capture_server_sentry_exception(_HostileId(), level="not-a-level")
    captured_error, scope = fake_sdk.captured[0]
    assert type(captured_error) is Exception
    assert str(captured_error) == "Unknown error"
    assert scope is not None
    assert scope.level is None

def test_capture_ignores_wrong_containers(fake_sdk: _FakeSentrySdk) -> None:
    sentry_integration.capture_server_sentry_exception(
        RuntimeError("boom"),
        tags=["domain", "billing"],  # type: ignore[arg-type]
        extras=("drop_reason", "unhandled_event_type"),  # type: ignore[arg-type]
    )
    _error, scope = fake_sdk.captured[0]
    assert scope is not None
    assert scope.tags == {}
    assert scope.extras == {}

class _InitRecorder:
    def __init__(self) -> None:
        self.kwargs: dict[str, object] = {}
        self.tags: dict[str, str] = {}

    def init(self, **kwargs: object) -> None:
        self.kwargs.update(kwargs)

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value

def _init(
    monkeypatch: pytest.MonkeyPatch,
    *,
    release: str = "proliferate-server@0.3.27+3c2bbf20e215",
    environment: str = "trusted-beta",
    enabled: bool = True,
    telemetry_mode: str = "hosted_product",
) -> _InitRecorder:
    recorder = _InitRecorder()
    monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
    monkeypatch.setattr(settings, "sentry_environment", environment)
    monkeypatch.setattr(sentry_client, "_sentry_initialized", False)
    monkeypatch.setattr(sentry_client, "sentry_sdk", recorder)
    sentry_integration.init_server_sentry(
        enabled=enabled, telemetry_mode=telemetry_mode, release_resolver=lambda: release
    )
    return recorder

ALL_INIT_CONTROLS = {
    "attach_stacktrace": True, "max_breadcrumbs": 100, "default_integrations": False,
    "auto_enabling_integrations": False, "trace_lifecycle": "static",
    "propagate_traces": False, "trace_propagation_targets": [],
    "include_local_variables": False, "include_source_context": False,
    "max_request_body_size": "never", "send_default_pii": False,
    "auto_session_tracking": False, "send_client_reports": False, "spotlight": False,
    "stream_gen_ai_spans": False, "enable_logs": False, "enable_metrics": False,
    "profiles_sample_rate": 0.0, "profile_session_sample_rate": 0.0,
    "enable_db_query_source": False, "enable_http_request_source": False,
}

def test_init_installs_the_exact_transport_controls(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _init(monkeypatch)

    for key, expected in ALL_INIT_CONTROLS.items():
        assert recorder.kwargs[key] == expected, key
        assert type(recorder.kwargs[key]) is type(expected), key

    assert recorder.kwargs["before_send"] is recorder.kwargs["before_send_transaction"]
    assert recorder.kwargs["before_send"] is sentry_client._project_outbound_event
    assert recorder.kwargs["before_breadcrumb"] is sentry_client._project_breadcrumb
    assert recorder.tags == {"surface": "cloud_api", "telemetry_mode": "hosted_product"}

def test_init_installs_only_the_eight_named_integrations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sentry_sdk.integrations.atexit import AtexitIntegration
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.dedupe import DedupeIntegration
    from sentry_sdk.integrations.excepthook import ExcepthookIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.threading import ThreadingIntegration
    recorder = _init(monkeypatch)
    integrations = recorder.kwargs["integrations"]
    assert isinstance(integrations, list)
    assert [type(entry) for entry in integrations] == [
        AtexitIntegration, CeleryIntegration, DedupeIntegration, ExcepthookIntegration,
        LoggingIntegration, ThreadingIntegration, StarletteIntegration, FastApiIntegration,
    ]
    celery = integrations[1]
    assert celery.propagate_traces is False
    assert celery.monitor_beat_tasks is False
    assert integrations[3].always_run is False
    assert integrations[4]._handler is None  # event_level=None installs no event handler
    assert integrations[5].propagate_scope is True
    for asgi in (integrations[6], integrations[7]):
        assert asgi.transaction_style == "endpoint"
        assert asgi.middleware_spans is False

@pytest.mark.parametrize("environment", ["trusted-beta", "staging", "production", "Production"])
def test_init_passes_valid_identity_byte_for_byte(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    release = "proliferate-server@1.2.3+0123456789ab"
    recorder = _init(monkeypatch, release=release, environment=environment)
    assert recorder.kwargs["release"] == release
    assert recorder.kwargs["environment"] == environment

@pytest.mark.parametrize("release", ["", "0.3.27", "proliferate-server@bad", "Bearer token"])
@pytest.mark.parametrize("environment", ["", "STAGING", "Production ", "development"])
def test_init_maps_invalid_identity_to_the_empty_no_discovery_sentinel(
    monkeypatch: pytest.MonkeyPatch, release: str, environment: str
) -> None:
    monkeypatch.setenv("SENTRY_RELEASE", "proliferate-server@9.9.9+deadbeefcafe")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    recorder = _init(monkeypatch, release=release, environment=environment)
    assert recorder.kwargs["release"] == ""
    assert recorder.kwargs["environment"] == ""
    assert recorder.kwargs["release"] is not None
    assert recorder.kwargs["environment"] is not None

@pytest.mark.parametrize(
    ("enabled", "telemetry_mode"),
    [(False, "hosted_product"), (True, "self_managed"), (True, "")],
)
def test_init_refuses_wrong_enabled_or_telemetry_mode(
    monkeypatch: pytest.MonkeyPatch, enabled: bool, telemetry_mode: str
) -> None:
    recorder = _init(monkeypatch, enabled=enabled, telemetry_mode=telemetry_mode)
    assert recorder.kwargs == {}
    assert sentry_client._sentry_initialized is False

def test_init_noops_without_a_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _InitRecorder()
    monkeypatch.setattr(settings, "sentry_dsn", "")
    monkeypatch.setattr(sentry_client, "_sentry_initialized", False)
    monkeypatch.setattr(sentry_client, "sentry_sdk", recorder)
    sentry_integration.init_server_sentry(
        enabled=True, telemetry_mode="hosted_product",
        release_resolver=lambda: "proliferate-server@0.3.27+3c2bbf20e215",
    )
    assert recorder.kwargs == {}

class _RecordingTransport(Transport):
    """Test-owned in-memory transport: no network, no provider, no credential."""

    def __init__(self) -> None:
        super().__init__()
        self.envelopes: list[Any] = []

    def capture_envelope(self, envelope: Any) -> None:
        self.envelopes.append(envelope)

def _real_client(monkeypatch: pytest.MonkeyPatch, **overrides: object):
    import sentry_sdk

    recorder = _init(monkeypatch, **overrides)  # type: ignore[arg-type]
    kwargs = dict(recorder.kwargs)
    kwargs["dsn"] = "https://public@sentry.example/1"
    transport = _RecordingTransport()
    kwargs["transport"] = transport
    return sentry_sdk.Client(**kwargs), transport  # type: ignore[arg-type]

def _capture_error(client: Any, scope: Any, message: str) -> None:
    """Drive the real pinned client seam: serialize, run callbacks, build an envelope."""
    from sentry_sdk.scope import use_isolation_scope
    from sentry_sdk.utils import event_from_exception

    try:
        raise RuntimeError(message)
    except RuntimeError:
        event, hint = event_from_exception(sys.exc_info(), client_options=client.options)
    with use_isolation_scope(scope):
        client.capture_event(event, hint=hint, scope=scope)

def _decoded_items(transport: _RecordingTransport) -> list[tuple[str, object]]:
    items: list[tuple[str, object]] = []
    for envelope in transport.envelopes:
        for item in envelope.items:  # type: ignore[attr-defined]
            items.append((item.type, item.payload.json))
    return items

def test_real_client_drops_attachments_and_empty_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import sentry_sdk

    monkeypatch.setenv("SENTRY_RELEASE", "proliferate-server@9.9.9+deadbeefcafe")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    client, transport = _real_client(monkeypatch, release="", environment="")

    assert client.options["release"] == ""
    assert client.options["environment"] == ""

    scope = sentry_sdk.Scope(ty=sentry_sdk.scope.ScopeType.ISOLATION, client=client)
    scope.add_attachment(
        bytes=b"ATTACHMENT_SENTINEL_do_not_ship", filename="secret.txt", add_to_transactions=True
    )
    seen: list[dict[str, Any]] = []

    def _observe(event: Any, hint: Any) -> Any:
        assert type(hint) is dict and hint["attachments"]
        seen.append(hint)
        return event

    scope.add_event_processor(_observe)
    _capture_error(client, scope, "PROVIDER_RESPONSE_SENTINEL_do_not_ship")

    assert len(seen) == 1
    assert seen[0]["attachments"] == []
    items = _decoded_items(transport)
    assert [item_type for item_type, _ in items] == ["event"]
    payload = items[0][1]
    assert "release" not in payload
    assert "environment" not in payload
    assert "ATTACHMENT_SENTINEL_do_not_ship" not in json.dumps(payload, sort_keys=True)
    assert "PROVIDER_RESPONSE_SENTINEL_do_not_ship" not in json.dumps(payload, sort_keys=True)

def test_real_client_transaction_drops_its_eligible_attachment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import sentry_sdk

    monkeypatch.setenv("SENTRY_RELEASE", "proliferate-server@9.9.9+deadbeefcafe")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    client, transport = _real_client(monkeypatch, release="", environment="")
    scope = sentry_sdk.Scope(ty=sentry_sdk.scope.ScopeType.ISOLATION, client=client)
    scope.add_attachment(
        bytes=b"TXN_ATTACHMENT_SENTINEL_do_not_ship",
        filename="txn.txt",
        add_to_transactions=True,
    )
    assert scope._attachments[0].add_to_transactions is True

    trace = {"trace_id": "0123456789abcdef0123456789abcdef", "span_id": "0123456789abcdef",
             "op": "http.server"}
    transaction = {
        "type": "transaction", "start_timestamp": 1755600000.0, "timestamp": 1755600001.0,
        "transaction": "proliferate.server.billing.api.create_checkout",
        "transaction_info": {"source": "component"},
        "contexts": {"trace": trace}, "spans": [],
    }
    seen: list[dict[str, Any]] = []

    def _observe(event: Any, hint: Any) -> Any:
        assert type(hint) is dict
        assert hint["attachments"]
        seen.append(hint)
        return event

    scope.add_event_processor(_observe)
    from sentry_sdk.scope import use_isolation_scope

    with use_isolation_scope(scope):
        client.capture_event(transaction, hint={}, scope=scope)

    assert len(seen) == 1
    assert seen[0]["attachments"] == []
    items = _decoded_items(transport)
    assert [item_type for item_type, _ in items] == ["transaction"]
    payload = items[0][1]
    assert "release" not in payload and "environment" not in payload
    assert "TXN_ATTACHMENT_SENTINEL_do_not_ship" not in json.dumps(payload, sort_keys=True)

@pytest.mark.parametrize("environment", ["trusted-beta", "staging", "production", "Production"])
def test_real_client_preserves_valid_identity_over_hostile_ambient_values(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    import sentry_sdk

    monkeypatch.setenv("SENTRY_RELEASE", "proliferate-server@9.9.9+deadbeefcafe")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    release = "proliferate-server@1.2.3+0123456789ab"
    client, transport = _real_client(monkeypatch, release=release, environment=environment)

    assert client.options["release"] == release
    assert client.options["environment"] == environment

    scope = sentry_sdk.Scope(ty=sentry_sdk.scope.ScopeType.ISOLATION, client=client)
    _capture_error(client, scope, "boom")

    payload = _decoded_items(transport)[0][1]
    assert payload["release"] == release
    assert payload["environment"] == environment
    json.dumps(payload, sort_keys=True)

def test_api_composition_injects_lazy_release_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    configured = "proliferate-server@0.3.27+3c2bbf20e215"

    def fake_init_server_sentry(
        *,
        enabled: bool,
        telemetry_mode: str,
        release_resolver: Callable[[], str],
    ) -> None:
        captured.update(
            enabled=enabled,
            telemetry_mode=telemetry_mode,
            release=release_resolver(),
        )

    monkeypatch.setattr(server_main, "configure_server_logging", lambda: None)
    monkeypatch.setattr(server_main, "is_vendor_telemetry_enabled", lambda: True)
    monkeypatch.setattr(server_main, "get_server_telemetry_mode", lambda: "hosted_product")
    monkeypatch.setattr(
        server_main,
        "resolve_server_release_id",
        lambda value: f"resolved:{value}",
    )
    monkeypatch.setattr(server_main, "init_server_sentry", fake_init_server_sentry)
    monkeypatch.setattr(settings, "sentry_release", configured)

    server_main.create_app()

    assert captured == {
        "enabled": True,
        "telemetry_mode": "hosted_product",
        "release": f"resolved:{configured}",
    }
# fmt: on
