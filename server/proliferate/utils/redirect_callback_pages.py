"""Shared HTML renderer for redirect and callback handoff pages."""

from __future__ import annotations

import json
from html import escape
from typing import Literal

from fastapi.responses import HTMLResponse

RedirectCallbackTone = Literal["neutral", "success", "error"]
RedirectCallbackVariant = Literal["default", "handoff"]


def make_redirect_callback_response(
    *,
    title: str,
    status_label: str,
    message: str,
    tone: RedirectCallbackTone = "neutral",
    detail: str | None = None,
    action_label: str | None = None,
    action_href: str | None = None,
    action_visible: bool = True,
    action_hint: str | None = None,
    launch_url: str | None = None,
    fallback_message: str | None = None,
    reveal_action_after_ms: int = 1500,
    variant: RedirectCallbackVariant = "default",
) -> HTMLResponse:
    return HTMLResponse(
        render_redirect_callback_page(
            title=title,
            status_label=status_label,
            message=message,
            tone=tone,
            detail=detail,
            action_label=action_label,
            action_href=action_href,
            action_visible=action_visible,
            action_hint=action_hint,
            launch_url=launch_url,
            fallback_message=fallback_message,
            reveal_action_after_ms=reveal_action_after_ms,
            variant=variant,
        )
    )


def render_redirect_callback_page(
    *,
    title: str,
    status_label: str,
    message: str,
    tone: RedirectCallbackTone = "neutral",
    detail: str | None = None,
    action_label: str | None = None,
    action_href: str | None = None,
    action_visible: bool = True,
    action_hint: str | None = None,
    launch_url: str | None = None,
    fallback_message: str | None = None,
    reveal_action_after_ms: int = 1500,
    variant: RedirectCallbackVariant = "default",
) -> str:
    safe_tone = tone if tone in {"neutral", "success", "error"} else "neutral"
    safe_variant = variant if variant in {"default", "handoff"} else "default"
    escaped_title = escape(title)
    escaped_status_label = escape(status_label)
    escaped_message = escape(message)
    escaped_detail = escape(detail) if detail else None
    action_block = _render_action_block(
        action_label=action_label,
        action_href=action_href,
        action_visible=action_visible,
        action_hint=action_hint,
    )
    launch_script = _render_launch_script(
        launch_url=launch_url,
        fallback_message=fallback_message,
        reveal_action_after_ms=reveal_action_after_ms,
    )
    detail_block = (
        f"""
      <p class="detail">{escaped_detail}</p>"""
        if escaped_detail
        else ""
    )

    if safe_variant == "handoff":
        handoff_action_block = _render_handoff_action_block(
            action_label=action_label,
            action_href=action_href,
        )
        handoff_launch_script = _render_launch_script(
            launch_url=launch_url,
            fallback_message=None,
            reveal_action_after_ms=reveal_action_after_ms,
        )
        return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escaped_title}</title>
    <style>
      :root {{
        color-scheme: dark;
        font-family: Inter, Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #181818;
        color: #ffffff;
      }}
      * {{
        box-sizing: border-box;
      }}
      body {{
        min-width: 320px;
        min-height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: #181818;
      }}
      main {{
        width: min(28rem, 100%);
      }}
      .stack {{
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }}
      .intro {{
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }}
      .mark {{
        display: flex;
        width: 3rem;
        height: 3rem;
        align-items: center;
        justify-content: center;
      }}
      .braille {{
        display: inline-block;
        width: 1em;
        flex-shrink: 0;
        color: #ffffff;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 3rem;
        line-height: 1;
        white-space: nowrap;
        letter-spacing: -0.18em;
      }}
      .braille::before {{
        content: "⠁⠀";
        animation: braille-sweep 960ms step-end infinite;
      }}
      @keyframes braille-sweep {{
        0%, 6.249% {{ content: "⠁⠀"; }}
        6.25%, 12.499% {{ content: "⠋⠀"; }}
        12.5%, 18.749% {{ content: "⠟⠁"; }}
        18.75%, 24.999% {{ content: "⡿⠋"; }}
        25%, 31.249% {{ content: "⣿⠟"; }}
        31.25%, 37.499% {{ content: "⣿⡿"; }}
        37.5%, 49.999% {{ content: "⣿⣿"; }}
        50%, 56.249% {{ content: "⣾⣿"; }}
        56.25%, 62.499% {{ content: "⣴⣿"; }}
        62.5%, 68.749% {{ content: "⣠⣾"; }}
        68.75%, 74.999% {{ content: "⢀⣴"; }}
        75%, 81.249% {{ content: "⠀⣠"; }}
        81.25%, 87.499% {{ content: "⠀⢀"; }}
        87.5%, 100% {{ content: "⠀⠀"; }}
      }}
      @media (prefers-reduced-motion: reduce) {{
        .braille::before {{
          animation: none;
          content: "⣿⣿";
        }}
      }}
      .copy {{
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }}
      h1 {{
        margin: 0;
        color: #ffffff;
        font-size: 1.875rem;
        line-height: 1.2;
        font-weight: 650;
        letter-spacing: 0;
      }}
      p {{
        margin: 0;
        color: rgba(255, 255, 255, 0.66);
        font-size: 0.875rem;
        line-height: 1.5;
      }}
      .detail {{
        margin-top: -0.25rem;
      }}
      .action {{
        display: inline-flex;
        width: 100%;
        height: 2.75rem;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 0.375rem;
        padding: 0 1rem;
        background: #ffffff;
        color: #181818;
        font-size: 0.875rem;
        font-weight: 600;
        text-decoration: none;
        transition: opacity 0.15s ease;
      }}
      .action:hover {{
        opacity: 0.86;
      }}
    </style>
{handoff_launch_script}
  </head>
  <body>
    <main>
      <div class="stack">
        <div class="intro">
          <div class="mark" aria-label="Loading Proliferate">
            <span class="braille" aria-hidden="true"></span>
          </div>
          <div class="copy">
            <h1>{escaped_title}</h1>
            <p id="status-text">{escaped_message}</p>{detail_block}
          </div>
        </div>
{handoff_action_block}
      </div>
    </main>
  </body>
</html>"""

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escaped_title}</title>
    <style>
      :root {{
        color-scheme: dark;
        font-family: Inter, Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #181818;
        color: #ffffff;
      }}
      * {{
        box-sizing: border-box;
      }}
      body {{
        min-width: 320px;
        min-height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2.5rem 1.5rem;
        background: #181818;
      }}
      main {{
        width: min(28rem, 100%);
      }}
      .brand {{
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 2.5rem;
        color: #ffffff;
      }}
      .brand-mark {{
        display: flex;
        width: 2rem;
        height: 2rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
      }}
      .brand-name {{
        font-size: 0.875rem;
        font-weight: 650;
      }}
      .status {{
        display: inline-flex;
        max-width: 100%;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
        border-radius: 0.375rem;
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 500;
      }}
      .status::before {{
        content: "";
        width: 0.375rem;
        height: 0.375rem;
        flex-shrink: 0;
        border-radius: 999px;
        background: currentColor;
      }}
      .tone-neutral {{
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.71);
      }}
      .tone-success {{
        background: rgba(64, 201, 119, 0.14);
        color: #40c977;
      }}
      .tone-error {{
        background: rgba(250, 66, 62, 0.12);
        color: #fa423e;
      }}
      h1 {{
        margin: 0;
        color: #ffffff;
        font-size: 1.5rem;
        line-height: 1.2;
        font-weight: 650;
      }}
      p {{
        margin: 0;
        color: rgba(255, 255, 255, 0.71);
        font-size: 0.875rem;
        line-height: 1.6;
      }}
      #status-text {{
        margin-top: 0.75rem;
      }}
      .detail {{
        margin-top: 0.75rem;
      }}
      .recovery {{
        display: none;
        margin-top: 2rem;
      }}
      .recovery[data-visible="true"] {{
        display: block;
      }}
      .action {{
        display: inline-flex;
        min-height: 2.25rem;
        width: 100%;
        align-items: center;
        justify-content: center;
        border-radius: 0.375rem;
        padding: 0.5rem 1rem;
        background: #ffffff;
        color: #181818;
        font-size: 0.875rem;
        font-weight: 600;
        text-decoration: none;
        transition: opacity 0.15s ease;
      }}
      .action:hover {{
        opacity: 0.86;
      }}
      .hint {{
        margin-top: 0.75rem;
      }}
    </style>
{launch_script}
  </head>
  <body>
    <main>
      <div class="brand" aria-label="Proliferate">
        <span class="brand-mark">
{_PROLIFERATE_MARK_SVG}
        </span>
        <span class="brand-name">Proliferate</span>
      </div>
      <div class="status tone-{safe_tone}">{escaped_status_label}</div>
      <h1>{escaped_title}</h1>
      <p id="status-text">{escaped_message}</p>{detail_block}
{action_block}
    </main>
  </body>
</html>"""


def _render_action_block(
    *,
    action_label: str | None,
    action_href: str | None,
    action_visible: bool,
    action_hint: str | None,
) -> str:
    if not action_label and not action_hint:
        return ""

    visible = "true" if action_visible else "false"
    link = ""
    if action_label and action_href:
        link = f"""
        <a class="action" href="{escape(action_href, quote=True)}">{escape(action_label)}</a>"""
    hint = (
        f"""
        <p class="hint">{escape(action_hint)}</p>"""
        if action_hint
        else ""
    )
    return f"""
      <div class="recovery" id="recovery" data-visible="{visible}">{link}{hint}
      </div>"""


def _render_handoff_action_block(
    *,
    action_label: str | None,
    action_href: str | None,
) -> str:
    if not action_label or not action_href:
        return ""

    return f"""
      <div class="recovery" id="recovery" data-visible="true">
        <a class="action" href="{escape(action_href, quote=True)}" aria-label="{escape(action_label, quote=True)}">Click here if not redirected</a>
      </div>"""


def _render_launch_script(
    *,
    launch_url: str | None,
    fallback_message: str | None,
    reveal_action_after_ms: int,
) -> str:
    if not launch_url:
        return ""

    fallback_json = json.dumps(fallback_message) if fallback_message else "null"
    return f"""
    <script>
      window.addEventListener("load", () => {{
        const launchUrl = {json.dumps(launch_url)};
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


_PROLIFERATE_MARK_SVG = """        <svg viewBox="300 300 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" width="32" height="32" aria-hidden="true">
          <rect x="375" y="375" width="50" height="50" fill="currentColor" />
          <rect x="387.67" y="305" width="24.67" height="24.67" fill="currentColor" />
          <rect x="429" y="346.33" width="24.67" height="24.67" fill="currentColor" />
          <rect x="470.33" y="387.67" width="24.67" height="24.67" fill="currentColor" />
          <rect x="429" y="429" width="24.67" height="24.67" fill="currentColor" />
          <rect x="387.67" y="470.33" width="24.67" height="24.67" fill="currentColor" />
          <rect x="346.33" y="429" width="24.67" height="24.67" fill="currentColor" />
          <rect x="305" y="387.67" width="24.67" height="24.67" fill="currentColor" />
          <rect x="346.33" y="346.33" width="24.67" height="24.67" fill="currentColor" />
        </svg>"""
