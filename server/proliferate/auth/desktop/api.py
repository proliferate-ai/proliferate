"""Desktop authentication route handlers.

This module supports two desktop login paths:
1. Direct email/password login from the app.
2. Browser-based GitHub OAuth that lands back in the desktop PKCE session model.

Route handlers are kept thin and delegate to ``service`` for orchestration,
``templates`` for HTML rendering, and ``models`` for request/response shapes.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi_users.router.oauth import (
    CSRF_TOKEN_KEY,
    generate_csrf_token,
    generate_state_token,
)

from proliferate.auth.desktop.models import (
    AuthCodeCreated,
    AuthorizeParams,
    OAuthAvailabilityResponse,
    PendingTokenRequest,
    PendingTokenResponse,
    RefreshRequest,
    TokenRequest,
    TokenResponse,
)
from proliferate.auth.desktop.service import (
    build_github_callback_url,
    exchange_desktop_token,
    finish_github_desktop_callback,
    github_csrf_cookie_secure,
    github_oauth_enabled,
    refresh_desktop_access_token,
    validate_desktop_redirect_uri,
)
from proliferate.auth.desktop.service import (
    create_desktop_auth_code as create_desktop_auth_code_service,
)
from proliferate.auth.desktop.service import (
    poll_desktop_auth as poll_desktop_auth_service,
)
from proliferate.auth.oauth import github_oauth_client
from proliferate.auth.users import UserManager, get_user_manager
from proliferate.config import settings
from proliferate.constants.auth import (
    DESKTOP_GITHUB_CSRF_COOKIE,
    GITHUB_OAUTH_SCOPES,
    SUPPORTED_CODE_CHALLENGE_METHODS,
)

router = APIRouter(prefix="/desktop", tags=["desktop-auth"])


# ── Internal endpoint: create an auth code after browser login ──
# In production this is called server-side after the user authenticates,
# not directly by the desktop app.


@router.post(
    "/authorize",
    response_model=AuthCodeCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_desktop_auth_code(
    params: AuthorizeParams,
    user_id: UUID,
) -> AuthCodeCreated:
    """Create a short-lived auth code for the desktop PKCE exchange."""
    return await create_desktop_auth_code_service(params, user_id)


# ── Browser-based GitHub OAuth for desktop ──


@router.get("/github/availability", response_model=OAuthAvailabilityResponse)
async def github_availability() -> OAuthAvailabilityResponse:
    return OAuthAvailabilityResponse(enabled=github_oauth_enabled())


@router.get("/github/authorize")
async def authorize_github_desktop(
    request: Request,
    params: Annotated[AuthorizeParams, Depends()],
) -> RedirectResponse:
    """Start a desktop GitHub OAuth flow in the user's browser."""
    if not github_oauth_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub sign-in is not configured for this environment",
        )

    if params.code_challenge_method not in SUPPORTED_CODE_CHALLENGE_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported code_challenge_method. "
            f"Supported: {SUPPORTED_CODE_CHALLENGE_METHODS}",
        )
    validate_desktop_redirect_uri(params.redirect_uri)

    csrf_token = generate_csrf_token()
    oauth_state = generate_state_token(
        {
            CSRF_TOKEN_KEY: csrf_token,
            "desktop_state": params.state,
            "code_challenge": params.code_challenge,
            "code_challenge_method": params.code_challenge_method,
            "redirect_uri": params.redirect_uri,
        },
        settings.jwt_secret,
    )
    callback_url = build_github_callback_url(request)
    authorization_url = await github_oauth_client.get_authorization_url(
        callback_url,
        oauth_state,
        GITHUB_OAUTH_SCOPES,
    )

    response = RedirectResponse(authorization_url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        DESKTOP_GITHUB_CSRF_COOKIE,
        csrf_token,
        max_age=600,
        secure=github_csrf_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/github/callback", name="desktop_github_callback")
async def github_desktop_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    desktop_github_csrf: str | None = Cookie(default=None),
    user_manager: UserManager = Depends(get_user_manager),
) -> HTMLResponse:
    """Finish browser GitHub OAuth and stage a desktop PKCE auth code."""
    response = await finish_github_desktop_callback(
        request,
        code=code,
        state=state,
        error=error,
        error_description=error_description,
        desktop_github_csrf=desktop_github_csrf,
        user_manager=user_manager,
    )
    response.delete_cookie(DESKTOP_GITHUB_CSRF_COOKIE)
    return response


@router.post(
    "/poll",
    response_model=TokenResponse,
    responses={status.HTTP_202_ACCEPTED: {"model": PendingTokenResponse}},
)
async def poll_desktop_auth(
    body: PendingTokenRequest,
) -> TokenResponse | JSONResponse:
    """Poll for a browser-completed auth flow and exchange it into desktop tokens."""
    result = await poll_desktop_auth_service(body)
    if isinstance(result, PendingTokenResponse):
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=result.model_dump(),
        )
    return result


# ── Public endpoint: exchange auth code + PKCE verifier for JWT ──


@router.post("/token", response_model=TokenResponse)
async def exchange_token(
    body: TokenRequest,
) -> TokenResponse:
    """Exchange an authorization code + PKCE code_verifier for JWT tokens."""
    return await exchange_desktop_token(body)


# ── Refresh token endpoint ──


@router.post("/refresh", response_model=TokenResponse)
async def refresh_access_token(
    body: RefreshRequest,
) -> TokenResponse:
    """Exchange a refresh token for a new access + refresh token pair."""
    return await refresh_desktop_access_token(body)
