from __future__ import annotations

from proliferate.server.support.domain.tracker_intent import (
    TRACKER_SUMMARY_MAX_CHARS,
    build_tracker_summary,
    normalize_telemetry_refs,
    parse_client_release_id,
)


def test_parse_client_release_id_accepts_canonical_value() -> None:
    value = "proliferate-desktop@0.3.26+9affc0f0d489"
    assert parse_client_release_id(value) == value


def test_parse_client_release_id_accepts_all_canonical_components() -> None:
    for component in (
        "proliferate-server",
        "proliferate-litellm",
        "proliferate-web",
        "proliferate-mobile",
        "proliferate-desktop",
        "proliferate-desktop-native",
        "anyharness",
        "proliferate-worker",
        "proliferate-supervisor",
    ):
        value = f"{component}@1.2.3+0123456789ab"
        assert parse_client_release_id(value) == value


def test_parse_client_release_id_rejects_unknown_component() -> None:
    # Sentry project names are routing names, not release components.
    assert parse_client_release_id("proliferate-cloud@0.3.26+9affc0f0d489") is None
    assert parse_client_release_id("proliferate-target@0.3.26+9affc0f0d489") is None


def test_parse_client_release_id_rejects_malformed_version_and_sha() -> None:
    assert parse_client_release_id("proliferate-web@1.2+9affc0f0d489") is None
    assert parse_client_release_id("proliferate-web@1.2.3+SHORT") is None
    assert parse_client_release_id("proliferate-web@1.2.3+0123456789abcdef") is None
    assert parse_client_release_id("proliferate-web@1.2.3+0123456789AB") is None
    assert parse_client_release_id("0.3.26+9affc0f0d489") is None
    assert parse_client_release_id(None) is None
    assert parse_client_release_id("") is None


def test_build_tracker_summary_scrubs_and_bounds() -> None:
    message = "Login broke. token=super-secret-value contact me at a@b.com " + "x" * 400
    summary = build_tracker_summary(message)
    assert summary is not None
    assert len(summary) <= TRACKER_SUMMARY_MAX_CHARS
    assert "super-secret-value" not in summary


def test_build_tracker_summary_collapses_whitespace() -> None:
    summary = build_tracker_summary("  Prod   is\n\ndown  ")
    assert summary == "Prod is down"


def test_build_tracker_summary_empty_is_none() -> None:
    assert build_tracker_summary("") is None
    assert build_tracker_summary("    ") is None
    assert build_tracker_summary(None) is None


def test_normalize_telemetry_refs_keeps_pairs_and_dedupes() -> None:
    normalized = normalize_telemetry_refs(
        {
            "sentryEvents": [
                {"project": "proliferate-web", "eventId": "e1"},
                {"project": "proliferate-web", "eventId": "e1"},
                {"project": "proliferate-desktop", "eventId": "e2"},
            ],
            "sentryEventIds": ["e1", "e3"],
            "posthogDistinctId": "d1",
        }
    )
    assert normalized["sentryEvents"] == [
        {"project": "proliferate-web", "eventId": "e1"},
        {"project": "proliferate-desktop", "eventId": "e2"},
    ]
    # e1 already resolved to a pair; only the genuinely project-less id remains.
    assert normalized["sentryEventIds"] == ["e3"]
    assert normalized["posthogDistinctId"] == "d1"


def test_normalize_telemetry_refs_never_guesses_project() -> None:
    normalized = normalize_telemetry_refs({"sentryEventIds": ["e1", "e2"]})
    assert "sentryEvents" not in normalized
    assert normalized["sentryEventIds"] == ["e1", "e2"]


def test_normalize_telemetry_refs_empty() -> None:
    assert normalize_telemetry_refs(None) == {}
    assert normalize_telemetry_refs({}) == {}
