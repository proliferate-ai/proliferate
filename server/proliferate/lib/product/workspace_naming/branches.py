"""Branch-name suffixing for generated workspace names."""

from __future__ import annotations

MAX_GENERATED_BRANCH_ATTEMPTS = 10000


def suffix_branch_leaf(branch_name: str, suffix: int) -> str:
    prefix, separator, leaf = branch_name.strip().rpartition("/")
    suffixed_leaf = f"{leaf or 'workspace'}-{suffix}"
    return f"{prefix}{separator}{suffixed_leaf}" if separator else suffixed_leaf


def resolve_generated_branch_name(requested: str, taken: set[str]) -> str:
    cleaned = requested.strip()
    if cleaned and cleaned not in taken:
        return cleaned
    base = cleaned or "workspace"
    for suffix in range(2, MAX_GENERATED_BRANCH_ATTEMPTS + 1):
        candidate = suffix_branch_leaf(base, suffix)
        if candidate not in taken:
            return candidate
    return suffix_branch_leaf(base, MAX_GENERATED_BRANCH_ATTEMPTS + 1)
