"""Runtime worker enrollment + heartbeat service.

Enrollment is single-use and single-active-worker per identity: consuming an
enrollment mints a fresh worker token and a scoped integration-gateway token,
retiring any prior worker for the same sandbox / desktop install.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_INTEGRATION_GATEWAY_MCP_PATH,
    CLOUD_RUNTIME_WORKER_CLOUD_ENROLLMENT_TTL_SECONDS,
    CLOUD_RUNTIME_WORKER_DESKTOP_ENROLLMENT_TTL_SECONDS,
    CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS,
)
from proliferate.db.store import cloud_sandboxes as cloud_sandbox_store
from proliferate.db.store import instance_organizations as instance_organization_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store import runtime_workers as store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.desktop_downloads import (
    downloads_base_url,
    versioned_manifest_exists,
)
from proliferate.integrations.sandbox import (
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.catalogs.service import served_agent_catalog_version
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_supervisor_config,
    build_worker_config,
    supervisor_binary_path,
    supervisor_bridge_marker_dir,
    supervisor_config_path,
    worker_config_path,
)
from proliferate.server.cloud.runtime_workers.models import (
    DesktopWorkerEnrollmentResponse,
    DesktopWorkerRevokeResponse,
    IntegrationGatewayConfig,
    SetSandboxDesiredVersionsResponse,
    WorkerDesiredVersions,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerHeartbeatResponse,
    WorkerSupervisorBridge,
)
from proliferate.server.organizations.domain.policy import organization_admin_roles
from proliferate.server.version import runtime_version_pin as pinned_runtime_version
from proliferate.server.version import worker_version_pin as pinned_worker_version
from proliferate.utils.crypto import decrypt_text
from proliferate.utils.time import utcnow

_TOKEN_BYTES = 48

# Platform tokens the target install script uses when fetching binaries.
_WORKER_ARTIFACT_TARGETS = frozenset(
    {
        "linux-x86_64",
        "linux-aarch64",
        "macos-x86_64",
        "macos-aarch64",
    }
)
# The binary plus its checksum, published alongside on the downloads CDN.
_WORKER_ARTIFACT_ASSETS = frozenset({"proliferate-worker", "proliferate-worker.sha256"})

# The AnyHarness runtime binary a sandbox worker converges onto, plus its
# checksum, published alongside on the downloads CDN. Same platform targets as
# the worker binary.
_RUNTIME_ARTIFACT_TARGETS = _WORKER_ARTIFACT_TARGETS
_RUNTIME_ARTIFACT_ASSETS = frozenset({"anyharness", "anyharness.sha256"})

# Rolling / unpinned coordinate labels a version-pinned request must never
# resolve to. A supervisor-owned target pins an EXACT version and the Supervisor
# fails closed on it; letting a rolling label ("stable"/"latest") satisfy a
# version-pinned fetch is exactly the mislabel hole R9R-001 closes (a sandbox
# pinned to B must not fetch whatever "stable" currently points at).
_ROLLING_VERSION_LABELS = frozenset({"stable", "latest", "current", "rolling"})
# A version flows into a CDN path segment and into the mailbox request as a
# path-embedded identifier, so it must be a safe filename fragment (mirrors the
# protocol crate's `validate_identifier` and the models' version validator).
_VERSION_IDENTIFIER_EXTRA = frozenset("._-+")


def _reject_rolling_or_unsafe_version(version: str) -> None:
    """Fail closed on a rolling/unpinned or unsafe version-pinned coordinate.

    A version-specific artifact fetch must name one exact published version. An
    empty value, a rolling label, or a value that is not a safe path fragment
    is refused with a 404 rather than silently falling back to the rolling
    ``stable`` path (which is what mislabels a B-pinned sandbox with A).
    """
    if (
        version in ("", ".", "..")
        or version.lower() in _ROLLING_VERSION_LABELS
        or not all(
            char.isascii() and (char.isalnum() or char in _VERSION_IDENTIFIER_EXTRA)
            for char in version
        )
    ):
        raise CloudApiError(
            "cloud_artifact_version_invalid",
            "A version-pinned artifact fetch requires an exact published version.",
            status_code=404,
        )


def worker_cloud_base_url() -> str:
    """Base URL workers use to reach Cloud; empty when unconfigured."""
    return (settings.cloud_worker_base_url or settings.api_base_url or "").strip().rstrip("/")


def integration_gateway_config(token: str) -> IntegrationGatewayConfig:
    base = worker_cloud_base_url()
    if not base:
        raise CloudApiError(
            "cloud_worker_misconfigured",
            "No cloud base URL is configured for worker integration gateway access.",
            status_code=500,
        )
    return IntegrationGatewayConfig(
        url=f"{base}{CLOUD_INTEGRATION_GATEWAY_MCP_PATH}",
        authorization=f"Bearer {token}",
    )


async def create_cloud_sandbox_enrollment(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None = None,
) -> str:
    """Mint a pending enrollment token for a cloud sandbox worker.

    Returns the raw enrollment token (only its hash is persisted).
    """
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    await store.create_enrollment(
        db,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=cloud_sandbox_id,
        desktop_install_id=None,
        created_by_user_id=owner_user_id,
        token_hash=store.hash_enrollment_token(token),
        expires_at=utcnow() + timedelta(seconds=CLOUD_RUNTIME_WORKER_CLOUD_ENROLLMENT_TTL_SECONDS),
    )
    return token


async def create_desktop_enrollment(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    desktop_install_id: str,
    organization_id: UUID | None = None,
) -> DesktopWorkerEnrollmentResponse:
    """Mint a short-lived enrollment token for the user's desktop install.

    The worker identity is an immutable (user, org, install) triple: an org id
    supplied here is membership-validated and stamped on the enrollment, so the
    worker (and its gateway grant) is scoped to that org for its whole life.
    Org-less users enroll with ``organization_id=None``.

    Accepted v1 tradeoff: the org scope is client-declared. Personal, org-less
    desktop use must keep working (the desktop also enrolls org-less on cold
    start before the active org resolves), so the server does not derive or
    require an org here — which means an org member can obtain an org-less
    grant (no policy overlay, seeds-only definitions) by omitting the org id.
    Org policy on the gateway is therefore governance for org-scoped workers,
    not a hard security boundary against the org's own members.
    """
    if organization_id is not None:
        # A worker must not be scoped to an org the caller does not belong to;
        # a non-member must not learn the org exists by supplying its id.
        membership = await organization_store.get_active_membership(
            db, organization_id=organization_id, user_id=owner_user_id
        )
        if membership is None:
            raise CloudApiError(
                "organization_not_found", "Organization not found.", status_code=404
            )
    # Serialize ticket rotation with consumption for this physical install.
    # An older Worker stranded before its first enrollment must not be able to
    # enroll after the replacement and take authority back.
    await store.revoke_pending_desktop_enrollments_for_install(
        db,
        desktop_install_id=desktop_install_id,
    )
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    expires_at = utcnow() + timedelta(seconds=CLOUD_RUNTIME_WORKER_DESKTOP_ENROLLMENT_TTL_SECONDS)
    await store.create_enrollment(
        db,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        runtime_kind="desktop",
        cloud_sandbox_id=None,
        desktop_install_id=desktop_install_id,
        created_by_user_id=owner_user_id,
        token_hash=store.hash_enrollment_token(token),
        expires_at=expires_at,
    )
    return DesktopWorkerEnrollmentResponse(
        enrollment_token=token,
        expires_at=expires_at,
    )


async def revoke_desktop_worker(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    desktop_install_id: str,
) -> DesktopWorkerRevokeResponse:
    """Revoke the caller's active desktop worker and its gateway token.

    Idempotent: revoking when no active worker exists is a successful no-op.
    """
    await store.revoke_active_workers_for_identity(
        db,
        cloud_sandbox_id=None,
        owner_user_id=owner_user_id,
        desktop_install_id=desktop_install_id,
    )
    return DesktopWorkerRevokeResponse(revoked=True)


async def enroll_worker(
    db: AsyncSession,
    *,
    request: WorkerEnrollRequest,
) -> WorkerEnrollResponse:
    enrollment = await store.consume_pending_enrollment_by_hash(
        db,
        token_hash=store.hash_enrollment_token(request.enrollment_token),
    )
    if enrollment is None:
        raise CloudApiError(
            "cloud_worker_enrollment_invalid",
            "Enrollment token is invalid, already used, or expired.",
            status_code=401,
        )

    # Single active worker per identity: retire any prior worker + gateway
    # token. Desktop installs run exactly one physical worker process, so a
    # desktop enrollment retires predecessors regardless of owner — otherwise
    # a user switch on the same machine would leave the previous user's worker
    # row "online" and its gateway token active indefinitely.
    if enrollment.runtime_kind == "desktop" and enrollment.desktop_install_id is not None:
        await store.revoke_active_workers_for_desktop_install(
            db,
            desktop_install_id=enrollment.desktop_install_id,
        )
    else:
        await store.revoke_active_workers_for_identity(
            db,
            cloud_sandbox_id=enrollment.cloud_sandbox_id,
            owner_user_id=enrollment.owner_user_id,
            desktop_install_id=enrollment.desktop_install_id,
        )

    worker_token = secrets.token_urlsafe(_TOKEN_BYTES)
    worker = await store.create_worker(
        db,
        enrollment=enrollment,
        token_hash=store.hash_worker_token(worker_token),
        worker_version=request.worker_version,
        anyharness_version=request.anyharness_version,
        hostname=request.hostname,
        machine_fingerprint=request.machine_fingerprint,
    )

    gateway_token = secrets.token_urlsafe(_TOKEN_BYTES)
    await store.create_gateway_token(
        db,
        worker=worker,
        token_hash=store.hash_gateway_token(gateway_token),
    )

    return WorkerEnrollResponse(
        worker_id=str(worker.id),
        worker_token=worker_token,
        heartbeat_interval_seconds=CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS,
        integration_gateway=integration_gateway_config(gateway_token),
    )


async def record_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
    worker_version: str | None = None,
    anyharness_version: str | None = None,
) -> WorkerHeartbeatResponse:
    await store.touch_worker_heartbeat(
        db,
        worker_id=worker_id,
        worker_version=worker_version,
        anyharness_version=anyharness_version,
    )
    # Target-scoped desired state (decision 1): a cloud-sandbox worker's
    # target may override either global pin; a desktop worker (no
    # cloud_sandbox_id) always gets pins only, unchanged from before this PR.
    anyharness_pin = pinned_runtime_version()
    worker_pin = pinned_worker_version()
    desired_topology: str | None = None
    supervisor_bridge: WorkerSupervisorBridge | None = None
    worker = await store.get_worker(db, worker_id=worker_id)
    if worker is not None and worker.cloud_sandbox_id is not None:
        sandbox = await cloud_sandbox_store.load_cloud_sandbox_by_id(db, worker.cloud_sandbox_id)
        if sandbox is not None:
            if sandbox.desired_anyharness_version is not None:
                anyharness_pin = sandbox.desired_anyharness_version
            if sandbox.desired_worker_version is not None:
                worker_pin = sandbox.desired_worker_version
            # D5 bridge (decision 6): only signalled for cloud-sandbox targets,
            # and only once the flag is on. A legacy worker with no field
            # decodes this heartbeat exactly like the pre-PR shape.
            if settings.supervisor_owned_runtime:
                desired_topology = "supervisor_owned"
                # R9R-002: materialize + deliver the bridge inputs so an
                # already-provisioned LEGACY target (whose persisted worker
                # config has none of the bridge fields) can actually bridge.
                supervisor_bridge = _build_supervisor_bridge_inputs(sandbox)
    return WorkerHeartbeatResponse(
        worker_id=str(worker_id),
        server_time=utcnow(),
        heartbeat_interval_seconds=CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS,
        desired_versions=WorkerDesiredVersions(
            worker=worker_pin,
            anyharness=anyharness_pin,
            catalog_version=served_agent_catalog_version(),
        ),
        desired_topology=desired_topology,
        supervisor_bridge=supervisor_bridge,
    )


def _build_supervisor_bridge_inputs(
    sandbox: CloudSandboxValue,
) -> WorkerSupervisorBridge | None:
    """Materialize the D5 bridge inputs for an already-provisioned legacy target
    (R9R-002).

    A legacy Worker's on-disk config predates the supervisor-owned shape, so it
    can only bridge if the server hands it the Supervisor + supervisor-owned
    Worker config TOML and the paths to write them. The paths are deterministic
    from the provider's runtime context (E2B ``resolve_runtime_context`` ignores
    the live sandbox), so they can be computed at heartbeat time without resuming
    the box. Returns ``None`` — no bridge delivered — unless the target is
    genuinely provisioned with runtime credentials; the delivery is best-effort
    and never breaks a heartbeat.
    """
    if (
        not sandbox.e2b_sandbox_id
        or not sandbox.anyharness_bearer_token_ciphertext
        or not sandbox.anyharness_data_key_ciphertext
    ):
        return None
    try:
        provider = get_sandbox_provider(sandbox.e2b_template_ref)
        runtime_context = SandboxRuntimeContext(
            home_dir=provider.user_home,
            runtime_workdir=provider.runtime_workdir,
            runtime_binary_path=provider.runtime_binary_path,
            base_env={"HOME": provider.user_home},
        )
        runtime_token = decrypt_text(sandbox.anyharness_bearer_token_ciphertext)
        anyharness_data_key = decrypt_text(sandbox.anyharness_data_key_ciphertext)
        anyharness_env = build_runtime_env(
            runtime_token,
            anyharness_data_key=anyharness_data_key,
            organization_id=sandbox.organization_id,
            sandbox_id=sandbox.e2b_sandbox_id,
            user_id=sandbox.owner_user_id,
        )
        supervisor_config_toml = build_supervisor_config(
            provider,
            runtime_context,
            anyharness_env,
            organization_id=sandbox.organization_id,
            sandbox_id=sandbox.e2b_sandbox_id,
            user_id=sandbox.owner_user_id,
        )
        # The Supervisor's spawned Worker child reuses the already-enrolled
        # identity persisted in worker.sqlite3, so no enrollment token is needed
        # here (empty is unused: `ensure_enrolled` loads the stored identity
        # first). Minting one per heartbeat would leak single-use tokens.
        worker_config_toml = build_worker_config(
            cloud_base_url=worker_cloud_base_url(),
            enrollment_token="",
            runtime_context=runtime_context,
            runtime_bearer_token=runtime_token,
            supervisor_owned=True,
            supervisor_config_toml=supervisor_config_toml,
        )
        return WorkerSupervisorBridge(
            supervisor_binary_path=supervisor_binary_path(runtime_context),
            supervisor_config_path=supervisor_config_path(runtime_context),
            supervisor_config_toml=supervisor_config_toml,
            worker_config_path=worker_config_path(runtime_context),
            worker_config_toml=worker_config_toml,
            marker_dir=supervisor_bridge_marker_dir(runtime_context),
        )
    except Exception:  # noqa: BLE001 - bridge delivery must never break a heartbeat.
        return None


async def _require_instance_admin(db: AsyncSession, *, user_id: UUID) -> None:
    """Require the caller hold the admin role in the instance organization.

    ``cloud_sandbox`` rows are user-owned, not organization-scoped, so there
    is no per-target organization to check membership against. Setting a
    target's desired runtime versions is an operator action, gated the same
    way every other instance-wide admin action in this codebase is gated: the
    caller must hold at least the admin role in the single instance
    organization (see ``proliferate.server.organizations.admin_emails`` for
    the ADMIN_EMAILS floor that keeps that org non-empty).
    """
    instance_organization = await instance_organization_store.get_instance_organization(db)
    if instance_organization is None:
        raise CloudApiError(
            "instance_admin_required",
            "No instance organization is configured.",
            status_code=403,
        )
    membership = await organization_store.get_active_membership(
        db,
        organization_id=instance_organization.id,
        user_id=user_id,
    )
    if membership is None or membership.role not in organization_admin_roles():
        raise CloudApiError(
            "instance_admin_required",
            "You do not have permission to manage sandbox runtime versions.",
            status_code=403,
        )


async def set_sandbox_desired_versions(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    actor_user_id: UUID,
    desired_anyharness_version: str | None,
    desired_worker_version: str | None,
) -> SetSandboxDesiredVersionsResponse:
    """Overlay one sandbox's target-scoped desired versions (decision 1).

    Admin-authenticated; changing target A never affects target B (each call
    touches exactly the one ``cloud_sandbox`` row named by ``cloud_sandbox_id``).
    """
    await _require_instance_admin(db, user_id=actor_user_id)
    updated = await cloud_sandbox_store.set_cloud_sandbox_desired_versions(
        db,
        cloud_sandbox_id,
        desired_anyharness_version=desired_anyharness_version,
        desired_worker_version=desired_worker_version,
    )
    if updated is None:
        raise CloudApiError("cloud_sandbox_not_found", "Cloud sandbox not found.", status_code=404)
    # The request's session dependency (get_async_session) commits on success;
    # the service layer must not call db.commit() (server-boundary rule).
    return SetSandboxDesiredVersionsResponse(
        cloud_sandbox_id=str(updated.id),
        desired_anyharness_version=updated.desired_anyharness_version,
        desired_worker_version=updated.desired_worker_version,
    )


async def worker_artifact_redirect_url(*, target: str, asset: str) -> str:
    """Resolve the downloads-CDN URL for a pinned worker binary (or checksum).

    Mirrors the desktop updater redirect: the server carries only the version
    pin, never the artifact itself, and falls back to the unpinned ``stable``
    path when the pinned artifact has not been published yet.

    Each call resolves the pinned-vs-fallback path independently, so two calls
    (binary then checksum) can straddle a CDN publish and disagree. A worker
    converging its binary must therefore resolve the version path *once* — it
    fetches the binary here, then derives its ``.sha256`` URL from that
    redirect's resolved location (same directory, same version) instead of
    resolving the checksum through a second redirect (see
    ``proliferate-worker``'s ``self_update`` module). The per-asset resolution
    below remains for the install script, which fetches a fresh pair.
    """
    if target not in _WORKER_ARTIFACT_TARGETS or asset not in _WORKER_ARTIFACT_ASSETS:
        raise CloudApiError(
            "cloud_worker_artifact_unknown",
            "Unknown worker artifact target or asset.",
            status_code=404,
        )
    base = downloads_base_url()
    pin = pinned_worker_version()
    if pin is not None:
        pinned = f"{base}/worker/stable/{pin}/{target}/{asset}"
        if await versioned_manifest_exists(pinned):
            return pinned
    return f"{base}/worker/stable/{target}/{asset}"


async def runtime_artifact_redirect_url(*, target: str, asset: str) -> str:
    """Resolve the downloads-CDN URL for the pinned AnyHarness binary (or checksum).

    Parallel to :func:`worker_artifact_redirect_url`: the server carries only
    the ``RUNTIME_VERSION`` pin, never the artifact, and falls back to the
    unpinned ``stable`` path when the pinned artifact has not been published
    yet. A sandbox worker converging its runtime resolves the version path once
    (fetching the binary here) and derives the ``.sha256`` URL from that
    redirect's resolved location, so binary and checksum always share a
    directory — and thus a version. Keeps the sandbox free of any GitHub egress
    or credentials, exactly like the worker path.
    """
    if target not in _RUNTIME_ARTIFACT_TARGETS or asset not in _RUNTIME_ARTIFACT_ASSETS:
        raise CloudApiError(
            "cloud_runtime_artifact_unknown",
            "Unknown runtime artifact target or asset.",
            status_code=404,
        )
    base = downloads_base_url()
    pin = pinned_runtime_version()
    if pin is not None:
        pinned = f"{base}/runtime/stable/{pin}/{target}/{asset}"
        if await versioned_manifest_exists(pinned):
            return pinned
    return f"{base}/runtime/stable/{target}/{asset}"


async def worker_artifact_versioned_redirect_url(*, target: str, version: str, asset: str) -> str:
    """Resolve the CDN URL for the worker binary at an EXACT version (R9R-001).

    Unlike :func:`worker_artifact_redirect_url`, this never resolves the global
    pin and never falls back to the rolling ``stable`` path: a supervisor-owned
    target pins one exact version and the Supervisor fails closed on it, so the
    request URL must encode that version and the server must resolve THAT version
    or 404. A rolling/unpinned coordinate is rejected up front; an unpublished
    exact version is a 404 (no fallback), so a B-pinned sandbox can never be
    handed an A-labelled ``stable`` artifact.
    """
    if target not in _WORKER_ARTIFACT_TARGETS or asset not in _WORKER_ARTIFACT_ASSETS:
        raise CloudApiError(
            "cloud_worker_artifact_unknown",
            "Unknown worker artifact target or asset.",
            status_code=404,
        )
    _reject_rolling_or_unsafe_version(version)
    base = downloads_base_url()
    pinned = f"{base}/worker/stable/{version}/{target}/{asset}"
    if not await versioned_manifest_exists(pinned):
        raise CloudApiError(
            "cloud_worker_artifact_version_unpublished",
            "The requested worker artifact version is not published.",
            status_code=404,
        )
    return pinned


async def runtime_artifact_versioned_redirect_url(*, target: str, version: str, asset: str) -> str:
    """Resolve the CDN URL for the AnyHarness binary at an EXACT version (R9R-001).

    The runtime parallel of :func:`worker_artifact_versioned_redirect_url`: no
    global-pin resolution, no rolling-``stable`` fallback. The version-pinned
    request URL names the exact version, and the server resolves that version or
    fails closed with a 404.
    """
    if target not in _RUNTIME_ARTIFACT_TARGETS or asset not in _RUNTIME_ARTIFACT_ASSETS:
        raise CloudApiError(
            "cloud_runtime_artifact_unknown",
            "Unknown runtime artifact target or asset.",
            status_code=404,
        )
    _reject_rolling_or_unsafe_version(version)
    base = downloads_base_url()
    pinned = f"{base}/runtime/stable/{version}/{target}/{asset}"
    if not await versioned_manifest_exists(pinned):
        raise CloudApiError(
            "cloud_runtime_artifact_version_unpublished",
            "The requested runtime artifact version is not published.",
            status_code=404,
        )
    return pinned
