from __future__ import annotations

import pytest

from proliferate.server.cloud.integrations.oauth.scope_policy import (
    OAuthScopePolicyError,
    resolve_refreshed_oauth_scopes,
    validate_callback_oauth_scopes,
    validate_stored_oauth_scopes,
)

CONFIGURED = ("search:read.public", "search:read.private")


def test_exact_callback_accepts_same_scope_set_in_provider_order() -> None:
    assert (
        validate_callback_oauth_scopes(
            granted_scopes=("search:read.private", "search:read.public"),
            requested_scopes=CONFIGURED,
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )
        == CONFIGURED
    )


@pytest.mark.parametrize(
    "granted_scopes",
    [None, (), ("search:read.public",), (*CONFIGURED, "chat:write")],
)
def test_exact_callback_rejects_missing_partial_or_extra_grant(
    granted_scopes: tuple[str, ...] | None,
) -> None:
    with pytest.raises(OAuthScopePolicyError) as exc_info:
        validate_callback_oauth_scopes(
            granted_scopes=granted_scopes,
            requested_scopes=CONFIGURED,
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )

    assert exc_info.value.code == "oauth_scope_mismatch"


def test_exact_callback_rejects_configuration_change_during_flow() -> None:
    with pytest.raises(OAuthScopePolicyError, match="exact configured scopes"):
        validate_callback_oauth_scopes(
            granted_scopes=CONFIGURED,
            requested_scopes=("search:read.public",),
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )


def test_refresh_omission_preserves_legacy_empty_scope_metadata() -> None:
    assert (
        resolve_refreshed_oauth_scopes(
            reported_scopes=None,
            stored_scopes=(),
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )
        == ()
    )


def test_refresh_omission_preserves_known_scope_metadata() -> None:
    assert (
        resolve_refreshed_oauth_scopes(
            reported_scopes=None,
            stored_scopes=CONFIGURED,
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )
        == CONFIGURED
    )


@pytest.mark.parametrize(
    "reported_scopes",
    [(), (*CONFIGURED, "chat:write")],
)
def test_exact_refresh_rejects_empty_or_scope_above_ceiling(
    reported_scopes: tuple[str, ...],
) -> None:
    with pytest.raises(OAuthScopePolicyError) as exc_info:
        resolve_refreshed_oauth_scopes(
            reported_scopes=reported_scopes,
            stored_scopes=CONFIGURED,
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )

    assert exc_info.value.code == "oauth_scope_mismatch"


def test_exact_refresh_accepts_nonempty_subset_in_canonical_order() -> None:
    assert resolve_refreshed_oauth_scopes(
        reported_scopes=("search:read.private",),
        stored_scopes=CONFIGURED,
        configured_scopes=CONFIGURED,
        scope_policy="exact",
    ) == ("search:read.private",)


def test_exact_access_rejects_known_stored_scope_outside_ceiling() -> None:
    with pytest.raises(OAuthScopePolicyError) as exc_info:
        validate_stored_oauth_scopes(
            stored_scopes=(*CONFIGURED, "chat:write"),
            configured_scopes=CONFIGURED,
            scope_policy="exact",
        )

    assert exc_info.value.code == "oauth_scope_mismatch"


def test_provider_policy_preserves_existing_scope_behavior() -> None:
    assert validate_callback_oauth_scopes(
        granted_scopes=("provider:write",),
        requested_scopes=("provider:read",),
        configured_scopes=("configured:read",),
        scope_policy="provider",
    ) == ("provider:write",)
    assert resolve_refreshed_oauth_scopes(
        reported_scopes=None,
        stored_scopes=("provider:write",),
        configured_scopes=("configured:read",),
        scope_policy="provider",
    ) == ("provider:write",)
    assert resolve_refreshed_oauth_scopes(
        reported_scopes=(),
        stored_scopes=("provider:write",),
        configured_scopes=("configured:read",),
        scope_policy="provider",
    ) == ("provider:write",)
