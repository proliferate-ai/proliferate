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


def test_parse_rejects_malformed_config() -> None:
    with pytest.raises(IntegrationConfigError):
        parse_definition_config("not json at all {")
