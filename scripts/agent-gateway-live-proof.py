#!/usr/bin/env python3
"""Live proof harness for Phase 3 managed credits and BYOK readiness.

With --require-live, missing endpoints or provider credentials are failures.
Without it, unavailable live surfaces are reported as SKIP so the script is
safe in ordinary local test runs. Secrets, virtual keys, role ARNs, and
external IDs are redacted from output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


@dataclass(frozen=True)
class Result:
    name: str
    status: str
    detail: str


ENV_ALIASES = {
    "LITELLM_PROXY_URL": ("AGENT_GATEWAY_LITELLM_BASE_URL",),
    "LITELLM_MASTER_KEY": ("AGENT_GATEWAY_LITELLM_MASTER_KEY",),
    "PHASE3_GATEWAY_BASE_URL": ("AGENT_GATEWAY_PUBLIC_BASE_URL",),
    "PROLIFERATE_API_BASE_URL": ("API_BASE_URL",),
}


def env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value:
        return value
    for alias in ENV_ALIASES.get(name, ()):
        value = os.environ.get(alias)
        if value:
            return value
    return default


def require(names: list[str]) -> list[str]:
    return [name for name in names if not env(name)]


def redact(text: str) -> str:
    for name in (
        "PROLIFERATE_TEST_USER_TOKEN",
        "PROLIFERATE_TEST_ADMIN_TOKEN",
        "LITELLM_MASTER_KEY",
        "AGENT_GATEWAY_LITELLM_MASTER_KEY",
        "PHASE3_ANTHROPIC_API_KEY",
        "PHASE3_OPENAI_API_KEY",
        "PHASE3_BEDROCK_ROLE_ARN",
        "PHASE3_BEDROCK_EXTERNAL_ID",
        "PHASE3_BEDROCK_WRONG_EXTERNAL_ID",
    ):
        value = env(name)
        if value:
            text = text.replace(value, "[REDACTED]")
    return text[:1200]


def result(name: str, status: str, detail: str) -> Result:
    return Result(name=name, status=status, detail=detail)


def truthy(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def script_sha256() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def request_json(
    method: str,
    base_url: str,
    path: str,
    *,
    token: str = "",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any] | str]:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=payload,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = exc.code
    except urllib.error.URLError as exc:
        return 599, str(exc)
    text = raw.decode("utf-8", errors="replace")
    try:
        return status, json.loads(text) if text else {}
    except json.JSONDecodeError:
        return status, text


def expect_2xx(
    name: str,
    status: int,
    payload: dict[str, Any] | str,
    action: str,
) -> Result | None:
    if 200 <= status < 300:
        return None
    return result(name, FAIL, f"{action} failed with HTTP {status}: {redact(str(payload))}")


def missing_live_status(require_live: bool) -> str:
    return FAIL if require_live else SKIP


def litellm_health(require_live: bool) -> Result:
    missing = require(["LITELLM_PROXY_URL", "LITELLM_MASTER_KEY"])
    if missing:
        return result(
            "litellm-health",
            missing_live_status(require_live),
            f"Missing {', '.join(missing)}.",
        )
    status, payload = request_json(
        "GET",
        env("LITELLM_PROXY_URL"),
        "/health/readiness",
        token=env("LITELLM_MASTER_KEY"),
        timeout=10,
    )
    failure = expect_2xx("litellm-health", status, payload, "LiteLLM readiness")
    return failure or result("litellm-health", PASS, "LiteLLM readiness endpoint is healthy.")


def gateway_health(require_live: bool) -> Result:
    missing = require(["PHASE3_GATEWAY_BASE_URL"])
    if missing:
        return result(
            "gateway-health",
            missing_live_status(require_live),
            f"Missing {', '.join(missing)}.",
        )
    status, payload = request_json("GET", env("PHASE3_GATEWAY_BASE_URL"), "/agent-gateway/health")
    failure = expect_2xx("gateway-health", status, payload, "Gateway health")
    return failure or result("gateway-health", PASS, "Gateway health endpoint is healthy.")


def litellm_admin(path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any] | str]:
    return request_json(
        "POST",
        env("LITELLM_PROXY_URL"),
        path,
        token=env("LITELLM_MASTER_KEY"),
        body=body,
    )


def prove_litellm_team_key(prefix: str, require_live: bool) -> list[Result]:
    missing = require(["LITELLM_PROXY_URL", "LITELLM_MASTER_KEY"])
    if missing:
        return [
            result(
                f"{prefix}-litellm-team-key",
                missing_live_status(require_live),
                f"Missing {', '.join(missing)}.",
            )
        ]
    team_alias = env("PHASE3_LITELLM_TEAM_ALIAS", "phase3-live-proof")
    status, payload = litellm_admin(
        "/team/new",
        {
            "team_alias": team_alias,
            "models": [],
            "max_budget": float(env("PHASE3_LITELLM_TEST_BUDGET_USD", "0.01")),
            "budget_duration": env("PHASE3_LITELLM_TEST_BUDGET_DURATION", "1d"),
        },
    )
    failure = expect_2xx(f"{prefix}-litellm-team", status, payload, "LiteLLM team create")
    if failure:
        return [failure]
    team_id = payload.get("team_id") if isinstance(payload, dict) else None
    if not isinstance(team_id, str) or not team_id:
        return [result(f"{prefix}-litellm-team", FAIL, "LiteLLM did not return team_id.")]
    status, payload = litellm_admin(
        "/key/generate",
        {"team_id": team_id, "key_alias": f"{team_alias}-key"},
    )
    failure = expect_2xx(f"{prefix}-litellm-key", status, payload, "LiteLLM key generate")
    if failure:
        return [failure]
    key = payload.get("key") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not key:
        return [result(f"{prefix}-litellm-key", FAIL, "LiteLLM did not return a virtual key.")]
    status, payload = request_json("GET", env("LITELLM_PROXY_URL"), "/v1/models", token=key)
    failure = expect_2xx(f"{prefix}-litellm-models", status, payload, "LiteLLM key models")
    return [failure] if failure else [
        result(f"{prefix}-litellm-team-key", PASS, "Created LiteLLM team/key and listed models.")
    ]


def create_litellm_team_key(
    prefix: str,
    require_live: bool,
) -> tuple[list[Result], str | None]:
    missing = require(["LITELLM_PROXY_URL", "LITELLM_MASTER_KEY"])
    if missing:
        return [
            result(
                f"{prefix}-litellm-team-key",
                missing_live_status(require_live),
                f"Missing {', '.join(missing)}.",
            )
        ], None
    team_alias = env("PHASE3_LITELLM_TEAM_ALIAS", f"phase3-{prefix}")
    status, payload = litellm_admin(
        "/team/new",
        {
            "team_alias": team_alias,
            "models": [],
            "max_budget": float(env("PHASE3_LITELLM_TEST_BUDGET_USD", "0.01")),
            "budget_duration": env("PHASE3_LITELLM_TEST_BUDGET_DURATION", "1d"),
        },
    )
    failure = expect_2xx(f"{prefix}-litellm-team", status, payload, "LiteLLM team create")
    if failure:
        return [failure], None
    team_id = payload.get("team_id") if isinstance(payload, dict) else None
    if not isinstance(team_id, str) or not team_id:
        return [result(f"{prefix}-litellm-team", FAIL, "LiteLLM did not return team_id.")], None
    status, payload = litellm_admin(
        "/key/generate",
        {"team_id": team_id, "key_alias": f"{team_alias}-key"},
    )
    failure = expect_2xx(f"{prefix}-litellm-key", status, payload, "LiteLLM key generate")
    if failure:
        return [failure], None
    key = payload.get("key") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not key:
        return [
            result(f"{prefix}-litellm-key", FAIL, "LiteLLM did not return a virtual key.")
        ], None
    return [result(f"{prefix}-litellm-team-key", PASS, "Created LiteLLM runtime team/key.")], key


def route_isolation(require_live: bool) -> list[Result]:
    results = [litellm_health(require_live)]
    if env("AGENT_GATEWAY_LITELLM_TOPOLOGY", "enterprise_shared") == "enterprise_shared" and (
        not truthy(env("LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES"))
    ):
        status = FAIL if require_live else SKIP
        results.append(
            result(
                "route-isolation-credential-overrides",
                status,
                "Missing LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true.",
            )
        )
        return results
    key_results, runtime_key = create_litellm_team_key("route-isolation", require_live)
    results.extend(key_results)
    if runtime_key is None:
        return results
    admin_paths = {
        "/team/new": {"team_alias": "route-isolation-forbidden", "models": []},
        "/key/generate": {"team_id": "route-isolation-forbidden"},
        "/model/new": {
            "model_name": "route-isolation-forbidden",
            "litellm_params": {"model": "openai/gpt-4o-mini"},
        },
        "/credentials": {
            "credential_name": "route-isolation-forbidden",
            "credential_info": {"custom_llm_provider": "openai"},
            "credential_values": {"api_key": "sk-forbidden"},
        },
    }
    for path, body in admin_paths.items():
        status, payload = request_json(
            "POST",
            env("LITELLM_PROXY_URL"),
            path,
            token=runtime_key,
            body=body,
        )
        if status in {401, 403}:
            results.append(
                result(
                    f"route-isolation-runtime-key-denied-{path.strip('/').replace('/', '-')}",
                    PASS,
                    f"Runtime key was denied for {path}.",
                )
            )
        else:
            results.append(
                result(
                    f"route-isolation-runtime-key-denied-{path.strip('/').replace('/', '-')}",
                    FAIL,
                    (
                        f"Runtime key unexpectedly reached {path}: "
                        f"HTTP {status} {redact(str(payload))}"
                    ),
                )
            )
    return results


def managed_credits(require_live: bool) -> list[Result]:
    results = [litellm_health(require_live), gateway_health(require_live)]
    if require_live or (env("LITELLM_PROXY_URL") and env("LITELLM_MASTER_KEY")):
        results.extend(prove_litellm_team_key("managed-credits", require_live))
    missing = require(["PROLIFERATE_API_BASE_URL", "PROLIFERATE_TEST_USER_TOKEN"])
    if missing:
        status = FAIL if require_live else SKIP
        results.append(
            result("managed-credits-preflight", status, f"Missing {', '.join(missing)}.")
        )
        return results
    body = {
        "ownerScope": "personal",
        "targetKind": "personal_cloud",
        "requiredAgentKind": "claude",
        "requiredManagedResources": ["compute", "llm", "gateway"],
    }
    status, payload = request_json(
        "POST",
        env("PROLIFERATE_API_BASE_URL"),
        "/v1/cloud/workspaces/launch-preflight",
        token=env("PROLIFERATE_TEST_USER_TOKEN"),
        body=body,
    )
    failure = expect_2xx("managed-credits-preflight", status, payload, "launch preflight")
    results.append(
        failure or result("managed-credits-preflight", PASS, redact(json.dumps(payload)))
    )
    return results


def byok_anthropic(require_live: bool) -> list[Result]:
    results = [litellm_health(require_live), gateway_health(require_live)]
    missing = require(["PHASE3_ANTHROPIC_API_KEY"])
    if missing:
        status = FAIL if require_live else SKIP
        results.append(result("byok-anthropic", status, f"Missing {', '.join(missing)}."))
        return results
    status, payload = request_json(
        "POST",
        env("PHASE3_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
        "/v1/messages",
        headers={
            "x-api-key": env("PHASE3_ANTHROPIC_API_KEY"),
            "anthropic-version": env("PHASE3_ANTHROPIC_VERSION", "2023-06-01"),
        },
        body={
            "model": env("PHASE3_ANTHROPIC_MODEL", "claude-3-5-haiku-latest"),
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}],
        },
    )
    failure = expect_2xx("byok-anthropic", status, payload, "Anthropic low-token request")
    results.append(
        failure or result("byok-anthropic", PASS, "Anthropic key passed live validation.")
    )
    return results


def byok_openai(require_live: bool) -> list[Result]:
    results = [litellm_health(require_live), gateway_health(require_live)]
    missing = require(["PHASE3_OPENAI_API_KEY"])
    if missing:
        status = FAIL if require_live else SKIP
        results.append(result("byok-openai", status, f"Missing {', '.join(missing)}."))
        return results
    status, payload = request_json(
        "GET",
        env("PHASE3_OPENAI_BASE_URL", "https://api.openai.com"),
        "/v1/models",
        token=env("PHASE3_OPENAI_API_KEY"),
    )
    failure = expect_2xx("byok-openai", status, payload, "OpenAI models request")
    results.append(failure or result("byok-openai", PASS, "OpenAI key passed live validation."))
    return results


def aws_json(
    args: list[str],
    *,
    extra_env: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any] | str]:
    if shutil.which("aws") is None:
        return 127, "AWS CLI is not installed."
    completed = subprocess.run(
        ["aws", *args, "--output", "json"],
        check=False,
        text=True,
        capture_output=True,
        env={**os.environ, **(extra_env or {})},
    )
    raw = completed.stdout if completed.returncode == 0 else completed.stderr
    try:
        payload: dict[str, Any] | str = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = raw
    return completed.returncode, payload


def byok_bedrock(require_live: bool) -> list[Result]:
    results = [litellm_health(require_live), gateway_health(require_live)]
    missing = require(
        ["PHASE3_BEDROCK_ROLE_ARN", "PHASE3_BEDROCK_REGION", "PHASE3_BEDROCK_EXTERNAL_ID"]
    )
    if missing:
        status = FAIL if require_live else SKIP
        results.append(result("byok-bedrock", status, f"Missing {', '.join(missing)}."))
        return results
    wrong_external_id = env("PHASE3_BEDROCK_WRONG_EXTERNAL_ID", "proliferate-wrong-live-proof")
    status, _payload = aws_json([
        "sts",
        "assume-role",
        "--role-arn",
        env("PHASE3_BEDROCK_ROLE_ARN"),
        "--role-session-name",
        "proliferate-phase3-wrong-external-id",
        "--external-id",
        wrong_external_id,
    ])
    if status == 0:
        results.append(
            result("byok-bedrock-wrong-external-id", FAIL, "Wrong external id assumed role.")
        )
        return results
    results.append(
        result("byok-bedrock-wrong-external-id", PASS, "Wrong external id was denied.")
    )

    status, payload = aws_json([
        "sts",
        "assume-role",
        "--role-arn",
        env("PHASE3_BEDROCK_ROLE_ARN"),
        "--role-session-name",
        "proliferate-phase3-live-proof",
        "--external-id",
        env("PHASE3_BEDROCK_EXTERNAL_ID"),
    ])
    failure = expect_2xx(
        "byok-bedrock-assume-role",
        200 if status == 0 else 500,
        payload,
        "STS AssumeRole",
    )
    if failure:
        results.append(failure)
        return results
    credentials = payload.get("Credentials") if isinstance(payload, dict) else None
    if not isinstance(credentials, dict):
        results.append(
            result("byok-bedrock-assume-role", FAIL, "STS response lacked credentials.")
        )
        return results
    aws_env = {
        "AWS_ACCESS_KEY_ID": str(credentials.get("AccessKeyId") or ""),
        "AWS_SECRET_ACCESS_KEY": str(credentials.get("SecretAccessKey") or ""),
        "AWS_SESSION_TOKEN": str(credentials.get("SessionToken") or ""),
        "AWS_DEFAULT_REGION": env("PHASE3_BEDROCK_REGION"),
    }
    status, payload = aws_json(["sts", "get-caller-identity"], extra_env=aws_env)
    failure = expect_2xx(
        "byok-bedrock-caller-identity",
        200 if status == 0 else 500,
        payload,
        "assumed-role caller identity",
    )
    if failure:
        results.append(failure)
        return results
    status, payload = aws_json(
        ["bedrock", "list-foundation-models", "--region", env("PHASE3_BEDROCK_REGION")],
        extra_env=aws_env,
    )
    failure = expect_2xx(
        "byok-bedrock-model-list",
        200 if status == 0 else 500,
        payload,
        "Bedrock model list",
    )
    results.append(
        failure or result("byok-bedrock", PASS, "Bedrock AssumeRole and model list passed.")
    )
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "mode",
        choices=[
            "managed-credits",
            "route-isolation",
            "byok-anthropic",
            "byok-openai",
            "byok-bedrock",
            "all",
        ],
    )
    parser.add_argument("--require-live", action="store_true")
    parser.add_argument("--proof-artifact-out")
    parser.add_argument("--environment", default=env("PROLIFERATE_ENVIRONMENT", "staging"))
    parser.add_argument("--litellm-image", default=env("LITELLM_IMAGE"))
    parser.add_argument("--litellm-version", default=env("LITELLM_VERSION", "unknown"))
    parser.add_argument(
        "--topology",
        default=env("AGENT_GATEWAY_LITELLM_TOPOLOGY", "enterprise_shared"),
    )
    parser.add_argument(
        "--litellm-config-fingerprint",
        default=env("AGENT_GATEWAY_LITELLM_CONFIG_FINGERPRINT"),
    )
    parser.add_argument("--task-definition-arn", default=env("PHASE3_LITELLM_TASK_DEFINITION_ARN"))
    parser.add_argument("--service-identity", default=env("PHASE3_LITELLM_SERVICE_IDENTITY"))
    parser.add_argument("--signer", default=env("PHASE3_PROOF_SIGNER", "local-proof-runner"))
    parser.add_argument("--approver", default=env("PHASE3_PROOF_APPROVER"))
    args = parser.parse_args()

    all_results: list[Result] = []
    if args.mode in {"managed-credits", "all"}:
        all_results.extend(managed_credits(args.require_live))
    if args.mode in {"route-isolation", "all"}:
        all_results.extend(route_isolation(args.require_live))
    if args.mode in {"byok-anthropic", "all"}:
        all_results.extend(byok_anthropic(args.require_live))
    if args.mode in {"byok-openai", "all"}:
        all_results.extend(byok_openai(args.require_live))
    if args.mode in {"byok-bedrock", "all"}:
        all_results.extend(byok_bedrock(args.require_live))

    failed = False
    skipped = False
    for item in all_results:
        print(f"{item.status} {item.name}: {item.detail}")
        failed = failed or item.status == FAIL
        skipped = skipped or item.status == SKIP
    if args.proof_artifact_out:
        if failed or skipped:
            print(
                "FAIL proof-artifact: refusing to write proof artifact with failed or "
                "skipped proofs."
            )
            return 1
        proof_config_errors = proof_artifact_config_errors(args)
        if proof_config_errors:
            for error in proof_config_errors:
                print(f"FAIL proof-artifact: {error}")
            return 1
        proof_artifact = build_proof_artifact(args, all_results)
        Path(args.proof_artifact_out).write_text(
            json.dumps(proof_artifact, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"PASS proof-artifact: wrote {args.proof_artifact_out}")
    return 1 if failed else 0


def _image_digest(image: str) -> str:
    marker = "@sha256:"
    if marker not in image:
        return ""
    return image.split("@", 1)[1]


def _proof_passed(results: list[Result], *prefixes: str) -> bool:
    matches = [item for item in results if item.name.startswith(prefixes)]
    return bool(matches) and all(item.status == PASS for item in matches)


def proof_artifact_config_errors(args: argparse.Namespace) -> list[str]:
    errors: list[str] = []
    if not _image_digest(args.litellm_image):
        errors.append("--litellm-image must be digest-pinned with @sha256:<digest>.")
    if not args.litellm_config_fingerprint:
        errors.append("--litellm-config-fingerprint is required.")
    if not (args.task_definition_arn or args.service_identity):
        errors.append("--task-definition-arn or --service-identity is required.")
    if not args.signer:
        errors.append("--signer is required.")
    if not args.approver:
        errors.append("--approver is required.")
    return errors


def build_proof_artifact(args: argparse.Namespace, results: list[Result]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)  # noqa: UP017 - keep script compatible with Python 3.9.
    return {
        "environment": args.environment,
        "generatedAt": now.isoformat(),
        "expiresAt": (now + timedelta(days=14)).isoformat(),
        "litellmImageDigest": _image_digest(args.litellm_image),
        "litellmVersion": args.litellm_version,
        "topology": args.topology,
        "taskDefinitionArn": args.task_definition_arn or None,
        "serviceIdentity": args.service_identity or None,
        "litellmConfigFingerprint": args.litellm_config_fingerprint,
        "credentialRoutingConfigFlags": {
            "LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES": env(
                "LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES",
            )
        },
        "proofScriptSha": script_sha256(),
        "testMatrixResults": {
            "managedCredits": _proof_passed(results, "managed-credits"),
            "routeIsolation": _proof_passed(results, "route-isolation"),
            "byokAnthropic": _proof_passed(results, "byok-anthropic"),
            "byokOpenai": _proof_passed(results, "byok-openai"),
            "byokBedrock": _proof_passed(results, "byok-bedrock"),
            "byokOpenaiCompatible": False,
        },
        "results": [
            {"name": item.name, "status": item.status, "detail": redact(item.detail)}
            for item in results
        ],
        "signer": args.signer,
        "approver": args.approver,
    }


if __name__ == "__main__":
    sys.exit(main())
