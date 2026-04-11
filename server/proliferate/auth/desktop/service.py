"""Desktop auth flow orchestration.

Owns token minting, redirect validation, desktop PKCE exchange, and browser
GitHub OAuth completion for the desktop auth boundary.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from fastapi import HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi_users import exceptions as fastapi_users_exceptions
from fastapi_users.jwt import decode_jwt, generate_jwt
from fastapi_users.router.oauth import (
    CSRF_TOKEN_KEY,
    STATE_TOKEN_AUDIENCE,
)

from proliferate.auth.desktop.models import (
    AuthCodeCreated,
    AuthorizeParams,
    PendingTokenRequest,
    PendingTokenResponse,
    RefreshRequest,
    TokenRequest,
    TokenResponse,
    TokenUserInfo,
)
from proliferate.auth.desktop.pages import (
    make_browser_flow_page,
    make_desktop_handoff_page,
)
from proliferate.auth.jwt import get_jwt_strategy
from proliferate.auth.oauth import github_oauth_client
from proliferate.auth.pkce import build_code_challenge, verify_pkce
from proliferate.config import settings
from proliferate.constants.auth import (
    DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    DESKTOP_REDIRECT_SCHEME,
    JWT_LIFETIME_SECONDS,
    REFRESH_TOKEN_LIFETIME_SECONDS,
    SUPPORTED_CODE_CHALLENGE_METHODS,
)
from proliferate.db.models.auth import User
from proliferate.db.store.auth import (
    consume_auth_code_for_state_value,
    consume_auth_code_value,
    create_auth_code_for_user,
)
from proliferate.db.store.users import load_active_user_by_id
from proliferate.integrations.customerio import (
    identify_customerio_user,
    track_customerio_desktop_authenticated,
)

if TYPE_CHECKING:
    from proliferate.auth.users import UserManager


logger = logging.getLogger(__name__)


def github_oauth_enabled() -> bool:
    return bool(settings.github_oauth_client_id and settings.github_oauth_client_secret)


def _normalized_api_base_url() -> str | None:
    raw_base_url = settings.api_base_url.strip()
    if not raw_base_url:
        return None
    return raw_base_url.rstrip("/")


_LOOPBACK_HOSTNAMES = {"localhost", "127.0.0.1", "::1"}


def _is_loopback(hostname: str | None) -> bool:
    return hostname is not None and hostname in _LOOPBACK_HOSTNAMES


def build_github_callback_url(request: Request) -> str:
    api_base_url = _normalized_api_base_url()
    if not api_base_url:
        return str(request.url_for("desktop_github_callback"))

    api_parsed = urlparse(api_base_url)
    request_host = request.url.hostname

    # When both the configured API base and the incoming request resolve to
    # loopback but use different hostnames (e.g. ``localhost`` vs
    # ``127.0.0.1``), the CSRF cookie set during ``/authorize`` won't be sent
    # back on the ``/callback`` redirect because the browser treats them as
    # different origins.  In that case, rewrite the callback URL to use the
    # request's origin so the cookie domain stays consistent.
    if (
        request_host
        and api_parsed.hostname
        and request_host != api_parsed.hostname
        and _is_loopback(request_host)
        and _is_loopback(api_parsed.hostname)
    ):
        request_origin = f"{request.url.scheme}://{request.url.netloc}"
        return f"{request_origin}/auth/desktop/github/callback"

    return f"{api_base_url}/auth/desktop/github/callback"


def github_csrf_cookie_secure(request: Request) -> bool:
    api_base_url = _normalized_api_base_url()
    if api_base_url:
        return api_base_url.startswith("https://")
    return request.url.scheme == "https"


def validate_desktop_redirect_uri(redirect_uri: str) -> None:
    parsed = urlparse(redirect_uri)
    if parsed.scheme != DESKTOP_REDIRECT_SCHEME:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"redirect_uri must use the configured desktop scheme '{DESKTOP_REDIRECT_SCHEME}'"
            ),
        )


def build_redirect_url(base_url: str, **params: str) -> str:
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urlunparse(parsed._replace(query=urlencode(query)))


def build_token_response(*, access_token: str, refresh_token: str, user: User) -> TokenResponse:
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=JWT_LIFETIME_SECONDS,
        user=TokenUserInfo(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
        ),
    )


async def mint_desktop_tokens(user: User) -> TokenResponse:
    strategy = get_jwt_strategy()
    access_token = await strategy.write_token(user)
    refresh_token = generate_jwt(
        data={"sub": str(user.id), "aud": "proliferate:refresh"},
        secret=settings.jwt_secret,
        lifetime_seconds=REFRESH_TOKEN_LIFETIME_SECONDS,
    )
    return build_token_response(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
    )


async def get_active_user_or_400(user_id: UUID) -> User:
    user = await load_active_user_by_id(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not found",
        )
    return user


async def sync_customerio_desktop_authenticated_user(user: User) -> None:
    await identify_customerio_user(
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
    )
    await track_customerio_desktop_authenticated(
        user_id=str(user.id),
    )


def _handle_customerio_sync_task_completion(task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return

    exc = task.exception()
    if exc is None:
        return

    logger.exception(
        "Customer.io desktop auth sync task failed unexpectedly",
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def schedule_customerio_desktop_authenticated_user_sync(user: User) -> None:
    task = asyncio.create_task(
        sync_customerio_desktop_authenticated_user(user),
        name=f"customerio-desktop-auth-{user.id}",
    )
    task.add_done_callback(_handle_customerio_sync_task_completion)


async def create_desktop_auth_code(
    params: AuthorizeParams,
    user_id: UUID,
) -> AuthCodeCreated:
    validate_desktop_redirect_uri(params.redirect_uri)

    if params.code_challenge_method not in SUPPORTED_CODE_CHALLENGE_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported code_challenge_method. Supported: {SUPPORTED_CODE_CHALLENGE_METHODS}"
            ),
        )

    auth_code = await create_auth_code_for_user(
        user_id=user_id,
        code_challenge=params.code_challenge,
        code_challenge_method=params.code_challenge_method,
        state=params.state,
        redirect_uri=params.redirect_uri,
    )

    return AuthCodeCreated(
        code=auth_code.code,
        redirect_uri=params.redirect_uri,
        state=params.state,
    )


async def finish_github_desktop_callback(
    request: Request,
    *,
    code: str | None,
    state: str | None,
    error: str | None,
    error_description: str | None,
    desktop_github_csrf: str | None,
    user_manager: UserManager,
) -> HTMLResponse:
    if not github_oauth_enabled():
        return make_browser_flow_page(
            title="GitHub sign-in unavailable",
            message="This environment is missing GitHub OAuth credentials.",
        )

    if error is not None:
        detail = error_description or error
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message=f"The browser flow returned: {detail}",
        )

    if code is None or state is None:
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="The browser callback did not include the required auth parameters.",
        )

    try:
        state_data = decode_jwt(
            state,
            secret=settings.jwt_secret,
            audience=[STATE_TOKEN_AUDIENCE],
        )
    except Exception:
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="The OAuth state token was invalid or expired. Start again from Proliferate.",
        )

    state_csrf = state_data.get(CSRF_TOKEN_KEY)
    if (
        not desktop_github_csrf
        or not state_csrf
        or not secrets.compare_digest(desktop_github_csrf, state_csrf)
    ):
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="The browser session could not be verified. Start again from Proliferate.",
        )

    callback_url = build_github_callback_url(request)
    try:
        token = await github_oauth_client.get_access_token(code, callback_url)
        account_id, account_email = await github_oauth_client.get_id_email(token["access_token"])
    except Exception:
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="GitHub did not return a usable account. Start again from Proliferate.",
        )

    if account_email is None:
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="GitHub did not return an email address for this account.",
        )

    try:
        user = await user_manager.oauth_callback(
            github_oauth_client.name,
            token["access_token"],
            account_id,
            account_email,
            token.get("expires_at"),
            token.get("refresh_token"),
            request,
            associate_by_email=True,
            is_verified_by_default=True,
        )
    except fastapi_users_exceptions.UserAlreadyExists:
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="This email is already registered and could not be linked to GitHub.",
        )

    if not user.is_active:
        return make_browser_flow_page(
            title="GitHub sign-in failed",
            message="This account is inactive.",
        )

    auth_code = await create_auth_code_for_user(
        user_id=user.id,
        code_challenge=state_data["code_challenge"],
        code_challenge_method=state_data["code_challenge_method"],
        state=state_data["desktop_state"],
        redirect_uri=state_data["redirect_uri"],
    )
    schedule_customerio_desktop_authenticated_user_sync(user)
    deep_link_url = build_redirect_url(
        state_data["redirect_uri"],
        code=auth_code.code,
        state=state_data["desktop_state"],
    )
    return make_desktop_handoff_page(
        deep_link_url=deep_link_url,
        launch_deep_link=DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    )


async def poll_desktop_auth(
    body: PendingTokenRequest,
) -> TokenResponse | PendingTokenResponse:
    code_challenge = build_code_challenge(body.code_verifier)
    if code_challenge is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid code_verifier",
        )

    auth_code = await consume_auth_code_for_state_value(
        state=body.state,
        code_challenge=code_challenge,
    )
    if auth_code is None:
        return PendingTokenResponse()

    user = await get_active_user_or_400(auth_code.user_id)
    return await mint_desktop_tokens(user)


async def exchange_desktop_token(
    body: TokenRequest,
) -> TokenResponse:
    if body.grant_type != "authorization_code":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="grant_type must be 'authorization_code'",
        )

    auth_code = await consume_auth_code_value(code=body.code)
    if auth_code is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid, expired, or already-consumed authorization code",
        )

    if not verify_pkce(
        body.code_verifier,
        auth_code.code_challenge,
        auth_code.code_challenge_method,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PKCE verification failed — code_verifier does not match code_challenge",
        )

    user = await get_active_user_or_400(auth_code.user_id)
    return await mint_desktop_tokens(user)


async def refresh_desktop_access_token(
    body: RefreshRequest,
) -> TokenResponse:
    if body.grant_type != "refresh_token":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="grant_type must be 'refresh_token'",
        )

    try:
        payload = decode_jwt(
            body.refresh_token,
            secret=settings.jwt_secret,
            audience=["proliferate:refresh"],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from exc

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token payload",
        )

    try:
        user_id = UUID(user_id_str)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token payload",
        ) from None

    user = await get_active_user_or_400(user_id)
    return await mint_desktop_tokens(user)
