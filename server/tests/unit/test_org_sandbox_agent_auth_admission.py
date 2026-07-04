"""Verify that agent-auth selection preflight works unchanged with org profiles.

The agent-auth selection system is keyed on (user_id, harness_kind, surface).
When a member starts a session on an org sandbox profile, their personal
selections are used for the agent-auth state render. This test confirms that
the materialization build_agent_auth_state function works correctly regardless
of whether the sandbox is personal or org-owned.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.agent_gateway.records import AgentAuthSelectionRecord
from proliferate.server.cloud.materialization.materialize.agent_auth import (
    AgentAuthStateInputs,
    render_agent_auth_state,
)


def _make_selection(
    *,
    user_id: UUID,
    harness_kind: str = "claude",
    surface: str = "cloud",
    source_kind: str = "gateway",
    api_key_id: UUID | None = None,
    env_var_name: str | None = None,
    provider_hint: str | None = None,
    enabled: bool = True,
) -> AgentAuthSelectionRecord:
    now = datetime.now(tz=timezone.utc)
    return AgentAuthSelectionRecord(
        id=uuid4(),
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        source_kind=source_kind,
        api_key_id=api_key_id,
        env_var_name=env_var_name,
        provider_hint=provider_hint,
        enabled=enabled,
        created_at=now,
        updated_at=now,
    )


def test_render_agent_auth_state_works_for_org_profile_member() -> None:
    """Agent auth state rendering does not depend on sandbox ownership.

    A member starting a session on an org profile uses their own selections.
    The render function only needs the user's selections + enrollment state,
    regardless of whether the sandbox is personal or org-owned.
    """
    member_user_id = uuid4()
    org_id = uuid4()  # The org that owns the sandbox (unused by renderer)

    # Member has a gateway selection for cloud surface
    selection = _make_selection(
        user_id=member_user_id,
        harness_kind="claude",
        surface="cloud",
        source_kind="gateway",
    )

    inputs = AgentAuthStateInputs(
        user_id=member_user_id,
        revision=1,
        selections=(selection,),
        api_key_values={},
        enrollment_sync_status="synced",
        gateway_virtual_key="sk-test-virtual-key",
        gateway_base_url="https://litellm.example.com",
    )

    state, fingerprint = render_agent_auth_state(inputs)

    # The state should render successfully with harness entries
    assert state["version"] == 2
    assert "harnesses" in state
    harnesses = state["harnesses"]
    # Harnesses is a list of dicts, each with harness_kind + sources
    assert isinstance(harnesses, list)
    # Gateway source should resolve to a claude harness entry
    claude_entries = [h for h in harnesses if h.get("harness_kind") == "claude"]
    assert len(claude_entries) == 1
    claude_harness = claude_entries[0]
    assert "sources" in claude_harness
    assert len(claude_harness["sources"]) > 0
    # The fingerprint should be a hex digest
    assert len(fingerprint) == 64  # sha256 hex


def test_render_agent_auth_state_empty_selections() -> None:
    """Empty selections (native state) renders to empty harnesses list."""
    member_user_id = uuid4()

    inputs = AgentAuthStateInputs(
        user_id=member_user_id,
        revision=0,
        selections=(),
        api_key_values={},
        enrollment_sync_status=None,
        gateway_virtual_key=None,
        gateway_base_url=None,
    )

    state, fingerprint = render_agent_auth_state(inputs)

    assert state["version"] == 2
    harnesses = state["harnesses"]
    assert isinstance(harnesses, list)
    assert len(harnesses) == 0
