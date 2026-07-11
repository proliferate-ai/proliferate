"""Populated pre-WF-ID cutover and generation-domain migration test."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateTable

from alembic import command
from proliferate.db.migrations import build_alembic_config
from proliferate.db.models.cloud.workflow_actions import WorkflowStepAction
from proliferate.db.models.cloud.workflow_gateway_models import WorkflowRunGatewayToken
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import triggers
from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
from tests.postgres import temporary_database

_PRE_WF_ID = "a7e2c4f1b9d0"
_WF_ID = "e5f1a2b3c4d7"


def _normalized_sql(value: object) -> str:
    return " ".join(str(value).split())


def test_orm_metadata_and_create_all_ddl_own_every_identity_writer_fence() -> None:
    expected = {
        WorkflowRun: (
            "ck_workflow_run_identity_writer_fence",
            "identity_schema_version = 1 AND (NOT identity_cutover_parked OR ("
            "status IN ('completed', 'failed', 'cancelled', 'missed') AND "
            "private_envelope_json IS NULL AND "
            "(jsonb_typeof(resolved_plan_json) != 'object' OR "
            "NOT (resolved_plan_json ? 'gateway')) AND "
            "binding_hash IS NULL AND execution_generation IS NULL AND "
            "execution_binding_json IS NULL))",
        ),
        WorkflowStepAction: (
            "ck_workflow_step_action_identity_writer_fence",
            "identity_schema_version = 1 AND (NOT identity_cutover_parked OR ("
            "status = 'failed' AND attempt_count >= 5))",
        ),
        WorkflowRunGatewayToken: (
            "ck_cloud_workflow_run_gateway_token_identity_writer_fence",
            "identity_schema_version = 1 AND (NOT identity_cutover_parked "
            "OR status IN ('expired', 'revoked'))",
        ),
    }
    for model, (name, expression) in expected.items():
        constraints = {
            constraint.name: constraint
            for constraint in model.__table__.constraints
            if isinstance(constraint, CheckConstraint)
        }
        assert name in constraints
        assert _normalized_sql(constraints[name].sqltext) == _normalized_sql(expression)
        create_all_ddl = str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))
        assert f"CONSTRAINT {name} CHECK" in create_all_ddl


@pytest.mark.asyncio
async def test_populated_identity_cutover_revokes_parks_and_uses_exact_worker_domains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with temporary_database("wf_id_populated") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _PRE_WF_ID)
        engine = create_async_engine(database_url, echo=False)
        try:
            user_a, user_b = uuid.uuid4(), uuid.uuid4()
            workflow_id, version_id, run_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            legacy_trigger_id = uuid.uuid4()
            legacy_action_id = uuid.uuid4()
            async with engine.begin() as conn:
                for user_id in (user_a, user_b):
                    await conn.execute(
                        text(
                            'INSERT INTO "user" (id, email, hashed_password, is_active, '
                            "is_superuser, is_verified, created_at) "
                            "VALUES (:id, :email, 'x', true, false, true, now())"
                        ),
                        {"id": user_id, "email": f"wf-id-{user_id}@example.com"},
                    )
                await conn.execute(
                    text(
                        "INSERT INTO workflow (id, owner_user_id, created_by_user_id, name, "
                        "is_seed, created_at, updated_at) "
                        "VALUES (:id, :uid, :uid, 'wf-id', false, now(), now())"
                    ),
                    {"id": workflow_id, "uid": user_a},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_version (id, workflow_id, version_n, "
                        "definition_json, created_by_user_id, created_at) "
                        "VALUES (:id, :wid, 1, CAST(:definition AS jsonb), :uid, now())"
                    ),
                    {
                        "id": version_id,
                        "wid": workflow_id,
                        "uid": user_a,
                        "definition": json.dumps(
                            {
                                "version": 1,
                                "inputs": [],
                                "integrations": [],
                                "agents": [],
                            }
                        ),
                    },
                )
                await conn.execute(
                    text("UPDATE workflow SET current_version_id = :vid WHERE id = :wid"),
                    {"vid": version_id, "wid": workflow_id},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_trigger ("
                        "id, workflow_id, kind, enabled, concurrency_policy, "
                        "missed_run_policy, target_mode, repo_full_name, "
                        "target_workspace_id, input_presets_json, schedule_rrule, "
                        "schedule_timezone, schedule_summary, next_run_at, args_json, "
                        "created_by_user_id, created_at, updated_at) VALUES ("
                        ":id, :wid, 'schedule', true, 'skip', 'run_latest', 'local', "
                        "'acme/widgets', NULL, '{}', 'RRULE:FREQ=HOURLY;INTERVAL=1', "
                        "'UTC', 'Hourly', now() + interval '1 hour', '{}', :uid, now(), now())"
                    ),
                    {"id": legacy_trigger_id, "wid": workflow_id, "uid": user_a},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_run (id, workflow_id, workflow_version_id, "
                        "trigger_kind, executor_user_id, args_json, target_mode, "
                        "resolved_plan_json, status, plan_hash, binding_hash, "
                        "execution_generation, execution_binding_json, private_envelope_json, "
                        "desired_state, delivery_state, preaccept_cancel_state, "
                        "created_at, updated_at) VALUES ("
                        ":id, :wid, :vid, 'manual', :uid, '{}', 'personal_cloud', "
                        "CAST(:plan AS jsonb), "
                        "'running', :plan_hash, :binding_hash, 7, "
                        "CAST(:binding AS jsonb), CAST(:envelope AS jsonb), "
                        "'running', 'delivered', 'none', now(), now())"
                    ),
                    {
                        "id": run_id,
                        "wid": workflow_id,
                        "vid": version_id,
                        "uid": user_a,
                        "plan_hash": f"sha256:{'a' * 64}",
                        "binding_hash": f"sha256:{'b' * 64}",
                        "binding": json.dumps({"legacy": True}),
                        "plan": json.dumps(
                            {
                                "steps": [],
                                "renamed": {"nested": {"opaque": "Bearer embedded-plaintext"}},
                            }
                        ),
                        "envelope": json.dumps({"gateway": {"authorization": "Bearer plaintext"}}),
                    },
                )
                await conn.execute(
                    text(
                        "INSERT INTO cloud_workflow_run_gateway_token ("
                        "id, workflow_run_id, owner_user_id, token_hash, scope_json, status, "
                        "expires_at, created_at, updated_at) VALUES ("
                        ":id, :run_id, :uid, :token_hash, '[]', 'active', "
                        "now() + interval '1 hour', now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "run_id": run_id,
                        "uid": user_a,
                        "token_hash": "c" * 64,
                    },
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_step_action ("
                        "id, run_id, step_key, action_kind, status, attempt_count, "
                        "created_at, updated_at) VALUES ("
                        ":id, :run_id, '0.-.0', 'slack_notify', 'pending', 0, "
                        "now() - interval '10 minutes', now() - interval '10 minutes')"
                    ),
                    {"id": legacy_action_id, "run_id": run_id},
                )
                for index, owner in enumerate((user_a, user_b), start=1):
                    await conn.execute(
                        text(
                            "INSERT INTO cloud_runtime_worker ("
                            "id, owner_user_id, runtime_kind, desktop_install_id, token_hash, "
                            "status, enrolled_at, created_at, updated_at) VALUES ("
                            ":id, :owner, 'desktop', 'same-install', :token, 'revoked', "
                            ":enrolled, :enrolled, :enrolled)"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "owner": owner,
                            "token": f"{index}" * 64,
                            "enrolled": datetime(2026, 7, index, tzinfo=UTC),
                        },
                    )

            monkeypatch.delenv("PROLIFERATE_WF_ID_LEGACY_DRAIN_ACK", raising=False)
            with pytest.raises(RuntimeError, match="populated migration blocked"):
                await asyncio.to_thread(command.upgrade, config, _WF_ID)
            monkeypatch.setenv(
                "PROLIFERATE_WF_ID_LEGACY_DRAIN_ACK",
                "actors-and-process-groups-verified-zero",
            )
            await asyncio.to_thread(command.upgrade, config, _WF_ID)
            async with engine.connect() as conn:
                generations = list(
                    (
                        await conn.scalars(
                            text(
                                "SELECT generation FROM cloud_runtime_worker "
                                "WHERE desktop_install_id = 'same-install' ORDER BY enrolled_at"
                            )
                        )
                    ).all()
                )
                assert generations == [1, 2]
                run = (
                    await conn.execute(
                        text(
                            "SELECT status, delivery_state, error_code, private_envelope_json, "
                            "resolved_plan_json, "
                            "binding_hash, execution_generation, execution_binding_json "
                            "FROM workflow_run WHERE id = :id"
                        ),
                        {"id": run_id},
                    )
                ).one()
                assert run.status == "failed"
                assert run.delivery_state == "terminal_delivery_failure"
                assert run.error_code == "workflow_identity_upgrade_required"
                assert run.private_envelope_json is None
                assert run.resolved_plan_json == {}
                binding_identity = (
                    run.binding_hash,
                    run.execution_generation,
                    run.execution_binding_json,
                )
                assert binding_identity == (
                    None,
                    None,
                    None,
                )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text(
                                "INSERT INTO workflow_run ("
                                "id, workflow_id, workflow_version_id, trigger_kind, "
                                "executor_user_id, args_json, target_mode, resolved_plan_json, "
                                "status, created_at, updated_at) VALUES ("
                                ":id, :wid, :vid, 'manual', :uid, '{}', 'local', '{}', "
                                "'running', now(), now())"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "wid": workflow_id,
                                "vid": version_id,
                                "uid": user_a,
                            },
                        )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text("UPDATE workflow_run SET status = 'running' WHERE id = :id"),
                            {"id": run_id},
                        )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text(
                                "INSERT INTO cloud_workflow_run_gateway_token ("
                                "id, workflow_run_id, owner_user_id, token_hash, scope_json, "
                                "status, expires_at, created_at, updated_at) VALUES ("
                                ":id, :run_id, :uid, :token_hash, '{}', 'expired', "
                                "now(), now(), now())"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "run_id": run_id,
                                "uid": user_a,
                                "token_hash": "d" * 64,
                            },
                        )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text(
                                "UPDATE cloud_workflow_run_gateway_token "
                                "SET status = 'active' WHERE workflow_run_id = :id"
                            ),
                            {"id": run_id},
                        )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text(
                                "INSERT INTO workflow_step_action ("
                                "id, run_id, step_key, action_kind, status, attempt_count, "
                                "created_at, updated_at) VALUES ("
                                ":id, :run_id, 'old-writer', 'slack_notify', 'pending', 0, "
                                "now(), now())"
                            ),
                            {"id": uuid.uuid4(), "run_id": run_id},
                        )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text("UPDATE workflow_step_action SET status = 'done' WHERE id = :id"),
                            {"id": legacy_action_id},
                        )
                assert (
                    await conn.scalar(
                        text("SELECT status FROM workflow_run WHERE id = :id"),
                        {"id": run_id},
                    )
                    == "failed"
                )
                token_status = await conn.scalar(
                    text(
                        "SELECT status FROM cloud_workflow_run_gateway_token "
                        "WHERE workflow_run_id = :id"
                    ),
                    {"id": run_id},
                )
                assert token_status == "expired"
                legacy_action = (
                    await conn.execute(
                        text(
                            "SELECT status, attempt_count, error_message "
                            "FROM workflow_step_action WHERE id = :id"
                        ),
                        {"id": legacy_action_id},
                    )
                ).one()
                assert legacy_action.status == "failed"
                assert legacy_action.attempt_count >= 5
                assert legacy_action.error_message == (
                    "Parked during deterministic-action cutover."
                )
                legacy_trigger = (
                    await conn.execute(
                        text(
                            "SELECT enabled, local_workspace_id FROM workflow_trigger "
                            "WHERE id = :id"
                        ),
                        {"id": legacy_trigger_id},
                    )
                ).one()
                assert legacy_trigger.enabled is False
                assert legacy_trigger.local_workspace_id is None
                constraints = set(
                    (
                        await conn.scalars(
                            text(
                                "SELECT conname FROM pg_constraint WHERE conname IN ("
                                "'ck_workflow_run_binding_identity_complete', "
                                "'ck_workflow_run_identity_writer_fence', "
                                "'ck_cloud_workflow_run_gateway_token_identity_writer_fence', "
                                "'ck_workflow_step_action_identity_writer_fence', "
                                "'ck_workflow_materialization_offer_credential_digest', "
                                "'ck_workflow_materialization_offer_state')"
                            )
                        )
                    ).all()
                )
                assert constraints == {
                    "ck_workflow_run_binding_identity_complete",
                    "ck_workflow_run_identity_writer_fence",
                    "ck_cloud_workflow_run_gateway_token_identity_writer_fence",
                    "ck_workflow_step_action_identity_writer_fence",
                    "ck_workflow_materialization_offer_credential_digest",
                    "ck_workflow_materialization_offer_state",
                }

            factory = async_sessionmaker(engine, expire_on_commit=False)
            async with factory() as db:
                actor = SimpleNamespace(id=user_a)
                with pytest.raises(CloudApiError) as caught:
                    await triggers.update_trigger(
                        db,
                        actor,
                        workflow_id,
                        legacy_trigger_id,
                        WorkflowTriggerUpdateRequest.model_validate({"enabled": True}),
                    )
                assert caught.value.code == "local_workspace_required"
                await db.rollback()

                repinned = uuid.uuid4()
                updated = await triggers.update_trigger(
                    db,
                    actor,
                    workflow_id,
                    legacy_trigger_id,
                    WorkflowTriggerUpdateRequest.model_validate(
                        {"enabled": True, "localWorkspaceId": str(repinned)}
                    ),
                )
                assert updated.enabled is True
                assert updated.local_workspace_id == repinned
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_fresh_cutover_new_orm_and_core_writers_stamp_fences_while_old_writers_fail() -> (
    None
):
    """Exercise actual PostgreSQL defaults at the post-migration writer boundary."""

    async with temporary_database("wf_id_fresh_writers") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _WF_ID)
        engine = create_async_engine(database_url, echo=False)
        try:
            user_id = uuid.uuid4()
            workflow_id = uuid.uuid4()
            version_id = uuid.uuid4()
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        'INSERT INTO "user" (id, email, hashed_password, is_active, '
                        "is_superuser, is_verified, created_at) "
                        "VALUES (:id, :email, 'x', true, false, true, now())"
                    ),
                    {"id": user_id, "email": f"wf-id-fresh-{user_id}@example.com"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow (id, owner_user_id, created_by_user_id, name, "
                        "is_seed, created_at, updated_at) "
                        "VALUES (:id, :uid, :uid, 'wf-id-fresh', false, now(), now())"
                    ),
                    {"id": workflow_id, "uid": user_id},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_version (id, workflow_id, version_n, "
                        "definition_json, created_by_user_id, created_at) "
                        "VALUES (:id, :wid, 1, '{}', :uid, now())"
                    ),
                    {
                        "id": version_id,
                        "wid": workflow_id,
                        "uid": user_id,
                    },
                )

            run_id = uuid.uuid4()
            action_id = uuid.uuid4()
            factory = async_sessionmaker(engine, expire_on_commit=False)
            async with factory() as db:
                run = WorkflowRun(
                    id=run_id,
                    workflow_id=workflow_id,
                    workflow_version_id=version_id,
                    trigger_kind="manual",
                    trigger_id=None,
                    scheduled_for=None,
                    executor_user_id=user_id,
                    args_json={},
                    target_mode="local",
                    resolved_plan_json={},
                    status="pending_delivery",
                    step_cursor=None,
                )
                db.add(run)
                await db.flush()
                assert run.identity_schema_version == 1
                assert run.identity_cutover_parked is False

                await db.execute(
                    pg_insert(WorkflowStepAction).values(
                        id=action_id,
                        run_id=run_id,
                        step_key="0.-.0",
                        action_kind="slack_notify",
                    )
                )
                await db.flush()
                action = await db.get(WorkflowStepAction, action_id)
                assert action is not None
                assert action.identity_schema_version == 1
                assert action.identity_cutover_parked is False
                await db.commit()

            async with engine.connect() as conn:
                run_fence = (
                    await conn.execute(
                        text(
                            "SELECT identity_schema_version, identity_cutover_parked "
                            "FROM workflow_run WHERE id = :id"
                        ),
                        {"id": run_id},
                    )
                ).one()
                assert tuple(run_fence) == (1, False)
                action_fence = (
                    await conn.execute(
                        text(
                            "SELECT identity_schema_version, identity_cutover_parked, "
                            "status, attempt_count FROM workflow_step_action WHERE id = :id"
                        ),
                        {"id": action_id},
                    )
                ).one()
                assert tuple(action_fence) == (1, False, "pending", 0)

                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text(
                                "INSERT INTO workflow_run ("
                                "id, workflow_id, workflow_version_id, trigger_kind, "
                                "executor_user_id, args_json, target_mode, resolved_plan_json, "
                                "status, created_at, updated_at) VALUES ("
                                ":id, :wid, :vid, 'manual', :uid, '{}', 'local', '{}', "
                                "'pending_delivery', now(), now())"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "wid": workflow_id,
                                "vid": version_id,
                                "uid": user_id,
                            },
                        )
                with pytest.raises(DBAPIError):
                    async with conn.begin_nested():
                        await conn.execute(
                            text(
                                "INSERT INTO workflow_step_action ("
                                "id, run_id, step_key, action_kind, status, attempt_count, "
                                "created_at, updated_at) VALUES ("
                                ":id, :run_id, 'old-writer', 'slack_notify', 'pending', 0, "
                                "now(), now())"
                            ),
                            {"id": uuid.uuid4(), "run_id": run_id},
                        )
        finally:
            await engine.dispose()
