"""The link scheme is total, closed over UUIDs, and stable in shape."""

import pytest

from proliferate.observability.links import session_links

SESSION = "0191d1f0-0000-7000-8000-000000000042"


def test_the_five_links_render_from_one_id() -> None:
    links = session_links(SESSION)
    assert set(links) == {"replay", "sentry", "honeycomb", "logs", "support_reports"}
    assert links["replay"] == f"https://app.proliferate.com/sessions/{SESSION}"
    assert f"project%3Aproliferate-server%20session_id%3A{SESSION}" in links["sentry"]
    assert "proliferate.session_id" in links["honeycomb"]
    from proliferate.observability.links import _star_encode

    assert _star_encode(SESSION) in links["logs"]
    assert _star_encode("support.report.captured") in links["support_reports"]


def test_environments_move_the_bases_not_the_shape() -> None:
    local = session_links(SESSION, environment="local")
    assert local["replay"].startswith("http://localhost:3000/")
    assert "/environments/dogfood/" in local["honeycomb"]
    production = session_links(SESSION, environment="production")
    assert "/environments/production/" in production["honeycomb"]
    staging = session_links(SESSION, environment="staging")
    assert staging["replay"].startswith("https://staging-app.proliferate.com/")


def test_log_groups_follow_the_infra_names() -> None:
    from proliferate.observability.links import _star_encode

    production = session_links(SESSION, environment="production")
    assert _star_encode("/ecs/proliferate-prod") in production["logs"]
    staging = session_links(SESSION, environment="staging")
    assert _star_encode("/ecs/proliferate-server-staging") in staging["logs"]


def test_non_uuid_input_is_refused() -> None:
    with pytest.raises(ValueError):
        session_links("select 1; --")
    with pytest.raises(ValueError):
        session_links("")


def test_uuid_is_canonicalized_before_it_reaches_a_url() -> None:
    links = session_links(SESSION.upper())
    assert SESSION in links["replay"]


def test_local_server_log_sink_is_debug_only_and_overridable(monkeypatch) -> None:
    from proliferate.middleware import logging as server_logging

    monkeypatch.setattr(server_logging.settings, "debug", False)
    assert server_logging._local_server_log_path() is None

    monkeypatch.setattr(server_logging.settings, "debug", True)
    monkeypatch.setenv("PROLIFERATE_LOGS_HOME", "/tmp/logs-home")
    assert server_logging._local_server_log_path() == "/tmp/logs-home/server/logs/server.log"
