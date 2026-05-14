from __future__ import annotations

import json
from html import escape

from fastapi.responses import HTMLResponse

PROLIFERATE_MARK = """
        <svg viewBox="300 300 200 200" fill="none"
          xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"
          width="42" height="42" aria-hidden="true">
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


def make_redirect_page(
    *,
    title: str,
    message: str,
    eyebrow: str | None = None,
    detail: str | None = None,
    action_url: str | None = None,
    action_label: str = "Open Proliferate",
    action_visible: bool = True,
    launch_action_on_load: bool = False,
    delayed_status_message: str | None = None,
    hint: str | None = None,
    close_after_ms: int | None = None,
) -> HTMLResponse:
    safe_title = escape(title)
    safe_message = escape(message)
    safe_eyebrow = escape(eyebrow) if eyebrow else ""
    safe_detail = escape(detail) if detail else ""
    safe_action_label = escape(action_label)
    safe_hint = escape(hint) if hint else ""
    safe_action_href = escape(action_url, quote=True) if action_url else ""
    action_json = _json_for_script(action_url) if action_url else "null"
    delayed_status_json = (
        _json_for_script(delayed_status_message) if delayed_status_message else "null"
    )
    recovery_visible = "true" if action_url and action_visible else "false"
    action_block = _action_block(
        href=safe_action_href,
        label=safe_action_label,
        visible=recovery_visible,
        hint=safe_hint,
    ) if action_url else _hint_block(safe_hint)
    launch_script = _launch_script(
        action_json=action_json,
        delayed_status_json=delayed_status_json,
    ) if action_url and launch_action_on_load else ""
    close_script = _close_script(close_after_ms) if close_after_ms is not None else ""
    eyebrow_block = f'<p class="eyebrow">{safe_eyebrow}</p>' if eyebrow else ""
    detail_block = f'<p class="detail">{safe_detail}</p>' if detail else ""

    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{safe_title}</title>
    <style>
      :root {{
        color-scheme: light dark;
        font-family: Inter, "Geist", ui-sans-serif, system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f6f3;
        color: #24211f;
        --page-bg: #f7f6f3;
        --page-bg-soft: #ffffff;
        --text: #24211f;
        --muted: #706a64;
        --border: rgba(36, 33, 31, 0.12);
        --button-bg: #24211f;
        --button-text: #ffffff;
        --line: rgba(36, 33, 31, 0.08);
      }}
      @media (prefers-color-scheme: dark) {{
        :root {{
          background: #14110f;
          color: #f2eee9;
          --page-bg: #14110f;
          --page-bg-soft: #1c1815;
          --text: #f2eee9;
          --muted: #a49b93;
          --border: rgba(242, 238, 233, 0.12);
          --button-bg: #f2eee9;
          --button-text: #211d1a;
          --line: rgba(242, 238, 233, 0.08);
        }}
      }}
      * {{
        box-sizing: border-box;
      }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 2rem;
        background:
          linear-gradient(180deg, transparent 0, var(--line) 1px, transparent 1px) 0 0 / 100% 4rem,
          var(--page-bg);
      }}
      main {{
        width: min(31rem, 100%);
      }}
      .brand {{
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 2.25rem;
        color: var(--text);
      }}
      .brand-name {{
        font-size: clamp(1.8rem, 9vw, 2.75rem);
        font-weight: 520;
        letter-spacing: 0.025em;
        line-height: 1;
      }}
      .panel {{
        border: 1px solid var(--border);
        border-radius: 18px;
        background: color-mix(in oklab, var(--page-bg-soft) 92%, transparent);
        padding: 1.25rem;
      }}
      .eyebrow {{
        margin: 0 0 0.625rem;
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }}
      h1 {{
        margin: 0 0 0.75rem;
        color: var(--text);
        font-size: 1.25rem;
        font-weight: 560;
        letter-spacing: 0;
      }}
      p {{
        margin: 0;
        color: var(--muted);
        font-size: 0.875rem;
        line-height: 1.55;
      }}
      .detail,
      .hint {{
        margin-top: 0.75rem;
      }}
      .recovery {{
        display: none;
        margin-top: 1.25rem;
      }}
      .recovery[data-visible="true"] {{
        display: block;
      }}
      .action {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 2.5rem;
        border-radius: 0.5rem;
        padding: 0.625rem 0.875rem;
        background: var(--button-bg);
        color: var(--button-text);
        font-size: 0.875rem;
        font-weight: 560;
        text-decoration: none;
      }}
      .action:hover {{
        opacity: 0.9;
      }}
      .action:focus-visible {{
        outline: 2px solid color-mix(in oklab, var(--button-bg) 45%, transparent);
        outline-offset: 3px;
      }}
    </style>
{launch_script}
{close_script}
  </head>
  <body>
    <main>
      <div class="brand" aria-label="Proliferate">
{PROLIFERATE_MARK}
        <span class="brand-name">PROLIFERATE</span>
      </div>
      <section class="panel" aria-labelledby="redirect-title">
        {eyebrow_block}
        <h1 id="redirect-title">{safe_title}</h1>
        <p id="status-text">{safe_message}</p>
        {detail_block}
{action_block}
      </section>
    </main>
  </body>
</html>"""
    )


def _json_for_script(value: str | None) -> str:
    return (
        json.dumps(value)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _action_block(*, href: str, label: str, visible: str, hint: str) -> str:
    hint_block = f'\n        <p class="hint">{hint}</p>' if hint else ""
    return f"""
        <div class="recovery" id="recovery" data-visible="{visible}">
          <a class="action" href="{href}">{label}</a>{hint_block}
        </div>"""


def _hint_block(hint: str) -> str:
    if not hint:
        return ""
    return f"""
        <div class="recovery" id="recovery" data-visible="true">
          <p class="hint">{hint}</p>
        </div>"""


def _launch_script(*, action_json: str, delayed_status_json: str) -> str:
    return f"""
    <script>
      window.addEventListener("load", () => {{
        const deepLinkUrl = {action_json};
        const delayedStatusText = {delayed_status_json};
        const recovery = document.getElementById("recovery");
        const statusText = document.getElementById("status-text");

        window.location.replace(deepLinkUrl);

        window.setTimeout(() => {{
          if (recovery) {{
            recovery.dataset.visible = "true";
          }}
          if (statusText && delayedStatusText) {{
            statusText.textContent = delayedStatusText;
          }}
        }}, 1500);
      }});
    </script>"""


def _close_script(delay_ms: int) -> str:
    return f"""
    <script>
      window.addEventListener("load", () => {{
        window.setTimeout(() => window.close(), {delay_ms});
      }});
    </script>"""
