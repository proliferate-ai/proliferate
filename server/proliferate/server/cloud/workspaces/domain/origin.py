"""Translate product request sources into AnyHarness origin entrypoints.

The cloud workspace API accepts a product-facing ``source`` (``desktop``,
``web``, ``mobile``) describing which client asked for the workspace. AnyHarness
records provenance with its own, narrower ``OriginEntrypoint`` vocabulary
(``desktop``, ``cloud``, ``local_runtime``, ``cowork``). Forwarding the raw
product source straight through makes AnyHarness reject ``web``/``mobile`` with
``422 unknown variant``. Origin is advisory read-model metadata, so the two
vocabularies are translated here at the owning boundary rather than leaking a
product value into the runtime contract.
"""

from __future__ import annotations

# AnyHarness OriginEntrypoint values (snake_case), from
# anyharness-contract/src/v1/origin.rs. Kept as a constant so the mapping below
# is validated against the real runtime vocabulary rather than free strings.
ANYHARNESS_ORIGIN_ENTRYPOINTS = frozenset({"desktop", "cloud", "local_runtime", "cowork"})

# Only ``desktop`` has a direct AnyHarness peer. Every other product source that
# creates a managed cloud workspace is provenance-equivalent to ``cloud`` — the
# same value the automation, session, and workspace-resolve paths already send.
_PRODUCT_SOURCE_TO_ENTRYPOINT = {
    "desktop": "desktop",
    "web": "cloud",
    "mobile": "cloud",
}

_DEFAULT_ENTRYPOINT = "cloud"


def resolve_workspace_origin_entrypoint(source: str | None) -> str:
    """Return a valid AnyHarness origin entrypoint for a product ``source``.

    ``None`` and unknown values collapse to ``cloud`` (this is the managed cloud
    workspace path), so no product source can produce an entrypoint AnyHarness
    rejects. The result is always a member of ``ANYHARNESS_ORIGIN_ENTRYPOINTS``.
    """
    if source is None:
        return _DEFAULT_ENTRYPOINT
    normalized = source.strip().lower()
    return _PRODUCT_SOURCE_TO_ENTRYPOINT.get(normalized, _DEFAULT_ENTRYPOINT)
