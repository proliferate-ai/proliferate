"""Permanently disabled compatibility surface for legacy LLM auto top-ups.

Managed LLM credits are hard-capped.  Older deployments may still carry the
``AGENT_GATEWAY_*TOPUP*`` settings or invoke the former one-shot worker entry
point, so this module intentionally remains as an inert compatibility shim.
It must not read the database, call Stripe, create credit grants, or change
virtual-key state.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LlmTopupRunResult:
    """Zero-valued result returned by the retired worker entry point."""

    scanned: int = 0
    eligible: int = 0
    topped_up: int = 0
    skipped: int = 0


def topups_enabled() -> bool:
    """Return ``False`` regardless of retained legacy configuration."""

    return False


async def run_llm_topups(_db: object) -> LlmTopupRunResult:
    """Remain a side-effect-free no-op for old operator/test callers."""

    return LlmTopupRunResult()
