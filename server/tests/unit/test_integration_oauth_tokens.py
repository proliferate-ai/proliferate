from __future__ import annotations

import pytest

from proliferate.integrations.integration_oauth.tokens import _granted_scopes


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"scope": "one two"}, ("one", "two")),
        ({"scope": "one,two"}, ("one", "two")),
        ({"scope": "one, two one"}, ("one", "two")),
        (
            {"authed_user": {"scope": "search:read.public,search:read.private"}},
            ("search:read.public", "search:read.private"),
        ),
        ({"scope": "top", "authed_user": {"scope": "nested"}}, ("top",)),
        ({"scope": ""}, ()),
        ({"authed_user": {"scope": ""}}, ()),
        ({}, None),
    ],
)
def test_granted_scopes_normalizes_standard_and_slack_payloads(
    payload: dict[str, object], expected: tuple[str, ...] | None
) -> None:
    assert _granted_scopes(payload) == expected
