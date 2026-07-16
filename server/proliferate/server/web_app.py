"""Serve the compiled ProductClient Web application from the server image.

Self-hosted Proliferate serves the real Web application at the same public URL
as its API (Browser -> Caddy -> this server image). This module owns the static
asset mount and the fail-closed SPA fallback; ``main.py`` only calls
:func:`mount_web_app` after every API/auth/setup router is registered.

Behavior is fully gated by ``settings.web_dist_dir``:

- empty setting -> not mounted, API-only behavior is unchanged;
- configured directory with ``index.html`` -> Web is served;
- configured directory missing ``index.html`` -> startup fails loudly.

The fallback is fail-closed: only GET/HEAD navigation to a non-reserved,
non-asset path resolves to ``index.html``. Reserved API/auth/setup namespaces,
missing static assets, and non-navigation methods never return the SPA shell.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("proliferate.web_app")

# Cache policy. index.html must always be revalidated so a new deploy is picked
# up immediately; hashed asset files are content-addressed and safe to cache
# forever.
INDEX_CACHE_CONTROL = "no-cache"
IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# Namespaces owned by the server, expressed relative to the configured
# API_PATH_PREFIX. A request under any of these never falls back to the Web
# shell: an unknown route there is a server/API failure (404), not client
# navigation. This mirrors the routers mounted in ``main.py`` (including the
# non-schema HTML routes: setup, register, join, artifact-runtime).
_RESERVED_API_SEGMENTS = (
    "v1",
    "auth",
    "health",
    "meta",
    "users",
    "desktop",
    "integrations",
    "internal",
    "setup",
    "register",
    "join",
    "artifact-runtime",
)

# The compiled Vite output emits hashed files under this directory; it is served
# as real static files (immutable), never as an SPA fallback target.
_ASSETS_URL_PREFIX = "/assets"


class _ImmutableStaticFiles(StaticFiles):
    """StaticFiles that stamps hashed assets with a long-lived immutable cache.

    Vite fingerprints every emitted asset filename, so a served asset is safe to
    cache forever. A missing asset returns the ordinary 404 response (a plain
    Response, not a raised exception), so it never reaches the SPA fallback.
    """

    def file_response(self, *args: object, **kwargs: object) -> Response:
        response = super().file_response(*args, **kwargs)  # type: ignore[arg-type]
        if response.status_code == 200:
            response.headers["cache-control"] = IMMUTABLE_CACHE_CONTROL
        return response


def _reserved_prefixes(api_prefix: str) -> tuple[str, ...]:
    prefix = api_prefix.rstrip("/")
    reserved = [f"{prefix}/{segment}" for segment in _RESERVED_API_SEGMENTS]
    # The hashed-asset mount is reserved regardless of API prefix; it is a static
    # location, not a client route.
    reserved.append(_ASSETS_URL_PREFIX)
    return tuple(reserved)


def _is_reserved(path: str, reserved: tuple[str, ...]) -> bool:
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in reserved)


def _resolve_within(dist_dir: Path, url_path: str) -> Path | None:
    """Resolve ``url_path`` to a real file strictly inside ``dist_dir``.

    Returns the file path when it exists inside the distribution root, else
    None. Rejects traversal: a resolved path outside ``dist_dir`` never matches.
    """
    relative = url_path.lstrip("/")
    if not relative:
        return None
    try:
        candidate = (dist_dir / relative).resolve()
    except (ValueError, OSError):
        # e.g. an embedded null byte (/foo%00bar) raises ValueError; treat any
        # unresolvable path as not-a-file instead of propagating a 500.
        return None
    if candidate != dist_dir and dist_dir not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


def mount_web_app(app: FastAPI, dist_dir_setting: str, api_prefix: str) -> None:
    """Mount the compiled Web application when ``dist_dir_setting`` is set.

    No-op when the setting is empty (API-only). A configured directory without
    ``index.html`` raises ``RuntimeError`` so startup fails clearly instead of
    silently serving nothing or an unrelated directory.
    """
    if not dist_dir_setting.strip():
        return

    dist_dir = Path(dist_dir_setting.strip()).resolve()
    index_file = dist_dir / "index.html"
    if not index_file.is_file():
        raise RuntimeError(
            f"WEB_DIST_DIR={dist_dir_setting!r} does not contain index.html "
            f"(looked for {index_file}). Point WEB_DIST_DIR at the compiled "
            "ProductClient Web distribution, or leave it empty to disable Web "
            "serving."
        )

    reserved = _reserved_prefixes(api_prefix)

    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount(
            _ASSETS_URL_PREFIX,
            _ImmutableStaticFiles(directory=assets_dir),
            name="web-assets",
        )

    async def spa_fallback(request: Request, exc: StarletteHTTPException) -> Response:
        # Only a genuine "no route matched" (404) is a fallback candidate. Every
        # other HTTP error (401/403/405/...) keeps the default behavior, so an
        # unknown API request never turns into a 200 shell.
        if exc.status_code != 404:
            return await http_exception_handler(request, exc)
        # Fail-closed: browser navigation only. Non-navigation verbs keep the
        # real 404 (WebSocket upgrades never reach an HTTP exception handler).
        if request.method not in ("GET", "HEAD"):
            return await http_exception_handler(request, exc)
        path = request.url.path
        # Reserved server/API namespaces never serve the shell.
        if _is_reserved(path, reserved):
            return await http_exception_handler(request, exc)
        # A real root-level static file (favicon, etc.) is served as itself. A
        # missing file under a non-reserved path resolves to the SPA shell so a
        # client route can be refreshed directly. A direct GET /index.html is
        # the shell too and must carry the same no-cache policy, or a CDN could
        # pin a stale shell at that URL.
        real_file = _resolve_within(dist_dir, path)
        if real_file is not None and real_file != index_file:
            return FileResponse(real_file)
        return FileResponse(index_file, headers={"cache-control": INDEX_CACHE_CONTROL})

    app.add_exception_handler(StarletteHTTPException, spa_fallback)
    logger.info("Serving compiled Web application from %s", dist_dir)
