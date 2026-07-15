//! Synchronous durable rules for workflow runs: full invocation validation,
//! scalar template rendering, canonical JSON, acceptance/replay/conflict,
//! guarded transitions, GET composition, and restart fencing.
//!
//! The service uses only domain models and typed enums. It never spawns,
//! awaits, holds live state, or calls `SessionRuntime`. Store/infrastructure
//! failures collapse into one typed [`WorkflowServiceError`]; validation
//! failures are their own typed [`WorkflowRunValidationError`] with a stable
//! machine detail. Logs carry run/workspace IDs only — never prompts,
//! arguments, or raw error chains.

use std::collections::BTreeMap;

use crate::domains::workflows::model::{
    workflow_prompt_id, PutWorkflowRunInput, WorkflowArgumentValue, WorkflowInputType,
    WorkflowRunFailureCode, WorkflowRunInvocation, WorkflowRunRecord, WorkflowRunStatus,
    WorkflowRunStepRecord, WorkflowStepStatus, WorkflowTurnOutcome,
};
use crate::domains::workflows::store::{FinishTurnStoreOutcome, WorkflowRunStore};

pub use super::portable_service::{
    AcceptV2Outcome, InspectV2Outcome, PreparedWorkflowRunV2, VersionedWorkflowRunView,
    WorkflowRunViewV2,
};

/// The maximum rendered-prompt size in UTF-8 bytes.
const MAX_RENDERED_PROMPT_BYTES: usize = 16_384;

/// The only permitted step kind for C2a.
const AGENT_PROMPT_STEP_KIND: &str = "agent.prompt";

/// A typed, machine-stable validation failure. Each maps to a `400` with the
/// stable code `WORKFLOW_RUN_INVALID`; the `Display` text is the detail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowRunValidationError {
    InvalidRunId,
    UnsupportedSchemaVersion(i64),
    BlankWorkspaceId,
    StageCount(usize),
    StepCount(usize),
    UnsupportedStepKind(String),
    BlankInputName,
    InvalidInputName(String),
    DuplicateInputName(String),
    UndeclaredArgument(String),
    ArgumentTypeMismatch {
        name: String,
        expected: &'static str,
    },
    MissingRequiredArgument(String),
    MissingReferencedArgument(String),
    MalformedTemplate,
    UnknownTemplateReference(String),
    UnknownPortableTemplateReference,
    BlankRenderedPrompt,
    RenderedPromptTooLarge(usize),
    BlankAgentKind,
    AgentKindSurroundingWhitespace,
    BlankModelId,
    BlankModeId,
    EffortRequiresExactModel,
    BlankEffort,
    NonPortableNumber,
}

impl std::fmt::Display for WorkflowRunValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRunId => write!(f, "runId must be a canonical lowercase UUID"),
            Self::UnsupportedSchemaVersion(v) => {
                write!(f, "schemaVersion must be exactly 1, got {v}")
            }
            Self::BlankWorkspaceId => write!(f, "workspaceId must be a nonblank identifier"),
            Self::StageCount(n) => write!(f, "definition must contain exactly one stage, got {n}"),
            Self::StepCount(n) => write!(f, "the stage must contain exactly one step, got {n}"),
            Self::UnsupportedStepKind(kind) => {
                write!(f, "the step kind must be 'agent.prompt', got '{kind}'")
            }
            Self::BlankInputName => write!(f, "input names must be nonblank"),
            Self::InvalidInputName(name) => {
                write!(f, "input name '{name}' is not a valid identifier")
            }
            Self::DuplicateInputName(name) => write!(f, "input name '{name}' is declared twice"),
            Self::UndeclaredArgument(name) => write!(f, "argument '{name}' is not a declared input"),
            Self::ArgumentTypeMismatch { name, expected } => {
                write!(f, "argument '{name}' must be a {expected}")
            }
            Self::MissingRequiredArgument(name) => {
                write!(f, "required input '{name}' has no argument")
            }
            Self::MissingReferencedArgument(name) => {
                write!(f, "input '{name}' is referenced by the prompt but has no argument")
            }
            Self::MalformedTemplate => {
                write!(f, "the prompt contains a malformed '{{{{...}}}}' placeholder")
            }
            Self::UnknownTemplateReference(reference) => {
                write!(f, "the prompt references undeclared placeholder '{reference}'")
            }
            Self::UnknownPortableTemplateReference => {
                write!(f, "the prompt contains an unknown input placeholder")
            }
            Self::BlankRenderedPrompt => write!(f, "the rendered prompt must be nonblank"),
            Self::RenderedPromptTooLarge(bytes) => write!(
                f,
                "the rendered prompt is {bytes} bytes, over the {MAX_RENDERED_PROMPT_BYTES}-byte limit"
            ),
            Self::BlankAgentKind => write!(f, "agentKind must be nonblank"),
            Self::AgentKindSurroundingWhitespace => {
                write!(f, "agentKind must have no surrounding whitespace")
            }
            Self::BlankModelId => write!(f, "modelId must be nonblank when present"),
            Self::BlankModeId => write!(f, "modeId must be nonblank when present"),
            Self::EffortRequiresExactModel => {
                write!(f, "effort requires an exact model selection")
            }
            Self::BlankEffort => write!(f, "effort must be nonblank when present"),
            Self::NonPortableNumber => write!(
                f,
                "numbers must be finite IEEE-754 values and integers must be in the I-JSON safe range"
            ),
        }
    }
}

/// One typed error for store/infrastructure failures.
#[derive(Debug, thiserror::Error)]
pub enum WorkflowServiceError {
    #[error("workflow store failure")]
    Store(#[source] anyhow::Error),
}

impl From<anyhow::Error> for WorkflowServiceError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

/// The everything-the-runtime-needs plan produced on a fresh acceptance so the
/// runtime never re-parses the invocation.
#[derive(Debug, Clone)]
pub struct WorkflowExecutionPlan {
    pub run_id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
    pub effort_config: Option<crate::domains::workflows::model::WorkflowResolvedEffortConfig>,
    pub rendered_prompt: String,
    pub prompt_id: String,
}

/// A composed read view: durable rows plus the parsed invocation. The API
/// mapper turns this into the wire response dep-lessly.
#[derive(Debug, Clone)]
pub struct WorkflowRunView {
    pub run: WorkflowRunRecord,
    pub invocation: WorkflowRunInvocation,
    pub steps: Vec<WorkflowRunStepRecord>,
}

/// The structured result of an acceptance.
#[derive(Debug)]
pub enum AcceptOutcome {
    Created {
        plan: WorkflowExecutionPlan,
        view: WorkflowRunView,
    },
    ExactReplay(WorkflowRunView),
    Conflict,
}

/// The failure arm of an acceptance: a caller-facing validation error or a
/// store failure.
#[derive(Debug)]
pub enum WorkflowAcceptError {
    Invalid(WorkflowRunValidationError),
    Store(WorkflowServiceError),
}

pub struct WorkflowRunService {
    pub(super) store: WorkflowRunStore,
}

impl WorkflowRunService {
    pub fn new(store: WorkflowRunStore) -> Self {
        Self { store }
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    /// Validate, canonicalize, and accept: create, exactly replay, or conflict.
    #[tracing::instrument(skip_all, fields(run_id = %run_id, workspace_id = %input.workspace_id))]
    pub fn accept(
        &self,
        run_id: &str,
        input: PutWorkflowRunInput,
    ) -> Result<AcceptOutcome, WorkflowAcceptError> {
        let validated =
            validate_invocation(run_id, &input).map_err(WorkflowAcceptError::Invalid)?;
        let invocation_json = validated.invocation.to_canonical_json().map_err(|error| {
            WorkflowAcceptError::Store(WorkflowServiceError::Store(error.into()))
        })?;

        let created_at = Self::now();
        let prompt_id = workflow_prompt_id(run_id);
        let run = WorkflowRunRecord {
            id: run_id.to_string(),
            schema_version: 1,
            invocation_json,
            resolved_plan_json: None,
            status: WorkflowRunStatus::Accepted,
            workspace_id: input.workspace_id.clone(),
            session_id: None,
            failure_code: None,
            created_at: created_at.clone(),
            updated_at: created_at.clone(),
            started_at: None,
            finished_at: None,
        };
        let step = WorkflowRunStepRecord {
            run_id: run_id.to_string(),
            stage_index: 0,
            step_index: 0,
            status: WorkflowStepStatus::Pending,
            prompt_id: prompt_id.clone(),
            turn_id: None,
            failure_code: None,
            created_at: created_at.clone(),
            updated_at: created_at,
            started_at: None,
            finished_at: None,
        };

        let outcome = self
            .store
            .accept(&run, &step)
            .map_err(|error| WorkflowAcceptError::Store(WorkflowServiceError::Store(error)))?;

        match outcome {
            crate::domains::workflows::store::StoreAcceptOutcome::Created => {
                let plan = WorkflowExecutionPlan {
                    run_id: run_id.to_string(),
                    workspace_id: input.workspace_id,
                    agent_kind: validated.agent_kind,
                    model_id: validated.model_id,
                    mode_id: validated.mode_id,
                    effort_config: None,
                    rendered_prompt: validated.rendered_prompt,
                    prompt_id,
                };
                let view = WorkflowRunView {
                    run,
                    invocation: validated.invocation,
                    steps: vec![step],
                };
                Ok(AcceptOutcome::Created { plan, view })
            }
            crate::domains::workflows::store::StoreAcceptOutcome::ExactReplay { run, steps } => {
                let invocation = parse_invocation(&run.invocation_json).map_err(|error| {
                    WorkflowAcceptError::Store(WorkflowServiceError::Store(error))
                })?;
                Ok(AcceptOutcome::ExactReplay(WorkflowRunView {
                    run,
                    invocation,
                    steps,
                }))
            }
            crate::domains::workflows::store::StoreAcceptOutcome::Conflict => {
                Ok(AcceptOutcome::Conflict)
            }
        }
    }

    /// Compose the durable read view for GET.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub fn get(&self, run_id: &str) -> Result<Option<WorkflowRunView>, WorkflowServiceError> {
        let Some((run, steps)) = self.store.get(run_id)? else {
            return Ok(None);
        };
        let invocation =
            parse_invocation(&run.invocation_json).map_err(WorkflowServiceError::Store)?;
        Ok(Some(WorkflowRunView {
            run,
            invocation,
            steps,
        }))
    }

    /// CAS `accepted -> running`; mints `started_at`.
    pub fn begin_run(&self, run_id: &str) -> Result<bool, WorkflowServiceError> {
        Ok(self.store.begin_run(run_id, &Self::now())?)
    }

    /// Persist the session id (running + unbound only).
    pub fn bind_session(
        &self,
        run_id: &str,
        session_id: &str,
    ) -> Result<bool, WorkflowServiceError> {
        Ok(self.store.bind_session(run_id, session_id)?)
    }

    /// CAS the single step `pending -> running`; mints `started_at`.
    pub fn begin_step(&self, run_id: &str) -> Result<bool, WorkflowServiceError> {
        Ok(self.store.begin_step(run_id, 0, 0, &Self::now())?)
    }

    /// Record the turn id on the running step, guarded against terminal rows.
    pub fn record_turn(&self, run_id: &str, turn_id: &str) -> Result<bool, WorkflowServiceError> {
        Ok(self.store.record_turn(run_id, 0, 0, turn_id)?)
    }

    /// Fail the run and still-nonterminal step with the same code; mints
    /// `finished_at`.
    pub fn fail_nonterminal(
        &self,
        run_id: &str,
        failure_code: WorkflowRunFailureCode,
    ) -> Result<(), WorkflowServiceError> {
        Ok(self
            .store
            .fail_nonterminal(run_id, failure_code, &Self::now())?)
    }

    /// Terminalize run and step for a completed/failed/cancelled turn; mints
    /// `finished_at`.
    pub fn finish_turn(
        &self,
        session_id: &str,
        prompt_id: &str,
        turn_id: Option<&str>,
        outcome: WorkflowTurnOutcome,
    ) -> Result<FinishTurnStoreOutcome, WorkflowServiceError> {
        Ok(self
            .store
            .finish_turn(session_id, prompt_id, turn_id, outcome, &Self::now())?)
    }

    /// Fence all nonterminal run/step rows after a restart; mints `finished_at`.
    pub fn fence_nonterminal_after_restart(&self) -> Result<(), WorkflowServiceError> {
        Ok(self.store.fence_nonterminal_after_restart(&Self::now())?)
    }
}

/// The validated, ready-to-persist outcome of invocation validation.
struct ValidatedInvocation {
    invocation: WorkflowRunInvocation,
    agent_kind: String,
    model_id: Option<String>,
    mode_id: Option<String>,
    rendered_prompt: String,
}

fn parse_invocation(json: &str) -> anyhow::Result<WorkflowRunInvocation> {
    Ok(serde_json::from_str(json)?)
}

/// The canonical-UUID rule for a path-supplied `runId`, shared by PUT
/// validation and the GET path (spec §3: an invalid ID is a coded 400 on both
/// routes).
pub fn validate_run_id(run_id: &str) -> Result<(), WorkflowRunValidationError> {
    let parsed =
        uuid::Uuid::parse_str(run_id).map_err(|_| WorkflowRunValidationError::InvalidRunId)?;
    if parsed.hyphenated().to_string() != run_id {
        return Err(WorkflowRunValidationError::InvalidRunId);
    }
    Ok(())
}

fn validate_invocation(
    run_id: &str,
    input: &PutWorkflowRunInput,
) -> Result<ValidatedInvocation, WorkflowRunValidationError> {
    // runId: canonical lowercase hyphenated UUID, path-supplied.
    validate_run_id(run_id)?;

    if input.schema_version != 1 {
        return Err(WorkflowRunValidationError::UnsupportedSchemaVersion(
            input.schema_version,
        ));
    }

    if input.workspace_id.trim().is_empty() {
        return Err(WorkflowRunValidationError::BlankWorkspaceId);
    }

    // Exactly one stage, exactly one agent.prompt step.
    if input.definition.stages.len() != 1 {
        return Err(WorkflowRunValidationError::StageCount(
            input.definition.stages.len(),
        ));
    }
    let stage = &input.definition.stages[0];
    if stage.steps.len() != 1 {
        return Err(WorkflowRunValidationError::StepCount(stage.steps.len()));
    }
    let step = &stage.steps[0];
    if step.kind != AGENT_PROMPT_STEP_KIND {
        return Err(WorkflowRunValidationError::UnsupportedStepKind(
            step.kind.clone(),
        ));
    }

    // Harness config.
    let harness = &stage.harness_config;
    if harness.agent_kind.is_empty() {
        return Err(WorkflowRunValidationError::BlankAgentKind);
    }
    if harness.agent_kind.trim() != harness.agent_kind {
        return Err(WorkflowRunValidationError::AgentKindSurroundingWhitespace);
    }
    if harness.agent_kind.trim().is_empty() {
        return Err(WorkflowRunValidationError::BlankAgentKind);
    }
    if let Some(model_id) = &harness.model_id {
        if model_id.trim().is_empty() {
            return Err(WorkflowRunValidationError::BlankModelId);
        }
    }
    if let Some(mode_id) = &harness.mode_id {
        if mode_id.trim().is_empty() {
            return Err(WorkflowRunValidationError::BlankModeId);
        }
    }

    // Declared inputs: unique, nonblank identifiers.
    let mut declared: BTreeMap<String, WorkflowInputType> = BTreeMap::new();
    for input_decl in &input.definition.inputs {
        if input_decl.name.trim().is_empty() {
            return Err(WorkflowRunValidationError::BlankInputName);
        }
        if !is_identifier(&input_decl.name) {
            return Err(WorkflowRunValidationError::InvalidInputName(
                input_decl.name.clone(),
            ));
        }
        if declared
            .insert(input_decl.name.clone(), input_decl.input_type)
            .is_some()
        {
            return Err(WorkflowRunValidationError::DuplicateInputName(
                input_decl.name.clone(),
            ));
        }
    }

    // Arguments: no undeclared keys, types match declared scalar types.
    let mut arguments: BTreeMap<String, WorkflowArgumentValue> = BTreeMap::new();
    for (name, value) in &input.arguments {
        let Some(declared_type) = declared.get(name) else {
            return Err(WorkflowRunValidationError::UndeclaredArgument(name.clone()));
        };
        let typed = coerce_argument(name, value, *declared_type)?;
        arguments.insert(name.clone(), typed);
    }

    // Every required input present.
    for input_decl in &input.definition.inputs {
        if input_decl.required && !arguments.contains_key(&input_decl.name) {
            return Err(WorkflowRunValidationError::MissingRequiredArgument(
                input_decl.name.clone(),
            ));
        }
    }

    // Template scan + render: every {{...}} must be exactly {{inputs.<name>}},
    // referenced inputs must have arguments; unreferenced optionals may be
    // omitted.
    let rendered_prompt = render_prompt(&step.prompt, &declared, &arguments)?;
    if rendered_prompt.trim().is_empty() {
        return Err(WorkflowRunValidationError::BlankRenderedPrompt);
    }
    let byte_len = rendered_prompt.len();
    if byte_len > MAX_RENDERED_PROMPT_BYTES {
        return Err(WorkflowRunValidationError::RenderedPromptTooLarge(byte_len));
    }

    let invocation = WorkflowRunInvocation {
        workspace_id: input.workspace_id.clone(),
        definition: input.definition.clone(),
        arguments,
    };

    Ok(ValidatedInvocation {
        invocation,
        agent_kind: harness.agent_kind.clone(),
        model_id: harness.model_id.clone(),
        mode_id: harness.mode_id.clone(),
        rendered_prompt,
    })
}

pub(super) fn coerce_argument(
    name: &str,
    value: &serde_json::Value,
    declared: WorkflowInputType,
) -> Result<WorkflowArgumentValue, WorkflowRunValidationError> {
    match declared {
        WorkflowInputType::String => match value {
            serde_json::Value::String(text) => Ok(WorkflowArgumentValue::String(text.clone())),
            _ => Err(WorkflowRunValidationError::ArgumentTypeMismatch {
                name: name.to_string(),
                expected: "string",
            }),
        },
        WorkflowInputType::Number => match value {
            serde_json::Value::Number(number) => Ok(WorkflowArgumentValue::Number(number.clone())),
            _ => Err(WorkflowRunValidationError::ArgumentTypeMismatch {
                name: name.to_string(),
                expected: "number",
            }),
        },
        WorkflowInputType::Boolean => match value {
            serde_json::Value::Bool(flag) => Ok(WorkflowArgumentValue::Bool(*flag)),
            _ => Err(WorkflowRunValidationError::ArgumentTypeMismatch {
                name: name.to_string(),
                expected: "boolean",
            }),
        },
    }
}

fn render_prompt(
    prompt: &str,
    declared: &BTreeMap<String, WorkflowInputType>,
    arguments: &BTreeMap<String, WorkflowArgumentValue>,
) -> Result<String, WorkflowRunValidationError> {
    const OPEN: &str = "{{";
    const CLOSE: &str = "}}";
    let mut rendered = String::with_capacity(prompt.len());
    let mut rest = prompt;

    while let Some(open_idx) = rest.find(OPEN) {
        rendered.push_str(&rest[..open_idx]);
        let after_open = &rest[open_idx + OPEN.len()..];
        let Some(close_idx) = after_open.find(CLOSE) else {
            // An unmatched `{{` is invalid.
            return Err(WorkflowRunValidationError::MalformedTemplate);
        };
        let inner = &after_open[..close_idx];
        let Some(name) = inner.strip_prefix("inputs.") else {
            return Err(WorkflowRunValidationError::UnknownTemplateReference(
                inner.to_string(),
            ));
        };
        if name.is_empty() || !declared.contains_key(name) {
            return Err(WorkflowRunValidationError::UnknownTemplateReference(
                inner.to_string(),
            ));
        }
        let Some(value) = arguments.get(name) else {
            return Err(WorkflowRunValidationError::MissingReferencedArgument(
                name.to_string(),
            ));
        };
        rendered.push_str(&render_value(value));
        rest = &after_open[close_idx + CLOSE.len()..];
    }
    rendered.push_str(rest);
    Ok(rendered)
}

fn render_value(value: &WorkflowArgumentValue) -> String {
    match value {
        WorkflowArgumentValue::String(text) => text.clone(),
        WorkflowArgumentValue::Number(number) => number.to_string(),
        WorkflowArgumentValue::Bool(flag) => {
            if *flag {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
    }
}

fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}
