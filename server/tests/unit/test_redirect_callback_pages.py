from __future__ import annotations

import json
import re
from itertools import product
from typing import cast

import pytest
from fastapi.responses import HTMLResponse

from proliferate.lib.product.redirect_callbacks.launch import render_launch_script
from proliferate.lib.product.redirect_callbacks.page import (
    RedirectCallbackTone,
    RedirectCallbackVariant,
    render_redirect_callback_page,
)


@pytest.mark.parametrize("tone", ["neutral", "success", "error"])
def test_default_page_renders_each_tone(tone: RedirectCallbackTone) -> None:
    page = render_redirect_callback_page(
        title="Callback",
        status_label="Status",
        message="Message",
        tone=tone,
    )

    assert f'class="status tone-{tone}"' in page


def test_invalid_runtime_tone_and_variant_fall_back_to_default_page() -> None:
    page = render_redirect_callback_page(
        title="Callback",
        status_label="Status",
        message="Message",
        tone=cast(RedirectCallbackTone, "warning"),
        variant=cast(RedirectCallbackVariant, "unknown"),
    )

    assert 'class="brand"' in page
    assert 'class="status tone-neutral"' in page
    assert 'class="braille"' not in page


def test_default_page_escapes_text_and_action_attribute_contexts() -> None:
    page = render_redirect_callback_page(
        title='<Title & "quoted">',
        status_label='<Status & "quoted">',
        message='<Message & "quoted">',
        detail='<Detail & "quoted">',
        action_label='<Open & "quoted">',
        action_href='proliferate://callback?value=<tag>&quote="yes"',
        action_hint='<Hint & "quoted">',
    )

    assert "<title>&lt;Title &amp; &quot;quoted&quot;&gt;</title>" in page
    assert "&lt;Status &amp; &quot;quoted&quot;&gt;" in page
    assert "&lt;Message &amp; &quot;quoted&quot;&gt;" in page
    assert '<p class="detail">&lt;Detail &amp; &quot;quoted&quot;&gt;</p>' in page
    assert "&lt;Open &amp; &quot;quoted&quot;&gt;" in page
    assert 'href="proliferate://callback?value=&lt;tag&gt;&amp;quote=&quot;yes&quot;"' in page
    assert '<p class="hint">&lt;Hint &amp; &quot;quoted&quot;&gt;</p>' in page


@pytest.mark.parametrize(
    ("has_label", "has_href", "has_hint", "action_visible"),
    list(product([False, True], repeat=4)),
)
def test_default_action_block_prerequisites_and_visibility(
    has_label: bool,
    has_href: bool,
    has_hint: bool,
    action_visible: bool,
) -> None:
    page = render_redirect_callback_page(
        title="Callback",
        status_label="Status",
        message="Message",
        action_label="Open" if has_label else None,
        action_href="proliferate://callback" if has_href else None,
        action_hint="Try again" if has_hint else None,
        action_visible=action_visible,
    )
    has_block = has_label or has_hint
    has_link = has_label and has_href

    assert ('id="recovery"' in page) is has_block
    assert ('<a class="action"' in page) is has_link
    assert ('<p class="hint">Try again</p>' in page) is has_hint
    if has_block:
        expected_visibility = "true" if action_visible else "false"
        assert f'data-visible="{expected_visibility}"' in page


@pytest.mark.parametrize("detail", [None, ""])
def test_falsey_detail_is_omitted(detail: str | None) -> None:
    page = render_redirect_callback_page(
        title="Callback",
        status_label="Status",
        message="Message",
        detail=detail,
    )

    assert '<p class="detail">' not in page


def test_handoff_page_preserves_its_distinct_copy_and_ignored_fields() -> None:
    page = render_redirect_callback_page(
        title="Handoff",
        status_label="Must not render",
        message="Opening the app",
        tone="error",
        detail="Keep this tab open",
        action_label='<Open & "label">',
        action_href='proliferate://callback?value=<tag>&quote="yes"',
        action_visible=False,
        action_hint="Must not render either",
        launch_url="proliferate://callback",
        fallback_message="Ignored fallback",
        variant="handoff",
    )

    assert 'class="braille"' in page
    assert 'class="brand"' not in page
    assert "Must not render" not in page
    assert "Must not render either" not in page
    assert "Ignored fallback" not in page
    assert "const fallbackMessage = null;" in page
    assert '<p class="detail">Keep this tab open</p>' in page
    assert 'data-visible="true"' in page
    assert "Click here if not redirected" in page
    assert 'aria-label="&lt;Open &amp; &quot;label&quot;&gt;"' in page
    assert 'href="proliferate://callback?value=&lt;tag&gt;&amp;quote=&quot;yes&quot;"' in page


@pytest.mark.parametrize(
    ("action_label", "action_href", "has_action"),
    [
        (None, None, False),
        ("Open", None, False),
        (None, "proliferate://callback", False),
        ("Open", "proliferate://callback", True),
    ],
)
def test_handoff_action_requires_both_label_and_href(
    action_label: str | None,
    action_href: str | None,
    has_action: bool,
) -> None:
    page = render_redirect_callback_page(
        title="Handoff",
        status_label="Status",
        message="Opening the app",
        action_label=action_label,
        action_href=action_href,
        variant="handoff",
    )

    assert ('id="recovery"' in page) is has_action


@pytest.mark.parametrize("launch_url", [None, ""])
def test_falsey_launch_url_omits_script(launch_url: str | None) -> None:
    assert (
        render_launch_script(
            launch_url=launch_url,
            fallback_message="Fallback",
            reveal_action_after_ms=1500,
        )
        == ""
    )


@pytest.mark.parametrize("fallback_message", [None, ""])
def test_launch_script_preserves_navigation_timeout_and_falsey_fallback(
    fallback_message: str | None,
) -> None:
    script = render_launch_script(
        launch_url="proliferate://callback",
        fallback_message=fallback_message,
        reveal_action_after_ms=-25,
    )

    assert 'const launchUrl = "proliferate://callback";' in script
    assert "const fallbackMessage = null;" in script
    assert script.index("window.location.replace(launchUrl);") < script.index("window.setTimeout")
    assert 'recovery.dataset.visible = "true";' in script
    assert "if (fallbackMessage && statusText)" in script
    assert "statusText.textContent = fallbackMessage;" in script
    assert "}, -25);" in script


def test_inline_script_json_cannot_emit_payload_closing_tag() -> None:
    launch_url = 'proliferate://callback/"\\&<>\u2603\n</ScRiPt><script>'
    fallback_message = 'Fallback "\\&<>\u2603\n</SCRIPT><script>'
    script = render_launch_script(
        launch_url=launch_url,
        fallback_message=fallback_message,
        reveal_action_after_ms=2750,
    )
    launch_match = re.search(r"const launchUrl = (.+);", script)
    fallback_match = re.search(r"const fallbackMessage = (.+);", script)

    assert launch_match is not None
    assert fallback_match is not None
    launch_literal = launch_match.group(1)
    fallback_literal = fallback_match.group(1)
    assert not {"<", ">", "&"}.intersection(launch_literal)
    assert not {"<", ">", "&"}.intersection(fallback_literal)
    assert json.loads(launch_literal) == launch_url
    assert json.loads(fallback_literal) == fallback_message
    assert len(re.findall(r"</script\s*>", script, flags=re.IGNORECASE)) == 1
    assert "}, 2750);" in script


def test_local_html_response_preserves_rendered_body_and_defaults() -> None:
    page = render_redirect_callback_page(
        title="Callback",
        status_label="Complete",
        message="Return to the app",
    )
    response = HTMLResponse(page)

    assert response.status_code == 200
    assert response.media_type == "text/html"
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert response.body == page.encode()
