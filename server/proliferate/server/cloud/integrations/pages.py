"""Browser-facing OAuth callback rendering for cloud integrations.

Ported from ``server/cloud/mcp_oauth/pages.py`` +
``mcp_oauth/domain/flow_rules.build_oauth_web_completion_url`` (commit
``4b54c9f2b``), adapted onto the integrations flow result shape.
"""

from __future__ import annotations

from urllib.parse import quote, urlsplit
from uuid import UUID

from fastapi.responses import HTMLResponse

from proliferate.constants.auth import (
    DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    DESKTOP_REDIRECT_SCHEME,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.redirect_callback_pages import make_redirect_callback_response


def make_integration_oauth_callback_page(
    *,
    ok: bool,
    status: str,
    flow_id: UUID | None = None,
    failure_code: str | None = None,
) -> HTMLResponse:
    deep_link_url = _integration_oauth_desktop_deep_link(
        status=status,
        flow_id=flow_id,
        failure_code=failure_code,
    )
    title = "Authorization done" if ok else "Authorization failed"
    message = (
        "Redirecting to desktop app..."
        if ok
        else "Return to Proliferate and try connecting this integration again."
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
        status_label="Integrations",
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


def _integration_oauth_desktop_deep_link(
    *,
    status: str,
    flow_id: UUID | None,
    failure_code: str | None,
) -> str:
    url = f"{DESKTOP_REDIRECT_SCHEME}://plugins?source=integration_oauth_callback&status={status}"
    if flow_id is not None:
        url += f"&flowId={flow_id}"
    if failure_code:
        url += f"&failureCode={failure_code}"
    return url


def build_integration_oauth_web_completion_url(
    *,
    frontend_base_url: str,
    return_path: str,
    flow_id: str,
    status: str,
    final_surface: str,
    failure_code: str | None,
) -> str:
    base = frontend_base_url.strip().rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise CloudApiError(
            "invalid_payload", "Frontend base URL is not configured correctly.", status_code=400
        )
    query = {
        "source": "integration_oauth_callback",
        "flowId": flow_id,
        "status": status,
        "finalSurface": final_surface,
    }
    if failure_code:
        query["failureCode"] = failure_code
    encoded = "&".join(
        f"{quote(key, safe='')}={quote(value, safe='')}" for key, value in query.items()
    )
    return f"{base}{return_path}?{encoded}"
