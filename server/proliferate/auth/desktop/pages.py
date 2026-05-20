"""HTML handoff pages for the desktop browser auth flow."""

from __future__ import annotations

from fastapi.responses import HTMLResponse

from proliferate.utils.redirect_callback_pages import make_redirect_callback_response


def make_browser_flow_page(*, title: str, message: str) -> HTMLResponse:
    return make_redirect_callback_response(
        title=title,
        status_label="Browser callback",
        message=message,
        tone="error",
    )


def make_desktop_handoff_page(*, deep_link_url: str, launch_deep_link: bool) -> HTMLResponse:
    title = "GitHub sign-in done"
    message = (
        "Redirecting to desktop app..."
        if launch_deep_link
        else "Your GitHub session is verified. Return to Proliferate and it will unlock shortly."
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
    return make_redirect_callback_response(
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
