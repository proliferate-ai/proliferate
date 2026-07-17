"""Connect to, wake, and launch the AnyHarness process inside a CloudSandbox."""

from __future__ import annotations

import logging
import secrets
import shlex
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
    USAGE_SEGMENT_OPENED_BY_RESUME,
)
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProvider,
    SandboxProviderTargetUnavailableError,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.billing.authorization import assert_cloud_sandbox_resume_allowed
from proliferate.server.billing.runtime_usage import (
    close_cloud_sandbox_provider_usage,
    open_cloud_sandbox_provider_usage,
)
from proliferate.server.cloud.materialization.failures import persist_materialization_failure
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
    SandboxIOTarget,
)
from proliferate.server.cloud.materialization.sandbox_io.worker_sidecar import (
    launch_worker_sidecar,
    mint_cloud_sandbox_worker_enrollment,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_runtime_env,
    build_runtime_launch_script,
    build_supervised_runtime_stop_command,
    build_supervisor_config,
    build_worker_config,
    supervisor_config_path,
    worker_config_path,
)
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.liveness_health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.server.cloud.runtime_workers.service import worker_cloud_base_url
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.materialization.connect")


def _runtime_token(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_bearer_token_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_bearer_token_ciphertext)


def _runtime_data_key(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_data_key_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_data_key_ciphertext)


async def _resolve_owner_organization_id(
    db: AsyncSession,
    sandbox: CloudSandboxValue,
) -> UUID | None:
    """Resolve the sandbox's owning organization for observability identity tags.

    The cloud_sandbox row has no organization column, but the owner is one
    membership lookup away. Uses the owner's current (first active)
    membership; best-effort — identity tags must never block a launch.
    """
    if sandbox.organization_id is not None:
        return sandbox.organization_id
    if sandbox.owner_user_id is None:
        return None
    try:
        record = await organizations_store.get_current_membership_for_user(
            db, sandbox.owner_user_id
        )
    except Exception:  # noqa: BLE001 - identity tagging is best-effort.
        return None
    return record.organization.id if record is not None else None


async def connect_ready_sandbox(
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
) -> SandboxIOTarget:
    if sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        raise CloudMaterializationCommandError("Cloud sandbox has been destroyed.")

    # LIVE billing gate (spec §4.3): a sandbox the reconciler paused for a spend
    # hold or an over-cap compute budget must not be woken by an incoming
    # request. No-op unless CLOUD_BILLING_MODE=enforce.
    await assert_cloud_sandbox_resume_allowed(db, sandbox)
    # The billing/read phase is complete before provider or runtime I/O. This
    # keeps the reusable connect seam from carrying an autobegun PostgreSQL
    # transaction across E2B resume/launch or AnyHarness health requests.
    await db.commit()

    retried = await cloud_sandboxes_store.begin_cloud_sandbox_materialization_retry(
        db,
        sandbox.id,
    )
    if retried is None:
        raise CloudMaterializationCommandError("Cloud sandbox was destroyed while connecting.")
    sandbox = retried
    await db.commit()

    provider_sandbox_id = sandbox.e2b_sandbox_id
    try:
        owner_user_id = sandbox.owner_user_id
        if owner_user_id is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox has no owner for provider usage attribution."
            )
        provider = get_sandbox_provider(sandbox.e2b_template_ref)
        provider_sandbox: object | None = None
        if provider_sandbox_id is not None:
            try:
                provider_sandbox = await provider.resume_sandbox(provider_sandbox_id)
            except SandboxProviderTargetUnavailableError as missing_error:
                refreshed = await cloud_sandboxes_store.supersede_missing_cloud_sandbox_provider(
                    db,
                    sandbox.id,
                    expected_provider_sandbox_id=provider_sandbox_id,
                )
                if refreshed is None:
                    raise CloudMaterializationCommandError(
                        "Cloud sandbox provider binding changed while recovering."
                    ) from missing_error
                # All lifecycle writers lock cloud_sandbox before usage_segment.
                # A mismatched open segment raises, and this transaction rolls
                # the supersession back so the old binding remains attributable.
                await close_cloud_sandbox_provider_usage(
                    db,
                    sandbox_id=sandbox.id,
                    provider_sandbox_id=provider_sandbox_id,
                    ended_at=utcnow(),
                    closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
                )
                sandbox = refreshed
                provider_sandbox_id = None
                # The absent binding and its exact usage segment are durable
                # before any replacement is allocated externally.
                await db.commit()

        if provider_sandbox_id is None:
            handle = await provider.create_sandbox(
                metadata={
                    "cloud_sandbox_id": str(sandbox.id),
                    "proliferate_owner_user_id": str(owner_user_id),
                }
            )
            provider_sandbox_id = handle.sandbox_id
            refreshed = await cloud_sandboxes_store.record_cloud_sandbox_provider_sandbox(
                db,
                sandbox.id,
                e2b_sandbox_id=provider_sandbox_id,
                e2b_template_ref=provider.template_version,
            )
            if refreshed is None:
                # Only the unrecorded candidate is safe to destroy after losing
                # the compare-and-set race. Never touch a concurrently recorded
                # winner or an unrelated provider sandbox.
                try:
                    await provider.destroy_sandbox(provider_sandbox_id)
                except Exception:
                    logger.exception(
                        "failed to destroy provider sandbox after lost record",
                        extra={
                            "cloud_sandbox_id": str(sandbox.id),
                            "e2b_sandbox_id": provider_sandbox_id,
                        },
                    )
                raise CloudMaterializationCommandError("Cloud sandbox changed while provisioning.")
            try:
                await open_cloud_sandbox_provider_usage(
                    db,
                    sandbox_id=sandbox.id,
                    provider_sandbox_id=provider_sandbox_id,
                    user_id=owner_user_id,
                    started_at=utcnow(),
                    opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
                    event_id=(f"provider-binding-start:{sandbox.id}:{provider_sandbox_id}"),
                )
            except Exception:
                # The candidate has not been committed to the logical row yet;
                # roll back both staged writes and destroy only that candidate.
                await db.rollback()
                try:
                    await provider.destroy_sandbox(provider_sandbox_id)
                except Exception:
                    logger.exception(
                        "failed to destroy provider sandbox after usage attribution failure",
                        extra={
                            "cloud_sandbox_id": str(sandbox.id),
                            "e2b_sandbox_id": provider_sandbox_id,
                        },
                    )
                provider_sandbox_id = None
                raise
            sandbox = refreshed
            await db.commit()
            provider_sandbox = await provider.resume_sandbox(provider_sandbox_id)

        if provider_sandbox is None or provider_sandbox_id is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox provider did not return a running sandbox."
            )

        # Provider webhooks are advisory and may arrive before binding commit,
        # after this attempt changes status, or not at all. Directly ensure the
        # exact resumed provider has an open segment; the store is idempotent
        # for the same provider and rejects a conflicting live attribution.
        active = await cloud_sandboxes_store.lock_cloud_sandbox_materialization_attempt(
            db,
            sandbox.id,
            expected_provider_sandbox_id=provider_sandbox_id,
        )
        if active is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox changed while resuming its provider."
            )
        sandbox = active
        await open_cloud_sandbox_provider_usage(
            db,
            sandbox_id=sandbox.id,
            provider_sandbox_id=provider_sandbox_id,
            user_id=owner_user_id,
            started_at=utcnow(),
            opened_by=USAGE_SEGMENT_OPENED_BY_RESUME,
            event_id=f"provider-resume-start:{sandbox.id}:{provider_sandbox_id}",
        )
        await db.commit()

        endpoint = await provider.resolve_runtime_endpoint(provider_sandbox)
        runtime_context = await provider.resolve_runtime_context(provider_sandbox)
        runtime_token = _runtime_token(sandbox)
        data_key = _runtime_data_key(sandbox)

        if runtime_token is not None and data_key is not None:
            try:
                await wait_for_runtime_health(
                    endpoint.runtime_url,
                    workspace_id=sandbox.id,
                    total_attempts=4,
                    delay_seconds=0.5,
                )
                await verify_runtime_auth_enforced(
                    endpoint.runtime_url,
                    runtime_token,
                    workspace_id=sandbox.id,
                )
            except Exception:
                await _launch_anyharness_runtime(
                    db,
                    provider=provider,
                    provider_sandbox=provider_sandbox,
                    provider_sandbox_id=provider_sandbox_id,
                    sandbox_record=sandbox,
                    endpoint=endpoint,
                    runtime_context=runtime_context,
                    runtime_token=runtime_token,
                    anyharness_data_key=data_key,
                )
        else:
            runtime_token = secrets.token_urlsafe(32)
            data_key = generate_anyharness_data_key()
            await _launch_anyharness_runtime(
                db,
                provider=provider,
                provider_sandbox=provider_sandbox,
                provider_sandbox_id=provider_sandbox_id,
                sandbox_record=sandbox,
                endpoint=endpoint,
                runtime_context=runtime_context,
                runtime_token=runtime_token,
                anyharness_data_key=data_key,
            )

        # Always finish the attempt with an exact-binding CAS. This clears a
        # previous receipt even when the runtime URL and credentials were reused.
        ready = await cloud_sandboxes_store.mark_cloud_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=provider_sandbox_id,
            e2b_template_ref=provider.template_version,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=(
                sandbox.anyharness_bearer_token_ciphertext or encrypt_text(runtime_token)
            ),
            anyharness_data_key_ciphertext=(
                sandbox.anyharness_data_key_ciphertext or encrypt_text(data_key)
            ),
        )
        if ready is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox provider binding changed while connecting."
            )
        await db.commit()

        return SandboxIOTarget(
            provider=provider,
            sandbox=provider_sandbox,
            endpoint=endpoint,
            runtime_context=runtime_context,
        )
    except Exception as exc:
        await persist_materialization_failure(
            db,
            sandbox_id=sandbox.id,
            expected_provider_sandbox_id=provider_sandbox_id,
            error=exc,
        )
        raise


async def _launch_anyharness_runtime(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    provider_sandbox_id: str,
    sandbox_record: CloudSandboxValue,
    endpoint: RuntimeEndpoint,
    runtime_context: SandboxRuntimeContext,
    runtime_token: str,
    anyharness_data_key: str,
) -> None:
    # Make Managed Runtime Updates Supervisor-Owned, decision 5: default OFF
    # (the legacy direct-nohup path below is unchanged and regression-pinned).
    # Once flipped, every (re)launch through this function boots the
    # Supervisor first instead.
    if settings.supervisor_owned_runtime:
        await _launch_supervisor_owned_runtime(
            db,
            provider=provider,
            provider_sandbox=provider_sandbox,
            provider_sandbox_id=provider_sandbox_id,
            sandbox_record=sandbox_record,
            endpoint=endpoint,
            runtime_context=runtime_context,
            runtime_token=runtime_token,
            anyharness_data_key=anyharness_data_key,
        )
        return

    launcher_path = runtime_launcher_path(runtime_context)
    organization_id = await _resolve_owner_organization_id(db, sandbox_record)
    # Self-heal: a resumed sandbox can still have an OLD anyharness runtime (plus
    # its supervisor/worker) alive and bound to the runtime port, holding a stale
    # bearer token. Relaunching without killing it leaves the old process
    # answering, so auth verification against the new token 401s and the whole
    # reconnect fails. Reuse the supervisor stop mechanism, which targets only
    # the anyharness/worker/supervisor binary paths by pgrep (never user
    # processes) and guards against killing this shell. Best-effort: never let
    # cleanup failures block the relaunch below.
    await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_stop_stale_runtime",
        command=build_supervised_runtime_stop_command(runtime_context),
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    await provider.write_file(
        provider_sandbox,
        launcher_path,
        build_runtime_launch_script(
            provider,
            runtime_context,
            build_runtime_env(
                runtime_token,
                anyharness_data_key=anyharness_data_key,
                organization_id=organization_id,
                sandbox_id=provider_sandbox_id,
                user_id=sandbox_record.owner_user_id,
            ),
        ),
    )
    chmod_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_chmod_anyharness_launcher",
        command=f"chmod 700 {shlex.quote(launcher_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(chmod_result, "AnyHarness launcher chmod failed")

    start_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_launch_anyharness",
        command=build_detached_runtime_launch_command(runtime_context),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    assert_command_succeeded(start_result, "AnyHarness launch failed")
    await wait_for_runtime_health(
        endpoint.runtime_url,
        workspace_id=sandbox_record.id,
        total_attempts=30,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        runtime_token,
        workspace_id=sandbox_record.id,
    )
    await launch_worker_sidecar(
        provider=provider,
        provider_sandbox=provider_sandbox,
        sandbox_record=sandbox_record,
        runtime_context=runtime_context,
        runtime_bearer_token=runtime_token,
    )
    await cloud_sandboxes_store.mark_cloud_sandbox_ready(
        db,
        sandbox_record.id,
        e2b_sandbox_id=provider_sandbox_id,
        e2b_template_ref=provider.template_version,
        anyharness_base_url=endpoint.runtime_url,
        anyharness_bearer_token_ciphertext=encrypt_text(runtime_token),
        anyharness_data_key_ciphertext=encrypt_text(anyharness_data_key),
    )
    await db.commit()


async def _launch_supervisor_owned_runtime(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    provider_sandbox_id: str,
    sandbox_record: CloudSandboxValue,
    endpoint: RuntimeEndpoint,
    runtime_context: SandboxRuntimeContext,
    runtime_token: str,
    anyharness_data_key: str,
) -> None:
    """New-provision topology (decision 5): the Supervisor spawns AnyHarness + Worker.

    Deliberately never calls ``launch_worker_sidecar``: the Supervisor's own
    child-parenting loop spawns the Worker (dependency-ordered after
    AnyHarness), so there is no separate worker-sidecar launch in this branch.
    """
    organization_id = await _resolve_owner_organization_id(db, sandbox_record)
    # Self-heal, same mechanism and same reasoning as the legacy branch: a
    # resumed sandbox can still have an OLD anyharness/worker/supervisor alive
    # holding a stale bearer token.
    await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_stop_stale_runtime",
        command=build_supervised_runtime_stop_command(runtime_context),
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )

    cloud_base_url = worker_cloud_base_url()
    enrollment_token = await mint_cloud_sandbox_worker_enrollment(sandbox_record) or ""

    anyharness_env = build_runtime_env(
        runtime_token,
        anyharness_data_key=anyharness_data_key,
        organization_id=organization_id,
        sandbox_id=provider_sandbox_id,
        user_id=sandbox_record.owner_user_id,
    )
    # Build the Supervisor config first so its TOML can be carried in the Worker
    # config (the D5 bridge on an already-provisioned box materializes it before
    # spawning the Supervisor — R9-007).
    supervisor_config_toml = build_supervisor_config(
        provider,
        runtime_context,
        anyharness_env,
        organization_id=organization_id,
        sandbox_id=provider_sandbox_id,
        user_id=sandbox_record.owner_user_id,
    )
    worker_config_file = worker_config_path(runtime_context)
    supervisor_config_file = supervisor_config_path(runtime_context)
    await provider.write_file(
        provider_sandbox,
        worker_config_file,
        build_worker_config(
            cloud_base_url=cloud_base_url,
            enrollment_token=enrollment_token,
            runtime_context=runtime_context,
            runtime_bearer_token=runtime_token,
            supervisor_owned=True,
            supervisor_config_toml=supervisor_config_toml,
        ),
    )
    await provider.write_file(
        provider_sandbox,
        supervisor_config_file,
        supervisor_config_toml,
    )
    # Both config files carry secrets (bearer/data-key/enrollment tokens); lock
    # them down to 0600 after writing, the same way the launcher is chmod 700
    # (R9-009). `chmod` on a plain file already skips the exec bit.
    chmod_config_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_chmod_supervisor_configs",
        command=(
            f"chmod 600 {shlex.quote(worker_config_file)} {shlex.quote(supervisor_config_file)}"
        ),
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(chmod_config_result, "Supervisor config chmod failed")

    start_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_launch_supervisor",
        command=build_detached_supervisor_launch_command(
            runtime_context,
            organization_id=organization_id,
            sandbox_id=provider_sandbox_id,
            user_id=sandbox_record.owner_user_id,
        ),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    assert_command_succeeded(start_result, "Supervisor launch failed")
    await wait_for_runtime_health(
        endpoint.runtime_url,
        workspace_id=sandbox_record.id,
        total_attempts=30,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        runtime_token,
        workspace_id=sandbox_record.id,
    )
    await cloud_sandboxes_store.mark_cloud_sandbox_ready(
        db,
        sandbox_record.id,
        e2b_sandbox_id=provider_sandbox_id,
        e2b_template_ref=provider.template_version,
        anyharness_base_url=endpoint.runtime_url,
        anyharness_bearer_token_ciphertext=encrypt_text(runtime_token),
        anyharness_data_key_ciphertext=encrypt_text(anyharness_data_key),
    )
    await db.commit()
