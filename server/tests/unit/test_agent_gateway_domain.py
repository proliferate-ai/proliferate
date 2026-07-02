"""Pure-logic tests for agent gateway route legality, hints, and fingerprints."""

from __future__ import annotations

import uuid

import pytest

from proliferate.db.store.agent_gateway.api_keys import build_redacted_hint
from proliferate.db.store.agent_gateway.route_selections import validate_route_selection
from proliferate.server.cloud.agent_gateway.enrollment import build_sync_fingerprint


class TestRouteSelectionLegality:
    def test_all_routes_are_legal_on_local(self) -> None:
        validate_route_selection(surface="local", route="native", api_key_id=None)
        validate_route_selection(surface="local", route="gateway", api_key_id=None)
        validate_route_selection(surface="local", route="api_key", api_key_id=uuid.uuid4())

    def test_cloud_allows_gateway_and_api_key(self) -> None:
        validate_route_selection(surface="cloud", route="gateway", api_key_id=None)
        validate_route_selection(surface="cloud", route="api_key", api_key_id=uuid.uuid4())

    def test_cloud_rejects_native(self) -> None:
        with pytest.raises(ValueError, match="native route"):
            validate_route_selection(surface="cloud", route="native", api_key_id=None)

    def test_api_key_route_requires_key_reference(self) -> None:
        with pytest.raises(ValueError, match="requires an api_key_id"):
            validate_route_selection(surface="local", route="api_key", api_key_id=None)

    def test_non_api_key_routes_reject_key_reference(self) -> None:
        with pytest.raises(ValueError, match="only valid for api_key"):
            validate_route_selection(surface="local", route="gateway", api_key_id=uuid.uuid4())

    def test_unknown_surface_and_route_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="surface"):
            validate_route_selection(surface="mobile", route="gateway", api_key_id=None)
        with pytest.raises(ValueError, match="route"):
            validate_route_selection(surface="local", route="magic", api_key_id=None)


class TestRedactedHint:
    def test_prefixed_key_keeps_prefix_and_tail(self) -> None:
        assert build_redacted_hint("sk-ant-api03-abcdefabc4") == "sk-...abc4"

    def test_short_key_is_not_over_redacted(self) -> None:
        assert build_redacted_hint("abc") == "...abc"

    def test_unprefixed_key_shows_tail_only(self) -> None:
        assert build_redacted_hint("0123456789abcdefwxyz") == "...wxyz"

    def test_hint_never_contains_middle_of_key(self) -> None:
        payload = "sk-proj-SECRETMIDDLEPARTxyz9"
        hint = build_redacted_hint(payload)
        assert "SECRETMIDDLEPART" not in hint
        assert hint.endswith("xyz9")


class TestSyncFingerprint:
    def test_fingerprint_is_stable(self) -> None:
        first = build_sync_fingerprint(team_id="t1", budget="5", key_alias="vk-user-x")
        second = build_sync_fingerprint(team_id="t1", budget="5", key_alias="vk-user-x")
        assert first == second
        assert len(first) == 64

    def test_fingerprint_changes_with_any_component(self) -> None:
        base = build_sync_fingerprint(team_id="t1", budget="5", key_alias="vk-user-x")
        assert base != build_sync_fingerprint(team_id="t2", budget="5", key_alias="vk-user-x")
        assert base != build_sync_fingerprint(team_id="t1", budget="10", key_alias="vk-user-x")
        assert base != build_sync_fingerprint(team_id="t1", budget="5", key_alias="vk-user-y")
