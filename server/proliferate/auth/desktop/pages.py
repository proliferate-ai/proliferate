"""HTML handoff pages for the desktop browser auth flow.

These minimal pages are rendered server-side during the OAuth callback to hand
control back to the desktop app via deep-link or recovery polling.
"""

import json
from html import escape

from fastapi.responses import HTMLResponse


def make_browser_flow_page(*, title: str, message: str) -> HTMLResponse:
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
        font-family: Geist, system-ui, sans-serif;
        background: #151210;
        color: #f0ebe6;
      }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(222, 186, 147, 0.16), transparent 42%),
          #151210;
      }}
      main {{
        width: min(28rem, calc(100vw - 2rem));
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 24px;
        background: rgba(31, 26, 24, 0.88);
        padding: 2rem;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        text-align: center;
      }}
      h1 {{
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
      }}
      p {{
        margin: 0;
        color: rgba(240, 235, 230, 0.72);
        line-height: 1.6;
      }}
    </style>
    <script>
      window.addEventListener("load", () => {{
        setTimeout(() => window.close(), 250);
      }});
    </script>
  </head>
  <body>
    <main>
      <h1>{title}</h1>
      <p>{message}</p>
    </main>
  </body>
</html>"""
    )


def make_desktop_handoff_page(*, deep_link_url: str, launch_deep_link: bool) -> HTMLResponse:
    escaped_href = escape(deep_link_url, quote=True)
    deep_link_json = json.dumps(deep_link_url)
    title = "Opening Proliferate..." if launch_deep_link else "Return to Proliferate"
    status_text = (
        "Your GitHub session is verified. Proliferate should take over from here."
        if launch_deep_link
        else "Your GitHub session is verified. Return to Proliferate and it will unlock shortly."
    )
    recovery_block = (
        f"""
      <div class="recovery" id="recovery" data-visible="false">
        <a class="action" href="{escaped_href}">Open Proliferate again</a>
        <p class="hint">
          Keep this tab open if you want Proliferate's recovery polling to finish the sign-in instead.
        </p>
      </div>"""
        if launch_deep_link
        else """
      <div class="recovery" id="recovery" data-visible="true">
        <p class="hint">
          Native deep-link launch is disabled in this environment, so Proliferate will
          finish the sign-in from its recovery polling instead.
        </p>
      </div>"""
    )
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
              "If Proliferate did not open automatically, use the button below or " +
              "return to the app. Proliferate can still finish the sign-in from " +
              "this browser callback.";
          }}
        }}, 1500);
      }});
    </script>"""
        if launch_deep_link
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
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: hsl(24 10% 7%);
      }}
      main {{
        width: min(28rem, 100%);
      }}
      .brand {{
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 2.5rem;
        color: hsl(30 8% 91%);
      }}
      .brand-name {{
        font-family: Inter, "Geist", system-ui, sans-serif;
        font-size: 2.75rem;
        font-weight: 500;
        letter-spacing: 0.025em;
      }}
      h1 {{
        margin: 0 0 0.75rem;
        font-size: 1.125rem;
        font-weight: 500;
      }}
      p {{
        margin: 0;
        color: hsl(23 5% 63%);
        font-size: 0.8125rem;
        line-height: 1.5;
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
        margin-top: 1rem;
        border-radius: 0.375rem;
        padding: 0.75rem;
        background: hsl(30 8% 91%);
        color: hsl(25 8% 16%);
        font-size: 0.8125rem;
        font-weight: 500;
        text-decoration: none;
        transition: opacity 0.15s;
      }}
      .action:hover {{
        opacity: 0.9;
      }}
      .hint {{
        margin-top: 0.75rem;
        font-size: 0.8125rem;
      }}
    </style>
{launch_script}
  </head>
  <body>
    <main>
      <div class="brand">
        <svg viewBox="300 300 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" width="44" height="44">
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
      <h1>{title}</h1>
      <p id="status-text">
        {status_text}
      </p>
{recovery_block}
    </main>
  </body>
</html>"""
    )
