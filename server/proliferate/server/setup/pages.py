"""Server-rendered HTML for the first-run /setup page.

Deliberately a plain HTML document with inline styles and no JavaScript: it
must work in any browser before anything else is installed, and it must never
depend on the desktop bundle or an SPA build.
"""

from __future__ import annotations

import html

from proliferate.server.organizations.domain.profile import default_organization_name

_PAGE_STYLE = """
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      Helvetica, Arial, sans-serif;
    background: #f5f5f4;
    color: #1c1917;
    margin: 0;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    .card { background: #292524 !important; border-color: #44403c !important; }
    input { background: #1c1917 !important; color: #fafaf9 !important;
            border-color: #57534e !important; }
  }
  .card {
    background: #ffffff;
    border: 1px solid #e7e5e4;
    border-radius: 12px;
    padding: 32px;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; font-size: 14px; opacity: 0.7; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 4px; }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 10px;
    font-size: 14px;
    border: 1px solid #d6d3d1;
    border-radius: 8px;
  }
  button {
    margin-top: 22px;
    width: 100%;
    padding: 10px;
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
    background: #1c1917;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .error {
    margin: 0 0 12px;
    padding: 10px 12px;
    font-size: 13px;
    border-radius: 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }
  .hint { font-size: 12px; opacity: 0.6; margin-top: 4px; }
"""


def render_page(title: str, body: str) -> str:
    """The shared shell for server-rendered pages (also used by /register)."""
    return (
        "<!doctype html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="robots" content="noindex">\n'
        f"<title>{html.escape(title)}</title>\n"
        f"<style>{_PAGE_STYLE}</style>\n"
        "</head>\n"
        "<body>\n"
        f'<main class="card">\n{body}\n</main>\n'
        "</body>\n"
        "</html>\n"
    )


def _organization_name_placeholder(email: str) -> str:
    """The derived default the organization name falls back to when blank."""
    if email.strip():
        return default_organization_name(email=email, display_name=None)
    return "Derived from your email domain"


def render_setup_form(
    *,
    error: str | None = None,
    email: str = "",
    organization_name: str = "",
) -> str:
    error_html = f'<p class="error">{html.escape(error)}</p>\n' if error else ""
    name_placeholder = _organization_name_placeholder(email)
    body = (
        "<h1>Set up Proliferate</h1>\n"
        '<p class="sub">Create the first account for this instance. '
        "This account becomes the owner.</p>\n"
        f"{error_html}"
        '<form method="post" action="setup">\n'
        '<label for="email">Email</label>\n'
        '<input id="email" name="email" type="email" autocomplete="email" required '
        f'value="{html.escape(email, quote=True)}">\n'
        '<label for="password">Password</label>\n'
        '<input id="password" name="password" type="password" '
        'autocomplete="new-password" required>\n'
        '<label for="organization_name">Organization name</label>\n'
        '<input id="organization_name" name="organization_name" type="text" '
        'autocomplete="organization" '
        f'placeholder="{html.escape(name_placeholder, quote=True)}" '
        f'value="{html.escape(organization_name, quote=True)}">\n'
        '<p class="hint">Optional. Leave blank to use a name derived from '
        "your email domain.</p>\n"
        '<label for="setup_token">Setup token</label>\n'
        '<input id="setup_token" name="setup_token" type="text" '
        'autocomplete="off" spellcheck="false" required>\n'
        '<p class="hint">Printed by bootstrap.sh on the server.</p>\n'
        '<button type="submit">Claim this instance</button>\n'
        "</form>"
    )
    return render_page("Set up Proliferate", body)


def render_setup_success(email: str) -> str:
    body = (
        "<h1>You are all set</h1>\n"
        '<p class="sub">This instance now belongs to '
        f"<strong>{html.escape(email)}</strong>.</p>\n"
        "<p>Open the Proliferate desktop app and sign in with your email and "
        "password.</p>\n"
        '<p class="hint">Setup is now closed. Invite teammates from inside '
        "the app.</p>"
    )
    return render_page("Proliferate setup complete", body)


def render_setup_not_found() -> str:
    body = '<h1>Not found</h1>\n<p class="sub">There is nothing to set up here.</p>'
    return render_page("Not found", body)
