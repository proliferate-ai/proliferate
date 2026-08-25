"""Redis-preflight contracts in the hosted server deploy workflow.

Split from ``test_e2b_deploy_render.py`` solely to satisfy the repo-shape
600-line source cap (``scripts/check_max_lines.py``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.helpers.hosted_redis_deploy import run_redis_preflight
from tests.integration.test_e2b_deploy_render import (
    _APP_SECRET_ARN,
    _redis_preflight_run,
)


@pytest.mark.parametrize(
    ("redis_url", "accepted"),
    [
        pytest.param("rediss://cache.internal:6379/0", True, id="managed-endpoint"),
        pytest.param("rediss://loopback.alias:6379/0", False, id="dns-loopback"),
        pytest.param("rediss://unspecified.alias:6379/0", False, id="dns-unspecified"),
        pytest.param("rediss://mixed.alias:6379/0", False, id="dns-mixed-answer"),
        pytest.param("rediss://scoped-loopback.alias:6379/0", False, id="dns-scoped-ipv6"),
        pytest.param("rediss://unresolved.alias:6379/0", False, id="dns-unresolved"),
        pytest.param("redis://localhost:6379/0", False, id="localhost"),
        pytest.param("redis://localhost", False, id="localhost-no-boundary"),
        pytest.param("redis://foo.localhost:6379/0", False, id="localhost-subdomain"),
        pytest.param("redis://local%68ost:6379/0", False, id="encoded-localhost"),
        pytest.param("redis://127.42.0.1:6379/0", False, id="ipv4-loopback-range"),
        pytest.param("redis://%31%32%37.0.0.1:6379/0", False, id="encoded-ipv4-loopback"),
        pytest.param("redis://127.0.0.1", False, id="ipv4-loopback-no-boundary"),
        pytest.param("redis://127.1:6379/0", False, id="ipv4-loopback-shorthand"),
        pytest.param("redis://[::1]:6379/0", False, id="ipv6-loopback"),
        pytest.param(
            "redis://[0:0:0:0:0:0:0:1]:6379/0",
            False,
            id="ipv6-loopback-expanded",
        ),
        pytest.param("redis://0.0.0.0", False, id="unspecified-address"),
        pytest.param(
            "redis://user:synthetic-password@127.0.0.1:6379/0",
            False,
            id="credentialed-loopback",
        ),
        pytest.param(
            "redis://user:synthetic-password@localhost:6379/0", False, id="auth-localhost"
        ),
        pytest.param("redis://", False, id="hostless"),
        pytest.param("redis:///tmp/redis.sock", False, id="unix-socket-url"),
        pytest.param("not-a-redis-url", False, id="invalid-scheme"),
    ],
)
def test_deploy_redis_preflight_is_value_safe_and_rejects_loopback(
    redis_url: str,
    accepted: bool,
    tmp_path: Path,
) -> None:
    result, written_output = run_redis_preflight(
        tmp_path, _redis_preflight_run(), redis_url=redis_url
    )

    assert (result.returncode == 0) is accepted
    assert redis_url not in result.stdout
    assert redis_url not in result.stderr
    if accepted:
        assert written_output == f"secret_arn={_APP_SECRET_ARN}\n"
    else:
        assert written_output == ""


@pytest.mark.parametrize(
    "secret_arn",
    [
        "arn:aws:secretsmanager:us-west-2:157466816238:secret:proliferate/prod/server-app-Ab12Cd",
        "arn:aws:secretsmanager:us-east-1:111122223333:secret:proliferate/prod/server-app-Ab12Cd",
        "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/staging/server-app-Ab12Cd",
        "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/server-app",
    ],
)
def test_deploy_redis_preflight_rejects_wrong_secret_identity(
    secret_arn: str, tmp_path: Path
) -> None:
    result, written_output = run_redis_preflight(
        tmp_path,
        _redis_preflight_run(),
        redis_url="rediss://cache.internal:6379/0",
        secret_arn=secret_arn,
    )

    assert result.returncode != 0
    assert secret_arn not in result.stdout
    assert secret_arn not in result.stderr
    assert written_output == ""


@pytest.mark.parametrize(("aws_exit", "accepted"), [(0, True), (55, False)])
def test_deploy_redis_preflight_suppresses_aws_stderr(
    aws_exit: int, accepted: bool, tmp_path: Path
) -> None:
    leaked = (
        "synthetic aws error arn:aws:secretsmanager:us-east-1:111122223333:secret:hidden "
        "redis://user:password@leaked.internal:6379/0"
    )
    result, _ = run_redis_preflight(
        tmp_path,
        _redis_preflight_run(),
        redis_url="rediss://cache.internal:6379/0",
        aws_stderr=leaked,
        aws_exit=aws_exit,
    )

    assert (result.returncode == 0) is accepted
    assert leaked not in result.stdout
    assert leaked not in result.stderr
    assert "password" not in result.stdout
    assert "password" not in result.stderr
