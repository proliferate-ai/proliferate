"""Concurrency regression coverage for Cloud sandbox materialization."""

from __future__ import annotations

import asyncio
import inspect
import uuid
from types import SimpleNamespace

import pytest

from proliferate.constants.organizations import ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_secrets import CloudSecretSetPayload
from proliferate.server.cloud.materialization import locks, operation
from proliferate.server.cloud.materialization.materialize import secret_set as secret_materializer
from proliferate.server.cloud.secrets import service as secrets_service


@pytest.mark.asyncio
async def test_personal_organization_secret_burst_schedules_each_mutation_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    personal_id = uuid.uuid4()
    organization_secret_id = uuid.uuid4()

    personal_before = SimpleNamespace(
        id=personal_id,
        scope_kind="personal",
        user_id=user_id,
        organization_id=None,
        repo_environment_id=None,
        version=1,
        env_vars=(SimpleNamespace(name="EXISTING"),),
        files=(),
    )
    personal_after = SimpleNamespace(**{**vars(personal_before), "version": 2})
    organization_before = SimpleNamespace(
        id=organization_secret_id,
        scope_kind="organization",
        user_id=None,
        organization_id=organization_id,
        repo_environment_id=None,
        version=1,
        env_vars=(SimpleNamespace(name="EXISTING"),),
        files=(),
    )
    organization_after = SimpleNamespace(**{**vars(organization_before), "version": 2})

    async def _personal(*_args: object, **_kwargs: object) -> object:
        return personal_before

    async def _organization(*_args: object, **_kwargs: object) -> object:
        return organization_before

    update_finished: set[uuid.UUID] = set()

    async def _upsert(
        _db: object,
        *,
        secret_set_id: uuid.UUID,
        **_kwargs: object,
    ) -> object:
        update_finished.add(secret_set_id)
        if secret_set_id == personal_id:
            return personal_after
        return organization_after

    async def _membership(*_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(role=ORGANIZATION_ROLE_OWNER)

    async def _no_materialization(*_args: object, **_kwargs: object) -> None:
        return None

    scheduled: list[tuple[uuid.UUID, str]] = []

    async def _schedule(
        _db: object,
        *,
        secret_set_id: uuid.UUID,
    ) -> None:
        phase = "after_update" if secret_set_id in update_finished else "stale_read"
        scheduled.append((secret_set_id, phase))

    monkeypatch.setattr(
        secrets_service.secret_store,
        "get_or_create_personal_secret_set",
        _personal,
    )
    monkeypatch.setattr(
        secrets_service.secret_store,
        "get_or_create_organization_secret_set",
        _organization,
    )
    monkeypatch.setattr(secrets_service.secret_store, "upsert_secret_env_var", _upsert)
    monkeypatch.setattr(
        secrets_service.organization_store,
        "get_active_membership",
        _membership,
    )
    monkeypatch.setattr(
        secrets_service,
        "_load_user_global_materialization",
        _no_materialization,
    )
    monkeypatch.setattr(
        secrets_service.materialization_service,
        "schedule_materialize_secret_set",
        _schedule,
    )

    db = SimpleNamespace()
    await secrets_service.set_personal_secret_env_var(
        db,  # type: ignore[arg-type]
        user_id=user_id,
        name="PERSONAL_KEY",
        value="personal-value",
    )
    await secrets_service.set_organization_secret_env_var(
        db,  # type: ignore[arg-type]
        user_id=user_id,
        organization_id=organization_id,
        name="ORG_KEY",
        value="organization-value",
    )

    assert scheduled == [
        (personal_id, "after_update"),
        (organization_secret_id, "after_update"),
    ]


@pytest.mark.asyncio
async def test_stale_secret_read_reschedules_after_background_work_is_lost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    secret_set_id = uuid.uuid4()
    secret_set = SimpleNamespace(
        id=secret_set_id,
        scope_kind="personal",
        user_id=user_id,
        organization_id=None,
        repo_environment_id=None,
        version=2,
        env_vars=(SimpleNamespace(name="LATEST"),),
        files=(),
    )

    async def _personal(*_args: object, **_kwargs: object) -> object:
        return secret_set

    async def _no_materialization(*_args: object, **_kwargs: object) -> None:
        return None

    scheduled: list[uuid.UUID] = []

    async def _schedule(
        _db: object,
        *,
        secret_set_id: uuid.UUID,
    ) -> None:
        scheduled.append(secret_set_id)

    monkeypatch.setattr(
        secrets_service.secret_store,
        "get_or_create_personal_secret_set",
        _personal,
    )
    monkeypatch.setattr(
        secrets_service,
        "_load_user_global_materialization",
        _no_materialization,
    )
    monkeypatch.setattr(
        secrets_service.materialization_service,
        "schedule_materialize_secret_set",
        _schedule,
    )

    value, materialization = await secrets_service.get_personal_secrets(
        SimpleNamespace(),  # type: ignore[arg-type]
        user_id=user_id,
    )

    assert value is secret_set
    assert materialization is None
    assert scheduled == [secret_set_id]


@pytest.mark.asyncio
async def test_global_materializer_applies_latest_merged_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    personal_id = uuid.uuid4()
    organization_secret_id = uuid.uuid4()
    materialization_id = uuid.uuid4()
    personal = CloudSecretSetPayload(
        id=personal_id,
        scope_kind="personal",
        user_id=user_id,
        organization_id=None,
        repo_environment_id=None,
        version=7,
        env_vars=(),
        files=(),
    )
    organization = CloudSecretSetPayload(
        id=organization_secret_id,
        scope_kind="organization",
        user_id=None,
        organization_id=organization_id,
        repo_environment_id=None,
        version=11,
        env_vars=(),
        files=(),
    )

    class _Db:
        async def commit(self) -> None:
            return None

    async def _begin(*_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(id=materialization_id, applied_manifest={})

    async def _organizations(*_args: object, **_kwargs: object) -> object:
        return (organization,)

    async def _personal(*_args: object, **_kwargs: object) -> object:
        return personal

    async def _write(*_args: object, **_kwargs: object) -> None:
        return None

    async def _remove(*_args: object, **_kwargs: object) -> None:
        return None

    applied_versions_capture: dict[str, int] = {}

    async def _capture_ready(
        _db: object,
        _materialization_id: uuid.UUID,
        *,
        applied_versions: dict[str, int],
        **_kwargs: object,
    ) -> None:
        nonlocal applied_versions_capture
        applied_versions_capture = dict(applied_versions)

    monkeypatch.setattr(
        secret_materializer.sandbox_secret_store,
        "begin_global_secret_materialization",
        _begin,
    )
    monkeypatch.setattr(
        secret_materializer.cloud_secrets_store,
        "list_organization_secret_payloads_for_user",
        _organizations,
    )
    monkeypatch.setattr(
        secret_materializer.cloud_secrets_store,
        "load_personal_secret_payload",
        _personal,
    )
    monkeypatch.setattr(secret_materializer.sandbox_io, "write_private_file_atomic", _write)
    monkeypatch.setattr(secret_materializer.sandbox_io, "remove_owned_files", _remove)
    monkeypatch.setattr(
        secret_materializer.sandbox_secret_store,
        "mark_secret_materialization_ready",
        _capture_ready,
    )

    await secret_materializer.materialize_global_secrets_for_user(
        _Db(),  # type: ignore[arg-type]
        ctx=operation.MaterializationContext(
            sandbox=SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
            target=SimpleNamespace(),  # type: ignore[arg-type]
        ),
        user_id=user_id,
    )

    assert applied_versions_capture == {
        f"organization:{organization_id}": 11,
        f"personal:{user_id}": 7,
    }


class _SerialRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def set(self, key: str, value: str, **kwargs: object) -> bool:
        if kwargs.get("nx") and key in self.values:
            return False
        self.values[key] = value
        return True

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def eval(
        self,
        script: str,
        key_count: int,
        lock_name: str,
        *args: object,
    ) -> int:
        if key_count == 1:
            holder_name = None
            token = str(args[0])
            extra_args = args[1:]
        else:
            holder_name = str(args[0])
            token = str(args[1])
            extra_args = args[2:]
        if self.values.get(lock_name) != token:
            return 0
        if "del" in script:
            self.values.pop(lock_name, None)
            if holder_name is not None:
                self.values.pop(holder_name, None)
        elif holder_name is not None and extra_args:
            self.values[holder_name] = str(extra_args[-1])
        return 1

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_duplicate_secret_burst_strands_a_waiter_but_single_schedules_do_not(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_sleep = asyncio.sleep

    async def _lock_sleep(delay: float) -> None:
        if delay == 0.5:
            await real_sleep(0.001)
            return
        await real_sleep(3600)

    monkeypatch.setattr(
        locks,
        "asyncio",
        SimpleNamespace(
            sleep=_lock_sleep,
            create_task=asyncio.create_task,
            shield=asyncio.shield,
            CancelledError=asyncio.CancelledError,
        ),
    )
    redis = _SerialRedis()
    monkeypatch.setattr(locks.Redis, "from_url", lambda *_args, **_kwargs: redis)

    async def _materialize() -> None:
        lock_kwargs: dict[str, object] = {"wait_timeout_seconds": 0.08}
        if "operation_key" in inspect.signature(locks.redis_materialization_lock).parameters:
            lock_kwargs["operation_key"] = "secrets:global"
        async with locks.redis_materialization_lock(
            "cloud-sandbox:shared",
            **lock_kwargs,  # type: ignore[arg-type]
        ):
            await real_sleep(0.05)

    duplicated = await asyncio.gather(
        *(_materialize() for _ in range(4)),
        return_exceptions=True,
    )
    assert (
        sum(isinstance(result, locks.CloudMaterializationLockTimeout) for result in duplicated)
        >= 1
    )

    redis.values.clear()
    intended = await asyncio.gather(
        *(_materialize() for _ in range(2)),
        return_exceptions=True,
    )
    assert intended == [None, None]
