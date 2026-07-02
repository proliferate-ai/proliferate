"""Public version metadata + desktop updater redirect.

``GET /meta`` reports the versions this server pins so desktop, runtime, and
operators all converge on the version the API controls. ``GET
/desktop/updater/latest.json`` 302-redirects to the versioned updater manifest
on the official downloads CDN.

The server carries only a version string, never the manifest itself: manifests
contain per-platform minisign signatures that are a desktop-release artifact,
and the minisign pubkey baked into the app verifies those artifacts no matter
which endpoint served the manifest. A self-hosted server can therefore choose
the desktop version but can never ship an unofficial build.
"""

from __future__ import annotations

import os
import time

import httpx
from fastapi import APIRouter, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from proliferate.server.version import (
    desktop_version,
    min_desktop_version,
    runtime_version,
    server_version,
)

router = APIRouter()

# Official CDN root that serves signed desktop updater manifests. Overridable
# via env for parity with the release pipeline's DESKTOP_DOWNLOADS_BASE_URL.
_DEFAULT_DESKTOP_DOWNLOADS_BASE_URL = "https://downloads.proliferate.com"


class MetaResponse(BaseModel):
    serverVersion: str
    desktopVersion: str
    runtimeVersion: str
    minDesktopVersion: str


def _desktop_downloads_base_url() -> str:
    value = os.getenv("DESKTOP_DOWNLOADS_BASE_URL")
    base = value.strip() if value and value.strip() else _DEFAULT_DESKTOP_DOWNLOADS_BASE_URL
    return base.rstrip("/")


@router.get("/meta", response_model=MetaResponse)
async def meta() -> MetaResponse:
    return MetaResponse(
        serverVersion=server_version(),
        desktopVersion=desktop_version(),
        runtimeVersion=runtime_version(),
        minDesktopVersion=min_desktop_version(),
    )


# A pinned desktop version can outpace the published manifests (a server built
# from a commit whose desktop version has not been released yet, or a release
# older than versioned-manifest publishing). Probe the versioned manifest and
# fall back to the flat latest manifest rather than redirecting the whole
# fleet's update checks to a 404. Probe results are cached briefly so update
# checks do not hammer the CDN.
_MANIFEST_PROBE_TTL_SECONDS = 300.0
_manifest_probe_cache: dict[str, tuple[float, bool]] = {}


async def _versioned_manifest_exists(url: str) -> bool:
    cached = _manifest_probe_cache.get(url)
    now = time.monotonic()
    if cached is not None and now - cached[0] < _MANIFEST_PROBE_TTL_SECONDS:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.head(url)
        exists = response.status_code == 200
    except httpx.HTTPError:
        # CDN unreachable from the server: redirect optimistically to the
        # versioned path (the desktop app talks to the CDN directly and may
        # well be able to reach it) and do not cache the failure.
        return True
    _manifest_probe_cache[url] = (now, exists)
    return exists


@router.get("/desktop/updater/latest.json")
async def desktop_updater_latest() -> RedirectResponse:
    base = _desktop_downloads_base_url()
    target = f"{base}/desktop/stable/{desktop_version()}/latest.json"
    if not await _versioned_manifest_exists(target):
        target = f"{base}/desktop/stable/latest.json"
    return RedirectResponse(url=target, status_code=status.HTTP_302_FOUND)
