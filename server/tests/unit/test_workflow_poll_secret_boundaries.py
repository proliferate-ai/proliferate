"""Secret-boundary and credential-reflection tests for workflow polling."""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy import select

from proliferate.db.models.cloud.workflows import (
    WorkflowRun,
    WorkflowTrigger,
    WorkflowTriggerItem,
)
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.poller import _poll_one_trigger
from proliferate.utils.time import utcnow
from tests.unit import test_workflow_poll as base

_Actor = base._Actor
_CountingAsyncByteStream = base._CountingAsyncByteStream
_factory = base._factory
_fake_getaddrinfo = base._fake_getaddrinfo
_item = base._item
_make_poll_trigger = base._make_poll_trigger
_make_ready_cloud_workspace = base._make_ready_cloud_workspace
_make_user = base._make_user
_make_workflow = base._make_workflow
_mock_client_factory = base._mock_client_factory
_page = base._page
_poll_body = base._poll_body
_service_create = base._service_create
poller_module = base.poller_module


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch):  # type: ignore[no-untyped-def]
    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _fake_getaddrinfo)


@pytest.mark.parametrize("surface", ["inspect", "create", "update"])
async def test_real_http_422_redacts_poll_auth_value(
    surface: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from fastapi import FastAPI
    from fastapi.exceptions import RequestValidationError

    from proliferate.auth.dependencies import current_product_user
    from proliferate.db.engine import get_async_session
    from proliferate.main import _validation_error_handler
    from proliferate.server.cloud.workflows.access import require_workflows_enabled
    from proliferate.server.cloud.workflows.api import router

    canary = f"CANARY-422-POLL-AUTH-{surface}"
    poll = {
        "url": "https://issues.example/feed",
        "authHeader": "Authorization",
        "authValue": canary,
        # intervalSecs deliberately absent so Pydantic's error input contains
        # this entire secret-bearing poll object.
    }
    workflow_id = "11111111-1111-4111-8111-111111111111"
    trigger_id = "22222222-2222-4222-8222-222222222222"
    if surface == "inspect":
        path = "/workflows/poll/inspect"
        body = {"authHeader": "Authorization", "authValue": canary}  # missing URL
    elif surface == "create":
        path = f"/workflows/{workflow_id}/triggers"
        body = {
            "kind": "poll",
            "concurrencyPolicy": "queue",
            "targetMode": "personal_cloud",
            "repoFullName": "acme/widgets",
            "poll": poll,
        }
    else:
        path = f"/workflows/{workflow_id}/triggers/{trigger_id}"
        body = {"poll": poll}

    async def dependency_stub():  # type: ignore[no-untyped-def]
        return object()

    app = FastAPI()
    app.include_router(router)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)  # type: ignore[arg-type]
    app.dependency_overrides[require_workflows_enabled] = dependency_stub
    app.dependency_overrides[current_product_user] = dependency_stub
    app.dependency_overrides[get_async_session] = dependency_stub
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.request(
            "PATCH" if surface == "update" else "POST",
            path,
            json=body,
        )

    assert response.status_code == 422
    assert canary not in response.text
    assert "[redacted]" in response.text
    assert canary not in caplog.text


@pytest.mark.parametrize(
    "surface",
    ["id", "kind", "occurred_at", "data_value", "data_key", "cursor_payload"],
)
@pytest.mark.parametrize("embedded", [False, True])
async def test_runtime_rejects_valid_page_credential_reflection_before_effects(
    test_engine,
    caplog: pytest.LogCaptureFixture,
    surface: str,
    embedded: bool,
) -> None:  # type: ignore[no-untyped-def]
    from proliferate.utils.crypto import encrypt_text

    if surface == "occurred_at":
        # Exact case: the Bearer payload itself is RFC3339. Embedded case: the
        # deliberately short payload occurs inside an otherwise valid timestamp.
        token = "T" if embedded else "2026-07-11T00:00:00Z"
    else:
        token = f"CANARY-VALID-PAGE-{surface}"
    auth_value = f"Bearer {token}"
    item: dict[str, object] = {
        "id": "safe-item",
        "kind": "safe.kind",
        "occurred_at": "2026-07-11T00:00:00Z",
        "data": {"n": 1, "title": "safe"},
    }
    cursor = "next-safe"
    reflected_value = f"prefix::{auth_value}::suffix" if embedded else auth_value
    reflected_payload = f"prefix::{token}::suffix" if embedded else token
    if surface == "id":
        item["id"] = reflected_value
    elif surface == "kind":
        item["kind"] = reflected_value
    elif surface == "occurred_at":
        item["occurred_at"] = "2026-07-11T00:00:00Z" if embedded else token
    elif surface == "data_value":
        item["data"] = {"n": 1, "title": reflected_value}
    elif surface == "data_key":
        item["data"] = {"n": 1, "title": "safe", reflected_value: "reflected-as-key"}
    else:
        # A common service reflects only the token after "Bearer ".
        cursor = reflected_payload
    page_body = {"items": [item], "cursor": cursor, "has_more": False}
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == auth_value
        return httpx.Response(
            200,
            stream=_CountingAsyncByteStream(json.dumps(page_body).encode(), 1),
        )

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user, cursor="before-reflection")
        trigger.poll_auth_header = "Authorization"
        trigger.poll_auth_ciphertext = encrypt_text(auth_value)
        await db.flush()
        trigger_id = trigger.id
        await db.commit()

    with patch.object(
        httpx,
        "AsyncClient",
        _mock_client_factory(httpx.MockTransport(handler)),
    ):
        spawned = await _poll_one_trigger(
            factory,
            trigger_id=trigger_id,
            now=utcnow(),
            policy=net_guard.LOOPBACK_TEST,
        )
    assert spawned == 0
    assert len(requests) == 1

    async with factory() as db:
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed is not None
        assert refreshed.poll_cursor == "before-reflection"
        assert "credential-bearing" in (refreshed.last_poll_error or "")
        assert token not in (refreshed.last_poll_error or "")
        items = (
            (
                await db.execute(
                    select(WorkflowTriggerItem).where(WorkflowTriggerItem.trigger_id == trigger_id)
                )
            )
            .scalars()
            .all()
        )
        runs = (
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )
        assert items == []
        assert runs == []
    assert token not in caplog.text


async def test_update_reusing_stored_secret_rejects_valid_id_reflection(
    test_engine,
    caplog: pytest.LogCaptureFixture,
) -> None:  # type: ignore[no-untyped-def]
    from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
    from proliferate.server.cloud.workflows.triggers import update_trigger

    token = "CANARY-STORED-SECRET-REFLECTION"
    auth_value = f"Bearer {token}"
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)
        good_page = _page([_item("probe-ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            trigger = await _service_create(
                db,
                actor,
                wf.id,
                _poll_body(
                    poll={
                        "authHeader": "Authorization",
                        "authValue": auth_value,
                    }
                ),
            )

        reflected_page = {
            "items": [
                {
                    "id": f"prefix::{auth_value}::suffix",
                    "data": {"n": 1, "title": "ok"},
                }
            ],
            "cursor": "safe",
            "has_more": False,
        }
        transport = httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                stream=_CountingAsyncByteStream(json.dumps(reflected_page).encode(), 1),
            )
        )
        update = WorkflowTriggerUpdateRequest.model_validate(
            {
                "poll": {
                    "url": "https://issues.example/poll",
                    "intervalSecs": 60,
                    "authHeader": "Authorization",
                    # authValue omitted: reuse and decrypt the stored secret.
                }
            }
        )
        with (
            patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
            pytest.raises(CloudApiError) as raised,
        ):
            await update_trigger(db, actor, wf.id, trigger.id, update)

    error = raised.value
    assert error.code == "poll_probe_failed"
    assert "credential-bearing" in error.message
    assert token not in error.message
    assert token not in repr(error.extra_detail)
    assert error.__cause__ is None
    assert error.__context__ is None
    assert token not in caplog.text

    from proliferate.main import _proliferate_error_handler

    response = await _proliferate_error_handler(None, error)  # type: ignore[arg-type]
    assert token not in response.body.decode()


async def test_update_corrupt_stored_secret_is_typed_and_has_no_chain(
    test_engine,
    caplog: pytest.LogCaptureFixture,
) -> None:  # type: ignore[no-untyped-def]
    from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
    from proliferate.server.cloud.workflows.triggers import update_trigger

    canary = "CANARY-DECRYPT-DETAIL"
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)
        good_page = _page([_item("probe-ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            trigger = await _service_create(
                db,
                actor,
                wf.id,
                _poll_body(
                    poll={
                        "authHeader": "Authorization",
                        "authValue": "Bearer stored-secret",
                    }
                ),
            )

        update = WorkflowTriggerUpdateRequest.model_validate(
            {
                "poll": {
                    "url": "https://issues.example/poll",
                    "intervalSecs": 60,
                    "authHeader": "Authorization",
                }
            }
        )
        sentinel = AsyncMock(side_effect=AssertionError("network must not run"))
        with (
            patch(
                "proliferate.server.cloud.workflows.poll_fetch.decrypt_text",
                side_effect=ValueError(canary),
            ),
            patch.object(poller_module, "fetch_poll_page", new=sentinel),
            pytest.raises(CloudApiError) as raised,
        ):
            await update_trigger(db, actor, wf.id, trigger.id, update)

    error = raised.value
    assert error.code == "poll_probe_failed"
    assert "pre-send" not in error.message.lower()
    assert "could not be resolved" in error.message.lower()
    assert canary not in error.message
    assert error.__cause__ is None
    assert error.__context__ is None
    assert sentinel.await_count == 0
    assert canary not in caplog.text

    from proliferate.main import _proliferate_error_handler

    response = await _proliferate_error_handler(None, error)  # type: ignore[arg-type]
    assert canary not in response.body.decode()


async def test_runtime_missing_items_page_has_zero_effects(test_engine) -> None:  # type: ignore[no-untyped-def]
    """The frozen page contract requires ``items`` even for an empty page."""

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user, cursor="before-invalid-page")
        trigger_id = trigger.id
        await db.commit()

    body = json.dumps({"cursor": "after-invalid-page", "has_more": False}).encode()
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            stream=_CountingAsyncByteStream(body, 1),
        )
    )
    with patch.object(httpx, "AsyncClient", _mock_client_factory(transport)):
        spawned = await _poll_one_trigger(
            factory,
            trigger_id=trigger_id,
            now=utcnow(),
            policy=net_guard.LOOPBACK_TEST,
        )
    assert spawned == 0

    async with factory() as db:
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed is not None
        assert refreshed.poll_cursor == "before-invalid-page"
        assert "not a valid page" in (refreshed.last_poll_error or "")
        items = (
            (
                await db.execute(
                    select(WorkflowTriggerItem).where(WorkflowTriggerItem.trigger_id == trigger_id)
                )
            )
            .scalars()
            .all()
        )
        runs = (
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )
        assert items == []
        assert runs == []


def test_poll_secret_carriers_have_redacted_reprs() -> None:
    import pydantic

    from proliferate.db.store.cloud_workflow_triggers import DuePollTrigger
    from proliferate.integrations.workflow_poll import PollAuthBinding
    from proliferate.server.cloud.workflows.models import PollInspectRequest, TriggerPollRequest
    from proliferate.server.cloud.workflows.triggers import _validate_poll_config

    canary = "CANARY-REPR-SECRET"
    trigger_request = TriggerPollRequest.model_validate(
        {
            "url": "https://issues.example/feed",
            "intervalSecs": 60,
            "authHeader": "Authorization",
            "authValue": canary,
        }
    )
    inspect_request = PollInspectRequest.model_validate(
        {
            "url": "https://issues.example/feed",
            "authHeader": "Authorization",
            "authValue": canary,
        }
    )
    config = _validate_poll_config(trigger_request, is_update=False)
    binding = PollAuthBinding("Authorization", canary)
    due = DuePollTrigger(
        id=uuid.uuid4(),
        workflow_id=uuid.uuid4(),
        workflow_owner_user_id=uuid.uuid4(),
        workflow_organization_id=None,
        workflow_archived=False,
        target_mode="local",
        target_workspace_id=None,
        poll_url="https://issues.example/feed",
        poll_auth_header="Authorization",
        poll_auth_ciphertext=canary,
        poll_interval_secs=60,
        poll_item_schema_json={},
        poll_cursor=None,
        args_json={},
    )
    for carrier in (trigger_request, inspect_request, config, binding, due):
        assert canary not in repr(carrier)

    with pytest.raises(pydantic.ValidationError) as raised:
        TriggerPollRequest.model_validate(
            {
                "url": "https://issues.example/feed",
                "authHeader": "Authorization",
                "authValue": canary,
                # intervalSecs omitted
            }
        )
    assert canary not in repr(raised.value)


async def test_propagated_schema_error_has_no_request_body_or_credential_locals() -> None:
    from proliferate.integrations.workflow_poll import PollAuthBinding, PollPageSchemaError
    from proliferate.server.cloud.workflows.poll_fetch import fetch_poll_page

    credential_canary = "CANARY-TRACE-CREDENTIAL"
    body_canary = "CANARY-TRACE-RESPONSE-BODY"
    request = httpx.Request(
        "GET",
        "https://203.0.113.10/feed",
        headers={"Authorization": credential_canary},
    )
    raw_vendor_error = httpx.HTTPStatusError(
        body_canary,
        request=request,
        response=httpx.Response(500, request=request, text=body_canary),
    )
    # Prove the raw object really is unsafe before exercising the repaired path.
    assert raw_vendor_error.request.headers["authorization"] == credential_canary
    assert body_canary in str(raw_vendor_error)

    invalid_body = f'{{"items":{body_canary!r}}}'.encode()
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            stream=_CountingAsyncByteStream(invalid_body, 1),
        )
    )
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollPageSchemaError) as raised,
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            endpoint=endpoint,
            auth=PollAuthBinding("Authorization", credential_canary),
            cursor=None,
        )

    error = raised.value
    assert error.__cause__ is None
    assert error.__context__ is None
    assert credential_canary not in str(error)
    assert body_canary not in str(error)
    traceback_surface: list[str] = []
    cursor = error.__traceback__
    while cursor is not None:
        filename = cursor.tb_frame.f_code.co_filename
        if "/server/proliferate/" in filename:
            traceback_surface.append(repr(cursor.tb_frame.f_locals))
        cursor = cursor.tb_next
    rendered = "\n".join(traceback_surface)
    assert credential_canary not in rendered
    assert body_canary not in rendered
    assert "httpx.Request" not in rendered


async def test_propagated_upstream_error_has_no_httpx_request_or_auth_local() -> None:
    from proliferate.integrations.workflow_poll import PollAuthBinding, PollUpstreamStatusError
    from proliferate.server.cloud.workflows.poll_fetch import fetch_poll_page

    canary = "CANARY-UPSTREAM-REQUEST-CREDENTIAL"
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            503,
            request=request,
            stream=_CountingAsyncByteStream(b"upstream-controlled", 1),
        )
    )
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollUpstreamStatusError) as raised,
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            endpoint=endpoint,
            auth=PollAuthBinding("Authorization", canary),
            cursor=None,
        )

    error = raised.value
    assert error.status_code == 503
    assert error.__cause__ is None
    assert error.__context__ is None
    traceback_surface: list[str] = []
    cursor = error.__traceback__
    while cursor is not None:
        filename = cursor.tb_frame.f_code.co_filename
        if "/server/proliferate/" in filename:
            traceback_surface.append(repr(cursor.tb_frame.f_locals))
        cursor = cursor.tb_next
    rendered = "\n".join(traceback_surface)
    assert canary not in rendered
    assert "httpx.Request" not in rendered
