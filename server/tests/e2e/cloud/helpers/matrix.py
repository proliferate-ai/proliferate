from __future__ import annotations

import pytest

PROVIDER_CASES = [
    pytest.param("e2b", marks=pytest.mark.e2b, id="e2b"),
]
AGENT_CASES = [
    pytest.param("claude", id="claude"),
    pytest.param("codex", id="codex"),
]
