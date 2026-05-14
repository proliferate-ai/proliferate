from __future__ import annotations

from fastapi.responses import HTMLResponse

from proliferate.auth.desktop.pages import make_desktop_handoff_page
from proliferate.server.cloud.mcp_oauth.pages import make_mcp_oauth_callback_page
from proliferate.utils.redirect_pages import make_redirect_page


def _html(response: HTMLResponse) -> str:
    return response.body.decode("utf-8")


def test_redirect_page_escapes_html_content_and_action_href() -> None:
    html = _html(
        make_redirect_page(
            title='<script>alert("title")</script>',
            eyebrow="<provider>",
            message='<img src=x onerror="alert(1)">',
            detail="token=<secret>",
            action_url='proliferate://auth/callback?code="abc"&state=<bad>',
            action_label="<Open>",
            hint="Use <fallback>.",
        )
    )

    assert '<script>alert("title")</script>' not in html
    assert '<img src=x onerror="alert(1)">' not in html
    assert "&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;" in html
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in html
    assert "token=&lt;secret&gt;" in html
    assert (
        'href="proliferate://auth/callback?code=&quot;abc&quot;&amp;state=&lt;bad&gt;"'
        in html
    )
    assert "&lt;Open&gt;" in html
    assert "Use &lt;fallback&gt;." in html


def test_redirect_page_escapes_deep_link_script_data() -> None:
    html = _html(
        make_redirect_page(
            title="Opening Proliferate...",
            message="Launching...",
            action_url="proliferate://open?next=</script><script>alert(1)</script>&ok=1",
            launch_action_on_load=True,
            delayed_status_message="Use <the button>.",
        )
    )

    assert "window.location.replace(deepLinkUrl)" in html
    assert "proliferate://open?next=</script><script>alert(1)</script>&ok=1" not in html
    assert "\\u003c/script\\u003e\\u003cscript\\u003ealert(1)" in html
    assert "\\u0026ok=1" in html
    assert "Use \\u003cthe button\\u003e." in html


def test_desktop_handoff_page_preserves_deep_link_recovery() -> None:
    html = _html(
        make_desktop_handoff_page(
            deep_link_url="proliferate://auth/callback?code=auth-code&state=desktop-state",
            launch_deep_link=True,
        )
    )

    assert "Opening Proliferate..." in html
    assert "Open Proliferate again" in html
    assert "window.location.replace(deepLinkUrl)" in html
    assert "proliferate://auth/callback?code=auth-code&amp;state=desktop-state" in html
    assert "proliferate://auth/callback?code=auth-code\\u0026state=desktop-state" in html


def test_mcp_oauth_callback_page_uses_generic_success_and_failure_copy() -> None:
    success_html = _html(make_mcp_oauth_callback_page(ok=True))
    failure_html = _html(make_mcp_oauth_callback_page(ok=False))

    assert "Authorization complete" in success_html
    assert "finish using this plugin" in success_html
    assert "Plugins list" in success_html
    assert "Open Proliferate" in success_html
    assert "proliferate://plugins?source=mcp_oauth_callback&amp;status=completed" in success_html

    assert "Authorization failed" in failure_html
    assert "No tokens were exposed in this browser page" in failure_html
    assert "proliferate://plugins?source=mcp_oauth_callback&amp;status=failed" in failure_html
    assert "access-token" not in failure_html
    assert "refresh-token" not in failure_html
    assert "invalid_grant" not in failure_html
