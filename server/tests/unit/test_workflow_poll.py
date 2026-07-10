"""Poll-trigger poller, store, and validation tests (PR B, spec 4.2/4.3).

Covers: seen-set CAS dedup, invalid items recorded + never spawned, item-input
overlay (static presets ⊕ item.data by name, D17), required-field-miss => invalid
(via the derived schema), start_run failure => savepoint rollback + status 'error'
+ cursor still advances, cursor persists with items in one transaction, HTTP error
=> last_poll_error set + trigger stays enabled, due-claim respects interval, and
poll-trigger validation (incl. the init-time inputs-signature probe).
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import WORKFLOW_TRIGGER_KIND_POLL
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.workflows import (
    Workflow,
    WorkflowRun,
    WorkflowTrigger,
    WorkflowTriggerItem,
    WorkflowVersion,
)
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import poller as poller_module
from proliferate.server.cloud.workflows.domain.poll_contract import (
    PollItem,
    PollPage,
    derive_item_schema,
)
from proliferate.server.cloud.workflows.poller import (
    _poll_one_trigger,
    overlay_item_inputs,
    run_poll_pass,
)
from proliferate.utils.time import utcnow


class _Actor:
    """Minimal owner identity — the owner-scoped services only read ``.id``."""

    def __init__(self, actor_id: uuid.UUID) -> None:
        self.id = actor_id


_DEF = {
    "version": 1,
    "inputs": [
        {"name": "n", "type": "number", "required": True},
        {"name": "title", "type": "text", "required": True},
    ],
    "agents": [
        {
            "slot": "main",
            "harness": "claude",
            "model": "sonnet",
            "steps": [{"kind": "agent.prompt", "prompt": "item {{inputs.title}}"}],
        }
    ],
}

# The item schema the service derives for _DEF's inputs (both required, no static
# presets). The poller both validates each item against it and reads its
# ``properties`` keys as the set of fields to overlay from ``item.data`` by name.
_ITEM_SCHEMA = {
    "type": "object",
    "properties": {"n": {"type": "number"}, "title": {"type": "string"}},
    "required": ["n", "title"],
}


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-poll-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_workflow(
    db: AsyncSession, user: User, *, definition: dict | None = None
) -> Workflow:
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="poll-wf",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(wf)
    await db.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json=definition or _DEF,
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db.add(ver)
    await db.flush()
    wf.current_version_id = ver.id
    await db.flush()
    return wf


async def _make_poll_trigger(
    db: AsyncSession,
    wf: Workflow,
    user: User,
    *,
    interval_secs: int = 60,
    item_schema: dict | None = None,
    last_poll_at=None,
    cursor: str | None = None,
) -> WorkflowTrigger:
    trigger = WorkflowTrigger(
        id=uuid.uuid4(),
        workflow_id=wf.id,
        kind=WORKFLOW_TRIGGER_KIND_POLL,
        enabled=True,
        # local target keeps start_run from resolving a cloud workspace; the poller
        # logic is target-agnostic (cloud-only is a service-layer create/update rule).
        concurrency_policy="queue",
        target_mode="local",
        # D16: poll triggers pin a repo (ck_workflow_trigger_repo_full_name); the
        # poller-lane logic under test is target-agnostic.
        repo_full_name="acme/widgets",
        target_workspace_id=None,
        poll_url="http://127.0.0.1:9911/poll",
        poll_interval_secs=interval_secs,
        poll_item_schema_json=item_schema if item_schema is not None else _ITEM_SCHEMA,
        poll_cursor=cursor,
        last_poll_at=last_poll_at,
        args_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(trigger)
    await db.flush()
    return trigger


def _page(items: list[dict], *, cursor: str = "c1", has_more: bool = False) -> PollPage:
    return PollPage(
        items=[PollItem.model_validate(i) for i in items],
        cursor=cursor,
        has_more=has_more,
    )


def _item(item_id: str, **data: object) -> dict:
    return {
        "id": item_id,
        "kind": "test.item",
        "occurred_at": "2026-07-07T00:00:00Z",
        "data": data,
    }


# --- overlay_item_inputs + derive_item_schema (pure, D17) -----------------------


def test_overlay_item_inputs_static_overlaid_by_name() -> None:
    # Declared inputs (schema properties) are n + title. The item's own n + title
    # override the static presets; the preset-only "n" default is replaced, "extra"
    # is not a declared input so it survives untouched.
    inputs = overlay_item_inputs(
        {"n": 7, "title": "boom", "ignored": "x"},
        static_inputs={"n": 0, "extra": "keep"},
        item_schema=_ITEM_SCHEMA,
    )
    assert inputs == {"n": 7, "title": "boom", "extra": "keep"}


def test_overlay_item_inputs_ignores_undeclared_and_missing() -> None:
    # Only declared names present in data are pulled; undeclared "ignored" is
    # dropped, and a declared field absent from data keeps its static preset.
    inputs = overlay_item_inputs(
        {"title": "only-title", "ignored": 1},
        static_inputs={"n": 3},
        item_schema=_ITEM_SCHEMA,
    )
    assert inputs == {"n": 3, "title": "only-title"}


def test_derive_item_schema_projects_inputs() -> None:
    from proliferate.server.cloud.workflows.domain.interpolation import ArgSpec

    specs = [
        ArgSpec("n", "number", required=True, has_default=False, default=None, enum_values=()),
        ArgSpec("title", "text", required=True, has_default=False, default=None, enum_values=()),
        ArgSpec(
            "sev",
            "choice",
            required=True,
            has_default=False,
            default=None,
            enum_values=("low", "high"),
        ),
        ArgSpec(
            "flag", "boolean", required=False, has_default=False, default=None, enum_values=()
        ),
    ]
    schema = derive_item_schema(specs)
    assert schema == {
        "type": "object",
        "properties": {
            "n": {"type": "number"},
            "title": {"type": "string"},
            "sev": {"type": "string", "enum": ["low", "high"]},
            "flag": {"type": "boolean"},
        },
        "required": ["n", "title", "sev"],
    }


def test_derive_item_schema_omits_covered_from_required() -> None:
    from proliferate.server.cloud.workflows.domain.interpolation import ArgSpec

    specs = [
        ArgSpec("n", "number", required=True, has_default=False, default=None, enum_values=()),
        ArgSpec("title", "text", required=True, has_default=False, default=None, enum_values=()),
    ]
    # "n" is supplied as a static preset, so it need not appear per-item.
    schema = derive_item_schema(specs, covered_names={"n"})
    assert schema["required"] == ["title"]


# --- session factory helper -----------------------------------------------------


def _factory(test_engine) -> async_sessionmaker:  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


def _mock_client_factory(transport: httpx.MockTransport):  # type: ignore[no-untyped-def]
    """Return a drop-in for ``httpx.AsyncClient`` that routes through ``transport``
    while preserving the kwargs ``fetch_poll_page`` sets (timeout, follow_redirects).
    Captures the REAL client class before the patch is installed."""

    real_client = httpx.AsyncClient

    def factory(**kwargs):  # type: ignore[no-untyped-def]
        kwargs.setdefault("transport", transport)
        return real_client(**kwargs)

    return factory


async def _run_poller_with_page(session_factory, trigger_id, page: PollPage, *, now=None) -> int:
    now = now or utcnow()
    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=page)):
        return await _poll_one_trigger(session_factory, trigger_id=trigger_id, now=now)


# --- happy path + cursor persist in one transaction -----------------------------


async def test_poll_spawns_runs_and_persists_cursor(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    page = _page(
        [_item("it_0", n=0, title="zero"), _item("it_1", n=1, title="one")], cursor="cur1"
    )
    spawned = await _run_poller_with_page(factory, trigger_id, page)
    assert spawned == 2

    async with factory() as db:
        items = (
            (
                await db.execute(
                    select(WorkflowTriggerItem).where(WorkflowTriggerItem.trigger_id == trigger_id)
                )
            )
            .scalars()
            .all()
        )
        assert {i.item_id: i.status for i in items} == {"it_0": "spawned", "it_1": "spawned"}
        assert all(i.run_id is not None for i in items)
        runs = (
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )
        assert len(runs) == 2
        assert all(r.trigger_kind == WORKFLOW_TRIGGER_KIND_POLL for r in runs)
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed.poll_cursor == "cur1"
        assert refreshed.last_poll_at is not None
        assert refreshed.last_poll_error is None


# --- seen-set CAS dedup: same item across polls => one spawn --------------------


async def test_seen_set_dedups_replayed_item(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    now1 = utcnow()
    page = _page([_item("dup_1", n=1, title="a")], cursor="c1")
    first = await _run_poller_with_page(factory, trigger_id, page, now=now1)
    # Second poll (past the interval so it's due again) replays the same id — the
    # at-least-once contract permits this.
    now2 = now1 + timedelta(seconds=120)
    page2 = _page([_item("dup_1", n=1, title="a"), _item("dup_2", n=2, title="b")], cursor="c2")
    second = await _run_poller_with_page(factory, trigger_id, page2, now=now2)

    assert first == 1
    assert second == 1  # only dup_2 is new; dup_1 is deduped by the PK

    async with factory() as db:
        runs = (
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )
        assert len(runs) == 2  # dup_1 spawned exactly once despite the replay


# --- invalid item recorded + never spawned --------------------------------------


async def test_invalid_item_recorded_not_spawned(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    schema = {
        "required": ["n", "title"],
        "properties": {"n": {"type": "number"}, "title": {"type": "string"}},
    }
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user, item_schema=schema)
        trigger_id = trigger.id
        await db.commit()

    # it_bad: n missing + title wrong type -> schema-invalid on purpose.
    page = _page([_item("it_ok", n=1, title="ok"), _item("it_bad", title=42)])
    spawned = await _run_poller_with_page(factory, trigger_id, page)
    assert spawned == 1

    async with factory() as db:
        items = {
            i.item_id: i
            for i in (
                await db.execute(
                    select(WorkflowTriggerItem).where(WorkflowTriggerItem.trigger_id == trigger_id)
                )
            )
            .scalars()
            .all()
        }
        assert items["it_ok"].status == "spawned"
        assert items["it_bad"].status == "invalid"
        assert items["it_bad"].error_message
        assert items["it_bad"].run_id is None
        runs = (
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )
        assert len(runs) == 1


# --- required-field miss => invalid (via the derived schema) --------------------


async def test_required_field_miss_marks_invalid(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        # Derived schema requires n + title; the item omits the required "n".
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    page = _page([_item("miss_1", title="only-title")])  # data has no "n"
    spawned = await _run_poller_with_page(factory, trigger_id, page)
    assert spawned == 0

    async with factory() as db:
        item = await db.get(WorkflowTriggerItem, (trigger_id, "miss_1"))
        assert item.status == "invalid"
        assert "n" in (item.error_message or "")


# --- start_run failure => savepoint rollback + status 'error' + cursor advances -


async def test_start_run_failure_records_error_and_advances_cursor(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    page = _page([_item("boom_1", n=1, title="a")], cursor="after-error")
    now = utcnow()
    with (
        patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=page)),
        patch.object(
            poller_module.service,
            "start_run",
            new=AsyncMock(
                side_effect=CloudApiError("target_workspace_not_ready", "nope", status_code=409)
            ),
        ),
    ):
        spawned = await _poll_one_trigger(factory, trigger_id=trigger_id, now=now)
    assert spawned == 0

    async with factory() as db:
        item = await db.get(WorkflowTriggerItem, (trigger_id, "boom_1"))
        assert item.status == "error"
        assert "target_workspace_not_ready" in (item.error_message or "")
        assert item.run_id is None
        # No run row survived (savepoint rolled back just the run insert).
        runs = (
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )
        assert runs == []
        # Cursor still advanced past this poll.
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed.poll_cursor == "after-error"
        assert refreshed.last_poll_at is not None


# --- HTTP error => last_poll_error set + trigger stays enabled + cursor kept -----


async def test_http_error_sets_last_poll_error_keeps_enabled(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user, cursor="keep-me")
        trigger_id = trigger.id
        await db.commit()

    error = httpx.HTTPStatusError(
        "500",
        request=httpx.Request("GET", "http://x/poll"),
        response=httpx.Response(500, request=httpx.Request("GET", "http://x/poll")),
    )
    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(side_effect=error)):
        spawned = await _poll_one_trigger(factory, trigger_id=trigger_id, now=utcnow())
    assert spawned == 0

    async with factory() as db:
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed.enabled is True
        assert refreshed.last_poll_error is not None
        assert "500" in refreshed.last_poll_error
        assert refreshed.poll_cursor == "keep-me"  # cursor NOT advanced on error
        assert refreshed.last_poll_at is not None
        # No items or runs recorded from a failed poll.
        items = (
            (
                await db.execute(
                    select(WorkflowTriggerItem).where(WorkflowTriggerItem.trigger_id == trigger_id)
                )
            )
            .scalars()
            .all()
        )
        assert items == []


# --- due-claim respects interval ------------------------------------------------


async def test_due_claim_respects_interval(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    now = utcnow()
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        # Just polled 10s ago, interval 60s -> not due.
        not_due = await _make_poll_trigger(
            db, wf, user, interval_secs=60, last_poll_at=now - timedelta(seconds=10)
        )
        # Never polled -> due.
        never = await _make_poll_trigger(db, wf, user, interval_secs=60, last_poll_at=None)
        # Polled 120s ago, interval 60s -> due.
        overdue = await _make_poll_trigger(
            db, wf, user, interval_secs=60, last_poll_at=now - timedelta(seconds=120)
        )
        not_due_id, never_id, overdue_id = not_due.id, never.id, overdue.id
        await db.commit()

    async with factory() as db:
        due_ids = await trigger_store.list_due_poll_trigger_ids(db, now=now, limit=100)
    assert never_id in due_ids
    assert overdue_id in due_ids
    assert not_due_id not in due_ids

    async with factory() as db, db.begin():
        claimed = await trigger_store.claim_due_poll_trigger(db, trigger_id=not_due_id, now=now)
        assert claimed is None
    async with factory() as db, db.begin():
        claimed = await trigger_store.claim_due_poll_trigger(db, trigger_id=never_id, now=now)
        assert claimed is not None


# --- run_poll_pass drains due triggers ------------------------------------------


async def test_run_poll_pass_polls_due_triggers(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    page = _page([_item("pass_1", n=1, title="x")])
    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=page)):
        spawned = await run_poll_pass(factory, now=utcnow(), batch_size=100)
    assert spawned == 1

    async with factory() as db:
        item = await db.get(WorkflowTriggerItem, (trigger_id, "pass_1"))
        assert item.status == "spawned"


# --- poll trigger validation (service layer) ------------------------------------


async def _service_create(db, user, wf_id, body):  # type: ignore[no-untyped-def]
    from proliferate.server.cloud.workflows.service import create_trigger

    return await create_trigger(db, user, wf_id, body)


def _poll_body(**overrides):  # type: ignore[no-untyped-def]
    from proliferate.server.cloud.workflows.models import (
        TriggerPollRequest,
        WorkflowTriggerCreateRequest,
    )

    poll_kwargs = {
        "url": "https://issues.example/poll",
        "intervalSecs": 60,
    }
    poll_kwargs.update(overrides.pop("poll", {}))
    defaults = {
        "kind": "poll",
        "concurrencyPolicy": "queue",
        "targetMode": "personal_cloud",
        # D16: repo pin is authored; the workspace is derived server-side.
        "repoFullName": "acme/widgets",
        "poll": TriggerPollRequest.model_validate(poll_kwargs),
        "args": {},
    }
    defaults.update(overrides)
    return WorkflowTriggerCreateRequest.model_validate(defaults)


async def test_poll_trigger_rejects_local_target(test_engine) -> None:  # type: ignore[no-untyped-def]

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await db.commit()
        actor = _Actor(user.id)
        with pytest.raises(CloudApiError) as exc:
            await _service_create(db, actor, wf.id, _poll_body(targetMode="local"))
    assert exc.value.code == "poll_local_unsupported"


def test_poll_config_rejects_bad_interval() -> None:
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import _validate_poll_config

    with pytest.raises(CloudApiError) as exc:
        _validate_poll_config(
            TriggerPollRequest.model_validate(
                {"url": "https://issues.example/poll", "intervalSecs": 5}
            ),
            is_update=False,
        )
    assert exc.value.code == "invalid_poll_interval"


def test_poll_config_rejects_non_http_url() -> None:
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import _validate_poll_config

    with pytest.raises(CloudApiError) as exc:
        _validate_poll_config(
            TriggerPollRequest.model_validate({"url": "ftp://nope", "intervalSecs": 60}),
            is_update=False,
        )
    assert exc.value.code == "invalid_poll_config"


class _WS:
    archived_at = None
    anyharness_workspace_id = "ah_1"


async def test_poll_trigger_signature_mismatch_rejected(test_engine) -> None:  # type: ignore[no-untyped-def]
    """The init-time probe GETs the endpoint once and rejects a create whose items'
    ``data`` does not match the workflow's declared inputs (D17, contract §2.2)."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        # D16: a cloud repo env for the pin so derivation reaches the probe.
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        # item omits required "n" and gives "title" the wrong type -> mismatch.
        bad_page = _page([_item("probe_bad", title=42)])
        with (
            patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=bad_page)),
            pytest.raises(CloudApiError) as exc,
        ):
            await _service_create(db, actor, wf.id, _poll_body())
    assert exc.value.code == "poll_signature_mismatch"


async def _make_ready_cloud_workspace(db: AsyncSession, user: User):  # type: ignore[no-untyped-def]
    from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
    from proliferate.db.models.cloud.workspaces import CloudWorkspace

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
        anyharness_workspace_id="sandbox-ws-1",
    )
    db.add(workspace)
    await db.flush()
    return workspace


async def test_poll_trigger_created_when_signature_matches(test_engine) -> None:  # type: ignore[no-untyped-def]
    """A conforming endpoint passes the probe; the stored item schema is DERIVED
    from the inputs (no authoring surface)."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        workspace = await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        good_page = _page([_item("probe_ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            record = await _service_create(db, actor, wf.id, _poll_body())
    assert record.kind == WORKFLOW_TRIGGER_KIND_POLL
    # The workspace is derived from the repo pin (reuses the repo's warm workspace).
    assert record.target_workspace_id == workspace.id
    assert record.poll_item_schema_json == _ITEM_SCHEMA


async def test_poll_trigger_missing_url_rejected() -> None:
    """A poll create with no poll block is rejected before touching the DB."""
    import pydantic

    from proliferate.server.cloud.workflows.models import TriggerPollRequest

    with pytest.raises(pydantic.ValidationError):
        TriggerPollRequest.model_validate({"intervalSecs": 60})  # url is required


def test_poll_config_encrypts_auth_value() -> None:
    """The header VALUE is encrypted at write and round-trips; the plaintext is
    never present in the ciphertext."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import _validate_poll_config
    from proliferate.utils.crypto import decrypt_text

    config = _validate_poll_config(
        TriggerPollRequest.model_validate(
            {
                "url": "https://issues.example/poll",
                "intervalSecs": 60,
                "authHeader": "Authorization",
                "authValue": "Bearer sekret",
            }
        ),
        is_update=False,
    )
    assert config.auth_ciphertext is not None
    assert "sekret" not in config.auth_ciphertext
    assert decrypt_text(config.auth_ciphertext) == "Bearer sekret"


# --- reserved /init path + field-by-field diff (1d, mental-model §5) ------------


def test_init_probe_url_derivation() -> None:
    from proliferate.server.cloud.workflows.domain.poll_contract import init_probe_url

    assert init_probe_url("https://issues.example/poll") == "https://issues.example/poll/init"
    # A trailing slash on the feed URL must not double up.
    assert init_probe_url("https://issues.example/poll/") == "https://issues.example/poll/init"


def test_init_probe_url_drops_fragment_and_appends_to_path() -> None:
    """Finding 1: /init is appended to the PATH via urlsplit/urlunsplit and any
    fragment is dropped — a naive concat would bury /init inside the fragment
    (never sent on the wire), so the "probe" would silently GET the real feed."""
    from proliferate.server.cloud.workflows.domain.poll_contract import init_probe_url

    # A fragment is dropped entirely; /init lands on the path.
    assert init_probe_url("https://issues.example/poll#frag") == "https://issues.example/poll/init"
    assert (
        init_probe_url("https://issues.example/poll/#/app/section")
        == "https://issues.example/poll/init"
    )
    # An existing query string is preserved; /init still lands on the path.
    assert (
        init_probe_url("https://issues.example/poll?team=core")
        == "https://issues.example/poll/init?team=core"
    )


def test_poll_config_rejects_fragment_url() -> None:
    """Finding 1: a poll url carrying a fragment is rejected at save so the stored
    feed URL is always wire-faithful."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import _validate_poll_config

    with pytest.raises(CloudApiError) as exc:
        _validate_poll_config(
            TriggerPollRequest.model_validate(
                {"url": "https://issues.example/poll#/init", "intervalSecs": 60}
            ),
            is_update=False,
        )
    assert exc.value.code == "invalid_poll_config"
    assert "fragment" in exc.value.message


def test_poll_config_rejects_userinfo_url() -> None:
    """Finding 1: a poll url embedding credentials (user:pass@host) is rejected."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import _validate_poll_config

    with pytest.raises(CloudApiError) as exc:
        _validate_poll_config(
            TriggerPollRequest.model_validate(
                {"url": "https://user:pass@issues.example/poll", "intervalSecs": 60}
            ),
            is_update=False,
        )
    assert exc.value.code == "invalid_poll_config"


def test_diff_item_against_schema_lists_every_field() -> None:
    from proliferate.server.cloud.workflows.domain.poll_contract import (
        diff_item_against_schema,
    )

    # "n" missing (required) + "title" wrong type -> BOTH surfaced, not just the first.
    mismatches = diff_item_against_schema({"title": 42}, _ITEM_SCHEMA)
    assert len(mismatches) == 2
    joined = "; ".join(mismatches)
    assert "'n'" in joined
    assert "title" in joined
    # A conforming item yields no mismatches.
    assert diff_item_against_schema({"n": 1, "title": "ok"}, _ITEM_SCHEMA) == []


async def test_probe_hits_reserved_init_path(test_engine) -> None:  # type: ignore[no-untyped-def]
    """Setup-time probe GETs ``<endpoint>/init``, NOT the feed URL (poll cycles hit
    the feed URL only — mental-model §5)."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        good_page = _page([_item("probe_ok", n=1, title="ok")])
        fetch_mock = AsyncMock(return_value=good_page)
        with patch.object(poller_module, "fetch_poll_page", new=fetch_mock):
            await _service_create(
                db, actor, wf.id, _poll_body(poll={"url": "https://issues.example/feed"})
            )
    assert fetch_mock.call_args.kwargs["url"] == "https://issues.example/feed/init"


async def test_signature_mismatch_surfaces_all_fields(test_engine) -> None:  # type: ignore[no-untyped-def]
    """DENY-PATH (b): a sample mismatching the workflow's inputs raises a
    field-by-field diff carried as a STRUCTURED list on the wire (extra_detail),
    the whole list — not just the first miss — and the trigger is NOT saved."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        # "n" missing + "title" wrong type -> TWO mismatches.
        bad_page = _page([_item("probe_bad", title=42)])
        with (
            patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=bad_page)),
            pytest.raises(CloudApiError) as exc,
        ):
            await _service_create(db, actor, wf.id, _poll_body())
    assert exc.value.code == "poll_signature_mismatch"
    assert "'n'" in exc.value.message
    assert "title" in exc.value.message
    # The FULL structured diff rides the wire (the ProliferateError handler merges
    # extra_detail into the response detail) so the UI renders every field.
    mismatches = exc.value.extra_detail["mismatches"]
    assert isinstance(mismatches, list)
    assert len(mismatches) == 2
    assert exc.value.extra_detail["item_id"] == "probe_bad"

    # DENY-PATH (b, cont.): the trigger was NOT persisted.
    async with factory() as db:
        rows = (
            (await db.execute(select(WorkflowTrigger).where(WorkflowTrigger.workflow_id == wf.id)))
            .scalars()
            .all()
        )
        assert rows == []


# --- DENY-PATH (a): a bad /init response hard-fails and saves nothing -----------


@pytest.mark.parametrize(
    "failure",
    [
        httpx.TimeoutException("init timed out"),
        httpx.ConnectError("init unreachable"),
        httpx.HTTPStatusError(
            "500",
            request=httpx.Request("GET", "http://x/poll/init"),
            response=httpx.Response(500, request=httpx.Request("GET", "http://x/poll/init")),
        ),
        ValueError("malformed page"),  # stands in for a pydantic ValidationError
    ],
)
async def test_bad_init_response_hard_fails_and_saves_nothing(test_engine, failure) -> None:  # type: ignore[no-untyped-def]
    """A non-200 / malformed / timeout / unreachable /init raises a structured
    ``poll_probe_failed`` and NO trigger row is created or activated."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        with (
            patch.object(poller_module, "fetch_poll_page", new=AsyncMock(side_effect=failure)),
            pytest.raises(CloudApiError) as exc,
        ):
            await _service_create(db, actor, wf.id, _poll_body())
    assert exc.value.code == "poll_probe_failed"
    assert exc.value.status_code == 400

    async with factory() as db:
        rows = (
            (await db.execute(select(WorkflowTrigger).where(WorkflowTrigger.workflow_id == wf.id)))
            .scalars()
            .all()
        )
        assert rows == []


# --- DENY-PATH (d): poll cycles hit ONLY the feed URL, never /init --------------


async def test_poll_cycle_hits_feed_url_not_init(test_engine) -> None:  # type: ignore[no-untyped-def]
    """The runtime poller GETs the feed URL verbatim (no ``/init`` suffix) — /init
    is a setup/re-validation-only path (mental-model §5)."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        feed_url = trigger.poll_url
        await db.commit()

    page = _page([_item("cyc_1", n=1, title="x")])
    fetch_mock = AsyncMock(return_value=page)
    with patch.object(poller_module, "fetch_poll_page", new=fetch_mock):
        await _poll_one_trigger(factory, trigger_id=trigger_id, now=utcnow())
    called_url = fetch_mock.call_args.kwargs["url"]
    assert called_url == feed_url
    assert not called_url.endswith("/init")


# --- DENY-PATH (c) + flow 1: derive-inputs from a sample /init item -------------


def test_derive_inputs_from_sample_types_and_sanitizes() -> None:
    from proliferate.server.cloud.workflows.domain.poll_contract import (
        derive_inputs_from_sample,
        skipped_sample_fields,
    )

    sample = {
        "title": "Fix the bug",  # text
        "count": 7,  # number
        "done": True,  # boolean (bool checked before number)
        "score": 3.5,  # number
        "labels": ["a", "b"],  # non-scalar (array) -> SKIPPED, not mistyped
        "meta": {"k": "v"},  # non-scalar (object) -> SKIPPED
        "due": None,  # null -> SKIPPED (type can't be inferred)
        "issue-id": "X",  # non-identifier name -> sanitized to issue_id
    }
    inputs = derive_inputs_from_sample(sample)
    by_name = {i["name"]: i["type"] for i in inputs}
    assert by_name == {
        "title": "text",
        "count": "number",
        "done": "boolean",
        "score": "number",
        "issue_id": "text",  # "issue-id" sanitized
    }
    assert all(i["required"] is True for i in inputs)
    # Non-scalar fields are skipped (never coerced to "text") and surfaced with a
    # reason so the UI can show what didn't become an input.
    skipped = {f["name"]: f["reason"] for f in skipped_sample_fields(sample)}
    assert set(skipped) == {"labels", "meta", "due"}
    assert all(reason for reason in skipped.values())
    # A non-dict sample derives nothing and skips nothing.
    assert derive_inputs_from_sample(["not", "a", "dict"]) == []
    assert skipped_sample_fields(["not", "a", "dict"]) == []


def test_derive_skip_round_trips_through_diff() -> None:
    """The derived schema validates the ORIGINAL sample cleanly (finding 2 round
    trip): scalar fields become inputs, non-scalars are skipped, and diffing the
    sample against the schema derived from those inputs yields zero mismatches."""
    from proliferate.server.cloud.workflows.domain.definition import parse_definition
    from proliferate.server.cloud.workflows.domain.interpolation import ArgSpec
    from proliferate.server.cloud.workflows.domain.poll_contract import (
        derive_inputs_from_sample,
        derive_item_schema,
        diff_item_against_schema,
    )

    sample = {"title": "x", "labels": ["a"], "meta": {"k": "v"}, "due": None}
    derived = derive_inputs_from_sample(sample)
    assert [i["name"] for i in derived] == ["title"]  # only the scalar became an input

    # Project the derived inputs into arg specs -> the derived item schema, exactly
    # as the service does, then diff the ORIGINAL sample against it.
    _canonical, arg_specs = parse_definition(
        {"version": 1, "inputs": derived, "agents": []}, require_steps=False
    )
    assert isinstance(arg_specs[0], ArgSpec)
    schema = derive_item_schema(arg_specs)
    assert diff_item_against_schema(sample, schema) == []


def test_diff_null_optional_field_is_ok_but_required_fails() -> None:
    """A null sample value is treated like an absent one: it only fails when the
    field is required (finding 2 null consistency)."""
    from proliferate.server.cloud.workflows.domain.poll_contract import (
        diff_item_against_schema,
    )

    required_schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
    }
    optional_schema = {"type": "object", "properties": {"title": {"type": "string"}}}
    # Required + null -> a mismatch (must not be null).
    assert diff_item_against_schema({"title": None}, required_schema) != []
    # Optional + null -> no mismatch (null tolerated like an absent optional field).
    assert diff_item_against_schema({"title": None}, optional_schema) == []


def test_derived_inputs_pass_the_real_definition_validator() -> None:
    """DENY-PATH (c): a derived inputs block is a valid v2 ``inputs`` — it passes
    the REAL definition validator (parse_definition), so the client can seed a new
    workflow definition with it directly."""
    from proliferate.server.cloud.workflows.domain.definition import parse_definition
    from proliferate.server.cloud.workflows.domain.poll_contract import (
        derive_inputs_from_sample,
    )

    derived = derive_inputs_from_sample(
        {"title": "t", "count": 1, "done": False, "1bad name!": "x"}
    )
    canonical, arg_specs = parse_definition(
        {"version": 1, "inputs": derived, "agents": []}, require_steps=False
    )
    # Every derived input survived validation (names sanitized to identifiers).
    assert {i["name"] for i in derived} == {s.name for s in arg_specs}
    assert len(canonical["inputs"]) == len(derived)


async def test_inspect_poll_endpoint_derives_inputs(test_engine) -> None:  # type: ignore[no-untyped-def]
    """Flow 1 (workflow-from-poll): the service probes /init and returns the sample
    + a derived inputs skeleton; the probe hits ``<endpoint>/init``, not the feed."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import inspect_poll_endpoint

    good_page = _page([_item("seed_1", title="hello", count=3, done=True)])
    fetch_mock = AsyncMock(return_value=good_page)
    with patch.object(poller_module, "fetch_poll_page", new=fetch_mock):
        result = await inspect_poll_endpoint(
            TriggerPollRequest.model_validate(
                {"url": "https://issues.example/feed", "intervalSecs": 60}
            )
        )
    assert fetch_mock.call_args.kwargs["url"] == "https://issues.example/feed/init"
    assert result.sample_item_id == "seed_1"
    by_name = {i["name"]: i["type"] for i in result.derived_inputs}
    assert by_name == {"title": "text", "count": "number", "done": "boolean"}


async def test_inspect_poll_endpoint_bad_init_hard_errors() -> None:  # type: ignore[no-untyped-def]
    """Flow 1: a bad /init response is a hard, structured ``poll_probe_failed``."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import inspect_poll_endpoint

    with (
        patch.object(
            poller_module,
            "fetch_poll_page",
            new=AsyncMock(side_effect=httpx.TimeoutException("nope")),
        ),
        pytest.raises(CloudApiError) as exc,
    ):
        await inspect_poll_endpoint(
            TriggerPollRequest.model_validate(
                {"url": "https://issues.example/feed", "intervalSecs": 60}
            )
        )
    assert exc.value.code == "poll_probe_failed"


async def test_inspect_poll_endpoint_no_items_derives_nothing() -> None:  # type: ignore[no-untyped-def]
    """An /init that serves no sample derives nothing (author declares inputs by
    hand); not an error."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import inspect_poll_endpoint

    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=_page([]))):
        result = await inspect_poll_endpoint(
            TriggerPollRequest.model_validate(
                {"url": "https://issues.example/feed", "intervalSecs": 60}
            )
        )
    assert result.sample_item_id is None
    assert result.derived_inputs == []


# --- re-validation fires when the workflow's inputs change (§5) -----------------


async def test_update_reprobes_when_inputs_change(test_engine) -> None:  # type: ignore[no-untyped-def]
    """§5: /init re-validation is re-checked when the workflow's inputs change. A
    trigger update with NO poll block still re-probes /init once the derived item
    schema drifts from the stored one (a new workflow version changed the inputs)."""
    from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
    from proliferate.server.cloud.workflows.service import update_trigger

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        good_page = _page([_item("probe_ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            trigger = await _service_create(db, actor, wf.id, _poll_body())

        # The workflow's inputs change: publish a new version adding a required
        # input, and point the workflow at it.
        new_def = {
            "version": 1,
            "inputs": [
                {"name": "n", "type": "number", "required": True},
                {"name": "title", "type": "text", "required": True},
                {"name": "extra", "type": "text", "required": True},
            ],
            "agents": _DEF["agents"],
        }
        new_ver = WorkflowVersion(
            workflow_id=wf.id,
            version_n=2,
            definition_json=new_def,
            created_by_user_id=user.id,
            created_at=utcnow(),
        )
        db.add(new_ver)
        await db.flush()
        wf.current_version_id = new_ver.id
        await db.flush()

        # A no-poll-block update (just re-enabling) must re-probe /init because the
        # inputs changed. The new sample carries "extra" so the probe passes.
        reprobe_page = _page([_item("probe_ok2", n=1, title="ok", extra="present")])
        fetch_mock = AsyncMock(return_value=reprobe_page)
        with patch.object(poller_module, "fetch_poll_page", new=fetch_mock):
            await update_trigger(
                db,
                actor,
                wf.id,
                trigger.id,
                WorkflowTriggerUpdateRequest.model_validate({"enabled": True}),
            )
    assert fetch_mock.call_count == 1
    assert fetch_mock.call_args.kwargs["url"].endswith("/init")


async def test_update_skips_reprobe_when_inputs_unchanged(test_engine) -> None:  # type: ignore[no-untyped-def]
    """A no-poll-block update that does not change the inputs does NOT re-probe the
    endpoint (bounded — /init is a setup/re-validation-only call)."""
    from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
    from proliferate.server.cloud.workflows.service import update_trigger

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        good_page = _page([_item("probe_ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            trigger = await _service_create(db, actor, wf.id, _poll_body())

        fetch_mock = AsyncMock(return_value=good_page)
        with patch.object(poller_module, "fetch_poll_page", new=fetch_mock):
            await update_trigger(
                db,
                actor,
                wf.id,
                trigger.id,
                WorkflowTriggerUpdateRequest.model_validate({"concurrencyPolicy": "skip"}),
            )
    assert fetch_mock.call_count == 0


# --- §11 risk profile: fetch_poll_page is bounded (size cap + no redirect) ------


async def test_fetch_poll_page_caps_response_size() -> None:
    from proliferate.constants.workflows import WORKFLOW_POLL_MAX_RESPONSE_BYTES
    from proliferate.server.cloud.workflows.poller import (
        PollResponseTooLargeError,
        fetch_poll_page,
    )

    oversize = (
        b'{"items": [], "cursor": "c", "has_more": false, "pad": "'
        + (b"x" * (WORKFLOW_POLL_MAX_RESPONSE_BYTES + 16))
        + b'"}'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=oversize)

    transport = httpx.MockTransport(handler)
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollResponseTooLargeError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            auth_header=None,
            auth_value=None,
            cursor=None,
        )


async def test_fetch_poll_page_does_not_follow_redirects() -> None:
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    hits: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hits.append(str(request.url))
        if request.url.path.endswith("/feed"):
            return httpx.Response(302, headers={"location": "https://evil.example/steal"})
        return httpx.Response(200, json={"items": [], "cursor": None, "has_more": False})

    transport = httpx.MockTransport(handler)
    # follow_redirects=False: the 302 is surfaced (raise_for_status) rather than
    # silently chased to the redirect target.
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(httpx.HTTPStatusError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            auth_header=None,
            auth_value=None,
            cursor=None,
        )
    # The redirect target was never fetched — only the authored feed URL was hit.
    assert not any("evil.example" in h for h in hits)
    assert any("issues.example" in h for h in hits)


async def test_trigger_record_hides_secret_exposes_has_auth(test_engine) -> None:  # type: ignore[no-untyped-def]
    """A read of a poll trigger surfaces poll_has_auth but never the ciphertext."""
    from proliferate.utils.crypto import encrypt_text

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger.poll_auth_header = "Authorization"
        trigger.poll_auth_ciphertext = encrypt_text("Bearer sekret")
        await db.flush()
        trigger_id = trigger.id
        await db.commit()

    async with factory() as db:
        record = await trigger_store.get_trigger(db, trigger_id)
    assert record is not None
    assert record.poll_has_auth is True
    assert record.poll_auth_header == "Authorization"
    assert not hasattr(record, "poll_auth_ciphertext")  # secret never on the record


# --- finding 3: disabling a poll trigger never reprobes /init (no disable-brick) -


async def test_disable_poll_trigger_skips_reprobe_when_endpoint_down(test_engine) -> None:  # type: ignore[no-untyped-def]
    """Finding 3: ``PATCH {enabled: false}`` must succeed even when the endpoint is
    down and the inputs have drifted (which would otherwise force a reprobe). A
    disabled trigger never polls, so its endpoint shape is irrelevant while off."""
    from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
    from proliferate.server.cloud.workflows.service import update_trigger

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        good_page = _page([_item("probe_ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            trigger = await _service_create(db, actor, wf.id, _poll_body())

        # The workflow's inputs change (adds a required "extra") so the derived item
        # schema drifts from the stored one — this is exactly the condition that
        # forces a reprobe on an ENABLED edit.
        new_def = {
            "version": 1,
            "inputs": [
                {"name": "n", "type": "number", "required": True},
                {"name": "title", "type": "text", "required": True},
                {"name": "extra", "type": "text", "required": True},
            ],
            "agents": _DEF["agents"],
        }
        new_ver = WorkflowVersion(
            workflow_id=wf.id,
            version_n=2,
            definition_json=new_def,
            created_by_user_id=user.id,
            created_at=utcnow(),
        )
        db.add(new_ver)
        await db.flush()
        wf.current_version_id = new_ver.id
        await db.flush()

        # Endpoint is down: any reprobe would raise poll_probe_failed and brick the
        # disable. With the fix, disabling skips the reprobe entirely.
        down = AsyncMock(side_effect=httpx.ConnectError("endpoint down"))
        with patch.object(poller_module, "fetch_poll_page", new=down):
            updated = await update_trigger(
                db,
                actor,
                wf.id,
                trigger.id,
                WorkflowTriggerUpdateRequest.model_validate({"enabled": False}),
            )
    assert updated.enabled is False
    assert down.call_count == 0  # never reprobed on a disable


# --- finding 4: SSRF guard on the /init probe (private/metadata addrs blocked) --


@pytest.mark.parametrize(
    "private_url",
    [
        "http://10.0.0.1/poll",  # RFC1918 private
        "http://169.254.169.254/latest/meta-data",  # link-local cloud metadata
        "http://100.64.0.1/poll",  # RFC6598 CGNAT / Tailscale
    ],
)
async def test_inspect_poll_endpoint_blocks_private_address(  # type: ignore[no-untyped-def]
    monkeypatch, private_url
) -> None:
    """Finding 4: the stateless probe refuses a URL whose host is a private,
    metadata, or CGNAT address — a structured error, and ZERO outbound (the guard
    raises before fetch_poll_page is ever called)."""
    from proliferate.server.cloud.workflows import service as service_module
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import inspect_poll_endpoint

    # The guard is bypassed under settings.debug (local/self-host dev); flip it off
    # so the guard is active for this test.
    monkeypatch.setattr(service_module.settings, "debug", False)

    # A sentinel that FAILS the test if any outbound request is attempted.
    sentinel = AsyncMock(side_effect=AssertionError("no outbound request may be issued"))
    with (
        patch.object(poller_module, "fetch_poll_page", new=sentinel),
        pytest.raises(CloudApiError) as exc,
    ):
        await inspect_poll_endpoint(
            TriggerPollRequest.model_validate({"url": private_url, "intervalSecs": 60})
        )
    assert exc.value.code == "poll_endpoint_blocked"
    assert exc.value.status_code == 400
    assert sentinel.await_count == 0  # zero outbound


async def test_inspect_poll_endpoint_guard_bypassed_in_debug(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Under settings.debug (local/self-host dev), a localhost feed is NOT blocked —
    the guard is skipped so dev feeds keep working."""
    from proliferate.server.cloud.workflows import service as service_module
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.service import inspect_poll_endpoint

    monkeypatch.setattr(service_module.settings, "debug", True)
    good_page = _page([_item("seed_1", title="hi")])
    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
        result = await inspect_poll_endpoint(
            TriggerPollRequest.model_validate(
                {"url": "http://127.0.0.1:9000/feed", "intervalSecs": 60}
            )
        )
    assert result.sample_item_id == "seed_1"
