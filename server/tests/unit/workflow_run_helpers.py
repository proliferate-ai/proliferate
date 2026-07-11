"""Shared factories for the workflow service / StartRun regression tests.

Extracted from ``test_workflow_service.py`` when it was split into CRUD
(``test_workflow_service.py``) and StartRun (``test_workflow_start_run.py``)
files, so both share one set of row/definition factories.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_TRIGGER_MANUAL
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.server.cloud.workflows import service
from proliferate.server.cloud.workflows.models import WorkflowCreateRequest
from proliferate.utils.crypto import encrypt_json


async def make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def definition() -> dict:
    return {
        "version": 1,
        "inputs": [
            {"name": "issue", "type": "text", "required": True},
            {
                "name": "env",
                "type": "choice",
                "choices": ["prod", "staging"],
                "default": "staging",
            },
        ],
        "integrations": ["slack"],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {"kind": "agent.prompt", "prompt": "Fix {{inputs.issue}} on {{inputs.env}}"},
                    {"kind": "agent.emit", "name": "check", "prompt": "run tests"},
                    {
                        "kind": "notify",
                        "slack_channel_id": "C1",
                        "message": "done {{check.result}}",
                    },
                ],
            }
        ],
    }


def definition_with_notify_fields() -> dict:
    """A single-slot workflow whose notify uses agent-filled {{fields.*}}."""
    defn = definition()
    notify = defn["agents"][0]["steps"][2]
    notify["message"] = "done {{check.result}} — {{fields.summary}} (risk {{fields.risk}})"
    notify["agent_fields"] = {
        "slot": "main",
        "schema": {
            "summary": {"type": "string", "description": "one-liner"},
            "risk": {"type": "number"},
        },
    }
    return defn


def parallel_definition() -> dict:
    """A standalone node, a 2-lane parallel group, then a joining node."""
    return {
        "version": 1,
        "inputs": [{"name": "issue", "type": "text", "required": True}],
        "integrations": [],
        "agents": [
            {
                "slot": "plan",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {"kind": "agent.emit", "name": "spec", "prompt": "plan {{inputs.issue}}"}
                ],
            },
            {
                "parallel": [
                    {
                        "slot": "fix_a",
                        "harness": "claude",
                        "model": "sonnet",
                        "steps": [
                            {"kind": "agent.prompt", "prompt": "impl {{spec.summary}}"},
                            {"kind": "agent.emit", "name": "result_a", "prompt": "report"},
                        ],
                    },
                    {
                        "slot": "fix_b",
                        "harness": "codex",
                        "model": "gpt-5",
                        "steps": [{"kind": "shell.run", "command": "make test"}],
                    },
                ]
            },
            {
                "slot": "merge",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {
                        "kind": "notify",
                        "slack_channel_id": "C1",
                        "message": "done {{result_a.ok}}",
                    }
                ],
            },
        ],
    }


def functions_definition() -> dict:
    defn = definition()
    defn["integrations"] = ["functions"]
    defn["agents"][0]["steps"] = [
        {"kind": "agent.prompt", "prompt": "Call the invocation for {{inputs.issue}}"},
        {"kind": "agent.emit", "name": "check", "prompt": "report the result"},
    ]
    return defn


async def seed_ready_account(db: AsyncSession, *, user_id: uuid.UUID, namespace: str) -> None:
    await sync_seed_definitions(db)
    await db.flush()
    defn = await definitions_store.get_seed_by_namespace(db, namespace)
    assert defn is not None
    account = await accounts_store.upsert_account(
        db, user_id=user_id, definition_id=defn.id, auth_kind="api_key", status="ready"
    )
    await accounts_store.set_account_credentials(
        db,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "s"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )


async def create_workflow(db: AsyncSession, user: User, *, name: str = "Fix-it"):
    # The definition declares integrations (["slack"]); save-time + StartRun-time
    # L22 both need a ready slack account for the declared namespace.
    await seed_ready_account(db, user_id=user.id, namespace="slack")
    return await service.create_workflow(
        db, user, WorkflowCreateRequest(name=name, definition=definition())
    )


async def make_ready_cloud_workspace(db: AsyncSession, user: User) -> CloudWorkspace:
    repo_config = RepoConfig(
        user_id=user.id, git_provider="github", git_owner="acme", git_repo_name="widgets"
    )
    db.add(repo_config)
    await db.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id, environment_kind="cloud", local_path=None
    )
    db.add(repo_environment)
    await db.flush()
    workspace = CloudWorkspace(
        owner_user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name="widgets",
        git_branch="feature/x",
        anyharness_workspace_id="ws-cloud",
    )
    db.add(workspace)
    await db.flush()
    return workspace


async def seed_run(
    db: AsyncSession,
    user: User,
    workflow,
    *,
    resolved_plan_json: dict,
    anyharness_workspace_id: str | None = None,
    anyharness_session_ids: list[str] | None = None,
    status: str | None = None,
):
    run = await store.create_run(
        db,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind=WORKFLOW_TRIGGER_MANUAL,
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json=resolved_plan_json,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    if anyharness_session_ids is not None or status is not None:
        await store.update_run(
            db, run_id=run.id, anyharness_session_ids=anyharness_session_ids, status=status
        )
    return run
