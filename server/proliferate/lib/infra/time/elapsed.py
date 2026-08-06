from __future__ import annotations

import time


def duration_ms(started_at: float) -> int:
    return int((time.perf_counter() - started_at) * 1000)
