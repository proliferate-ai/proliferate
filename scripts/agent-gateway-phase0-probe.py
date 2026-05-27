#!/usr/bin/env python3
"""Phase 0 compatibility probes for the agent LLM auth gateway spec.

The script intentionally uses only the Python standard library so it can run
from a fresh checkout. It never prints provider keys or runtime grants.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any


PASS = "PASS"
SKIP = "SKIP"
FAIL = "FAIL"


@dataclass(frozen=True)
class ProbeResult:
    name: str
    status: str
    detail: str


class HttpClient:
    def __init__(self, base_url: str, bearer: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.bearer = bearer

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> tuple[int, dict[str, Any] | str, dict[str, str]]:
        url = self.base_url + path
        payload = None if body is None else json.dumps(body).encode("utf-8")
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        bearer = token if token is not None else self.bearer
        if bearer:
            request_headers["Authorization"] = f"Bearer {bearer}"
        req = urllib.request.Request(
            url,
            data=payload,
            headers=request_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                raw = response.read()
                status = response.status
                response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            status = exc.code
            response_headers = dict(exc.headers.items())
        text = raw.decode("utf-8", errors="replace")
        try:
            parsed: dict[str, Any] | str = json.loads(text) if text else {}
        except json.JSONDecodeError:
            parsed = text
        return status, parsed, response_headers


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


def is_truthy(name: str) -> bool:
    return (env(name, "") or "").lower() in {"1", "true", "yes", "on"}


def result(name: str, status: str, detail: str) -> ProbeResult:
    return ProbeResult(name=name, status=status, detail=detail)


def require_env(names: list[str]) -> list[str]:
    return [name for name in names if not env(name)]


def expect_2xx(
    name: str,
    status: int,
    payload: dict[str, Any] | str,
    action: str,
) -> ProbeResult | None:
    if 200 <= status < 300:
        return None
    return result(name, FAIL, f"{action} failed with HTTP {status}: {redact(payload)}")


def redact(payload: dict[str, Any] | str) -> str:
    text = payload if isinstance(payload, str) else json.dumps(payload, sort_keys=True)
    for key in (
        env("OPENAI_API_KEY"),
        env("PHASE0_OPENAI_API_KEY_TEAM_A"),
        env("PHASE0_OPENAI_API_KEY_TEAM_B"),
        env("PHASE0_GATEWAY_TOKEN"),
        env("AGENT_GATEWAY_BIFROST_ADMIN_TOKEN"),
        env("PHASE0_BIFROST_ADMIN_TOKEN"),
        env("PHASE0_BIFROST_OPENAI_API_KEY"),
    ):
        if key:
            text = text.replace(key, "[REDACTED]")
    return text[:1000]


def probe_anthropic_streaming() -> list[ProbeResult]:
    missing = require_env(["PHASE0_ANTHROPIC_BASE_URL", "PHASE0_GATEWAY_TOKEN", "PHASE0_ANTHROPIC_MODEL"])
    if missing:
        return [
            result(
                "claude-anthropic-streaming",
                SKIP,
                "Set PHASE0_ANTHROPIC_BASE_URL, PHASE0_GATEWAY_TOKEN, and PHASE0_ANTHROPIC_MODEL to run the Claude streaming proof.",
            )
        ]
    client = HttpClient(env("PHASE0_ANTHROPIC_BASE_URL") or "", env("PHASE0_GATEWAY_TOKEN"))
    status, payload, headers = client.request(
        "POST",
        "/v1/messages?beta=true",
        body={
            "model": env("PHASE0_ANTHROPIC_MODEL"),
            "max_tokens": 8,
            "stream": True,
            "messages": [{"role": "user", "content": "Reply with OK."}],
        },
        headers={"anthropic-version": "2023-06-01"},
        timeout=60.0,
    )
    failure = expect_2xx("claude-anthropic-streaming", status, payload, "Claude Anthropic streaming request")
    if failure:
        return [failure]
    content_type = headers.get("content-type", headers.get("Content-Type", ""))
    return [result("claude-anthropic-streaming", PASS, f"HTTP {status}; content-type={content_type or 'unknown'}")]


def probe_codex_responses() -> list[ProbeResult]:
    missing = require_env(["PHASE0_OPENAI_BASE_URL", "PHASE0_GATEWAY_TOKEN", "PHASE0_RESPONSES_MODEL"])
    if missing:
        return [
            result(
                "codex-responses-streaming",
                SKIP,
                "Set PHASE0_OPENAI_BASE_URL, PHASE0_GATEWAY_TOKEN, and PHASE0_RESPONSES_MODEL to run the Codex Responses proof.",
            )
        ]
    client = HttpClient(env("PHASE0_OPENAI_BASE_URL") or "", env("PHASE0_GATEWAY_TOKEN"))
    status, payload, headers = client.request(
        "POST",
        "/responses",
        body={
            "model": env("PHASE0_RESPONSES_MODEL"),
            "input": "Reply with OK.",
            "stream": True,
            "max_output_tokens": 8,
        },
        timeout=60.0,
    )
    failure = expect_2xx("codex-responses-streaming", status, payload, "Codex Responses streaming request")
    if failure:
        return [failure]
    content_type = headers.get("content-type", headers.get("Content-Type", ""))
    return [result("codex-responses-streaming", PASS, f"HTTP {status}; content-type={content_type or 'unknown'}")]


def probe_opencode_isolation() -> list[ProbeResult]:
    if is_truthy("PHASE0_OPENCODE_MANAGED_CONFIG_PROOF"):
        return [
            result(
                "opencode-managed-config-isolation",
                PASS,
                "Caller asserted OpenCode managed config isolation has been proven for this environment.",
            )
        ]
    return [
        result(
            "opencode-managed-config-isolation",
            SKIP,
            "OpenCode gateway remains disabled until managed provider config isolation is proven.",
        )
    ]


def _bifrost_expect_object(
    name: str,
    payload: dict[str, Any] | str,
    field: str,
) -> dict[str, Any] | ProbeResult:
    if isinstance(payload, dict) and isinstance(payload.get(field), dict):
        return payload[field]  # type: ignore[return-value]
    return result(name, FAIL, f"Bifrost response did not include {field}: {redact(payload)}")


def _bifrost_disable_provider_key(
    client: HttpClient,
    *,
    provider: str,
    key_id: str,
) -> None:
    status, payload, _ = client.request(
        "GET",
        f"/api/providers/{urllib.parse.quote(provider)}/keys/{urllib.parse.quote(key_id)}",
        timeout=15.0,
    )
    if status == 404 or not isinstance(payload, dict):
        return
    payload["enabled"] = False
    client.request(
        "PUT",
        f"/api/providers/{urllib.parse.quote(provider)}/keys/{urllib.parse.quote(key_id)}",
        body=payload,
        timeout=15.0,
    )


def probe_bifrost_managed_credit_flow() -> list[ProbeResult]:
    base_url = env("PHASE0_BIFROST_BASE_URL") or env("AGENT_GATEWAY_BIFROST_BASE_URL")
    api_key = env("PHASE0_BIFROST_OPENAI_API_KEY") or env("OPENAI_API_KEY")
    if not base_url or not api_key:
        return [
            result(
                "bifrost-managed-credit-flow",
                SKIP,
                "Set PHASE0_BIFROST_BASE_URL and OPENAI_API_KEY (or PHASE0_BIFROST_OPENAI_API_KEY) to run the Bifrost live proof.",
            )
        ]

    admin_token = env("PHASE0_BIFROST_ADMIN_TOKEN") or env("AGENT_GATEWAY_BIFROST_ADMIN_TOKEN")
    client = HttpClient(base_url, admin_token)
    run_id = uuid.uuid4().hex[:10]
    provider = env("PHASE0_BIFROST_PROVIDER", "openai") or "openai"
    model = env("PHASE0_BIFROST_OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    key_id = f"proliferate-phase0-{run_id}"
    virtual_key_id: str | None = None

    try:
        provider_status, _provider_payload, _ = client.request(
            "GET",
            f"/api/providers/{urllib.parse.quote(provider)}",
            timeout=5.0,
        )
        if provider_status == 404:
            create_provider_status, create_provider_payload, _ = client.request(
                "POST",
                "/api/providers",
                body={"provider": provider},
                timeout=15.0,
            )
            failure = expect_2xx(
                "bifrost-provider-config",
                create_provider_status,
                create_provider_payload,
                "create provider",
            )
            if failure:
                return [failure]
        elif provider_status >= 500:
            return [
                result(
                    "bifrost-provider-config",
                    FAIL,
                    f"provider readiness failed with HTTP {provider_status}",
                )
            ]

        key_body = {
            "id": key_id,
            "name": f"Proliferate phase0 {run_id}",
            "value": {"value": api_key, "env_var": "", "from_env": False},
            "models": [model],
            "blacklisted_models": [],
            "weight": 1.0,
            "aliases": {},
            "enabled": True,
        }
        key_status, key_payload, _ = client.request(
            "POST",
            f"/api/providers/{urllib.parse.quote(provider)}/keys",
            body=key_body,
            timeout=30.0,
        )
        if key_status == 409:
            key_status, key_payload, _ = client.request(
                "PUT",
                f"/api/providers/{urllib.parse.quote(provider)}/keys/{urllib.parse.quote(key_id)}",
                body=key_body,
                timeout=30.0,
            )
        failure = expect_2xx(
            "bifrost-provider-key-materialization",
            key_status,
            key_payload,
            "create provider key",
        )
        if failure:
            return [failure]

        virtual_status, virtual_payload, _ = client.request(
            "POST",
            "/api/governance/virtual-keys",
            body={
                "name": f"proliferate-phase0-{run_id}",
                "description": json.dumps({"phase0RunId": run_id}, sort_keys=True),
                "provider_configs": [
                    {
                        "provider": provider,
                        "weight": 1.0,
                        "allowed_models": [model],
                        "blacklisted_models": [],
                        "key_ids": [key_id],
                        "budgets": [{"max_limit": 0.01, "reset_duration": "100Y"}],
                    }
                ],
                "budgets": [],
                "is_active": True,
                "calendar_aligned": False,
            },
            timeout=30.0,
        )
        failure = expect_2xx(
            "bifrost-virtual-key-materialization",
            virtual_status,
            virtual_payload,
            "create virtual key",
        )
        if failure:
            return [failure]
        virtual_key = _bifrost_expect_object(
            "bifrost-virtual-key-materialization",
            virtual_payload,
            "virtual_key",
        )
        if isinstance(virtual_key, ProbeResult):
            return [virtual_key]
        virtual_key_id = str(virtual_key.get("id") or "")
        virtual_key_value = str(virtual_key.get("value") or "")
        if not virtual_key_id or not virtual_key_value:
            return [
                result(
                    "bifrost-virtual-key-materialization",
                    FAIL,
                    f"virtual key response was missing id/value: {redact(virtual_payload)}",
                )
            ]

        no_auth_result: ProbeResult | None = None
        if is_truthy("PHASE0_BIFROST_REQUIRE_NO_VK_REJECTION"):
            no_auth_status, no_auth_payload, _ = client.request(
                "POST",
                "/v1/chat/completions",
                token="",
                body={
                    "model": model,
                    "messages": [{"role": "user", "content": "Reply OK."}],
                    "max_tokens": 2,
                },
                timeout=30.0,
            )
            if no_auth_status < 400:
                no_auth_result = result(
                    "bifrost-no-virtual-key-rejection",
                    FAIL,
                    "inference without a virtual key unexpectedly succeeded",
                )
            else:
                no_auth_result = result(
                    "bifrost-no-virtual-key-rejection",
                    PASS,
                    f"HTTP {no_auth_status}; unauthenticated inference rejected",
                )

        chat_status, chat_payload, _ = client.request(
            "POST",
            "/v1/chat/completions",
            token=virtual_key_value,
            body={
                "model": model,
                "messages": [{"role": "user", "content": "Reply with OK."}],
                "max_tokens": 2,
            },
            timeout=60.0,
        )
        failure = expect_2xx(
            "bifrost-live-chat-routing",
            chat_status,
            chat_payload,
            "live chat completion through virtual key",
        )
        if failure:
            return [failure]

        log_seen = False
        log_detail = ""
        for _attempt in range(15):
            query = urllib.parse.urlencode(
                {
                    "virtual_key_ids": virtual_key_id,
                    "limit": 20,
                    "sort_by": "timestamp",
                    "order": "desc",
                }
            )
            logs_status, logs_payload, _ = client.request(
                "GET",
                f"/api/logs?{query}",
                timeout=15.0,
            )
            failure = expect_2xx(
                "bifrost-log-cost-observation",
                logs_status,
                logs_payload,
                "list logs",
            )
            if failure:
                return [failure]
            logs = logs_payload.get("logs", []) if isinstance(logs_payload, dict) else []
            for item in logs:
                if not isinstance(item, dict):
                    continue
                if str(item.get("virtual_key_id") or "") != virtual_key_id:
                    continue
                if item.get("cost") is None:
                    continue
                log_seen = True
                log_detail = (
                    f"provider={item.get('provider')}; model={item.get('model')}; "
                    f"cost={item.get('cost')}; selected_key_id={item.get('selected_key_id')}"
                )
                break
            if log_seen:
                break
            time.sleep(1)
        if not log_seen:
            return [
                result(
                    "bifrost-log-cost-observation",
                    FAIL,
                    "live request succeeded but no virtual-key log with cost appeared within 15s",
                )
            ]

        results = [
            result(
                "bifrost-managed-credit-flow",
                PASS,
                f"provider_key={key_id}; virtual_key_id={virtual_key_id}; {log_detail}",
            ),
            result(
                "bifrost-live-chat-routing",
                PASS,
                f"HTTP {chat_status}; virtual-key chat completion succeeded",
            ),
            result("bifrost-log-cost-observation", PASS, log_detail),
        ]
        if no_auth_result is not None:
            results.append(no_auth_result)
        return results
    except urllib.error.URLError as exc:
        return [result("bifrost-managed-credit-flow", FAIL, f"Could not reach Bifrost at {base_url}: {exc}")]
    finally:
        if virtual_key_id:
            client.request(
                "PUT",
                f"/api/governance/virtual-keys/{urllib.parse.quote(virtual_key_id)}",
                body={"is_active": False},
                timeout=15.0,
            )
        _bifrost_disable_provider_key(client, provider=provider, key_id=key_id)


def run_probe(name: str) -> list[ProbeResult]:
    if name == "bifrost":
        return probe_bifrost_managed_credit_flow()
    if name == "claude":
        return probe_anthropic_streaming()
    if name == "codex":
        return probe_codex_responses()
    if name == "opencode":
        return probe_opencode_isolation()
    if name == "all":
        results: list[ProbeResult] = []
        for child in ("bifrost", "claude", "codex", "opencode"):
            results.extend(run_probe(child))
        return results
    raise ValueError(f"unknown probe {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "probe",
        choices=["all", "bifrost", "claude", "codex", "opencode"],
        nargs="?",
        default="all",
    )
    parser.add_argument(
        "--require-live",
        action="store_true",
        help="Treat skipped live probes as failures.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON results.")
    args = parser.parse_args()

    started = time.time()
    results = run_probe(args.probe)
    elapsed_ms = int((time.time() - started) * 1000)

    if args.json:
        print(
            json.dumps(
                {
                    "elapsed_ms": elapsed_ms,
                    "results": [result.__dict__ for result in results],
                },
                indent=2,
                sort_keys=True,
            )
        )
    else:
        for item in results:
            print(f"[{item.status}] {item.name}: {item.detail}")
        print(f"elapsed_ms={elapsed_ms}")

    has_failure = any(item.status == FAIL for item in results)
    has_required_skip = args.require_live and any(item.status == SKIP for item in results)
    return 1 if has_failure or has_required_skip else 0


if __name__ == "__main__":
    sys.exit(main())
