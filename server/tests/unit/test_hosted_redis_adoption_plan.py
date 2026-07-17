"""Safe plan-shape checks for the hosted Redis Terraform adoption."""

from __future__ import annotations

import copy
import json
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CHECKER = REPO_ROOT / "server" / "infra" / "hosted-redis" / "check_adoption_plan.py"
README = REPO_ROOT / "server" / "infra" / "hosted-redis" / "README.md"
CONTRACT = json.loads((REPO_ROOT / "server" / "deploy" / "hosted-redis-contract.json").read_text())
ENVIRONMENTS = ("production", "staging")
POLICY_NAME = "api-redis-secret-read"


def _secret_arn(environment: str) -> str:
    suffix = "Ab12Cd" if environment == "staging" else "Ef34Gh"
    values = CONTRACT["environments"][environment]
    return (
        f"arn:aws:secretsmanager:{CONTRACT['aws_region']}:"
        f"{CONTRACT['aws_account_id']}:secret:{values['secret_name']}-{suffix}"
    )


def _policy(environment: str) -> str:
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "ReadApiRedisSecret",
                    "Effect": "Allow",
                    "Action": ["secretsmanager:GetSecretValue"],
                    "Resource": [_secret_arn(environment)],
                }
            ],
        },
        separators=(",", ":"),
    )


def _values(environment: str, kind: str) -> dict[str, object]:
    role = CONTRACT["environments"][environment][f"{kind}_role_name"]
    return {
        "id": f"{role}:{POLICY_NAME}",
        "name": POLICY_NAME,
        "policy": _policy(environment),
        "role": role,
    }


def _change(environment: str, kind: str, phase: str) -> dict[str, object]:
    creates = phase == "adoption" and kind == "execution"
    values = _values(environment, kind)
    change: dict[str, object] = {
        "actions": ["create"] if creates else ["no-op"],
        "before": None if creates else copy.deepcopy(values),
        "after": copy.deepcopy(values),
        "after_unknown": {"id": True} if creates else {},
    }
    if phase == "adoption" and kind == "deploy":
        role = CONTRACT["environments"][environment]["deploy_role_name"]
        change["importing"] = {"id": f"{role}:{POLICY_NAME}"}
    return {
        "address": f'aws_iam_role_policy.{kind}_secret_read["{environment}"]',
        "mode": "managed",
        "change": change,
    }


def _check(name: str, status: str = "pass") -> dict[str, object]:
    return {
        "address": {"to_display": f"check.{name}"},
        "status": status,
        "instances": [{"status": status}],
    }


def _plan(phase: str) -> dict[str, object]:
    changes = [
        _change(environment, kind, phase)
        for environment in ENVIRONMENTS
        for kind in ("deploy", "execution")
    ]
    changes.append(
        {
            "address": "data.aws_caller_identity.current",
            "mode": "data",
            "change": {"actions": ["read"]},
        }
    )
    return {
        "format_version": "1.2",
        "resource_changes": changes,
        "resource_drift": [],
        "checks": [
            _check("aws_account_binding"),
            _check("secret_identity_binding"),
        ],
    }


def _managed(plan: dict[str, object], address_fragment: str) -> dict[str, object]:
    changes = plan["resource_changes"]
    assert isinstance(changes, list)
    return next(
        change
        for change in changes
        if isinstance(change, dict) and address_fragment in str(change.get("address"))
    )


def _run(plan: dict[str, object], phase: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(CHECKER), phase],
        input=json.dumps(plan),
        capture_output=True,
        text=True,
    )


def _wrong_import(plan: dict[str, object]) -> None:
    resource = _managed(plan, "deploy_secret_read")
    resource["change"]["importing"]["id"] = "wrong-role:api-redis-secret-read"


def _wrong_role(plan: dict[str, object]) -> None:
    resource = _managed(plan, "execution_secret_read")
    resource["change"]["after"]["role"] = "wrong-execution-role"


def _wildcard_policy(plan: dict[str, object]) -> None:
    resource = _managed(plan, "execution_secret_read")
    resource["change"]["after"]["policy"] = json.dumps(
        {"Version": "2012-10-17", "Statement": [{"Action": "*", "Resource": "*"}]}
    )


def _failed_check(plan: dict[str, object]) -> None:
    plan["checks"][0]["status"] = "fail"


def _unknown_policy(plan: dict[str, object]) -> None:
    resource = _managed(plan, "execution_secret_read")
    resource["change"]["after_unknown"]["policy"] = True


def _duplicate_managed(plan: dict[str, object]) -> None:
    resource = _managed(plan, "deploy_secret_read")
    plan["resource_changes"].append(copy.deepcopy(resource))


def _deposed_managed(plan: dict[str, object]) -> None:
    resource = _managed(plan, "deploy_secret_read")
    resource["deposed"] = "synthetic-deposed-key"


def _extra_managed(plan: dict[str, object]) -> None:
    resource = copy.deepcopy(_managed(plan, "deploy_secret_read"))
    resource["address"] = "aws_iam_role_policy.unexpected"
    plan["resource_changes"].append(resource)


def _wrong_account_secret(plan: dict[str, object]) -> None:
    resource = _managed(plan, "execution_secret_read")
    policy = json.loads(resource["change"]["after"]["policy"])
    policy["Statement"][0]["Resource"][0] = policy["Statement"][0]["Resource"][0].replace(
        CONTRACT["aws_account_id"], "111122223333"
    )
    resource["change"]["after"]["policy"] = json.dumps(policy)


def _wrong_region_secret(plan: dict[str, object]) -> None:
    resource = _managed(plan, "execution_secret_read")
    policy = json.loads(resource["change"]["after"]["policy"])
    policy["Statement"][0]["Resource"][0] = policy["Statement"][0]["Resource"][0].replace(
        CONTRACT["aws_region"], "us-west-2"
    )
    resource["change"]["after"]["policy"] = json.dumps(policy)


def test_accepts_exact_contract_bound_adoption_and_steady_state() -> None:
    adoption = _run(_plan("adoption"), "adoption")
    steady = _run(_plan("steady-state"), "steady-state")

    assert adoption.returncode == 0, adoption.stderr
    assert adoption.stdout == (
        "Hosted Redis adoption plan accepted: imports=2 creates=2 updates=0 deletes=0\n"
    )
    assert steady.returncode == 0, steady.stderr
    assert steady.stdout == "Hosted Redis steady-state plan accepted: changes=0 drift=0\n"


def test_accepts_aws_normalized_singleton_action_and_resource() -> None:
    plan = _plan("steady-state")
    for resource in plan["resource_changes"]:
        if not isinstance(resource, dict) or resource.get("mode") != "managed":
            continue
        change = resource["change"]
        for side in ("before", "after"):
            policy = json.loads(change[side]["policy"])
            statement = policy["Statement"][0]
            statement["Action"] = statement["Action"][0]
            statement["Resource"] = statement["Resource"][0]
            change[side]["policy"] = json.dumps(policy)

    result = _run(plan, "steady-state")

    assert result.returncode == 0, result.stderr
    assert result.stdout == "Hosted Redis steady-state plan accepted: changes=0 drift=0\n"


@pytest.mark.parametrize(
    "mutate",
    [
        _wrong_import,
        _wrong_role,
        _wildcard_policy,
        _failed_check,
        _unknown_policy,
        _duplicate_managed,
        _deposed_managed,
        _extra_managed,
        _wrong_account_secret,
        _wrong_region_secret,
    ],
    ids=[
        "wrong-import-id",
        "wrong-role",
        "wildcard-policy",
        "failed-check",
        "unknown-policy",
        "duplicate-managed",
        "deposed-managed",
        "extra-managed",
        "wrong-account-secret",
        "wrong-region-secret",
    ],
)
def test_rejects_unsafe_adoption_without_leaking_plan(
    mutate: Callable[[dict[str, object]], None],
) -> None:
    plan = _plan("adoption")
    mutate(plan)
    plan["sensitive_sentinel"] = "synthetic role/resource ARN must stay hidden"

    result = _run(plan, "adoption")

    assert result.returncode != 0
    assert result.stdout == ""
    assert result.stderr == "Hosted Redis plan rejected; plan details withheld.\n"
    assert "synthetic role/resource ARN" not in result.stdout + result.stderr


@pytest.mark.parametrize("status", ["fail", "unknown", "error"])
def test_rejects_every_nonpassing_check_status(status: str) -> None:
    plan = _plan("steady-state")
    plan["checks"][1]["instances"][0]["status"] = status

    assert _run(plan, "steady-state").returncode != 0


def test_runbook_gates_apply_and_suppresses_plan_diagnostics() -> None:
    runbook = README.read_text()
    adoption_block = runbook.split("```bash", 1)[1].split("```", 1)[0]
    steady_block = runbook.split("```bash", 2)[2].split("```", 1)[0]
    adoption_commands = " ".join(adoption_block.replace("\\\n", " ").split())
    steady_commands = " ".join(steady_block.replace("\\\n", " ").split())

    assert adoption_block.strip().startswith("(\n  set -euo pipefail")
    assert "check_adoption_plan.py adoption" in adoption_commands
    assert adoption_commands.index("check_adoption_plan.py adoption") < adoption_commands.index(
        " apply hosted-redis.tfplan"
    )
    assert "show -json hosted-redis.tfplan 2>/dev/null" in adoption_commands
    assert "show -json hosted-redis-steady.tfplan 2>/dev/null" in steady_commands
    assert steady_block.strip().startswith("(\n  set -euo pipefail")
