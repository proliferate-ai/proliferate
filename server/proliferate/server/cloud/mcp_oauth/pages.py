from __future__ import annotations

from fastapi.responses import HTMLResponse

from proliferate.constants.auth import (
    DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    DESKTOP_REDIRECT_SCHEME,
)
from proliferate.utils.redirect_callback_pages import make_redirect_callback_response


def make_mcp_oauth_callback_page(*, ok: bool) -> HTMLResponse:
    status = "completed" if ok else "failed"
    deep_link_url = (
        f"{DESKTOP_REDIRECT_SCHEME}://plugins?source=mcp_oauth_callback&status={status}"
    )
    title = "Authorization done" if ok else "Authorization failed"
    message = (
        "Redirecting to desktop app..."
        if ok
        else "Return to Proliferate and try connecting this plugin again."
    )
    detail = (
        None
        if ok
        else (
            "No tokens were exposed in this browser page. The desktop app will show "
            "the latest connection state."
        )
    )
    fallback_message = "If Proliferate did not open automatically, use the button below."
    return make_redirect_callback_response(
        title=title,
        status_label="Plugins",
        message=message,
        tone="success" if ok else "error",
        detail=detail,
        action_label="Open Proliferate",
        action_href=deep_link_url,
        action_visible=not DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
        launch_url=deep_link_url if DESKTOP_DEEP_LINK_LAUNCH_ENABLED else None,
        fallback_message=fallback_message if DESKTOP_DEEP_LINK_LAUNCH_ENABLED else None,
        variant="handoff" if ok else "default",
    )
