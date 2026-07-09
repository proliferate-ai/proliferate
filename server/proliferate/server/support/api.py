from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.support.jobs import schedule_cloud_diagnostics_after_commit
from proliferate.server.support.models import (
    SupportMessageRequest,
    SupportMessageResponse,
    SupportReportCompleteRequest,
    SupportReportCompleteResponse,
    SupportReportCreateRequest,
    SupportReportCreateResponse,
    SupportReportUploadRequest,
    SupportReportUploadResponse,
    SupportReportUploadTargetsRequest,
)
from proliferate.server.support.service import (
    complete_support_report_upload,
    create_support_message_report,
    create_support_report,
    create_support_report_upload,
    create_support_report_upload_targets,
)

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/messages", response_model=SupportMessageResponse)
async def send_support_message_endpoint(
    body: SupportMessageRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SupportMessageResponse:
    return await create_support_message_report(
        db=db,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=user.display_name,
        body=body,
    )


@router.post("/report-uploads", response_model=SupportReportUploadResponse)
async def create_support_report_upload_endpoint(
    body: SupportReportUploadRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SupportReportUploadResponse:
    return await create_support_report_upload(
        db=db,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=user.display_name,
        body=body,
    )


@router.post("/reports", response_model=SupportReportCreateResponse)
async def create_support_report_endpoint(
    body: SupportReportCreateRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SupportReportCreateResponse:
    response = await create_support_report(
        db=db,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=user.display_name,
        body=body,
    )
    if response.cloud_diagnostics_status == "pending":
        await schedule_cloud_diagnostics_after_commit(db, response.report_id)
    return response


@router.post("/reports/{report_id}/upload-targets", response_model=SupportReportUploadResponse)
async def create_support_report_upload_targets_endpoint(
    report_id: str,
    body: SupportReportUploadTargetsRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SupportReportUploadResponse:
    return await create_support_report_upload_targets(
        db=db,
        sender_user_id=user.id,
        report_id=report_id,
        body=body,
    )


@router.post("/reports/{report_id}/complete", response_model=SupportReportCompleteResponse)
async def complete_support_report_upload_endpoint(
    report_id: str,
    body: SupportReportCompleteRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SupportReportCompleteResponse:
    return await complete_support_report_upload(
        db=db,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=user.display_name,
        report_id=report_id,
        body=body,
    )
