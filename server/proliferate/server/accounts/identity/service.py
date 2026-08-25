"""Product account-entry identity orchestration."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.identity import providers
from proliferate.auth.identity.password import verify_password_user
from proliferate.auth.identity.service import (
    append_query,
    attach_verified_identity,
    consume_provider_challenge,
    hash_secret,
)
from proliferate.auth.identity.sessions import mint_auth_session
from proliferate.auth.identity.store import (
    create_auth_user,
    get_account_readiness,
    get_identity_by_provider_subject,
    get_user_by_email,
    get_user_by_id,
    merge_auth_user_into_user,
)
from proliferate.auth.identity.types import (
    AuthCallbackRedirect,
    AuthChallengeSnapshot,
    AuthProviderName,
    AuthSession,
    VerifiedProviderIdentity,
)
from proliferate.auth.identity.web_beta import ensure_web_beta_email_allowed
from proliferate.db.store.auth import create_auth_code
from proliferate.db.store.users import github_oauth_account_or_email_exists
from proliferate.server.agent_auth.signup_hook import (
    schedule_agent_gateway_user_enrollment,
)
from proliferate.server.notifications import (
    SignupSlackNotification,
    schedule_signup_slack_notification,
)
from proliferate.server.organizations.admin_emails import ensure_admin_email_role
from proliferate.server.organizations.membership_policy import place_new_identity

if TYPE_CHECKING:
    from proliferate.auth.users import User


def _ensure_active_user(user: User) -> None:
    if not user.is_active:
        raise AuthFlowError("identity_user_inactive", "User is inactive.", status_code=403)


async def authenticate_password_user(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    client_ip: str | None,
) -> User:
    user = await verify_password_user(
        db,
        email=email,
        password=password,
        client_ip=client_ip,
    )
    await ensure_admin_email_role(db, user)
    return user


async def authenticate_password_login(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    client_ip: str | None,
) -> AuthSession:
    user = await authenticate_password_user(
        db,
        email=email,
        password=password,
        client_ip=client_ip,
    )
    return await mint_auth_session(db, user=user)


async def complete_oauth_provider_callback(
    db: AsyncSession,
    request: Request,
    *,
    provider: AuthProviderName,
    surface: str | None,
    state: str,
    code: str,
) -> AuthCallbackRedirect:
    challenge = await consume_provider_challenge(
        db,
        state=state,
        provider=provider,
        surface=surface,
    )
    callback_surface = surface or challenge.surface
    try:
        verified = await providers.verify_oauth_callback(
            provider=provider,
            surface=callback_surface,
            code=code,
            provider_callback_url=providers.provider_callback_url(
                request, provider=provider, surface=callback_surface
            ),
        )
    except providers.OAuthProviderTokenRejectedError:
        url = append_query(
            challenge.redirect_uri,
            error="provider_error",
            state=challenge.client_state,
        )
        return AuthCallbackRedirect(url=url, surface=challenge.surface, error="provider_error")
    except providers.ProviderVerificationError as exc:
        raise AuthFlowError(exc.code, exc.message, status_code=400) from exc
    if callback_surface == "web" and challenge.purpose == "login":
        beta_email = await _beta_email_for_provider_login(db, verified=verified)
        ensure_web_beta_email_allowed(beta_email)
    desktop_github_account_or_email_exists = True
    if callback_surface == "desktop" and provider == "github":
        desktop_github_account_or_email_exists = await _desktop_github_account_or_email_exists(
            db,
            verified=verified,
        )
    user = await resolve_provider_user(db, verified=verified, challenge=challenge)
    auth_code = await create_auth_code(
        db,
        user_id=user.id,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        state=challenge.client_state,
        redirect_uri=challenge.redirect_uri,
    )
    schedule_agent_gateway_user_enrollment(user.id, db=db)
    if callback_surface == "desktop" and provider == "github":
        _schedule_desktop_github_login_side_effects(
            db,
            user,
            verified=verified,
            notify_signup=not desktop_github_account_or_email_exists,
        )
    url = append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)
    return AuthCallbackRedirect(url=url, surface=challenge.surface, error=None)


async def _desktop_github_account_or_email_exists(
    db: AsyncSession,
    *,
    verified: VerifiedProviderIdentity,
) -> bool:
    if not verified.email:
        identity = await get_identity_by_provider_subject(
            db,
            provider=verified.provider,
            provider_subject=verified.provider_subject,
        )
        return identity is not None

    return await github_oauth_account_or_email_exists(
        db,
        account_id=verified.provider_subject,
        account_email=verified.email,
    )


def _schedule_desktop_github_login_side_effects(
    db: AsyncSession,
    user: User,
    *,
    verified: VerifiedProviderIdentity,
    notify_signup: bool,
) -> None:
    if notify_signup:
        schedule_signup_slack_notification(
            SignupSlackNotification(
                name=user.display_name or verified.display_name or user.email,
                email=user.email,
                github=user.github_login or verified.provider_login or verified.provider_subject,
                user_created_at=user.created_at,
            ),
            dedupe_key=f"github:{verified.provider_subject}",
            db=db,
        )


async def complete_apple_mobile_login(
    db: AsyncSession,
    *,
    state: str,
    identity_token: str,
    email: str | None,
    display_name: str | None,
) -> AuthSession:
    challenge = await consume_provider_challenge(
        db,
        state=state,
        provider="apple",
        surface="mobile",
    )
    try:
        verified = await providers.verify_apple_identity_token(
            identity_token=identity_token,
            expected_nonce=_nonce_unavailable_marker(challenge),
            surface=challenge.surface,
            email_hint=email,
            display_name_hint=display_name,
        )
    except providers.ProviderVerificationError as exc:
        raise AuthFlowError(exc.code, exc.message, status_code=400) from exc
    user = await resolve_provider_user(db, verified=verified, challenge=challenge)
    schedule_agent_gateway_user_enrollment(user.id, db=db)
    return await mint_auth_session(db, user=user)


async def complete_apple_web_callback(
    db: AsyncSession,
    *,
    state: str,
    identity_token: str,
    email: str | None,
    display_name: str | None,
) -> str:
    challenge = await consume_provider_challenge(
        db,
        state=state,
        provider="apple",
        surface="web",
    )
    try:
        verified = await providers.verify_apple_identity_token(
            identity_token=identity_token,
            expected_nonce=_nonce_unavailable_marker(challenge),
            surface=challenge.surface,
            email_hint=email,
            display_name_hint=display_name,
        )
    except providers.ProviderVerificationError as exc:
        raise AuthFlowError(exc.code, exc.message, status_code=400) from exc
    if challenge.purpose == "login":
        beta_email = await _beta_email_for_provider_login(db, verified=verified)
        ensure_web_beta_email_allowed(beta_email)
    user = await resolve_provider_user(db, verified=verified, challenge=challenge)
    auth_code = await create_auth_code(
        db,
        user_id=user.id,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        state=challenge.client_state,
        redirect_uri=challenge.redirect_uri,
    )
    schedule_agent_gateway_user_enrollment(user.id, db=db)
    return append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)


async def _beta_email_for_provider_login(
    db: AsyncSession,
    *,
    verified: VerifiedProviderIdentity,
) -> str | None:
    existing_identity = await get_identity_by_provider_subject(
        db,
        provider=verified.provider,
        provider_subject=verified.provider_subject,
    )
    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        return user.email if user is not None else None

    if verified.provider == "github" and verified.email:
        existing_email_user = await get_user_by_email(db, verified.email)
        if existing_email_user is not None:
            return existing_email_user.email

    return verified.email


def _nonce_unavailable_marker(challenge: AuthChallengeSnapshot) -> str:
    # We store only the nonce hash at rest. Apple verification accepts the hash
    # as the expected nonce so the raw nonce never needs to be persisted.
    return challenge.nonce_hash


async def resolve_provider_user(
    db: AsyncSession,
    *,
    verified: VerifiedProviderIdentity,
    challenge: AuthChallengeSnapshot,
) -> User:
    user = await _resolve_provider_user(db, verified=verified, challenge=challenge)
    if challenge.purpose == "login":
        # ADMIN_EMAILS floor: asserted at every login. Covers every OAuth
        # callback surface (web, desktop, mobile) for all providers because
        # they all resolve their user here.
        await ensure_admin_email_role(db, user)
    return user


async def _resolve_provider_user(
    db: AsyncSession,
    *,
    verified: VerifiedProviderIdentity,
    challenge: AuthChallengeSnapshot,
) -> User:
    existing_identity = await get_identity_by_provider_subject(
        db,
        provider=verified.provider,
        provider_subject=verified.provider_subject,
    )

    if challenge.purpose != "login":
        if challenge.user_id is None:
            raise AuthFlowError(
                "identity_authentication_required",
                "Authentication is required.",
                status_code=401,
            )
        if existing_identity is not None and existing_identity.user_id != challenge.user_id:
            current_user = await get_user_by_id(db, challenge.user_id)
            linked_user = await get_user_by_id(db, existing_identity.user_id)
            if current_user is None or linked_user is None:
                raise AuthFlowError(
                    "identity_linked_user_not_found",
                    "Linked user not found.",
                    status_code=400,
                )
            _ensure_active_user(current_user)
            _ensure_active_user(linked_user)
            current_readiness = await get_account_readiness(db, user_id=current_user.id)
            linked_readiness = await get_account_readiness(db, user_id=linked_user.id)
            if (
                verified.provider == "github"
                and not current_readiness.product_ready
                and linked_readiness.product_ready
            ):
                await merge_auth_user_into_user(
                    db,
                    source_user_id=current_user.id,
                    target_user_id=linked_user.id,
                )
                await attach_verified_identity(db, user=linked_user, verified=verified)
                return linked_user
            if current_readiness.product_ready and not linked_readiness.product_ready:
                await merge_auth_user_into_user(
                    db,
                    source_user_id=linked_user.id,
                    target_user_id=current_user.id,
                )
                await attach_verified_identity(db, user=current_user, verified=verified)
                return current_user
            raise AuthFlowError(
                "identity_provider_already_linked",
                "Provider identity already linked.",
                status_code=409,
            )
        user = await get_user_by_id(db, challenge.user_id)
        if user is None:
            raise AuthFlowError(
                "identity_user_not_found",
                "User not found.",
                status_code=400,
            )
        _ensure_active_user(user)
        await attach_verified_identity(db, user=user, verified=verified)
        return user

    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        if user is None:
            raise AuthFlowError(
                "identity_linked_user_not_found",
                "Linked user not found.",
                status_code=400,
            )
        _ensure_active_user(user)
        await attach_verified_identity(db, user=user, verified=verified)
        return user

    email = _email_for_new_user(verified)
    if verified.provider == "github" and verified.email:
        existing_email_user = await get_user_by_email(db, verified.email)
        if existing_email_user is not None:
            _ensure_active_user(existing_email_user)
            await attach_verified_identity(db, user=existing_email_user, verified=verified)
            return existing_email_user
    if verified.email and await get_user_by_email(db, verified.email) is not None:
        raise AuthFlowError(
            "identity_email_account_conflict",
            "An account already exists for this email. Sign in with GitHub to link it.",
            status_code=409,
        )
    user = await create_auth_user(
        db,
        email=email,
        display_name=verified.display_name,
        avatar_url=verified.avatar_url,
    )
    await place_new_identity(db, user)
    await attach_verified_identity(db, user=user, verified=verified)
    return user


def _email_for_new_user(verified: VerifiedProviderIdentity) -> str:
    if verified.email:
        return verified.email
    subject_hash = hash_secret(f"{verified.provider}:{verified.provider_subject}")[:24]
    return f"{verified.provider}-{subject_hash}@auth.proliferate.local"
