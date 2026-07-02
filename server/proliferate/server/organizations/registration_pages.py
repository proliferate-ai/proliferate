"""Server-rendered HTML for the invited /register page (single-org mode only).

The HTML sibling of ``POST /auth/password/register``: an invited teammate
opens the invite link an admin shared, fills in a password, and gets an
account in the instance organization. Same shell as the first-run /setup
page: a plain HTML document with inline styles and no JavaScript, so it
works in any browser without the desktop bundle or an SPA build.

Only mounted in single-org mode (see ``create_app``); hosted deployments
never expose these routes. The ``password_auth_enabled`` kill switch 404s
them exactly as it does the JSON registration route. Error re-renders show
the service error message unchanged: every invitation failure already maps
to one uniform message (see ``self_registration._not_invited``), so nothing
here can reveal whether an email is invited.
"""

from __future__ import annotations

import html
from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.responses import HTMLResponse

from proliferate.config import settings
from proliferate.db.engine import AsyncSessionDep
from proliferate.server.organizations.errors import OrganizationServiceError
from proliferate.server.organizations.self_registration import register_invited_account
from proliferate.server.setup.pages import render_page

router = APIRouter()


def render_register_form(
    *,
    error: str | None = None,
    email: str = "",
    invitation_token: str = "",
) -> str:
    error_html = f'<p class="error">{html.escape(error)}</p>\n' if error else ""
    body = (
        "<h1>Join this Proliferate instance</h1>\n"
        '<p class="sub">Create your account with the invitation an admin '
        "shared with you.</p>\n"
        f"{error_html}"
        '<form method="post" action="register">\n'
        '<label for="email">Email</label>\n'
        '<input id="email" name="email" type="email" autocomplete="email" required '
        f'value="{html.escape(email, quote=True)}">\n'
        '<label for="invitation_token">Invitation token</label>\n'
        '<input id="invitation_token" name="invitation_token" type="text" '
        'autocomplete="off" spellcheck="false" required '
        f'value="{html.escape(invitation_token, quote=True)}">\n'
        '<p class="hint">Shared by the admin who invited you.</p>\n'
        '<label for="password">Password</label>\n'
        '<input id="password" name="password" type="password" '
        'autocomplete="new-password" required>\n'
        '<button type="submit">Create account</button>\n'
        "</form>"
    )
    return render_page("Join Proliferate", body)


def render_register_success(*, email: str, organization_name: str) -> str:
    body = (
        "<h1>You are all set</h1>\n"
        f'<p class="sub"><strong>{html.escape(email)}</strong> joined '
        f"<strong>{html.escape(organization_name)}</strong>.</p>\n"
        "<p>Open the Proliferate desktop app and sign in with your email and "
        "password.</p>"
    )
    return render_page("Proliferate registration complete", body)


def render_register_not_found() -> str:
    body = '<h1>Not found</h1>\n<p class="sub">There is nothing to register here.</p>'
    return render_page("Not found", body)


def _registration_page_available() -> bool:
    """Same guards as the JSON registration route: single-org mode only, and
    the password-auth kill switch closes account creation entirely."""
    return settings.single_org_mode and settings.password_auth_enabled


@router.get("/register", response_class=HTMLResponse, include_in_schema=False)
async def invited_registration_page(token: str = "", email: str = "") -> HTMLResponse:
    """Render the registration form, prefilled from the invite link."""
    if not _registration_page_available():
        return HTMLResponse(render_register_not_found(), status_code=404)
    return HTMLResponse(render_register_form(email=email, invitation_token=token))


@router.post("/register", response_class=HTMLResponse, include_in_schema=False)
async def invited_registration_submit(
    db: AsyncSessionDep,
    email: Annotated[str, Form()] = "",
    password: Annotated[str, Form()] = "",
    invitation_token: Annotated[str, Form()] = "",
) -> HTMLResponse:
    if not _registration_page_available():
        return HTMLResponse(render_register_not_found(), status_code=404)
    try:
        registration = await register_invited_account(
            db,
            email=email,
            password=password,
            invitation_token=invitation_token,
        )
    except OrganizationServiceError as error:
        if error.status_code == 404:
            return HTMLResponse(render_register_not_found(), status_code=404)
        return HTMLResponse(
            render_register_form(
                error=error.message,
                email=email,
                invitation_token=invitation_token,
            ),
            status_code=error.status_code,
        )
    return HTMLResponse(
        render_register_success(
            email=registration.email,
            organization_name=registration.organization_name,
        )
    )
