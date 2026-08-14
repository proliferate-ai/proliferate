"""HTML handoff pages for the desktop browser auth flow."""

from __future__ import annotations

import re

from fastapi.responses import HTMLResponse

from proliferate.auth.identity.types import AuthProviderName
from proliferate.lib.product.redirect_callbacks.page import render_redirect_callback_page

_PROVIDER_LABELS: dict[AuthProviderName, str] = {
    "github": "GitHub",
    "google": "Google",
    "apple": "Apple",
}

# OAuth error codes are a small, conservative vocabulary (e.g. "access_denied",
# "server_error"). Only echo the provider-supplied error when it matches this
# shape; anything else renders a generic detail instead of trusting provider
# input straight into the page.
_SAFE_ERROR_CODE = re.compile(r"[a-z0-9_]{1,64}")


def make_browser_flow_page(*, title: str, message: str) -> HTMLResponse:
    return HTMLResponse(
        render_redirect_callback_page(
            title=title,
            status_label="Browser callback",
            message=message,
            tone="error",
        )
    )


def make_desktop_handoff_page(
    *, provider: AuthProviderName, deep_link_url: str, launch_deep_link: bool
) -> HTMLResponse:
    label = _PROVIDER_LABELS[provider]
    title = f"{label} sign-in done"
    message = (
        "Redirecting to desktop app..."
        if launch_deep_link
        else f"Your {label} session is verified. Return to Proliferate and it will unlock shortly."
    )
    fallback_message = (
        "If Proliferate did not open automatically, use the button below or return to the app. "
        "Proliferate can still finish the sign-in from this browser callback."
    )
    detail = (
        None
        if launch_deep_link
        else (
            "Native deep-link launch is disabled in this environment, so Proliferate will "
            "finish the sign-in from its recovery polling instead."
        )
    )
    return HTMLResponse(
        render_redirect_callback_page(
            title=title,
            status_label="Desktop sign-in",
            message=message,
            tone="success",
            detail=detail,
            action_label="Open Proliferate again" if launch_deep_link else None,
            action_href=deep_link_url if launch_deep_link else None,
            action_visible=not launch_deep_link,
            action_hint=(
                "Keep this tab open if you want Proliferate's recovery polling to finish the sign-in instead."
                if launch_deep_link
                else None
            ),
            launch_url=deep_link_url if launch_deep_link else None,
            fallback_message=fallback_message if launch_deep_link else None,
            variant="handoff",
        )
    )


def make_desktop_provider_error_page(
    *,
    provider: AuthProviderName,
    deep_link_url: str,
    launch_deep_link: bool,
    error: str,
) -> HTMLResponse:
    label = _PROVIDER_LABELS[provider]
    title = f"{label} sign-in failed"
    fallback_message = "If Proliferate did not open automatically, use the button below."
    detail = (
        f"The provider returned: {error}"
        if _SAFE_ERROR_CODE.fullmatch(error)
        else "The provider reported an error."
    )
    return HTMLResponse(
        render_redirect_callback_page(
            title=title,
            status_label="Desktop sign-in",
            message="Return to Proliferate and try signing in again.",
            tone="error",
            detail=detail,
            action_label="Open Proliferate",
            action_href=deep_link_url,
            action_visible=not launch_deep_link,
            launch_url=deep_link_url if launch_deep_link else None,
            fallback_message=fallback_message if launch_deep_link else None,
            variant="default",
        )
    )
