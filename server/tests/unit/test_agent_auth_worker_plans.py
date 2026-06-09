from __future__ import annotations

import uuid

from proliferate.server.cloud.agent_auth.worker_plans import _worker_cleanup_plan_from_entry


def test_worker_cleanup_plan_from_entry_infers_slot_for_legacy_pending_cleanup() -> None:
    credential_id = uuid.uuid4()

    plan = _worker_cleanup_plan_from_entry(
        {
            "agentKind": "claude",
            "credentialId": str(credential_id),
            "credentialRevision": 3,
            "materializationMode": "synced_files",
            "paths": [".claude/.credentials.json"],
            "reason": "credential_revoked",
        }
    )

    assert plan is not None
    assert plan.agent_kind == "claude"
    assert plan.auth_slot_id == "anthropic"
    assert plan.credential_id == credential_id
    assert plan.credential_revision == 3
    assert plan.synced_files is not None
    assert plan.synced_files.cleanup == [
        {
            "relativePath": ".claude/.credentials.json",
            "reason": "credential_revoked",
        }
    ]


def test_worker_cleanup_plan_from_entry_rejects_malformed_explicit_auth_slot() -> None:
    plan = _worker_cleanup_plan_from_entry(
        {
            "agentKind": "claude",
            "authSlotId": None,
            "credentialId": str(uuid.uuid4()),
            "credentialRevision": 3,
            "materializationMode": "synced_files",
            "paths": [".claude/.credentials.json"],
        }
    )

    assert plan is None
