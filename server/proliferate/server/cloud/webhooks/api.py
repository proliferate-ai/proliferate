from __future__ import annotations

from fastapi import APIRouter, Header, Request

from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.webhooks.models import E2BWebhookReceipt
from proliferate.server.cloud.webhooks.service import handle_e2b_webhook

router = APIRouter(prefix="/webhooks", tags=["cloud_webhooks"])


@router.post("/e2b", response_model=E2BWebhookReceipt)
async def e2b_webhook_endpoint(
    request: Request,
    e2b_signature: str | None = Header(default=None, alias="e2b-signature"),
) -> E2BWebhookReceipt:
    try:
        return await handle_e2b_webhook(
            payload=await request.body(),
            signature=e2b_signature,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
