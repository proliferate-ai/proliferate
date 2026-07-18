"""Deploy-time task-render contracts for secret-backed hosted dependencies.

The render (MERGE_JQ) and fail-closed check (ASSERT_JQ) are pure jq programs
embedded verbatim in `.github/workflows/_deploy-server.yml`. We extract and run
them with real jq over synthetic task JSON; no AWS call and no secret value is
involved. Split from ``test_support_feed.py`` solely to satisfy the repo-shape
600-line source cap (``scripts/check_max_lines.py``); this module now owns the
shared hosted-secret render contracts.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml
from tests.helpers.hosted_redis_deploy import APP_SECRET_ARN, marked_shell, run_redis_preflight

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEPLOY_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "_deploy-server.yml"
_CONTAINER = "server"
_PROD_FEED_ARN = (
    "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/support-feed-NoKayy"
)
_FEED_VALUE_FROM = f"{_PROD_FEED_ARN}:supportFeedToken::"
_APP_SECRET_ARN = APP_SECRET_ARN
_REDIS_VALUE_FROM = f"{_APP_SECRET_ARN}:REDBEAT_REDIS_URL::"
_E2B_VALUE_FROM = f"{_APP_SECRET_ARN}:E2B_API_KEY::"
_STALE_REDIS_VALUE_FROM = (
    "arn:aws:secretsmanager:us-east-1:157466816238:"
    "secret:stale-server-app-Zz99Yy:REDBEAT_REDIS_URL::"
)
# Distinct ARNs used only to build synthetic prior/duplicate task states.
_STALE_VALUE_FROM = "arn:aws:secretsmanager:us-east-1:1:secret:stale:supportFeedToken::"
_OTHER_VALUE_FROM = "arn:aws:secretsmanager:us-east-1:1:secret:other:supportFeedToken::"

_requires_jq = pytest.mark.skipif(
    shutil.which("jq") is None, reason="jq is required for the render contract tests"
)


def _extract_heredoc(run_script: str, tag: str) -> str:
    """Return the body of a `<<'TAG' ... TAG` heredoc from the render step.

    ``run_script`` is the YAML-decoded step body, so the block-scalar indent is
    already stripped and each heredoc terminator sits at column 0.
    """

    opener = f"<<'{tag}'\n"
    start = run_script.index(opener) + len(opener)
    end = run_script.index(f"\n{tag}\n", start)
    body = run_script[start:end]
    assert body.strip(), f"heredoc {tag} is empty"
    return body


def _render_jq_programs() -> tuple[str, str]:
    workflow = yaml.safe_load(_DEPLOY_WORKFLOW.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    run_script = next(s["run"] for s in steps if s.get("name") == "Render ECS task definition")
    return _extract_heredoc(run_script, "MERGE_JQ"), _extract_heredoc(run_script, "ASSERT_JQ")


def _secret_updates_from_workflow(tmp_path: Path) -> list[dict]:
    """Execute the exact secret-update authoring fragment from the workflow."""

    workflow = yaml.safe_load(_DEPLOY_WORKFLOW.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    run_script = next(s["run"] for s in steps if s.get("name") == "Render ECS task definition")
    fragment = marked_shell(run_script, "HOSTED_SECRET_UPDATES")
    script = tmp_path / "author-secrets.sh"
    script.write_text("set -euo pipefail\n" + fragment + "\n")
    env = {
        **os.environ,
        "SUPPORT_FEED_SECRET_ARN": _PROD_FEED_ARN,
        "REDBEAT_REDIS_SECRET_ARN": _APP_SECRET_ARN,
        "secret_updates_file": str(tmp_path / "secret-updates.json"),
        "support_github_private_key_parameter": "",
        "support_linear_api_key_parameter": "/proliferate/prod/support/linear-api-key",
    }
    result = subprocess.run(
        ["bash", str(script)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 0, result.stderr
    return json.loads((tmp_path / "secret-updates.json").read_text())


def _run_jq(
    program: str, document: dict, tmp_path: Path, *args: str
) -> subprocess.CompletedProcess[str]:
    prog_file = tmp_path / "program.jq"
    doc_file = tmp_path / "document.json"
    prog_file.write_text(program)
    doc_file.write_text(json.dumps(document))
    return subprocess.run(
        ["jq", *args, "-f", str(prog_file), str(doc_file)],
        capture_output=True,
        text=True,
    )


def _merge(
    raw_task: dict, secret_updates: list[dict], tmp_path: Path, *, image: str = "new:tag"
) -> dict:
    merge_program, _ = _render_jq_programs()
    env_file = tmp_path / "env-updates.json"
    sec_file = tmp_path / "secret-updates.json"
    # Mirror the real render: strict release identity is one of the env updates,
    # so a merged task satisfies the strengthened fail-closed assertion.
    env_file.write_text(
        json.dumps(
            [
                {"name": "API_URL", "value": "https://new"},
                {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
            ]
        )
    )
    sec_file.write_text(json.dumps(secret_updates))
    prog_file = tmp_path / "merge.jq"
    raw_file = tmp_path / "raw.json"
    prog_file.write_text(merge_program)
    raw_file.write_text(json.dumps(raw_task))
    result = subprocess.run(
        [
            "jq",
            "--arg",
            "container",
            _CONTAINER,
            "--arg",
            "image",
            image,
            "--slurpfile",
            "updates",
            str(env_file),
            "--slurpfile",
            "secret_updates",
            str(sec_file),
            "-f",
            str(prog_file),
            str(raw_file),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _assert_task(final_task: dict, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    _, assert_program = _render_jq_programs()
    return _run_jq(
        assert_program,
        final_task,
        tmp_path,
        "--arg",
        "container",
        _CONTAINER,
        "--arg",
        "redis_value_from",
        _REDIS_VALUE_FROM,
        "--arg",
        "e2b_value_from",
        _E2B_VALUE_FROM,
    )


def _server_container(task: dict) -> dict:
    (container,) = [c for c in task["containerDefinitions"] if c["name"] == _CONTAINER]
    return container


def _redis_preflight_run() -> str:
    workflow = yaml.safe_load(_DEPLOY_WORKFLOW.read_text())
    return str(
        next(
            step
            for step in workflow["jobs"]["deploy"]["steps"]
            if step.get("name") == "Verify API Redis secret reference"
        )["run"]
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


def test_support_feed_preflight_suppresses_aws_identifiers(tmp_path: Path) -> None:
    workflow = yaml.safe_load(_DEPLOY_WORKFLOW.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    run = str(
        next(step for step in steps if step.get("name") == "Verify support feed secret reference")[
            "run"
        ]
    )
    fake_aws = tmp_path / "aws"
    leaked_arn = "arn:aws:secretsmanager:us-east-1:111122223333:secret:hidden-Ab12Cd"
    fake_aws.write_text("#!/bin/sh\nprintf '%s\\n' \"$LEAKED_AWS_ERROR\" >&2\nexit 44\n")
    fake_aws.chmod(0o755)
    script = tmp_path / "support-preflight.sh"
    script.write_text(run)
    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
            "SUPPORT_FEED_SECRET_ARN": leaked_arn,
            "LEAKED_AWS_ERROR": f"access denied for {leaked_arn}",
        },
    )

    assert result.returncode != 0
    assert leaked_arn not in result.stdout
    assert leaked_arn not in result.stderr
    assert (
        result.stderr.strip() == "The support feed secret is missing, inaccessible, or malformed."
    )


@_requires_jq
def test_render_authors_hosted_secrets_and_strips_inherited_plaintext(tmp_path: Path) -> None:
    # The live task inherits stale secret references and leaked plaintext
    # entries. The render must replace both owned refs, dedupe them, and drop
    # every plaintext copy.
    raw_task = {
        "taskDefinitionArn": "arn:aws:ecs:us-east-1:1:task-definition/proliferate-prod-server:5",
        "revision": 5,
        "status": "ACTIVE",
        "requiresAttributes": [],
        "compatibilities": ["FARGATE"],
        "registeredAt": "t",
        "registeredBy": "who",
        "family": "proliferate-prod-server",
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "image": "old",
                "environment": [
                    {"name": "API_URL", "value": "old"},
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "value": "LEAKED-PLAINTEXT"},
                    {"name": "REDBEAT_REDIS_URL", "value": "redis://plaintext.invalid/0"},
                    {"name": "E2B_API_KEY", "value": "LEAKED-E2B-KEY"},
                    # Stale runtime-identity overrides inherited from the prior
                    # task revision; the merge must strip them.
                    {"name": "ANYHARNESS_GIT_SHA", "value": "deadbeefcafe"},
                    {
                        "name": "CLOUD_RUNTIME_SENTRY_RELEASE",
                        "value": "proliferate-server@0.1.0+abc",
                    },
                    {"name": "E2B_RUNTIME_SENTRY_RELEASE", "value": "stale"},
                ],
                "secrets": [
                    {
                        "name": "SUPPORT_FEED_BEARER_TOKEN",
                        "valueFrom": _STALE_VALUE_FROM,
                    },
                    {"name": "REDBEAT_REDIS_URL", "valueFrom": _STALE_REDIS_VALUE_FROM},
                    {
                        "name": "E2B_API_KEY",
                        "valueFrom": (
                            "arn:aws:secretsmanager:us-east-1:1:secret:stale:E2B_API_KEY::"
                        ),
                    },
                    {"name": "OTHER", "valueFrom": "keepme"},
                ],
            },
            {"name": "sidecar", "image": "s"},
        ],
    }
    secret_updates = _secret_updates_from_workflow(tmp_path)

    final = _merge(raw_task, secret_updates, tmp_path)
    container = _server_container(final)

    feed_secrets = [s for s in container["secrets"] if s["name"] == "SUPPORT_FEED_BEARER_TOKEN"]
    assert feed_secrets == [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}]
    assert [e for e in container["environment"] if e["name"] == "SUPPORT_FEED_BEARER_TOKEN"] == []
    assert [s for s in container["secrets"] if s["name"] == "REDBEAT_REDIS_URL"] == [
        {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM}
    ]
    assert [e for e in container["environment"] if e["name"] == "REDBEAT_REDIS_URL"] == []
    assert [s for s in container["secrets"] if s["name"] == "E2B_API_KEY"] == [
        {"name": "E2B_API_KEY", "valueFrom": _E2B_VALUE_FROM}
    ]
    assert [e for e in container["environment"] if e["name"] == "E2B_API_KEY"] == []
    # A non-feed inherited secret survives.
    assert any(s["name"] == "OTHER" for s in container["secrets"])
    # Every inherited stale runtime-identity override is stripped.
    env_names = {e["name"] for e in container["environment"]}
    for forbidden in (
        "ANYHARNESS_GIT_SHA",
        "CLOUD_RUNTIME_SENTRY_RELEASE",
        "E2B_RUNTIME_SENTRY_RELEASE",
    ):
        assert forbidden not in env_names
    # Strict release identity flows in from the env updates.
    strict = {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"}
    assert strict in container["environment"]
    # Mutable metadata is stripped before registration.
    for stripped in ("taskDefinitionArn", "revision", "status", "requiresAttributes"):
        assert stripped not in final
    # The rendered task passes the fail-closed assertion.
    assert _assert_task(final, tmp_path).returncode == 0


@_requires_jq
def test_render_assert_passes_on_well_formed_task(tmp_path: Path) -> None:
    task = {
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "environment": [
                    {"name": "API_URL", "value": "x"},
                    {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
                ],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM},
                    {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM},
                    {"name": "E2B_API_KEY", "valueFrom": _E2B_VALUE_FROM},
                ],
            }
        ]
    }
    assert _assert_task(task, tmp_path).returncode == 0


@_requires_jq
@pytest.mark.parametrize(
    ("container", "expected_reason"),
    [
        pytest.param(
            {"name": _CONTAINER, "environment": [], "secrets": []},
            "expected exactly one SUPPORT_FEED_BEARER_TOKEN",
            id="missing-secret",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "value": "leak"}],
                "secrets": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}],
            },
            "must not be present as a plaintext environment entry",
            id="plaintext-duplicate",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM},
                    {
                        "name": "SUPPORT_FEED_BEARER_TOKEN",
                        "valueFrom": _OTHER_VALUE_FROM,
                    },
                ],
            },
            "expected exactly one SUPPORT_FEED_BEARER_TOKEN",
            id="duplicate-secret",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _PROD_FEED_ARN},
                ],
            },
            "must project the supportFeedToken field",
            id="wrong-field",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [],
                "secrets": [
                    {
                        "name": "SUPPORT_FEED_BEARER_TOKEN",
                        "valueFrom": "/ssm/plain:supportFeedToken::",
                    },
                ],
            },
            "must reference a Secrets Manager secret ARN",
            id="not-secrets-manager-arn",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [
                    {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
                    {"name": "ANYHARNESS_GIT_SHA", "value": "deadbeefcafe"},
                ],
                "secrets": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}],
            },
            "stale runtime-identity variables must not remain",
            id="stale-runtime-identity-remains",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [{"name": "API_URL", "value": "x"}],
                "secrets": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}],
            },
            "PROLIFERATE_REQUIRE_RELEASE_IDENTITY=1 must be set",
            id="strict-identity-absent",
        ),
    ],
)
def test_render_assert_fails_closed(container: dict, expected_reason: str, tmp_path: Path) -> None:
    task = {"containerDefinitions": [container]}
    result = _assert_task(task, tmp_path)
    assert result.returncode != 0
    assert expected_reason in result.stderr


@_requires_jq
@pytest.mark.parametrize(
    ("redis_environment", "redis_secrets", "expected_reason"),
    [
        pytest.param([], [], "expected exactly one REDBEAT_REDIS_URL", id="missing-secret"),
        pytest.param(
            [{"name": "REDBEAT_REDIS_URL", "value": "redis://plaintext.invalid/0"}],
            [{"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM}],
            "must not be present as a plaintext environment entry",
            id="plaintext-duplicate",
        ),
        pytest.param(
            [],
            [
                {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM},
                {
                    "name": "REDBEAT_REDIS_URL",
                    "valueFrom": (
                        "arn:aws:secretsmanager:us-east-1:1:secret:other:REDBEAT_REDIS_URL::"
                    ),
                },
            ],
            "expected exactly one REDBEAT_REDIS_URL",
            id="duplicate-secret",
        ),
        pytest.param(
            [],
            [{"name": "REDBEAT_REDIS_URL", "valueFrom": "/ssm/redis-url"}],
            "must match the environment-owned Secrets Manager field reference",
            id="unowned-reference",
        ),
        pytest.param(
            [],
            [{"name": "REDBEAT_REDIS_URL", "valueFrom": _APP_SECRET_ARN}],
            "must match the environment-owned Secrets Manager field reference",
            id="missing-field-projection",
        ),
    ],
)
def test_render_assert_requires_secret_backed_redis_url(
    redis_environment: list[dict],
    redis_secrets: list[dict],
    expected_reason: str,
    tmp_path: Path,
) -> None:
    task = {
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "environment": [
                    {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
                    *redis_environment,
                ],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM},
                    *redis_secrets,
                ],
            }
        ]
    }

    result = _assert_task(task, tmp_path)

    assert result.returncode != 0
    assert expected_reason in result.stderr
