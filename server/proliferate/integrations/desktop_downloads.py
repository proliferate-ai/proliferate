"""Desktop downloads CDN client.

Owns the raw HTTP probe for updater manifests so product domains
(``server/meta.py``) stay free of raw HTTP clients (repo shape).
"""

from __future__ import annotations

import time

import httpx

# A pinned desktop version can outpace the published manifests (a server built
# from a commit whose desktop version has not been released yet, or a release
# older than versioned-manifest publishing). Probe results are cached briefly
# so update checks do not hammer the CDN.
_MANIFEST_PROBE_TTL_SECONDS = 300.0
_manifest_probe_cache: dict[str, tuple[float, bool]] = {}


async def versioned_manifest_exists(url: str) -> bool:
    cached = _manifest_probe_cache.get(url)
    now = time.monotonic()
    if cached is not None and now - cached[0] < _MANIFEST_PROBE_TTL_SECONDS:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.head(url)
        exists = response.status_code == 200
    except httpx.HTTPError:
        # CDN unreachable from the server: report the manifest as present so
        # the caller redirects optimistically (the desktop app talks to the
        # CDN directly and may well be able to reach it); do not cache.
        return True
    _manifest_probe_cache[url] = (now, exists)
    return exists
