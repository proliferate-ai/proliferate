"""Inline browser launch behavior for redirect callback pages."""

from __future__ import annotations

import json


def render_launch_script(
    *,
    launch_url: str | None,
    fallback_message: str | None,
    reveal_action_after_ms: int,
) -> str:
    if not launch_url:
        return ""

    fallback_json = _json_for_inline_script(fallback_message) if fallback_message else "null"
    return f"""
    <script>
      window.addEventListener("load", () => {{
        const launchUrl = {_json_for_inline_script(launch_url)};
        const fallbackMessage = {fallback_json};
        const recovery = document.getElementById("recovery");
        const statusText = document.getElementById("status-text");

        window.location.replace(launchUrl);

        window.setTimeout(() => {{
          if (recovery) {{
            recovery.dataset.visible = "true";
          }}
          if (fallbackMessage && statusText) {{
            statusText.textContent = fallbackMessage;
          }}
        }}, {reveal_action_after_ms});
      }});
    </script>"""


def _json_for_inline_script(value: str) -> str:
    return (
        json.dumps(value).replace("<", r"\u003c").replace(">", r"\u003e").replace("&", r"\u0026")
    )
