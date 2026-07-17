"""Secret-safe operational signals for managed Workflow worker phases."""

from __future__ import annotations

import json
import logging
from uuid import UUID

logger = logging.getLogger(__name__)


def build_attempt_metric(operation: str, safe_code: str) -> dict[str, object]:
    """Build one fixed-cardinality attempt signal without payload content."""

    return {
        "managed_workflow_attempt": {
            "operation": operation[:32],
            "safe_code": safe_code[:128],
            "count": 1,
        }
    }


def emit_attempt(
    *,
    operation: str,
    safe_code: str,
    invocation_id: UUID,
    generation: int,
) -> None:
    """Emit a metric plus a correlation-only structured diagnostic."""

    logging.getLogger("proliferate.workflows.metrics").info(
        json.dumps(build_attempt_metric(operation, safe_code))
    )
    logger.info(
        "managed workflow worker attempt",
        extra={
            "workflow_invocation_id": str(invocation_id),
            "workflow_generation": generation,
            "workflow_phase": operation,
            "workflow_safe_code": safe_code[:128],
        },
    )
