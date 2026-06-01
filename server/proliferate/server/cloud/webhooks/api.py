from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
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
