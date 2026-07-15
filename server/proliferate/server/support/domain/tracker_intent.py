"""Pure server-produced support tracker intent derivations.

These helpers derive the tracker-facing projection of a support report from the
private report intent: the canonical client release ID, the normalized Sentry
references, and the scrubbed bounded summary. They never expose the raw report
body; the summary is a redacted, length-capped derivative.
"""

from __future__ import annotations

import re

from proliferate.server.support.redaction import redact_support_text

# Canonical release components. The release ID always identifies the process
# that emitted the report intent. Sentry project names are routing names, not
# release components.
RELEASE_COMPONENTS: frozenset[str] = frozenset(
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

TRACKER_SUMMARY_MAX_CHARS = 240

# <component>@<semver>+<12-char-sha>. Semver core is X.Y.Z with an optional
# dot-separated pre-release suffix; the build SHA is exactly 12 lowercase hex.
_RELEASE_ID_RE = re.compile(
    r"^(?P<component>[a-z0-9][a-z0-9-]*)"
    r"@(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"
    r"\+(?P<sha>[0-9a-f]{12})$"
)

_WHITESPACE_RE = re.compile(r"\s+")


def parse_client_release_id(value: str | None) -> str | None:
    """Return the canonical release ID when valid, otherwise ``None``.

    A malformed value is treated as absent so it stores as NULL and the report
    stays feedable with a visible warning. The component must be one of the
    fixed release components; project names are never release components.
    """

    if not value:
        return None
    candidate = value.strip()
    match = _RELEASE_ID_RE.match(candidate)
    if match is None:
        return None
    if match.group("component") not in RELEASE_COMPONENTS:
        return None
    return candidate


def build_tracker_summary(message: str | None) -> str | None:
    """Build the scrubbed, whitespace-collapsed, <=240 char tracker summary.

    Secrets, bearer tokens, signed-URL query params, and long opaque strings are
    redacted before truncation. The summary is an internal safe projection; it
    is never a substitute for the private report body.
    """

    if not message:
        return None
    scrubbed = redact_support_text(message, max_chars=TRACKER_SUMMARY_MAX_CHARS * 4)
    collapsed = _WHITESPACE_RE.sub(" ", scrubbed).strip()
    if not collapsed:
        return None
    if len(collapsed) <= TRACKER_SUMMARY_MAX_CHARS:
        return collapsed
    # Reserve one character for the ellipsis so the stored value never exceeds
    # the column bound.
    return collapsed[: TRACKER_SUMMARY_MAX_CHARS - 1].rstrip() + "…"


def normalize_telemetry_refs(raw: dict[str, object] | None) -> dict[str, object]:
    """Normalize telemetry references into the stored canonical shape.

    Sentry references become ``{"sentryEvents": [{"project", "eventId"}]}``.
    Structured ``{project, eventId}`` pairs are retained. Bare
    ``sentryEventIds`` without a project are insufficient to form a pair; they
    are preserved under ``sentryEventIds`` for later bounded backfill but are
    never guessed into a project.
    """

    normalized: dict[str, object] = {}
    if not isinstance(raw, dict):
        return {}

    for key in ("posthogDistinctId", "posthogSessionId"):
        value = raw.get(key)
        if isinstance(value, str) and value:
            normalized[key] = value

    pairs = _normalize_sentry_events(raw.get("sentryEvents"))
    seen_event_ids = {pair["eventId"] for pair in pairs}
    if pairs:
        normalized["sentryEvents"] = pairs

    unresolved = _project_less_event_ids(raw.get("sentryEventIds"), seen_event_ids)
    if unresolved:
        normalized["sentryEventIds"] = unresolved

    return normalized


def _normalize_sentry_events(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    pairs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        project = item.get("project")
        event_id = item.get("eventId")
        if not isinstance(project, str) or not isinstance(event_id, str):
            continue
        project = project.strip()
        event_id = event_id.strip()
        if not project or not event_id:
            continue
        dedupe_key = (project, event_id)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        pairs.append({"project": project, "eventId": event_id})
    return pairs


def _project_less_event_ids(value: object, already_paired: set[str]) -> list[str]:
    if not isinstance(value, list):
        return []
    unresolved: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        event_id = item.strip()
        if not event_id or event_id in already_paired or event_id in seen:
            continue
        seen.add(event_id)
        unresolved.append(event_id)
    return unresolved
