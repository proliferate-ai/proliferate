"""Deterministic component release identity for the control plane.

Every emitting process stamps a release ID of the exact shape::

    <component>@<version>+<12-character-git-sha>

The nine component names are fixed by the support-system contract
(``specs/codebase/features/support-system.md`` -> "Release identity"). A
control-plane process only ever emits ``proliferate-server`` (and, for the
LiteLLM proxy image, ``proliferate-litellm``); it must never reuse the server
release for AnyHarness, worker, or supervisor events. Those target processes
carry their own compile-time build stamp.

Two hard rules from the contract are enforced here in code:

* Production builds fail closed when their release input is absent. They must
  not fall back to a stale package constant such as ``0.1.0``. The
  ``require`` path raises :class:`ReleaseIdentityError` rather than emitting a
  degraded release.
* A release ID that names one component must never be handed to a different
  component. :func:`sanitize_component_release_override` refuses a mismatched
  override, which is what defends the "server release stamped on a target
  component" stop condition.
"""

from __future__ import annotations

import os
import re

from proliferate.server.version import server_version

# The nine deployable components, exactly as the contract enumerates them.
COMPONENTS: frozenset[str] = frozenset(
    {
        "proliferate-server",
        "proliferate-litellm",
        "proliferate-web",
        "proliferate-mobile",
        "proliferate-desktop",
        "proliferate-desktop-native",
        "anyharness",
        "proliferate-worker",
        "proliferate-supervisor",
    }
)

# Versions that indicate an unstamped/degraded build. A production release must
# never carry any of these.
_PLACEHOLDER_VERSIONS: frozenset[str] = frozenset({"0.0.0", "0.0.0-dev", "0.1.0"})

# A version segment: any non-empty run without whitespace, ``@`` or ``+``.
_VERSION_RE = re.compile(r"^[^\s@+]+$")
# The build SHA is exactly the first 12 lowercase hex characters of the commit.
_SHA_RE = re.compile(r"^[0-9a-f]{12}$")
# A full canonical release ID: `<component>@<semver>[+<12-hex-sha>]`. The
# version must be semver-shaped so a bare 40-character SHA masquerading as a
# version (the live runtime-release bug) is not treated as canonical.
_RELEASE_RE = re.compile(
    r"^(?P<component>[a-z0-9-]+)@"
    r"(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"
    r"(?:\+(?P<sha>[0-9a-f]{12}))?$"
)


class ReleaseIdentityError(ValueError):
    """Raised when a release input is missing or malformed under a strict path."""


def normalize_git_sha(raw: str | None, *, require: bool = False) -> str | None:
    """Return a canonical 12-character lowercase git SHA, or ``None``.

    Accepts either a full 40-character commit SHA or an already-truncated
    12-character SHA. A malformed value raises when ``require`` is set, else
    returns ``None`` so local/dev builds emit a version-only release.
    """
    value = (raw or "").strip().lower()
    if not value:
        if require:
            raise ReleaseIdentityError("git SHA is required for a production release")
        return None
    if len(value) >= 12 and re.fullmatch(r"[0-9a-f]+", value):
        return value[:12]
    if require:
        raise ReleaseIdentityError(f"malformed git SHA: {raw!r}")
    return None


def build_release_id(
    component: str,
    version: str | None,
    git_sha: str | None,
    *,
    require: bool = False,
) -> str:
    """Construct ``<component>@<version>+<sha>`` (SHA omitted when absent).

    ``require`` enforces the production contract: a real (non-placeholder)
    version and a valid 12-character SHA are both mandatory, and a missing or
    malformed input raises :class:`ReleaseIdentityError`.
    """
    if component not in COMPONENTS:
        raise ReleaseIdentityError(f"unknown release component: {component!r}")

    normalized_version = (version or "").strip()
    if not normalized_version or not _VERSION_RE.fullmatch(normalized_version):
        if require:
            raise ReleaseIdentityError(f"invalid version for {component}: {version!r}")
        normalized_version = normalized_version or "0.0.0-dev"
    if require and normalized_version in _PLACEHOLDER_VERSIONS:
        raise ReleaseIdentityError(
            f"refusing placeholder version {normalized_version!r} for {component} "
            "in a production release"
        )

    sha = normalize_git_sha(git_sha, require=require)
    if sha:
        return f"{component}@{normalized_version}+{sha}"
    return f"{component}@{normalized_version}"


def is_canonical_release_id(value: str | None, *, component: str | None = None) -> bool:
    """True when ``value`` is a well-formed release ID for a known component.

    When ``component`` is given, the release must name that exact component.
    """
    if not value:
        return False
    match = _RELEASE_RE.fullmatch(value.strip())
    if match is None:
        return False
    matched_component = match.group("component")
    if matched_component not in COMPONENTS:
        return False
    return component is None or matched_component == component


def sanitize_component_release_override(
    value: str | None,
    *,
    component: str,
) -> str | None:
    """Return an emergency override only if it canonically names ``component``.

    A blank value yields ``None``. A value naming a *different* component (for
    example a server release accidentally wired into a target process) is
    refused with ``None`` rather than propagated -- this is the code-side guard
    against the "server release stamped on a target component" stop condition.
    """
    candidate = (value or "").strip()
    if not candidate:
        return None
    if is_canonical_release_id(candidate, component=component):
        return candidate
    return None


def server_git_sha() -> str | None:
    """The control-plane server's build SHA, from ``SERVER_GIT_SHA`` (12-char)."""
    return normalize_git_sha(os.getenv("SERVER_GIT_SHA"))


def _release_identity_required() -> bool:
    """Whether this process must fail closed on a degraded release ID.

    Production task definitions set ``PROLIFERATE_REQUIRE_RELEASE_IDENTITY=1``
    (see the R2 workflow list) so a build shipped without a stamped
    version/SHA crashes at boot instead of emitting ``0.0.0-dev``. Local dev,
    tests, and self-hosted images leave it unset and emit a version-only
    release.
    """
    raw = os.getenv("PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def server_release_id() -> str:
    """The canonical release ID for control-plane (``proliferate-server``) events."""
    return build_release_id(
        "proliferate-server",
        server_version(),
        server_git_sha(),
        require=_release_identity_required(),
    )
