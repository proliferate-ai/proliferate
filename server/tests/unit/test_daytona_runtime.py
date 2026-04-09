from proliferate.integrations.sandbox import daytona as daytona_runtime


class _FakeResult:
    def __init__(self, *, exit_code: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr


class _FakeProcess:
    def __init__(self, *, configured_home_exists: bool, effective_home: str) -> None:
        self._configured_home_exists = configured_home_exists
        self._effective_home = effective_home

    def exec(self, command: str, **kwargs):
        del kwargs
        if "printf" in command and "$HOME" in command:
            return _FakeResult(stdout=f"{self._effective_home}\n")
        if command.startswith("test -d "):
            return _FakeResult(exit_code=0 if self._configured_home_exists else 1)
        raise AssertionError(f"Unexpected command: {command}")


class _FakeSandbox:
    def __init__(self, *, configured_home_exists: bool, effective_home: str) -> None:
        self.process = _FakeProcess(
            configured_home_exists=configured_home_exists,
            effective_home=effective_home,
        )


class _FakeConfiguration:
    def __init__(self) -> None:
        self.retries = None


class _FakeRestClient:
    def __init__(self, configuration) -> None:
        self.configuration = configuration


class _FakeGeneratedApiClient:
    def __init__(self) -> None:
        self.configuration = _FakeConfiguration()
        self.rest_client = _FakeRestClient(self.configuration)


class _FakeDaytonaClient:
    def __init__(self) -> None:
        self._api_client = _FakeGeneratedApiClient()
        self._toolbox_api_client = _FakeGeneratedApiClient()


def test_resolve_runtime_context_falls_back_to_effective_home() -> None:
    context = daytona_runtime.DaytonaSandboxProvider()._resolve_runtime_context(
        _FakeSandbox(configured_home_exists=False, effective_home="/root")
    )
    assert daytona_runtime.DaytonaSandboxProvider().runtime_endpoint_handles_cors is True

    assert context.home_dir == "/root"
    assert context.runtime_workdir == "/root/workspace"
    assert context.runtime_binary_path == "/root/anyharness"
    assert context.base_env == {"HOME": "/root"}


def test_resolve_runtime_context_preserves_existing_configured_home() -> None:
    context = daytona_runtime.DaytonaSandboxProvider()._resolve_runtime_context(
        _FakeSandbox(configured_home_exists=True, effective_home="/root")
    )
    assert daytona_runtime.DaytonaSandboxProvider().runtime_endpoint_handles_cors is True

    assert context.home_dir == "/home/daytona"
    assert context.runtime_workdir == "/home/daytona/workspace"
    assert context.runtime_binary_path == "/home/daytona/anyharness"
    assert context.base_env == {"HOME": "/home/daytona"}


def test_normalize_daytona_state_accepts_sdk_enum_string() -> None:
    assert daytona_runtime._normalize_state("SandboxState.STARTED") == "started"
    assert daytona_runtime._normalize_state("STARTED") == "started"


def test_build_daytona_connect_retry_retries_connect_errors_for_any_method() -> None:
    retry = daytona_runtime._build_daytona_connect_retry()

    assert retry.total == 5
    assert retry.connect == 5
    assert retry.read == 0
    assert retry.status == 0
    assert retry.other == 0
    assert retry.allowed_methods is None


def test_configure_daytona_client_connect_retries_updates_main_and_toolbox_clients() -> None:
    client = _FakeDaytonaClient()

    configured = daytona_runtime._configure_daytona_client_connect_retries(client)

    assert configured is client
    assert client._api_client.configuration.retries is not None
    assert client._toolbox_api_client.configuration.retries is not None
    assert isinstance(client._api_client.rest_client, _FakeRestClient)
    assert isinstance(client._toolbox_api_client.rest_client, _FakeRestClient)
    assert client._api_client.rest_client is not None
    assert client._toolbox_api_client.rest_client is not None
