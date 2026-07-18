"""Fail-closed E2B secret contracts in the hosted server deploy render."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tests.helpers.hosted_redis_deploy import run_redis_preflight
from tests.integration.test_support_feed_deploy_render import (
    _APP_SECRET_ARN,
    _CONTAINER,
    _E2B_VALUE_FROM,
    _FEED_VALUE_FROM,
    _DEPLOY_WORKFLOW,
    _REDIS_VALUE_FROM,
    _assert_task,
    _redis_preflight_run,
    _requires_jq,
)


def test_deploy_preflights_environment_owned_runtime_fields_before_render() -> None:
    workflow = yaml.safe_load(_DEPLOY_WORKFLOW.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    names = [step.get("name", "") for step in steps]
    preflight = next(
        step for step in steps if step.get("name") == "Verify API Redis secret reference"
    )
    run = str(preflight["run"])

    assert names.index("Verify API Redis secret reference") < names.index(
        "Render ECS task definition"
    )
    assert '--secret-id "$REDBEAT_REDIS_SECRET_NAME"' in run
    assert 'response.get("ARN")' in run
    assert 'response.get("SecretString")' in run
    assert 'payload.get("REDBEAT_REDIS_URL")' in run
    assert 'payload.get("E2B_API_KEY")' in run
    assert "urlsplit" in run
    assert "unquote(host)" in run
    assert "ipaddress.ip_address" in run
    assert "address.is_loopback" in run
    assert "socket.inet_aton" in run
    assert "socket.getaddrinfo" in run
    assert "resolved_address.is_loopback" in run
    assert "values not printed or retained" in run


@pytest.mark.parametrize("e2b_api_key", [None, "", " leading", "trailing "])
def test_deploy_preflight_rejects_missing_or_noncanonical_e2b_key(
    e2b_api_key: str | None,
    tmp_path: Path,
) -> None:
    result, written_output = run_redis_preflight(
        tmp_path,
        _redis_preflight_run(),
        redis_url="rediss://cache.internal:6379/0",
        e2b_api_key=e2b_api_key,
    )

    assert result.returncode != 0
    assert written_output == ""
    if e2b_api_key:
        assert e2b_api_key not in result.stdout
        assert e2b_api_key not in result.stderr


@_requires_jq
@pytest.mark.parametrize(
    ("e2b_environment", "e2b_secrets", "expected_reason"),
    [
        pytest.param([], [], "expected exactly one E2B_API_KEY", id="missing-secret"),
        pytest.param(
            [{"name": "E2B_API_KEY", "value": "plaintext"}],
            [{"name": "E2B_API_KEY", "valueFrom": _E2B_VALUE_FROM}],
            "must not be present as a plaintext environment entry",
            id="plaintext-duplicate",
        ),
        pytest.param(
            [],
            [
                {"name": "E2B_API_KEY", "valueFrom": _E2B_VALUE_FROM},
                {
                    "name": "E2B_API_KEY",
                    "valueFrom": ("arn:aws:secretsmanager:us-east-1:1:secret:other:E2B_API_KEY::"),
                },
            ],
            "expected exactly one E2B_API_KEY",
            id="duplicate-secret",
        ),
        pytest.param(
            [],
            [{"name": "E2B_API_KEY", "valueFrom": _APP_SECRET_ARN}],
            "must match the environment-owned Secrets Manager field reference",
            id="missing-field-projection",
        ),
    ],
)
def test_render_assert_requires_exact_secret_backed_e2b_key(
    e2b_environment: list[dict],
    e2b_secrets: list[dict],
    expected_reason: str,
    tmp_path: Path,
) -> None:
    task = {
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "environment": [
                    {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
                    *e2b_environment,
                ],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM},
                    {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM},
                    *e2b_secrets,
                ],
            }
        ]
    }

    result = _assert_task(task, tmp_path)

    assert result.returncode != 0
    assert expected_reason in result.stderr
