"""Organization invitation landing page rendering."""

from __future__ import annotations

from urllib.parse import quote
from uuid import UUID

from proliferate.config import settings
from proliferate.utils.redirect_callback_pages import render_redirect_callback_page


def _issuing_server_origin() -> str:
    """The origin invite links should point desktops back at.

    Mirrors ``organization_join_url``'s base-url precedence so the deep link's
    embedded origin matches the host that rendered the /join page. Cloud gets an
    origin equal to its hosted URL (desktops read it as "matches current server"
    and proceed unchanged); self-hosted gets its own origin so the desktop can
    trust-confirm a switch instead of resolving the org id against Cloud.
    """
    return (settings.frontend_base_url or settings.api_base_url).rstrip("/")


def build_join_landing_html(organization_name: str, organization_id: UUID) -> str:
    deep_link = f"proliferate://join/{organization_id}"
    origin = _issuing_server_origin()
    if origin:
        deep_link = f"{deep_link}?origin={quote(origin, safe='')}"
    return render_redirect_callback_page(
        title=f"Join {organization_name}",
        status_label="Organization invite",
        message="Redirecting to desktop app...",
        tone="neutral",
        action_label="Open Proliferate",
        action_href=deep_link,
        action_visible=False,
        launch_url=deep_link,
        fallback_message=("If Proliferate did not open automatically, use the button below."),
        variant="handoff",
    )
