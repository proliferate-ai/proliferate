"""The complete Agent Models snapshot-upload decision matrix (REL-10, Tier 1).

Pure: this suite imports the domain primitive directly and performs no I/O, no
database access, and no HTTP. It is the authoritative proof for the two cells
(missing sandbox row, present-but-unowned sandbox) that the real-Postgres ASGI
suite cannot manufacture without disabling a schema invariant — at the pinned
base ``CloudRuntimeWorker.cloud_sandbox_id`` is ``ON DELETE CASCADE`` and
``CloudSandbox.owner_user_id`` is non-null.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from proliferate.server.cloud.agent_models.domain.snapshot_upload import (
    CLOUD_SANDBOX_RUNTIME_KIND,
    snapshot_upload_owner,
)

SANDBOX_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
OWNER_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
DESTROYED_AT = datetime(2026, 8, 18, 0, 0, 0, tzinfo=UTC)


class TestSnapshotUploadOwnerMatrix:
    """Six cells; exactly one returns an owner."""

    def test_desktop_worker_has_no_upload_owner(self) -> None:
        assert (
            snapshot_upload_owner(
                runtime_kind="desktop",
                cloud_sandbox_id=None,
                sandbox_exists=False,
                sandbox_owner_user_id=None,
                sandbox_destroyed_at=None,
            )
            is None
        )

    def test_desktop_worker_is_refused_even_carrying_a_live_owned_sandbox(self) -> None:
        """The runtime kind is decided first: no desktop path can borrow a cloud
        target's owner by presenting one."""
        assert (
            snapshot_upload_owner(
                runtime_kind="desktop",
                cloud_sandbox_id=SANDBOX_ID,
                sandbox_exists=True,
                sandbox_owner_user_id=OWNER_ID,
                sandbox_destroyed_at=None,
            )
            is None
        )

    def test_cloud_worker_with_no_sandbox_id_has_no_upload_owner(self) -> None:
        assert (
            snapshot_upload_owner(
                runtime_kind=CLOUD_SANDBOX_RUNTIME_KIND,
                cloud_sandbox_id=None,
                sandbox_exists=False,
                sandbox_owner_user_id=None,
                sandbox_destroyed_at=None,
            )
            is None
        )

    def test_missing_sandbox_row_has_no_upload_owner(self) -> None:
        """The Worker names a sandbox that no longer exists."""
        assert (
            snapshot_upload_owner(
                runtime_kind=CLOUD_SANDBOX_RUNTIME_KIND,
                cloud_sandbox_id=SANDBOX_ID,
                sandbox_exists=False,
                sandbox_owner_user_id=None,
                sandbox_destroyed_at=None,
            )
            is None
        )

    def test_present_but_unowned_sandbox_has_no_upload_owner(self) -> None:
        """A row exists but resolves to nobody: there is no user to store under."""
        assert (
            snapshot_upload_owner(
                runtime_kind=CLOUD_SANDBOX_RUNTIME_KIND,
                cloud_sandbox_id=SANDBOX_ID,
                sandbox_exists=True,
                sandbox_owner_user_id=None,
                sandbox_destroyed_at=None,
            )
            is None
        )

    def test_destroyed_owned_sandbox_has_no_upload_owner(self) -> None:
        assert (
            snapshot_upload_owner(
                runtime_kind=CLOUD_SANDBOX_RUNTIME_KIND,
                cloud_sandbox_id=SANDBOX_ID,
                sandbox_exists=True,
                sandbox_owner_user_id=OWNER_ID,
                sandbox_destroyed_at=DESTROYED_AT,
            )
            is None
        )

    def test_active_owned_cloud_sandbox_returns_the_owner(self) -> None:
        """The only eligible cell — and it returns the sandbox owner itself,
        never the Worker row's own owner."""
        assert (
            snapshot_upload_owner(
                runtime_kind=CLOUD_SANDBOX_RUNTIME_KIND,
                cloud_sandbox_id=SANDBOX_ID,
                sandbox_exists=True,
                sandbox_owner_user_id=OWNER_ID,
                sandbox_destroyed_at=None,
            )
            == OWNER_ID
        )


class TestRuleShape:
    def test_the_rule_is_synchronous_and_side_effect_free(self) -> None:
        """No coroutine, so no store/session/HTTP could hide inside it."""
        import inspect

        assert not inspect.iscoroutinefunction(snapshot_upload_owner)

    def test_the_domain_module_imports_no_infrastructure(self) -> None:
        """The pure boundary in source, not merely in intent (SRV-DOMAIN-1)."""
        import ast
        from pathlib import Path

        from proliferate.server.cloud.agent_models.domain import snapshot_upload

        source = Path(snapshot_upload.__file__).read_text()
        imported: set[str] = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        forbidden = (
            "fastapi",
            "sqlalchemy",
            "proliferate.config",
            "proliferate.db",
            "proliferate.integrations",
            "proliferate.server",
        )
        assert not [
            module
            for module in imported
            if any(module == prefix or module.startswith(f"{prefix}.") for prefix in forbidden)
        ]
