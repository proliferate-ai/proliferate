"""Unit tests for deterministic component release identity (support-system P2)."""

from __future__ import annotations

import pytest

from proliferate.server import release
from proliferate.server.release import (
    COMPONENTS,
    ReleaseIdentityError,
    build_release_id,
    is_canonical_release_id,
    normalize_git_sha,
    sanitize_component_release_override,
    server_release_id,
)

_SHA40 = "3c2bbf20e21599aa11bb22cc33dd44ee55ff6600"
_SHA12 = "3c2bbf20e215"


def test_components_are_the_contract_nine() -> None:
    assert {
        "proliferate-server",
        "proliferate-litellm",
        "proliferate-web",
        "proliferate-mobile",
        "proliferate-desktop",
        "proliferate-desktop-native",
        "anyharness",
        "proliferate-worker",
        "proliferate-supervisor",
    } == COMPONENTS


def test_build_release_id_appends_twelve_char_sha() -> None:
    assert (
        build_release_id("proliferate-server", "0.3.27", _SHA40)
        == f"proliferate-server@0.3.27+{_SHA12}"
    )


def test_build_release_id_accepts_already_truncated_sha() -> None:
    assert (
        build_release_id("anyharness", "0.3.27", _SHA12) == f"anyharness@0.3.27+{_SHA12}"
    )


def test_build_release_id_version_only_without_sha() -> None:
    assert build_release_id("proliferate-web", "0.3.27", None) == "proliferate-web@0.3.27"


def test_build_release_id_rejects_unknown_component() -> None:
    with pytest.raises(ReleaseIdentityError):
        build_release_id("proliferate-cloud", "0.3.27", _SHA12)


@pytest.mark.parametrize("version", ["0.1.0", "0.0.0", "0.0.0-dev"])
def test_require_rejects_placeholder_version(version: str) -> None:
    with pytest.raises(ReleaseIdentityError):
        build_release_id("proliferate-mobile", version, _SHA12, require=True)


def test_require_rejects_missing_sha() -> None:
    with pytest.raises(ReleaseIdentityError):
        build_release_id("proliferate-server", "0.3.27", None, require=True)


def test_require_rejects_missing_version() -> None:
    with pytest.raises(ReleaseIdentityError):
        build_release_id("proliferate-server", "", _SHA12, require=True)


def test_normalize_git_sha_truncates_and_lowercases() -> None:
    assert normalize_git_sha(_SHA40.upper()) == _SHA12
    assert normalize_git_sha(_SHA12) == _SHA12
    assert normalize_git_sha("  " + _SHA40 + "  ") == _SHA12


def test_normalize_git_sha_none_and_malformed() -> None:
    assert normalize_git_sha(None) is None
    assert normalize_git_sha("") is None
    assert normalize_git_sha("nothex") is None
    with pytest.raises(ReleaseIdentityError):
        normalize_git_sha("nothex", require=True)
    with pytest.raises(ReleaseIdentityError):
        normalize_git_sha(None, require=True)


def test_is_canonical_release_id() -> None:
    assert is_canonical_release_id(f"proliferate-server@0.3.27+{_SHA12}")
    assert is_canonical_release_id("anyharness@0.3.27")  # version-only is valid
    assert is_canonical_release_id(
        f"proliferate-worker@0.3.27+{_SHA12}", component="proliferate-worker"
    )
    # Component mismatch.
    assert not is_canonical_release_id(
        f"proliferate-server@0.3.27+{_SHA12}", component="proliferate-worker"
    )
    # Unknown component / malformed.
    assert not is_canonical_release_id(f"proliferate-cloud@0.3.27+{_SHA12}")
    assert not is_canonical_release_id("not a release")
    assert not is_canonical_release_id("")
    assert not is_canonical_release_id(None)
    # A bare 40-char sha (the live runtime bug) is not canonical.
    assert not is_canonical_release_id(f"anyharness@{_SHA40}")


def test_sanitize_override_refuses_cross_component_release() -> None:
    """The server release must never be accepted as a target override."""
    server_release = f"proliferate-server@0.3.27+{_SHA12}"
    assert (
        sanitize_component_release_override(server_release, component="proliferate-worker")
        is None
    )
    assert (
        sanitize_component_release_override(server_release, component="anyharness") is None
    )


def test_sanitize_override_accepts_matching_component() -> None:
    worker_release = f"proliferate-worker@0.3.27+{_SHA12}"
    assert (
        sanitize_component_release_override(worker_release, component="proliferate-worker")
        == worker_release
    )


def test_sanitize_override_blank_is_none() -> None:
    assert sanitize_component_release_override("", component="anyharness") is None
    assert sanitize_component_release_override("   ", component="anyharness") is None
    assert sanitize_component_release_override(None, component="anyharness") is None


def test_server_release_id_uses_env_sha(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERVER_GIT_SHA", _SHA40)
    monkeypatch.setenv("SERVER_VERSION", "0.3.27")
    monkeypatch.delenv("PROLIFERATE_REQUIRE_RELEASE_IDENTITY", raising=False)
    assert server_release_id() == f"proliferate-server@0.3.27+{_SHA12}"


def test_server_release_id_version_only_without_sha(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SERVER_GIT_SHA", raising=False)
    monkeypatch.setenv("SERVER_VERSION", "0.3.27")
    monkeypatch.delenv("PROLIFERATE_REQUIRE_RELEASE_IDENTITY", raising=False)
    assert server_release_id() == "proliferate-server@0.3.27"


def test_server_release_id_fails_closed_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    """A production build with no stamped SHA must fail closed, not emit dev."""
    monkeypatch.setenv("PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "1")
    monkeypatch.delenv("SERVER_GIT_SHA", raising=False)
    monkeypatch.setenv("SERVER_VERSION", "0.3.27")
    with pytest.raises(ReleaseIdentityError):
        server_release_id()


def test_server_release_id_production_rejects_dev_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PROLIFERATE_REQUIRE_RELEASE_IDENTITY", "1")
    monkeypatch.setenv("SERVER_GIT_SHA", _SHA12)
    # Force the dev fallback by pointing at a version source that yields it.
    monkeypatch.setattr(release, "server_version", lambda: "0.0.0-dev")
    with pytest.raises(ReleaseIdentityError):
        server_release_id()
