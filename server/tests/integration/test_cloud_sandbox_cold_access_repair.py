"""Cold sandbox access schedules its own repair instead of dead-ending in 409.

The dead end this pins: ``load_cloud_sandbox_runtime_access`` 409s
``cloud_sandbox_runtime_not_ready`` whenever the row carries no runtime access —
never stamped, or cleared by provider loss
(``mark_cloud_sandbox_provider_missing``) — and nothing on the access path
started the materialization that would stamp it, so the client's retry hit the
identical 409 forever.

The 409 itself is deliberately unchanged (provisioning is far too slow to hold a
request open, and clients already render it as "connecting"); what changes is
that the cold path now kicks off exactly one background repair. Stampede safety
is a real cross-process Redis claim, so these run against the live Redis the
suite already requires for materialization locks. The provider side is stubbed
per the repo testing standard — no real sandboxes.
"""

from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.cloud_sandboxes import cloud_sandbox_value
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.gateway import service as gateway_service
from proliferate.server.cloud.materialization import operation, runner
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.lib.infra.encryption.fernet import encrypt_text
from proliferate.lib.infra.time.wall_clock import utcnow


@pytest.fixture(autouse=True)
def _managed_cloud_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deployment that can actually provision; otherwise repair is a no-op."""
    monkeypatch.setattr(settings, "e2b_api_key", "test-e2b-key")
    monkeypatch.setattr(settings, "e2b_template_name", "test-template")


@pytest.fixture(autouse=True)
def _clean_gateway_cache() -> Any:
    gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
    yield
    gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()


@pytest.fixture
def spawned(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture background materialization spawns without running them.

    Not running the task is the point for the stampede assertions: the repair
    claim stays held exactly as it would while a real 30-60 s provision is in
    flight, which is the window a polling client hammers.
    """
    calls: list[dict[str, Any]] = []

    def _capture(fn: Any, **kwargs: Any) -> None:
        calls.append({"fn": fn, **kwargs})

    monkeypatch.setattr(runner, "spawn_materialization_task", _capture)
    return calls


async def _seed_user(db: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"cold-access-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user.id


async def _seed_sandbox(
    db: AsyncSession,
    *,
    status: CloudSandboxStatus = CloudSandboxStatus.creating,
    stamped: bool = False,
    destroyed: bool = False,
) -> tuple[uuid.UUID, CloudSandbox]:
    user_id = await _seed_user(db)
    now = utcnow()
    sandbox = CloudSandbox(
        owner_user_id=user_id,
        sandbox_type="e2b",
        provider_sandbox_id=None,
        status=status,
        anyharness_base_url="https://runtime.invalid" if stamped else None,
        runtime_token_ciphertext=encrypt_text("runtime-token", secret=settings.cloud_secret_key)
        if stamped
        else None,
        anyharness_data_key_ciphertext=encrypt_text("data-key", secret=settings.cloud_secret_key)
        if stamped
        else None,
        destroyed_at=now if destroyed else None,
    )
    db.add(sandbox)
    await db.commit()
    return user_id, sandbox


@pytest.mark.asyncio
async def test_fresh_signup_polling_commits_the_row_and_schedules_one_repair(
    db_session: AsyncSession,
    test_engine: Any,
    spawned: list[dict[str, Any]],
) -> None:
    """The fresh-signup shape: no sandbox row at all, only the gateway path.

    This is the case that used to page per poll. ``ensure_cloud_sandbox_ready``
    created the row with add+flush and no commit; access resolution then 409ed and
    the request session rolled back, so the row never persisted. Every poll minted
    a new sandbox id, hence a new claim key that could never collide — one
    background repair per poll, each of which then could not find the row and so
    reached the runner's paging handler.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    user_id = await _seed_user(db_session)
    await db_session.commit()
    user = SimpleNamespace(id=user_id)
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)

    for _ in range(4):
        gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
        # Mirror get_async_session: a request that raises rolls its session back.
        async with sessions() as db:
            with pytest.raises(CloudApiError) as excinfo:
                await gateway_service.ensure_cloud_sandbox_gateway_access(
                    db,
                    user,  # type: ignore[arg-type]
                )
            assert excinfo.value.code == "cloud_sandbox_runtime_not_ready"
            await db.rollback()

    # The ensured row survived the 409 rollback, so its id is stable...
    async with sessions() as verify_db:
        persisted = await sandbox_store.load_personal_cloud_sandbox(verify_db, user_id)
    assert persisted is not None

    # ...which is what lets the claim dedupe every subsequent poll.
    assert len(spawned) == 1
    assert spawned[0]["claim_key"] == f"sandbox-repair:{persisted.id}"


@pytest.mark.asyncio
async def test_repair_for_a_vanished_sandbox_row_does_not_page(
    db_session: AsyncSession,
    test_engine: Any,
    spawned: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A row that disappears before the repair runs is benign, never a page."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    user_id, sandbox = await _seed_sandbox(db_session)

    with pytest.raises(CloudApiError):
        await gateway_service.ensure_cloud_sandbox_gateway_access(
            db_session,
            SimpleNamespace(id=user_id),  # type: ignore[arg-type]
        )
    assert len(spawned) == 1
    call = spawned[0]

    # The owner (or the reaper) destroys the sandbox before the repair starts.
    await db_session.delete(sandbox)
    await db_session.commit()

    paged: list[object] = []
    monkeypatch.setattr(runner, "report_critical", lambda exc, **_: paged.append(exc))
    monkeypatch.setattr(
        runner,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    await runner._run_with_fresh_session(
        materialization_service._repair_materialize_sandbox,
        {
            "user_id": call["user_id"],
            "claim_key": call["claim_key"],
            "claim_token": call["claim_token"],
        },
    )

    assert paged == []
    # The claim was still released, so a later access can retry.
    assert (
        await materialization_service.schedule_repair_materialize_sandbox(
            sandbox_id=sandbox.id,
            user_id=user_id,
            reason="test_after_vanish",
        )
        is True
    )


@pytest.mark.asyncio
async def test_other_repair_failures_still_page(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only the missing-row outcome is benign; every other failure still pages."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    user_id, _sandbox = await _seed_sandbox(db_session)

    async def _boom(*_a: Any, **_k: Any) -> None:
        raise operation.CloudMaterializationError("provider exploded")

    monkeypatch.setattr(materialization_service, "materialize_sandbox", _boom)
    paged: list[object] = []
    monkeypatch.setattr(runner, "report_critical", lambda exc, **_: paged.append(exc))
    monkeypatch.setattr(
        runner,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    await runner._run_with_fresh_session(
        materialization_service._repair_materialize_sandbox,
        {"user_id": user_id, "claim_key": "sandbox-repair:test", "claim_token": "unowned"},
    )

    assert len(paged) == 1


@pytest.mark.asyncio
async def test_repair_scheduling_releases_the_claim_when_the_spawn_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A synchronous spawn failure must not strand the claim for a whole TTL."""
    sandbox_id = uuid.uuid4()

    def _refuse(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("event loop is shutting down")

    monkeypatch.setattr(runner, "spawn_materialization_task", _refuse)

    with pytest.raises(RuntimeError):
        await materialization_service.schedule_repair_materialize_sandbox(
            sandbox_id=sandbox_id,
            user_id=uuid.uuid4(),
            reason="test_spawn_failure",
        )

    monkeypatch.undo()
    spawns: list[dict[str, Any]] = []
    monkeypatch.setattr(
        runner,
        "spawn_materialization_task",
        lambda fn, **kwargs: spawns.append({"fn": fn, **kwargs}),
    )

    # The claim is free again, so the next access schedules rather than waiting
    # out SANDBOX_REPAIR_CLAIM_TTL_SECONDS.
    assert (
        await materialization_service.schedule_repair_materialize_sandbox(
            sandbox_id=sandbox_id,
            user_id=uuid.uuid4(),
            reason="test_after_spawn_failure",
        )
        is True
    )
    assert len(spawns) == 1
    await materialization_service.locks.release_materialization_trigger_claim(
        spawns[0]["claim_key"],
        token=spawns[0]["claim_token"],
    )


@pytest.mark.asyncio
async def test_cold_gateway_access_409s_and_schedules_one_repair(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
) -> None:
    """A never-stamped row still 409s, but now a repair is on its way."""
    user_id, sandbox = await _seed_sandbox(db_session)

    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.ensure_cloud_sandbox_gateway_access(
            db_session,
            SimpleNamespace(id=user_id),  # type: ignore[arg-type]
        )

    # The wire contract is unchanged: same code, same 409, so the client's
    # existing retry/connecting affordance keeps working.
    assert excinfo.value.status_code == 409
    assert excinfo.value.code == "cloud_sandbox_runtime_not_ready"

    assert len(spawned) == 1
    assert spawned[0]["user_id"] == user_id
    # The repair targets this exact sandbox's claim, not a per-user global.
    assert spawned[0]["claim_key"] == f"sandbox-repair:{sandbox.id}"


@pytest.mark.asyncio
async def test_repeated_cold_access_schedules_repair_exactly_once(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
) -> None:
    """A client polling the 409 must not queue a provision per attempt."""
    user_id, _sandbox = await _seed_sandbox(db_session)
    user = SimpleNamespace(id=user_id)

    for _ in range(5):
        # The 60 s access cache never caches a failure, so every attempt takes
        # the resolve path — which is exactly why the claim has to carry it.
        gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
        with pytest.raises(CloudApiError) as excinfo:
            await gateway_service.ensure_cloud_sandbox_gateway_access(
                db_session,
                user,  # type: ignore[arg-type]
            )
        assert excinfo.value.code == "cloud_sandbox_runtime_not_ready"

    assert len(spawned) == 1


@pytest.mark.asyncio
async def test_concurrent_cold_access_schedules_repair_exactly_once(
    db_session: AsyncSession,
    test_engine: Any,
    spawned: list[dict[str, Any]],
) -> None:
    """N concurrent gateway callers on one cold sandbox schedule one repair."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    user_id, _sandbox = await _seed_sandbox(db_session)
    user = SimpleNamespace(id=user_id)
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)

    async def _attempt() -> str:
        # Separate sessions, mirroring separate request handlers; the per-user
        # asyncio single-flight is deliberately bypassed so the Redis claim is
        # the only thing standing between these callers and N provisions.
        gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
        async with sessions() as db:
            try:
                await gateway_service.ensure_cloud_sandbox_gateway_access(
                    db,
                    user,  # type: ignore[arg-type]
                )
            except CloudApiError as error:
                return error.code
            return "unexpected_success"

    results = await asyncio.gather(*(_attempt() for _ in range(8)))

    assert set(results) == {"cloud_sandbox_runtime_not_ready"}
    assert len(spawned) == 1


@pytest.mark.asyncio
async def test_repair_claim_release_allows_a_later_retry(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A finished (or failed) repair must not suppress the next one for a TTL."""
    user_id, _sandbox = await _seed_sandbox(db_session)
    user = SimpleNamespace(id=user_id)

    with pytest.raises(CloudApiError):
        await gateway_service.ensure_cloud_sandbox_gateway_access(
            db_session,
            user,  # type: ignore[arg-type]
        )
    assert len(spawned) == 1

    # Run the captured repair with the materializer stubbed out, so only the
    # claim bookkeeping is exercised.
    async def _materialize(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(materialization_service, "materialize_sandbox", _materialize)
    call = spawned[0]
    await materialization_service._repair_materialize_sandbox(
        db_session,
        user_id=call["user_id"],
        claim_key=call["claim_key"],
        claim_token=call["claim_token"],
    )

    gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
    with pytest.raises(CloudApiError):
        await gateway_service.ensure_cloud_sandbox_gateway_access(
            db_session,
            user,  # type: ignore[arg-type]
        )

    assert len(spawned) == 2


@pytest.mark.asyncio
async def test_destroyed_sandbox_access_409s_without_scheduling(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
) -> None:
    """A destroyed row is gone, not cold: never re-provision it."""
    _user_id, sandbox = await _seed_sandbox(
        db_session,
        status=CloudSandboxStatus.destroyed,
        destroyed=True,
    )

    with pytest.raises(CloudApiError) as excinfo:
        await cloud_sandboxes_service.load_cloud_sandbox_runtime_access_or_repair(
            cloud_sandbox_value(sandbox),
            reason="test_destroyed",
        )

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == "cloud_sandbox_runtime_not_ready"
    assert spawned == []


@pytest.mark.asyncio
async def test_ready_sandbox_access_is_untouched(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
) -> None:
    """A stamped row resolves normally and schedules nothing."""
    user_id, _sandbox = await _seed_sandbox(
        db_session,
        status=CloudSandboxStatus.ready,
        stamped=True,
    )

    access = await gateway_service.ensure_cloud_sandbox_gateway_access(
        db_session,
        SimpleNamespace(id=user_id),  # type: ignore[arg-type]
    )

    assert access.upstream_base_url == "https://runtime.invalid"
    assert access.upstream_token == "runtime-token"
    assert spawned == []


@pytest.mark.asyncio
async def test_provider_loss_cleared_access_schedules_repair(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
) -> None:
    """The other way a row goes cold: provider loss wiped its access columns."""
    user_id, sandbox = await _seed_sandbox(
        db_session,
        status=CloudSandboxStatus.ready,
        stamped=True,
    )
    sandbox.provider_sandbox_id = f"sandbox-{uuid.uuid4().hex[:8]}"
    await db_session.commit()

    cleared = await sandbox_store.mark_cloud_sandbox_provider_missing(
        db_session,
        sandbox.id,
        expected_provider_sandbox_id=sandbox.provider_sandbox_id,
        expected_materialization_attempt=sandbox.materialization_attempt,
        observed_at=utcnow(),
        last_error="provider gone",
    )
    await db_session.commit()
    assert cleared is not None
    assert cleared.anyharness_base_url is None

    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.ensure_cloud_sandbox_gateway_access(
            db_session,
            SimpleNamespace(id=user_id),  # type: ignore[arg-type]
        )

    assert excinfo.value.code == "cloud_sandbox_runtime_not_ready"
    assert len(spawned) == 1
    assert spawned[0]["claim_key"] == f"sandbox-repair:{sandbox.id}"


@pytest.mark.asyncio
async def test_repair_is_skipped_when_managed_cloud_is_not_configured(
    db_session: AsyncSession,
    spawned: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No provider configured means a repair could only fail in the background."""
    monkeypatch.setattr(settings, "e2b_api_key", "")
    _user_id, sandbox = await _seed_sandbox(db_session)

    with pytest.raises(CloudApiError):
        await cloud_sandboxes_service.load_cloud_sandbox_runtime_access_or_repair(
            cloud_sandbox_value(sandbox),
            reason="test_unconfigured",
        )

    assert spawned == []
