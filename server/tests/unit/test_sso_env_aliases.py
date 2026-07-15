"""T1-SH-2 (specs/developing/testing/self-hosting.md): SSO env-var alias
equivalence sweep.

Every self-hosted SSO setting accepts two env names: the bare `SSO_*` form and
the namespaced `PROLIFERATE_SSO_*` form (config.py:107-202, via
`AliasChoices`). The self-hosting docs standardized on the bare form as
canonical, so an operator who copies a doc snippet with `SSO_CLIENT_ID=...`
must land in the exact same setting as the runtime that reads
`PROLIFERATE_SSO_CLIENT_ID=...`. This sweep guards that promise structurally
(every SSO field carries exactly the two-form pair) and functionally (both
forms populate the field identically), so a new SSO setting cannot ship with
only one alias — or with a mismatched prefix — without failing here.
"""

from __future__ import annotations

import pytest
from pydantic import AliasChoices

from proliferate.config import Settings

# The full set of SSO settings expected to carry the two-form alias pair. Locked
# so a new SSO var (or a dropped alias) trips this test and forces the canonical
# bare/prefixed pair to be added deliberately.
EXPECTED_SSO_ALIAS_FIELDS = frozenset(
    {
        "sso_enabled",
        "sso_protocol",
        "sso_display_name",
        "sso_login_policy",
        "sso_jit_policy",
        "sso_default_role",
        "sso_allowed_domains",
        "sso_oidc_issuer_url",
        "sso_oidc_discovery_url",
        "sso_oidc_authorization_endpoint",
        "sso_oidc_token_endpoint",
        "sso_oidc_jwks_uri",
        "sso_oidc_userinfo_endpoint",
        "sso_oidc_client_id",
        "sso_oidc_client_secret",
        "sso_oidc_scopes",
        "sso_oidc_token_endpoint_auth_method",
        "sso_oidc_callback_base_url",
        "sso_oidc_allow_private_provider_urls",
    }
)


def _sso_alias_pairs() -> dict[str, tuple[str, str]]:
    """Map each SSO settings field to its (bare `SSO_*`, prefixed
    `PROLIFERATE_SSO_*`) alias pair, discovered from the model itself."""
    pairs: dict[str, tuple[str, str]] = {}
    for name, field in Settings.model_fields.items():
        alias = field.validation_alias
        if not isinstance(alias, AliasChoices):
            continue
        choices = [str(choice) for choice in alias.choices]
        bare = [c for c in choices if c.startswith("SSO_")]
        prefixed = [c for c in choices if c.startswith("PROLIFERATE_SSO_")]
        if bare and prefixed:
            pairs[name] = (bare[0], prefixed[0])
    return pairs


def _all_sso_aliases() -> list[str]:
    aliases: list[str] = []
    for bare, prefixed in _sso_alias_pairs().values():
        aliases.extend((bare, prefixed))
    return aliases


def _build(monkeypatch: pytest.MonkeyPatch, alias: str, value: str) -> Settings:
    # Clear every SSO alias so a leaked ambient value can't taint the field
    # under test, then set exactly the one form we are exercising.
    for existing in _all_sso_aliases():
        monkeypatch.delenv(existing, raising=False)
    monkeypatch.setenv(alias, value)
    return Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-secret",
        cloud_secret_key="test-cloud-secret",
    )


def test_every_sso_field_carries_exactly_the_two_form_alias_pair() -> None:
    pairs = _sso_alias_pairs()
    assert set(pairs) == EXPECTED_SSO_ALIAS_FIELDS
    for name, (bare, prefixed) in pairs.items():
        # The prefixed form is the bare form with the PROLIFERATE_ namespace —
        # never a divergent spelling.
        assert prefixed == f"PROLIFERATE_{bare}", name
        # Exactly the two canonical forms, nothing else.
        choices = [str(c) for c in Settings.model_fields[name].validation_alias.choices]  # type: ignore[union-attr]
        assert set(choices) == {bare, prefixed}, name


def test_bare_and_prefixed_forms_populate_the_field_identically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, (bare, prefixed) in _sso_alias_pairs().items():
        is_bool = Settings.model_fields[name].annotation is bool
        raw_value = "true" if is_bool else f"sso-probe-{name}"
        expected = True if is_bool else raw_value

        from_bare = getattr(_build(monkeypatch, bare, raw_value), name)
        from_prefixed = getattr(_build(monkeypatch, prefixed, raw_value), name)

        assert from_bare == expected, f"{name} via {bare}"
        assert from_prefixed == expected, f"{name} via {prefixed}"
        assert from_bare == from_prefixed, name
