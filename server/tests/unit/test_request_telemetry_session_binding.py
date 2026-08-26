from __future__ import annotations

import pytest

from proliferate.middleware.request_telemetry import session_id_from_path

SESSION_ID = "0f6e4c2a-9b1d-4e7f-8a3c-5d2b1e0f9a7c"


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (f"/v1/sessions/{SESSION_ID}", SESSION_ID),
        (f"/v1/sessions/{SESSION_ID}/events", SESSION_ID),
        (f"/cloud/targets/abc/v1/sessions/{SESSION_ID}/prompt", SESSION_ID),
        (f"/v1/sessions/{SESSION_ID.upper()}", SESSION_ID.upper()),
        ("/v1/sessions/session-01", None),
        ("/v1/sessions/session-01/events", None),
        ("/v1/sessions", None),
        ("/v1/workspaces/abc/sessions", None),
        (f"/v1/workspaces/{SESSION_ID}", None),
        ("/", None),
    ],
)
def test_session_id_from_path_binds_only_canonical_uuids(path: str, expected: str | None) -> None:
    assert session_id_from_path(path) == expected
