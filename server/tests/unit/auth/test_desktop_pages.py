from __future__ import annotations

from proliferate.auth.desktop.pages import (
    make_desktop_handoff_page,
    make_desktop_provider_error_page,
)


def test_handoff_page_renders_provider_specific_title() -> None:
    page = make_desktop_handoff_page(
        provider="google",
        deep_link_url="proliferate://auth/callback?code=abc&state=xyz",
        launch_deep_link=True,
    )

    assert "Google sign-in done" in page.body.decode()


def test_error_page_emits_tone_error() -> None:
    page = make_desktop_provider_error_page(
        provider="github",
        deep_link_url="proliferate://auth/callback?error=access_denied&state=xyz",
        launch_deep_link=True,
        error="access_denied",
    )

    assert 'class="status tone-error"' in page.body.decode()


def test_error_page_embeds_deep_link_in_launch_script_and_anchor() -> None:
    deep_link_url = "proliferate://auth/callback?error=access_denied"
    page = make_desktop_provider_error_page(
        provider="github",
        deep_link_url=deep_link_url,
        launch_deep_link=True,
        error="access_denied",
    )
    body = page.body.decode()

    assert "window.location.replace" in body
    assert deep_link_url in body
    assert f'href="{deep_link_url}"' in body


def test_error_page_renders_generic_detail_for_hostile_error_string() -> None:
    hostile = "<script>alert(1)</script>"
    page = make_desktop_provider_error_page(
        provider="github",
        deep_link_url="proliferate://auth/callback?error=hostile&state=xyz",
        launch_deep_link=True,
        error=hostile,
    )
    body = page.body.decode()

    assert hostile not in body
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" not in body
    assert "The provider reported an error." in body


def test_error_page_echoes_well_formed_error_code() -> None:
    page = make_desktop_provider_error_page(
        provider="github",
        deep_link_url="proliferate://auth/callback?error=access_denied&state=xyz",
        launch_deep_link=True,
        error="access_denied",
    )
    body = page.body.decode()

    assert "The provider returned: access_denied" in body


def test_error_page_drops_launch_url_when_launch_deep_link_disabled() -> None:
    deep_link_url = "proliferate://auth/callback?error=access_denied"
    page = make_desktop_provider_error_page(
        provider="github",
        deep_link_url=deep_link_url,
        launch_deep_link=False,
        error="access_denied",
    )
    body = page.body.decode()

    assert "window.location.replace" not in body
    assert f'href="{deep_link_url}"' in body
