"""Merge-gated checks on the background-plane deployment definitions.

These parse the local Compose file and the reusable server deploy workflow as
data. They assert the invariants the frozen spec requires — every background
process is defined locally, worker/Beat ride the exact same image as the API,
and the hosted rollout order deploys worker+Beat before the API so a new API
can never enqueue a task name no running worker imports.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE_PATH = REPO_ROOT / "server" / "docker-compose.yml"
DEPLOY_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "_deploy-server.yml"

_requires_jq = pytest.mark.skipif(
    shutil.which("jq") is None, reason="jq is required for the deploy render-logic tests"
)


def _compose() -> dict[str, object]:
    return yaml.safe_load(COMPOSE_PATH.read_text())


def _deploy_steps() -> dict[str, dict[str, object]]:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    return {step.get("name", ""): step for step in workflow["jobs"]["deploy"]["steps"]}


def test_compose_defines_all_background_processes() -> None:
    services = _compose()["services"]
    for required in ("db", "rabbitmq", "redis", "migrate", "api", "worker", "beat"):
        assert required in services, f"compose is missing the {required} service"


def test_compose_worker_and_beat_use_same_image_build_as_api() -> None:
    services = _compose()["services"]
    api_build = services["api"]["build"]
    assert services["worker"]["build"] == api_build
    assert services["beat"]["build"] == api_build
    worker_command = " ".join(services["worker"]["command"])
    beat_command = " ".join(services["beat"]["command"])
    assert "proliferate.background.celery_app:celery_app" in worker_command
    assert " worker" in f" {worker_command}"
    assert "proliferate.background.celery_app:celery_app" in beat_command
    assert " beat" in f" {beat_command}"


def test_compose_host_ports_are_profile_overridable() -> None:
    # Multi-worktree isolation: every published host port must be overridable
    # via environment so two stacks never fight over a default port.
    services = _compose()["services"]
    for name in ("db", "rabbitmq", "redis", "api"):
        for mapping in services[name].get("ports", []):
            host_side = str(mapping).rsplit(":", 1)[0]
            assert host_side.startswith("${"), (
                f"{name} publishes fixed host port {mapping}; use an env override"
            )


def test_deploy_workflow_orders_worker_and_beat_before_api() -> None:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    names = [step.get("name", "") for step in steps]

    migrations = names.index("Run Alembic migrations")
    verify_broker = names.index("Verify broker and scheduler store")
    deploy_background = names.index("Deploy worker and Beat from candidate image")
    verify_background = names.index("Verify worker and Beat health")
    candidate_proof = names.index("Prove candidate plane executes enqueued work")
    roll_api = names.index("Roll ECS service")

    # The candidate-plane EXECUTION proof runs after the worker/Beat are healthy
    # but strictly BEFORE the API roll: a green runningCount is not enough, the
    # plane must be proven to execute newly enqueued work before an API that can
    # enqueue it is deployed.
    assert (
        migrations
        < verify_broker
        < deploy_background
        < verify_background
        < candidate_proof
        < roll_api
    )


def test_candidate_proof_step_gates_on_both_services() -> None:
    step = _deploy_steps()["Prove candidate plane executes enqueued work"]
    condition = str(step.get("if", ""))
    assert "ECS_WORKER_SERVICE != ''" in condition
    assert "ECS_BEAT_SERVICE != ''" in condition


def test_candidate_proof_covers_both_signals_and_is_resource_id_free() -> None:
    # The proof must observe BOTH a relay heartbeat (Beat + scheduler store) and
    # an EXACT-ID execution receipt for the row THIS deploy enqueued (worker
    # consumed + ran that specific row), correlated by the outbox id the relay
    # uses as the celery task id. The heartbeat rides the plane's own custom
    # metric namespace and the exact-ID receipt is a structured log line, so the
    # gate works identically on the managed-IDs and external-endpoint paths (no
    # broker/store resource ID referenced).
    run = str(_deploy_steps()["Prove candidate plane executes enqueued work"]["run"])
    assert "RelayHeartbeat" in run
    # Correlation is on the exact enqueued outbox id via a safe log receipt, not
    # an aggregate success metric that a concurrent no-op could satisfy.
    assert "background_health_receipt" in run
    assert "recover_outbox_id" in run
    assert "receipt_count_for_id" in run
    assert "outbox_id" in run
    assert "proliferate.background.enqueue_health" in run
    # The proof key incorporates the run ATTEMPT so a rerun enqueues a FRESH row
    # instead of colliding by idempotency key with a prior attempt's published one.
    assert "GITHUB_RUN_ATTEMPT" in run
    assert "FAILED CLOSED" in run
    # The exact-ID correlation must NOT rely on the aggregate success-count
    # metric (a different deploy's/operator's no-op could advance it).
    assert "TaskSuccessCount" not in run
    # No hosted broker/store resource identifiers leak into the proof: it measures
    # the app reaching whatever endpoints are configured, not a managed resource.
    # The server log group is derived from the environment name, not a resource ID.
    assert "BACKGROUND_MQ_BROKER_ID" not in run
    assert "BACKGROUND_STORE_NAME" not in run
    assert "describe-broker" not in run
    assert "describe-serverless-caches" not in run


def test_deploy_workflow_uses_one_image_for_api_worker_and_beat() -> None:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW_PATH.read_text())
    steps = {step.get("name", ""): step for step in workflow["jobs"]["deploy"]["steps"]}

    background_run = steps["Deploy worker and Beat from candidate image"]["run"]
    api_render_run = steps["Render ECS task definition"]["run"]
    # Both the API render and the worker/Beat roll consume the single resolved
    # IMMUTABLE digest reference; nothing re-derives a second tag.
    assert "steps.digest.outputs.image_ref" in background_run
    assert "steps.digest.outputs.image_ref" in api_render_run

    summary_run = steps["Summarize server deploy"]["run"]
    assert "steps.build.outputs.digest" in summary_run


def test_deploy_pins_api_worker_and_beat_to_immutable_digest() -> None:
    # BG4-IMAGE-01: the mutable `repo:shortsha` tag can be re-pointed after this
    # deploy resolves it, so every task definition (API + worker + Beat) must be
    # pinned to the immutable `repo@sha256:` digest and registration must fail
    # closed on a mutable tag.
    steps = _deploy_steps()

    # A dedicated step resolves the immutable digest reference and rejects a
    # non-sha256 build output.
    digest_run = str(steps["Resolve immutable image digest"]["run"])
    assert "steps.build.outputs.digest" in digest_run
    assert "@${digest}" in digest_run
    assert "sha256:*" in digest_run
    assert "image_ref=" in digest_run

    # The API render pins the server container to the digest ref and asserts the
    # registered image is a @sha256: reference before register-task-definition.
    api_render_run = str(steps["Render ECS task definition"]["run"])
    assert "steps.digest.outputs.image_ref" in api_render_run
    assert "*@sha256:*)" in api_render_run
    assert "not an immutable @sha256: digest reference" in api_render_run

    # The worker/Beat re-image step pins the candidate to the digest ref and
    # rejects a mutable tag before rolling.
    background_run = str(steps["Deploy worker and Beat from candidate image"]["run"])
    assert "steps.digest.outputs.image_ref" in background_run
    assert "*@sha256:*)" in background_run
    assert "refusing to roll a mutable tag" in background_run

    # The pre-API health check compares the live service image to the digest ref.
    health_run = str(steps["Verify worker and Beat health"]["run"])
    assert "steps.digest.outputs.image_ref" in health_run


def test_background_steps_gate_on_both_worker_and_beat() -> None:
    # Every background step (broker/store verify, worker+Beat roll, health) must
    # gate on BOTH service names being nonempty. A step gated on only one would
    # let a partial config skip part of the rollout while still rolling the API.
    steps = _deploy_steps()
    for name in (
        "Verify broker and scheduler store",
        "Deploy worker and Beat from candidate image",
        "Verify worker and Beat health",
    ):
        condition = str(steps[name].get("if", ""))
        assert "ECS_WORKER_SERVICE != ''" in condition, f"{name} must gate on worker service"
        assert "ECS_BEAT_SERVICE != ''" in condition, f"{name} must gate on Beat service"


def _run_validate_config(tmp_path: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Run the deploy 'Validate server deploy config' bash body under bash.

    Only the background-plane fail-closed branch is exercised; the required base
    vars are supplied so the earlier `:?` guards pass, isolating the partial
    background-config check.
    """

    body = str(_deploy_steps()["Validate server deploy config"]["run"])
    script = tmp_path / "validate.sh"
    script.write_text(body)
    github_env = tmp_path / "github-env"
    github_output = tmp_path / "github-output"
    base_env = {
        "PATH": os.environ.get("PATH", ""),
        "AWS_DEPLOY_ROLE_ARN": (
            "arn:aws:iam::157466816238:role/proliferate-staging-github-actions-deploy"
        ),
        "DEPLOY_ENVIRONMENT": "staging",
        "GITHUB_ENV": str(github_env),
        "GITHUB_OUTPUT": str(github_output),
        "ECS_CLUSTER": "cluster",
        "ECS_SERVER_SERVICE": "server",
        "API_URL": "https://api",
        "API_BASE_URL": "https://api/base",
        "WEB_URL": "https://web",
        "E2B_TEMPLATE_REF": "tpl",
        "SUPPORT_FEED_SECRET_ARN": "arn:secret",
        "SUPPORT_TRACKER_ENABLED": "false",
        # Container names default to nonempty literals in the workflow env; the
        # bash body reads them straight from the environment, so supply them.
        "ECS_WORKER_CONTAINER_NAME": "worker",
        "ECS_BEAT_CONTAINER_NAME": "beat",
        "ECS_WORKER_SERVICE": "",
        "ECS_BEAT_SERVICE": "",
    }
    base_env.update(env)
    return subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env=base_env,
        cwd=REPO_ROOT,
    )


@pytest.mark.parametrize(
    (
        "environment",
        "role_name",
        "expected_execution_role_name",
        "expected_secret_name",
        "expected_background_secret_name",
    ),
    [
        (
            "staging",
            "proliferate-staging-github-actions-deploy",
            "proliferate-staging-ecs-execution",
            "proliferate/staging/server-app",
            "proliferate/staging/background/redbeat-redis-url",
        ),
        (
            "Production",
            "proliferate-prod-github-actions-deploy",
            "proliferate-prod-ecs-execution",
            "proliferate/prod/server-app",
            "proliferate/production/background/redbeat-redis-url",
        ),
        (
            "production",
            "proliferate-prod-github-actions-deploy",
            "proliferate-prod-ecs-execution",
            "proliferate/prod/server-app",
            "proliferate/production/background/redbeat-redis-url",
        ),
    ],
)
def test_validate_config_exports_checked_in_redis_owner(
    environment: str,
    role_name: str,
    expected_execution_role_name: str,
    expected_secret_name: str,
    expected_background_secret_name: str,
    tmp_path: Path,
) -> None:
    result = _run_validate_config(
        tmp_path,
        {
            "DEPLOY_ENVIRONMENT": environment,
            "AWS_DEPLOY_ROLE_ARN": f"arn:aws:iam::157466816238:role/{role_name}",
        },
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "github-env").read_text() == (
        "AWS_REGION=us-east-1\n"
        "EXPECTED_AWS_ACCOUNT_ID=157466816238\n"
        f"EXPECTED_ECS_EXECUTION_ROLE_NAME={expected_execution_role_name}\n"
        "EXPECTED_BACKGROUND_REDIS_SERVICE=secretsmanager\n"
        f"EXPECTED_BACKGROUND_REDIS_NAME={expected_background_secret_name}\n"
        f"REDBEAT_REDIS_SECRET_NAME={expected_secret_name}\n"
    )
    assert (tmp_path / "github-output").read_text() == "aws_region=us-east-1\n"


@pytest.mark.parametrize(
    "overrides",
    [
        {"DEPLOY_ENVIRONMENT": "development"},
        {
            "AWS_DEPLOY_ROLE_ARN": (
                "arn:aws:iam::111122223333:role/proliferate-staging-github-actions-deploy"
            )
        },
        {
            "DEPLOY_ENVIRONMENT": "production",
            "AWS_DEPLOY_ROLE_ARN": (
                "arn:aws:iam::157466816238:role/proliferate-staging-github-actions-deploy"
            ),
        },
        {"AWS_DEPLOY_ROLE_ARN": "not-an-arn"},
    ],
)
def test_validate_config_rejects_unbound_hosted_identity(
    overrides: dict[str, str], tmp_path: Path
) -> None:
    result = _run_validate_config(tmp_path, overrides)

    assert result.returncode != 0
    assert "REDBEAT_REDIS_SECRET_NAME=" not in (
        (tmp_path / "github-env").read_text() if (tmp_path / "github-env").exists() else ""
    )
    combined = result.stdout + result.stderr
    for value in overrides.values():
        assert value not in combined


def test_validate_config_rejects_partial_background_plane(tmp_path: Path) -> None:
    worker_only = _run_validate_config(tmp_path, {"ECS_WORKER_SERVICE": "worker-svc"})
    assert worker_only.returncode != 0
    assert "Partial background-plane configuration" in worker_only.stderr

    beat_only = _run_validate_config(tmp_path, {"ECS_BEAT_SERVICE": "beat-svc"})
    assert beat_only.returncode != 0
    assert "Partial background-plane configuration" in beat_only.stderr


@pytest.mark.parametrize("template", [" ", " leading", "trailing "])
def test_validate_rejects_noncanonical_e2b_template(template: str, tmp_path: Path) -> None:
    result = _run_validate_config(tmp_path, {"E2B_TEMPLATE_REF": template})
    assert result.returncode != 0
    assert "no leading or trailing whitespace" in result.stderr


def test_validate_config_allows_complete_and_absent_background_plane(tmp_path: Path) -> None:
    # Neither set: API-only deploy, background plane skipped cleanly.
    neither = _run_validate_config(tmp_path, {})
    assert neither.returncode == 0, neither.stderr

    # Both set: complete config passes validation.
    both = _run_validate_config(
        tmp_path,
        {"ECS_WORKER_SERVICE": "worker-svc", "ECS_BEAT_SERVICE": "beat-svc"},
    )
    assert both.returncode == 0, both.stderr


def _container_match_count(tmp_path: Path, task_def: dict, container: str) -> int:
    """Run the exact match-count jq the roll_service function uses."""

    raw = tmp_path / "td.json"
    raw.write_text(json.dumps(task_def))
    proc = subprocess.run(
        [
            "jq",
            "--arg",
            "container",
            container,
            "[.containerDefinitions[] | select(.name == $container)] | length",
            str(raw),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    return int(proc.stdout.strip())


@_requires_jq
def test_roll_service_container_match_count(tmp_path: Path) -> None:
    # The roll_service function fails closed unless exactly one container matches
    # the configured name. Prove the match-count expression distinguishes the
    # matched, missing, and duplicate cases so a wrong name can never register
    # and roll the old image while reporting success.
    task_def = {
        "containerDefinitions": [
            {"name": "worker", "image": "old:tag"},
            {"name": "sidecar", "image": "other:tag"},
        ]
    }
    assert _container_match_count(tmp_path, task_def, "worker") == 1
    assert _container_match_count(tmp_path, task_def, "nonexistent") == 0

    dup = {"containerDefinitions": [{"name": "worker"}, {"name": "worker"}]}
    assert _container_match_count(tmp_path, dup, "worker") == 2


def _write_fake_aws(bin_dir: Path, *, heartbeat: str, receipt_attempt: str) -> None:
    """Write a fake `aws` CLI that stubs every call the proof step makes.

    ECS calls return canned success (a running service with a network config, a
    stopped task with exit code 0). `cloudwatch get-metric-statistics` returns the
    requested RelayHeartbeat Sum. `logs filter-log-events` serves the two
    correlation queries the proof makes, keyed to the RUN ATTEMPT so a rerun is
    modeled faithfully:

    * the enqueue-receipt recovery derives the committed outbox id from
      ``GITHUB_RUN_ATTEMPT`` (each attempt enqueues a FRESH row, because the real
      proof_key now includes the attempt), and emits
      ``enqueued_health_noop outbox_id=<id> idempotency_key=<proof_key>``;
    * the exact-ID execution-receipt count returns 1 ONLY when the queried task_id
      equals the id for ``RECEIPT_ATTEMPT`` (the attempt whose row actually
      executed). When ``RECEIPT_ATTEMPT`` differs from the current attempt (a
      leftover receipt from a PRIOR attempt, or an unrelated concurrent no-op) or
      is empty, the count is 0, so the gate must fail closed. No real AWS is
      contacted.
    """

    script = f"""#!/usr/bin/env bash
set -euo pipefail
args="$*"
attempt="${{GITHUB_RUN_ATTEMPT:-1}}"
current_id="deadbeef-0000-4000-8000-0000000000${{attempt}}"
receipt_attempt="${{RECEIPT_ATTEMPT:-}}"
receipt_id=""
if [ -n "$receipt_attempt" ]; then
  receipt_id="deadbeef-0000-4000-8000-0000000000${{receipt_attempt}}"
fi
case "$args" in
  *"ecs describe-services"*)
    # Minimal service JSON: a network config for run-task and a task def arn.
    cat <<'JSON'
{{"services":[{{"taskDefinition":"arn:aws:ecs:us-east-1:1:task-definition/worker:1","runningCount":1,"networkConfiguration":{{"awsvpcConfiguration":{{"subnets":["subnet-1"],"securityGroups":["sg-1"],"assignPublicIp":"ENABLED"}}}}}}]}}
JSON
    ;;
  *"ecs run-task"*)
    echo "arn:aws:ecs:us-east-1:1:task/abc123"
    ;;
  *"ecs wait tasks-stopped"*)
    exit 0
    ;;
  *"ecs describe-tasks"*)
    # exitCode query -> 0 (enqueue succeeded)
    echo 0
    ;;
  *"cloudwatch get-metric-statistics"*)
    if [[ "$args" == *"RelayHeartbeat"* ]]; then
      echo "{heartbeat}"
    else
      echo None
    fi
    ;;
  *"logs filter-log-events"*)
    receipt_needle="background_health_receipt.task_id = \\"${{receipt_id}}\\""
    if [[ "$args" == *"enqueued_health_noop"* ]]; then
      # This attempt's committed row id (fresh per attempt).
      echo "enqueued_health_noop outbox_id=${{current_id}} idempotency_key=key"
    elif [ -n "$receipt_id" ] && [[ "$args" == *"$receipt_needle"* ]]; then
      # A fresh exact-ID execution receipt exists for the receipt_attempt row.
      echo 1
    else
      # No receipt for the queried id.
      echo 0
    fi
    ;;
  *)
    echo None
    ;;
esac
"""
    aws_path = bin_dir / "aws"
    aws_path.write_text(script)
    aws_path.chmod(0o755)


def _run_candidate_proof(
    tmp_path: Path,
    *,
    heartbeat: str,
    receipt_attempt: str = "",
    run_attempt: str = "1",
    timeout_seconds: str = "2",
) -> subprocess.CompletedProcess[str]:
    """Execute the real 'Prove candidate plane executes enqueued work' bash body.

    Runs against a fake `aws` on PATH with a short timeout and poll so the loop
    completes quickly. This exercises the ACTUAL shell that runs in CI, not a
    paraphrase, so the fail-closed behavior is proven on the shipped logic.
    """

    body = str(_deploy_steps()["Prove candidate plane executes enqueued work"]["run"])
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_fake_aws(bin_dir, heartbeat=heartbeat, receipt_attempt=receipt_attempt)
    script = tmp_path / "proof.sh"
    script.write_text(body)
    env = {
        "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
        "DEPLOY_ENVIRONMENT": "staging",
        "GIT_SHA": "deadbeefcafe",
        "GITHUB_RUN_ID": "42",
        "GITHUB_RUN_ATTEMPT": run_attempt,
        "RECEIPT_ATTEMPT": receipt_attempt,
        "ECS_CLUSTER": "cluster",
        "ECS_WORKER_SERVICE": "worker-svc",
        "ECS_BEAT_SERVICE": "beat-svc",
        "ECS_WORKER_CONTAINER_NAME": "worker",
        "CANDIDATE_PROOF_LOG_GROUP": "test-log-group",
        "CANDIDATE_PROOF_TIMEOUT_SECONDS": timeout_seconds,
        "CANDIDATE_PROOF_POLL_SECONDS": "1",
    }
    return subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env=env,
        cwd=tmp_path,
    )


@_requires_jq
def test_candidate_proof_fails_closed_when_plane_does_not_execute(tmp_path: Path) -> None:
    # No fresh datapoints for either signal: no heartbeat and no exact-ID receipt
    # for the enqueued row. The candidate worker/Beat plane never executed the
    # enqueued work, so the proof must FAIL CLOSED on timeout and the API roll
    # (the next step) never runs. No receipt attempt -> no receipt exists.
    result = _run_candidate_proof(tmp_path, heartbeat="None", receipt_attempt="")
    assert result.returncode != 0
    assert "FAILED CLOSED" in result.stderr


@_requires_jq
def test_candidate_proof_fails_closed_when_only_heartbeat_advances(tmp_path: Path) -> None:
    # Beat/store alive (heartbeat advances) but the enqueued health no-op never
    # executes (no matching exact-ID receipt): a broken worker consume/route path.
    # The proof requires BOTH signals, so this still fails closed.
    result = _run_candidate_proof(tmp_path, heartbeat="3", receipt_attempt="")
    assert result.returncode != 0
    assert "FAILED CLOSED" in result.stderr


@_requires_jq
def test_candidate_proof_fails_closed_on_unrelated_health_noop(tmp_path: Path) -> None:
    # NEGATIVE PROOF (concurrent/unrelated): the heartbeat advances AND a FRESH
    # exact-ID receipt exists, but only for an UNRELATED health no-op (a concurrent
    # deploy, operator smoke, or retry) whose id differs from the row THIS run
    # enqueued. The gate correlates on the enqueued outbox id, so the mismatch must
    # still FAIL CLOSED — an aggregate "any success" metric would have wrongly
    # passed here. Current attempt 1, receipt only for a different id (attempt 9).
    result = _run_candidate_proof(tmp_path, heartbeat="2", run_attempt="1", receipt_attempt="9")
    assert result.returncode != 0
    assert "FAILED CLOSED" in result.stderr


@_requires_jq
def test_candidate_proof_fails_closed_on_rerun_with_prior_attempt_receipt(tmp_path: Path) -> None:
    # NEGATIVE PROOF (rerun replay): a workflow RERUN. Because the proof_key now
    # includes GITHUB_RUN_ATTEMPT, attempt 2 enqueues a FRESH row (id for attempt
    # 2). Only the PRIOR attempt's row (attempt 1) has an execution receipt in the
    # logs. An attempt-agnostic key would have replayed the already-published
    # attempt-1 row and false-passed on its stale receipt; with the attempt in the
    # key, this attempt's fresh row has no receipt, so the gate FAILS CLOSED.
    result = _run_candidate_proof(tmp_path, heartbeat="2", run_attempt="2", receipt_attempt="1")
    assert result.returncode != 0
    assert "FAILED CLOSED" in result.stderr


@_requires_jq
def test_candidate_proof_passes_when_exact_id_receipt_and_heartbeat(tmp_path: Path) -> None:
    # Relay heartbeat advanced AND a fresh exact-ID execution receipt exists for
    # the EXACT row THIS attempt enqueued (receipt attempt == current attempt): the
    # plane is proven to execute this newly enqueued work, so the proof passes and
    # the API may roll.
    result = _run_candidate_proof(tmp_path, heartbeat="2", run_attempt="2", receipt_attempt="2")
    assert result.returncode == 0, result.stderr
    assert "Candidate plane proven" in result.stdout


def test_roll_service_asserts_registered_candidate_image() -> None:
    # The deploy step must verify the REGISTERED task def (not just the local
    # file) carries the candidate image on the named container before rolling,
    # and the pre-API health step must re-check the live service image.
    steps = _deploy_steps()
    roll_run = str(steps["Deploy worker and Beat from candidate image"]["run"])
    assert "found ${match_count}" in roll_run
    assert "Registered ${service} task def" in roll_run

    health_run = str(steps["Verify worker and Beat health"]["run"])
    assert "before the API roll" in health_run
    assert "candidate_image" in health_run
