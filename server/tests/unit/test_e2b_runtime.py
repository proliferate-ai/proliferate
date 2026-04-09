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
            "auto_resume": False,
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
            "auto_resume": False,
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
            "auto_resume": False,
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


def test_resolve_runtime_context_uses_static_e2b_paths() -> None:
    context = e2b_runtime.E2BSandboxProvider()._resolve_runtime_context(object())

    assert context.home_dir == e2b_runtime.E2B_USER_HOME
    assert context.runtime_workdir == e2b_runtime.E2B_RUNTIME_WORKDIR
    assert context.runtime_binary_path == e2b_runtime.E2B_RUNTIME_BINARY_PATH
    assert context.base_env == {"HOME": e2b_runtime.E2B_USER_HOME}
