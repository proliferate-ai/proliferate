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

Nothing here logs key material: the observing exception is sanitized (the
decrypted virtual key substring is redacted) before it reaches Sentry, and only
the harness_kind and the key row id are tagged.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

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

# ``server/litellm/config.yaml`` relative to this file
# (proliferate/server/ai_gateway/verification.py -> server/).
_CONFIG_PATH = Path(__file__).resolve().parents[4] / "litellm" / "config.yaml"


@dataclass(frozen=True)
class VerificationResult:
    """Summary of one verification tick, returned for logging/tests."""

    checked: int
    ok: int
    misconfigured: int
    errored: int


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


async def run_verification(db: AsyncSession) -> VerificationResult:
    """Verify every active enrollment key's gateway model access, once.

    Never raises for a single bad key: a per-key failure is reported (sanitized)
    and skipped so the rest of the tick still runs, and it records no verdict.
    """
    expected_map = load_expected_access_groups()
    keys = await list_all_active_enrollment_keys(db)
    ok = 0
    misconfigured = 0
    errored = 0
    for key in keys:
        virtual_key = await get_enrollment_key_virtual_key_decrypted(db, enrollment_key_id=key.id)
        if virtual_key is None:
            # No stored key material to check yet (a freshly created, not-yet-minted
            # row). Nothing to verify; leave any prior verdict standing.
            continue
        try:
            observed = await litellm.list_models(virtual_key=virtual_key)
        except Exception as exc:  # noqa: BLE001 - one bad key must not abort the tick
            errored += 1
            # report_critical calls logger.exception, which formats the AMBIENT
            # exception (sys.exc_info) traceback. Inside this block that is the raw
            # exc, whose message/traceback can carry the decrypted virtual key. So
            # re-raise the sanitized stand-in as the ambient exception (``from None``
            # severs __context__ back to exc) and report from THAT block, so both
            # the Sentry object and the logged traceback are key-redacted.
            try:
                raise _sanitized(exc, virtual_key) from None
            except RuntimeError as clean_exc:
                report_critical(
                    clean_exc,
                    tags={
                        "domain": "agent_gateway",
                        "action": "verification",
                        "harness_kind": key.harness_kind,
                        "enrollment_key_id": str(key.id),
                    },
                )
            continue
        status, delta = _diff_verdict(key.harness_kind, observed, expected_map)
        await record_enrollment_key_verification(
            db,
            enrollment_key_id=key.id,
            status=status,
            delta=delta,
            verified_at=utcnow(),
        )
        if status == AGENT_GATEWAY_VERIFICATION_STATUS_OK:
            ok += 1
        else:
            misconfigured += 1
    return VerificationResult(
        checked=len(keys),
        ok=ok,
        misconfigured=misconfigured,
        errored=errored,
    )
