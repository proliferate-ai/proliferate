from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.github_app.webhooks import handle_github_app_webhook
from proliferate.server.cloud.webhooks.models import E2BWebhookReceipt
from proliferate.server.cloud.webhooks.service import handle_e2b_webhook

router = APIRouter(prefix="/webhooks", tags=["cloud_webhooks"])


@router.post("/e2b", response_model=E2BWebhookReceipt)
async def e2b_webhook_endpoint(
    request: Request,
    e2b_signature: str | None = Header(default=None, alias="e2b-signature"),
    db: AsyncSession = Depends(get_async_session),
) -> E2BWebhookReceipt:
    return await handle_e2b_webhook(
        db,
        payload=await request.body(),
        signature=e2b_signature,
    )


@router.post("/github-app", status_code=204)
async def github_app_webhook_endpoint(
    request: Request,
    x_github_event: str | None = Header(default=None, alias="x-github-event"),
    x_hub_signature_256: str | None = Header(default=None, alias="x-hub-signature-256"),
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    try:
        await handle_github_app_webhook(
            db,
            payload=await request.body(),
            event=x_github_event,
            signature=x_hub_signature_256,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return Response(status_code=204)
