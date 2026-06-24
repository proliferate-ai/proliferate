"""Organization invitation landing page rendering."""

from __future__ import annotations

from uuid import UUID

from proliferate.utils.redirect_callback_pages import render_redirect_callback_page


def build_join_landing_html(organization_name: str, organization_id: UUID) -> str:
    deep_link = f"proliferate://join/{organization_id}"
    return render_redirect_callback_page(
        title=f"Join {organization_name}",
        status_label="Organization invite",
        message="Redirecting to desktop app...",
        tone="neutral",
        action_label="Open Proliferate",
        action_href=deep_link,
        action_visible=False,
        launch_url=deep_link,
        fallback_message=(
            "If Proliferate did not open automatically, use the button below."
        ),
        variant="handoff",
    )
