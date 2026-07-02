"""Agent gateway auth services: key pool, route selections, capabilities.

Store legality errors surface as typed :class:`CloudApiError` values so the
API layer maps them uniformly. Key create/revoke and selection changes emit
structured audit log events (the Bifrost-era audit table was dropped; the
cloud event log is the post-teardown audit surface).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_PROVIDERS,
    AGENT_AUTH_SLOT_PRIMARY,
    AGENT_AUTH_SURFACE_CLOUD,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthRouteSelectionRecord,
    AgentGatewayEnrollmentRecord,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.materialization.materialize.agent_auth import (
    build_agent_auth_state,
)

_ENROLLMENT_STATUS_NONE = "none"
_MAX_DISPLAY_NAME_LENGTH = 255
_MAX_SECRET_LENGTH = 4096


async def list_api_keys(db: AsyncSession, *, user_id: UUID) -> list[AgentApiKeyRecord]:
    return await agent_gateway_store.list_agent_api_keys(db, user_id=user_id)


async def create_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    provider: str,
    display_name: str,
    secret: str,
) -> AgentApiKeyRecord:
    if provider not in AGENT_API_KEY_PROVIDERS:
        raise CloudApiError(
            "invalid_agent_api_key_provider",
            f"Provider must be one of: {', '.join(AGENT_API_KEY_PROVIDERS)}.",
            status_code=400,
        )
    display_name = display_name.strip()
    if not display_name or len(display_name) > _MAX_DISPLAY_NAME_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_display_name",
            f"Display name must be 1-{_MAX_DISPLAY_NAME_LENGTH} characters.",
            status_code=400,
        )
    secret = secret.strip()
    if not secret or len(secret) > _MAX_SECRET_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_secret",
            "The key secret must be a non-empty string.",
            status_code=400,
        )
    record = await agent_gateway_store.create_agent_api_key(
        db,
        user_id=user_id,
        provider=provider,
        display_name=display_name,
        payload=secret,
    )
    log_cloud_event(
        "agent_api_key_created",
        user_id=str(user_id),
        api_key_id=str(record.id),
        provider=record.provider,
    )
    return record


async def revoke_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> AgentApiKeyRecord:
    record = await agent_gateway_store.revoke_agent_api_key(
        db,
        user_id=user_id,
        api_key_id=api_key_id,
    )
    if record is None:
        raise CloudApiError(
            "agent_api_key_not_found",
            "Agent API key not found.",
            status_code=404,
        )
    log_cloud_event(
        "agent_api_key_revoked",
        user_id=str(user_id),
        api_key_id=str(record.id),
        provider=record.provider,
    )
    # A revoked key may back a cloud api_key selection; the next pass strips it.
    await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)
    return record


async def list_route_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[AgentAuthRouteSelectionRecord]:
    return await agent_gateway_store.list_route_selections(db, user_id=user_id)


async def upsert_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
    api_key_id: UUID | None,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
) -> AgentAuthRouteSelectionRecord:
    try:
        agent_gateway_store.validate_route_selection(
            harness_kind=harness_kind,
            surface=surface,
            route=route,
            api_key_id=api_key_id,
            slot=slot,
        )
    except ValueError as error:
        raise CloudApiError(
            "invalid_agent_route_selection",
            str(error),
            status_code=400,
        ) from error
    try:
        record = await agent_gateway_store.upsert_route_selection(
            db,
            user_id=user_id,
            harness_kind=harness_kind,
            surface=surface,
            route=route,
            api_key_id=api_key_id,
            slot=slot,
        )
    except agent_gateway_store.AgentApiKeyNotUsableError as error:
        raise CloudApiError(
            "agent_api_key_not_found",
            "api_key_id must reference an active key owned by the caller.",
            status_code=404,
        ) from error
    except ValueError as error:
        # Pure legality already passed; the remaining failure mode is an
        # opencode provider slot fed a key of another provider.
        raise CloudApiError(
            "invalid_agent_route_selection",
            str(error),
            status_code=400,
        ) from error
    log_cloud_event(
        "agent_route_selection_upserted",
        user_id=str(user_id),
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
        route=route,
        api_key_id=str(api_key_id) if api_key_id is not None else None,
        revision=record.revision,
    )
    if surface == AGENT_AUTH_SURFACE_CLOUD:
        await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)
    return record


async def clear_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
) -> None:
    deleted = await agent_gateway_store.delete_route_selection(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
    )
    if not deleted:
        raise CloudApiError(
            "agent_route_selection_not_found",
            "No route selection exists for this harness, surface, and slot.",
            status_code=404,
        )
    log_cloud_event(
        "agent_route_selection_cleared",
        user_id=str(user_id),
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
    )
    if surface == AGENT_AUTH_SURFACE_CLOUD:
        await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)


async def get_capabilities(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[bool, str | None, str]:
    """Return (gateway_enabled, public_base_url, enrollment_status)."""
    enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
    return (
        settings.agent_gateway_enabled,
        settings.agent_gateway_litellm_public_base_url or None,
        enrollment.sync_status if enrollment is not None else _ENROLLMENT_STATUS_NONE,
    )


async def get_auth_state(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> dict[str, object] | None:
    """Render the user's state.json document for one surface.

    Same render path as the cloud materializer; ``None`` means the user has no
    selections for the surface at all (legacy/native fall-through).
    """
    state, _ = await build_agent_auth_state(db, user_id, surface=surface)
    return state


async def get_enrollment(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
    if enrollment is None:
        raise CloudApiError(
            "agent_gateway_enrollment_not_found",
            "No agent gateway enrollment exists for this user.",
            status_code=404,
        )
    return enrollment
