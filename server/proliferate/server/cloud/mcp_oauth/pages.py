from __future__ import annotations

from fastapi.responses import HTMLResponse

from proliferate.constants.auth import (
    DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    DESKTOP_REDIRECT_SCHEME,
)
from proliferate.utils.redirect_pages import make_redirect_page


def make_mcp_oauth_callback_page(*, ok: bool) -> HTMLResponse:
    status = "completed" if ok else "failed"
    deep_link_url = (
        f"{DESKTOP_REDIRECT_SCHEME}://plugins?source=mcp_oauth_callback&status={status}"
    )
    title = "Authorization complete" if ok else "Authorization failed"
    message = (
        "Return to Proliferate to finish using this plugin."
        if ok
        else "Return to Proliferate and try connecting this plugin again."
    )
    detail = (
        "Your connection is saved. Proliferate will refresh the Plugins list automatically."
        if ok
        else (
            "No tokens were exposed in this browser page. The desktop app will show "
            "the latest connection state."
        )
    )
    return make_redirect_page(
        title=title,
        eyebrow="Plugins",
        message=message,
        detail=detail,
        action_url=deep_link_url,
        action_label="Open Proliferate",
        action_visible=not DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
        launch_action_on_load=DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
        delayed_status_message="If Proliferate did not open automatically, use the button below.",
    )
