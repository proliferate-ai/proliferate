#!/usr/bin/env python3
"""Run a local Cloud -> SSH Proliferate Worker smoke test."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = REPO_ROOT / "server"
INSTALLER_PATH = REPO_ROOT / "install" / "proliferate-target-install.sh"
TARGET_TRIPLE = "x86_64-unknown-linux-musl"
REMOTE_BIN_DIR = "/tmp/proliferate-ssh-worker-smoke-bin"
DEFAULT_REMOTE_HOME = "~/.proliferate-ssh-worker-smoke"
DEFAULT_SERVICE_NAME = "proliferate-target-smoke"


class SmokeError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-target", default=os.environ.get("SSH_TARGET"))
    parser.add_argument("--ssh-key", default=os.environ.get("SSH_KEY"))
    parser.add_argument(
        "--api-port",
        type=int,
        default=int(os.environ.get("CLOUD_SSH_WORKER_API_PORT", "8044")),
    )
    parser.add_argument(
        "--db-name",
        default=os.environ.get(
            "CLOUD_SSH_WORKER_DB", "proliferate_dev_ssh_worker_smoke"
        ),
    )
    parser.add_argument(
        "--remote-home",
        default=os.environ.get("CLOUD_SSH_WORKER_REMOTE_HOME", DEFAULT_REMOTE_HOME),
    )
    parser.add_argument(
        "--service-name",
        default=os.environ.get("CLOUD_SSH_WORKER_SERVICE_NAME", DEFAULT_SERVICE_NAME),
    )
    parser.add_argument("--ngrok-url", default=os.environ.get("NGROK_URL"))
    parser.add_argument(
        "--skip-build",
        action="store_true",
        default=env_flag("CLOUD_SSH_WORKER_SKIP_BUILD"),
    )
    parser.add_argument(
        "--keep-running",
        action="store_true",
        default=env_flag("CLOUD_SSH_WORKER_KEEP_RUNNING"),
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        default=env_flag("CLOUD_SSH_WORKER_NO_CLEANUP"),
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=float(os.environ.get("CLOUD_SSH_WORKER_TIMEOUT_SECONDS", "90")),
    )
    parser.add_argument(
        "--local-pg-host", default=os.environ.get("LOCAL_PGHOST", "127.0.0.1")
    )
    parser.add_argument(
        "--local-pg-port", default=os.environ.get("LOCAL_PGPORT", "5432")
    )
    parser.add_argument(
        "--local-pg-user", default=os.environ.get("LOCAL_PGUSER", "proliferate")
    )
    parser.add_argument(
        "--local-pg-password", default=os.environ.get("LOCAL_PGPASSWORD", "localdev")
    )
    return parser.parse_args()


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def log(message: str) -> None:
    print(f"[ssh-worker-smoke] {message}", flush=True)


def run(
    command: list[str],
    *,
    cwd: Path = REPO_ROOT,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
    capture: bool = False,
    display: str | None = None,
) -> subprocess.CompletedProcess[str]:
    log(display or " ".join(command))
    return subprocess.run(
        command,
        cwd=str(cwd),
        env=env,
        input=input_text,
        text=True,
        check=True,
        capture_output=capture,
    )


def require_executable(name: str) -> None:
    if shutil.which(name) is None:
        raise SmokeError(f"{name} is required for this smoke test.")


def pg_env(args: argparse.Namespace) -> dict[str, str]:
    env = os.environ.copy()
    env["PGPASSWORD"] = args.local_pg_password
    return env


def database_url(args: argparse.Namespace) -> str:
    return (
        f"postgresql+asyncpg://{args.local_pg_user}:{args.local_pg_password}"
        f"@{args.local_pg_host}:{args.local_pg_port}/{args.db_name}"
    )


def reset_database(args: argparse.Namespace) -> None:
    env = pg_env(args)
    common = [
        "-h",
        args.local_pg_host,
        "-p",
        args.local_pg_port,
        "-U",
        args.local_pg_user,
    ]
    run(["dropdb", *common, "--if-exists", args.db_name], env=env)
    run(["createdb", *common, args.db_name], env=env)
    run(
        [
            "psql",
            *common,
            "-d",
            args.db_name,
            "-c",
            "CREATE SCHEMA IF NOT EXISTS public; GRANT ALL ON SCHEMA public TO proliferate;",
        ],
        env=env,
    )
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url(args)
    run(
        [str(SERVER_DIR / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        cwd=SERVER_DIR,
        env=env,
    )


def build_binaries(skip_build: bool) -> None:
    if not skip_build:
        run(
            [
                "cargo",
                "zigbuild",
                "--release",
                "--target",
                TARGET_TRIPLE,
                "-p",
                "anyharness",
                "-p",
                "proliferate-worker",
                "-p",
                "proliferate-supervisor",
            ]
        )
    for name in ("anyharness", "proliferate-worker", "proliferate-supervisor"):
        path = REPO_ROOT / "target" / TARGET_TRIPLE / "release" / name
        if not path.exists():
            raise SmokeError(
                f"Missing {path}; rerun without CLOUD_SSH_WORKER_SKIP_BUILD=1."
            )


def ssh_base(args: argparse.Namespace) -> list[str]:
    if not args.ssh_target:
        raise SmokeError(
            "SSH_TARGET is required, for example SSH_TARGET=ubuntu@44.247.206.119."
        )
    command = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=2",
    ]
    if args.ssh_key:
        command.extend(["-i", args.ssh_key])
    command.append(args.ssh_target)
    return command


def scp_base(args: argparse.Namespace) -> list[str]:
    command = [
        "scp",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
    ]
    if args.ssh_key:
        command.extend(["-i", args.ssh_key])
    return command


def remote_cleanup(args: argparse.Namespace) -> None:
    script = f"""
set -eu
run_bounded() {{
  if command -v timeout >/dev/null 2>&1; then
    timeout 10s "$@"
  else
    "$@"
  fi
}}
run_bounded systemctl --user kill {shell_quote(args.service_name)}.service 2>/dev/null || true
run_bounded systemctl --user stop {shell_quote(args.service_name)}.service 2>/dev/null || true
run_bounded systemctl --user disable {shell_quote(args.service_name)}.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/{args.service_name}.service"
run_bounded systemctl --user daemon-reload 2>/dev/null || true
run_bounded systemctl --user reset-failed \\
  {shell_quote(args.service_name)}.service 2>/dev/null || true
rm -rf {remote_path_expr(args.remote_home)}
rm -rf {shell_quote(args.remote_home)}
"""
    run([*ssh_base(args), script])


def stage_remote_binaries(args: argparse.Namespace) -> None:
    run([*ssh_base(args), f"mkdir -p {shell_quote(REMOTE_BIN_DIR)}"])
    binary_paths = [
        str(REPO_ROOT / "target" / TARGET_TRIPLE / "release" / name)
        for name in ("anyharness", "proliferate-worker", "proliferate-supervisor")
    ]
    run([*scp_base(args), *binary_paths, f"{args.ssh_target}:{REMOTE_BIN_DIR}/"])
    run([*ssh_base(args), f"chmod +x {shell_quote(REMOTE_BIN_DIR)}/*"])


def check_ssh_target(args: argparse.Namespace) -> None:
    try:
        run([*ssh_base(args), "true"], display="ssh target <reachability check>")
    except subprocess.CalledProcessError as error:
        raise SmokeError(
            f"SSH target {args.ssh_target} is not reachable. Check the host, key, "
            "security group/firewall, or whether the target is running."
        ) from error


def start_ngrok(args: argparse.Namespace) -> tuple[str, subprocess.Popen[str] | None]:
    if args.ngrok_url:
        log(f"using supplied ngrok url {args.ngrok_url}")
        return args.ngrok_url.rstrip("/"), None
    process = subprocess.Popen(
        ["ngrok", "http", str(args.api_port), "--log=stdout"],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    deadline = time.monotonic() + 30
    url_pattern = re.compile(r"url=(https://\S+)")
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if line:
            print(line.rstrip(), flush=True)
            match = url_pattern.search(line)
            if match:
                return match.group(1).rstrip("/"), process
        if process.poll() is not None:
            raise SmokeError("ngrok exited before exposing a URL.")
    raise SmokeError("Timed out waiting for ngrok URL.")


def start_api(args: argparse.Namespace, public_url: str) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url(args)
    env["API_BASE_URL"] = public_url
    env["DEBUG"] = "true"
    env["PROLIFERATE_TARGET_INSTALLER_URL"] = (
        f"https://raw.githubusercontent.com/proliferate-ai/proliferate/"
        f"{current_git_ref()}/install/proliferate-target-install.sh"
    )
    return subprocess.Popen(
        [
            str(SERVER_DIR / ".venv" / "bin" / "uvicorn"),
            "proliferate.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.api_port),
        ],
        cwd=str(SERVER_DIR),
        env=env,
    )


def wait_for_health(args: argparse.Namespace) -> None:
    deadline = time.monotonic() + 30
    url = f"http://127.0.0.1:{args.api_port}/health"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.5)
    raise SmokeError(f"Timed out waiting for {url}.")


def current_git_ref() -> str:
    completed = run(["git", "rev-parse", "HEAD"], capture=True)
    return completed.stdout.strip()


def mint_user_token(args: argparse.Namespace) -> tuple[str, str]:
    snippet = r"""
import asyncio
import uuid
from proliferate.auth.models import UserCreate
from proliferate.auth.users import UserManager, get_user_db
from proliferate.auth.jwt import get_jwt_strategy
from proliferate.db.engine import async_session_factory

async def main():
    async with async_session_factory() as db:
        async for user_db in get_user_db(db):
            manager = UserManager(user_db)
            user = await manager.create(UserCreate(
                email=f"ssh-worker-smoke-{uuid.uuid4().hex[:8]}@example.com",
                password=uuid.uuid4().hex + uuid.uuid4().hex,
                display_name="SSH Worker Smoke",
            ))
            await db.commit()
            print(str(user.id))
            print(await get_jwt_strategy().write_token(user))
            return

asyncio.run(main())
"""
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url(args)
    completed = run(
        [str(SERVER_DIR / ".venv" / "bin" / "python"), "-c", snippet],
        cwd=SERVER_DIR,
        env=env,
        capture=True,
    )
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if len(lines) < 2:
        raise SmokeError("Could not mint local auth token.")
    return lines[-2], lines[-1]


def request_json(
    url: str,
    *,
    method: str = "GET",
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise SmokeError(
            f"{method} {url} failed {error.code}: {error.read().decode('utf-8')}"
        ) from error


def create_enrollment(args: argparse.Namespace, token: str) -> dict[str, Any]:
    return request_json(
        f"http://127.0.0.1:{args.api_port}/v1/cloud/targets/enrollments",
        method="POST",
        token=token,
        body={
            "displayName": "SSH Worker Smoke Target",
            "kind": "ssh",
            "ownerScope": "personal",
            "defaultWorkspaceRoot": "~/proliferate-workspaces",
            "ttlSeconds": 3600,
        },
    )


def run_installer(
    args: argparse.Namespace, public_url: str, enrollment_token: str
) -> None:
    installer = INSTALLER_PATH.read_text()
    script = f"""
set -eu
PATH={shell_quote(REMOTE_BIN_DIR)}:$PATH \\
PROLIFERATE_HOME={remote_path_expr(args.remote_home)} \\
PROLIFERATE_SERVICE_NAME={shell_quote(args.service_name)} \\
PROLIFERATE_CLOUD_URL={shell_quote(public_url)} \\
PROLIFERATE_ENROLLMENT_TOKEN={shell_quote(enrollment_token)} \\
sh -s
"""
    run(
        [*ssh_base(args), script],
        input_text=installer,
        display="ssh target <run installer>",
    )


def wait_for_target(
    args: argparse.Namespace, token: str, target_id: str
) -> dict[str, Any]:
    deadline = time.monotonic() + args.timeout_seconds
    url = f"http://127.0.0.1:{args.api_port}/v1/cloud/targets/{target_id}"
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = request_json(url, token=token)
        versions = last.get("update", {}).get("currentVersions") or {}
        if (
            last.get("status") == "online"
            and versions.get("anyharnessVersion")
            and versions.get("workerVersion")
            and versions.get("supervisorVersion")
        ):
            return last
        time.sleep(2)
    raise SmokeError(
        f"Target did not become command-capable. Last payload: {json.dumps(last, indent=2)}"
    )


def assert_remote_logs(args: argparse.Namespace) -> None:
    completed = run(
        [
            *ssh_base(args),
            (
                f"journalctl --user -u {shell_quote(args.service_name)}.service "
                "--since '2 minutes ago' --no-pager | tail -120"
            ),
        ],
        capture=True,
    )
    logs = completed.stdout
    print(logs, flush=True)
    if "anyharness health probe completed healthy=true" not in logs:
        raise SmokeError("Worker did not log a healthy AnyHarness probe.")
    if (
        "materialization-only mode because anyharness_base_url is not configured"
        in logs
    ):
        raise SmokeError("Worker command loop still lacks anyharness_base_url.")
    if (
        "worker event sync disabled because anyharness_base_url is not configured"
        in logs
    ):
        raise SmokeError("Worker event sync still lacks anyharness_base_url.")


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def remote_path_expr(path: str) -> str:
    if path == "~":
        return '"$HOME"'
    if path.startswith("~/"):
        return '"$HOME"' + shell_quote(path[1:])
    return shell_quote(path)


def validate_service_name(service_name: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.@-]+", service_name):
        raise SmokeError(
            "CLOUD_SSH_WORKER_SERVICE_NAME must be a simple systemd unit name."
        )


def stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    args = parse_args()
    validate_service_name(args.service_name)
    api_process: subprocess.Popen[str] | None = None
    ngrok_process: subprocess.Popen[str] | None = None
    remote_installed = False
    try:
        for executable in (
            "cargo",
            "cargo-zigbuild",
            "dropdb",
            "createdb",
            "psql",
            "ssh",
            "scp",
        ):
            require_executable(executable)
        if not args.ngrok_url:
            require_executable("ngrok")
        if not (SERVER_DIR / ".venv" / "bin" / "uvicorn").exists():
            raise SmokeError(
                "server/.venv is missing. Run `make server-install` first."
            )
        check_ssh_target(args)
        reset_database(args)
        build_binaries(args.skip_build)
        remote_cleanup(args)
        stage_remote_binaries(args)
        public_url, ngrok_process = start_ngrok(args)
        api_process = start_api(args, public_url)
        wait_for_health(args)
        _user_id, auth_token = mint_user_token(args)
        enrollment = create_enrollment(args, auth_token)
        target_id = enrollment["target"]["id"]
        log(f"target_id={target_id}")
        log(f"cloud_url={public_url}")
        remote_installed = True
        run_installer(args, public_url, enrollment["enrollmentToken"])
        target = wait_for_target(args, auth_token, target_id)
        assert_remote_logs(args)
        log("smoke passed")
        print(
            json.dumps(
                {
                    "cloudUrl": public_url,
                    "targetId": target_id,
                    "status": target["status"],
                    "inventory": target["inventory"],
                    "currentVersions": target["update"]["currentVersions"],
                },
                indent=2,
            ),
            flush=True,
        )
        if args.keep_running:
            log(
                "keeping local API/ngrok and remote service running. Press Ctrl-C to clean up."
            )
            while True:
                time.sleep(3600)
        return 0
    except KeyboardInterrupt:
        log("interrupted")
        return 130
    except (SmokeError, subprocess.CalledProcessError) as error:
        print(f"[ssh-worker-smoke] ERROR: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        if not args.no_cleanup and remote_installed:
            try:
                remote_cleanup(args)
            except Exception as error:  # noqa: BLE001 - cleanup best effort
                print(f"[ssh-worker-smoke] cleanup warning: {error}", file=sys.stderr)
        if not args.no_cleanup:
            stop_process(api_process)
            stop_process(ngrok_process)


if __name__ == "__main__":
    raise SystemExit(main())
