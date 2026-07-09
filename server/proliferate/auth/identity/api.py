"""Product-owned web and mobile auth routes."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    Form,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_limited_user, optional_current_active_user
from proliferate.auth.identity.models import (
    AppleMobileCompleteRequest,
    AuthRefreshRequest,
    AuthSessionResponse,
    AuthTokenRequest,
    PasswordCredentialResponse,
    PasswordLoginRequest,
    PasswordSetRequest,
    StartAuthRequest,
    StartAuthResponse,
)
from proliferate.auth.identity.password import (
    authenticate_password_login,
    request_client_ip,
    set_password_credential,
)
from proliferate.auth.identity.routing import auth_route_path
from proliferate.auth.identity.service import (
    complete_apple_mobile_login,
    complete_apple_web_callback,
    complete_oauth_provider_callback,
    complete_oauth_provider_error_callback,
    hash_secret,
    start_provider_auth,
)
from proliferate.auth.identity.sessions import (
    WEB_CSRF_COOKIE,
    WEB_CSRF_HEADER,
    WEB_REFRESH_COOKIE,
    auth_session_response,
    exchange_auth_code,
    refresh_auth_session,
    revoke_sessions_for_refresh_token,
)
from proliferate.auth.identity.types import AuthProviderName
from proliferate.auth.identity.web_beta import (
    WebBetaAccessDenied,
    ensure_web_beta_email_allowed,
)
from proliferate.config import settings
from proliferate.constants.auth import REFRESH_TOKEN_LIFETIME_SECONDS
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User

router = APIRouter(tags=["auth"])


@router.post("/github/link/start", response_model=StartAuthResponse)
async def start_required_github_link(
    body: StartAuthRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_limited_user),
) -> StartAuthResponse:
    authorization_url, state, nonce, expires_at = await start_provider_auth(
        db,
        request,
        provider="github",
        surface="web",
        purpose="required_github_link",
        client_state=body.client_state,
        code_challenge=body.code_challenge,
        code_challenge_method=body.code_challenge_method,
        redirect_uri=body.redirect_uri,
        prompt=body.prompt,
        user=user,
    )
    await db.commit()
    return StartAuthResponse(
        provider="github",
        authorization_url=authorization_url,
        state=state,
        nonce=nonce,
        expires_at=expires_at,
    )


@router.post("/{surface}/{provider}/start", response_model=StartAuthResponse)
async def start_auth(
    surface: str,
    provider: AuthProviderName,
    body: StartAuthRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User | None = Depends(optional_current_active_user),
) -> StartAuthResponse:
    if surface not in {"web", "mobile", "desktop"}:
        raise HTTPException(status_code=404, detail="Unknown auth surface.")
    authorization_url, state, nonce, expires_at = await start_provider_auth(
        db,
        request,
        provider=provider,
        surface=surface,
        purpose=body.purpose,
        client_state=body.client_state,
        code_challenge=body.code_challenge,
        code_challenge_method=body.code_challenge_method,
        redirect_uri=body.redirect_uri,
        prompt=body.prompt,
        user=user,
    )
    await db.commit()
    return StartAuthResponse(
        provider=provider,
        authorization_url=authorization_url,
        state=state,
        nonce=nonce,
        expires_at=expires_at,
    )


@router.get("/{surface}/{provider}/callback")
async def oauth_callback(
    surface: str,
    provider: AuthProviderName,
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    if error is not None:
        if state is not None:
            try:
                redirect_url = await complete_oauth_provider_error_callback(
                    db,
                    provider=provider,
                    surface=surface,
                    state=state,
                    error=error,
                )
                await db.commit()
                return RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)
            except HTTPException:
                await db.rollback()
        return RedirectResponse(_auth_error_url(error), status_code=status.HTTP_302_FOUND)
    if state is None or code is None:
        return RedirectResponse(_auth_error_url("missing_callback_params"), status_code=302)
    try:
        redirect_url = await complete_oauth_provider_callback(
            db,
            request,
            provider=provider,
            surface=surface,
            state=state,
            code=code,
        )
    except WebBetaAccessDenied as exc:
        await db.rollback()
        return RedirectResponse(_auth_error_url(exc.code), status_code=status.HTTP_302_FOUND)
    await db.commit()
    return RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)


@router.get("/{provider}/callback")
async def oauth_shared_provider_callback(
    provider: AuthProviderName,
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    if provider != "github":
        raise HTTPException(status_code=404, detail="Unknown auth callback.")
    if error is not None:
        if state is not None:
            try:
                redirect_url = await complete_oauth_provider_error_callback(
                    db,
                    provider=provider,
                    surface=None,
                    state=state,
                    error=error,
                )
                await db.commit()
                return RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)
            except HTTPException:
                await db.rollback()
        return RedirectResponse(_auth_error_url(error), status_code=status.HTTP_302_FOUND)
    if state is None or code is None:
        return RedirectResponse(_auth_error_url("missing_callback_params"), status_code=302)
    try:
        redirect_url = await complete_oauth_provider_callback(
            db,
            request,
            provider=provider,
            surface=None,
            state=state,
            code=code,
        )
    except WebBetaAccessDenied as exc:
        await db.rollback()
        return RedirectResponse(_auth_error_url(exc.code), status_code=status.HTTP_302_FOUND)
    await db.commit()
    return RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)


@router.post("/web/apple/callback")
async def apple_web_callback(
    state: Annotated[str, Form()],
    id_token: Annotated[str, Form()],
    user: Annotated[str | None, Form()] = None,
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    display_name = None
    email = None
    if user:
        try:
            parsed = json.loads(user)
            if isinstance(parsed, dict):
                email = parsed.get("email") if isinstance(parsed.get("email"), str) else None
                name = parsed.get("name")
                if isinstance(name, dict):
                    parts = [
                        name.get("firstName") if isinstance(name.get("firstName"), str) else None,
                        name.get("lastName") if isinstance(name.get("lastName"), str) else None,
                    ]
                    display_name = " ".join(part for part in parts if part) or None
        except json.JSONDecodeError:
            pass
    try:
        redirect_url = await complete_apple_web_callback(
            db,
            state=state,
            identity_token=id_token,
            email=email,
            display_name=display_name,
        )
    except WebBetaAccessDenied as exc:
        await db.rollback()
        return RedirectResponse(_auth_error_url(exc.code), status_code=status.HTTP_302_FOUND)
    await db.commit()
    return RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)


@router.post("/mobile/apple/complete", response_model=AuthSessionResponse)
async def apple_mobile_complete(
    body: AppleMobileCompleteRequest,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    session = await complete_apple_mobile_login(
        db,
        state=body.state,
        identity_token=body.identity_token,
        email=body.email,
        display_name=body.display_name,
    )
    await db.commit()
    return auth_session_response(session, include_refresh_token=True)


@router.post("/web/password/login", response_model=AuthSessionResponse)
async def web_password_login(
    body: PasswordLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    try:
        session = await authenticate_password_login(
            db,
            email=body.email,
            password=body.password,
            client_ip=request_client_ip(request),
        )
        ensure_web_beta_email_allowed(session.email)
    except WebBetaAccessDenied:
        await db.rollback()
        raise
    except HTTPException:
        await db.commit()
        raise
    await db.commit()
    _set_web_session_cookies(response, session.refresh_token)
    return auth_session_response(session, include_refresh_token=False)


@router.post("/mobile/password/login", response_model=AuthSessionResponse)
async def mobile_password_login(
    body: PasswordLoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    try:
        session = await authenticate_password_login(
            db,
            email=body.email,
            password=body.password,
            client_ip=request_client_ip(request),
        )
    except HTTPException:
        await db.commit()
        raise
    await db.commit()
    return auth_session_response(session, include_refresh_token=True)


@router.put("/password", response_model=PasswordCredentialResponse)
async def set_password(
    body: PasswordSetRequest,
    response: Response,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_limited_user),
    web_refresh_token: Annotated[str | None, Cookie(alias=WEB_REFRESH_COOKIE)] = None,
) -> PasswordCredentialResponse:
    credential, reminted = await set_password_credential(
        db,
        user=user,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    await db.commit()
    if reminted is not None:
        # A password change bumped the user's token generation, revoking every
        # previously issued token (all surfaces, incl. any captured one). Hand
        # the acting caller a freshly minted session at the new generation so
        # they stay logged in:
        #   - web (httpOnly refresh cookie present): refresh the cookie in place;
        #     the browser adopts it transparently and never sees the refresh
        #     token in a response body.
        #   - desktop/bearer: return the fresh access + refresh tokens in the
        #     body for the client to persist.
        if web_refresh_token is not None:
            _set_web_session_cookies(response, reminted.refresh_token)
            credential = credential.model_copy(
                update={
                    "access_token": reminted.access_token,
                    "expires_in": reminted.expires_in,
                    "token_type": "bearer",
                }
            )
        else:
            credential = credential.model_copy(
                update={
                    "access_token": reminted.access_token,
                    "refresh_token": reminted.refresh_token,
                    "expires_in": reminted.expires_in,
                    "token_type": "bearer",
                }
            )
    return credential


@router.post("/web/token", response_model=AuthSessionResponse)
async def web_token(
    body: AuthTokenRequest,
    response: Response,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    session = await exchange_auth_code(db, code=body.code, code_verifier=body.code_verifier)
    ensure_web_beta_email_allowed(session.email)
    await db.commit()
    _set_web_session_cookies(response, session.refresh_token)
    return auth_session_response(session, include_refresh_token=False)


@router.post("/mobile/token", response_model=AuthSessionResponse)
async def mobile_token(
    body: AuthTokenRequest,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    session = await exchange_auth_code(db, code=body.code, code_verifier=body.code_verifier)
    await db.commit()
    return auth_session_response(session, include_refresh_token=True)


@router.post("/web/session/bootstrap", response_model=AuthSessionResponse)
async def web_session_bootstrap(
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=WEB_REFRESH_COOKIE)] = None,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No web session.")
    session = await refresh_auth_session(db, refresh_token=refresh_token)
    ensure_web_beta_email_allowed(session.email)
    _set_web_session_cookies(response, session.refresh_token)
    return auth_session_response(session, include_refresh_token=False)


@router.post("/web/session/refresh", response_model=AuthSessionResponse)
async def web_session_refresh(
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=WEB_REFRESH_COOKIE)] = None,
    csrf_cookie: Annotated[str | None, Cookie(alias=WEB_CSRF_COOKIE)] = None,
    csrf_header: Annotated[str | None, Header(alias=WEB_CSRF_HEADER)] = None,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    _validate_csrf(csrf_cookie=csrf_cookie, csrf_header=csrf_header)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No web session.")
    session = await refresh_auth_session(db, refresh_token=refresh_token)
    ensure_web_beta_email_allowed(session.email)
    _set_web_session_cookies(response, session.refresh_token)
    return auth_session_response(session, include_refresh_token=False)


@router.post("/web/session/logout")
async def web_session_logout(
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=WEB_REFRESH_COOKIE)] = None,
    csrf_cookie: Annotated[str | None, Cookie(alias=WEB_CSRF_COOKIE)] = None,
    csrf_header: Annotated[str | None, Header(alias=WEB_CSRF_HEADER)] = None,
    db: AsyncSession = Depends(get_async_session),
) -> dict[str, bool]:
    _validate_csrf(csrf_cookie=csrf_cookie, csrf_header=csrf_header)
    # Bump the user's token generation so logout revokes every previously issued
    # access and refresh token (all surfaces), not just this browser's cookies.
    await revoke_sessions_for_refresh_token(db, refresh_token=refresh_token)
    await db.commit()
    response.delete_cookie(WEB_REFRESH_COOKIE, path=_web_session_cookie_path())
    response.delete_cookie(WEB_CSRF_COOKIE, path="/")
    return {"ok": True}


@router.post("/mobile/session/refresh", response_model=AuthSessionResponse)
async def mobile_session_refresh(
    body: AuthRefreshRequest,
    db: AsyncSession = Depends(get_async_session),
) -> AuthSessionResponse:
    session = await refresh_auth_session(db, refresh_token=body.refresh_token)
    return auth_session_response(session, include_refresh_token=True)


def _set_web_session_cookies(response: Response, refresh_token: str) -> None:
    secure = _cookie_secure()
    response.set_cookie(
        WEB_REFRESH_COOKIE,
        refresh_token,
        max_age=REFRESH_TOKEN_LIFETIME_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=_web_session_cookie_path(),
    )
    csrf = hash_secret(refresh_token)[:32]
    response.set_cookie(
        WEB_CSRF_COOKIE,
        csrf,
        max_age=REFRESH_TOKEN_LIFETIME_SECONDS,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def _cookie_secure() -> bool:
    return settings.api_base_url.startswith("https://") or settings.frontend_base_url.startswith(
        "https://"
    )


def _web_session_cookie_path() -> str:
    return auth_route_path("/auth/web/session")


def _validate_csrf(*, csrf_cookie: str | None, csrf_header: str | None) -> None:
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(status_code=403, detail="CSRF token mismatch.")


def _auth_error_url(code: str) -> str:
    base = settings.frontend_base_url.strip().rstrip("/") or "http://localhost:5174"
    return f"{base}/auth/error?code={code}"
