import httpx
import pytest
from e2b import exceptions as e2b_exceptions

from proliferate.integrations.sandbox import e2b as e2b_runtime


class _FakeSandboxInstance:
    sandbox_id = "sandbox-123"

    def get_host(self, port: int) -> str:
        return f"sandbox.example:{port}"


def test_create_sandbox_prefers_timeout_ms(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeSandbox:
        @staticmethod
        def create(template_name: str, **kwargs):
            captured["template_name"] = template_name
            captured["kwargs"] = kwargs
            return _FakeSandboxInstance()

    monkeypatch.setattr(e2b_runtime, "_load_sdk", lambda: FakeSandbox)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")
    # Empty template only falls back to the built-in default in debug/dev.
    monkeypatch.setattr(e2b_runtime.settings, "debug", True)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_template_name", "")

    provider = e2b_runtime.E2BSandboxProvider()
    handle = provider._create_sandbox(None)

    assert handle.sandbox_id == "sandbox-123"
    assert handle.provider == "e2b"
    assert handle.template_version == e2b_runtime.E2B_TEMPLATE_VERSION
    assert provider.runtime_endpoint_handles_cors is False
    assert provider._resolve_runtime_endpoint(_FakeSandboxInstance()).runtime_url == (
        f"https://sandbox.example:{e2b_runtime.E2B_RUNTIME_PORT}"
    )
    assert captured["template_name"] == e2b_runtime.E2B_TEMPLATE_NAME
    assert captured["kwargs"] == {
        "api_key": "e2b_test_key",
        "metadata": {},
        "lifecycle": {
            "on_timeout": "pause",
            "auto_resume": True,
        },
        "timeout": e2b_runtime.E2B_TIMEOUT_SECONDS,
    }


def test_create_sandbox_falls_back_to_timeout_ms(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class LegacySandbox:
        @staticmethod
        def create(template_name: str, **kwargs):
            if "timeout" in kwargs:
                raise TypeError("modern signature unsupported")
            captured["template_name"] = template_name
            captured["kwargs"] = kwargs
            return _FakeSandboxInstance()

    monkeypatch.setattr(e2b_runtime, "_load_sdk", lambda: LegacySandbox)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")
    # Empty template only falls back to the built-in default in debug/dev.
    monkeypatch.setattr(e2b_runtime.settings, "debug", True)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_template_name", "")

    provider = e2b_runtime.E2BSandboxProvider()
    handle = provider._create_sandbox(None)

    assert handle.sandbox_id == "sandbox-123"
    assert handle.provider == "e2b"
    assert handle.template_version == e2b_runtime.E2B_TEMPLATE_VERSION
    assert provider._resolve_runtime_endpoint(_FakeSandboxInstance()).runtime_url == (
        f"https://sandbox.example:{e2b_runtime.E2B_RUNTIME_PORT}"
    )
    assert captured["template_name"] == e2b_runtime.E2B_TEMPLATE_NAME
    assert captured["kwargs"] == {
        "api_key": "e2b_test_key",
        "metadata": {},
        "lifecycle": {
            "on_timeout": "pause",
            "auto_resume": True,
        },
        "timeoutMs": e2b_runtime.E2B_TIMEOUT_SECONDS * 1000,
    }


def test_create_sandbox_preserves_namespaced_tagged_template_ref(monkeypatch) -> None:
    captured: dict[str, object] = {}
    template_ref = "team-slug/proliferate-runtime-cloud:production"

    class FakeSandbox:
        @staticmethod
        def create(template_name: str, **kwargs):
            captured["template_name"] = template_name
            captured["kwargs"] = kwargs
            return _FakeSandboxInstance()

    monkeypatch.setattr(e2b_runtime, "_load_sdk", lambda: FakeSandbox)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")
    monkeypatch.setattr(e2b_runtime.settings, "e2b_template_name", template_ref)

    handle = e2b_runtime.E2BSandboxProvider()._create_sandbox(None)

    assert handle.sandbox_id == "sandbox-123"
    assert captured["template_name"] == template_ref
    assert captured["kwargs"] == {
        "api_key": "e2b_test_key",
        "metadata": {},
        "lifecycle": {
            "on_timeout": "pause",
            "auto_resume": True,
        },
        "timeout": e2b_runtime.E2B_TIMEOUT_SECONDS,
    }


def test_connect_prefers_timeout_seconds(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeSandbox:
        @staticmethod
        def connect(sandbox_id: str, **kwargs):
            captured["sandbox_id"] = sandbox_id
            captured["kwargs"] = kwargs
            return {"sandbox_id": sandbox_id}

    monkeypatch.setattr(e2b_runtime, "_load_sdk", lambda: FakeSandbox)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")

    result = e2b_runtime.E2BSandboxProvider()._connect("sandbox-123", 45)

    assert result == {"sandbox_id": "sandbox-123"}
    assert captured["sandbox_id"] == "sandbox-123"
    assert captured["kwargs"] == {
        "api_key": "e2b_test_key",
        "timeout": 45,
    }


def test_connect_defaults_to_cloud_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeSandbox:
        @staticmethod
        def connect(sandbox_id: str, **kwargs):
            captured["sandbox_id"] = sandbox_id
            captured["kwargs"] = kwargs
            return {"sandbox_id": sandbox_id}

    monkeypatch.setattr(e2b_runtime, "_load_sdk", lambda: FakeSandbox)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")

    result = e2b_runtime.E2BSandboxProvider()._connect("sandbox-123")

    assert result == {"sandbox_id": "sandbox-123"}
    assert captured["sandbox_id"] == "sandbox-123"
    assert captured["kwargs"] == {
        "api_key": "e2b_test_key",
        "timeout": e2b_runtime.E2B_TIMEOUT_SECONDS,
    }


def test_pause_sandbox_uses_pause_method(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeSandbox:
        @staticmethod
        def pause(sandbox_id: str, **kwargs):
            captured["sandbox_id"] = sandbox_id
            captured["kwargs"] = kwargs
            captured["paused"] = True

    monkeypatch.setattr(e2b_runtime, "_load_sdk", lambda: FakeSandbox)
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")

    e2b_runtime.E2BSandboxProvider()._pause_sandbox("sandbox-123")

    assert captured["sandbox_id"] == "sandbox-123"
    assert captured["kwargs"] == {"api_key": "e2b_test_key"}
    assert captured["paused"] is True


def test_run_command_prefers_timeout_seconds(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeCommands:
        @staticmethod
        def run(command: str, **kwargs):
            captured["command"] = command
            captured["kwargs"] = kwargs
            return {"ok": True}

    class FakeSandbox:
        commands = FakeCommands()

    result = e2b_runtime.E2BSandboxProvider()._run_command(
        FakeSandbox(),
        "echo hi",
        "root",
        None,
        None,
        False,
        45,
    )

    assert result == {"ok": True}
    assert captured["command"] == "echo hi"
    assert captured["kwargs"] == {"user": "root", "timeout": 45}


def test_run_command_falls_back_from_timeout_seconds(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class LegacyCommands:
        @staticmethod
        def run(command: str, **kwargs):
            if "timeout" in kwargs:
                raise TypeError("timeout unsupported")
            if "timeoutMs" in kwargs:
                captured["command"] = command
                captured["kwargs"] = kwargs
                return {"ok": True}
            raise TypeError("missing supported timeout kwarg")

    class FakeSandbox:
        commands = LegacyCommands()

    result = e2b_runtime.E2BSandboxProvider()._run_command(
        FakeSandbox(),
        "echo hi",
        None,
        None,
        None,
        False,
        30,
    )

    assert result == {"ok": True}
    assert captured["command"] == "echo hi"
    assert captured["kwargs"] == {"timeoutMs": 30000}


def test_run_command_passes_background_envs_and_cwd(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeCommands:
        @staticmethod
        def run(command: str, **kwargs):
            captured["command"] = command
            captured["kwargs"] = kwargs
            return {"ok": True}

    class FakeSandbox:
        commands = FakeCommands()

    result = e2b_runtime.E2BSandboxProvider()._run_command(
        FakeSandbox(),
        "echo hi",
        None,
        "/tmp/workspace",
        {"FOO": "bar"},
        True,
        15,
    )

    assert result == {"ok": True}
    assert captured["command"] == "echo hi"
    assert captured["kwargs"] == {
        "cwd": "/tmp/workspace",
        "envs": {"FOO": "bar"},
        "background": True,
        "timeout": 15,
    }


def _mount_list_transport(
    monkeypatch, pages: list[tuple[list[dict], str | None]]
) -> list[httpx.Request]:
    """Serve `pages` (items, next_token) from a mocked httpx transport.

    Returns the captured requests so tests can assert the query params sent.
    """
    monkeypatch.setattr(e2b_runtime.settings, "e2b_api_key", "e2b_test_key")
    requests: list[httpx.Request] = []
    calls = {"n": 0}

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        items, next_token = pages[calls["n"]]
        calls["n"] += 1
        headers = {"x-next-token": next_token} if next_token else {}
        return httpx.Response(200, json=items, headers=headers)

    real_client = httpx.AsyncClient

    def _fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(_handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(e2b_runtime.httpx, "AsyncClient", _fake_client)
    return requests


@pytest.mark.asyncio
async def test_list_sandbox_states_filters_state_and_parses_v2_keys(monkeypatch) -> None:
    # v2 payload uses camelCase `sandboxID`/`startedAt`/`endAt`.
    item = {
        "sandboxID": "sbx-1",
        "state": "paused",
        "startedAt": "2026-07-15T00:00:00Z",
        "endAt": "2026-07-15T01:00:00Z",
        "metadata": {"proliferate_cloud_sandbox_id": "abc"},
    }
    requests = _mount_list_transport(monkeypatch, [([item], None)])

    states = await e2b_runtime.E2BSandboxProvider().list_sandbox_states()

    assert len(states) == 1
    assert states[0].external_sandbox_id == "sbx-1"
    assert states[0].state == "paused"
    assert states[0].started_at is not None
    assert states[0].metadata == {"proliferate_cloud_sandbox_id": "abc"}
    # Hits the v2 endpoint with the running+paused state filter.
    assert requests[0].url.path == "/v2/sandboxes"
    assert requests[0].url.params.get("state") == "running,paused"
    assert requests[0].headers["X-API-KEY"] == "e2b_test_key"


@pytest.mark.asyncio
async def test_list_sandbox_states_paginates_via_next_token_header(monkeypatch) -> None:
    pages = [
        ([{"sandboxID": "sbx-1", "state": "running"}], "token-2"),
        ([{"sandboxID": "sbx-2", "state": "paused"}], None),
    ]
    requests = _mount_list_transport(monkeypatch, pages)

    states = await e2b_runtime.E2BSandboxProvider().list_sandbox_states()

    assert [s.external_sandbox_id for s in states] == ["sbx-1", "sbx-2"]
    # First page carries no token; second page passes it back as nextToken.
    assert "nextToken" not in requests[0].url.params
    assert requests[1].url.params.get("nextToken") == "token-2"


@pytest.mark.asyncio
async def test_list_sandbox_states_bounds_pagination(monkeypatch) -> None:
    # Every page returns a token, so the loop must stop at the page bound.
    infinite = [([{"sandboxID": f"sbx-{i}", "state": "running"}], f"token-{i}") for i in range(60)]
    requests = _mount_list_transport(monkeypatch, infinite)
    warnings: list[str] = []
    monkeypatch.setattr(
        e2b_runtime.logger, "warning", lambda msg, *a, **k: warnings.append(msg % a if a else msg)
    )

    states = await e2b_runtime.E2BSandboxProvider().list_sandbox_states()

    assert len(requests) == e2b_runtime._LIST_SANDBOXES_MAX_PAGES
    assert len(states) == e2b_runtime._LIST_SANDBOXES_MAX_PAGES
    assert warnings and "page bound" in warnings[0]


def test_state_from_payload_accepts_legacy_and_v2_id_keys() -> None:
    assert e2b_runtime._state_from_payload({"sandboxID": "v2"}).external_sandbox_id == "v2"
    assert e2b_runtime._state_from_payload({"sandboxId": "legacy"}).external_sandbox_id == "legacy"
    assert e2b_runtime._state_from_payload({"sandbox_id": "snake"}).external_sandbox_id == "snake"
    assert e2b_runtime._state_from_payload({"id": "bare"}).external_sandbox_id == "bare"
    assert e2b_runtime._state_from_payload({"state": "running"}) is None


def test_resolve_runtime_context_uses_static_e2b_paths() -> None:
    context = e2b_runtime.E2BSandboxProvider()._resolve_runtime_context(object())

    assert context.home_dir == e2b_runtime.E2B_USER_HOME
    assert context.runtime_workdir == e2b_runtime.E2B_RUNTIME_WORKDIR
    assert context.runtime_binary_path == e2b_runtime.E2B_RUNTIME_BINARY_PATH
    assert context.base_env == {"HOME": e2b_runtime.E2B_USER_HOME}


@pytest.mark.parametrize(
    "failure,expected_type",
    [
        (
            e2b_exceptions.AuthenticationException("secret auth detail"),
            e2b_runtime.E2BRuntimeError,
        ),
        (
            e2b_exceptions.RateLimitException("secret rate detail"),
            e2b_runtime.E2BUnavailableError,
        ),
        (
            e2b_exceptions.SandboxNotFoundException("secret target detail"),
            e2b_runtime.E2BTargetUnavailableError,
        ),
        (
            e2b_exceptions.SandboxException("secret provider detail"),
            e2b_runtime.E2BUnavailableError,
        ),
        (
            httpx.ConnectError("secret network detail"),
            e2b_runtime.E2BUnavailableError,
        ),
    ],
)
@pytest.mark.asyncio
async def test_public_provider_boundary_translates_closed_secret_safe_errors(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    expected_type: type[Exception],
) -> None:
    def fail(*_args: object) -> None:
        raise failure

    provider = e2b_runtime.E2BSandboxProvider()
    monkeypatch.setattr(provider, "_connect", fail)

    with pytest.raises(expected_type) as exc_info:
        await provider.resume_sandbox("sandbox-a")

    assert "secret" not in str(exc_info.value)
