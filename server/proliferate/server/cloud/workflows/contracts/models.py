"""Workflow contract-shape models (WS1).

These are pure transport/contract models for the four run contracts plus the
derived transport messages (materialization offer, execution envelope, observed
run, gateway receipt, control command, checkpoint manifest). They are NOT wired
into any router or the OpenAPI surface in this packet — the merge captain
regenerates OpenAPI/SDK once after acceptance. They exist to parse/serialize the
shared golden fixtures strictly and identically to the Rust and TypeScript
implementations.

Strictness policy (feature spec §5.1/§5.2, §6.2, §10.3): every model here uses
``extra="forbid"`` so unknown top-level fields and unknown step/spine/capability
kinds fail. Poll pages (owned by WS4) are the only shape that ignores unknown
response fields for forward compatibility; no poll-page fixture lives in this
packet.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .canonical import content_hash, hash_excluding

Target = Literal["local", "personal_cloud", "shared_cloud"]
OnFail = Literal["fail", "continue"]


class WfContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    def to_wire(self) -> dict[str, Any]:
        """Serialize to the wire dict (camelCase aliases, absent optionals dropped)."""

        return self.model_dump(by_alias=True, exclude_none=True)


# --- capability references (feature spec §7.1) --------------------------------


class IntegrationToolCapability(WfContractModel):
    kind: Literal["integration_tool"]
    provider_definition_id: str = Field(alias="providerDefinitionId")
    provider_revision: str = Field(alias="providerRevision")
    tool_name: str = Field(alias="toolName")
    input_schema_hash: str = Field(alias="inputSchemaHash")


class FunctionCapability(WfContractModel):
    kind: Literal["function"]
    definition_id: str = Field(alias="definitionId")
    semantic_revision: int = Field(alias="semanticRevision")


class ProductMcpCapability(WfContractModel):
    kind: Literal["product_mcp"]
    definition: str
    policy_revision: int = Field(alias="policyRevision")


CapabilityRef = Annotated[
    IntegrationToolCapability | FunctionCapability | ProductMcpCapability,
    Field(discriminator="kind"),
]


# --- steps (feature spec §6.1/§6.2/§7.1) --------------------------------------


class PromptStep(WfContractModel):
    kind: Literal["agent.prompt"]
    step_id: str = Field(alias="stepId")
    step_key: str = Field(alias="stepKey")
    on_fail: OnFail = Field(alias="onFail")
    prompt: str


class EmitStep(WfContractModel):
    kind: Literal["agent.emit"]
    step_id: str = Field(alias="stepId")
    step_key: str = Field(alias="stepKey")
    on_fail: OnFail = Field(alias="onFail")
    emit_name: str = Field(alias="emitName")
    prompt: str
    correction_budget: int = Field(alias="correctionBudget")
    # Frozen emit schema; opaque here and validated by schema_profile.
    emit_schema: dict[str, Any] = Field(alias="schema")


class BranchStep(WfContractModel):
    kind: Literal["branch"]
    step_id: str = Field(alias="stepId")
    step_key: str = Field(alias="stepKey")
    on_fail: OnFail = Field(alias="onFail")
    on: str
    cases: dict[str, Literal["continue", "end"]]


class RequiredInvocationStep(WfContractModel):
    kind: Literal["required_invocation"]
    step_id: str = Field(alias="stepId")
    step_key: str = Field(alias="stepKey")
    on_fail: OnFail = Field(alias="onFail")
    correction_budget: int = Field(alias="correctionBudget")
    prompt: str
    capability: CapabilityRef


Step = Annotated[
    PromptStep | EmitStep | BranchStep | RequiredInvocationStep,
    Field(discriminator="kind"),
]


# --- spine (feature spec §6.1) ------------------------------------------------


class SlotConfig(WfContractModel):
    harness: str
    model: str
    mode: str


class Lane(WfContractModel):
    lane_id: str = Field(alias="laneId")
    slot_id: str = Field(alias="slotId")
    steps: list[Step]


class SequentialNode(WfContractModel):
    kind: Literal["sequential"]
    node_id: str = Field(alias="nodeId")
    slot_id: str = Field(alias="slotId")
    steps: list[Step]


class ParallelGroup(WfContractModel):
    kind: Literal["parallel"]
    group_id: str = Field(alias="groupId")
    lanes: list[Lane]


SpineEntry = Annotated[
    SequentialNode | ParallelGroup,
    Field(discriminator="kind"),
]


class Slot(WfContractModel):
    slot_id: str = Field(alias="slotId")
    label: str
    requested_config: SlotConfig = Field(alias="requestedConfig")
    effective_config: SlotConfig = Field(alias="effectiveConfig")
    capability_subset: list[CapabilityRef] = Field(alias="capabilitySubset")


class InputValue(WfContractModel):
    type: Literal["text", "number", "boolean", "choice"]
    value: Any


class SourceIntent(WfContractModel):
    kind: Literal["remote_commit", "local_commit", "workspace_checkpoint"]
    repo: str | None = None
    ref: str | None = None
    resolved_commit: str | None = Field(default=None, alias="resolvedCommit")


# --- resolved plan (feature spec §5.2) ----------------------------------------


class ResolvedPlan(WfContractModel):
    # A different plan version is an unknown contract version and must fail.
    plan_version: Literal[2] = Field(alias="planVersion")
    plan_hash: str = Field(alias="planHash")
    run_id: str = Field(alias="runId")
    workflow_id: str = Field(alias="workflowId")
    workflow_version_id: str = Field(alias="workflowVersionId")
    version_n: int = Field(alias="versionN")
    target: Target
    isolation: str
    source_intent: SourceIntent = Field(alias="sourceIntent")
    inputs: dict[str, InputValue]
    capabilities: list[CapabilityRef]
    slots: list[Slot]
    spine: list[SpineEntry]


# --- checkpoint manifest (feature spec §5.3) ----------------------------------

_BASE64_UNPADDED = None  # compiled lazily to avoid import cost at module load


def _is_unpadded_base64(value: str) -> bool:
    global _BASE64_UNPADDED
    if _BASE64_UNPADDED is None:
        import re

        _BASE64_UNPADDED = re.compile(r"^[A-Za-z0-9+/]+$")
    if not value or "=" in value:
        return False
    if not _BASE64_UNPADDED.match(value):
        return False
    import base64

    padding = "=" * (-len(value) % 4)
    try:
        base64.b64decode(value + padding, validate=True)
    except Exception:
        return False
    return True


class CheckpointEntry(WfContractModel):
    path: str
    origin: Literal["tracked", "untracked"]
    mode: Literal["100644", "100755", "120000", "160000"]
    sha256: str | None = None
    submodule_oid: str | None = Field(default=None, alias="submoduleOid")

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        if not _is_unpadded_base64(value):
            raise ValueError("path must be unpadded base64 of the raw path bytes")
        return value

    @model_validator(mode="after")
    def _validate_object_kind(self) -> CheckpointEntry:
        if self.mode == "160000":
            if not self.submodule_oid:
                raise ValueError("gitlink (160000) requires submoduleOid")
            if self.sha256 is not None:
                raise ValueError("gitlink (160000) must not carry sha256")
        else:
            if not self.sha256:
                raise ValueError("blob entries require sha256")
            if self.submodule_oid is not None:
                raise ValueError("only gitlinks carry submoduleOid")
        return self


class CheckpointManifest(WfContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    repository_object_format: Literal["sha1", "sha256"] = Field(alias="repositoryObjectFormat")
    base_oid: str = Field(alias="baseOid")
    index_entries: list[CheckpointEntry] = Field(alias="indexEntries")
    worktree_entries: list[CheckpointEntry] = Field(alias="worktreeEntries")


def normalize_checkpoint_manifest(raw: dict[str, Any]) -> dict[str, Any]:
    """Sort entry arrays by raw path bytes (feature spec §5.3) so an unsorted
    input restores to the identical canonical manifest and hash."""

    import base64

    def _raw_path(entry: dict[str, Any]) -> bytes:
        return base64.b64decode(entry["path"] + "=" * (-len(entry["path"]) % 4))

    normalized = dict(raw)
    for key in ("indexEntries", "worktreeEntries"):
        entries = list(raw.get(key, []))
        normalized[key] = sorted(entries, key=_raw_path)
    return normalized


def checkpoint_content_hash(raw: dict[str, Any]) -> str:
    return content_hash(normalize_checkpoint_manifest(raw))


# --- materialization offer / execution envelope (feature spec §5.3) -----------


class MaterializationOffer(WfContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    target: Target
    execution_generation: int = Field(alias="executionGeneration")
    executor_id: str = Field(alias="executorId")
    executor_fence: str = Field(alias="executorFence")
    source_intent: SourceIntent = Field(alias="sourceIntent")
    materialization_credential: str = Field(alias="materializationCredential")
    credential_generation: int = Field(alias="credentialGeneration")
    expires_at: str = Field(alias="expiresAt")


class ExecutionBinding(WfContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    target: Target
    source_kind: Literal["remote_commit", "local_commit", "workspace_checkpoint"] = Field(
        alias="sourceKind"
    )
    repository_object_format: Literal["sha1", "sha256"] = Field(alias="repositoryObjectFormat")
    base_commit_oid: str = Field(alias="baseCommitOid")
    checkpoint_id: str | None = Field(default=None, alias="checkpointId")
    checkpoint_content_hash: str | None = Field(default=None, alias="checkpointContentHash")
    workspace_id: str = Field(alias="workspaceId")
    workspace_generation: int = Field(alias="workspaceGeneration")
    materialization_id: str = Field(alias="materializationId")
    executor_id: str = Field(alias="executorId")
    executor_generation: int = Field(alias="executorGeneration")
    binding_hash: str = Field(alias="bindingHash")

    @model_validator(mode="after")
    def _validate_checkpoint_fields(self) -> ExecutionBinding:
        if self.source_kind == "workspace_checkpoint" and (
            not self.checkpoint_id or not self.checkpoint_content_hash
        ):
            raise ValueError("workspace_checkpoint requires checkpointId + checkpointContentHash")
        return self


class PerSlotCredentialIssuance(WfContractModel):
    slot_id: str = Field(alias="slotId")
    issuance_handle: str = Field(alias="issuanceHandle")


class PrivateCallbacks(WfContractModel):
    observation_endpoint: str = Field(alias="observationEndpoint")
    control_endpoint: str = Field(alias="controlEndpoint")


class ExecutionEnvelope(WfContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    binding_hash: str = Field(alias="bindingHash")
    execution_generation: int = Field(alias="executionGeneration")
    credential_generation: int = Field(alias="credentialGeneration")
    expires_at: str = Field(alias="expiresAt")
    run_report_credential: str = Field(alias="runReportCredential")
    delivery_claim_fence: str = Field(alias="deliveryClaimFence")
    private_callbacks: PrivateCallbacks = Field(alias="privateCallbacks")
    per_slot_credential_issuance: list[PerSlotCredentialIssuance] = Field(
        alias="perSlotCredentialIssuance"
    )
    binding: ExecutionBinding


# --- observed run (feature spec §5.4) -----------------------------------------


class ObservedStep(WfContractModel):
    step_key: str = Field(alias="stepKey")
    attempt: int
    status: Literal["pending", "running", "completed", "failed", "outcome_uncertain", "skipped"]
    output: dict[str, Any] | None = None
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class ObservedWorktrees(WfContractModel):
    group_base_checkpoint_id: str | None = Field(default=None, alias="groupBaseCheckpointId")
    lane_checkpoints: dict[str, str] | None = Field(default=None, alias="laneCheckpoints")


class ObservedCost(WfContractModel):
    usd: str
    tokens: int


class ObservedTiming(WfContractModel):
    started_at: str = Field(alias="startedAt")
    updated_at: str = Field(alias="updatedAt")


class ObservedRun(WfContractModel):
    schema_version: Literal[2] = Field(alias="schemaVersion")
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    binding_hash: str = Field(alias="bindingHash")
    execution_generation: int = Field(alias="executionGeneration")
    revision: int
    observed_state: Literal[
        "accepted",
        "running",
        "waiting_action_result",
        "waiting_credential_refresh",
        "quiescing",
        "completed",
        "failed",
        "cancelled",
    ] = Field(alias="observedState")
    quiescence_state: Literal["active", "quiescing", "quiescent"] = Field(alias="quiescenceState")
    global_cursor: str = Field(alias="globalCursor")
    lane_cursors: dict[str, str] = Field(alias="laneCursors")
    sessions: dict[str, str]
    steps: list[ObservedStep]
    worktrees: ObservedWorktrees
    cost: ObservedCost
    timing: ObservedTiming


# --- gateway receipt (feature spec §7.3) --------------------------------------


class GatewayCallReceipt(WfContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    receipt_id: str = Field(alias="receiptId")
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    slot_id: str = Field(alias="slotId")
    session_id: str = Field(alias="sessionId")
    step_key: str = Field(alias="stepKey")
    attempt: int
    turn_id: str = Field(alias="turnId")
    activation_id: str = Field(alias="activationId")
    capability: CapabilityRef
    authorization_decision: Literal["allow", "deny"] = Field(alias="authorizationDecision")
    outcome: Literal["success", "denied", "upstream_failed", "output_invalid"]
    created_at: str = Field(alias="createdAt")
    completed_at: str = Field(alias="completedAt")


# --- control command (feature spec §8.3) --------------------------------------


class WorkflowControlCommand(WfContractModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    command_id: str = Field(alias="commandId")
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    binding_hash: str = Field(alias="bindingHash")
    execution_generation: int = Field(alias="executionGeneration")
    kind: Literal["cancel", "takeover", "credential_rotation"]
    reason: str
    cancellation_fence: str = Field(alias="cancellationFence")
    issued_at: str = Field(alias="issuedAt")


# --- hashing helpers over raw fixture dicts -----------------------------------


def plan_hash(raw_plan: dict[str, Any]) -> str:
    return hash_excluding(raw_plan, "planHash")


def binding_hash(raw_binding: dict[str, Any]) -> str:
    return hash_excluding(raw_binding, "bindingHash")
