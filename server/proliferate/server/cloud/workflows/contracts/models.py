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

import re
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

from proliferate.constants.workflows import (
    WORKFLOW_INT32_MAX,
    WORKFLOW_INT32_MIN,
    WORKFLOW_JSON_SAFE_INTEGER_MAX,
    WORKFLOW_UINT32_MAX,
    WORKFLOW_VERSION_N_MAX,
)

from .canonical import content_hash, hash_excluding
from .schema_profile import SchemaProfileError, validate_schema_profile

Target = Literal["local", "personal_cloud", "shared_cloud"]
OnFail = Literal["fail", "continue"]


class WfContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid", strict=True)

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


class LegacyWireModel(BaseModel):
    """Alias-only, strict parser for the persisted legacy-v1 delivery wire."""

    model_config = ConfigDict(
        populate_by_name=False,
        validate_by_alias=True,
        validate_by_name=False,
        extra="forbid",
        strict=True,
        allow_inf_nan=False,
    )


_CANONICAL_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_CANONICAL_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_SHA1_OID = re.compile(r"^[0-9a-f]{40}$")
_GIT_OID = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_ASCII_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SLOT_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
_LEGACY_STEP_KEY = re.compile(
    r"^(?P<node>0|[1-9][0-9]*)\.(?P<lane>-|[a-z][a-z0-9_]*)\."
    r"(?P<step>0|[1-9][0-9]*)(?P<injected>\.notify_fields)?$"
)
_INVALID_REF_CHARACTERS = frozenset({" ", "~", "^", ":", "?", "*", "[", "]", "\\"})
_PRIVATE_INPUT_KEYS = frozenset(
    {
        "authorization",
        "accesstoken",
        "refreshtoken",
        "apikey",
        "token",
        "secret",
        "password",
        "credential",
        "credentials",
        "privateenvelope",
        "privatecallbacks",
        "runreportcredential",
        "deliveryclaimfence",
        "perslotcredentialissuance",
        "authtoken",
        "bearertoken",
        "clientsecret",
        "privatekey",
        "accesskey",
        "secretaccesskey",
        "sessiontoken",
    }
)


def _normalized_key(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def _clean_bounded(value: str, *, field: str, maximum: int = 255) -> str:
    if (
        not value
        or value != value.strip()
        or len(value) > maximum
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise ValueError(f"{field} must be a non-empty, trimmed, control-free string")
    return value


def _canonical_uuid(value: str, *, field: str) -> str:
    if not _CANONICAL_UUID.fullmatch(value):
        raise ValueError(f"{field} must be a canonical lowercase UUID")
    try:
        parsed = UUID(value)
    except ValueError as exc:  # pragma: no cover - regex rejects first
        raise ValueError(f"{field} must be a canonical lowercase UUID") from exc
    if str(parsed) != value:
        raise ValueError(f"{field} must be a canonical lowercase UUID")
    return value


def _canonical_v2_step_key(value: str) -> str:
    parts = value.split("::")
    if len(parts) == 5 and parts[-1] == "notify_fields":
        parts = parts[:-1]
    if len(parts) != 4 or parts[0] != "root":
        raise ValueError("key_v2 must use the canonical four-segment grammar")
    _canonical_uuid(parts[1], field="key_v2 node")
    if parts[2] != "-":
        _canonical_uuid(parts[2], field="key_v2 lane")
    _canonical_uuid(parts[3], field="key_v2 step")
    return value


class LegacySourceIntentV1(LegacyWireModel):
    """Exact logical source identity nested in ``LegacyResolvedPlanV1``."""

    kind: Literal["remote_commit", "local_commit", "workspace_checkpoint"]
    repo: str | None = None
    ref: str | None = None
    resolved_commit: str | None = Field(default=None, alias="resolvedCommit")

    @field_validator("repo", "ref", "resolved_commit")
    @classmethod
    def _validate_optional_identity(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        return _clean_bounded(value, field=info.field_name, maximum=512)

    @model_validator(mode="after")
    def _validate_source_shape(self) -> LegacySourceIntentV1:
        if self.kind == "workspace_checkpoint":
            if self.repo is not None or self.ref is not None or self.resolved_commit is not None:
                raise ValueError("workspace_checkpoint carries no remote commit identity")
            return self
        if self.kind == "local_commit":
            if self.repo is not None or self.ref is not None:
                raise ValueError("local_commit carries only resolvedCommit")
            if self.resolved_commit is None or not _GIT_OID.fullmatch(self.resolved_commit):
                raise ValueError("local_commit requires an exact lowercase Git object id")
            return self
        if (
            self.repo is None
            or not re.fullmatch(r"github\.com/[^/\s]+/[^/\s]+", self.repo)
            or self.ref is None
            or not self.ref.startswith("refs/heads/")
            or not self._valid_branch_ref(self.ref)
            or self.resolved_commit is None
            or not _SHA1_OID.fullmatch(self.resolved_commit)
        ):
            raise ValueError("remote_commit requires exact GitHub repo/ref/SHA-1 identity")
        return self

    @staticmethod
    def _valid_branch_ref(value: str) -> bool:
        branch = value.removeprefix("refs/heads/")
        return bool(
            branch
            and branch not in {"@", "."}
            and not branch.startswith("/")
            and not branch.endswith(("/", ".", ".lock"))
            and ".." not in branch
            and "@{" not in branch
            and "//" not in branch
            and not any(character in _INVALID_REF_CHARACTERS for character in branch)
        )


class LegacyPlanSessionV1(LegacyWireModel):
    harness: str
    model: str
    session_binding: Literal["fresh", "headless"]
    integrations: list[str]
    bind_session_id: str | None = None

    @field_validator("harness", "model", "bind_session_id")
    @classmethod
    def _validate_strings(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        return _clean_bounded(value, field=info.field_name)

    @field_validator("integrations")
    @classmethod
    def _validate_integrations(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("session integrations must be unique")
        for value in values:
            if not _ASCII_IDENTIFIER.fullmatch(value):
                raise ValueError("session integrations must be ASCII identifiers")
        return values


class LegacyPlanOnFailV1(LegacyWireModel):
    kind: Literal["stop", "retry", "continue"]
    n: int | None = Field(default=None, gt=0, le=WORKFLOW_UINT32_MAX)

    @model_validator(mode="after")
    def _validate_retry_count(self) -> LegacyPlanOnFailV1:
        if (self.kind == "retry") != (self.n is not None):
            raise ValueError("on_fail.n is required only for retry")
        return self


class LegacyPlanVerifyV1(LegacyWireModel):
    shell: str
    expect_exit: int = Field(ge=WORKFLOW_INT32_MIN, le=WORKFLOW_INT32_MAX)


class LegacyPlanGoalV1(LegacyWireModel):
    objective: str
    max_turns: int = Field(gt=0, le=WORKFLOW_UINT32_MAX)
    max_wall_secs: int = Field(gt=0, le=WORKFLOW_JSON_SAFE_INTEGER_MAX)
    token_budget: int | None = Field(default=None, gt=0, le=WORKFLOW_JSON_SAFE_INTEGER_MAX)
    on_blocked: Literal["notify", "pause_for_approval", "fail"]
    verify: LegacyPlanVerifyV1 | None = None


class LegacyPlanRequiredInvocationV1(LegacyWireModel):
    provider: str
    tool: str

    @field_validator("provider", "tool")
    @classmethod
    def _validate_invocation_identity(cls, value: str, info: ValidationInfo) -> str:
        return _clean_bounded(value, field=info.field_name)


class LegacyPlanBranchCaseV1(LegacyWireModel):
    to: Literal["continue", "end"]


class LegacyPlanStepBaseV1(LegacyWireModel):
    key: str
    key_v2: str
    slot: str
    label: str
    on_fail: LegacyPlanOnFailV1

    @field_validator("key")
    @classmethod
    def _validate_key(cls, value: str) -> str:
        if not _LEGACY_STEP_KEY.fullmatch(value):
            raise ValueError("key must use the canonical legacy step-key grammar")
        return value

    @field_validator("key_v2")
    @classmethod
    def _validate_key_v2(cls, value: str) -> str:
        return _canonical_v2_step_key(value)

    @field_validator("slot")
    @classmethod
    def _validate_slot(cls, value: str) -> str:
        if not _SLOT_IDENTIFIER.fullmatch(value):
            raise ValueError("slot must be a canonical lowercase slot identifier")
        return value


class LegacyAgentConfigStepV1(LegacyPlanStepBaseV1):
    kind: Literal["agent.config"]
    model: str


class LegacyAgentPromptStepV1(LegacyPlanStepBaseV1):
    kind: Literal["agent.prompt"]
    prompt: str
    goal: LegacyPlanGoalV1 | None = None
    required_invocation: LegacyPlanRequiredInvocationV1 | None = None


class LegacyAgentEmitStepV1(LegacyPlanStepBaseV1):
    kind: Literal["agent.emit"]
    prompt: str
    max_attempts: int = Field(gt=0, le=WORKFLOW_UINT32_MAX)
    name: str | None = None
    output_schema: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        if value is not None and not _ASCII_IDENTIFIER.fullmatch(value):
            raise ValueError("emit name must be an ASCII identifier")
        return value

    @field_validator("output_schema")
    @classmethod
    def _validate_output_schema(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        try:
            validate_schema_profile(value)
        except SchemaProfileError as exc:
            raise ValueError("output_schema is outside the frozen schema profile") from exc
        return value


class LegacyShellRunStepV1(LegacyPlanStepBaseV1):
    kind: Literal["shell.run"]
    command: str
    timeout_secs: int | None = Field(default=None, gt=0, le=WORKFLOW_JSON_SAFE_INTEGER_MAX)
    output_name: str | None = None

    @field_validator("output_name")
    @classmethod
    def _validate_output_name(cls, value: str | None) -> str | None:
        if value is not None and not _ASCII_IDENTIFIER.fullmatch(value):
            raise ValueError("output_name must be an ASCII identifier")
        return value


class LegacyScmOpenPrStepV1(LegacyPlanStepBaseV1):
    kind: Literal["scm.open_pr"]
    title: str
    base: str | None = None
    body: str | None = None
    draft: bool | None = None


class LegacyNotifyStepV1(LegacyPlanStepBaseV1):
    kind: Literal["notify"]
    slack_channel_id: str
    message: str


class LegacyBranchStepV1(LegacyPlanStepBaseV1):
    kind: Literal["branch"]
    on: str
    cases: dict[str, LegacyPlanBranchCaseV1]
    reason: str | None = None


LegacyPlanStepV1 = Annotated[
    LegacyAgentConfigStepV1
    | LegacyAgentPromptStepV1
    | LegacyAgentEmitStepV1
    | LegacyShellRunStepV1
    | LegacyScmOpenPrStepV1
    | LegacyNotifyStepV1
    | LegacyBranchStepV1,
    Field(discriminator="kind"),
]


# --- resolved plan (feature spec §5.2) ----------------------------------------


class LegacyResolvedPlanV1(LegacyWireModel):
    """Strict identity wrapper for the current flattened execution wire.

    This is intentionally not the authoritative ``ResolvedPlan`` v2 contract.
    WF-PLAN-V2 must replace the producer and add the AnyHarness adapter
    atomically before final workflow credentials can activate execution.
    """

    plan_version: Literal[1] = Field(alias="planVersion")
    plan_hash: str = Field(alias="planHash")
    run_id: str
    workflow_id: str
    workflow_version_id: str
    version_n: int = Field(gt=0, le=WORKFLOW_VERSION_N_MAX)
    trigger_kind: Literal["manual", "schedule", "poll", "chat", "agent", "api"]
    target_mode: Literal["local", "personal_cloud"]
    source_intent: LegacySourceIntentV1 = Field(alias="sourceIntent")
    isolation: Literal["workspace", "worktree"]
    sessions: dict[str, LegacyPlanSessionV1]
    inputs: dict[str, str | int | float | bool]
    steps: list[LegacyPlanStepV1]

    @field_validator("plan_hash")
    @classmethod
    def _validate_plan_hash(cls, value: str) -> str:
        if not _CANONICAL_SHA256.fullmatch(value):
            raise ValueError("planHash must be a canonical SHA-256 content hash")
        return value

    @field_validator("run_id", "workflow_id", "workflow_version_id")
    @classmethod
    def _validate_uuid_fields(cls, value: str, info: ValidationInfo) -> str:
        return _canonical_uuid(value, field=info.field_name)

    @field_validator("sessions")
    @classmethod
    def _validate_session_slots(
        cls, sessions: dict[str, LegacyPlanSessionV1]
    ) -> dict[str, LegacyPlanSessionV1]:
        if any(not _SLOT_IDENTIFIER.fullmatch(slot) for slot in sessions):
            raise ValueError("session keys must be canonical lowercase slot identifiers")
        return sessions

    @field_validator("inputs")
    @classmethod
    def _validate_inputs(
        cls, inputs: dict[str, str | int | float | bool]
    ) -> dict[str, str | int | float | bool]:
        for key in inputs:
            if not _ASCII_IDENTIFIER.fullmatch(key):
                raise ValueError("input keys must be ASCII identifiers")
            if _normalized_key(key) in _PRIVATE_INPUT_KEYS:
                raise ValueError("credential-typed input keys are not accepted in a plan")
        return inputs

    @model_validator(mode="after")
    def _validate_plan_coherence(self) -> LegacyResolvedPlanV1:
        if self.target_mode == "personal_cloud" and self.source_intent.kind != "remote_commit":
            raise ValueError("personal_cloud plans require remote_commit source identity")
        if self.target_mode == "local" and self.source_intent.kind not in {
            "local_commit",
            "workspace_checkpoint",
        }:
            raise ValueError("local plans require local source identity")
        legacy_keys: set[str] = set()
        v2_keys: set[str] = set()
        for step in self.steps:
            if step.slot not in self.sessions:
                raise ValueError("every plan step slot must have an exact session specification")
            match = _LEGACY_STEP_KEY.fullmatch(step.key)
            assert match is not None  # field validator already established this
            lane = match.group("lane")
            if lane != "-" and lane != step.slot:
                raise ValueError("parallel step-key lane must equal its session slot")
            if bool(match.group("injected")) != step.key_v2.endswith("::notify_fields"):
                raise ValueError("legacy and v2 injected-step suffixes must agree")
            if step.key in legacy_keys or step.key_v2 in v2_keys:
                raise ValueError("plan step identities must be unique")
            legacy_keys.add(step.key)
            v2_keys.add(step.key_v2)
        return self


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
    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
        strict=True,
        hide_input_in_errors=True,
    )

    schema_version: Literal[1] = Field(alias="schemaVersion")
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    target: Target
    execution_generation: int = Field(alias="executionGeneration")
    executor_id: str = Field(alias="executorId")
    executor_fence: str = Field(alias="executorFence")
    source_intent: SourceIntent = Field(alias="sourceIntent")
    materialization_credential: str = Field(alias="materializationCredential", repr=False)
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
        if self.source_kind != "workspace_checkpoint" and (
            "checkpoint_id" in self.model_fields_set
            or "checkpoint_content_hash" in self.model_fields_set
        ):
            raise ValueError("commit source kinds must omit checkpoint fields")
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
