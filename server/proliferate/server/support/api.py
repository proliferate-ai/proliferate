from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.support.models import (
    SupportMessageRequest,
    SupportMessageResponse,
    SupportReportCompleteRequest,
    SupportReportCompleteResponse,
    SupportReportUploadRequest,
    SupportReportUploadResponse,
)
from proliferate.server.support.service import (
    complete_support_report_upload,
    create_support_report_upload,
    send_support_message,
)

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/messages", response_model=SupportMessageResponse)
async def send_support_message_endpoint(
    body: SupportMessageRequest,
    user: User = Depends(current_active_user),
) -> SupportMessageResponse:
    await send_support_message(
        sender_email=user.email,
        sender_display_name=user.display_name,
        message=body.message,
        context=body.context.model_dump(exclude_none=True) if body.context else None,
    )

    return SupportMessageResponse()


@router.post("/report-uploads", response_model=SupportReportUploadResponse)
async def create_support_report_upload_endpoint(
    body: SupportReportUploadRequest,
    user: User = Depends(current_active_user),
) -> SupportReportUploadResponse:
    return await create_support_report_upload(
        sender_email=user.email,
        sender_display_name=user.display_name,
        body=body,
    )


@router.post("/reports/{report_id}/complete", response_model=SupportReportCompleteResponse)
async def complete_support_report_upload_endpoint(
    report_id: str,
    body: SupportReportCompleteRequest,
    user: User = Depends(current_active_user),
) -> SupportReportCompleteResponse:
    return await complete_support_report_upload(
        sender_email=user.email,
        sender_display_name=user.display_name,
        report_id=report_id,
        body=body,
    )
