"""The ``http_route`` tag admits bounded route templates and nothing else."""

from __future__ import annotations

from typing import Any

import pytest

from proliferate.integrations.sentry.privacy import http_route_template

VALID_UUID = "c3f1a8d2-5b47-4e19-9a6c-0d8e2f7b41ca"
VALID_UUID_HEX = "0f3c2a9d6b8e4f1aa7c25d3e9b64108f"


@pytest.mark.parametrize(
    ("value", "survives"),
    [
        ("/orgs/{org_id}", True),
        ("/v1/support/reports/{report_id}/upload-targets", True),
        ("/", True),
        ("/orgs/" + VALID_UUID, False),
        ("/orgs/" + VALID_UUID_HEX, False),
        ("/Orgs/{org_id}", False),
        ("orgs/{org_id}", False),
        ("/" + "a/" * 17, False),
        ("/orgs/{Org}", False),
        ("/a" * 101, False),
        ("/orgs/{org_id}\n", False),
        (None, False),
        (7, False),
    ],
)
def test_http_route_template_is_bounded(value: Any, survives: bool) -> None:
    projected = http_route_template(value)
    assert (projected is not None) is survives
    if survives:
        assert projected == value
