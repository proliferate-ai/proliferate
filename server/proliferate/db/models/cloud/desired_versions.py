"""Target-scoped desired runtime-component versions.

The global ``RUNTIME_VERSION`` / ``WORKER_VERSION`` image-env pins
(:mod:`proliferate.server.version`) are one desired version for the *whole*
deployment: every worker heartbeat gets the same answer. That is correct for an
ordinary rollout, but it cannot express "move this one sandbox from N-1 to N
while every other sandbox stays on N-1" — the transition the Tier-4
managed-cloud upgrade world proves. Mutating the global image env to drive one
target is exactly the shared-staging mutation the release-testing contract
forbids.

This table records a desired AnyHarness / Worker version *scoped to a single
cloud sandbox* (the collapsed 1:1 target identity — see the Worker structure
doc). The heartbeat resolver consults the target-scoped record first and falls
back to the global pin per component, so an unset column defers to the global
pin and an unrelated target is never affected. It is deliberately keyed by
``cloud_sandbox_id`` (not the ephemeral worker row) so a run can set the desired
version at provisioning time, before the sandbox worker has enrolled, and so the
record survives a worker re-enrollment within the same sandbox.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudSandboxDesiredVersion(Base):
    __tablename__ = "cloud_sandbox_desired_version"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # One desired-version record per sandbox (the collapsed target identity).
    cloud_sandbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_sandbox.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    # Per-component override of the global pin; NULL defers to the global pin.
    # Column widths mirror the worker version columns so an overlong value is a
    # rejection at the edge, never a mid-transaction truncation 500.
    desired_anyharness_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    desired_worker_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
