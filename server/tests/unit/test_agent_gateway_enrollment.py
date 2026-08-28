"""Pure-logic tests for gateway enrollment (sync fingerprint stability).

Relocated out of ``test_agent_gateway_domain.py`` during the P1 auth rebuild:
the fingerprint builders live in ``enrollment.py``, whose import chain pulls
in the materialization package (owned by another agent and rewritten alongside
the new selection model). Keeping it here keeps the auth-selection unit tests
importable in isolation.
"""

from __future__ import annotations

from proliferate.server.ai_gateway.enrollment import (
    build_enrollment_key_fingerprint,
    build_enrollment_key_set_fingerprint,
)


class TestEnrollmentKeyFingerprint:
    def test_fingerprint_is_stable(self) -> None:
        first = build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="org-o-user-u", key_alias="vk-x"
        )
        second = build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="org-o-user-u", key_alias="vk-x"
        )
        assert first == second
        assert len(first) == 64

    def test_fingerprint_changes_with_any_component(self) -> None:
        base = build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="org-o-user-u", key_alias="vk-x"
        )
        assert base != build_enrollment_key_fingerprint(
            team_id="t2", litellm_user_id="org-o-user-u", key_alias="vk-x"
        )
        assert base != build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="org-o-user-v", key_alias="vk-x"
        )
        assert base != build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="org-o-user-u", key_alias="vk-y"
        )

    def test_identity_scheme_is_part_of_the_material(self) -> None:
        """The pre-D-2 shared `user-<id>` identity can never match the
        per-(org, member) identity: this inequality is what drives the D-3
        revoke + re-mint of legacy keys (model-gateway.md §Account model)."""
        legacy = build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="user-u", key_alias="vk-x"
        )
        org_scoped = build_enrollment_key_fingerprint(
            team_id="t1", litellm_user_id="org-o-user-u", key_alias="vk-x"
        )
        assert legacy != org_scoped


class TestEnrollmentKeySetFingerprint:
    def test_set_fingerprint_covers_identity_and_harness_set(self) -> None:
        base = build_enrollment_key_set_fingerprint(
            team_id="t1",
            litellm_user_id="org-o-user-u",
            subject_label="org-o-user-u",
            harness_kinds=("claude", "codex"),
        )
        assert base == build_enrollment_key_set_fingerprint(
            team_id="t1",
            litellm_user_id="org-o-user-u",
            subject_label="org-o-user-u",
            harness_kinds=("codex", "claude"),  # order-insensitive
        )
        assert base != build_enrollment_key_set_fingerprint(
            team_id="t1",
            litellm_user_id="user-u",  # the legacy shared identity drifts
            subject_label="org-o-user-u",
            harness_kinds=("claude", "codex"),
        )
        assert base != build_enrollment_key_set_fingerprint(
            team_id="t1",
            litellm_user_id="org-o-user-u",
            subject_label="org-o-user-u",
            harness_kinds=("claude", "codex", "grok"),
        )
