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
from sqlalchemy.ext.asyncio import AsyncSession

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
from proliferate.auth.identity.providers import (
    parse_scope_string,
    token_expiry_from_timestamp,
    token_expiry_timestamp,
)
from proliferate.auth.identity.routing import auth_route_path_for_base
from proliferate.auth.identity.service import attach_verified_identity
from proliferate.auth.identity.types import VerifiedProviderIdentity
from proliferate.auth.jwt import get_jwt_strategy
from proliferate.auth.oauth import github_oauth_client
from proliferate.auth.pkce import build_code_challenge, verify_pkce
from proliferate.config import settings
from proliferate.constants.auth import (
    DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    DESKTOP_REDIRECT_SCHEMES,
    JWT_LIFETIME_SECONDS,
    REFRESH_TOKEN_LIFETIME_SECONDS,
    SUPPORTED_CODE_CHALLENGE_METHODS,
)
from proliferate.db.engine import async_session_factory
from proliferate.db.models.auth import User
from proliferate.db.store.auth import (
    consume_auth_code,
    consume_auth_code_for_state,
    create_auth_code,
)
from proliferate.db.store.users import (
    claim_customerio_welcome_send,
    clear_customerio_welcome_send,
    get_active_user_by_id,
    github_oauth_account_or_email_exists,
    update_user_github_profile,
)
from proliferate.integrations.customerio import (
    customerio_welcome_email_enabled,
    identify_customerio_user,
    send_customerio_welcome_email,
    track_customerio_desktop_authenticated,
)
from proliferate.integrations.github import (
    GitHubIntegrationError,
    get_github_user_profile,
)
from proliferate.server.cloud.agent_gateway.signup_hook import (
    schedule_agent_gateway_user_enrollment,
)
from proliferate.server.notifications import (
    SignupSlackNotification,
    schedule_signup_slack_notification,
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
        path = auth_route_path_for_base(
            "/auth/desktop/github/callback",
            base_url=request_origin,
        )
        return f"{request_origin}{path}"

    path = auth_route_path_for_base(
        "/auth/desktop/github/callback",
        base_url=api_base_url,
    )
    return f"{api_base_url}{path}"


def github_csrf_cookie_secure(request: Request) -> bool:
    api_base_url = _normalized_api_base_url()
    if api_base_url:
        return api_base_url.startswith("https://")
    return request.url.scheme == "https"


def validate_desktop_redirect_uri(redirect_uri: str) -> None:
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in DESKTOP_REDIRECT_SCHEMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "redirect_uri must use a configured desktop scheme: "
                f"{', '.join(sorted(DESKTOP_REDIRECT_SCHEMES))}"
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
            github_login=user.github_login,
            avatar_url=user.avatar_url,
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


async def get_active_user_or_400(db: AsyncSession, user_id: UUID) -> User:
    user = await get_active_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not found",
        )
    return user


async def sync_customerio_desktop_authenticated_user(user: User) -> None:
    user_id = str(user.id)
    await identify_customerio_user(
        user_id=user_id,
        email=user.email,
        display_name=user.display_name,
        github_login=user.github_login,
        github_avatar_url=user.avatar_url,
        created_at=user.created_at,
    )
    await track_customerio_desktop_authenticated(user_id=user_id)
    await _send_customerio_welcome_email_once(user)


async def _send_customerio_welcome_email_once(user: User) -> None:
    """Send the Customer.io welcome email exactly once per user.

    Uses a DB-backed claim on ``user.customerio_welcome_sent_at`` to dedupe
    across concurrent desktop auths. The claim is always cleared when the
    send does not return success, including on any raised exception or
    cancellation — otherwise a process crash between claim and send would
    permanently flag the user as sent without ever delivering an email.

    Gated on `customerio_welcome_email_enabled()` first so a missing-config
    environment does not burn the claim slot and churn the row on every auth.
    """
    if not customerio_welcome_email_enabled():
        return

    async with async_session_factory() as db, db.begin():
        claimed = await claim_customerio_welcome_send(db, user.id)
    if not claimed:
        return

    sent = False
    try:
        sent = await send_customerio_welcome_email(
            user_id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            github_login=user.github_login,
        )
    finally:
        if not sent:
            async with async_session_factory() as db, db.begin():
                await clear_customerio_welcome_send(db, user.id)


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
    coro = sync_customerio_desktop_authenticated_user(user)
    try:
        task = asyncio.create_task(coro, name=f"customerio-desktop-auth-{user.id}")
    except Exception:
        coro.close()
        logger.exception("Could not schedule Customer.io desktop auth sync task")
        return
    task.add_done_callback(_handle_customerio_sync_task_completion)


async def create_desktop_auth_code(
    db: AsyncSession,
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

    auth_code = await create_auth_code(
        db,
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
    db: AsyncSession,
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

    github_account_or_email_exists = await github_oauth_account_or_email_exists(
        db,
        account_id=account_id,
        account_email=account_email,
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

    github_login: str | None = None
    github_display_name: str | None = None
    github_avatar_url: str | None = None
    try:
        github_profile = await get_github_user_profile(token["access_token"])
        github_login = github_profile.login
        github_display_name = github_profile.display_name
        github_avatar_url = github_profile.avatar_url
        synced_user = await update_user_github_profile(
            db,
            user.id,
            github_login=github_profile.login,
            avatar_url=github_profile.avatar_url,
            display_name=github_profile.display_name,
        )
        if synced_user is not None:
            user = synced_user
    except GitHubIntegrationError:
        logger.info("Could not sync GitHub profile for desktop auth", exc_info=True)
    except Exception:
        logger.exception("Could not persist GitHub profile for desktop auth")

    await attach_verified_identity(
        db,
        user=user,
        verified=VerifiedProviderIdentity(
            provider="github",
            provider_subject=account_id,
            email=account_email,
            email_verified=True,
            display_name=github_display_name,
            provider_login=github_login,
            avatar_url=github_avatar_url,
            access_token=str(token["access_token"]),
            refresh_token=(
                token.get("refresh_token") if isinstance(token.get("refresh_token"), str) else None
            ),
            expires_at=token_expiry_from_timestamp(token.get("expires_at")),
            expires_at_timestamp=token_expiry_timestamp(token.get("expires_at")),
            scopes=parse_scope_string(token.get("scope")),
        ),
    )

    auth_code = await create_auth_code(
        db,
        user_id=user.id,
        code_challenge=state_data["code_challenge"],
        code_challenge_method=state_data["code_challenge_method"],
        state=state_data["desktop_state"],
        redirect_uri=state_data["redirect_uri"],
    )
    schedule_customerio_desktop_authenticated_user_sync(user)
    schedule_agent_gateway_user_enrollment(user.id, db=db)
    if not github_account_or_email_exists:
        schedule_signup_slack_notification(
            SignupSlackNotification(
                name=user.display_name or github_display_name or user.email,
                email=user.email,
                github=user.github_login or github_login or account_id,
                user_created_at=user.created_at,
            ),
            dedupe_key=f"github:{account_id}",
            db=db,
        )
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
    db: AsyncSession,
    body: PendingTokenRequest,
) -> TokenResponse | PendingTokenResponse:
    code_challenge = build_code_challenge(body.code_verifier)
    if code_challenge is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid code_verifier",
        )

    auth_code = await consume_auth_code_for_state(
        db,
        state=body.state,
        code_challenge=code_challenge,
    )
    if auth_code is None:
        return PendingTokenResponse()

    user = await get_active_user_or_400(db, auth_code.user_id)
    return await mint_desktop_tokens(user)


async def exchange_desktop_token(
    db: AsyncSession,
    body: TokenRequest,
) -> TokenResponse:
    if body.grant_type != "authorization_code":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="grant_type must be 'authorization_code'",
        )

    auth_code = await consume_auth_code(db, code=body.code)
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

    user = await get_active_user_or_400(db, auth_code.user_id)
    return await mint_desktop_tokens(user)


async def refresh_desktop_access_token(
    db: AsyncSession,
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

    user = await get_active_user_or_400(db, user_id)
    return await mint_desktop_tokens(user)
