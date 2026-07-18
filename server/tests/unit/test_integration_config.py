from __future__ import annotations

import pytest

from proliferate.server.cloud.integrations.config import (
    IntegrationConfigError,
    parse_definition_config,
    render_mcp_url,
    serialize_definition_config,
)
from proliferate.server.cloud.integrations.seeds import SEED_DEFINITIONS


def test_all_seeds_round_trip_through_the_config_codec() -> None:
    assert len(SEED_DEFINITIONS) == 13
    namespaces = {seed.namespace for seed in SEED_DEFINITIONS}
    assert {"linear", "notion", "context7", "exa", "posthog", "slack"} <= namespaces

    for seed in SEED_DEFINITIONS:
        raw = serialize_definition_config(seed.config)
        reparsed = parse_definition_config(raw)
        # Serializing the reparsed config is stable.
        assert serialize_definition_config(reparsed) == raw


def test_render_static_url() -> None:
    context7 = next(s for s in SEED_DEFINITIONS if s.namespace == "context7")
    assert render_mcp_url(context7.config, {}) == "https://mcp.context7.com/mcp"


def test_render_url_by_setting_resolves_variant_and_default() -> None:
    posthog = next(s for s in SEED_DEFINITIONS if s.namespace == "posthog")
    assert render_mcp_url(posthog.config, {"region": "eu"}) == "https://mcp-eu.posthog.com/mcp"
    assert render_mcp_url(posthog.config, {"region": "us"}) == "https://mcp.posthog.com/mcp"
    # Missing/unknown setting falls back to the default variant.
    assert render_mcp_url(posthog.config, {}) == "https://mcp.posthog.com/mcp"


def test_seed_auth_kinds_are_normalized() -> None:
    by_ns = {s.namespace: s for s in SEED_DEFINITIONS}
    assert by_ns["context7"].auth_kind == "api_key"
    assert by_ns["linear"].auth_kind == "oauth2"
    assert by_ns["linear"].oauth_client_mode == "dcr"
    assert by_ns["slack"].oauth_client_mode == "static"


def test_slack_seed_has_exact_required_oauth_scopes() -> None:
    slack = next(seed for seed in SEED_DEFINITIONS if seed.namespace == "slack")
    expected_scopes = (
        "search:read.public",
        "search:read.private",
        "search:read.im",
        "search:read.mpim",
        "search:read.files",
        "search:read.users",
    )

    assert slack.config.oauth_scopes == expected_scopes
    assert slack.config.oauth_scopes_required is True
    assert slack.config.oauth_scope_policy == "exact"

    reparsed = parse_definition_config(serialize_definition_config(slack.config))
    assert reparsed.oauth_scopes == expected_scopes
    assert reparsed.oauth_scopes_required is True
    assert reparsed.oauth_scope_policy == "exact"


def test_parse_rejects_unknown_oauth_scope_policy() -> None:
    with pytest.raises(IntegrationConfigError, match="unsupported OAuth scope policy"):
        parse_definition_config('{"oauthScopePolicy":"provider-controlled"}')


def test_legacy_config_defaults_to_provider_scope_policy() -> None:
    assert parse_definition_config("{}").oauth_scope_policy == "provider"


def test_parse_rejects_malformed_config() -> None:
    with pytest.raises(IntegrationConfigError):
        parse_definition_config("not json at all {")
