"""Runtime version resolution for the control plane.

Every version the API reports is downstream of what the operator's server image
was stamped with at build time. Release CI injects the concrete pins via env
(``SERVER_VERSION``, ``DESKTOP_VERSION``, ``RUNTIME_VERSION``,
``WORKER_VERSION``, ``MIN_DESKTOP_VERSION``), wired from the root ``VERSION``
file and the desktop / runtime / worker package manifests through Docker build
args.

For local development (running from a source checkout, not the released image)
the server version falls back to reading the repo ``VERSION`` file, then to a
dev sentinel. Nothing ever reports the old hardcoded ``0.1.0``.
"""

from __future__ import annotations

import os
from pathlib import Path

# Used only when neither a build-time env nor a VERSION file can be found
# (e.g. an editable install run from an unusual working directory).
_DEV_FALLBACK = "0.0.0-dev"


def _env(name: str) -> str | None:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    return None


def _read_version_file() -> str | None:
    """Walk up from this module looking for a ``VERSION`` file.

    Matches both the source-tree layout (repo-root ``VERSION``) and an image
    that copied ``VERSION`` alongside the app, so a manually built image with no
    build args still reports a real version.
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "VERSION"
        try:
            text = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if text:
            return text
    return None


def server_version() -> str:
    """The server's own version (stamped ``SERVER_VERSION`` or VERSION file)."""
    return _env("SERVER_VERSION") or _read_version_file() or _DEV_FALLBACK


def desktop_version() -> str:
    """The desktop version this server pins; falls back to the server version."""
    return _env("DESKTOP_VERSION") or server_version()


def runtime_version() -> str:
    """The runtime version this server pins; falls back to the server version."""
    return _env("RUNTIME_VERSION") or server_version()


def worker_version() -> str:
    """The worker version this server *displays*; falls back to the server version.

    Release CI stamps ``WORKER_VERSION`` from the ``proliferate-worker`` crate
    manifest the same way the desktop / runtime pins are stamped from theirs.
    Display only — the heartbeat pin uses :func:`worker_version_pin`.
    """
    return _env("WORKER_VERSION") or server_version()


def worker_version_pin() -> str | None:
    """The worker version this server pins for self-updates, or ``None``.

    Unlike the display fallbacks above, this pin actively drives binary
    swaps: sandbox workers download and exec whatever it names on every
    heartbeat. When ``WORKER_VERSION`` was not stamped (local dev, a plain
    ``docker build``, self-hosted images) the server-version fallback could
    never match any worker artifact, so it would drive perpetual update
    attempts — an unstamped deployment therefore pins nothing.
    """
    return _env("WORKER_VERSION")


def min_desktop_version() -> str:
    """The lowest desktop version this server accepts.

    Defaults to the pinned desktop version (a conservative floor). Operators or
    release CI can stamp an explicit lower floor via ``MIN_DESKTOP_VERSION``.
    """
    return _env("MIN_DESKTOP_VERSION") or desktop_version()
