"""Control-plane gateway-enablement verification (agent-auth.md FR-3).

One read-only observation per active enrollment key: ask LiteLLM which models the
harness's own virtual key can see, and DIFF that observed set against the
EXPECTED access-group set for the key's ``harness_kind``. Expected is derived from
the one reviewed source of truth in the repo, ``server/litellm/config.yaml`` (the
deployed proxy config): the model ids whose ``model_info.access_groups`` contain
the ``harness_kind``.

- observed set == expected set (order-insensitive): ``ok``.
- any missing or extra ids: ``misconfigured`` with a real delta
  (``{missing, extra, observed_count, expected_count}``). This catches a
  wrong-but-populated access group AND the stale-deployed-image drift class
  (repo says X, the proxy serves Y).
- an error observing a key records NO verdict, so a transient LiteLLM blip never
  overwrites a last-known-good.

If ``config.yaml`` is genuinely absent in a deployed environment, the check
degrades rather than crashing: a non-empty list reads ``ok`` with a delta noting
the degraded check, an empty list still reads ``misconfigured``.

The tick runs in three phases so a LiteLLM outage can neither hold database
locks nor page per key: (1) a short transaction lists the targets and decrypts
their keys, (2) the HTTP probes run with NO transaction open, (3) a short
transaction writes the verdicts. Errors aggregate — a tick with any errors logs
one warning with counts; only an outage-shaped tick (errored past the floor and
at least half the checked keys) raises ONE ``report_critical``.

Nothing here logs key material: an observing exception is reduced immediately
to a sanitized message string (the decrypted virtual key substring redacted);
the raw exception object never leaves phase 2.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import yaml
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED,
    AGENT_GATEWAY_VERIFICATION_STATUS_OK,
)
from proliferate.db.store.agent_gateway import (
    get_enrollment_key_virtual_key_decrypted,
    list_all_active_enrollment_keys,
    record_enrollment_key_verification,
)
from proliferate.integrations import litellm
from proliferate.integrations.sentry import report_critical
from proliferate.lib.infra.time.wall_clock import utcnow

logger = logging.getLogger(__name__)

# ``server/litellm/config.yaml`` relative to this file: parents[3] of
# server/proliferate/server/ai_gateway/verification.py is server/ (and /app in
# the deployed image, whose Dockerfile copies the config to /app/litellm/).
# The index moved with the file (#2222 lifted it out of cloud/agent_gateway/,
# one level shallower); pinned by test_expected_config_resolves_from_source_tree
# so the next move cannot silently strand the loop on the degraded path again.
_CONFIG_PATH = Path(__file__).resolve().parents[3] / "litellm" / "config.yaml"


@dataclass(frozen=True)
class VerificationResult:
    """Summary of one verification tick, returned for logging/tests."""

    checked: int
    ok: int
    misconfigured: int
    errored: int


@dataclass(frozen=True)
class VerificationTarget:
    """One active key to probe: id, kind, and the decrypted material.

    The decrypted key exists only in memory between phases 1 and 2 — it is
    never logged, and errors that might embed it are sanitized to strings
    before they leave phase 2.
    """

    enrollment_key_id: UUID
    harness_kind: str
    virtual_key: str


@dataclass(frozen=True)
class KeyObservation:
    """Phase 2's outcome for one target: a model list, or a sanitized error."""

    enrollment_key_id: UUID
    harness_kind: str
    observed: list[str] | None
    error: str | None


class AgentGatewayVerificationErrors(Exception):
    """An outage-shaped verification tick: errors past the aggregation floor.

    Constructed (never raised) into ONE ``report_critical`` per tick —
    replacing the per-key paging that turned a LiteLLM outage into hundreds
    of fatal alerts per tick.
    """


# A tick pages only when errors clear BOTH this floor and half the checked
# keys — a single flaky key warns, an outage pages once.
_ERROR_ALERT_FLOOR = 10


def load_expected_access_groups() -> dict[str, set[str]] | None:
    """Map each ``harness_kind`` to the set of model ids granted to its access group.

    Parses the deployed LiteLLM config (mirroring
    ``tests/unit/test_litellm_config_access_groups.py``). Returns ``None`` when the
    file is absent or unparseable, so the loop can degrade instead of crashing.
    """
    try:
        with _CONFIG_PATH.open() as handle:
            document = yaml.safe_load(handle)
        model_list = document["model_list"]
    except (OSError, yaml.YAMLError, KeyError, TypeError):
        return None
    expected: dict[str, set[str]] = {}
    for entry in model_list:
        if not isinstance(entry, dict):
            continue
        model_name = entry.get("model_name")
        access_groups = (entry.get("model_info") or {}).get("access_groups") or []
        if not isinstance(model_name, str) or not isinstance(access_groups, list):
            continue
        for group in access_groups:
            expected.setdefault(str(group), set()).add(model_name)
    return expected


def _diff_verdict(
    harness_kind: str,
    observed: list[str],
    expected_map: dict[str, set[str]] | None,
) -> tuple[str, str | None]:
    """Classify one key's observed model set into (status, delta_json)."""
    observed_set = set(observed)
    if expected_map is None:
        # Degraded: no expected set to diff against. A non-empty list is the best
        # we can say (ok), an empty one is still wrong (misconfigured).
        degraded = {"degraded": "config_unavailable"}
        if observed_set:
            return AGENT_GATEWAY_VERIFICATION_STATUS_OK, json.dumps(degraded)
        return (
            AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED,
            json.dumps({**degraded, "reason": "empty_model_list"}),
        )
    expected = expected_map.get(harness_kind, set())
    missing = sorted(expected - observed_set)
    extra = sorted(observed_set - expected)
    if not missing and not extra:
        return AGENT_GATEWAY_VERIFICATION_STATUS_OK, None
    delta = json.dumps(
        {
            "missing": missing,
            "extra": extra,
            "observed_count": len(observed_set),
            "expected_count": len(expected),
        }
    )
    return AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED, delta


def _sanitized(exc: Exception, virtual_key: str) -> RuntimeError:
    """A stand-in exception carrying the type name and a key-redacted message.

    An HTTP client error can stringify request headers, so the decrypted virtual
    key must never reach the reporter verbatim.
    """
    message = f"{type(exc).__name__}: {exc}"
    if virtual_key:
        message = message.replace(virtual_key, "[redacted]")
    return RuntimeError(message)


async def collect_verification_targets(db: AsyncSession) -> list[VerificationTarget]:
    """Phase 1 (short transaction): active keys with material, decrypted.

    Rows without stored key material (freshly created, not yet minted) have
    nothing to verify and drop out here, leaving any prior verdict standing.
    """
    targets: list[VerificationTarget] = []
    for key in await list_all_active_enrollment_keys(db):
        virtual_key = await get_enrollment_key_virtual_key_decrypted(db, enrollment_key_id=key.id)
        if virtual_key is None:
            continue
        targets.append(
            VerificationTarget(
                enrollment_key_id=key.id,
                harness_kind=key.harness_kind,
                virtual_key=virtual_key,
            )
        )
    return targets


async def probe_verification_targets(
    targets: list[VerificationTarget],
) -> list[KeyObservation]:
    """Phase 2 (NO transaction): one LiteLLM observation per target.

    Callers must not hold a database transaction across this call — an
    outage's worth of HTTP timeouts would hold row locks for its whole
    duration. A failing probe is reduced on the spot to a key-redacted
    message string (an HTTP client error can stringify request headers, so
    the raw exception object never leaves this function).
    """
    observations: list[KeyObservation] = []
    for target in targets:
        try:
            observed = await litellm.list_models(virtual_key=target.virtual_key)
        except Exception as exc:  # noqa: BLE001 - one bad key must not abort the tick
            observations.append(
                KeyObservation(
                    enrollment_key_id=target.enrollment_key_id,
                    harness_kind=target.harness_kind,
                    observed=None,
                    error=str(_sanitized(exc, target.virtual_key)),
                )
            )
            continue
        observations.append(
            KeyObservation(
                enrollment_key_id=target.enrollment_key_id,
                harness_kind=target.harness_kind,
                observed=list(observed),
                error=None,
            )
        )
    return observations


async def record_verification_verdicts(
    db: AsyncSession,
    observations: list[KeyObservation],
) -> VerificationResult:
    """Phase 3 (short transaction): diff, write verdicts, report in aggregate.

    Errored observations record NO verdict (a transient blip never overwrites
    a last-known-good). Error reporting is aggregated: any errors log one
    warning with counts; only an outage-shaped tick — ``errored`` at or past
    ``max(_ERROR_ALERT_FLOOR, ceil(checked / 2))`` — raises ONE
    ``report_critical``, never one per key.
    """
    expected_map = load_expected_access_groups()
    ok = 0
    misconfigured = 0
    errored = 0
    sample_error: str | None = None
    for observation in observations:
        if observation.observed is None:
            errored += 1
            if sample_error is None:
                sample_error = observation.error
            continue
        status, delta = _diff_verdict(observation.harness_kind, observation.observed, expected_map)
        await record_enrollment_key_verification(
            db,
            enrollment_key_id=observation.enrollment_key_id,
            status=status,
            delta=delta,
            verified_at=utcnow(),
        )
        if status == AGENT_GATEWAY_VERIFICATION_STATUS_OK:
            ok += 1
        else:
            misconfigured += 1
    checked = len(observations)
    if errored:
        # The sanitized sample is key-redacted by construction (phase 2).
        logger.warning(
            "Agent gateway verification tick had errored keys",
            extra={"checked": checked, "errored": errored, "sample_error": sample_error},
        )
    if errored >= max(_ERROR_ALERT_FLOOR, math.ceil(checked / 2)):
        report_critical(
            AgentGatewayVerificationErrors(
                f"verification errored on {errored} of {checked} keys; sample: {sample_error}"
            ),
            tags={"domain": "agent_gateway", "action": "verification"},
        )
    return VerificationResult(
        checked=checked,
        ok=ok,
        misconfigured=misconfigured,
        errored=errored,
    )


async def run_verification(db: AsyncSession) -> VerificationResult:
    """Verify every active enrollment key's gateway model access, once.

    Single-session orchestration of the three phases, for callers (and tests)
    that already hold a session. The production worker instead splits the
    phases across two short transactions so the HTTP probes of phase 2 never
    run inside one (see ``worker.run_verification_once``). Never raises for a
    single bad key: failures aggregate into the result and phase 3's
    reporting, and an errored key records no verdict.
    """
    targets = await collect_verification_targets(db)
    observations = await probe_verification_targets(targets)
    return await record_verification_verdicts(db, observations)
