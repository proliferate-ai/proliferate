"""Product source -> AnyHarness origin entrypoint translation (T1).

Regression: the cloud workspace create path forwarded the product ``source``
(desktop/web/mobile) straight into AnyHarness ``origin.entrypoint``, whose enum
is desktop/cloud/local_runtime/cowork. ``source=web`` (and ``mobile``) therefore
made AnyHarness reject the worktree with ``422 unknown variant 'web'``. The
mapping now translates at the owning boundary; every product source resolves to
a valid entrypoint.
"""

from __future__ import annotations

import pytest

from proliferate.server.cloud.workspaces.domain.origin import (
    ANYHARNESS_ORIGIN_ENTRYPOINTS,
    resolve_workspace_origin_entrypoint,
)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("desktop", "desktop"),
        ("web", "cloud"),
        ("mobile", "cloud"),
        (None, "cloud"),
        ("", "cloud"),
        ("api", "cloud"),
        ("something-new", "cloud"),
        ("WEB", "cloud"),
        ("  desktop  ", "desktop"),
    ],
)
def test_resolve_workspace_origin_entrypoint(source: str | None, expected: str) -> None:
    assert resolve_workspace_origin_entrypoint(source) == expected


@pytest.mark.parametrize(
    "source",
    ["desktop", "web", "mobile", None, "", "api", "totally-unknown"],
)
def test_result_is_always_a_valid_anyharness_entrypoint(source: str | None) -> None:
    # No product source may produce an entrypoint AnyHarness would 422 on.
    assert resolve_workspace_origin_entrypoint(source) in ANYHARNESS_ORIGIN_ENTRYPOINTS
