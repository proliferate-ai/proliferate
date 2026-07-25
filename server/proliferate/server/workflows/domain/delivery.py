"""Pure construction of the run-delivery transport envelope (design §7.2).

Cloud custodies only the immutable canonical run object. The transport
envelope AnyHarness receives — ``{expectedDataEpoch, run, control}`` — is
never stored: it is reconstructed per delivery attempt from the custodied
data epoch, the immutable run, and the current durable cancellation state.
Building it here keeps transport fields out of custody by construction, so
the custodied run's digest is stable across attempts regardless of
cancellation state.
"""

from __future__ import annotations

RESERVED_TRANSPORT_KEYS = frozenset({"run", "control", "expectedDataEpoch"})


def build_runtime_transport_envelope(
    *,
    run: dict[str, object],
    expected_data_epoch: str,
    cancel_requested: bool,
) -> dict[str, object]:
    """Reconstruct the per-attempt transport envelope around a custodied run."""

    if not expected_data_epoch:
        raise ValueError("A transport envelope requires the fixed AnyHarness data epoch.")
    run_id = run.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("A transport envelope requires a run object with a non-empty runId.")
    reserved = RESERVED_TRANSPORT_KEYS & run.keys()
    if reserved:
        raise ValueError(
            "A custodied run object may not carry reserved transport keys: "
            f"{sorted(reserved)}."
        )
    return {
        "expectedDataEpoch": expected_data_epoch,
        "run": run,
        "control": {"cancelRequested": cancel_requested},
    }
