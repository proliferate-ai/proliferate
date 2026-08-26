"""Pure OAuth scope-policy rules for hosted integration accounts."""

from __future__ import annotations

import re
from collections.abc import Iterable

_SCOPE_SEPARATOR_RE = re.compile(r"[\s,]+")


class OAuthScopePolicyError(ValueError):
    """A provider scope response violated the configured integration policy."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_oauth_scopes(raw: str | Iterable[object] | None) -> tuple[str, ...]:
    """Normalize comma/space-delimited scopes, preserving first-seen order."""
    if raw is None:
        return ()
    values: Iterable[object] = (raw,) if isinstance(raw, str) else raw
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        for scope in _SCOPE_SEPARATOR_RE.split(str(value).strip()):
            if scope and scope not in seen:
                normalized.append(scope)
                seen.add(scope)
    return tuple(normalized)


def resolve_requested_oauth_scope(
    *,
    challenged_scope: str | None,
    configured_scopes: tuple[str, ...],
    scopes_required: bool,
    scope_policy: str,
) -> str | None:
    """Resolve the authorization scope without letting exact policies widen."""
    if scope_policy == "exact":
        configured = normalize_oauth_scopes(configured_scopes)
        challenge = normalize_oauth_scopes(challenged_scope)
        if not configured:
            if scopes_required:
                raise OAuthScopePolicyError(
                    "missing_oauth_scope",
                    "This integration requires OAuth scopes, but none were configured.",
                )
            return None
        unexpected = set(challenge) - set(configured)
        if unexpected:
            raise OAuthScopePolicyError(
                "oauth_scope_escalation",
                "OAuth provider requested scopes outside the configured ceiling.",
            )
        return " ".join(configured)

    challenge_value = (challenged_scope or "").strip()
    if challenge_value:
        return challenge_value
    configured_value = " ".join(scope.strip() for scope in configured_scopes if scope.strip())
    if configured_value:
        return configured_value
    if scopes_required:
        raise OAuthScopePolicyError(
            "missing_oauth_scope",
            "This integration requires OAuth scopes, but none were provided.",
        )
    return None


def validate_callback_oauth_scopes(
    *,
    granted_scopes: tuple[str, ...] | None,
    requested_scopes: tuple[str, ...],
    configured_scopes: tuple[str, ...],
    scope_policy: str,
) -> tuple[str, ...]:
    """Validate a token grant before credentials become usable."""
    granted = normalize_oauth_scopes(granted_scopes)
    if scope_policy != "exact":
        return granted

    configured = normalize_oauth_scopes(configured_scopes)
    requested = normalize_oauth_scopes(requested_scopes)
    if (
        granted_scopes is None
        or set(requested) != set(configured)
        or set(granted) != set(configured)
    ):
        raise OAuthScopePolicyError(
            "oauth_scope_mismatch",
            "OAuth provider did not grant the exact configured scopes.",
        )
    return configured


def validate_stored_oauth_scopes(
    *,
    stored_scopes: tuple[str, ...],
    configured_scopes: tuple[str, ...],
    scope_policy: str,
) -> tuple[str, ...]:
    """Reject credentials known to exceed an exact scope ceiling.

    Empty or partial legacy metadata remains usable: it cannot prove excess
    privilege and existing read-only Slack accounts must keep search working.
    """
    stored = normalize_oauth_scopes(stored_scopes)
    if scope_policy == "exact":
        configured = normalize_oauth_scopes(configured_scopes)
        stored_set = set(stored)
        if stored_set - set(configured):
            raise OAuthScopePolicyError(
                "oauth_scope_mismatch",
                "Stored OAuth scopes exceed the configured ceiling.",
            )
        return tuple(scope for scope in configured if scope in stored_set)
    return stored


def resolve_refreshed_oauth_scopes(
    *,
    reported_scopes: tuple[str, ...] | None,
    stored_scopes: tuple[str, ...],
    configured_scopes: tuple[str, ...],
    scope_policy: str,
) -> tuple[str, ...]:
    """Resolve refresh scopes, distinguishing omission from an empty grant."""
    stored = validate_stored_oauth_scopes(
        stored_scopes=stored_scopes,
        configured_scopes=configured_scopes,
        scope_policy=scope_policy,
    )
    if reported_scopes is None:
        return stored

    reported = normalize_oauth_scopes(reported_scopes)
    if scope_policy != "exact":
        # Preserve the former provider-directed refresh behavior, which used
        # the stored scopes whenever the refreshed value was falsey.
        return reported or stored

    configured = normalize_oauth_scopes(configured_scopes)
    reported_set = set(reported)
    if not reported or reported_set - set(configured):
        raise OAuthScopePolicyError(
            "oauth_scope_mismatch",
            "OAuth provider returned an invalid scope set for the configured ceiling.",
        )
    return tuple(scope for scope in configured if scope in reported_set)
