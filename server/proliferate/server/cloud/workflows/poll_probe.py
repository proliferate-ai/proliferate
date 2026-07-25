"""Credential-safe setup probes for workflow poll triggers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.integrations.workflow_poll import PollRequestError
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.poll_contract import (
    PollPage,
    derive_inputs_from_sample,
    diff_item_against_schema,
    init_probe_url,
    skipped_sample_fields,
)
from proliferate.server.cloud.workflows.poll_endpoint import guard_poll_endpoint
from proliferate.server.cloud.workflows.poll_fetch import (
    describe_poll_error,
    resolve_plaintext_poll_auth,
    resolve_stored_poll_auth,
)


@dataclass(frozen=True, repr=False)
class PollProbeConfig:
    url: str
    auth_header: str | None
    interval_secs: int
    auth_ciphertext: str | None
    update_auth: bool
    # Ephemeral probe-only plaintext; never returned or stored.
    auth_value_plaintext: str | None


@dataclass(frozen=True, repr=False)
class StoredPollSecret:
    ciphertext: str


@dataclass(frozen=True)
class PollInspectResult:
    """Workflow-from-poll sample and derived input skeleton."""

    sample_item_id: str | None
    sample_data: dict[str, object] | None
    derived_inputs: list[dict[str, object]]
    skipped_fields: list[dict[str, str]]


@dataclass(frozen=True)
class _PollApiFailure:
    code: str
    message: str
    status_code: int
    extra_detail: dict[str, object] = field(default_factory=dict)

    def to_error(self) -> CloudApiError:
        return CloudApiError(
            self.code,
            self.message,
            status_code=self.status_code,
            extra_detail=self.extra_detail,
        )


async def load_stored_poll_secret(
    db: AsyncSession, trigger_id: UUID
) -> StoredPollSecret | None:
    ciphertext = await trigger_store.get_poll_auth_ciphertext(db, trigger_id)
    return StoredPollSecret(ciphertext) if ciphertext is not None else None


async def probe_poll_signature(
    config: PollProbeConfig,
    *,
    item_schema: dict[str, object],
    stored_secret: StoredPollSecret | None = None,
    policy: net_guard.NetworkPolicy = net_guard.PUBLIC_ONLY,
) -> None:
    """Probe ``/init`` once and diff every sample field against workflow inputs."""

    failure = await _probe_poll_signature_result(
        config,
        item_schema=item_schema,
        stored_secret=stored_secret,
        policy=policy,
    )
    if failure is not None:
        # Sole raise point: inputs are redacted-repr carriers or schema metadata;
        # no response page, plaintext/ciphertext, or vendor exception is local.
        raise failure.to_error()


async def _poll_probe_page_result(
    config: PollProbeConfig,
    *,
    stored_secret: StoredPollSecret | None,
    policy: net_guard.NetworkPolicy,
    purpose: str,
) -> PollPage | _PollApiFailure:
    # Keep the poller's fetch seam injectable for the existing trigger service
    # tests while avoiding a module-import cycle at startup.
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    probe_url = init_probe_url(config.url)
    failure: _PollApiFailure | None = None
    try:
        # Credential resolution, guard, pinned fetch, and off-loop parse share one
        # absolute setup deadline. Expected failures return safe scalar carriers.
        async with asyncio.timeout(WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS):
            if config.auth_value_plaintext is not None:
                auth_result = resolve_plaintext_poll_auth(
                    config.auth_header,
                    config.auth_value_plaintext,
                )
            elif config.auth_header is not None and stored_secret is not None:
                auth_result = resolve_stored_poll_auth(
                    config.auth_header,
                    stored_secret.ciphertext,
                )
            else:
                auth_result = resolve_plaintext_poll_auth(config.auth_header, None)
            if isinstance(auth_result, PollRequestError):
                return _PollApiFailure(
                    code="poll_probe_failed",
                    message=f"{purpose}: {describe_poll_error(auth_result)}",
                    status_code=400,
                )
            endpoint = await guard_poll_endpoint(probe_url, policy=policy)
            return await fetch_poll_page(
                url=probe_url,
                endpoint=endpoint,
                auth=auth_result,
                cursor=None,
            )
    except CloudApiError as caught:
        # Preserve the DNS/policy type for WF-POLL-OCC fencing.
        failure = _PollApiFailure(
            code=caught.code,
            message=caught.message,
            status_code=caught.status_code,
            extra_detail=dict(caught.extra_detail),
        )
    except Exception as caught:
        failure = _PollApiFailure(
            code="poll_probe_failed",
            message=f"{purpose}: {describe_poll_error(caught)}",
            status_code=400,
        )
    assert failure is not None
    return failure


async def _probe_poll_signature_result(
    config: PollProbeConfig,
    *,
    item_schema: dict[str, object],
    stored_secret: StoredPollSecret | None,
    policy: net_guard.NetworkPolicy,
) -> _PollApiFailure | None:
    result = await _poll_probe_page_result(
        config,
        stored_secret=stored_secret,
        policy=policy,
        purpose="Could not reach the poll endpoint's /init path to verify its item shape",
    )
    if isinstance(result, _PollApiFailure):
        return result
    try:
        for item_index, item in enumerate(result.items):
            mismatches = diff_item_against_schema(item.data, item_schema)
            if mismatches:
                detail = "; ".join(mismatches)
                # Never serialize an upstream item ID: the endpoint saw the auth
                # credential and can reflect it through any valid response field.
                return _PollApiFailure(
                    code="poll_signature_mismatch",
                    message=(
                        "Poll item '[redacted]' does not match the workflow's "
                        f"declared inputs: {detail}"
                    ),
                    status_code=400,
                    extra_detail={
                        "item_id": "[redacted]",
                        "item_index": item_index,
                        "mismatches": mismatches,
                    },
                )
    except Exception as caught:
        return _PollApiFailure(
            code="poll_probe_failed",
            message=(
                "Could not verify the poll endpoint's item shape "
                f"({caught.__class__.__name__})."
            ),
            status_code=400,
        )
    return None


async def inspect_poll_config(
    config: PollProbeConfig,
    *,
    policy: net_guard.NetworkPolicy,
) -> PollInspectResult:
    result = await _inspect_poll_config_result(config, policy=policy)
    if isinstance(result, _PollApiFailure):
        raise result.to_error()
    return result


async def _inspect_poll_config_result(
    config: PollProbeConfig,
    *,
    policy: net_guard.NetworkPolicy,
) -> PollInspectResult | _PollApiFailure:
    page = await _poll_probe_page_result(
        config,
        stored_secret=None,
        policy=policy,
        purpose="Could not reach the poll endpoint's /init path to derive inputs",
    )
    if isinstance(page, _PollApiFailure):
        return page
    try:
        if not page.items:
            return PollInspectResult(
                sample_item_id=None,
                sample_data=None,
                derived_inputs=[],
                skipped_fields=[],
            )
        sample = page.items[0]
        return PollInspectResult(
            sample_item_id=sample.id,
            sample_data=dict(sample.data),
            derived_inputs=derive_inputs_from_sample(sample.data),
            skipped_fields=skipped_sample_fields(sample.data),
        )
    except Exception as caught:
        return _PollApiFailure(
            code="poll_probe_failed",
            message=(
                "Could not derive inputs from the poll endpoint response "
                f"({caught.__class__.__name__})."
            ),
            status_code=400,
        )
