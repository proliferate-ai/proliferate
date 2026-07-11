//! Strict delivery-identity acceptance (WS5a, feature spec §5.3).
//!
//! The immutable delivery identity is `(run_id, plan_hash, binding_hash,
//! execution_generation)`. It is explicit and complete at the HTTP boundary;
//! the runtime never infers missing identity from an opaque plan or falls back
//! to run-id-only idempotency.
//!
//! AnyHarness independently parses the honest legacy-v1 wire, recomputes its
//! RFC 8785 hashes, and enforces every run/plan/binding/workspace equality before
//! any row or actor can be created.

use std::collections::{BTreeMap, BTreeSet};

use anyharness_contract::v1::{
    ExecutionBinding, RepositoryObjectFormat, SourceKind, WorkflowTarget,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::model::WorkflowRunRecord;

const JSON_SAFE_INTEGER_MAX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySourceIntentV1 {
    kind: SourceKind,
    repo: Option<String>,
    #[serde(rename = "ref")]
    ref_: Option<String>,
    #[serde(rename = "resolvedCommit")]
    resolved_commit: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyTriggerKindV1 {
    Manual,
    Schedule,
    Poll,
    Chat,
    Agent,
    Api,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyTargetModeV1 {
    Local,
    PersonalCloud,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyIsolationV1 {
    Workspace,
    Worktree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacySessionBindingV1 {
    Fresh,
    Headless,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyPlanSessionV1 {
    harness: String,
    model: String,
    session_binding: LegacySessionBindingV1,
    integrations: Vec<String>,
    bind_session_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyOnFailKindV1 {
    Stop,
    Retry,
    Continue,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyPlanOnFailV1 {
    kind: LegacyOnFailKindV1,
    n: Option<u32>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyPlanVerifyV1 {
    shell: String,
    expect_exit: i32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyOnBlockedV1 {
    Notify,
    PauseForApproval,
    Fail,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyPlanGoalV1 {
    objective: String,
    max_turns: u32,
    max_wall_secs: u64,
    token_budget: Option<i64>,
    on_blocked: LegacyOnBlockedV1,
    verify: Option<LegacyPlanVerifyV1>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyRequiredInvocationV1 {
    provider: String,
    tool: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyBranchTargetV1 {
    Continue,
    End,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyBranchCaseV1 {
    to: LegacyBranchTargetV1,
}

macro_rules! legacy_step_payload {
    ($name:ident { $($field:ident : $field_type:ty),* $(,)? }) => {
        #[allow(dead_code)]
        #[derive(Debug, Deserialize)]
        #[serde(deny_unknown_fields)]
        struct $name {
            key: String,
            key_v2: String,
            slot: String,
            label: String,
            on_fail: LegacyPlanOnFailV1,
            $($field: $field_type,)*
        }
    };
}

legacy_step_payload!(LegacyAgentConfigStepV1 { model: String });
legacy_step_payload!(LegacyAgentPromptStepV1 {
    prompt: String,
    goal: Option<LegacyPlanGoalV1>,
    required_invocation: Option<LegacyRequiredInvocationV1>,
});
legacy_step_payload!(LegacyAgentEmitStepV1 {
    prompt: String,
    max_attempts: u32,
    name: Option<String>,
    output_schema: Option<Value>,
});
legacy_step_payload!(LegacyShellRunStepV1 {
    command: String,
    timeout_secs: Option<u64>,
    output_name: Option<String>,
});
legacy_step_payload!(LegacyScmOpenPrStepV1 {
    title: String,
    base: Option<String>,
    body: Option<String>,
    draft: Option<bool>,
});
legacy_step_payload!(LegacyNotifyStepV1 {
    slack_channel_id: String,
    message: String,
});
legacy_step_payload!(LegacyBranchStepV1 {
    on: String,
    cases: BTreeMap<String, LegacyBranchCaseV1>,
    reason: Option<String>,
});

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
enum LegacyPlanStepV1 {
    #[serde(rename = "agent.config")]
    AgentConfig(LegacyAgentConfigStepV1),
    #[serde(rename = "agent.prompt")]
    AgentPrompt(LegacyAgentPromptStepV1),
    #[serde(rename = "agent.emit")]
    AgentEmit(LegacyAgentEmitStepV1),
    #[serde(rename = "shell.run")]
    ShellRun(LegacyShellRunStepV1),
    #[serde(rename = "scm.open_pr")]
    ScmOpenPr(LegacyScmOpenPrStepV1),
    #[serde(rename = "notify")]
    Notify(LegacyNotifyStepV1),
    #[serde(rename = "branch")]
    Branch(LegacyBranchStepV1),
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum LegacyInputScalarV1 {
    String(String),
    Bool(bool),
    Integer(i64),
    Unsigned(u64),
    Float(f64),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyResolvedPlanV1 {
    #[serde(rename = "planVersion")]
    plan_version: u32,
    #[serde(rename = "planHash")]
    plan_hash: String,
    run_id: String,
    workflow_id: String,
    workflow_version_id: String,
    version_n: i32,
    trigger_kind: LegacyTriggerKindV1,
    target_mode: LegacyTargetModeV1,
    #[serde(rename = "sourceIntent")]
    source_intent: LegacySourceIntentV1,
    isolation: LegacyIsolationV1,
    sessions: BTreeMap<String, LegacyPlanSessionV1>,
    inputs: BTreeMap<String, LegacyInputScalarV1>,
    steps: Vec<LegacyPlanStepV1>,
}

const PRIVATE_INPUT_KEYS: &[&str] = &[
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
];

fn clean_bounded(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.chars().count() <= maximum
        && !value
            .chars()
            .any(|character| character <= '\u{1f}' || character == '\u{7f}')
}

fn is_ascii_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn is_slot_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_canonical_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_digit() || (b'a'..=b'f').contains(byte),
        })
        && (b'1'..=b'5').contains(&bytes[14])
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value)
}

fn is_canonical_decimal(value: &str) -> bool {
    value == "0"
        || (value
            .as_bytes()
            .first()
            .is_some_and(|first| (b'1'..=b'9').contains(first))
            && value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn legacy_step_key(value: &str) -> Option<(&str, bool)> {
    let parts: Vec<&str> = value.split('.').collect();
    if !(parts.len() == 3 || (parts.len() == 4 && parts[3] == "notify_fields")) {
        return None;
    }
    if !is_canonical_decimal(parts[0])
        || !(parts[1] == "-" || is_slot_identifier(parts[1]))
        || !is_canonical_decimal(parts[2])
    {
        return None;
    }
    Some((parts[1], parts.len() == 4))
}

fn v2_step_key(value: &str) -> Option<bool> {
    let parts: Vec<&str> = value.split("::").collect();
    if !(parts.len() == 4 || (parts.len() == 5 && parts[4] == "notify_fields")) {
        return None;
    }
    if parts[0] != "root"
        || !is_canonical_uuid(parts[1])
        || !(parts[2] == "-" || is_canonical_uuid(parts[2]))
        || !is_canonical_uuid(parts[3])
    {
        return None;
    }
    Some(parts.len() == 5)
}

fn valid_github_repo(value: &str) -> bool {
    let Some(path) = value.strip_prefix("github.com/") else {
        return false;
    };
    let mut parts = path.split('/');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(owner), Some(repo), None)
            if !owner.is_empty()
                && !repo.is_empty()
                && !owner.chars().any(char::is_whitespace)
                && !repo.chars().any(char::is_whitespace)
    )
}

fn valid_branch_ref(value: &str) -> bool {
    let Some(branch) = value.strip_prefix("refs/heads/") else {
        return false;
    };
    !branch.is_empty()
        && branch != "@"
        && branch != "."
        && !branch.starts_with('/')
        && !branch.ends_with('/')
        && !branch.ends_with('.')
        && !branch.ends_with(".lock")
        && !branch.contains("..")
        && !branch.contains("@{")
        && !branch.contains("//")
        && !branch.chars().any(|character| {
            matches!(
                character,
                ' ' | '~' | '^' | ':' | '?' | '*' | '[' | ']' | '\\'
            )
        })
}

fn validate_schema_type(value: &Value) -> Result<(), String> {
    const JSON_TYPES: &[&str] = &[
        "object", "array", "string", "number", "integer", "boolean", "null",
    ];
    if let Some(value) = value.as_str() {
        return if JSON_TYPES.contains(&value) {
            Ok(())
        } else {
            Err("output_schema contains an unknown type".to_string())
        };
    }
    let values = value
        .as_array()
        .ok_or_else(|| "output_schema type must be a string or nullable pair".to_string())?;
    if values.len() != 2 || values[1].as_str() != Some("null") {
        return Err("output_schema type union must be [TYPE, null]".to_string());
    }
    let Some(head) = values[0].as_str() else {
        return Err("output_schema nullable type head must be a string".to_string());
    };
    if head == "null" || !JSON_TYPES.contains(&head) {
        return Err("output_schema nullable type head is invalid".to_string());
    }
    Ok(())
}

fn validate_schema_node(value: &Value, is_root: bool) -> Result<(), String> {
    const ALLOWED: &[&str] = &[
        "$schema",
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "enum",
        "const",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "title",
        "description",
        "default",
    ];
    let object = value
        .as_object()
        .ok_or_else(|| "output_schema node must be an object".to_string())?;
    if object.keys().any(|key| !ALLOWED.contains(&key.as_str())) {
        return Err("output_schema contains an unsupported keyword".to_string());
    }
    if is_root {
        if object.get("type").and_then(Value::as_str) != Some("object") {
            return Err("output_schema root must have type object".to_string());
        }
        if object.get("$schema").is_some_and(|dialect| {
            dialect.as_str() != Some("https://json-schema.org/draft/2020-12/schema")
        }) {
            return Err("output_schema root has the wrong dialect".to_string());
        }
    } else if object.contains_key("$schema") {
        return Err("output_schema $schema is allowed only at the root".to_string());
    }
    if let Some(schema_type) = object.get("type") {
        validate_schema_type(schema_type)?;
    }
    for key in ["minimum", "maximum"] {
        if object.get(key).is_some_and(|bound| !bound.is_number()) {
            return Err(format!("output_schema {key} must be numeric"));
        }
    }
    for key in ["minLength", "maxLength", "minItems", "maxItems"] {
        if object
            .get(key)
            .is_some_and(|bound| !(bound.is_i64() || bound.is_u64()))
        {
            return Err(format!("output_schema {key} must be an integer"));
        }
    }
    if object.get("enum").is_some_and(|values| !values.is_array()) {
        return Err("output_schema enum must be an array".to_string());
    }
    if let Some(properties) = object.get("properties") {
        let properties = properties
            .as_object()
            .ok_or_else(|| "output_schema properties must be an object".to_string())?;
        for (name, schema) in properties {
            if is_root && !is_ascii_identifier(name) {
                return Err("output_schema root property must be an ASCII identifier".to_string());
            }
            validate_schema_node(schema, false)?;
        }
    }
    if object.get("required").is_some_and(|required| {
        required
            .as_array()
            .is_none_or(|values| values.iter().any(|value| !value.is_string()))
    }) {
        return Err("output_schema required must be an array of strings".to_string());
    }
    if let Some(items) = object.get("items") {
        validate_schema_node(items, false)?;
    }
    Ok(())
}

impl LegacySourceIntentV1 {
    fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("repo", self.repo.as_deref()),
            ("ref", self.ref_.as_deref()),
            ("resolvedCommit", self.resolved_commit.as_deref()),
        ] {
            if value.is_some_and(|value| !clean_bounded(value, 512)) {
                return Err(format!("sourceIntent.{name} is not clean and bounded"));
            }
        }
        match self.kind {
            SourceKind::WorkspaceCheckpoint => {
                if self.repo.is_some() || self.ref_.is_some() || self.resolved_commit.is_some() {
                    return Err("workspace_checkpoint carries no commit identity".to_string());
                }
            }
            SourceKind::LocalCommit => {
                if self.repo.is_some()
                    || self.ref_.is_some()
                    || !self
                        .resolved_commit
                        .as_deref()
                        .is_some_and(|commit| is_lower_hex(commit, 40) || is_lower_hex(commit, 64))
                {
                    return Err("local_commit requires an exact Git object id".to_string());
                }
            }
            SourceKind::RemoteCommit => {
                if !self.repo.as_deref().is_some_and(valid_github_repo)
                    || !self.ref_.as_deref().is_some_and(valid_branch_ref)
                    || !self
                        .resolved_commit
                        .as_deref()
                        .is_some_and(|commit| is_lower_hex(commit, 40))
                {
                    return Err("remote_commit requires exact repo/ref/SHA-1 identity".to_string());
                }
            }
        }
        Ok(())
    }
}

impl LegacyPlanSessionV1 {
    fn validate(&self) -> Result<(), String> {
        if !clean_bounded(&self.harness, 255)
            || !clean_bounded(&self.model, 255)
            || self
                .bind_session_id
                .as_deref()
                .is_some_and(|value| !clean_bounded(value, 255))
        {
            return Err("session identity is not clean and bounded".to_string());
        }
        let mut unique = BTreeSet::new();
        for integration in &self.integrations {
            if !is_ascii_identifier(integration) || !unique.insert(integration) {
                return Err("session integrations must be unique ASCII identifiers".to_string());
            }
        }
        Ok(())
    }
}

impl LegacyPlanOnFailV1 {
    fn validate(&self) -> Result<(), String> {
        match (self.kind, self.n) {
            (LegacyOnFailKindV1::Retry, Some(value)) if value > 0 => Ok(()),
            (LegacyOnFailKindV1::Retry, _) => {
                Err("on_fail retry requires a positive n".to_string())
            }
            (_, None) => Ok(()),
            (_, Some(_)) => Err("on_fail n is valid only for retry".to_string()),
        }
    }
}

impl LegacyPlanGoalV1 {
    fn validate(&self) -> Result<(), String> {
        if self.max_turns == 0
            || self.max_wall_secs == 0
            || self.max_wall_secs > JSON_SAFE_INTEGER_MAX
            || self
                .token_budget
                .is_some_and(|value| value <= 0 || value as u64 > JSON_SAFE_INTEGER_MAX)
        {
            return Err("goal budgets must be positive integers".to_string());
        }
        Ok(())
    }
}

impl LegacyRequiredInvocationV1 {
    fn validate(&self) -> Result<(), String> {
        if !clean_bounded(&self.provider, 255) || !clean_bounded(&self.tool, 255) {
            return Err("required invocation identity is not clean and bounded".to_string());
        }
        Ok(())
    }
}

impl LegacyPlanStepV1 {
    fn common(&self) -> (&str, &str, &str, &LegacyPlanOnFailV1) {
        match self {
            Self::AgentConfig(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
            Self::AgentPrompt(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
            Self::AgentEmit(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
            Self::ShellRun(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
            Self::ScmOpenPr(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
            Self::Notify(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
            Self::Branch(step) => (&step.key, &step.key_v2, &step.slot, &step.on_fail),
        }
    }

    fn validate(&self) -> Result<(), String> {
        let (_, _, slot, on_fail) = self.common();
        if !is_slot_identifier(slot) {
            return Err("step slot is not a canonical slot identifier".to_string());
        }
        on_fail.validate()?;
        match self {
            Self::AgentConfig(_) | Self::ScmOpenPr(_) | Self::Notify(_) | Self::Branch(_) => {}
            Self::AgentPrompt(step) => {
                if let Some(goal) = &step.goal {
                    goal.validate()?;
                }
                if let Some(invocation) = &step.required_invocation {
                    invocation.validate()?;
                }
            }
            Self::AgentEmit(step) => {
                if step.max_attempts == 0 {
                    return Err("agent.emit max_attempts must be positive".to_string());
                }
                if step
                    .name
                    .as_deref()
                    .is_some_and(|name| !is_ascii_identifier(name))
                {
                    return Err("agent.emit name must be an ASCII identifier".to_string());
                }
                if let Some(schema) = &step.output_schema {
                    validate_schema_node(schema, true)?;
                }
            }
            Self::ShellRun(step) => {
                if step
                    .timeout_secs
                    .is_some_and(|timeout| timeout == 0 || timeout > JSON_SAFE_INTEGER_MAX)
                {
                    return Err("shell.run timeout_secs must be positive".to_string());
                }
                if step
                    .output_name
                    .as_deref()
                    .is_some_and(|name| !is_ascii_identifier(name))
                {
                    return Err("shell.run output_name must be an ASCII identifier".to_string());
                }
            }
        }
        Ok(())
    }
}

impl LegacyResolvedPlanV1 {
    fn validate(&self) -> Result<(), String> {
        if self.plan_version != 1 {
            return Err("planVersion must be 1".to_string());
        }
        if !is_canonical_sha256(&self.plan_hash) {
            return Err("planHash is not canonical".to_string());
        }
        for (name, value) in [
            ("run_id", self.run_id.as_str()),
            ("workflow_id", self.workflow_id.as_str()),
            ("workflow_version_id", self.workflow_version_id.as_str()),
        ] {
            if !is_canonical_uuid(value) {
                return Err(format!("{name} is not a canonical UUID"));
            }
        }
        if self.version_n <= 0 {
            return Err("version_n must be positive".to_string());
        }
        self.source_intent.validate()?;
        match (self.target_mode, self.source_intent.kind) {
            (LegacyTargetModeV1::PersonalCloud, SourceKind::RemoteCommit)
            | (
                LegacyTargetModeV1::Local,
                SourceKind::LocalCommit | SourceKind::WorkspaceCheckpoint,
            ) => {}
            _ => return Err("target_mode and sourceIntent.kind are inconsistent".to_string()),
        }
        for (slot, session) in &self.sessions {
            if !is_slot_identifier(slot) {
                return Err("session key is not a canonical slot identifier".to_string());
            }
            session.validate()?;
        }
        for (name, value) in &self.inputs {
            if !is_ascii_identifier(name) {
                return Err("input key is not an ASCII identifier".to_string());
            }
            let normalized: String = name
                .bytes()
                .filter(|byte| byte.is_ascii_alphanumeric())
                .map(|byte| byte.to_ascii_lowercase() as char)
                .collect();
            if PRIVATE_INPUT_KEYS.contains(&normalized.as_str()) {
                return Err("credential-typed input key is forbidden".to_string());
            }
            if matches!(value, LegacyInputScalarV1::Float(number) if !number.is_finite()) {
                return Err("input number must be finite".to_string());
            }
        }
        let mut legacy_keys = BTreeSet::new();
        let mut v2_keys = BTreeSet::new();
        for step in &self.steps {
            step.validate()?;
            let (key, key_v2, slot, _) = step.common();
            let Some((lane, legacy_injected)) = legacy_step_key(key) else {
                return Err("legacy step key is malformed".to_string());
            };
            let Some(v2_injected) = v2_step_key(key_v2) else {
                return Err("v2 step key is malformed".to_string());
            };
            if !self.sessions.contains_key(slot) {
                return Err("step slot has no exact session".to_string());
            }
            if lane != "-" && lane != slot {
                return Err("parallel step lane differs from its session slot".to_string());
            }
            if legacy_injected != v2_injected {
                return Err("legacy and v2 injected suffixes disagree".to_string());
            }
            if !legacy_keys.insert(key) || !v2_keys.insert(key_v2) {
                return Err("step identities must be unique".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryIdentity {
    pub run_id: String,
    pub plan_hash: String,
    pub binding_hash: String,
    pub execution_generation: i64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DeliveryIdentityError {
    #[error("delivery identity schemaVersion must be 1")]
    UnsupportedSchemaVersion,
    #[error("delivery identity {field} must be a canonical sha256 hash")]
    InvalidHash { field: &'static str },
    #[error("delivery identity executionGeneration must be positive")]
    InvalidExecutionGeneration,
    #[error("delivery identity {field} is inconsistent with {other}")]
    Inconsistent {
        field: &'static str,
        other: &'static str,
    },
    #[error("execution binding {field} must be positive")]
    InvalidBindingGeneration { field: &'static str },
    #[error("execution binding {field} must not be empty")]
    EmptyBindingField { field: &'static str },
    #[error("workspace_checkpoint binding requires checkpointId and checkpointContentHash")]
    IncompleteCheckpoint,
    #[error("execution binding checkpoint fields are forbidden for commit source kinds")]
    UnexpectedCheckpoint,
    #[error("execution binding {field} is malformed")]
    MalformedBindingField { field: &'static str },
    #[error("legacy resolved plan v1 is malformed: {0}")]
    InvalidLegacyPlan(String),
    #[error("legacy resolved plan planVersion must be 1")]
    UnsupportedPlanVersion,
    #[error("{field} does not match its RFC 8785 content hash")]
    HashMismatch { field: &'static str },
}

pub fn is_canonical_sha256(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn validate_delivery_identity(
    schema_version: u32,
    identity: &DeliveryIdentity,
    plan_value: &Value,
    request_workspace_id: &str,
    actual_workspace_generation: i64,
    binding: &ExecutionBinding,
) -> Result<(), DeliveryIdentityError> {
    if schema_version != 1 {
        return Err(DeliveryIdentityError::UnsupportedSchemaVersion);
    }
    let plan: LegacyResolvedPlanV1 = serde_json::from_value(plan_value.clone())
        .map_err(|error| DeliveryIdentityError::InvalidLegacyPlan(error.to_string()))?;
    if plan.plan_version != 1 {
        return Err(DeliveryIdentityError::UnsupportedPlanVersion);
    }
    plan.validate()
        .map_err(DeliveryIdentityError::InvalidLegacyPlan)?;
    // Parse the nested legacy execution grammar independently as well. The
    // final-envelope gate below means this validates only; it never activates.
    super::plan::parse(
        &serde_json::to_string(plan_value)
            .map_err(|error| DeliveryIdentityError::InvalidLegacyPlan(error.to_string()))?,
    )
    .map_err(|error| DeliveryIdentityError::InvalidLegacyPlan(error.to_string()))?;
    for (field, value) in [
        ("planHash", identity.plan_hash.as_str()),
        ("bindingHash", identity.binding_hash.as_str()),
        ("binding.bindingHash", binding.binding_hash.as_str()),
    ] {
        if !is_canonical_sha256(value) {
            return Err(DeliveryIdentityError::InvalidHash { field });
        }
    }
    if identity.execution_generation <= 0 {
        return Err(DeliveryIdentityError::InvalidExecutionGeneration);
    }
    if identity.run_id != plan.run_id {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "runId",
            other: "plan.run_id",
        });
    }
    if plan.plan_hash != identity.plan_hash {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "planHash",
            other: "plan.planHash",
        });
    }
    if content_hash_excluding(plan_value, "planHash")? != identity.plan_hash {
        return Err(DeliveryIdentityError::HashMismatch { field: "planHash" });
    }
    let binding_value = serde_json::to_value(binding)
        .map_err(|error| DeliveryIdentityError::InvalidLegacyPlan(error.to_string()))?;
    if content_hash_excluding(&binding_value, "bindingHash")? != binding.binding_hash {
        return Err(DeliveryIdentityError::HashMismatch {
            field: "bindingHash",
        });
    }
    if binding.binding_hash != identity.binding_hash {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "bindingHash",
            other: "binding.bindingHash",
        });
    }
    if binding.workspace_id != request_workspace_id {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "workspaceId",
            other: "binding.workspaceId",
        });
    }
    if binding.workspace_generation != actual_workspace_generation {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "workspaceGeneration",
            other: "runtime workspace generation",
        });
    }
    for (field, value) in [
        ("workspaceGeneration", binding.workspace_generation),
        ("executorGeneration", binding.executor_generation),
    ] {
        if value <= 0 {
            return Err(DeliveryIdentityError::InvalidBindingGeneration { field });
        }
    }
    for (field, value) in [
        ("workspaceId", binding.workspace_id.as_str()),
        ("materializationId", binding.materialization_id.as_str()),
        ("executorId", binding.executor_id.as_str()),
    ] {
        if !is_binding_identifier(value) {
            return Err(DeliveryIdentityError::EmptyBindingField { field });
        }
    }
    if binding
        .checkpoint_id
        .as_deref()
        .is_some_and(|value| !is_binding_identifier(value))
    {
        return Err(DeliveryIdentityError::MalformedBindingField {
            field: "checkpointId",
        });
    }
    if binding.source_kind == SourceKind::WorkspaceCheckpoint
        && (binding.checkpoint_id.as_deref().is_none_or(str::is_empty)
            || binding
                .checkpoint_content_hash
                .as_deref()
                .is_none_or(str::is_empty))
    {
        return Err(DeliveryIdentityError::IncompleteCheckpoint);
    }
    if binding.source_kind != SourceKind::WorkspaceCheckpoint
        && (binding.checkpoint_id.is_some() || binding.checkpoint_content_hash.is_some())
    {
        return Err(DeliveryIdentityError::UnexpectedCheckpoint);
    }
    if binding
        .checkpoint_content_hash
        .as_deref()
        .is_some_and(|value| !is_canonical_sha256(value))
    {
        return Err(DeliveryIdentityError::MalformedBindingField {
            field: "checkpointContentHash",
        });
    }
    let oid_length = match binding.repository_object_format {
        RepositoryObjectFormat::Sha1 => 40,
        RepositoryObjectFormat::Sha256 => 64,
    };
    if binding.base_commit_oid.len() != oid_length
        || !binding
            .base_commit_oid
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(DeliveryIdentityError::MalformedBindingField {
            field: "baseCommitOid",
        });
    }
    let expected_target = match plan.target_mode {
        LegacyTargetModeV1::Local => WorkflowTarget::Local,
        LegacyTargetModeV1::PersonalCloud => WorkflowTarget::PersonalCloud,
    };
    if binding.target != expected_target {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "target",
            other: "plan.target_mode",
        });
    }
    if binding.source_kind != plan.source_intent.kind {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "sourceKind",
            other: "plan.sourceIntent.kind",
        });
    }
    if matches!(
        plan.source_intent.kind,
        SourceKind::RemoteCommit | SourceKind::LocalCommit
    ) && plan.source_intent.resolved_commit.as_deref() != Some(binding.base_commit_oid.as_str())
    {
        return Err(DeliveryIdentityError::Inconsistent {
            field: "baseCommitOid",
            other: "plan.sourceIntent.resolvedCommit",
        });
    }
    // Touch every strict top-level field so an accidental weakening remains a
    // compile-visible change rather than dead validation data.
    let _ = (
        &plan.workflow_id,
        &plan.workflow_version_id,
        plan.version_n,
        &plan.trigger_kind,
        &plan.isolation,
        &plan.sessions,
        &plan.inputs,
        &plan.steps,
    );
    Ok(())
}

fn is_binding_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 255
        && !value.chars().any(|character| {
            character.is_whitespace() || character <= '\u{1f}' || character == '\u{7f}'
        })
}

pub(crate) fn content_hash_excluding(
    value: &Value,
    excluded: &str,
) -> Result<String, DeliveryIdentityError> {
    let mut reduced = value.clone();
    let object = reduced.as_object_mut().ok_or_else(|| {
        DeliveryIdentityError::InvalidLegacyPlan("hashed value must be an object".to_string())
    })?;
    object.remove(excluded);
    let mut canonical = String::new();
    write_jcs(&reduced, &mut canonical)?;
    Ok(format!("sha256:{:x}", Sha256::digest(canonical.as_bytes())))
}

pub(super) fn write_jcs(value: &Value, output: &mut String) -> Result<(), DeliveryIdentityError> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::String(value) => output.push_str(
            &serde_json::to_string(value)
                .map_err(|error| DeliveryIdentityError::InvalidLegacyPlan(error.to_string()))?,
        ),
        Value::Number(value) => output.push_str(&jcs_number(value)?),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_jcs(value, output)?;
            }
            output.push(']');
        }
        Value::Object(values) => {
            output.push('{');
            let mut keys: Vec<&String> = values.keys().collect();
            // RFC 8785 property order is lexicographic over UTF-16 code units,
            // matching JavaScript's Array#sort. Rust String ordering uses
            // Unicode scalar/UTF-8 order and differs for supplementary-plane
            // keys versus high BMP keys.
            keys.sort_by_key(|key| key.encode_utf16().collect::<Vec<u16>>());
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key).map_err(|error| {
                    DeliveryIdentityError::InvalidLegacyPlan(error.to_string())
                })?);
                output.push(':');
                write_jcs(&values[*key], output)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn jcs_number(value: &serde_json::Number) -> Result<String, DeliveryIdentityError> {
    let binary64 = if let Some(integer) = value.as_i64() {
        if !integer_is_binary64_exact(integer.unsigned_abs()) {
            return Err(DeliveryIdentityError::InvalidLegacyPlan(
                "integer is not exactly representable as IEEE-754 binary64".to_string(),
            ));
        }
        integer as f64
    } else if let Some(integer) = value.as_u64() {
        if !integer_is_binary64_exact(integer) {
            return Err(DeliveryIdentityError::InvalidLegacyPlan(
                "integer is not exactly representable as IEEE-754 binary64".to_string(),
            ));
        }
        integer as f64
    } else {
        value.as_f64().ok_or_else(|| {
            DeliveryIdentityError::InvalidLegacyPlan("number is not finite".to_string())
        })?
    };
    jcs_binary64(binary64)
}

fn jcs_binary64(value: f64) -> Result<String, DeliveryIdentityError> {
    if !value.is_finite() {
        return Err(DeliveryIdentityError::InvalidLegacyPlan(
            "number is not finite".to_string(),
        ));
    }
    if value == 0.0 {
        return Ok("0".to_string());
    }
    let negative = value.is_sign_negative();
    let rendered = value.abs().to_string().to_lowercase();
    let (mantissa, exponent) = rendered
        .split_once('e')
        .map_or((rendered.as_str(), 0), |(mantissa, exponent)| {
            (mantissa, exponent.parse::<i32>().unwrap_or(0))
        });
    let decimal_position = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    let mut digits: String = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let leading = digits.len() - digits.trim_start_matches('0').len();
    digits = digits.trim_start_matches('0').to_string();
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    let n = decimal_position + exponent - leading as i32;
    let k = digits.len() as i32;
    let body = if k <= n && n <= 21 {
        format!("{}{}", digits, "0".repeat((n - k) as usize))
    } else if n > 0 && n <= 21 {
        let split = n as usize;
        format!("{}.{}", &digits[..split], &digits[split..])
    } else if n > -6 && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let exponent = n - 1;
        let coefficient = if digits.len() == 1 {
            digits
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        format!("{coefficient}e{exponent:+}")
    };
    Ok(if negative { format!("-{body}") } else { body })
}

/// Whether an integer has an exact IEEE-754 binary64 representation. Once an
/// integer needs more than 53 significant bits, every discarded low bit must
/// be zero. Rejecting the others keeps Python/TypeScript/Rust hash bytes from
/// diverging through language-specific rounding.
fn integer_is_binary64_exact(magnitude: u64) -> bool {
    if magnitude <= (1_u64 << 53) {
        return true;
    }
    let significant_bits = u64::BITS - magnitude.leading_zeros();
    let discarded_bits = significant_bits - 53;
    magnitude.trailing_zeros() >= discarded_bits
}

/// Internal abort marker carried through the `anyhow` transaction boundary so
/// a delivery-identity conflict rolls the transaction back and surfaces as the
/// typed `WorkflowServiceError::DeliveryIdentityConflict` (never a generic
/// store error).
#[derive(Debug, thiserror::Error)]
#[error("delivery identity conflict on {field}")]
#[cfg(test)]
pub(super) struct ConflictAbort {
    pub(super) field: &'static str,
}

/// Compare the stored run's delivery identity against a re-delivery's. A legacy
/// stored row with any missing identity field conflicts and remains parked;
/// there is no run-id-only compatibility path for live execution.
#[cfg(test)]
pub(super) fn delivery_identity_conflict(
    existing: &WorkflowRunRecord,
    delivered: &DeliveryIdentity,
) -> Option<&'static str> {
    if existing.plan_hash.as_deref() != Some(delivered.plan_hash.as_str()) {
        return Some("plan_hash");
    }
    if existing.binding_hash.as_deref() != Some(delivered.binding_hash.as_str()) {
        return Some("binding_hash");
    }
    if existing.execution_generation != Some(delivered.execution_generation) {
        return Some("execution_generation");
    }
    None
}

pub fn has_complete_delivery_identity(run: &WorkflowRunRecord) -> bool {
    run.plan_hash.as_deref().is_some_and(is_canonical_sha256)
        && run.binding_hash.as_deref().is_some_and(is_canonical_sha256)
        && run
            .execution_generation
            .is_some_and(|generation| generation > 0)
}

#[cfg(test)]
pub fn valid_test_delivery_identity(plan_json: &str) -> DeliveryIdentity {
    let value: Value = serde_json::from_str(plan_json).expect("test plan JSON");
    DeliveryIdentity {
        run_id: value["run_id"]
            .as_str()
            .expect("test plan run_id")
            .to_string(),
        plan_hash: value
            .get("planHash")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("sha256:{}", "a".repeat(64))),
        binding_hash: value
            .get("binding_hash")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("sha256:{}", "b".repeat(64))),
        execution_generation: value
            .get("execution_generation")
            .and_then(Value::as_i64)
            .unwrap_or(1),
    }
}

#[cfg(test)]
pub trait WorkflowServiceIdentityFixture {
    fn create_run_with_valid_identity_fixture(
        &self,
        plan_json: &str,
        workspace_id: &str,
    ) -> Result<(WorkflowRunRecord, bool), super::service::WorkflowServiceError>;
}

#[cfg(test)]
impl WorkflowServiceIdentityFixture for super::service::WorkflowService {
    fn create_run_with_valid_identity_fixture(
        &self,
        plan_json: &str,
        workspace_id: &str,
    ) -> Result<(WorkflowRunRecord, bool), super::service::WorkflowServiceError> {
        let identity = valid_test_delivery_identity(plan_json);
        self.create_run_with_identity(plan_json, workspace_id, &identity)
    }
}
