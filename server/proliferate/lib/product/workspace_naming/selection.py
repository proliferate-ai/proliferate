"""Select generated workspace names from the shared catalog."""

from __future__ import annotations

import hashlib
import random
from collections.abc import Collection

from proliferate.lib.product.workspace_naming.animal_names_generated import (
    WORKSPACE_ANIMAL_NAMES,
)


def pick_generated_workspace_name(
    taken_names: Collection[str] = (),
    *,
    seed: str | None = None,
) -> str:
    taken = set(taken_names)
    if not WORKSPACE_ANIMAL_NAMES:
        return "workspace"

    start = _seeded_index(seed) if seed is not None else random.SystemRandom().randrange(
        len(WORKSPACE_ANIMAL_NAMES)
    )
    for offset in range(len(WORKSPACE_ANIMAL_NAMES)):
        candidate = WORKSPACE_ANIMAL_NAMES[(start + offset) % len(WORKSPACE_ANIMAL_NAMES)]
        if candidate not in taken:
            return candidate
    return WORKSPACE_ANIMAL_NAMES[start]


def _seeded_index(seed: str) -> int:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % len(WORKSPACE_ANIMAL_NAMES)
