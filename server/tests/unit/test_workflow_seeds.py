"""Tests for the code-defined seed workflow registry (track 1f)."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.server.cloud.workflows.seeds import (
    SEED_WORKFLOW_DEFINITIONS,
    sync_seed_workflow_definitions,
)


def test_every_seed_validates_against_the_real_parser() -> None:
    assert len(SEED_WORKFLOW_DEFINITIONS) >= 3
    slugs = {seed.slug for seed in SEED_WORKFLOW_DEFINITIONS}
    assert len(slugs) == len(SEED_WORKFLOW_DEFINITIONS), "seed slugs must be unique"
    for seed in SEED_WORKFLOW_DEFINITIONS:
        canonical, _arg_specs = parse_definition(seed.definition, require_steps=True)
        assert canonical["name"]
        assert canonical["agents"]


@pytest.mark.asyncio
async def test_reconcile_is_idempotent(db_session: AsyncSession) -> None:
    first = await sync_seed_workflow_definitions(db_session)
    await db_session.flush()
    assert len(first) == len(SEED_WORKFLOW_DEFINITIONS)

    second = await sync_seed_workflow_definitions(db_session)
    await db_session.flush()
    assert len(second) == len(SEED_WORKFLOW_DEFINITIONS)

    rows = await store.list_seed_workflows(db_session)
    assert len(rows) == len(SEED_WORKFLOW_DEFINITIONS)
    # Ids are stable across re-runs (no duplicate rows created).
    assert {r.id for r in first} == {r.id for r in second} == {r.id for r in rows}


@pytest.mark.asyncio
async def test_changed_seed_definition_updates_the_existing_row(
    db_session: AsyncSession,
) -> None:
    await sync_seed_workflow_definitions(db_session)
    await db_session.flush()

    before = await store.get_seed_workflow_by_slug(db_session, seed_slug="triage-issue")
    assert before is not None
    before_id = before.id
    before_version_id = before.current_version_id

    changed_definition = dict(SEED_WORKFLOW_DEFINITIONS[0].definition)
    changed_definition["description"] = "A materially different description."
    canonical, _ = parse_definition(changed_definition, require_steps=True)

    await store.upsert_seed_workflow(
        db_session,
        seed_slug="triage-issue",
        name=str(changed_definition["name"]),
        description=str(changed_definition["description"]),
        definition_json=canonical,
    )
    await db_session.flush()

    after = await store.get_seed_workflow_by_slug(db_session, seed_slug="triage-issue")
    assert after is not None
    assert after.id == before_id, "same workflow row, not a new one"
    assert after.description == "A materially different description."
    assert after.current_version_id != before_version_id, "a new immutable version was appended"

    rows = await store.list_seed_workflows(db_session)
    assert len([r for r in rows if r.seed_slug == "triage-issue"]) == 1


@pytest.mark.asyncio
async def test_unchanged_seed_definition_is_a_no_op(db_session: AsyncSession) -> None:
    await sync_seed_workflow_definitions(db_session)
    await db_session.flush()
    before = await store.get_seed_workflow_by_slug(db_session, seed_slug="triage-issue")
    assert before is not None

    await sync_seed_workflow_definitions(db_session)
    await db_session.flush()
    after = await store.get_seed_workflow_by_slug(db_session, seed_slug="triage-issue")
    assert after is not None
    assert after.current_version_id == before.current_version_id


@pytest.mark.asyncio
async def test_seeded_defs_appear_in_the_strip_picker_source_query(
    db_session: AsyncSession,
) -> None:
    import uuid

    from proliferate.db.models.auth import User

    user = User(
        id=uuid.uuid4(),
        email=f"wf-seed-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()

    await sync_seed_workflow_definitions(db_session)
    await db_session.flush()

    # The org/owner-scoped list query is the strip/picker source; seeds must
    # show up in it (annotated via is_seed) even though this user owns none.
    rows = await store.list_workflows(db_session, owner_user_id=user.id)
    seed_rows = [r for r in rows if r.is_seed]
    assert {r.seed_slug for r in seed_rows} == {s.slug for s in SEED_WORKFLOW_DEFINITIONS}

    # Excluding seeds drops them back out.
    rows_no_seeds = await store.list_workflows(
        db_session, owner_user_id=user.id, include_seeds=False
    )
    assert not any(r.is_seed for r in rows_no_seeds)
