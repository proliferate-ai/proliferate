from __future__ import annotations

import asyncio
import os
import socket
import sys
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import httpx

from tests.e2e.cloud.helpers.shared import (
    CloudE2ETestError,
    CloudTestConfig,
    NGROK_API_PORT_END,
    NGROK_API_PORT_START,
    NGROK_API_URL,
    ProcessHandle,
    SERVER_ROOT,
)
from tests.postgres import TEST_DATABASE_URL


@asynccontextmanager
async def ensure_external_server(
    config: CloudTestConfig,
    *,
    provider_kind: str,
    database_url: str = TEST_DATABASE_URL,
    port: int | None = None,
) -> AsyncIterator[ProcessHandle]:
    selected_port = port or find_available_port()
    base_url = f"http://127.0.0.1:{selected_port}"
    print(
        f"[cloud-e2e] starting external server provider={provider_kind} base_url={base_url}",
        flush=True,
    )

    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": database_url,
            "SANDBOX_PROVIDER": provider_kind,
            "CLOUD_BILLING_MODE": "off",
            "E2B_API_KEY": config.e2b_api_key or "",
            "E2B_TEMPLATE_NAME": config.e2b_template_name or "",
            "E2B_WEBHOOK_SIGNATURE_SECRET": config.e2b_webhook_signature_secret or "",
            "DAYTONA_API_KEY": config.daytona_api_key or "",
            "DAYTONA_SERVER_URL": config.daytona_server_url,
            "DAYTONA_TARGET": config.daytona_target,
        }
    )
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "uvicorn",
        "proliferate.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(selected_port),
        cwd=str(SERVER_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await wait_for_health(base_url, timeout_seconds=30.0)
        print(f"[cloud-e2e] external server healthy base_url={base_url}", flush=True)
        yield ProcessHandle(process=process, base_url=base_url, reused_existing=False)
    finally:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=10.0)
        except TimeoutError:
            process.kill()
            await process.wait()


@asynccontextmanager
async def ensure_ngrok_http_endpoint(
    public_url: str,
    *,
    target_port: int,
) -> AsyncIterator[ProcessHandle]:
    if await ngrok_has_public_url(public_url):
        print(
            f"[cloud-e2e] reusing ngrok tunnel public_url={public_url} target_port={target_port}",
            flush=True,
        )
        yield ProcessHandle(process=None, base_url=public_url, reused_existing=True)
        return

    print(
        f"[cloud-e2e] starting ngrok public_url={public_url} target_port={target_port}",
        flush=True,
    )
    process = await asyncio.create_subprocess_exec(
        "ngrok",
        "http",
        f"127.0.0.1:{target_port}",
        "--url",
        public_url,
        "--log",
        "stdout",
        "--log-format",
        "logfmt",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await wait_for_ngrok_url(public_url, process=process, timeout_seconds=20.0)
        print(f"[cloud-e2e] ngrok ready public_url={public_url}", flush=True)
        yield ProcessHandle(process=process, base_url=public_url, reused_existing=False)
    finally:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=10.0)
            except TimeoutError:
                process.kill()
                await process.wait()


def port_from_base_url(base_url: str) -> int:
    parsed = urlparse(base_url)
    if parsed.port is None:
        raise CloudE2ETestError(f"Base URL does not include an explicit port: {base_url}")
    return parsed.port


async def list_ngrok_requests(
    public_url: str,
    *,
    path_contains: str | None = None,
) -> list[dict[str, object]]:
    api_base = await find_ngrok_api_base_for_public_url(public_url)
    if api_base is None:
        return []
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{api_base}/requests/http")
            response.raise_for_status()
    except httpx.HTTPError:
        return []
    payload = response.json()
    requests = payload.get("requests", []) if isinstance(payload, dict) else []
    results = [item for item in requests if isinstance(item, dict)]
    if path_contains is None:
        return results

    filtered: list[dict[str, object]] = []
    for item in results:
        uri = ""
        request_payload = item.get("request")
        if isinstance(request_payload, dict):
            uri = str(request_payload.get("uri") or request_payload.get("url") or "")
        if path_contains in uri:
            filtered.append(item)
    return filtered


async def list_e2b_webhooks(config: CloudTestConfig) -> list[dict[str, object]]:
    if not config.e2b_api_key:
        raise CloudE2ETestError("E2B_API_KEY is required to list E2B webhooks.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            "https://api.e2b.app/events/webhooks",
            headers={"X-API-Key": config.e2b_api_key},
        )
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, list):
        raise CloudE2ETestError("Unexpected E2B webhook list response.")
    return [item for item in payload if isinstance(item, dict)]


async def list_e2b_sandbox_events(
    config: CloudTestConfig,
    *,
    sandbox_id: str,
    limit: int = 20,
) -> list[dict[str, object]]:
    if not config.e2b_api_key:
        raise CloudE2ETestError("E2B_API_KEY is required to inspect E2B sandbox events.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"https://api.e2b.app/events/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.e2b_api_key},
            params={"limit": limit},
        )
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, list):
        raise CloudE2ETestError("Unexpected E2B sandbox event response.")
    return [item for item in payload if isinstance(item, dict)]


async def wait_for_e2b_sandbox_event(
    config: CloudTestConfig,
    *,
    sandbox_id: str,
    event_type: str,
    timeout_seconds: float = 60.0,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        events = await list_e2b_sandbox_events(config, sandbox_id=sandbox_id, limit=20)
        for event in events:
            if event.get("type") == event_type:
                return event
        await asyncio.sleep(5.0)
    raise CloudE2ETestError(
        f"Timed out waiting for E2B event {event_type} for sandbox {sandbox_id}."
    )


async def healthcheck(base_url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{base_url}/health")
            return response.is_success
    except httpx.HTTPError:
        return False


async def wait_for_health(base_url: str, *, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if await healthcheck(base_url):
            return
        await asyncio.sleep(0.5)
    raise CloudE2ETestError(f"Timed out waiting for server health at {base_url}.")


async def find_ngrok_api_base_for_public_url(public_url: str) -> str | None:
    for port in range(NGROK_API_PORT_START, NGROK_API_PORT_END + 1):
        api_base = f"http://127.0.0.1:{port}/api"
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                response = await client.get(f"{api_base}/tunnels")
                response.raise_for_status()
        except httpx.HTTPError:
            continue
        payload = response.json()
        tunnels = payload.get("tunnels", []) if isinstance(payload, dict) else []
        if any(
            isinstance(item, dict) and item.get("public_url") == public_url for item in tunnels
        ):
            return api_base
    return None


async def ngrok_has_public_url(public_url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(NGROK_API_URL)
            response.raise_for_status()
    except httpx.HTTPError:
        return await find_ngrok_api_base_for_public_url(public_url) is not None
    payload = response.json()
    tunnels = payload.get("tunnels", []) if isinstance(payload, dict) else []
    if any(isinstance(item, dict) and item.get("public_url") == public_url for item in tunnels):
        return True
    return await find_ngrok_api_base_for_public_url(public_url) is not None


async def wait_for_ngrok_url(
    public_url: str,
    *,
    process: asyncio.subprocess.Process,
    timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if await ngrok_has_public_url(public_url):
            return
        if process.returncode is not None:
            stdout = ""
            stderr = ""
            if process.stdout is not None:
                stdout = (await process.stdout.read()).decode("utf-8", errors="replace")
            if process.stderr is not None:
                stderr = (await process.stderr.read()).decode("utf-8", errors="replace")
            message = (
                stdout or stderr or "ngrok exited before the tunnel became available."
            ).strip()
            raise CloudE2ETestError(f"ngrok failed to expose {public_url}: {message}")
        await asyncio.sleep(0.5)
    raise CloudE2ETestError(f"Timed out waiting for ngrok tunnel {public_url}.")


def is_port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
