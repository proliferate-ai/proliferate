"""Invitation landing page rendering."""

from __future__ import annotations

from urllib.parse import urlencode


def build_landing_html(organization_name: str, handoff_token: str) -> str:
    deep_link = (
        "proliferate://settings/organization?"
        + urlencode({"inviteHandoff": handoff_token})
    )
    escaped_deep_link = _escape_html(deep_link)
    escaped_name = _escape_html(organization_name)
    return (
        "<!doctype html>"
        "<html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>Join {escaped_name}</title></head>"
        "<body>"
        f"<p>Opening Proliferate to join {escaped_name}.</p>"
        f"<p><a href=\"{escaped_deep_link}\">Open Proliferate</a></p>"
        "<script>"
        f"window.location.replace({_quote_js_string(deep_link)});"
        "</script>"
        "</body></html>"
    )


def _quote_js_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )
