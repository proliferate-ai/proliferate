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

from fastapi import APIRouter, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from proliferate.integrations.desktop_downloads import (
    downloads_base_url as _downloads_base_url,
)
from proliferate.integrations.desktop_downloads import (
    versioned_manifest_exists as _versioned_manifest_exists,
)
from proliferate.server.version import (
    desktop_version,
    min_desktop_version,
    runtime_version,
    server_version,
    worker_version,
)

router = APIRouter()


class MetaResponse(BaseModel):
    serverVersion: str
    desktopVersion: str
    runtimeVersion: str
    workerVersion: str
    minDesktopVersion: str


@router.get("/meta", response_model=MetaResponse)
async def meta() -> MetaResponse:
    return MetaResponse(
        serverVersion=server_version(),
        desktopVersion=desktop_version(),
        runtimeVersion=runtime_version(),
        workerVersion=worker_version(),
        minDesktopVersion=min_desktop_version(),
    )


@router.get("/desktop/updater/latest.json")
async def desktop_updater_latest() -> RedirectResponse:
    base = _downloads_base_url()
    target = f"{base}/desktop/stable/{desktop_version()}/latest.json"
    if not await _versioned_manifest_exists(target):
        target = f"{base}/desktop/stable/latest.json"
    return RedirectResponse(url=target, status_code=status.HTTP_302_FOUND)
