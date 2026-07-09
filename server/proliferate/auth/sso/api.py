"""Public SSO auth routes."""

from __future__ import annotations

from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import optional_current_active_user
from proliferate.auth.identity.service import validate_redirect_uri
from proliferate.auth.identity.web_beta import WebBetaAccessDenied
from proliferate.auth.sso.models import (
    SsoDiscoveryResponse,
    StartSsoAuthRequest,
    StartSsoAuthResponse,
)
from proliferate.auth.sso.service import (
    complete_oidc_sso_callback,
    complete_sso_error_callback,
    discover_sso,
    start_sso_auth,
)
from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User

router = APIRouter(tags=["auth"])


@router.get("/sso/discover", response_model=SsoDiscoveryResponse)
async def discover_sso_endpoint(
    email: str | None = None,
    organization_id: str | None = Query(default=None, alias="organizationId"),
    connection_id: str | None = Query(default=None, alias="connectionId"),
    slug: str | None = Query(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> SsoDiscoveryResponse:
    discovery = await discover_sso(
        db,
        email=email,
        organization_id=_optional_uuid(organization_id, field="organizationId"),
        connection_id=_optional_uuid(connection_id, field="connectionId"),
        slug=slug,
    )
    return SsoDiscoveryResponse(
        enabled=discovery.enabled,
        scope=discovery.scope.value if discovery.scope else None,  # type: ignore[arg-type]
        connection_id=str(discovery.connection_id) if discovery.connection_id else None,
        organization_id=str(discovery.organization_id) if discovery.organization_id else None,
        protocol=discovery.protocol.value if discovery.protocol else None,  # type: ignore[arg-type]
        display_name=discovery.display_name,
        reason=discovery.reason,
    )


@router.post("/{surface}/sso/start", response_model=StartSsoAuthResponse)
async def start_sso_endpoint(
    surface: str,
    body: StartSsoAuthRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User | None = Depends(optional_current_active_user),
) -> StartSsoAuthResponse:
    result = await start_sso_auth(
        db,
        request,
        surface=surface,
        client_state=body.client_state,
        code_challenge=body.code_challenge,
        code_challenge_method=body.code_challenge_method,
        redirect_uri=body.redirect_uri,
        email=body.email,
        organization_id=_optional_uuid(body.organization_id, field="organizationId"),
        connection_id=_optional_uuid(body.connection_id, field="connectionId"),
        prompt=body.prompt,
        user=user,
    )
    await db.commit()
    return StartSsoAuthResponse(
        authorization_url=result.authorization_url,
        state=result.state,
        nonce=result.nonce,
        expires_at=result.expires_at,
        scope=result.connection.scope.value,  # type: ignore[arg-type]
        protocol=result.connection.protocol.value,  # type: ignore[arg-type]
        connection_id=str(result.connection.id) if result.connection.id else None,
        organization_id=(
            str(result.connection.organization_id) if result.connection.organization_id else None
        ),
    )


@router.get("/sso/oidc/callback")
async def oidc_sso_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    if error is not None:
        if state is not None:
            try:
                redirect_url = await complete_sso_error_callback(db, state=state, error=error)
                await db.commit()
                return _auth_redirect_response(redirect_url)
            except HTTPException:
                await db.rollback()
        return RedirectResponse(
            _auth_error_url("provider_error"), status_code=status.HTTP_302_FOUND
        )
    if state is None or code is None:
        return RedirectResponse(_auth_error_url("missing_callback_params"), status_code=302)
    try:
        redirect_url = await complete_oidc_sso_callback(db, request, state=state, code=code)
    except WebBetaAccessDenied as exc:
        await db.rollback()
        return RedirectResponse(_auth_error_url(exc.code), status_code=status.HTTP_302_FOUND)
    except HTTPException as exc:
        await db.rollback()
        return RedirectResponse(
            _auth_error_url(_sso_callback_error_code(exc)), status_code=status.HTTP_302_FOUND
        )
    await db.commit()
    return _auth_redirect_response(redirect_url)


def _optional_uuid(value: str | None, *, field: str) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid UUID.") from exc


def _auth_error_url(code: str) -> str:
    base = settings.frontend_base_url.strip().rstrip("/") or "http://localhost:5174"
    return f"{base}/auth/error?{urlencode({'code': code})}"


def _sso_callback_error_code(exc: HTTPException) -> str:
    detail = exc.detail if isinstance(exc.detail, str) else None
    if detail is None:
        return "sso_callback_failed"
    return _SSO_CALLBACK_ERROR_CODES.get(detail, "sso_callback_failed")


_SSO_CALLBACK_ERROR_CODES = {
    "Email domain is not allowed for this SSO.": "sso_email_domain_not_allowed",
    "Invalid or expired SSO state.": "sso_state_invalid",
    "Linked SSO user not found.": "sso_linked_user_not_found",
    "OIDC identity token could not be verified.": "sso_oidc_identity_verification_failed",
    "OIDC nonce mismatch.": "sso_oidc_nonce_mismatch",
    "OIDC token exchange failed.": "sso_oidc_token_exchange_failed",
    "SSO callback protocol mismatch.": "sso_protocol_mismatch",
    "SSO callback state mismatch.": "sso_state_mismatch",
    "SSO connection is no longer available.": "sso_connection_unavailable",
    "SSO connection is not enabled.": "sso_connection_disabled",
    "SSO did not return an email address.": "sso_email_missing",
    "SSO email address is not verified.": "sso_email_unverified",
    "SSO organization is missing.": "sso_organization_missing",
    "SSO user is not a team member.": "sso_user_not_team_member",
    "User already belongs to another team.": "sso_user_already_in_team",
    "User is inactive.": "sso_user_inactive",
}


def _auth_redirect_response(redirect_url: str) -> RedirectResponse:
    safe_redirect_url = _validated_auth_redirect_url(redirect_url)
    # lgtm[py/url-redirection] The callback target was checked against the
    # product auth redirect allowlist immediately above.
    return RedirectResponse(safe_redirect_url, status_code=status.HTTP_302_FOUND)


def _validated_auth_redirect_url(redirect_url: str) -> str:
    for surface in ("web", "mobile", "desktop"):
        try:
            validate_redirect_uri(surface, redirect_url)
        except HTTPException:
            continue
        return redirect_url
    raise HTTPException(status_code=400, detail="Auth redirect URI is not allowed.")
