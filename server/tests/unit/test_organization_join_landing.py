"""Unit tests for the organization invite landing page's deep link.

The invite deep link must carry the issuing server's origin so a self-hosted
invitee's desktop can trust-confirm a switch instead of resolving the org id
against Cloud (see landing.py / self-hosting-v1 §3.5)."""

from __future__ import annotations

from urllib.parse import quote
from uuid import uuid4

import pytest

from proliferate.config import settings
from proliferate.server.organizations.landing import build_join_landing_html


def test_deep_link_embeds_url_encoded_frontend_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://proliferate.corp.example/")
    monkeypatch.setattr(settings, "api_base_url", "https://api.corp.example")

    organization_id = uuid4()
    html = build_join_landing_html("Acme", organization_id)

    encoded = quote("https://proliferate.corp.example", safe="")
    assert f"proliferate://join/{organization_id}?origin={encoded}" in html
    # frontend_base_url wins over api_base_url and the trailing slash is stripped.
    assert quote("https://api.corp.example", safe="") not in html


def test_deep_link_falls_back_to_api_base_url_when_no_frontend_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "")
    monkeypatch.setattr(settings, "api_base_url", "https://api.corp.example/")

    organization_id = uuid4()
    html = build_join_landing_html("Acme", organization_id)

    encoded = quote("https://api.corp.example", safe="")
    assert f"proliferate://join/{organization_id}?origin={encoded}" in html


def test_deep_link_omits_origin_when_no_base_url_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "")
    monkeypatch.setattr(settings, "api_base_url", "")

    organization_id = uuid4()
    html = build_join_landing_html("Acme", organization_id)

    assert f"proliferate://join/{organization_id}" in html
    assert "origin=" not in html
