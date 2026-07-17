#!/usr/bin/env python3
"""Validate hosted Redis Terraform plans without printing plan contents."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "deploy/hosted-redis-contract.json"
ENVIRONMENTS = ("production", "staging")
POLICY_NAME = "api-redis-secret-read"
EXPECTED_CHECKS = {
    "check.aws_account_binding",
    "check.secret_identity_binding",
}
MANAGED_VALUE_FIELDS = ("name", "policy", "role")


def _address(kind: str, environment: str) -> str:
    return f'aws_iam_role_policy.{kind}_secret_read["{environment}"]'


def _load_contract() -> dict[str, object]:
    try:
        contract = json.loads(CONTRACT_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("hosted contract is unavailable") from error
    if not isinstance(contract, dict):
        raise ValueError("hosted contract must be an object")

    account_id = contract.get("aws_account_id")
    region = contract.get("aws_region")
    environments = contract.get("environments")
    if not isinstance(account_id, str) or re.fullmatch(r"[0-9]{12}", account_id) is None:
        raise ValueError("hosted account is malformed")
    if not isinstance(region, str) or re.fullmatch(r"[a-z]{2}-[a-z0-9-]+-[0-9]+", region) is None:
        raise ValueError("hosted region is malformed")
    if not isinstance(environments, dict) or set(environments) != set(ENVIRONMENTS):
        raise ValueError("hosted environment set differs from the adoption contract")

    for environment in ENVIRONMENTS:
        values = environments.get(environment)
        if not isinstance(values, dict):
            raise ValueError("hosted environment must be an object")
        secret_name = values.get("secret_name")
        background_redis_service = values.get("background_redis_reference_service")
        background_redis_name = values.get("background_redis_reference_name")
        deploy_role = values.get("deploy_role_name")
        execution_role = values.get("execution_role_name")
        if background_redis_service not in {"secretsmanager", "ssm"}:
            raise ValueError("hosted background Redis service is malformed")
        for managed_secret_name in (secret_name, background_redis_name):
            if (
                not isinstance(managed_secret_name, str)
                or re.fullmatch(r"[A-Za-z0-9/_+=.@-]+", managed_secret_name) is None
            ):
                raise ValueError("hosted secret name is malformed")
        for role in (deploy_role, execution_role):
            if not isinstance(role, str) or re.fullmatch(r"[A-Za-z0-9_+=,.@-]+", role) is None:
                raise ValueError("hosted role name is malformed")
    return contract


def _expected(
    phase: str, contract: dict[str, object]
) -> dict[str, tuple[list[str], bool, str, str]]:
    environments = contract["environments"]
    assert isinstance(environments, dict)
    expected: dict[str, tuple[list[str], bool, str, str]] = {}
    for environment in ENVIRONMENTS:
        values = environments[environment]
        assert isinstance(values, dict)
        deploy_role = values["deploy_role_name"]
        execution_role = values["execution_role_name"]
        assert isinstance(deploy_role, str)
        assert isinstance(execution_role, str)
        expected[_address("deploy", environment)] = (
            ["no-op"],
            phase == "adoption",
            environment,
            deploy_role,
        )
        expected[_address("execution", environment)] = (
            ["create"] if phase == "adoption" else ["no-op"],
            False,
            environment,
            execution_role,
        )
    return expected


def _contains_unknown(value: object) -> bool:
    if value is None or value is False:
        return False
    if value is True:
        return True
    if isinstance(value, dict):
        return any(_contains_unknown(child) for child in value.values())
    if isinstance(value, list):
        return any(_contains_unknown(child) for child in value)
    return True


def _secret_pattern(contract: dict[str, object], environment: str) -> re.Pattern[str]:
    account_id = contract["aws_account_id"]
    region = contract["aws_region"]
    environments = contract["environments"]
    assert isinstance(account_id, str)
    assert isinstance(region, str)
    assert isinstance(environments, dict)
    values = environments[environment]
    assert isinstance(values, dict)
    secret_name = values["secret_name"]
    assert isinstance(secret_name, str)
    return re.compile(
        rf"arn:aws:secretsmanager:{re.escape(region)}:{re.escape(account_id)}:"
        rf"secret:{re.escape(secret_name)}-[A-Za-z0-9]{{6}}"
    )


def _validate_policy_values(
    values: object,
    *,
    contract: dict[str, object],
    environment: str,
    expected_role: str,
) -> str:
    if not isinstance(values, dict):
        raise ValueError("managed policy values are missing")
    if values.get("name") != POLICY_NAME or values.get("role") != expected_role:
        raise ValueError("managed policy identity differs from the hosted contract")
    policy_text = values.get("policy")
    if not isinstance(policy_text, str):
        raise ValueError("managed policy document is missing")
    try:
        policy = json.loads(policy_text)
    except json.JSONDecodeError as error:
        raise ValueError("managed policy document is malformed") from error
    if not isinstance(policy, dict):
        raise ValueError("managed policy document must be an object")

    if set(policy) != {"Version", "Statement"} or policy.get("Version") != "2012-10-17":
        raise ValueError("managed policy envelope differs from the hosted contract")
    statements = policy.get("Statement")
    if not isinstance(statements, list) or len(statements) != 1:
        raise ValueError("managed policy must contain one statement")
    statement = statements[0]
    if not isinstance(statement, dict):
        raise ValueError("managed policy statement is malformed")
    if set(statement) != {"Sid", "Effect", "Action", "Resource"}:
        raise ValueError("managed policy statement differs from the hosted contract")
    if statement.get("Sid") != "ReadApiRedisSecret" or statement.get("Effect") != "Allow":
        raise ValueError("managed policy statement differs from the hosted contract")

    # AWS normalizes singleton IAM Action/Resource arrays to scalar strings on
    # read. Accept only those two semantically identical encodings; multiple or
    # non-string values remain rejected.
    actions = statement.get("Action")
    if isinstance(actions, list) and len(actions) == 1:
        actions = actions[0]
    if actions != "secretsmanager:GetSecretValue":
        raise ValueError("managed policy permissions differ from the hosted contract")
    resources = statement.get("Resource")
    if isinstance(resources, list) and len(resources) == 1:
        resources = resources[0]
    if not isinstance(resources, str):
        raise ValueError("managed policy must contain one resource")
    secret_arn = resources
    if _secret_pattern(contract, environment).fullmatch(secret_arn) is None:
        raise ValueError("managed policy secret differs from the hosted contract")
    return secret_arn


def _validate_checks(plan: dict[str, object]) -> None:
    checks = plan.get("checks")
    if not isinstance(checks, list):
        raise ValueError("Terraform checks are missing")
    seen: set[str] = set()
    for check in checks:
        if not isinstance(check, dict):
            raise ValueError("Terraform check is malformed")
        address = check.get("address")
        if not isinstance(address, dict) or not isinstance(address.get("to_display"), str):
            raise ValueError("Terraform check address is malformed")
        display = address["to_display"]
        if display in seen:
            raise ValueError("duplicate Terraform check is present")
        seen.add(display)
        if check.get("status") != "pass":
            raise ValueError("Terraform check did not pass")
        instances = check.get("instances", [])
        if not isinstance(instances, list) or any(
            not isinstance(instance, dict) or instance.get("status") != "pass"
            for instance in instances
        ):
            raise ValueError("Terraform check instance did not pass")
    if not EXPECTED_CHECKS.issubset(seen):
        raise ValueError("required Terraform checks are missing")


def validate(plan: object, phase: str) -> str:
    if not isinstance(plan, dict):
        raise ValueError("plan must be an object")
    format_version = plan.get("format_version")
    if not isinstance(format_version, str) or format_version.split(".", 1)[0] != "1":
        raise ValueError("unsupported plan format")

    contract = _load_contract()
    _validate_checks(plan)

    changes = plan.get("resource_changes")
    if not isinstance(changes, list):
        raise ValueError("resource changes are missing")
    managed: dict[str, dict[str, object]] = {}
    for resource in changes:
        if not isinstance(resource, dict):
            raise ValueError("resource change is malformed")
        if resource.get("mode") != "managed":
            continue
        address = resource.get("address")
        if not isinstance(address, str):
            raise ValueError("managed resource address is malformed")
        if address in managed:
            raise ValueError("duplicate managed resource is present")
        if resource.get("deposed") is not None:
            raise ValueError("deposed managed resource is present")
        managed[address] = resource

    expected = _expected(phase, contract)
    if set(managed) != set(expected):
        raise ValueError("managed resource set differs from the adoption contract")

    resolved_secret_arns: dict[str, str] = {}
    for address, (
        expected_actions,
        must_import,
        environment,
        expected_role,
    ) in expected.items():
        change = managed[address].get("change")
        if not isinstance(change, dict) or change.get("actions") != expected_actions:
            raise ValueError("managed action differs from the adoption contract")

        importing = change.get("importing")
        if must_import:
            expected_import = {"id": f"{expected_role}:{POLICY_NAME}"}
            if importing != expected_import:
                raise ValueError("deploy policy import differs from the hosted contract")
        elif importing is not None:
            raise ValueError("unexpected import is present")

        after_unknown = change.get("after_unknown", {})
        if not isinstance(after_unknown, dict) or any(
            _contains_unknown(after_unknown.get(field)) for field in MANAGED_VALUE_FIELDS
        ):
            raise ValueError("managed policy identity remains unknown")

        after_secret_arn = _validate_policy_values(
            change.get("after"),
            contract=contract,
            environment=environment,
            expected_role=expected_role,
        )
        if expected_actions == ["no-op"]:
            before_secret_arn = _validate_policy_values(
                change.get("before"),
                contract=contract,
                environment=environment,
                expected_role=expected_role,
            )
            if before_secret_arn != after_secret_arn:
                raise ValueError("managed policy secret changes during adoption")
        elif change.get("before") is not None:
            raise ValueError("created policy unexpectedly has prior state")

        prior_secret_arn = resolved_secret_arns.setdefault(environment, after_secret_arn)
        if prior_secret_arn != after_secret_arn:
            raise ValueError("environment policies resolve different secrets")

    drift = plan.get("resource_drift", [])
    if not isinstance(drift, list) or drift:
        raise ValueError("resource drift is present")

    if phase == "adoption":
        return "Hosted Redis adoption plan accepted: imports=2 creates=2 updates=0 deletes=0"
    return "Hosted Redis steady-state plan accepted: changes=0 drift=0"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("adoption", "steady-state"))
    args = parser.parse_args()
    try:
        plan = json.load(sys.stdin)
        print(validate(plan, args.phase))
        return 0
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        print("Hosted Redis plan rejected; plan details withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
