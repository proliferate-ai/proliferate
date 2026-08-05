"""Pure naming rules for cloud workspaces."""

from __future__ import annotations

import hashlib
import random
from collections.abc import Collection
from uuid import UUID

from proliferate.server.cloud.workspaces.domain.animal_names_generated import (
    WORKSPACE_ANIMAL_NAMES,
)

MAX_GENERATED_BRANCH_ATTEMPTS = 10000


def scratch_workspace_display_name(invocation_id: UUID | str) -> str:
    """Display name for a scratch (managed Workflow run) workspace."""
    return f"Workflow run {invocation_id}"


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


def pick_generated_workspace_name(
    taken_names: Collection[str] = (),
    *,
    seed: str | None = None,
) -> str:
    taken = set(taken_names)
    if not WORKSPACE_ANIMAL_NAMES:
        return "workspace"

    start = (
        _seeded_index(seed)
        if seed is not None
        else random.SystemRandom().randrange(len(WORKSPACE_ANIMAL_NAMES))
    )
    for offset in range(len(WORKSPACE_ANIMAL_NAMES)):
        candidate = WORKSPACE_ANIMAL_NAMES[(start + offset) % len(WORKSPACE_ANIMAL_NAMES)]
        if candidate not in taken:
            return candidate
    return WORKSPACE_ANIMAL_NAMES[start]


def _seeded_index(seed: str) -> int:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % len(WORKSPACE_ANIMAL_NAMES)
