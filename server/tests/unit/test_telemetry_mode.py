from __future__ import annotations

import pytest

from proliferate.config import Settings, settings
from proliferate.utils.telemetry_mode import (
    get_server_telemetry_mode,
    is_anonymous_telemetry_enabled,
    is_vendor_telemetry_enabled,
)


def test_settings_accept_prefixed_telemetry_env_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PROLIFERATE_TELEMETRY_MODE", "self_managed")
    monkeypatch.setenv(
        "PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT",
        "https://collector.example/v1/telemetry/anonymous",
    )
    monkeypatch.setenv("PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED", "true")

    resolved = Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-secret",
        cloud_secret_key="test-cloud-secret",
    )

    assert resolved.telemetry_mode == "self_managed"
    assert (
        resolved.anonymous_telemetry_endpoint == "https://collector.example/v1/telemetry/anonymous"
    )
    assert resolved.anonymous_telemetry_disabled is True


def test_hosted_product_enables_vendor_but_not_anonymous_disable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(settings, "anonymous_telemetry_disabled", False)

    assert get_server_telemetry_mode() == "hosted_product"
    assert is_vendor_telemetry_enabled() is True
    assert is_anonymous_telemetry_enabled() is True


def test_invalid_mode_raises() -> None:
    original_mode = settings.telemetry_mode
    try:
        settings.telemetry_mode = "wrong"  # type: ignore[assignment]
        with pytest.raises(RuntimeError, match="Invalid telemetry_mode"):
            get_server_telemetry_mode()
    finally:
        settings.telemetry_mode = original_mode


# ---------------------------------------------------------------------------
# T1-SH-1 (specs/developing/testing/self-hosting.md): single_org_mode
# derivation.
#
# `single_org_mode` is the invariant every self-hosted deploy leans on (one
# instance org, first-run `/setup` claim, invite-to-join). It is DERIVED from
# the telemetry mode — `telemetry_mode != "hosted_product"` — so BOTH
# `local_dev` and `self_managed` are single-org, and only hosted production is
# multi-org (config.py:376-379). An explicit `SINGLE_ORG_MODE` /
# `PROLIFERATE_SINGLE_ORG_MODE` override wins in both directions. This pins the
# predicate so a refactor can't silently flip a self-hosted box into multi-org
# (or hosted into single-org).
# ---------------------------------------------------------------------------

# Both env aliases for the override, so a leaked ambient value can't taint the
# no-override cases (config.py:31-34).
_OVERRIDE_ENV_ALIASES = ("SINGLE_ORG_MODE", "PROLIFERATE_SINGLE_ORG_MODE")


def _build_settings(monkeypatch: pytest.MonkeyPatch, telemetry_mode: str) -> Settings:
    monkeypatch.setenv("PROLIFERATE_TELEMETRY_MODE", telemetry_mode)
    return Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-secret",
        cloud_secret_key="test-cloud-secret",
    )


def _clear_override_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for alias in _OVERRIDE_ENV_ALIASES:
        monkeypatch.delenv(alias, raising=False)


@pytest.mark.parametrize(
    ("telemetry_mode", "expected"),
    [
        ("self_managed", True),
        ("local_dev", True),
        ("hosted_product", False),
    ],
)
def test_single_org_mode_derives_from_telemetry_mode(
    monkeypatch: pytest.MonkeyPatch,
    telemetry_mode: str,
    expected: bool,
) -> None:
    _clear_override_env(monkeypatch)
    resolved = _build_settings(monkeypatch, telemetry_mode)
    # No explicit override → the derived value governs.
    assert resolved.single_org_mode_override is None
    assert resolved.single_org_mode is expected


def test_single_org_override_false_wins_over_self_managed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_override_env(monkeypatch)
    monkeypatch.setenv("SINGLE_ORG_MODE", "false")
    resolved = _build_settings(monkeypatch, "self_managed")
    # Derivation alone would be single-org; the explicit override forces it off.
    assert resolved.single_org_mode_override is False
    assert resolved.single_org_mode is False


def test_single_org_override_true_wins_over_hosted_product(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_override_env(monkeypatch)
    monkeypatch.setenv("SINGLE_ORG_MODE", "true")
    resolved = _build_settings(monkeypatch, "hosted_product")
    # Derivation alone would be multi-org; the explicit override forces it on.
    assert resolved.single_org_mode_override is True
    assert resolved.single_org_mode is True


def test_single_org_override_accepts_the_prefixed_alias(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The override honors PROLIFERATE_SINGLE_ORG_MODE identically to the bare
    # form, so operators who namespace every var still steer the mode.
    _clear_override_env(monkeypatch)
    monkeypatch.setenv("PROLIFERATE_SINGLE_ORG_MODE", "false")
    resolved = _build_settings(monkeypatch, "self_managed")
    assert resolved.single_org_mode_override is False
    assert resolved.single_org_mode is False
