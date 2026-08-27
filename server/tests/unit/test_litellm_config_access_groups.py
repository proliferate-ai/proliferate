"""Config-as-contract tests for the deployed LiteLLM proxy config.

Enforces the model-gateway spec's access-group law (R1, agents-impl-plan.md
§4 B1): every `model_list` entry must carry `model_info.access_groups`, group
names are exactly harness `harness_kind` identifiers, and `cursor` — which has
no gateway recipe (native-only) — must never appear in any entry's groups.

`server/litellm/config.yaml` is the one deployed config (dev and prod both
run it as-is; see model-gateway.md "The artifact"), so this is a pure static
check of a reviewed YAML file — no LiteLLM proxy involved.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from proliferate.constants.agent_gateway import AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS
from proliferate.server.catalogs.service import registry_gateway_capable_kinds

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "litellm" / "config.yaml"

# cursor is explicitly excluded from AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS
# (no gateway route exists for it); the config must never grant it a model
# access group.
_CURSOR_HARNESS_KIND = "cursor"


def _load_model_list() -> list[dict[str, Any]]:
    with _CONFIG_PATH.open() as handle:
        document = yaml.safe_load(handle)
    model_list = document["model_list"]
    assert isinstance(model_list, list)
    assert model_list, "config.yaml model_list must not be empty"
    return model_list


class TestLitellmConfigAccessGroups:
    def test_every_model_carries_access_groups(self) -> None:
        for entry in _load_model_list():
            model_info = entry.get("model_info")
            assert isinstance(model_info, dict), (
                f"{entry.get('model_name')} is missing model_info.access_groups"
            )
            access_groups = model_info.get("access_groups")
            assert isinstance(access_groups, list) and access_groups, (
                f"{entry.get('model_name')} has no access_groups"
            )

    def test_access_group_names_are_exactly_harness_kinds(self) -> None:
        allowed = set(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)
        for entry in _load_model_list():
            access_groups = entry["model_info"]["access_groups"]
            unknown = set(access_groups) - allowed
            assert not unknown, (
                f"{entry['model_name']} carries unknown access group(s) {unknown}; "
                f"group names must be exactly a harness_kind in {sorted(allowed)}"
            )

    def test_cursor_is_never_granted_a_model(self) -> None:
        # cursor is native-only (no gateway recipe) until it has one; a virtual
        # key must never be mintable with a `cursor` group because no model
        # would ever be scoped to it accidentally.
        for entry in _load_model_list():
            access_groups = entry["model_info"]["access_groups"]
            assert _CURSOR_HARNESS_KIND not in access_groups, (
                f"{entry['model_name']} must not carry the cursor access group"
            )

    def test_gateway_capable_constant_matches_registry_derivation(self) -> None:
        # registry.json is the allow-list authority (agent-auth.md FR-4): the
        # access-group check is anchored to the registry gateway derivation,
        # not just the Python constant, so a config that drifts from the
        # registry cannot pass by drifting the constant with it.
        assert set(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS) == set(
            registry_gateway_capable_kinds()
        )

    def test_yaml_groups_are_a_subset_of_registry_gateway_capable_kinds(self) -> None:
        registry_capable = set(registry_gateway_capable_kinds())
        granted: set[str] = set()
        for entry in _load_model_list():
            granted.update(entry["model_info"]["access_groups"])
        unknown = granted - registry_capable
        assert not unknown, (
            f"config.yaml grants access group(s) {unknown} that are not "
            f"gateway-capable in the registry {sorted(registry_capable)}"
        )

    def test_codex_current_default_family_is_granted(self) -> None:
        # The CLI-default drift class both 403 incidents shared: a harness's
        # CURRENT default model missing from its access group 403s every
        # gateway launch out of the box ("key can only access models=[...]").
        # codex's default is gpt-5.6-sol (scripts/agent-catalog/generated/
        # codex.openai-api.probe.json, baselineConfigOptions[id=model]
        # .currentValue — the oauth probe agrees), so the whole 5.6-era
        # option family must be granted to the codex group.
        granted_to_codex = {
            entry["model_name"]
            for entry in _load_model_list()
            if "codex" in entry["model_info"]["access_groups"]
        }
        for model_name in (
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.5-2026-04-23",  # the dated alias resolves to the same upstream
        ):
            assert model_name in granted_to_codex, (
                f"{model_name} (codex's current default model family) must be "
                "granted to the codex access group, or every codex gateway "
                "launch 403s"
            )

    def test_claude_current_default_is_granted(self) -> None:
        # The same drift class, pinned on the incident that defined it
        # (PR #2249): claude-sonnet-5 is Claude Code's current default; its
        # absence 403'd every funded gateway launch.
        granted_to_claude = {
            entry["model_name"]
            for entry in _load_model_list()
            if "claude" in entry["model_info"]["access_groups"]
        }
        assert "claude-sonnet-5" in granted_to_claude, (
            "claude-sonnet-5 (Claude Code's current default) must be granted "
            "to the claude access group, or every claude gateway launch 403s"
        )

    def test_every_supported_harness_has_at_least_one_model(self) -> None:
        # Every gateway-capable harness_kind (AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS,
        # which excludes cursor — it has no gateway recipe) must be able to
        # resolve at least one model once it is granted its group.
        granted: set[str] = set()
        for entry in _load_model_list():
            granted.update(entry["model_info"]["access_groups"])
        missing = set(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS) - granted
        assert not missing, f"harness kinds with zero gateway models: {missing}"
