from __future__ import annotations

import json
import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.billing import UsageSegment
from proliferate.db.store.billing import open_usage_segment_for_sandbox
from proliferate.server.billing.models import utcnow
from tests.e2e.cloud.helpers import (
    CloudE2ETestError,
    build_signed_e2b_webhook,
    create_seeded_workspace_and_sandbox,
    create_user_and_login,
    delete_cloud_workspace_quietly,
    ensure_external_server,
    ensure_ngrok_http_endpoint,
    event_receipt_count,
    list_e2b_webhooks,
    list_ngrok_requests,
    load_active_sandbox_record,
    load_workspace_record,
    port_from_base_url,
    provision_workspace_with_credentials,
    provider_pause_native,
    provider_state,
    runtime_health_check,
    sandbox_event_receipt_count,
    usage_segment_count,
    wait_for_cloud_workspace_status,
    wait_for_sandbox_event_receipt,
)


@pytest.mark.asyncio
async def test_e2b_webhook_signature_rejected(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed the minimum local state needed for the webhook handler to resolve the
    # incoming sandbox id back to a workspace.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-signature")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
    )

    # Send a real webhook-shaped payload with an invalid signature and assert
    # the public receiver rejects it at the trust boundary.
    body, _ = build_signed_e2b_webhook(
        event_id=f"evt-{uuid.uuid4()}",
        event_type="sandbox.lifecycle.paused",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
    )
    response = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": "bad-signature"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_e2b_webhook_duplicate_ignored(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed a running workspace with an open usage segment so the first pause
    # event has meaningful state to update.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-duplicate")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
        workspace_status="ready",
        sandbox_status="running",
    )
    await open_usage_segment_for_sandbox(
        user_id=workspace.user_id,
        workspace_id=workspace.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=sandbox.external_sandbox_id,
        sandbox_execution_id=None,
        started_at=utcnow(),
        opened_by="test",
    )
    event_id = f"evt-{uuid.uuid4()}"
    body, signature = build_signed_e2b_webhook(
        event_id=event_id,
        event_type="sandbox.lifecycle.paused",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
    )

    # Deliver the same signed payload twice and prove the receipt store keeps
    # it idempotent.
    first = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    second = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert await event_receipt_count(db_session, event_id=event_id) == 1

    refreshed_workspace = await load_workspace_record(db_session, str(workspace.id))
    refreshed_sandbox = await load_active_sandbox_record(db_session, str(workspace.id))
    assert refreshed_workspace.status == "stopped"
    assert refreshed_sandbox.status == "paused"


@pytest.mark.asyncio
async def test_e2b_webhook_stale_event_ignored(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed a paused sandbox and mark the latest provider event so an older
    # webhook can be detected as stale.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-stale")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
        workspace_status="stopped",
        sandbox_status="paused",
    )
    sandbox.last_provider_event_at = utcnow()
    sandbox.last_provider_event_kind = "paused"
    await db_session.commit()

    stale_time = utcnow().replace(year=utcnow().year - 1)
    event_id = f"evt-{uuid.uuid4()}"
    body, signature = build_signed_e2b_webhook(
        event_id=event_id,
        event_type="sandbox.lifecycle.resumed",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
        timestamp=stale_time,
    )

    # A stale resume should still be recorded as received, but it must not
    # overwrite the newer paused state already persisted for the sandbox.
    response = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    assert response.status_code == 200
    assert await event_receipt_count(db_session, event_id=event_id) == 1

    refreshed_workspace = await load_workspace_record(db_session, str(workspace.id))
    refreshed_sandbox = await load_active_sandbox_record(db_session, str(workspace.id))
    assert refreshed_workspace.status == "stopped"
    assert refreshed_sandbox.status == "paused"


@pytest.mark.asyncio
async def test_e2b_webhook_created_updates_state(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed a provisioning workspace without runtime metadata so the created
    # event exercises the early lifecycle path.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-created")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
        workspace_status="provisioning",
        sandbox_status="provisioning",
        with_runtime_metadata=False,
    )
    body, signature = build_signed_e2b_webhook(
        event_id=f"evt-{uuid.uuid4()}",
        event_type="sandbox.lifecycle.created",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
    )

    # The created event should move the sandbox into running while leaving the
    # workspace in provisioning until the runtime handshake completes.
    response = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    assert response.status_code == 200
    refreshed_sandbox = await load_active_sandbox_record(db_session, str(workspace.id))
    refreshed_workspace = await load_workspace_record(db_session, str(workspace.id))
    assert refreshed_sandbox.status == "running"
    assert refreshed_workspace.status == "provisioning"
    assert await usage_segment_count(db_session, sandbox_id=sandbox.id) == 1


@pytest.mark.asyncio
async def test_e2b_webhook_resumed_updates_state(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed a stopped workspace whose sandbox is paused so the resume event has a
    # clean transition to apply.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-resumed")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
        workspace_status="stopped",
        sandbox_status="paused",
    )
    body, signature = build_signed_e2b_webhook(
        event_id=f"evt-{uuid.uuid4()}",
        event_type="sandbox.lifecycle.resumed",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
    )

    # Resume should reopen provider execution without claiming the workspace is
    # fully ready until the control plane reconnects the runtime.
    response = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    assert response.status_code == 200
    refreshed_sandbox = await load_active_sandbox_record(db_session, str(workspace.id))
    refreshed_workspace = await load_workspace_record(db_session, str(workspace.id))
    assert refreshed_sandbox.status == "running"
    assert refreshed_workspace.status == "stopped"
    assert await usage_segment_count(db_session, sandbox_id=sandbox.id) == 1


@pytest.mark.asyncio
async def test_e2b_webhook_paused_updates_state(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed a ready workspace with an open usage segment so pause has both
    # runtime and billing state to close out.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-paused")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
        workspace_status="ready",
        sandbox_status="running",
    )
    await open_usage_segment_for_sandbox(
        user_id=workspace.user_id,
        workspace_id=workspace.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=sandbox.external_sandbox_id,
        sandbox_execution_id=None,
        started_at=utcnow(),
        opened_by="test",
    )
    body, signature = build_signed_e2b_webhook(
        event_id=f"evt-{uuid.uuid4()}",
        event_type="sandbox.lifecycle.paused",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
    )

    # Pause should stop the workspace, pause the sandbox, and close the active
    # usage segment for that sandbox.
    response = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    assert response.status_code == 200
    refreshed_workspace = await load_workspace_record(db_session, str(workspace.id))
    refreshed_sandbox = await load_active_sandbox_record(db_session, str(workspace.id))
    assert refreshed_workspace.status == "stopped"
    assert refreshed_sandbox.status == "paused"

    segment = (
        await db_session.execute(select(UsageSegment).where(UsageSegment.sandbox_id == sandbox.id))
    ).scalar_one()
    assert segment.ended_at is not None


@pytest.mark.asyncio
async def test_e2b_webhook_killed_updates_state(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seed a ready workspace with runtime metadata so killed exercises the
    # teardown path that clears reconnect information.
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")
    auth = await create_user_and_login(client, db_session, email_prefix="webhook-killed")
    workspace, sandbox = await create_seeded_workspace_and_sandbox(
        db_session,
        user_id=auth.user_id,
        provider="e2b",
        workspace_status="ready",
        sandbox_status="running",
        with_runtime_metadata=True,
    )
    await open_usage_segment_for_sandbox(
        user_id=workspace.user_id,
        workspace_id=workspace.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=sandbox.external_sandbox_id,
        sandbox_execution_id=None,
        started_at=utcnow(),
        opened_by="test",
    )
    body, signature = build_signed_e2b_webhook(
        event_id=f"evt-{uuid.uuid4()}",
        event_type="sandbox.lifecycle.killed",
        sandbox_id=sandbox.external_sandbox_id or "",
        metadata={"cloud_sandbox_id": str(sandbox.id)},
    )

    # Kill should clear reconnect metadata and sever the workspace's link to the
    # destroyed sandbox record.
    response = await client.post(
        "/v1/cloud/webhooks/e2b",
        content=body,
        headers={"e2b-signature": signature},
    )
    assert response.status_code == 200
    refreshed_workspace = await load_workspace_record(db_session, str(workspace.id))
    refreshed_sandbox = await db_session.get(type(sandbox), sandbox.id)
    assert refreshed_sandbox is not None
    await db_session.refresh(refreshed_sandbox)
    assert refreshed_workspace.status == "stopped"
    assert refreshed_workspace.runtime_url is None
    assert refreshed_workspace.runtime_token_ciphertext is None
    assert refreshed_workspace.anyharness_workspace_id is None
    assert refreshed_workspace.active_sandbox_id is None
    assert refreshed_sandbox.status == "destroyed"


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.e2b
@pytest.mark.live_webhook
async def test_e2b_live_webhook_delivery_via_ngrok(
    db_session: AsyncSession,
    cloud_test_config,
) -> None:
    # The live smoke only runs when CI explicitly opts in and the required
    # provider + ingress secrets are present.
    if not cloud_test_config.run_live_e2b_webhook:
        pytest.skip("RUN_LIVE_E2B_WEBHOOK=1 is required for the live E2B webhook smoke.")
    if not cloud_test_config.e2b_webhook_signature_secret:
        pytest.skip("E2B_WEBHOOK_SIGNATURE_SECRET is required for live E2B webhook testing.")
    if not (cloud_test_config.anthropic_api_key or cloud_test_config.claude_auth_path):
        pytest.skip("Claude auth is not available locally.")

    configured_webhooks = await list_e2b_webhooks(cloud_test_config)
    matching_webhooks = [
        webhook
        for webhook in configured_webhooks
        if webhook.get("url") == cloud_test_config.e2b_webhook_public_url
    ]
    if not matching_webhooks:
        raise CloudE2ETestError(
            f"No enabled E2B webhook is configured for {cloud_test_config.e2b_webhook_public_url}."
        )
    webhook = matching_webhooks[0]
    assert webhook.get("enabled") is True
    assert "sandbox.lifecycle.paused" in (webhook.get("events") or [])
    print(
        f"[cloud-e2e] live webhook configured url={cloud_test_config.e2b_webhook_public_url}",
        flush=True,
    )

    async with (
        ensure_external_server(cloud_test_config, provider_kind="e2b") as server,
        ensure_ngrok_http_endpoint(
            cloud_test_config.e2b_webhook_public_url.replace(
                "/v1/cloud/webhooks/e2b",
                "",
            ),
            target_port=port_from_base_url(server.base_url),
        ),
        httpx.AsyncClient(base_url=server.base_url, timeout=60.0) as client,
    ):
        # Provision a real workspace through the external control plane so the
        # native provider pause has a real sandbox to operate on.
        print("[cloud-e2e] provisioning live webhook workspace", flush=True)
        handle = await provision_workspace_with_credentials(
            client,
            db_session,
            cloud_test_config,
            provider_kind="e2b",
            synced_providers=("claude",),
            email_prefix="live-webhook",
            branch_prefix="live-webhook",
        )
        try:
            print(
                f"[cloud-e2e] workspace ready workspace_id={handle.workspace['id']}",
                flush=True,
            )

            # Sanity-check the remote runtime before triggering the provider
            # event so the smoke proves real delivery from a healthy sandbox.
            payload = await runtime_health_check(handle.connection, provider_kind="e2b")
            assert payload["health"]["status"] == "ok"
            print("[cloud-e2e] runtime health check passed", flush=True)

            sandbox = await load_active_sandbox_record(db_session, handle.workspace["id"])
            assert sandbox.external_sandbox_id
            before_receipts = await sandbox_event_receipt_count(
                db_session,
                provider="e2b",
                external_sandbox_id=sandbox.external_sandbox_id,
                event_type="sandbox.lifecycle.paused",
            )

            # Trigger the external lifecycle event at the provider boundary, not
            # by posting a synthetic webhook to the local app.
            print(
                f"[cloud-e2e] pausing sandbox sandbox_id={sandbox.external_sandbox_id}",
                flush=True,
            )
            await provider_pause_native("e2b", sandbox.external_sandbox_id)
            try:
                await wait_for_sandbox_event_receipt(
                    db_session,
                    provider="e2b",
                    external_sandbox_id=sandbox.external_sandbox_id,
                    event_type="sandbox.lifecycle.paused",
                    minimum_count=before_receipts + 1,
                    timeout_seconds=90.0,
                )
            except CloudE2ETestError as exc:
                request_summaries: list[dict[str, object]] = []
                for request in await list_ngrok_requests(
                    cloud_test_config.e2b_webhook_public_url.replace(
                        "/v1/cloud/webhooks/e2b",
                        "",
                    ),
                    path_contains="/v1/cloud/webhooks/e2b",
                ):
                    request_payload = request.get("request")
                    response_payload = request.get("response")
                    request_summaries.append(
                        {
                            "uri": (
                                request_payload.get("uri")
                                if isinstance(request_payload, dict)
                                else None
                            ),
                            "status_code": (
                                response_payload.get("status_code")
                                if isinstance(response_payload, dict)
                                else None
                            ),
                        }
                    )
                provider_snapshot = await provider_state(
                    "e2b",
                    sandbox.external_sandbox_id,
                )
                raise CloudE2ETestError(
                    "Live E2B webhook was not recorded locally after native pause. "
                    f"provider_state={provider_snapshot} "
                    f"ngrok_requests={json.dumps(request_summaries)}"
                ) from exc
            print("[cloud-e2e] paused webhook receipt observed locally", flush=True)

            # The end condition is a control-plane state transition driven by
            # the real webhook delivery, not just by provider observation.
            stopped = await wait_for_cloud_workspace_status(
                client,
                handle.auth,
                handle.workspace["id"],
                target_status="stopped",
                timeout_seconds=180.0,
            )
            assert stopped["status"] == "stopped"
            print("[cloud-e2e] workspace transitioned to stopped", flush=True)
        finally:
            # Always clean up the live sandbox to avoid leaving provider
            # resources behind if the webhook delivery check fails.
            try:
                await delete_cloud_workspace_quietly(
                    client,
                    handle.auth,
                    handle.workspace["id"],
                    db_session=db_session,
                )
            except Exception as exc:
                raise CloudE2ETestError(
                    f"Failed to clean up live webhook workspace {handle.workspace['id']}"
                ) from exc
