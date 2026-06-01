"""Provisioning step timing for managed runtime startup."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from uuid import UUID

from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.runtime.models import ProvisionStep, ProvisionStepMetric
from proliferate.utils.time import duration_ms


def _emit_cloud_event(message: str, payload: dict[str, object]) -> None:
    log_cloud_event(message, **payload)  # type: ignore[arg-type]


@dataclass
class ProvisionStepTracker:
    workspace_id: UUID
    metrics: list[ProvisionStepMetric] = field(default_factory=list)
    active_step: ProvisionStep = field(default=ProvisionStep.init)
    _step_started: float = field(default=0.0, init=False, repr=False)

    def begin(self, step: ProvisionStep, **fields: object) -> None:
        self.active_step = step
        self._step_started = time.perf_counter()
        payload: dict[str, object] = {
            "workspace_id": self.workspace_id,
            "step": step.value,
        }
        payload.update(fields)
        _emit_cloud_event("cloud workspace setup step started", payload)

    def complete(self, **fields: object) -> None:
        elapsed_ms = duration_ms(self._step_started)
        self.metrics.append(ProvisionStepMetric(step=self.active_step, elapsed_ms=elapsed_ms))
        payload: dict[str, object] = {
            "workspace_id": self.workspace_id,
            "step": self.active_step.value,
            "elapsed_ms": elapsed_ms,
        }
        payload.update(fields)
        _emit_cloud_event("cloud workspace setup step complete", payload)
