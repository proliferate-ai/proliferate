"""Drift guard: the Python allow-list mirrors equal the registry derivation.

registry.json is the single allow-list authority (agent-auth.md FR-4). The
hand-tuples in constants/agent_gateway.py and selection_rules.py stay literals
(so constants/ keeps no runtime registry read, and the store->server import
boundary enforced by check_server_boundaries.py is untouched), but this test
fails the build the moment a literal and its registry derivation disagree. The
registry read helpers live in server/catalogs/service.py, next to the existing
catalog read machinery.
"""

from __future__ import annotations

from proliferate.constants.agent_gateway import (
    AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS,
    AGENT_AUTH_HARNESS_KINDS,
)
from proliferate.server.catalogs.service import (
    registry_gateway_capable_kinds,
    registry_harness_kinds,
    registry_multi_source_kinds,
    registry_single_source_kinds,
)
from proliferate.server.agent_auth.selection_rules import (
    MULTI_SOURCE_HARNESSES,
    SINGLE_SOURCE_HARNESSES,
)


def test_harness_kinds_mirror_matches_registry() -> None:
    assert set(AGENT_AUTH_HARNESS_KINDS) == set(registry_harness_kinds())


def test_gateway_capable_mirror_matches_registry() -> None:
    assert set(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS) == set(registry_gateway_capable_kinds())


def test_single_source_mirror_matches_registry() -> None:
    assert set(SINGLE_SOURCE_HARNESSES) == set(registry_single_source_kinds())


def test_multi_source_mirror_matches_registry() -> None:
    assert set(MULTI_SOURCE_HARNESSES) == set(registry_multi_source_kinds())


def test_single_and_multi_partition_every_kind() -> None:
    # Cardinality is total and disjoint: every declared harness is exactly one
    # of single/multi, so a new registry agent cannot silently escape both
    # mirrors.
    single = set(registry_single_source_kinds())
    multi = set(registry_multi_source_kinds())
    assert single.isdisjoint(multi)
    assert single | multi == set(registry_harness_kinds())
