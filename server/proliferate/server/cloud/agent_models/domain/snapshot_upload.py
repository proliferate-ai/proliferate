"""The one Agent Models rule for model-snapshot upload eligibility (REL-10).

Two orchestration paths need the same verdict and must never drift apart:

- ``POST /v1/cloud/worker/heartbeat`` advertises it to the Worker as
  ``modelSnapshotUploadAllowed``, so an ineligible Worker performs zero
  snapshot work; and
- ``POST /v1/cloud/agent-models/{harness}/refresh`` re-evaluates it as the
  final authorization boundary, because a sandbox can be destroyed between the
  heartbeat and the upload.

The rule lives here, pure, so neither path can restate the conditions inline.
It takes only frozen scalars — never a store value, ORM row, session, or
config — and does no I/O and no logging. ``sandbox_exists`` is an explicit
input rather than an ``Optional`` sandbox object so the "sandbox row missing"
and "row present but unowned" cells stay independently testable without
importing a store value type across the domain boundary.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

#: The only Worker runtime kind whose observation has a machineless consumer.
#: A desktop Worker's local document is never served to a cloud surface, so it
#: is never a legal upload (model-catalog.md "The cloud copy").
CLOUD_SANDBOX_RUNTIME_KIND = "cloud_sandbox"


def snapshot_upload_owner(
    *,
    runtime_kind: str,
    cloud_sandbox_id: UUID | None,
    sandbox_exists: bool,
    sandbox_owner_user_id: UUID | None,
    sandbox_destroyed_at: datetime | None,
) -> UUID | None:
    """The user a Worker's snapshot upload would be stored under, or ``None``.

    ``None`` means "this Worker may not upload": the heartbeat advertises
    ``modelSnapshotUploadAllowed=false`` and the ingest route refuses with
    ``403 agent_model_snapshot_upload_forbidden``. An owner is returned only for
    an active, owned cloud-sandbox Worker — every other cell (desktop, cloud
    with no sandbox id, missing sandbox row, present-but-unowned sandbox,
    destroyed sandbox) is ``None``.
    """
    if runtime_kind != CLOUD_SANDBOX_RUNTIME_KIND:
        return None
    if cloud_sandbox_id is None:
        return None
    if not sandbox_exists:
        return None
    if sandbox_owner_user_id is None:
        return None
    if sandbox_destroyed_at is not None:
        return None
    return sandbox_owner_user_id
