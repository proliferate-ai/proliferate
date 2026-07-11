"""Route-level cache controls for materialization credentials and bindings."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.workflow_identity import WorkflowMaterializationOffer
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.engine import get_async_session
from proliferate.main import create_app
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.binding import api as binding_api
from proliferate.server.cloud.workflows.binding.access import (
    BindingActor,
    authenticate_binding_actor,
)
from proliferate.server.cloud.workflows.binding.cache_control import (
    WorkflowBindingNoStoreMiddleware,
)
from proliferate.server.cloud.workflows.binding.models import (
    ExecutionBindingAcceptanceResponse,
    ExecutionBindingStatusResponse,
)
from proliferate.server.cloud.workflows.binding.service import issue_materialization_offer
from proliferate.server.cloud.workflows.contracts.models import (
    ExecutionBinding,
    MaterializationOffer,
    SourceIntent,
    binding_hash,
)
from tests.unit.test_workflow_binding_identity import (
    _binding as _real_binding,
    _identity_run,
    _local_actor,
)

pytestmark = pytest.mark.asyncio


class _Db:
    def __init__(self, *, fail_commit: bool = False) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.fail_commit = fail_commit

    async def commit(self) -> None:
        self.commits += 1
        if self.fail_commit:
            raise RuntimeError("injected commit failure")

    async def rollback(self) -> None:
        self.rollbacks += 1


class _CommitFailingSession:
    def __init__(self, inner: AsyncSession) -> None:
        self.inner = inner
        self.commit_attempts = 0
        self.rollback_attempts = 0

    def __getattr__(self, name: str):  # type: ignore[no-untyped-def]
        return getattr(self.inner, name)

    async def commit(self) -> None:
        self.commit_attempts += 1
        raise RuntimeError("injected commit failure")

    async def rollback(self) -> None:
        self.rollback_attempts += 1
        await self.inner.rollback()


def _binding() -> ExecutionBinding:
    raw: dict[str, object] = {
        "schemaVersion": 1,
        "target": "local",
        "sourceKind": "local_commit",
        "repositoryObjectFormat": "sha1",
        "baseCommitOid": "1" * 40,
        "workspaceId": "workspace-1",
        "workspaceGeneration": 1,
        "materializationId": "materialization-1",
        "executorId": "executor-1",
        "executorGeneration": 1,
        "bindingHash": "",
    }
    raw["bindingHash"] = binding_hash(raw)
    return ExecutionBinding.model_validate(raw)


def _binding_actor() -> BindingActor:
    return BindingActor.worker(
        worker_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        runtime_kind="desktop",
        desktop_install_id="desktop-test",
        generation=1,
    )


def _app(monkeypatch: pytest.MonkeyPatch, *, fail_commit: bool = False) -> tuple[FastAPI, _Db]:
    run_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
    db = _Db(fail_commit=fail_commit)

    async def session() -> AsyncIterator[_Db]:
        yield db

    async def offer(*_args: object, **_kwargs: object) -> MaterializationOffer:
        return MaterializationOffer(
            schema_version=1,
            run_id=str(run_id),
            plan_hash=f"sha256:{'a' * 64}",
            target="local",
            execution_generation=1,
            executor_id="executor-1",
            executor_fence="fence-1",
            source_intent=SourceIntent(kind="local_commit"),
            materialization_credential="wfm1.test.only",
            credential_generation=1,
            expires_at="2026-07-11T01:00:00Z",
        )

    async def accept(*_args: object, **_kwargs: object) -> ExecutionBindingAcceptanceResponse:
        binding = _binding()
        return ExecutionBindingAcceptanceResponse(
            accepted=True,
            idempotent=False,
            run_id=str(run_id),
            plan_hash=f"sha256:{'a' * 64}",
            binding_hash=binding.binding_hash,
            execution_generation=1,
            acceptance_state="accepted",
            binding=binding,
        )

    async def status(*_args: object, **_kwargs: object) -> ExecutionBindingStatusResponse:
        binding = _binding()
        return ExecutionBindingStatusResponse(
            accepted=True,
            run_id=str(run_id),
            plan_hash=f"sha256:{'a' * 64}",
            binding_hash=binding.binding_hash,
            execution_generation=1,
            acceptance_state="accepted",
            binding=binding,
        )

    monkeypatch.setattr(binding_api, "issue_materialization_offer", offer)
    monkeypatch.setattr(binding_api, "accept_execution_binding", accept)
    monkeypatch.setattr(binding_api, "get_execution_binding_status", status)
    app = FastAPI()

    async def cloud_error_handler(_request, error: CloudApiError):  # type: ignore[no-untyped-def]
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": {"code": error.code, "message": error.message}},
        )

    app.add_exception_handler(CloudApiError, cloud_error_handler)
    app.add_middleware(WorkflowBindingNoStoreMiddleware)
    app.include_router(binding_api.router)
    app.dependency_overrides[get_async_session] = session
    app.dependency_overrides[authenticate_binding_actor] = _binding_actor
    return app, db


def _request_for(suffix: str) -> tuple[dict[str, object], dict[str, str]]:
    if suffix == "materialization-offer":
        return {"executorId": "executor-1"}, {}
    return (
        {
            "schemaVersion": 1,
            "executionGeneration": 1,
            "executorFence": "fence-1",
            "binding": _binding().to_wire(),
        },
        {"X-Proliferate-Workflow-Materialization": "wfm1.test.only"},
    )


def _real_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    db = _Db()

    async def session() -> AsyncIterator[_Db]:
        yield db

    monkeypatch.setattr(settings, "api_path_prefix", "")
    monkeypatch.setattr(settings, "workflows_enabled_override", True)
    app = create_app()
    app.dependency_overrides[get_async_session] = session
    return app


async def _post_real(app: FastAPI, suffix: str):  # type: ignore[no-untyped-def]
    body, headers = _request_for(suffix)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(
            f"/v1/cloud/workflows/runs/11111111-1111-4111-8111-111111111111/{suffix}",
            json=body,
            headers=headers,
        )


@pytest.mark.parametrize(
    ("suffix", "body", "headers"),
    [
        ("materialization-offer", {"executorId": "executor-1"}, {}),
        (
            "execution-binding",
            {
                "schemaVersion": 1,
                "executionGeneration": 1,
                "executorFence": "fence-1",
                "binding": {},
            },
            {"X-Proliferate-Workflow-Materialization": "wfm1.test.only"},
        ),
    ],
)
async def test_binding_success_responses_are_no_store(
    monkeypatch: pytest.MonkeyPatch,
    suffix: str,
    body: dict[str, object],
    headers: dict[str, str],
) -> None:
    app, _db = _app(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/runs/11111111-1111-4111-8111-111111111111/{suffix}",
            json=body,
            headers=headers,
        )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    if suffix == "execution-binding":
        emitted = payload["binding"]
        assert "checkpointId" not in emitted
        assert "checkpointContentHash" not in emitted
        assert binding_hash(emitted) == payload["bindingHash"] == emitted["bindingHash"]
    else:
        source_intent = payload["sourceIntent"]
        assert source_intent == {"kind": "local_commit"}


async def test_binding_status_recovery_is_actor_authenticated_redacted_and_no_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, db = _app(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/runs/11111111-1111-4111-8111-111111111111/execution-binding")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert payload["acceptanceState"] == "accepted"
    emitted = payload["binding"]
    assert "checkpointId" not in emitted
    assert "checkpointContentHash" not in emitted
    assert binding_hash(emitted) == payload["bindingHash"] == emitted["bindingHash"]
    assert "materializationCredential" not in response.text
    assert "executorFence" not in response.text
    assert db.commits == 0


async def test_binding_status_recovery_requires_worker_auth_and_is_no_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _real_app(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/v1/cloud/workflows/runs/11111111-1111-4111-8111-111111111111/execution-binding"
        )
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("suffix", ["materialization-offer", "execution-binding"])
async def test_commit_failure_never_emits_a_success_or_credential(
    monkeypatch: pytest.MonkeyPatch,
    suffix: str,
) -> None:
    app, db = _app(monkeypatch, fail_commit=True)
    body, headers = _request_for(suffix)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/runs/11111111-1111-4111-8111-111111111111/{suffix}",
            json=body,
            headers=headers,
        )
    assert response.status_code == 503, response.text
    assert response.headers["cache-control"] == "no-store"
    assert "wfm1.test.only" not in response.text
    assert '"accepted":true' not in response.text
    assert db.commits == 1
    assert db.rollbacks == 1


async def test_real_offer_commit_failure_rolls_back_credential_and_emits_no_success(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    run_id = run.id
    claim_id = run.claim_id
    assert claim_id is not None
    await db_session.commit()
    failing = _CommitFailingSession(db_session)

    async def session() -> AsyncIterator[_CommitFailingSession]:
        yield failing

    monkeypatch.setattr(settings, "api_path_prefix", "")
    monkeypatch.setattr(settings, "workflows_enabled_override", True)
    app = create_app()
    app.dependency_overrides[get_async_session] = session
    app.dependency_overrides[authenticate_binding_actor] = lambda: actor
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/v1/cloud/workflows/runs/{run_id}/materialization-offer",
            json={"executorId": "desktop-1", "claimId": str(claim_id)},
        )

    assert response.status_code == 503, response.text
    assert response.headers["cache-control"] == "no-store"
    assert "materializationCredential" not in response.text
    assert "wfm1." not in response.text
    assert failing.commit_attempts == 1 and failing.rollback_attempts == 1
    offer_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowMaterializationOffer)
    )
    assert offer_count == 0


async def test_real_accept_commit_failure_rolls_back_binding_and_emits_no_success(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    offer = await issue_materialization_offer(
        db_session,
        actor,
        run_id=run.id,
        executor_id="desktop-1",
        claim_id=run.claim_id,
    )
    run_id = run.id
    await db_session.commit()
    failing = _CommitFailingSession(db_session)

    async def session() -> AsyncIterator[_CommitFailingSession]:
        yield failing

    monkeypatch.setattr(settings, "api_path_prefix", "")
    monkeypatch.setattr(settings, "workflows_enabled_override", True)
    app = create_app()
    app.dependency_overrides[get_async_session] = session
    app.dependency_overrides[authenticate_binding_actor] = lambda: actor
    raw_binding = _real_binding(executor_id="desktop-1")
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/v1/cloud/workflows/runs/{run_id}/execution-binding",
            json={
                "schemaVersion": 1,
                "executionGeneration": offer.execution_generation,
                "executorFence": offer.executor_fence,
                "binding": raw_binding,
            },
            headers={"X-Proliferate-Workflow-Materialization": offer.materialization_credential},
        )

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert '"accepted":true' not in response.text
    assert offer.materialization_credential not in response.text
    assert failing.commit_attempts == 1 and failing.rollback_attempts == 1
    stored_run = await db_session.get(WorkflowRun, run_id)
    assert stored_run is not None
    assert stored_run.binding_hash is None
    stored_offer = await db_session.scalar(
        select(WorkflowMaterializationOffer).where(
            WorkflowMaterializationOffer.workflow_run_id == run_id
        )
    )
    assert stored_offer is not None and stored_offer.status == "pending"


@pytest.mark.parametrize("suffix", ["materialization-offer", "execution-binding"])
async def test_binding_validation_errors_are_no_store(
    monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    app, _db = _app(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/runs/11111111-1111-4111-8111-111111111111/{suffix}", json={}
        )
    assert response.status_code == 422
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("suffix", ["materialization-offer", "execution-binding"])
async def test_binding_real_app_auth_401_is_no_store(
    monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    response = await _post_real(_real_app(monkeypatch), suffix)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("suffix", ["materialization-offer", "execution-binding"])
async def test_binding_real_app_auth_403_is_no_store(
    monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    app = _real_app(monkeypatch)

    async def forbidden() -> BindingActor:
        raise CloudApiError(
            "workflow_cloud_executor_forbidden",
            "Selected executor does not match.",
            status_code=403,
        )

    app.dependency_overrides[authenticate_binding_actor] = forbidden
    response = await _post_real(app, suffix)
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("suffix", ["materialization-offer", "execution-binding"])
async def test_binding_real_app_feature_404_is_no_store(
    monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    app = _real_app(monkeypatch)
    monkeypatch.setattr(settings, "workflows_enabled_override", False)
    response = await _post_real(app, suffix)
    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("suffix", ["materialization-offer", "execution-binding"])
@pytest.mark.parametrize("status_code", [409, 503])
async def test_binding_real_app_domain_errors_are_no_store(
    monkeypatch: pytest.MonkeyPatch,
    suffix: str,
    status_code: int,
) -> None:
    app = _real_app(monkeypatch)
    app.dependency_overrides[authenticate_binding_actor] = _binding_actor

    async def fail(*_args: object, **_kwargs: object) -> None:
        raise CloudApiError(
            "workflow_binding_test_failure",
            "Binding failed.",
            status_code=status_code,
        )

    monkeypatch.setattr(binding_api, "issue_materialization_offer", fail)
    monkeypatch.setattr(binding_api, "accept_execution_binding", fail)
    response = await _post_real(app, suffix)
    assert response.status_code == status_code
    assert response.headers["cache-control"] == "no-store"
