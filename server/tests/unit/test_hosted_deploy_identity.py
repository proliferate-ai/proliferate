"""Account-identity and log-redaction contracts for hosted server deploys."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest
import yaml

from tests.helpers.hosted_redis_deploy import marked_shell, run_redis_preflight

REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOY_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "_deploy-server.yml"


def _deploy_steps() -> dict[str, dict[str, object]]:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    return {step.get("name", ""): step for step in workflow["jobs"]["deploy"]["steps"]}


@pytest.mark.parametrize(
    ("run_script", "diagnostic"),
    [
        ("# BLOCK_BEGIN\nbody\n", "found begin=1, end=0"),
        (
            "# BLOCK_BEGIN\nbody\n# BLOCK_END\n# BLOCK_END",
            "found begin=1, end=2",
        ),
        (
            "prefix\n# BLOCK_END\n# BLOCK_BEGIN\nbody",
            "end marker must follow its begin marker",
        ),
        ("# BLOCK_BEGIN\n\n# BLOCK_END", "delimits an empty shell fragment"),
    ],
)
def test_marked_shell_rejects_ambiguous_or_empty_boundaries(
    run_script: str, diagnostic: str
) -> None:
    with pytest.raises(AssertionError) as exc_info:
        marked_shell(run_script, "BLOCK")

    assert diagnostic in str(exc_info.value)


def test_deploy_masks_account_and_external_aws_identifiers() -> None:
    steps = _deploy_steps()
    mask_run = str(steps["Mask hosted AWS identifiers"]["run"])
    configure = steps["Configure AWS credentials"]

    assert "AWS_DEPLOY_ROLE_ARN" in mask_run
    assert "SUPPORT_FEED_SECRET_ARN" in mask_run
    assert "::add-mask::" in mask_run
    assert configure["with"]["mask-aws-account-id"] is True


def test_workflow_and_terraform_consume_one_hosted_contract() -> None:
    steps = _deploy_steps()
    validation = str(steps["Validate server deploy config"]["run"])
    terraform = (REPO_ROOT / "server" / "infra" / "hosted-redis" / "main.tf").read_text()
    imports = (REPO_ROOT / "server" / "infra" / "hosted-redis" / "imports.tf").read_text()
    contract_path = "server/deploy/hosted-redis-contract.json"

    assert contract_path in validation
    assert "execution_role_name" in validation
    assert "../../deploy/hosted-redis-contract.json" in terraform
    assert "for_each = local.environments" in imports
    assert "to = aws_iam_role_policy.deploy_secret_read[each.key]" in imports
    assert 'id = "${each.value.deploy_role_name}:api-redis-secret-read"' in imports
    assert terraform.count("prevent_destroy = true") == 2
    assert "sensitive(jsonencode" not in terraform
    assert steps["Configure AWS credentials"]["with"]["aws-region"] == (
        "${{ steps.hosted_contract.outputs.aws_region }}"
    )


@pytest.mark.parametrize(
    ("actual_account", "accepted"),
    [("157466816238", True), ("111122223333", False)],
)
def test_deploy_verifies_assumed_aws_account(
    actual_account: str, accepted: bool, tmp_path: Path
) -> None:
    body = str(_deploy_steps()["Verify AWS deployment identity"]["run"])
    fake_aws = tmp_path / "aws"
    fake_aws.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$ACTUAL_ACCOUNT\"\n"
        "printf '%s\\n' \"$AWS_ERROR_SENTINEL\" >&2\n"
    )
    fake_aws.chmod(0o755)
    script = tmp_path / "verify-account.sh"
    script.write_text(body)
    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env={
            "PATH": f"{tmp_path}:{os.environ.get('PATH', '')}",
            "ACTUAL_ACCOUNT": actual_account,
            "EXPECTED_AWS_ACCOUNT_ID": "157466816238",
            "AWS_ERROR_SENTINEL": "synthetic role/resource ARN must stay hidden",
        },
    )

    assert (result.returncode == 0) is accepted
    assert "synthetic role/resource ARN" not in result.stdout
    assert "synthetic role/resource ARN" not in result.stderr


def test_redis_identifier_is_step_scoped_after_third_party_action_main_steps() -> None:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    names = [step.get("name", "") for step in steps]
    redis = next(step for step in steps if step.get("name") == "Verify API Redis secret reference")
    render = next(step for step in steps if step.get("name") == "Render ECS task definition")

    redis_index = names.index("Verify API Redis secret reference")
    action_indexes = [index for index, step in enumerate(steps) if "uses" in step]
    assert action_indexes
    assert max(action_indexes) < redis_index
    assert redis["id"] == "redis_secret"
    assert "GITHUB_OUTPUT" in str(redis["run"])
    assert "GITHUB_ENV" not in str(redis["run"])
    assert render["env"]["REDBEAT_REDIS_SECRET_ARN"] == (
        "${{ steps.redis_secret.outputs.secret_arn }}"
    )
    assert "REDBEAT_REDIS_SECRET_ARN" not in workflow["jobs"]["deploy"].get("env", {})
    render_run = str(render["run"])
    assert "trap cleanup_render_files EXIT" in render_run
    assert "${RUNNER_TEMP}/hosted-redis-render.XXXXXX" in render_run
    assert "Third-party actions register post-job hooks" in render_run


def test_api_redis_dns_preflight_has_an_external_hard_timeout() -> None:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    redis = _deploy_steps()["Verify API Redis secret reference"]
    run = str(redis["run"])

    assert workflow["jobs"]["deploy"]["runs-on"] == "ubuntu-latest"
    assert redis["env"]["REDIS_PREFLIGHT_TIMEOUT_SECONDS"] == "20"
    assert "timeout --signal=TERM --kill-after=2s" in run
    assert "124|137)" in run
    assert "125|126|127)" in run
    assert "socket.setdefaulttimeout" not in run


def test_api_redis_dns_timeout_is_bounded_and_sanitized(tmp_path: Path) -> None:
    redis_url = "rediss://timeout.alias:6379/0"
    started = time.monotonic()
    result, written_output = run_redis_preflight(
        tmp_path,
        str(_deploy_steps()["Verify API Redis secret reference"]["run"]),
        redis_url=redis_url,
        dns_timeout_seconds=1,
        dns_delay_seconds=30,
    )
    elapsed = time.monotonic() - started

    assert result.returncode != 0
    assert elapsed < 4
    assert result.stderr.strip() == (
        "API Redis endpoint validation timed out before non-loopback DNS safety "
        "could be established."
    )
    assert redis_url not in result.stdout + result.stderr
    assert "timeout.alias" not in result.stdout + result.stderr
    assert "arn:aws" not in result.stdout + result.stderr
    assert written_output == ""


@pytest.mark.parametrize(
    ("task_definition", "execution_role", "aws_fails", "accepted"),
    [
        ("expected", "expected", False, True),
        ("wrong-account", "expected", False, False),
        ("wrong-region", "expected", False, False),
        ("expected", "wrong", False, False),
        ("expected", "missing", False, False),
        ("expected", "expected", True, False),
    ],
)
def test_deploy_verifies_exact_live_execution_role(
    task_definition: str,
    execution_role: str,
    aws_fails: bool,
    accepted: bool,
    tmp_path: Path,
) -> None:
    steps = _deploy_steps()
    render = str(steps["Render ECS task definition"]["run"])
    body = "\n".join(
        [
            marked_shell(render, "HOSTED_REDIS_SCRATCH"),
            marked_shell(render, "HOSTED_EXECUTION_ROLE_VERIFY"),
        ]
    )
    expected_task = "arn:aws:ecs:us-east-1:157466816238:task-definition/proliferate-server:7"
    task_definitions = {
        "expected": expected_task,
        "wrong-account": expected_task.replace("157466816238", "111122223333"),
        "wrong-region": expected_task.replace("us-east-1", "us-west-2"),
    }
    expected_role = "arn:aws:iam::157466816238:role/proliferate-staging-ecs-execution"
    execution_roles = {
        "expected": expected_role,
        "wrong": expected_role.replace("staging", "production"),
        "missing": None,
    }
    fake_aws = tmp_path / "aws"
    fake_aws.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        'echo "$AWS_ERROR_SENTINEL" >&2\n'
        'if [[ "$*" == *"ecs describe-services"* ]]; then\n'
        "  printf '%s\\n' \"$TASK_DEFINITION_ARN\"\n"
        'elif [[ "$*" == *"ecs describe-task-definition"* ]]; then\n'
        '  if [ "$AWS_FAILS" = true ]; then exit 1; fi\n'
        "  printf '%s\\n' \"$TASK_DEFINITION_JSON\"\n"
        "else\n"
        "  exit 2\n"
        "fi\n"
    )
    fake_aws.chmod(0o755)
    script = tmp_path / "verify-execution-role.sh"
    script.write_text(body)
    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        cwd=tmp_path,
        env={
            "PATH": f"{tmp_path}:{os.environ.get('PATH', '')}",
            "AWS_ERROR_SENTINEL": "synthetic provider ARN must stay hidden",
            "AWS_FAILS": str(aws_fails).lower(),
            "AWS_REGION": "us-east-1",
            "ECS_CLUSTER": "cluster",
            "ECS_SERVER_SERVICE": "service",
            "EXPECTED_AWS_ACCOUNT_ID": "157466816238",
            "EXPECTED_ECS_EXECUTION_ROLE_NAME": "proliferate-staging-ecs-execution",
            "RUNNER_TEMP": str(tmp_path),
            "TASK_DEFINITION_ARN": task_definitions[task_definition],
            "TASK_DEFINITION_JSON": json.dumps(
                {"executionRoleArn": execution_roles[execution_role]}
                if execution_roles[execution_role] is not None
                else {}
            ),
        },
    )

    assert (result.returncode == 0) is accepted
    combined = result.stdout + result.stderr
    assert "synthetic provider ARN" not in combined
    assert expected_task not in combined
    assert expected_role not in combined
    assert not list(tmp_path.glob("hosted-redis-render.*"))


def test_render_scratch_cleanup_removes_every_identifier_bearing_file(
    tmp_path: Path,
) -> None:
    render = str(_deploy_steps()["Render ECS task definition"]["run"])
    setup = marked_shell(render, "HOSTED_REDIS_SCRATCH")
    receipt = tmp_path / "scratch-path"
    script = tmp_path / "exercise-cleanup.sh"
    script.write_text(
        "set -euo pipefail\n"
        + setup
        + "\n"
        + 'printf \'%s\\n\' "$render_dir" > "$SCRATCH_PATH_RECEIPT"\n'
        + "for artifact in \\\n"
        + '  "$task_definition_raw" \\\n'
        + '  "$env_updates_file" \\\n'
        + '  "$secret_updates_file" \\\n'
        + '  "$merge_program_file" \\\n'
        + '  "$assert_program_file" \\\n'
        + '  "$task_definition_rendered"; do\n'
        + "  printf '%s\\n' 'synthetic-secret-identifier' > \"$artifact\"\n"
        + "done\n"
        + "exit 23\n"
    )
    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "RUNNER_TEMP": str(tmp_path),
            "SCRATCH_PATH_RECEIPT": str(receipt),
        },
    )

    assert result.returncode == 23
    scratch_dir = Path(receipt.read_text().strip())
    assert not scratch_dir.exists()
    assert "synthetic-secret-identifier" not in result.stdout + result.stderr


@pytest.mark.parametrize("exit_code", [0, 29], ids=["success", "failure"])
def test_background_scratch_cleanup_removes_redis_bearing_task_definitions(
    exit_code: int,
    tmp_path: Path,
) -> None:
    background = str(_deploy_steps()["Deploy worker and Beat from candidate image"]["run"])
    setup = marked_shell(background, "HOSTED_BACKGROUND_SCRATCH")
    receipt = tmp_path / "background-scratch-path"
    script = tmp_path / "exercise-background-cleanup.sh"
    script.write_text(
        "set -euo pipefail\n"
        + setup
        + "\n"
        + 'printf \'%s\\n\' "$background_render_dir" > "$SCRATCH_PATH_RECEIPT"\n'
        + "for artifact in \\\n"
        + '  "$worker_task_raw" \\\n'
        + '  "$worker_task_rendered" \\\n'
        + '  "$beat_task_raw" \\\n'
        + '  "$beat_task_rendered" \\\n'
        + '  "$background_assert_program"; do\n'
        + "  printf '%s\\n' "
        + '\'{"secrets":[{"name":"REDBEAT_REDIS_URL",'
        + '"valueFrom":"synthetic-secret-identifier"}]}\' > "$artifact"\n'
        + "done\n"
        + f"exit {exit_code}\n"
    )
    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "RUNNER_TEMP": str(tmp_path),
            "SCRATCH_PATH_RECEIPT": str(receipt),
        },
    )

    assert result.returncode == exit_code
    scratch_dir = Path(receipt.read_text().strip())
    assert not scratch_dir.exists()
    assert "synthetic-secret-identifier" not in result.stdout + result.stderr
    assert "td-${container}" not in background


def test_verified_task_definition_is_the_one_rendered() -> None:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    render = next(step for step in steps if step.get("name") == "Render ECS task definition")
    render_run = str(render["run"])

    assert not any(step.get("name") == "Verify ECS task execution role" for step in steps)
    assert render_run.count("describe-task-definition") == 1
    assert render_run.index("# HOSTED_EXECUTION_ROLE_VERIFY_BEGIN") < render_run.index(
        '--slurpfile updates "$env_updates_file"'
    )
    assert render_run.count('"$task_definition_raw"') >= 3
