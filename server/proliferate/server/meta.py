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


@router.get("/desktop/updater/latest.json")
async def desktop_updater_latest() -> RedirectResponse:
    target = f"{_desktop_downloads_base_url()}/desktop/stable/{desktop_version()}/latest.json"
    return RedirectResponse(url=target, status_code=status.HTTP_302_FOUND)
