"""Helpers for exercising the embedded hosted Redis deploy preflight."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

EXPECTED_AWS_ACCOUNT_ID = "157466816238"
APP_SECRET_ARN = (
    "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/server-app-Ab12Cd"
)


def marked_shell(run_script: str, marker: str) -> str:
    """Extract one non-empty marker-delimited shell fragment with diagnostics."""

    start_token = f"# {marker}_BEGIN\n"
    end_token = f"\n# {marker}_END"
    start_count = run_script.count(start_token)
    end_count = run_script.count(end_token)
    if start_count != 1 or end_count != 1:
        raise AssertionError(
            f"{marker} requires exactly one begin and end marker; "
            f"found begin={start_count}, end={end_count}"
        )
    start = run_script.index(start_token) + len(start_token)
    end = run_script.index(end_token)
    if end < start:
        raise AssertionError(f"{marker} end marker must follow its begin marker")
    body = run_script[start:end]
    if not body.strip():
        raise AssertionError(f"{marker} delimits an empty shell fragment")
    return body


def _write_dns_override(tmp_path: Path) -> None:
    """Install deterministic getaddrinfo results for the embedded validator."""

    (tmp_path / "sitecustomize.py").write_text(
        """import ipaddress
import os
import socket
import time


def _answer(address, port, sock_type):
    parsed = ipaddress.ip_address(address.split("%", 1)[0])
    family = socket.AF_INET6 if parsed.version == 6 else socket.AF_INET
    sockaddr = (address, port, 0, 0) if parsed.version == 6 else (address, port)
    return (family, sock_type or socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)


def _getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    del family, proto, flags
    answers = {
        "cache.internal": ["10.20.30.40"],
        "loopback.alias": ["127.0.0.1"],
        "unspecified.alias": ["0.0.0.0"],
        "mixed.alias": ["10.20.30.40", "127.0.0.1"],
        "scoped-loopback.alias": ["::1%lo0"],
    }
    if host == "timeout.alias":
        time.sleep(float(os.environ.get("FAKE_DNS_DELAY_SECONDS", "30")))
        return [_answer("10.20.30.40", port, type)]
    if host == "unresolved.alias":
        raise socket.gaierror("synthetic resolution failure")
    if host in answers:
        return [_answer(address, port, type) for address in answers[host]]
    try:
        ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError as exc:
        raise socket.gaierror("unexpected synthetic hostname") from exc
    return [_answer(host, port, type)]


socket.getaddrinfo = _getaddrinfo
"""
    )


def _ensure_timeout_command(tmp_path: Path) -> None:
    """Provide the workflow's GNU-timeout interface on non-GNU dev hosts."""

    if shutil.which("timeout") is not None:
        return
    timeout = tmp_path / "timeout"
    timeout.write_text(
        """#!/usr/bin/env python3
import subprocess
import sys


args = sys.argv[1:]
if len(args) < 4 or args[0] != "--signal=TERM" or not args[1].startswith("--kill-after="):
    raise SystemExit(125)
try:
    kill_after = float(args[1].split("=", 1)[1].removesuffix("s"))
    duration = float(args[2].removesuffix("s"))
except ValueError:
    raise SystemExit(125) from None
process = subprocess.Popen(args[3:])
try:
    raise SystemExit(process.wait(timeout=duration))
except subprocess.TimeoutExpired:
    process.terminate()
    try:
        process.wait(timeout=kill_after)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    raise SystemExit(124) from None
"""
    )
    timeout.chmod(0o755)


def run_redis_preflight(
    tmp_path: Path,
    run_script: str,
    *,
    redis_url: str,
    secret_arn: str = APP_SECRET_ARN,
    aws_stderr: str = "",
    aws_exit: int = 0,
    dns_timeout_seconds: int = 20,
    dns_delay_seconds: int = 30,
    e2b_api_key: str | None = "synthetic-e2b-key",
) -> tuple[subprocess.CompletedProcess[str], str]:
    """Run the exact workflow body against deterministic DNS and fake AWS."""

    _write_dns_override(tmp_path)
    _ensure_timeout_command(tmp_path)
    fake_aws = tmp_path / "aws"
    fake_aws.write_text(
        "#!/bin/sh\n"
        "printf '%s' \"$FAKE_AWS_STDERR\" >&2\n"
        'if [ "$FAKE_AWS_EXIT" -ne 0 ]; then exit "$FAKE_AWS_EXIT"; fi\n'
        "printf '%s\\n' \"$FAKE_AWS_RESPONSE\"\n"
    )
    fake_aws.chmod(0o755)
    script = tmp_path / "preflight.sh"
    script.write_text(run_script)
    github_output = tmp_path / "github-output"
    env = {
        **os.environ,
        "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
        "PYTHONPATH": str(tmp_path),
        "FAKE_AWS_STDERR": aws_stderr,
        "FAKE_AWS_EXIT": str(aws_exit),
        "FAKE_AWS_RESPONSE": json.dumps(
            {
                "ARN": secret_arn,
                "SecretString": json.dumps(
                    {
                        "REDBEAT_REDIS_URL": redis_url,
                        **({} if e2b_api_key is None else {"E2B_API_KEY": e2b_api_key}),
                    }
                ),
            }
        ),
        "AWS_REGION": "us-east-1",
        "EXPECTED_AWS_ACCOUNT_ID": EXPECTED_AWS_ACCOUNT_ID,
        "REDBEAT_REDIS_SECRET_NAME": "proliferate/prod/server-app",
        "REDIS_PREFLIGHT_TIMEOUT_SECONDS": str(dns_timeout_seconds),
        "FAKE_DNS_DELAY_SECONDS": str(dns_delay_seconds),
        "GITHUB_OUTPUT": str(github_output),
    }
    result = subprocess.run(
        ["bash", str(script)], capture_output=True, text=True, env=env, timeout=10
    )
    written_output = github_output.read_text() if github_output.exists() else ""
    return result, written_output
