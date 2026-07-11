"""Shared row/definition factories for the WS3a capability tests
(``test_workflow_capabilities.py`` + ``test_workflow_capability_revisions.py``)."""

from __future__ import annotations

import json
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_TARGET_MODE_LOCAL
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations import tool_cache as tool_cache_store
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.utils.crypto import encrypt_json


async def make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"cap-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def seed_invocation(db: AsyncSession, *, owner: User, name: str):
    return await invocations_store.create(
        db,
        owner_user_id=owner.id,
        organization_id=None,
        created_by_user_id=owner.id,
        name=name,
        endpoint_url="https://example.com/hook",
        method="post",
        args_schema_json={"type": "object"},
        headers={"authorization": "Bearer secret-1"},
    )


def definition(*, integrations: list[str], agents: list[dict] | None = None) -> dict:
    return {
        "version": 1,
        "inputs": [],
        "integrations": integrations,
        "agents": agents
        or [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
            }
        ],
    }


async def store_workflow(db: AsyncSession, owner: User, definition_json: dict, *, name: str):
    canonical, _specs = parse_definition(definition_json, require_steps=False)
    workflow, _version = await store.create_workflow_with_version(
        db,
        owner_user_id=owner.id,
        created_by_user_id=owner.id,
        name=name,
        description=None,
        definition_json=canonical,
    )
    return workflow


async def start_run(db: AsyncSession, user: User, workflow_id: uuid.UUID):
    return await compiler.start_run(
        db, user, workflow_id, inputs={}, target_mode=WORKFLOW_TARGET_MODE_LOCAL
    )


async def seed_ready_account(db: AsyncSession, *, user_id: uuid.UUID, namespace: str):
    await sync_seed_definitions(db)
    await db.flush()
    seed_definition = await definitions_store.get_seed_by_namespace(db, namespace)
    assert seed_definition is not None
    account = await accounts_store.upsert_account(
        db, user_id=user_id, definition_id=seed_definition.id, auth_kind="api_key", status="ready"
    )
    await accounts_store.set_account_credentials(
        db,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "s"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    return account, seed_definition


async def warm_tool_cache(db: AsyncSession, *, account_id: uuid.UUID, tools: list[dict]) -> None:
    await tool_cache_store.upsert_tool_cache(
        db,
        account_id=account_id,
        auth_version=1,
        tools_json=json.dumps(tools, separators=(",", ":")),
        content_hash=None,
        status="ready",
        fetched_at=None,
        error_code=None,
    )
