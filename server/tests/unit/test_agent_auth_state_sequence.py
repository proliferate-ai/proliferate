"""Sequence/fingerprint governance at the pure-render level (slice 3, spec §2).

The persisted counter's integration behavior lives in
``tests/integration/test_agent_auth_sequence_governance.py``; this module pins
the renderer-side laws the counter depends on: the fingerprint hashes the
``harnesses`` array ONLY, a no-op render is byte-stable, and every configured
harness rides every render (one changed selection can never make a sibling
harness's entry drift).
"""

from __future__ import annotations

import dataclasses
import json
import uuid

from proliferate.server.agent_auth import state_render as agent_auth
from tests.unit.test_agent_auth_state_render import _inputs, _selection


class TestHarnessesFingerprint:
    def test_fingerprint_hashes_only_the_harnesses_array(self) -> None:
        # Same harnesses content, different sequence AND different user_id:
        # the fingerprint must not move (spec §2 — the fingerprint is a rider
        # hashing the canonical `harnesses` array only, so stamping a new
        # sequence into the envelope can never read as a content change).
        selections = (_selection(harness="claude", source_kind="gateway"),)
        base = _inputs(selections)
        restamped = dataclasses.replace(base, sequence=base.sequence + 7)
        reowned = dataclasses.replace(base, user_id=uuid.uuid4())

        base_state, base_fp = agent_auth.render_agent_auth_state(base)
        restamped_state, restamped_fp = agent_auth.render_agent_auth_state(restamped)
        _, reowned_fp = agent_auth.render_agent_auth_state(reowned)

        assert base_fp == restamped_fp == reowned_fp
        assert restamped_state["sequence"] != base_state["sequence"]
        assert base_fp == agent_auth.agent_auth_harnesses_fingerprint(base_state["harnesses"])

    def test_fingerprint_changes_when_harnesses_content_changes(self) -> None:
        # The counter's whole trigger: content moves the hash. (The rotation
        # case proper lives in the render suite; this pins the array-only
        # helper against the same input family the identity cases above use.)
        selections = (_selection(harness="claude", source_kind="gateway"),)
        _, before = agent_auth.render_agent_auth_state(_inputs(selections))
        _, after = agent_auth.render_agent_auth_state(
            _inputs(selections, gateway_virtual_key="sk-litellm-rotated")
        )
        assert before != after


class TestNoopRenderStability:
    def test_noop_render_keeps_sequence_and_fingerprint(self) -> None:
        # Pure level of "a no-op render changes neither" (spec §2): identical
        # inputs render an identical document and an identical fingerprint,
        # so the persisted counter's IS DISTINCT FROM predicate sees nothing
        # to bump.
        key_id = uuid.uuid4()
        inputs = _inputs(
            (
                _selection(harness="claude", source_kind="gateway"),
                _selection(
                    harness="codex",
                    source_kind="api_key",
                    api_key_id=key_id,
                    env_var_name="OPENAI_API_KEY",
                ),
            ),
            api_key_values={key_id: "sk-openai-raw"},
        )
        first_state, first_fp = agent_auth.render_agent_auth_state(inputs)
        second_state, second_fp = agent_auth.render_agent_auth_state(inputs)
        assert first_state == second_state
        assert first_fp == second_fp
        assert first_state["sequence"] == second_state["sequence"]


class TestFullDocumentRenders:
    def test_rendered_document_contains_every_configured_harness(self) -> None:
        # Spec §2 proof ("every harness with any enabled selection appears in
        # every render"; delivery-spec: `rendered_document_contains_every_
        # configured_harness`): change ONE harness's selection and re-render —
        # every configured harness is still present AND the untouched
        # harnesses' entries are byte-identical.
        claude_key = uuid.uuid4()
        codex_key = uuid.uuid4()
        cursor_key = uuid.uuid4()

        def selections(claude_env: str) -> tuple:
            return (
                _selection(
                    harness="claude",
                    source_kind="api_key",
                    api_key_id=claude_key,
                    env_var_name=claude_env,
                ),
                _selection(
                    harness="codex",
                    source_kind="api_key",
                    api_key_id=codex_key,
                    env_var_name="OPENAI_API_KEY",
                ),
                _selection(
                    harness="cursor",
                    source_kind="api_key",
                    api_key_id=cursor_key,
                    env_var_name="CURSOR_API_KEY",
                ),
                _selection(harness="opencode", source_kind="gateway"),
            )

        api_key_values = {
            claude_key: "sk-ant-raw",
            codex_key: "sk-openai-raw",
            cursor_key: "cur-raw",
        }
        before, _ = agent_auth.render_agent_auth_state(
            _inputs(selections("ANTHROPIC_API_KEY"), api_key_values=api_key_values)
        )
        # The one edit: claude's selection moves to a different env var.
        after, _ = agent_auth.render_agent_auth_state(
            _inputs(selections("ANTHROPIC_AUTH_TOKEN"), api_key_values=api_key_values)
        )

        before_by_kind = {e["harness_kind"]: e for e in before["harnesses"]}
        after_by_kind = {e["harness_kind"]: e for e in after["harnesses"]}
        assert (
            set(after_by_kind)
            == set(before_by_kind)
            == {
                "claude",
                "codex",
                "cursor",
                "opencode",
            }
        )
        for untouched in ("codex", "cursor", "opencode"):
            assert json.dumps(after_by_kind[untouched], sort_keys=True) == json.dumps(
                before_by_kind[untouched], sort_keys=True
            ), untouched
        assert after_by_kind["claude"] != before_by_kind["claude"]
