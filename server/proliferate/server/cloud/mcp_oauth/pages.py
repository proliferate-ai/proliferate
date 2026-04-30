from __future__ import annotations

import json
from html import escape

from fastapi.responses import HTMLResponse

from proliferate.constants.auth import (
    DESKTOP_DEEP_LINK_LAUNCH_ENABLED,
    DESKTOP_REDIRECT_SCHEME,
)


def make_mcp_oauth_callback_page(*, ok: bool) -> HTMLResponse:
    status = "completed" if ok else "failed"
    deep_link_url = (
        f"{DESKTOP_REDIRECT_SCHEME}://plugins?source=mcp_oauth_callback&status={status}"
    )
    escaped_href = escape(deep_link_url, quote=True)
    deep_link_json = json.dumps(deep_link_url)
    title = "Authorization complete" if ok else "Authorization failed"
    message = (
        "Return to Proliferate to finish using this plugin."
        if ok
        else "Return to Proliferate and try connecting this plugin again."
    )
    detail = (
        "Your connection is saved. Proliferate will refresh the Plugins list automatically."
        if ok
        else (
            "No tokens were exposed in this browser page. The desktop app will show "
            "the latest connection state."
        )
    )
    recovery_visible = "false" if DESKTOP_DEEP_LINK_LAUNCH_ENABLED else "true"
    launch_script = (
        f"""
    <script>
      window.addEventListener("load", () => {{
        const deepLinkUrl = {deep_link_json};
        const recovery = document.getElementById("recovery");
        const statusText = document.getElementById("status-text");

        window.location.replace(deepLinkUrl);

        window.setTimeout(() => {{
          if (recovery) {{
            recovery.dataset.visible = "true";
          }}
          if (statusText) {{
            statusText.textContent =
              "If Proliferate did not open automatically, use the button below.";
          }}
        }}, 1500);
      }});
    </script>"""
        if DESKTOP_DEEP_LINK_LAUNCH_ENABLED
        else ""
    )
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <style>
      :root {{
        color-scheme: dark;
        font-family: Inter, "Geist", system-ui, sans-serif;
        background: hsl(24 10% 7%);
        color: hsl(30 8% 91%);
      }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: hsl(24 10% 7%);
      }}
      main {{
        width: min(30rem, 100%);
      }}
      .brand {{
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 2.5rem;
        color: hsl(30 8% 91%);
      }}
      .brand-name {{
        font-size: 2.75rem;
        font-weight: 500;
        letter-spacing: 0.025em;
      }}
      .eyebrow {{
        margin: 0 0 0.625rem;
        color: hsl(23 5% 63%);
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }}
      h1 {{
        margin: 0 0 0.75rem;
        font-size: 1.25rem;
        font-weight: 500;
      }}
      p {{
        margin: 0;
        color: hsl(23 5% 63%);
        font-size: 0.875rem;
        line-height: 1.55;
      }}
      .detail {{
        margin-top: 0.75rem;
      }}
      .recovery {{
        display: none;
        margin-top: 1.5rem;
      }}
      .recovery[data-visible="true"] {{
        display: block;
      }}
      .action {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        border-radius: 0.375rem;
        padding: 0.75rem;
        background: hsl(30 8% 91%);
        color: hsl(25 8% 16%);
        font-size: 0.875rem;
        font-weight: 500;
        text-decoration: none;
        transition: opacity 0.15s;
      }}
      .action:hover {{
        opacity: 0.9;
      }}
    </style>
{launch_script}
  </head>
  <body>
    <main>
      <div class="brand" aria-label="Proliferate">
        <svg viewBox="300 300 200 200" fill="none"
          xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"
          width="44" height="44">
          <rect x="375" y="375" width="50" height="50" fill="currentColor" />
          <rect x="387.67" y="305" width="24.67" height="24.67" fill="currentColor" />
          <rect x="429" y="346.33" width="24.67" height="24.67" fill="currentColor" />
          <rect x="470.33" y="387.67" width="24.67" height="24.67" fill="currentColor" />
          <rect x="429" y="429" width="24.67" height="24.67" fill="currentColor" />
          <rect x="387.67" y="470.33" width="24.67" height="24.67" fill="currentColor" />
          <rect x="346.33" y="429" width="24.67" height="24.67" fill="currentColor" />
          <rect x="305" y="387.67" width="24.67" height="24.67" fill="currentColor" />
          <rect x="346.33" y="346.33" width="24.67" height="24.67" fill="currentColor" />
        </svg>
        <span class="brand-name">PROLIFERATE</span>
      </div>
      <p class="eyebrow">Plugins</p>
      <h1>{title}</h1>
      <p id="status-text">{message}</p>
      <p class="detail">{detail}</p>
      <div class="recovery" id="recovery" data-visible="{recovery_visible}">
        <a class="action" href="{escaped_href}">Open Proliferate</a>
      </div>
    </main>
  </body>
</html>"""
    )
