from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from proliferate.config import settings
from proliferate.server.cloud.runtime.bootstrap import resolve_local_runtime_binary_path
from tests.e2e.cloud.helpers.shared import (
    CloudE2ETestError,
    CloudTestConfig,
    DEFAULT_E2B_WEBHOOK_URL,
    DEFAULT_GITHUB_BASE_BRANCH,
    DEFAULT_GITHUB_OWNER,
    DEFAULT_GITHUB_REPO,
    DEFAULT_SERVER_BASE_URL,
    REPO_ROOT,
    SERVER_ROOT,
)

_CLOUD_RUNTIME_BINARY_READY = False


def ensure_cloud_runtime_binary_ready() -> Path:
    global _CLOUD_RUNTIME_BINARY_READY
    if _CLOUD_RUNTIME_BINARY_READY:
        return resolve_local_runtime_binary_path()

    explicit_binary_path = settings.cloud_runtime_source_binary_path.strip()
    if explicit_binary_path:
        path = Path(explicit_binary_path).expanduser()
        if not path.is_file():
            raise CloudE2ETestError(f"CLOUD_RUNTIME_SOURCE_BINARY_PATH does not exist: {path}")
        _CLOUD_RUNTIME_BINARY_READY = True
        return path

    build_command = build_linux_runtime_command()
    if build_command is None:
        raise CloudE2ETestError(
            "Unable to build the AnyHarness Linux runtime binary for cloud tests. "
            "Install cargo-zigbuild or set CLOUD_RUNTIME_SOURCE_BINARY_PATH."
        )

    try:
        subprocess.run(build_command, cwd=REPO_ROOT, check=True)
    except subprocess.CalledProcessError as exc:
        raise CloudE2ETestError(
            f"Failed to build the AnyHarness Linux runtime binary: exit code {exc.returncode}"
        ) from exc

    path = resolve_local_runtime_binary_path()
    _CLOUD_RUNTIME_BINARY_READY = True
    return path


def build_linux_runtime_command() -> list[str] | None:
    if shutil.which("cargo-zigbuild"):
        return [
            "cargo",
            "zigbuild",
            "--release",
            "--target",
            "x86_64-unknown-linux-musl",
            "-p",
            "anyharness",
        ]
    if sys.platform.startswith("linux") and shutil.which("cargo"):
        return [
            "cargo",
            "build",
            "--release",
            "--target",
            "x86_64-unknown-linux-musl",
            "-p",
            "anyharness",
        ]
    return None


def load_cloud_test_config() -> CloudTestConfig:
    return CloudTestConfig(
        run_cloud_e2e=env_flag("RUN_CLOUD_E2E"),
        run_live_e2b_webhook=env_flag("RUN_LIVE_E2B_WEBHOOK"),
        server_base_url=os.environ.get(
            "PROLIFERATE_CLOUD_TEST_BASE_URL",
            DEFAULT_SERVER_BASE_URL,
        ),
        e2b_webhook_public_url=os.environ.get(
            "E2B_WEBHOOK_PUBLIC_URL",
            DEFAULT_E2B_WEBHOOK_URL,
        ),
        github_owner=os.environ.get("CLOUD_TEST_GITHUB_OWNER", DEFAULT_GITHUB_OWNER),
        github_repo=os.environ.get("CLOUD_TEST_GITHUB_REPO", DEFAULT_GITHUB_REPO),
        github_base_branch=os.environ.get(
            "CLOUD_TEST_GITHUB_BASE_BRANCH",
            DEFAULT_GITHUB_BASE_BRANCH,
        ),
        github_token=discover_github_token(),
        anthropic_api_key=discover_secret("ANTHROPIC_API_KEY"),
        e2b_api_key=discover_secret("E2B_API_KEY"),
        e2b_template_name=discover_secret("E2B_TEMPLATE_NAME"),
        e2b_webhook_signature_secret=discover_secret("E2B_WEBHOOK_SIGNATURE_SECRET"),
        daytona_api_key=discover_secret("DAYTONA_API_KEY"),
        daytona_server_url=discover_secret("DAYTONA_SERVER_URL") or settings.daytona_server_url,
        daytona_target=discover_secret("DAYTONA_TARGET") or settings.daytona_target,
        claude_auth_path=discover_existing_path(
            [
                Path.home() / ".claude.json",
                Path.home() / ".claude" / ".credentials.json",
            ]
        ),
        codex_auth_path=discover_existing_path(
            [
                Path.home() / ".codex" / "auth.json",
                Path.home() / ".config" / "codex" / "auth.json",
            ]
        ),
    )


def ensure_provider_available(config: CloudTestConfig, provider_kind: str) -> None:
    if not config.run_cloud_e2e:
        raise CloudE2ETestError("RUN_CLOUD_E2E=1 is required for live cloud lifecycle tests.")
    if provider_kind == "e2b" and not config.e2b_api_key:
        raise CloudE2ETestError("E2B_API_KEY is required for E2B cloud tests.")
    if provider_kind == "daytona" and not config.daytona_api_key:
        raise CloudE2ETestError("DAYTONA_API_KEY is required for Daytona cloud tests.")
    if not config.github_token:
        raise CloudE2ETestError(
            "GitHub access is required. Authenticate with `gh auth login` or set GH_TOKEN."
        )


def runtime_workdir_for_provider(provider_kind: str) -> str:
    if provider_kind == "daytona":
        return "/home/daytona/workspace"
    return "/home/user/workspace"


def configure_cloud_settings_for_provider(
    monkeypatch: Any,
    config: CloudTestConfig,
    provider_kind: str,
) -> None:
    monkeypatch.setattr(settings, "cloud_billing_mode", "off")
    monkeypatch.setattr(settings, "sandbox_provider", provider_kind)
    monkeypatch.setattr(settings, "e2b_api_key", config.e2b_api_key or "")
    monkeypatch.setattr(settings, "e2b_template_name", config.e2b_template_name or "")
    monkeypatch.setattr(
        settings,
        "e2b_webhook_signature_secret",
        config.e2b_webhook_signature_secret or "",
    )
    monkeypatch.setattr(settings, "daytona_api_key", config.daytona_api_key or "")
    monkeypatch.setattr(settings, "daytona_server_url", config.daytona_server_url)
    monkeypatch.setattr(settings, "daytona_target", config.daytona_target)


def env_flag(name: str) -> bool:
    raw = os.environ.get(name, "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def discover_secret(name: str) -> str | None:
    value = os.environ.get(name)
    if value and value.strip():
        return value.strip().strip('"')
    for env_file in candidate_env_files():
        if not env_file.exists():
            continue
        value = read_env_file_value(env_file, name)
        if value:
            return value
    return None


def candidate_env_files() -> Iterator[Path]:
    yield REPO_ROOT / ".env.cloud.local"
    yield REPO_ROOT / ".env.local"
    yield SERVER_ROOT / ".env.local"
    yield SERVER_ROOT / ".env"


def read_env_file_value(env_file: Path, key: str) -> str | None:
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        candidate_key, raw_value = stripped.split("=", 1)
        if candidate_key.strip() != key:
            continue
        return raw_value.strip().strip('"').strip("'")
    return None


def discover_existing_path(candidates: list[Path]) -> Path | None:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def discover_github_token() -> str | None:
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(name)
        if value and value.strip():
            return value.strip()
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            check=True,
            text=True,
            cwd=str(REPO_ROOT),
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    token = result.stdout.strip()
    return token or None


def claude_relative_path(path: Path) -> str:
    if path.name == ".claude.json":
        return ".claude.json"
    return ".claude/.credentials.json"


def read_file_as_base64(path: Path) -> str:
    import base64

    return base64.b64encode(path.read_bytes()).decode("ascii")
