"""The ``harness_settings`` response rider on ``GET /agent-auth/state``.

Regression for the harness-settings toggle snapping back to its default
(PRO-129): the rendered ``state.json`` document only carries a harness's
``settings`` passenger when that harness has an enabled selection — the
fail-closed law forbids a settings-only ``harnesses`` entry — so a
native-auth harness's persisted toggles are invisible in the document. The
state RESPONSE therefore carries the surface's full persisted settings map
as a response-only rider (the ``fingerprint`` pattern), which the settings
pane reads and the desktop strips before the runtime push.
"""

from __future__ import annotations

import dataclasses

from proliferate.server.agent_auth.models import agent_auth_state_payload
from proliferate.server.cloud.materialization.materialize import agent_auth
from tests.unit.test_agent_auth_materialization import _inputs, _selection


class TestHarnessSettingsRider:
    def test_settings_without_a_selection_never_ride_the_document(self) -> None:
        # Pins the render-side law the rider exists to compensate for: a
        # harness with persisted settings but no enabled selection is ABSENT
        # from the document (absent means native), not present-but-empty
        # (which would refuse the launch).
        state, _ = agent_auth.render_agent_auth_state(
            dataclasses.replace(_inputs(()), harness_settings={"claude": {"chrome": True}})
        )
        assert state["harnesses"] == []

    def test_payload_carries_the_rider_for_a_settings_only_harness(self) -> None:
        harness_settings = {"claude": {"chrome": True}}
        state, fingerprint = agent_auth.render_agent_auth_state(
            dataclasses.replace(_inputs(()), harness_settings=harness_settings)
        )
        payload = agent_auth_state_payload(
            state, fingerprint=fingerprint, harness_settings=harness_settings
        )
        assert payload.harnesses == []
        assert payload.harness_settings == harness_settings
        # Response-only: the rider never enters the canonical document (or its
        # fingerprint), exactly like `fingerprint` itself.
        assert "harness_settings" not in state

    def test_payload_rider_coexists_with_the_delivered_settings_passenger(self) -> None:
        # A harness WITH an enabled selection still carries its settings
        # passenger inside the document; the rider is the same map, so the
        # settings pane reads one surface regardless of route.
        harness_settings = {"claude": {"chrome": True}}
        state, fingerprint = agent_auth.render_agent_auth_state(
            dataclasses.replace(
                _inputs((_selection(harness="claude", source_kind="gateway"),)),
                harness_settings=harness_settings,
            )
        )
        payload = agent_auth_state_payload(
            state, fingerprint=fingerprint, harness_settings=harness_settings
        )
        assert payload.harnesses[0].settings == {"chrome": True}
        assert payload.harness_settings == harness_settings
