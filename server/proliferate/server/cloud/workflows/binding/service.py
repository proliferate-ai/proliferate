"""Materialization-only credential issuance and exactly-one binding CAS."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

import proliferate.db.store.workflow_ledger.bindings as binding_store
from proliferate.constants.workflows import (
    WORKFLOW_MATERIALIZATION_CREDENTIAL_AUDIENCE,
    WORKFLOW_MATERIALIZATION_CREDENTIAL_TTL_SECONDS,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import cloud_workflows as run_store
from proliferate.db.store import cloud_workspaces as workspace_store
from proliferate.db.store import repositories as repository_store
from proliferate.db.store import runtime_workers as worker_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.binding.access import BindingActor
from proliferate.server.cloud.workflows.binding.models import (
    AcceptExecutionBindingRequest,
    ExecutionBindingAcceptanceResponse,
    ExecutionBindingStatusResponse,
)
from proliferate.server.cloud.workflows.contracts import canonicalize
from proliferate.server.cloud.workflows.contracts.canonical import CanonicalizationError
from proliferate.server.cloud.workflows.contracts.models import (
    ExecutionBinding,
    LegacyResolvedPlanV1,
    MaterializationOffer,
    SourceIntent,
    binding_hash,
)
from proliferate.server.cloud.workflows.contracts.models import (
    plan_hash as compute_plan_hash,
)
from proliferate.utils.time import utcnow

_CANONICAL_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
_TOKEN_PREFIX = "wfm1"
_TOKEN_SECRET_BYTES = 32
_TOKEN_SECRET_LENGTH = 43
_TOKEN_LENGTH = len(_TOKEN_PREFIX) + 1 + 36 + 1 + _TOKEN_SECRET_LENGTH
_MATERIALIZATION_CREDENTIAL = re.compile(
    rf"^{_TOKEN_PREFIX}\."
    r"(?P<offer>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\."
    rf"(?P<secret>[A-Za-z0-9_-]{{{_TOKEN_SECRET_LENGTH}}})$"
)


@dataclass(frozen=True)
class _OfferAuthority:
    workspace_id: str
    workspace_generation: int
    executor_generation: int


def _error(code: str, message: str, status_code: int) -> CloudApiError:
    return CloudApiError(code, message, status_code=status_code)


def _target(target_mode: str) -> str:
    if target_mode == WORKFLOW_TARGET_MODE_LOCAL:
        return "local"
    if target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        return "personal_cloud"
    raise _error("workflow_binding_target_invalid", "Run target is unsupported.", 409)


def _source_intent(plan: object) -> SourceIntent:
    if not isinstance(plan, dict):
        raise _error(
            "workflow_plan_identity_conflict",
            "Stored logical plan is not a JSON object.",
            409,
        )
    raw = plan.get("sourceIntent")
    try:
        return SourceIntent.model_validate(raw)
    except ValidationError as exc:
        raise _error(
            "workflow_source_intent_invalid",
            "Run plan has no valid sourceIntent.",
            409,
        ) from exc


async def _validated_plan_hash(
    db: AsyncSession,
    run: run_store.WorkflowRunRecord,
    *,
    lock_version: bool,
) -> str:
    plan = run.resolved_plan_json
    if not isinstance(plan, dict):
        raise _error(
            "workflow_plan_identity_conflict",
            "Stored logical plan is not a JSON object.",
            409,
        )
    if (
        run.plan_version != 1
        or plan.get("planVersion") != 1
        or plan.get("planHash") != run.plan_hash
        or plan.get("run_id") != str(run.id)
        or plan.get("workflow_id") != str(run.workflow_id)
        or plan.get("workflow_version_id") != str(run.workflow_version_id)
        or plan.get("trigger_kind") != run.trigger_kind
        or plan.get("target_mode") != run.target_mode
    ):
        raise _error(
            "workflow_plan_identity_incomplete",
            "Run is missing the exact versioned logical-plan identity.",
            409,
        )
    version = await run_store.get_version(
        db,
        run.workflow_version_id,
        lock_row=lock_version,
    )
    if (
        version is None
        or version.workflow_id != run.workflow_id
        or plan.get("version_n") != version.version_n
    ):
        raise _error(
            "workflow_plan_identity_incomplete",
            "Run plan does not match its immutable workflow version ledger.",
            409,
        )
    try:
        LegacyResolvedPlanV1.model_validate(plan)
    except ValidationError as exc:
        raise _error(
            "workflow_plan_identity_incomplete",
            "Run does not contain a strict legacy resolved-plan v1 wire.",
            409,
        ) from exc
    try:
        computed = compute_plan_hash(plan)
    except CanonicalizationError as exc:
        raise _error(
            "workflow_plan_identity_conflict",
            "Stored logical plan cannot be canonicalized safely.",
            409,
        ) from exc
    if run.plan_hash is None or not _CANONICAL_HASH.fullmatch(run.plan_hash):
        raise _error(
            "workflow_plan_identity_incomplete",
            "Run is missing a canonical immutable plan hash.",
            409,
        )
    if not hmac.compare_digest(computed, run.plan_hash):
        raise _error(
            "workflow_plan_identity_conflict",
            "Stored logical plan does not match its immutable plan hash.",
            409,
        )
    return computed


async def _assert_current_cloud_executor(
    db: AsyncSession,
    *,
    actor: BindingActor,
    run: run_store.WorkflowRunRecord,
    executor_id: str,
) -> None:
    if (
        actor.runtime_kind != "cloud_sandbox"
        or actor.cloud_sandbox_id is None
        or actor.generation <= 0
        or executor_id != str(actor.worker_id)
    ):
        raise _error(
            "workflow_cloud_executor_forbidden",
            "Only the selected authenticated cloud worker may materialize this run.",
            403,
        )
    worker = await worker_store.get_active_worker_by_id(
        db, worker_id=actor.worker_id, lock_row=True
    )
    if (
        worker is None
        or worker.owner_user_id != run.executor_user_id
        or worker.runtime_kind != "cloud_sandbox"
        or worker.cloud_sandbox_id != actor.cloud_sandbox_id
        or worker.generation != actor.generation
    ):
        raise _error(
            "workflow_cloud_executor_forbidden",
            "The selected cloud worker is no longer active.",
            403,
        )
    current = await sandbox_store.load_personal_cloud_sandbox(
        db, run.executor_user_id, lock_row=True
    )
    if current is None or current.id != actor.cloud_sandbox_id:
        raise _error(
            "workflow_cloud_executor_forbidden",
            "The worker is not bound to the current personal cloud sandbox.",
            403,
        )


def _assert_bindable_run(run: run_store.WorkflowRunRecord) -> None:
    if (
        run.status in WORKFLOW_RUN_TERMINAL_STATUSES
        or run.desired_state != "running"
        or run.preaccept_cancel_state != "none"
    ):
        raise _error(
            "workflow_run_not_bindable",
            "The run is terminal, cancelled, or no longer accepting a binding.",
            409,
        )


async def _cloud_offer_authority(
    db: AsyncSession,
    *,
    actor: BindingActor,
    run: run_store.WorkflowRunRecord,
    executor_id: str,
) -> _OfferAuthority:
    await _assert_current_cloud_executor(db, actor=actor, run=run, executor_id=executor_id)
    workspace_id = run.anyharness_workspace_id
    if not workspace_id:
        raise _error(
            "workflow_binding_workspace_conflict",
            "Cloud run has no pinned target workspace.",
            409,
        )
    workspace = await workspace_store.get_cloud_workspace_by_runtime_id(
        db,
        user_id=run.executor_user_id,
        anyharness_workspace_id=workspace_id,
        lock_row=True,
    )
    if workspace is None or workspace.generation <= 0:
        raise _error(
            "workflow_binding_workspace_conflict",
            "Cloud run target workspace is no longer current.",
            409,
        )
    source = _source_intent(run.resolved_plan_json)
    repository = await repository_store.get_repo_environment_by_id(
        db, workspace.repo_environment_id, lock_row=True
    )
    expected_repo = (
        None
        if repository is None
        else f"github.com/{repository.git_owner}/{repository.git_repo_name}"
    )
    expected_ref = f"refs/heads/{workspace.git_branch}"
    if (
        repository is None
        or repository.user_id != run.executor_user_id
        or repository.environment_kind != "cloud"
        or repository.git_provider != "github"
        or source.kind != "remote_commit"
        or source.repo != expected_repo
        or source.ref != expected_ref
        or source.resolved_commit is None
        or re.fullmatch(r"[0-9a-f]{40}", source.resolved_commit) is None
    ):
        raise _error(
            "workflow_source_provenance_invalid",
            "Cloud run source intent does not match its pinned repository and ref.",
            409,
        )
    assert actor.generation is not None
    return _OfferAuthority(
        workspace_id=workspace_id,
        workspace_generation=workspace.generation,
        executor_generation=actor.generation,
    )


async def _local_offer_authority(
    db: AsyncSession,
    *,
    actor: BindingActor,
    run: run_store.WorkflowRunRecord,
    executor_id: str,
    claim_id: UUID | None,
    now: datetime,
) -> _OfferAuthority:
    if (
        actor.runtime_kind != "desktop"
        or not actor.desktop_install_id
        or actor.desktop_install_id != executor_id
        or actor.generation <= 0
    ):
        raise _error(
            "workflow_local_executor_forbidden",
            "Only the selected authenticated Desktop worker may materialize this run.",
            403,
        )
    worker = await worker_store.get_active_worker_by_id(
        db, worker_id=actor.worker_id, lock_row=True
    )
    if (
        worker is None
        or worker.owner_user_id != run.executor_user_id
        or worker.runtime_kind != "desktop"
        or worker.desktop_install_id != actor.desktop_install_id
        or worker.generation != actor.generation
    ):
        raise _error(
            "workflow_local_executor_forbidden",
            "The selected Desktop worker is no longer active.",
            403,
        )
    if (
        run.status != "claimed"
        or run.executor_id != executor_id
        or run.claim_id is None
        or claim_id != run.claim_id
        or run.claim_expires_at is None
        or run.claim_expires_at <= now
        or not run.anyharness_workspace_id
        or run.claimed_workspace_id != run.anyharness_workspace_id
        or run.claimed_workspace_generation is None
        or run.claimed_workspace_generation <= 0
        or run.claim_generation is None
        or run.claim_generation <= 0
    ):
        raise _error(
            "workflow_local_claim_conflict",
            "Local materialization must match the current active Desktop claim and workspace.",
            409,
        )
    return _OfferAuthority(
        workspace_id=run.claimed_workspace_id,
        workspace_generation=run.claimed_workspace_generation,
        executor_generation=actor.generation,
    )


async def _assert_offer_actor(
    db: AsyncSession,
    *,
    actor: BindingActor,
    run: run_store.WorkflowRunRecord,
    offer: binding_store.MaterializationOfferRecord,
) -> None:
    expected_kind = (
        "cloud_sandbox" if run.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD else "desktop"
    )
    worker = await worker_store.get_active_worker_by_id(
        db, worker_id=actor.worker_id, lock_row=True
    )
    actor_matches_offer = (
        str(actor.worker_id) == offer.executor_id
        if expected_kind == "cloud_sandbox"
        else actor.desktop_install_id == offer.executor_id
    )
    if (
        actor.runtime_kind != expected_kind
        or not actor_matches_offer
        or actor.generation != offer.executor_generation
        or worker is None
        or worker.owner_user_id != run.executor_user_id
        or worker.runtime_kind != expected_kind
        or worker.generation != actor.generation
        or worker.cloud_sandbox_id != actor.cloud_sandbox_id
        or worker.desktop_install_id != actor.desktop_install_id
    ):
        code = (
            "workflow_cloud_executor_forbidden"
            if expected_kind == "cloud_sandbox"
            else "workflow_local_executor_forbidden"
        )
        raise _error(
            code,
            "Only the selected authenticated executor generation may accept this binding.",
            403,
        )


def _credential_digest(*, salt_hex: str, secret: str, audience: str) -> str:
    material = bytes.fromhex(salt_hex) + b"\0" + audience.encode() + b"\0" + secret.encode()
    return hashlib.sha256(material).hexdigest()


def _accepted_credential_digest(
    offer: binding_store.MaterializationOfferRecord,
    *,
    secret: str,
    now: datetime,
) -> str | None:
    if (
        offer.audience != WORKFLOW_MATERIALIZATION_CREDENTIAL_AUDIENCE
        or re.fullmatch(r"[0-9a-f]{64}", offer.credential_salt) is None
        or re.fullmatch(r"[0-9a-f]{64}", offer.credential_hash) is None
        or offer.status not in {"pending", "consumed"}
        or not isinstance(offer.expires_at, datetime)
        or offer.expires_at.tzinfo is None
        or now >= offer.expires_at
    ):
        return None
    try:
        return _credential_digest(
            salt_hex=offer.credential_salt,
            secret=secret,
            audience=offer.audience,
        )
    except (UnicodeError, ValueError):
        return None


def _mint_credential(offer_id: UUID) -> tuple[str, str, str]:
    secret = secrets.token_urlsafe(_TOKEN_SECRET_BYTES)
    salt_hex = secrets.token_hex(32)
    digest = _credential_digest(
        salt_hex=salt_hex,
        secret=secret,
        audience=WORKFLOW_MATERIALIZATION_CREDENTIAL_AUDIENCE,
    )
    return f"{_TOKEN_PREFIX}.{offer_id}.{secret}", salt_hex, digest


def _parse_credential(raw: str) -> tuple[UUID, str]:
    match = _MATERIALIZATION_CREDENTIAL.fullmatch(raw) if len(raw) == _TOKEN_LENGTH else None
    if match is None:
        raise _error(
            "workflow_materialization_credential_invalid",
            "Materialization credential is malformed.",
            401,
        )
    offer_raw = match.group("offer")
    try:
        offer_id = UUID(offer_raw)
    except ValueError as exc:
        raise _error(
            "workflow_materialization_credential_invalid",
            "Materialization credential is malformed.",
            401,
        ) from exc
    if str(offer_id) != offer_raw or offer_id.version != 4:
        raise _error(
            "workflow_materialization_credential_invalid",
            "Materialization credential is malformed.",
            401,
        )
    return offer_id, match.group("secret")


async def issue_materialization_offer(
    db: AsyncSession,
    actor: BindingActor,
    *,
    run_id: UUID,
    executor_id: str,
    claim_id: UUID | None,
) -> MaterializationOffer:
    executor_id = executor_id.strip()
    if (
        not executor_id
        or len(executor_id) > 255
        or any(
            character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F
            for character in executor_id
        )
    ):
        raise _error(
            "workflow_executor_id_invalid",
            "executorId must be a bounded identifier without whitespace or controls.",
            400,
        )
    run = await run_store.lock_run(db, run_id)
    if run is None or run.executor_user_id != actor.owner_user_id:
        raise _error("workflow_run_not_found", "Workflow run not found.", 404)
    _assert_bindable_run(run)
    now = utcnow()
    target = _target(run.target_mode)
    if run.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        authority = await _cloud_offer_authority(
            db,
            actor=actor,
            run=run,
            executor_id=executor_id,
        )
        if claim_id is not None:
            raise _error(
                "workflow_claim_fence_invalid",
                "claimId is not valid for a cloud executor.",
                400,
            )
        executor_fence = f"worker:{executor_id}:generation:{authority.executor_generation}"
    else:
        authority = await _local_offer_authority(
            db,
            actor=actor,
            run=run,
            executor_id=executor_id,
            claim_id=claim_id,
            now=now,
        )
        if run.claim_id is None:
            raise _error(
                "workflow_local_claim_conflict",
                "Local run has no current claim fence.",
                409,
            )
        executor_fence = str(run.claim_id)

    plan_hash = await _validated_plan_hash(db, run, lock_version=True)
    source_intent = _source_intent(run.resolved_plan_json)
    if source_intent.kind == "workspace_checkpoint":
        raise _error(
            "workflow_checkpoint_attestation_unavailable",
            "Local checkpoint materialization requires a trusted AnyHarness attestation boundary.",
            409,
        )
    identity_fields = (
        run.binding_hash,
        run.execution_generation,
        run.execution_binding_json,
    )
    if any(value is not None for value in identity_fields):
        raise _error(
            "workflow_binding_already_accepted",
            "This run already has an accepted or partial binding identity.",
            409,
        )

    expires_at = now + timedelta(seconds=WORKFLOW_MATERIALIZATION_CREDENTIAL_TTL_SECONDS)
    current = await binding_store.lock_pending_offer(
        db,
        workflow_run_id=run_id,
    )
    if current is None:
        generation = await binding_store.next_offer_generation(db, workflow_run_id=run_id)
        offer_id = uuid4()
        credential, salt, digest = _mint_credential(offer_id)
        current = await binding_store.create_offer(
            db,
            offer_id=offer_id,
            workflow_run_id=run_id,
            plan_hash=plan_hash,
            execution_generation=generation,
            executor_id=executor_id,
            executor_fence=executor_fence,
            workspace_id=authority.workspace_id,
            workspace_generation=authority.workspace_generation,
            executor_generation=authority.executor_generation,
            audience=WORKFLOW_MATERIALIZATION_CREDENTIAL_AUDIENCE,
            credential_salt=salt,
            credential_hash=digest,
            expires_at=expires_at,
            now=now,
        )
    else:
        if (
            current.plan_hash != plan_hash
            or current.executor_id != executor_id
            or current.executor_fence != executor_fence
            or current.workspace_id != authority.workspace_id
            or current.workspace_generation != authority.workspace_generation
            or current.executor_generation != authority.executor_generation
        ):
            await binding_store.revoke_offer(db, offer_id=current.id, now=now)
            generation = await binding_store.next_offer_generation(db, workflow_run_id=run_id)
            offer_id = uuid4()
            credential, salt, digest = _mint_credential(offer_id)
            current = await binding_store.create_offer(
                db,
                offer_id=offer_id,
                workflow_run_id=run_id,
                plan_hash=plan_hash,
                execution_generation=generation,
                executor_id=executor_id,
                executor_fence=executor_fence,
                workspace_id=authority.workspace_id,
                workspace_generation=authority.workspace_generation,
                executor_generation=authority.executor_generation,
                audience=WORKFLOW_MATERIALIZATION_CREDENTIAL_AUDIENCE,
                credential_salt=salt,
                credential_hash=digest,
                expires_at=expires_at,
                now=now,
            )
        else:
            credential, salt, digest = _mint_credential(current.id)
            current = await binding_store.rotate_offer_credential(
                db,
                offer_id=current.id,
                credential_salt=salt,
                credential_hash=digest,
                expires_at=expires_at,
                now=now,
            )
    await binding_store.mark_run_materializing(db, run_id=run_id, now=now)
    return MaterializationOffer(
        schema_version=1,
        run_id=str(run_id),
        plan_hash=plan_hash,
        target=target,
        execution_generation=current.execution_generation,
        executor_id=current.executor_id,
        executor_fence=current.executor_fence,
        source_intent=source_intent,
        materialization_credential=credential,
        credential_generation=current.credential_generation,
        expires_at=current.expires_at.isoformat(),
    )


def _validate_binding_grammar(binding: ExecutionBinding) -> None:
    if not _CANONICAL_HASH.fullmatch(binding.binding_hash):
        raise _error(
            "workflow_binding_hash_invalid",
            "bindingHash must be sha256 followed by 64 lowercase hex characters.",
            400,
        )
    expected_oid_length = 40 if binding.repository_object_format == "sha1" else 64
    if not re.fullmatch(rf"[0-9a-f]{{{expected_oid_length}}}", binding.base_commit_oid):
        raise _error(
            "workflow_binding_base_oid_invalid",
            "baseCommitOid does not match repositoryObjectFormat.",
            400,
        )
    if binding.workspace_generation <= 0 or binding.executor_generation <= 0:
        raise _error(
            "workflow_binding_generation_invalid",
            "Binding generations must be positive.",
            400,
        )
    identifiers = [
        ("workspaceId", binding.workspace_id),
        ("materializationId", binding.materialization_id),
        ("executorId", binding.executor_id),
    ]
    if binding.checkpoint_id is not None:
        identifiers.append(("checkpointId", binding.checkpoint_id))
    for name, value in identifiers:
        if (
            not value
            or len(value) > 255
            or any(
                character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F
                for character in value
            )
        ):
            raise _error(
                "workflow_binding_identifier_invalid",
                f"{name} must be a bounded identifier without whitespace or controls.",
                400,
            )
    is_checkpoint = binding.source_kind == "workspace_checkpoint"
    if is_checkpoint:
        if (
            not binding.checkpoint_id
            or not binding.checkpoint_content_hash
            or not _CANONICAL_HASH.fullmatch(binding.checkpoint_content_hash)
        ):
            raise _error(
                "workflow_binding_checkpoint_invalid",
                "workspace_checkpoint requires a checkpoint id and canonical content hash.",
                400,
            )
    elif binding.checkpoint_id is not None or binding.checkpoint_content_hash is not None:
        raise _error(
            "workflow_binding_checkpoint_invalid",
            "Checkpoint fields are forbidden for commit source kinds.",
            400,
        )


def _parse_and_validate_binding(
    raw: dict[str, object],
) -> tuple[ExecutionBinding, dict[str, object]]:
    try:
        parsed = ExecutionBinding.model_validate(raw)
    except ValidationError as exc:
        raise _error(
            "workflow_execution_binding_invalid",
            "Execution binding is invalid.",
            400,
        ) from exc
    canonical = parsed.to_wire()
    try:
        raw_bytes = canonicalize(raw)
        canonical_bytes = canonicalize(canonical)
        computed = binding_hash(raw)
    except CanonicalizationError as exc:
        raise _error(
            "workflow_execution_binding_invalid",
            "Execution binding is outside the canonical JSON value domain.",
            400,
        ) from exc
    if raw_bytes != canonical_bytes:
        raise _error(
            "workflow_execution_binding_noncanonical",
            "Execution binding must use the exact versioned wire field set.",
            400,
        )
    _validate_binding_grammar(parsed)
    if not hmac.compare_digest(computed, parsed.binding_hash):
        raise _error(
            "workflow_binding_hash_mismatch",
            "bindingHash does not match the canonical binding content.",
            400,
        )
    return parsed, canonical


def _stored_binding_matches(stored: object, expected: dict[str, object]) -> bool:
    if not isinstance(stored, dict):
        raise _error(
            "workflow_binding_identity_conflict",
            "Stored execution binding is not a canonical JSON object.",
            409,
        )
    try:
        return canonicalize(stored) == canonicalize(expected)
    except CanonicalizationError as exc:
        raise _error(
            "workflow_binding_identity_conflict",
            "Stored execution binding is outside the canonical JSON value domain.",
            409,
        ) from exc


async def accept_execution_binding(
    db: AsyncSession,
    actor: BindingActor,
    *,
    run_id: UUID,
    request: AcceptExecutionBindingRequest,
    materialization_credential: str,
) -> ExecutionBindingAcceptanceResponse:
    offer_id, secret = _parse_credential(materialization_credential)
    # Consistent lock order with issuance: run first, then offer.
    run = await run_store.lock_run(db, run_id)
    if run is None or run.executor_user_id != actor.owner_user_id:
        raise _error("workflow_run_not_found", "Workflow run not found.", 404)
    offer = await binding_store.lock_offer_by_id(db, offer_id)
    if offer is None or offer.workflow_run_id != run_id:
        raise _error(
            "workflow_materialization_credential_invalid",
            "Materialization credential is invalid for this run.",
            401,
        )
    now = utcnow()
    expected_digest = _accepted_credential_digest(offer, secret=secret, now=now)
    if expected_digest is None or not hmac.compare_digest(expected_digest, offer.credential_hash):
        raise _error(
            "workflow_materialization_credential_invalid",
            "Materialization credential is invalid, expired, or revoked.",
            401,
        )
    await _assert_offer_actor(db, actor=actor, run=run, offer=offer)

    plan_hash = await _validated_plan_hash(db, run, lock_version=True)
    binding, canonical_binding = _parse_and_validate_binding(request.binding)
    if offer.status == "consumed":
        # Exact response-loss recovery is an acknowledgement of an immutable
        # commit, not a second acceptance attempt. Once the offer and run carry
        # the same accepted bytes, later cancellation, terminal state, local
        # reclaim, or workspace rematerialization must not erase that ACK.
        if (
            offer.accepted_binding_hash == binding.binding_hash
            and offer.plan_hash == plan_hash
            and request.execution_generation == offer.execution_generation
            and request.executor_fence == offer.executor_fence
            and binding.executor_id == offer.executor_id
            and run.plan_hash == plan_hash
            and run.binding_hash == binding.binding_hash
            and run.execution_generation == request.execution_generation
            and run.execution_binding_json is not None
            and _stored_binding_matches(run.execution_binding_json, canonical_binding)
        ):
            return ExecutionBindingAcceptanceResponse(
                accepted=True,
                idempotent=True,
                run_id=str(run_id),
                plan_hash=plan_hash,
                binding_hash=binding.binding_hash,
                execution_generation=request.execution_generation,
                acceptance_state="accepted",
                binding=binding,
            )
        raise _error(
            "workflow_binding_identity_conflict",
            "Offer was already consumed by another binding.",
            409,
        )

    # All mutable authority and cancellation guards apply before the first
    # binding commit. They intentionally do not override the exact committed
    # acknowledgement path above.
    _assert_bindable_run(run)
    if run.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        authority = await _cloud_offer_authority(
            db,
            actor=actor,
            run=run,
            executor_id=offer.executor_id,
        )
    else:
        try:
            offer_claim_id = UUID(offer.executor_fence)
        except ValueError as exc:
            raise _error(
                "workflow_local_claim_conflict",
                "Local offer has an invalid claim fence.",
                409,
            ) from exc
        authority = await _local_offer_authority(
            db,
            actor=actor,
            run=run,
            executor_id=offer.executor_id,
            claim_id=offer_claim_id,
            now=now,
        )
    source_intent = _source_intent(run.resolved_plan_json)
    if source_intent.kind == "workspace_checkpoint":
        raise _error(
            "workflow_checkpoint_attestation_unavailable",
            "Local checkpoint bindings require a trusted AnyHarness attestation boundary.",
            409,
        )
    expected_target = _target(run.target_mode)
    if offer.plan_hash != plan_hash:
        raise _error("workflow_offer_identity_conflict", "Offer plan identity is stale.", 409)
    if (
        offer.workspace_id != authority.workspace_id
        or offer.workspace_generation != authority.workspace_generation
        or offer.executor_generation != authority.executor_generation
    ):
        raise _error(
            "workflow_offer_identity_conflict",
            "Offer workspace or executor identity is stale.",
            409,
        )
    if request.execution_generation != offer.execution_generation:
        raise _error(
            "workflow_offer_generation_conflict",
            "Execution generation does not match the offer.",
            409,
        )
    if request.executor_fence != offer.executor_fence:
        raise _error(
            "workflow_offer_fence_conflict", "Executor fence does not match the offer.", 409
        )
    if binding.executor_id != offer.executor_id:
        raise _error(
            "workflow_binding_executor_conflict", "Binding executor does not match the offer.", 409
        )
    if binding.target != expected_target or binding.source_kind != source_intent.kind:
        raise _error(
            "workflow_binding_source_conflict",
            "Binding target/sourceKind does not match the materialization offer.",
            409,
        )
    if (
        binding.workspace_id != offer.workspace_id
        or binding.workspace_generation != offer.workspace_generation
        or binding.executor_generation != offer.executor_generation
    ):
        raise _error(
            "workflow_binding_generation_conflict",
            "Binding workspace or executor generation does not match the offer.",
            409,
        )
    if (
        source_intent.resolved_commit is not None
        and binding.base_commit_oid != source_intent.resolved_commit
    ):
        raise _error(
            "workflow_binding_source_conflict",
            "Binding baseCommitOid does not match the resolved source intent.",
            409,
        )

    outcome = await binding_store.accept_binding_cas(
        db,
        run_id=run_id,
        plan_hash=plan_hash,
        binding_hash=binding.binding_hash,
        execution_generation=request.execution_generation,
        binding_json=canonical_binding,
        now=now,
    )
    if outcome in {"conflict", "legacy_partial"}:
        raise _error(
            "workflow_binding_identity_conflict",
            "Run already has a different or partial immutable binding identity.",
            409,
        )
    if outcome == "not_found":
        raise _error("workflow_run_not_found", "Workflow run not found.", 404)
    idempotent = outcome == "retry"
    # A retry against a pending credential can only happen after a prior
    # transaction accepted the binding but failed before consuming the offer.
    # Both paths must consume exactly the locked pending row; otherwise the
    # caller rolls back the run CAS with this typed failure.
    consumed = await binding_store.consume_offer(
        db,
        offer_id=offer.id,
        accepted_binding_hash=binding.binding_hash,
        now=now,
    )
    if not consumed:
        raise _error(
            "workflow_offer_identity_conflict",
            "Materialization offer changed before binding persistence completed.",
            409,
        )
    return ExecutionBindingAcceptanceResponse(
        accepted=True,
        idempotent=idempotent,
        run_id=str(run_id),
        plan_hash=plan_hash,
        binding_hash=binding.binding_hash,
        execution_generation=request.execution_generation,
        acceptance_state="accepted",
        binding=binding,
    )


async def get_execution_binding_status(
    db: AsyncSession,
    actor: BindingActor,
    *,
    run_id: UUID,
) -> ExecutionBindingStatusResponse:
    """Read one committed binding without credential or mutable-offer authority."""

    run = await run_store.get_run(db, run_id)
    if run is None or run.executor_user_id != actor.owner_user_id:
        raise _error("workflow_run_not_found", "Workflow run not found.", 404)
    plan_hash = await _validated_plan_hash(db, run, lock_version=False)
    if (
        run.binding_hash is None
        or run.execution_generation is None
        or run.execution_binding_json is None
    ):
        raise _error(
            "workflow_binding_not_accepted",
            "This run has no committed execution binding.",
            409,
        )
    try:
        binding, canonical_binding = _parse_and_validate_binding(run.execution_binding_json)
    except CloudApiError as exc:
        raise _error(
            "workflow_binding_identity_conflict",
            "Stored execution binding is not a canonical accepted identity.",
            409,
        ) from exc
    if (
        run.binding_hash != binding.binding_hash
        or run.execution_generation <= 0
        or not _stored_binding_matches(run.execution_binding_json, canonical_binding)
    ):
        raise _error(
            "workflow_binding_identity_conflict",
            "Stored execution binding identity is incomplete or inconsistent.",
            409,
        )
    offer = await binding_store.get_consumed_offer_for_binding(
        db,
        workflow_run_id=run_id,
        execution_generation=run.execution_generation,
    )
    if (
        offer is None
        or offer.plan_hash != plan_hash
        or offer.accepted_binding_hash != binding.binding_hash
        or offer.executor_id != binding.executor_id
        or offer.executor_generation != binding.executor_generation
    ):
        raise _error(
            "workflow_binding_identity_conflict",
            "Committed binding has no exact consumed-offer identity.",
            409,
        )
    await _assert_offer_actor(db, actor=actor, run=run, offer=offer)
    return ExecutionBindingStatusResponse(
        accepted=True,
        run_id=str(run_id),
        plan_hash=plan_hash,
        binding_hash=binding.binding_hash,
        execution_generation=run.execution_generation,
        acceptance_state="accepted",
        binding=binding,
    )
