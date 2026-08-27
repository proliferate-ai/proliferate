"""Provider-config field translation for the state renderer (split of
``state_render.py``'s translation table — the renderer imports it back, so the
wire shape is still decided in one place).

Generic vault fields -> a harness's real env-var names, mirroring
registry.json's ``providerConfig[].envVars`` vocabulary exactly (D3 brief
§4.2's ruled table). Pure functions, no I/O, no logging: an unsupported or
pending combination returns ``None`` so the renderer drops the source (and
names the refusal) rather than raising.
"""

from __future__ import annotations

from collections.abc import Mapping

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_AWS_BEDROCK,
    AGENT_API_KEY_KIND_AZURE_OPENAI,
)


def hostname_first_label(endpoint: str) -> str:
    """The Azure resource name: the first label of ``endpoint``'s hostname.

    Live-test-proven vocabulary (ledger 2026-07-26 opencode×azure entry):
    ``https://proliferate-gw-aoai.openai.azure.com`` (or a bare
    ``proliferate-gw-aoai.openai.azure.com``, or even a bare
    ``proliferate-gw-aoai``) -> ``proliferate-gw-aoai``. Tolerates a scheme, a
    path/query suffix, userinfo (``user@host``), a port, and a bare
    hostname/resource-name value (no scheme at all) uniformly by stripping a
    scheme if present, taking the host:port portion before any path,
    dropping any userinfo before ``@`` and any port after ``:``, then
    splitting on the first ``.``. D2's stored-vault ``endpoint`` field is
    never expected to carry userinfo or a port in practice, but this
    function's contract is "first label of the hostname", so it strips both
    rather than silently folding them into the returned label.
    """
    value = endpoint.strip()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0]
    if "@" in value:
        value = value.rsplit("@", 1)[1]
    value = value.split(":", 1)[0]
    return value.split(".", 1)[0]


def translate_provider_config_env(
    harness_kind: str,
    config_kind: str,
    fields: Mapping[str, str],
) -> dict[str, str] | None:
    """Generic vault fields -> this harness's real env-var names.

    Mirrors registry.json's ``providerConfig[].envVars`` vocabulary for
    (harness_kind, config_kind) EXACTLY -- this table's output keys must be
    the literal names D1 declared, or D3-rust's generic ``.set()`` loop
    silently emits the wrong variable. Returns ``None`` for an unsupported or
    pending combination so the caller drops the source (same as an
    unsatisfiable gateway/api_key source -- never raises).

    D3 brief §4.2's ruled table. One mapping — claude's ``azure_openai``
    (Foundry) row — is explicitly flagged as an unverified judgment call
    pending a Gate 4 live run (not a solved problem inherited from D1/D2):
    its vault entry has no field distinct from "resource" or "auth token"
    (see the brief's §0 contradiction writeup), so this row bundles two
    judgment calls rather than one settled fact — (1) the resource name is
    derived from `endpoint`'s hostname by analogy to opencode's
    live-test-proven `AZURE_RESOURCE_NAME` rule below, applied here to
    claude's `ANTHROPIC_FOUNDRY_RESOURCE` without its own live test, and
    (2) `ANTHROPIC_FOUNDRY_AUTH_TOKEN` is left unset, treating it and
    `ANTHROPIC_FOUNDRY_API_KEY` as alternatives (mirroring the existing
    `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` pair) rather than populating
    both. Gate 4's live claude×azure_openai run is what settles both; each
    is a one-line fix in the block below if the live run shows either
    backwards.
    """
    if config_kind == AGENT_API_KEY_KIND_AWS_BEDROCK:
        region = fields.get("region")
        bearer_token = fields.get("bearerToken")
        if not region or not bearer_token:
            return None
        if harness_kind == "claude":
            return {
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "AWS_BEARER_TOKEN_BEDROCK": bearer_token,
                "AWS_REGION": region,
            }
        if harness_kind in ("codex", "opencode"):
            return {
                "AWS_BEARER_TOKEN_BEDROCK": bearer_token,
                "AWS_REGION": region,
            }
        return None

    if config_kind == AGENT_API_KEY_KIND_AZURE_OPENAI:
        endpoint = fields.get("endpoint")
        api_key = fields.get("apiKey")
        if not endpoint or not api_key:
            return None
        if harness_kind == "claude":
            # Foundry: 3 vault fields (endpoint/deployment/apiKey) -> 4 env
            # vars. UNVERIFIED judgment call (brief §0/§4.2, §8 item 4): the
            # resource name is derived from endpoint's hostname (same rule as
            # opencode's proven AZURE_RESOURCE_NAME derivation below);
            # ANTHROPIC_FOUNDRY_AUTH_TOKEN is left unset, treating it and
            # ANTHROPIC_FOUNDRY_API_KEY as alternatives (mirrors the existing
            # ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN pair). Gate 4's live
            # claude×azure_openai run is what settles this; if it shows the
            # mapping backwards, swap which field populates which var.
            return {
                "CLAUDE_CODE_USE_FOUNDRY": "1",
                "ANTHROPIC_FOUNDRY_RESOURCE": hostname_first_label(endpoint),
                "ANTHROPIC_FOUNDRY_BASE_URL": endpoint,
                "ANTHROPIC_FOUNDRY_API_KEY": api_key,
            }
        if harness_kind == "opencode":
            # Live-test-proven (ledger 2026-07-26): AZURE_OPENAI_API_KEY is
            # dead code in the pinned opencode binary; AZURE_API_KEY +
            # AZURE_RESOURCE_NAME (bare resource name, derived from
            # endpoint's hostname) is the working pair. `deployment` is
            # deliberately NOT translated here -- it folds into a
            # `--model azure/<id>` launch argument, which is outside
            # state.json's env+files wire contract (brief §4.2/§8 item 3,
            # open question -- flagged, not solved, by this arm).
            return {
                "AZURE_API_KEY": api_key,
                "AZURE_RESOURCE_NAME": hostname_first_label(endpoint),
            }
        # codex×azure_openai: structurally excluded (D1 marked it `pending`;
        # `supported_provider_config_kinds` already excludes it from what a
        # selection may reference), but defend here too rather than trust
        # that gate alone -- a working codex arm needs config.toml
        # model_providers injection (D3-rust, gated on its own Gate 4 cell),
        # not a plain env map.
        return None

    return None
