"""WF-ID feature-off gate for unattended workflow occurrences."""

from typing import NoReturn

from proliferate.server.cloud.errors import CloudApiError


def unattended_activation_enabled() -> bool:
    """Frozen WF-ID answer; later cutover must replace this atomically."""

    return False


def reject_unattended_activation() -> NoReturn:
    """Park schedule/poll activation until the owning cutover packets land."""

    raise CloudApiError(
        "workflow_source_trigger_cutover_required",
        "Schedule and poll activation is parked until trigger cutover.",
        status_code=409,
    )
