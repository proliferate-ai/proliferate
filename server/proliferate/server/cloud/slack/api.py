"""Cloud Slack bot API routes."""

from __future__ import annotations

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack.models import (
    SlackBotConfigEnvelopeResponse,
    SlackBotConfigUpdateRequest,
    SlackChannelResponse,
    SlackChannelsResponse,
    SlackRepoRoutingProfilesResponse,
    SlackRepoRoutingProfileUpsertRequest,
    SlackValidateConnectionResponse,
    bot_config_payload,
    connection_payload,
    repo_routing_profile_payload,
)
from proliferate.server.cloud.slack.service import (
    complete_oauth_install,
    disconnect,
    get_bot_config_envelope,
    ingest_slack_event,
    list_channels,
    list_repo_routing_profiles,
    process_due_outbound_messages,
    start_oauth_install,
    update_bot_config,
    upsert_repo_routing_profile,
    validate_connection,
)
from proliferate.server.cloud.slack.signature import verify_slack_signature

router = APIRouter(prefix="/slack", tags=["cloud-slack"])


@router.get("/oauth/start")
async def start_slack_oauth_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RedirectResponse:
    url = await start_oauth_install(db, user, organization_id=organization_id)
    return RedirectResponse(url, status_code=302)


@router.get("/oauth/callback")
async def slack_oauth_callback_endpoint(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    if error or not code or not state:
        return RedirectResponse(_settings_redirect(error="slack_oauth_failed"), status_code=302)
    try:
        organization_id = await complete_oauth_install(db, code=code, state=state)
    except CloudApiError as exc:
        return RedirectResponse(_settings_redirect(error=exc.code), status_code=302)
    return RedirectResponse(_settings_redirect(organization_id=organization_id), status_code=302)


@router.post("/disconnect", response_model=SlackBotConfigEnvelopeResponse)
async def disconnect_slack_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackBotConfigEnvelopeResponse:
    await disconnect(db, user, organization_id=organization_id)
    connection, config = await get_bot_config_envelope(db, user, organization_id=organization_id)
    return SlackBotConfigEnvelopeResponse(
        connection=connection_payload(connection),
        config=bot_config_payload(config),
    )


@router.get("/bot-config", response_model=SlackBotConfigEnvelopeResponse)
async def get_slack_bot_config_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackBotConfigEnvelopeResponse:
    connection, config = await get_bot_config_envelope(db, user, organization_id=organization_id)
    return SlackBotConfigEnvelopeResponse(
        connection=connection_payload(connection),
        config=bot_config_payload(config),
    )


@router.patch("/bot-config", response_model=SlackBotConfigEnvelopeResponse)
async def update_slack_bot_config_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    body: SlackBotConfigUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackBotConfigEnvelopeResponse:
    await update_bot_config(db, user, organization_id=organization_id, body=body)
    connection, config = await get_bot_config_envelope(db, user, organization_id=organization_id)
    return SlackBotConfigEnvelopeResponse(
        connection=connection_payload(connection),
        config=bot_config_payload(config),
    )


@router.post("/bot-config/validate-connection", response_model=SlackValidateConnectionResponse)
async def validate_slack_connection_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackValidateConnectionResponse:
    ok, status, team_name, error_code = await validate_connection(
        db,
        user,
        organization_id=organization_id,
    )
    return SlackValidateConnectionResponse(
        ok=ok,
        status=status,
        team_name=team_name,
        error_code=error_code,
    )


@router.get("/channels", response_model=SlackChannelsResponse)
async def list_slack_channels_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackChannelsResponse:
    channels = await list_channels(db, user, organization_id=organization_id)
    return SlackChannelsResponse(
        channels=[
            SlackChannelResponse(
                id=channel.id,
                name=channel.name,
                is_private=channel.is_private,
                is_archived=channel.is_archived,
            )
            for channel in channels
        ],
    )


@router.get("/repo-routing-profiles", response_model=SlackRepoRoutingProfilesResponse)
async def list_slack_repo_routing_profiles_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackRepoRoutingProfilesResponse:
    profiles = await list_repo_routing_profiles(db, user, organization_id=organization_id)
    return SlackRepoRoutingProfilesResponse(
        profiles=[repo_routing_profile_payload(profile) for profile in profiles],
    )


@router.put("/repo-routing-profiles", response_model=SlackRepoRoutingProfilesResponse)
async def upsert_slack_repo_routing_profile_endpoint(
    organization_id: Annotated[UUID, Query(alias="organizationId")],
    body: SlackRepoRoutingProfileUpsertRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackRepoRoutingProfilesResponse:
    await upsert_repo_routing_profile(
        db,
        user,
        organization_id=organization_id,
        cloud_repo_config_id=body.cloud_repo_config_id,
        display_name=body.display_name,
        description=body.description,
    )
    profiles = await list_repo_routing_profiles(db, user, organization_id=organization_id)
    return SlackRepoRoutingProfilesResponse(
        profiles=[repo_routing_profile_payload(profile) for profile in profiles],
    )


@router.post("/events")
async def slack_events_endpoint(
    request: Request,
    background_tasks: BackgroundTasks,
    x_slack_request_timestamp: Annotated[str | None, Header()] = None,
    x_slack_signature: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_async_session),
) -> dict[str, object]:
    body = await request.body()
    verify_slack_signature(
        signing_secret=settings.slack_signing_secret,
        body=body,
        timestamp_header=x_slack_request_timestamp,
        signature_header=x_slack_signature,
    )
    try:
        payload = json.loads(body.decode("utf-8"))
    except ValueError as exc:
        raise CloudApiError(
            "slack_payload_invalid",
            "Slack payload is invalid.",
            status_code=400,
        ) from exc
    if not isinstance(payload, dict):
        raise CloudApiError("slack_payload_invalid", "Slack payload is invalid.", status_code=400)
    result = await ingest_slack_event(db, payload=payload, background_tasks=background_tasks)
    background_tasks.add_task(process_due_outbound_messages)
    return result


def _settings_redirect(
    *,
    organization_id: UUID | None = None,
    error: str | None = None,
) -> str:
    base = settings.frontend_base_url.strip().rstrip("/") or "proliferate://settings"
    if base.startswith("proliferate://"):
        url = "proliferate://settings/slack-bot"
    else:
        url = f"{base}/settings/slack-bot"
    params: list[str] = []
    if organization_id:
        params.append(f"organizationId={organization_id}")
    if error:
        params.append(f"error={error}")
    return url + (("?" + "&".join(params)) if params else "")
