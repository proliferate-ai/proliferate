from __future__ import annotations

DESKTOP_CLEANUP_ITEM_KINDS = frozenset({"anyharness_workspace"})


def is_desktop_cleanup_item_kind(item_kind: str) -> bool:
    return item_kind in DESKTOP_CLEANUP_ITEM_KINDS
