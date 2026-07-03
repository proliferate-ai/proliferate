"""Pure-logic tests for gateway enrollment (sync fingerprint stability).

Relocated out of ``test_agent_gateway_domain.py`` during the P1 auth rebuild:
``build_sync_fingerprint`` lives in ``enrollment.py``, whose import chain pulls
in the materialization package (owned by another agent and rewritten alongside
the new selection model). Keeping it here keeps the auth-selection unit tests
importable in isolation.
"""

from __future__ import annotations

from proliferate.server.cloud.agent_gateway.enrollment import build_sync_fingerprint


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
