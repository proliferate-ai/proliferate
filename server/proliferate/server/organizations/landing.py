"""Invitation landing page rendering."""

from __future__ import annotations

from urllib.parse import urlencode

from proliferate.utils.redirect_callback_pages import render_redirect_callback_page


def build_landing_html(organization_name: str, handoff_token: str) -> str:
    deep_link = "proliferate://settings/organization?" + urlencode(
        {"inviteHandoff": handoff_token}
    )
    return render_redirect_callback_page(
        title="Invite done",
        status_label="Organization invite",
        message="Redirecting to desktop app...",
        tone="neutral",
        action_label="Open Proliferate",
        action_href=deep_link,
        action_visible=False,
        launch_url=deep_link,
        fallback_message="If Proliferate did not open automatically, use the button below.",
        variant="handoff",
    )
