"""HTML handoff pages for the desktop browser auth flow."""

from fastapi.responses import HTMLResponse

from proliferate.utils.redirect_pages import make_redirect_page


def make_browser_flow_page(*, title: str, message: str) -> HTMLResponse:
    return make_redirect_page(
        title=title,
        eyebrow="Desktop sign-in",
        message=message,
        close_after_ms=250,
    )


def make_desktop_handoff_page(*, deep_link_url: str, launch_deep_link: bool) -> HTMLResponse:
    title = "Opening Proliferate..." if launch_deep_link else "Return to Proliferate"
    message = (
        "Your GitHub session is verified. Proliferate should take over from here."
        if launch_deep_link
        else "Your GitHub session is verified. Return to Proliferate and it will unlock shortly."
    )
    hint = (
        "Keep this tab open if you want Proliferate's recovery polling to finish the sign-in."
        if launch_deep_link
        else (
            "Native deep-link launch is disabled in this environment, so Proliferate will "
            "finish the sign-in from its recovery polling instead."
        )
    )
    return make_redirect_page(
        title=title,
        eyebrow="Desktop sign-in",
        message=message,
        action_url=deep_link_url if launch_deep_link else None,
        action_label="Open Proliferate again",
        action_visible=False,
        launch_action_on_load=launch_deep_link,
        delayed_status_message=(
            "If Proliferate did not open automatically, use the button below "
            "or return to the app. Proliferate can still finish the sign-in "
            "from this browser callback."
        ),
        hint=hint,
    )
