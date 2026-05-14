"""Cloud event-ingest cursor rules."""

from __future__ import annotations


def advance_contiguous_cursor(current: int, received_seqs: list[int]) -> int:
    """Advance across a sorted-or-unsorted batch of received sequence numbers."""
    cursor = max(0, current)
    for seq in sorted(set(received_seqs)):
        if seq <= cursor:
            continue
        if seq == cursor + 1:
            cursor = seq
            continue
        break
    return cursor
