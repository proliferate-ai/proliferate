"""Fail-closed identity contracts for hosted worker/Beat task registration."""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "_deploy-server.yml"
CONTRACT_PATH = REPO_ROOT / "server" / "deploy" / "hosted-redis-contract.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text())
ACCOUNT = CONTRACT["aws_account_id"]
REGION = CONTRACT["aws_region"]
STAGING = CONTRACT["environments"]["staging"]
EXECUTION_ROLE = f"arn:aws:iam::{ACCOUNT}:role/{STAGING['execution_role_name']}"
REDIS_PREFIX = (
    f"arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:"
    f"{STAGING['background_redis_reference_name']}-"
)
REDIS_ARN = f"{REDIS_PREFIX}Ab12Cd"
SSM_NAME = "/proliferate/staging/background/redbeat-redis-url"
SSM_ARN = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter{SSM_NAME}"
SERVER_APP_ARN = (
    f"arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:{STAGING['secret_name']}-Ab12Cd"
)
E2B_KEY_REFERENCE = f"{SERVER_APP_ARN}:E2B_API_KEY::"
E2B_TEMPLATE = "team/proliferate-runtime-cloud:staging"

requires_jq = pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required")


def _steps() -> dict[str, dict[str, object]]:
    workflow = yaml.safe_load(WORKFLOW_PATH.read_text())
    return {step.get("name", ""): step for step in workflow["jobs"]["deploy"]["steps"]}


def _extract_heredoc(run_script: str, tag: str) -> str:
    opener = f"<<'{tag}'\n"
    start = run_script.index(opener) + len(opener)
    end = run_script.index(f"\n{tag}\n", start)
    return run_script[start:end]


def _task(container: str) -> dict[str, object]:
    return {
        "family": f"synthetic-{container}",
        "executionRoleArn": EXECUTION_ROLE,
        "containerDefinitions": [
            {
                "name": container,
                "image": "example.invalid/server@sha256:abc",
                "environment": [
                    {"name": "E2B_TEMPLATE_NAME", "value": E2B_TEMPLATE},
                ],
                "secrets": [
                    {"name": "REDBEAT_REDIS_URL", "valueFrom": REDIS_ARN},
                    {"name": "E2B_API_KEY", "valueFrom": E2B_KEY_REFERENCE},
                ],
            }
        ],
    }


def _run_assertion(
    task: dict[str, object],
    container: str,
    tmp_path: Path,
    *,
    redis_prefix: str = REDIS_PREFIX,
    redis_exact: str = "",
) -> subprocess.CompletedProcess[str]:
    background = str(_steps()["Deploy worker and Beat from candidate image"]["run"])
    program = tmp_path / "background-assert.jq"
    document = tmp_path / "task.json"
    program.write_text(_extract_heredoc(background, "BACKGROUND_ASSERT_JQ"))
    document.write_text(json.dumps(task))
    return subprocess.run(
        [
            "jq",
            "-e",
            "--arg",
            "container",
            container,
            "--arg",
            "execution_role",
            EXECUTION_ROLE,
            "--arg",
            "redis_prefix",
            redis_prefix,
            "--arg",
            "redis_exact",
            redis_exact,
            "--arg",
            "e2b_api_key_reference",
            E2B_KEY_REFERENCE,
            "--arg",
            "e2b_template",
            E2B_TEMPLATE,
            "-f",
            str(program),
            str(document),
        ],
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize("container", ["worker", "beat"])
@requires_jq
def test_worker_and_beat_accept_exact_execution_role_and_redis_secret(
    container: str, tmp_path: Path
) -> None:
    result = _run_assertion(_task(container), container, tmp_path)

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("container", ["worker", "beat"])
@requires_jq
def test_worker_and_beat_accept_exact_ssm_parameter_reference(
    container: str, tmp_path: Path
) -> None:
    task = _task(container)
    task["containerDefinitions"][0]["secrets"][0]["valueFrom"] = SSM_ARN

    result = _run_assertion(task, container, tmp_path, redis_prefix="", redis_exact=SSM_ARN)

    assert result.returncode == 0, result.stderr


def _wrong_role(task: dict[str, object], container: str) -> None:
    del container
    task["executionRoleArn"] = EXECUTION_ROLE.replace("staging", "production")


def _wrong_account(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["secrets"][0]["valueFrom"] = REDIS_ARN.replace(
        ACCOUNT, "111122223333"
    )


def _wrong_region(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["secrets"][0]["valueFrom"] = REDIS_ARN.replace(
        REGION, "us-west-2"
    )


def _wrong_secret(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["secrets"][0]["valueFrom"] = REDIS_ARN.replace(
        "staging/background", "production/background"
    )


def _field_projection(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["secrets"][0]["valueFrom"] += ":REDBEAT_REDIS_URL::"


def _duplicate_secret(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["secrets"].append(
        {"name": "REDBEAT_REDIS_URL", "valueFrom": REDIS_ARN}
    )


def _plaintext_duplicate(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["environment"].append(
        {"name": "REDBEAT_REDIS_URL", "value": "redis://127.0.0.1:6379"}
    )


def _missing_secret(task: dict[str, object], container: str) -> None:
    task["containerDefinitions"][0]["secrets"] = []


@pytest.mark.parametrize("container", ["worker", "beat"])
@pytest.mark.parametrize(
    "mutate",
    [
        _wrong_role,
        _wrong_account,
        _wrong_region,
        _wrong_secret,
        _field_projection,
        _duplicate_secret,
        _plaintext_duplicate,
        _missing_secret,
    ],
    ids=[
        "wrong-role",
        "wrong-account",
        "wrong-region",
        "wrong-secret",
        "field-projection",
        "duplicate-secret",
        "plaintext-duplicate",
        "missing-secret",
    ],
)
@requires_jq
def test_worker_and_beat_reject_identity_or_projection_mismatch(
    container: str,
    mutate: Callable[[dict[str, object], str], None],
    tmp_path: Path,
) -> None:
    task = _task(container)
    mutate(task, container)

    result = _run_assertion(task, container, tmp_path)

    assert result.returncode != 0


def _missing_e2b_secret(task: dict[str, object], container: str) -> None:
    del container
    task["containerDefinitions"][0]["secrets"] = [
        secret
        for secret in task["containerDefinitions"][0]["secrets"]
        if secret["name"] != "E2B_API_KEY"
    ]


def _plaintext_e2b_key(task: dict[str, object], container: str) -> None:
    del container
    task["containerDefinitions"][0]["environment"].append(
        {"name": "E2B_API_KEY", "value": "plaintext"}
    )


def _wrong_e2b_secret(task: dict[str, object], container: str) -> None:
    del container
    task["containerDefinitions"][0]["secrets"][1]["valueFrom"] = E2B_KEY_REFERENCE.replace(
        "staging/server-app", "prod/server-app"
    )


def _duplicate_e2b_secret(task: dict[str, object], container: str) -> None:
    del container
    task["containerDefinitions"][0]["secrets"].append(
        {"name": "E2B_API_KEY", "valueFrom": E2B_KEY_REFERENCE}
    )


def _missing_e2b_template(task: dict[str, object], container: str) -> None:
    del container
    task["containerDefinitions"][0]["environment"] = []


def _wrong_e2b_template(task: dict[str, object], container: str) -> None:
    del container
    task["containerDefinitions"][0]["environment"][0]["value"] = (
        "team/proliferate-runtime-cloud:production"
    )


@pytest.mark.parametrize("container", ["worker", "beat"])
@pytest.mark.parametrize(
    "mutate",
    [
        _missing_e2b_secret,
        _plaintext_e2b_key,
        _wrong_e2b_secret,
        _duplicate_e2b_secret,
        _missing_e2b_template,
        _wrong_e2b_template,
    ],
    ids=[
        "missing-key",
        "plaintext-key",
        "wrong-key-reference",
        "duplicate-key",
        "missing-template",
        "wrong-template",
    ],
)
@requires_jq
def test_worker_and_beat_reject_incomplete_or_unowned_e2b_configuration(
    container: str,
    mutate: Callable[[dict[str, object], str], None],
    tmp_path: Path,
) -> None:
    task = _task(container)
    mutate(task, container)

    result = _run_assertion(task, container, tmp_path)

    assert result.returncode != 0


def test_background_registration_uses_the_checked_in_contract_before_aws_mutation() -> None:
    steps = _steps()
    validation = str(steps["Validate server deploy config"]["run"])
    background = str(steps["Deploy worker and Beat from candidate image"]["run"])

    assert "background_redis_reference_service" in validation
    assert "background_redis_reference_name" in validation
    assert "EXPECTED_BACKGROUND_REDIS_SERVICE" in validation
    assert "EXPECTED_BACKGROUND_REDIS_NAME" in validation
    assert "secretsmanager)" in background
    assert "ssm)" in background
    assert "expected_background_execution_role" in background
    assert "expected_background_redis_prefix" in background
    assert "expected_e2b_api_key_reference" in background
    assert "E2B_TEMPLATE_NAME" in background
    assert "E2B_API_KEY" in background
    assert "merge_environment" in background
    assert "merge_secrets" in background
    assert background.index("BACKGROUND_ASSERT_JQ") < background.index(
        "aws ecs register-task-definition"
    )
    assert '"$task_rendered"' in background
    assert "td-${container}" not in background


def test_managed_background_secret_names_match_the_deploy_contract() -> None:
    background_terraform = (REPO_ROOT / "server" / "infra" / "background.tf").read_text()

    assert 'name  = "proliferate/${var.environment}/background/redbeat-redis-url"' in (
        background_terraform
    )
    for environment, values in CONTRACT["environments"].items():
        assert values["background_redis_reference_service"] == "secretsmanager"
        assert values["background_redis_reference_name"] == (
            f"proliferate/{environment}/background/redbeat-redis-url"
        )
