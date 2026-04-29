from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.billing import SandboxEventReceipt, UsageSegment
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.server.billing.models import utcnow
from tests.e2e.cloud.helpers.shared import (
    DEFAULT_GITHUB_BASE_BRANCH,
    DEFAULT_GITHUB_OWNER,
    DEFAULT_GITHUB_REPO,
    CloudE2ETestError,
    unique_branch_name,
)


def build_signed_e2b_webhook(
    *,
    event_id: str,
    event_type: str,
    sandbox_id: str,
    metadata: dict[str, str],
    timestamp: datetime | None = None,
) -> tuple[bytes, str]:
    payload = {
        "id": event_id,
        "type": event_type,
        "sandboxId": sandbox_id,
        "timestamp": (timestamp or utcnow()).astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "eventData": {"sandbox_metadata": metadata},
    }
    body = json.dumps(payload).encode("utf-8")
    secret = settings.e2b_webhook_signature_secret
    digest = hashlib.sha256(secret.encode("utf-8") + body).digest()
    signature = base64.b64encode(digest).decode("utf-8").rstrip("=")
    return body, signature


async def create_seeded_workspace_and_sandbox(
    db_session: AsyncSession,
    *,
    user_id: str,
    provider: str = "e2b",
    workspace_status: str = "ready",
    sandbox_status: str = "running",
    with_runtime_metadata: bool = True,
) -> tuple[CloudWorkspace, CloudSandbox]:
    runtime_token = "runtime-token" if with_runtime_metadata else None
    runtime_url = "https://example-runtime.invalid" if with_runtime_metadata else None
    anyharness_workspace_id = "workspace-123" if with_runtime_metadata else None

    from proliferate.utils.crypto import encrypt_text

    user_uuid = uuid.UUID(user_id)
    billing_subject = await ensure_personal_billing_subject(db_session, user_uuid)
    workspace = CloudWorkspace(
        user_id=user_uuid,
        billing_subject_id=billing_subject.id,
        created_by_user_id=user_uuid,
        display_name="proliferate-ai/proliferate",
        git_provider="github",
        git_owner=DEFAULT_GITHUB_OWNER,
        git_repo_name=DEFAULT_GITHUB_REPO,
        git_branch=unique_branch_name("webhook"),
        git_base_branch=DEFAULT_GITHUB_BASE_BRANCH,
        status=workspace_status,
        status_detail=workspace_status.title(),
        last_error=None,
        template_version="v1",
        runtime_generation=1 if with_runtime_metadata else 0,
        runtime_url=runtime_url,
        runtime_token_ciphertext=encrypt_text(runtime_token) if runtime_token else None,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    db_session.add(workspace)
    await db_session.commit()
    await db_session.refresh(workspace)

    sandbox = CloudSandbox(
        cloud_workspace_id=workspace.id,
        provider=provider,
        external_sandbox_id=f"{provider}-sandbox-{uuid.uuid4()}",
        status=sandbox_status,
        template_version="v1",
        started_at=utcnow(),
    )
    db_session.add(sandbox)
    await db_session.commit()
    await db_session.refresh(sandbox)

    workspace.active_sandbox_id = sandbox.id
    await db_session.commit()
    await db_session.refresh(workspace)
    return workspace, sandbox


async def usage_segment_count(
    db_session: AsyncSession,
    *,
    sandbox_id: uuid.UUID,
) -> int:
    return int(
        (
            await db_session.execute(
                select(func.count(UsageSegment.id)).where(UsageSegment.sandbox_id == sandbox_id)
            )
        ).scalar_one()
    )


async def event_receipt_count(
    db_session: AsyncSession,
    *,
    event_id: str,
) -> int:
    return int(
        (
            await db_session.execute(
                select(func.count(SandboxEventReceipt.id)).where(
                    SandboxEventReceipt.event_id == event_id
                )
            )
        ).scalar_one()
    )


async def sandbox_event_receipt_count(
    db_session: AsyncSession,
    *,
    provider: str,
    external_sandbox_id: str,
    event_type: str | None = None,
) -> int:
    query = select(func.count(SandboxEventReceipt.id)).where(
        SandboxEventReceipt.provider == provider,
        SandboxEventReceipt.external_sandbox_id == external_sandbox_id,
    )
    if event_type is not None:
        query = query.where(SandboxEventReceipt.event_type == event_type)
    return int((await db_session.execute(query)).scalar_one())


async def wait_for_sandbox_event_receipt(
    db_session: AsyncSession,
    *,
    provider: str,
    external_sandbox_id: str,
    event_type: str,
    minimum_count: int = 1,
    timeout_seconds: float = 90.0,
) -> int:
    import asyncio
    import time

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        count = await sandbox_event_receipt_count(
            db_session,
            provider=provider,
            external_sandbox_id=external_sandbox_id,
            event_type=event_type,
        )
        if count >= minimum_count:
            return count
        await asyncio.sleep(2.0)
    raise CloudE2ETestError(
        "Timed out waiting for sandbox event receipt "
        f"provider={provider} external_sandbox_id={external_sandbox_id} event_type={event_type}."
    )
