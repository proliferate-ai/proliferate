"""Slug helpers for human-friendly, URL-safe organization identifiers."""

from __future__ import annotations

import re

_SLUG_ALLOWED = re.compile(r"[^a-z0-9]+")
_SLUG_TRIM = re.compile(r"^-+|-+$")

# Keep slugs short enough to live comfortably in a login URL an admin pastes
# into onboarding docs, but long enough to stay readable.
SLUG_MAX_LENGTH = 48
_SLUG_FALLBACK = "org"


def slugify(value: str | None) -> str:
    """Normalize a display name into a lowercase, hyphen-separated slug.

    Non-alphanumeric runs collapse to a single hyphen; leading/trailing hyphens
    are trimmed; the result is length-capped. An empty result falls back to a
    stable placeholder so callers always get a non-empty base to build on.
    """
    lowered = (value or "").strip().lower()
    hyphenated = _SLUG_ALLOWED.sub("-", lowered)
    trimmed = _SLUG_TRIM.sub("", hyphenated)
    capped = trimmed[:SLUG_MAX_LENGTH]
    capped = _SLUG_TRIM.sub("", capped)
    return capped or _SLUG_FALLBACK
