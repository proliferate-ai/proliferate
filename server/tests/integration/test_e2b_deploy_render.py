"""Fail-closed secret contracts in the hosted server deploy render.

The render (MERGE_JQ) and fail-closed check (ASSERT_JQ) are pure jq programs
embedded verbatim in `.github/workflows/_deploy-server.yml`. We extract and run
them with real jq over synthetic task JSON; no AWS call and no secret value is
involved. This module owns the shared hosted-secret render contracts.
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
_APP_SECRET_ARN = APP_SECRET_ARN
_REDIS_VALUE_FROM = f"{_APP_SECRET_ARN}:REDBEAT_REDIS_URL::"
_E2B_VALUE_FROM = f"{_APP_SECRET_ARN}:E2B_API_KEY::"
# Retired feed projection shape, used only to prove the render strips/rejects it.
_STALE_FEED_VALUE_FROM = (
    "arn:aws:secretsmanager:us-east-1:1:secret:stale-support-feed:supportFeedToken::"
)

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
        "REDBEAT_REDIS_SECRET_ARN": _APP_SECRET_ARN,
        "secret_updates_file": str(tmp_path / "secret-updates.json"),
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


@_requires_jq
def test_workflow_authors_exactly_the_redis_and_e2b_secrets(tmp_path: Path) -> None:
    updates = _secret_updates_from_workflow(tmp_path)
    assert [entry["name"] for entry in updates] == ["REDBEAT_REDIS_URL", "E2B_API_KEY"]
    assert updates[0]["valueFrom"] == _REDIS_VALUE_FROM
    assert updates[1]["valueFrom"] == _E2B_VALUE_FROM


@_requires_jq
def test_merge_strips_inherited_retired_support_tracker_entries(tmp_path: Path) -> None:
    raw_task = {
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "image": "old:tag",
                "environment": [
                    {"name": "SUPPORT_TRACKER_ENABLED", "value": "false"},
                    {"name": "SUPPORT_GITHUB_OWNER", "value": "someone"},
                    {"name": "KEEP_ME", "value": "kept"},
                ],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _STALE_FEED_VALUE_FROM},
                    {
                        "name": "SUPPORT_LINEAR_API_KEY",
                        "valueFrom": "/proliferate/prod/support/linear-api-key",
                    },
                ],
            }
        ]
    }
    merged = _merge(raw_task, _secret_updates_from_workflow(tmp_path), tmp_path)
    container = _server_container(merged)
    env_names = [entry["name"] for entry in container["environment"]]
    secret_names = [entry["name"] for entry in container["secrets"]]
    assert "KEEP_ME" in env_names
    assert not any(name.startswith("SUPPORT_TRACKER") for name in env_names)
    assert not any(name.startswith("SUPPORT_GITHUB") for name in env_names)
    assert secret_names == ["REDBEAT_REDIS_URL", "E2B_API_KEY"]
    assert _assert_task(merged, tmp_path).returncode == 0


@_requires_jq
def test_render_assert_rejects_retired_support_tracker_entries(tmp_path: Path) -> None:
    task = {
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "environment": [
                    {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
                ],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _STALE_FEED_VALUE_FROM},
                    {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM},
                    {"name": "E2B_API_KEY", "valueFrom": _E2B_VALUE_FROM},
                ],
            }
        ]
    }
    result = _assert_task(task, tmp_path)
    assert result.returncode != 0
    assert "retired support-tracker secrets must not remain" in result.stderr


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
                    {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM},
                    *e2b_secrets,
                ],
            }
        ]
    }

    result = _assert_task(task, tmp_path)

    assert result.returncode != 0
    assert expected_reason in result.stderr


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
                        "name": "REDBEAT_REDIS_URL",
                        "valueFrom": (
                            "arn:aws:secretsmanager:us-east-1:157466816238:"
                            "secret:stale-server-app-Zz99Yy:REDBEAT_REDIS_URL::"
                        ),
                    },
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

    assert [s for s in container["secrets"] if s["name"] == "REDBEAT_REDIS_URL"] == [
        {"name": "REDBEAT_REDIS_URL", "valueFrom": _REDIS_VALUE_FROM}
    ]
    assert [e for e in container["environment"] if e["name"] == "REDBEAT_REDIS_URL"] == []
    assert [s for s in container["secrets"] if s["name"] == "E2B_API_KEY"] == [
        {"name": "E2B_API_KEY", "valueFrom": _E2B_VALUE_FROM}
    ]
    assert [e for e in container["environment"] if e["name"] == "E2B_API_KEY"] == []
    # An unowned inherited secret survives.
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
            {
                "name": _CONTAINER,
                "environment": [
                    {"name": "PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "value": "1"},
                    {"name": "ANYHARNESS_GIT_SHA", "value": "deadbeefcafe"},
                ],
                "secrets": [],
            },
            "stale runtime-identity variables must not remain",
            id="stale-runtime-identity-remains",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [{"name": "API_URL", "value": "x"}],
                "secrets": [],
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
                "secrets": redis_secrets,
            }
        ]
    }

    result = _assert_task(task, tmp_path)

    assert result.returncode != 0
    assert expected_reason in result.stderr
