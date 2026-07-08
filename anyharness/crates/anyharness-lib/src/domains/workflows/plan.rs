//! Strict, typed deserialization of the server-produced resolved plan payload.
//!
//! The plan is self-contained (the actor never fetches a definition). `{{args.*}}`
//! are already interpolated server-side; the step strings that survive here may
//! still contain `{{steps[N].output.Y}}` placeholders, which
//! [`super::templates`] late-binds against completed step outputs at execution
//! time. Deserialization is strict: an unknown step `kind` is rejected.

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("resolved plan payload is not valid JSON: {0}")]
    InvalidJson(String),
    #[error("resolved plan payload is malformed: {0}")]
    Malformed(String),
}

/// The fully-resolved plan the actor executes (format v2, data-contract §4).
///
/// The definition's `agents` spine is flattened server-side into one ordered
/// `steps` list; each step carries its structured `key` and its `slot` (an opaque
/// session-affinity string). Per-slot session provisioning is described by
/// `sessions` (replacing the old single `setup`). The runtime never learns the
/// words "agents", "integrations", or a named ref — those were resolved away.
#[derive(Debug, Clone, Deserialize)]
pub struct ResolvedPlan {
    pub run_id: String,
    /// Document-format version; strict parsers may reject unknown versions.
    #[serde(default)]
    pub plan_version: Option<i64>,
    #[serde(default)]
    pub workflow_id: Option<String>,
    #[serde(default)]
    pub workflow_version_id: Option<String>,
    #[serde(default)]
    pub version_n: Option<i64>,
    #[serde(default)]
    pub trigger_kind: Option<String>,
    #[serde(default)]
    pub target_mode: Option<String>,
    /// Per-slot session provisioning, keyed by the step's `slot`.
    #[serde(default)]
    pub sessions: BTreeMap<String, SessionSpec>,
    /// Server-resolved input values, kept verbatim for the run record.
    #[serde(default, alias = "args")]
    pub inputs: serde_json::Value,
    /// Per-run integration-gateway block (§6.4/OPEN-3(a), §3.7/L16). Present
    /// whenever the delivery minted a per-run gateway token — which, under L16,
    /// is every run (an empty `integrations` list is legal). Absent for legacy
    /// plans predating PR E. Carries the MCP URL + credential the executor
    /// injects into workflow-owned sessions, and the completion-ping endpoint
    /// the actor nudges after each step transition.
    #[serde(default)]
    pub gateway: Option<PlanGateway>,
    pub steps: Vec<PlanStep>,
}

/// The per-run gateway block the server mints at StartRun and threads through
/// `resolved_plan_json.gateway`. `authorization` is the full `Authorization`
/// header value (e.g. `"Bearer <per-run-token>"`), used verbatim — matching the
/// worker dotfile convention ([`crate::integrations::integration_gateway`]) and
/// the gateway's own `Bearer <token>` parsing.
#[derive(Debug, Clone, Deserialize)]
pub struct PlanGateway {
    /// The integration-gateway MCP endpoint URL (`SessionMcpServer::Http`).
    pub url: String,
    /// The full `Authorization` header value (verbatim), used for both the MCP
    /// server header and the completion ping.
    pub authorization: String,
    /// The completion-ping endpoint (`POST`, empty body) the actor nudges after
    /// each step transition (§3.7/L16).
    pub ping_url: String,
    /// The namespace-level scope this run's token grants — the definition's
    /// resolved `integrations[]` (E3: integration namespaces, no tool lists;
    /// the gateway treats a namespace grant as "all tools of that provider" at
    /// call time). Empty means "no integration scopes" (still legal: the token
    /// exists only to authorize the completion ping). The runtime only reads
    /// its emptiness (L22 local-lane fail-fast); it never inspects tools.
    #[serde(default)]
    pub integrations: Vec<String>,
}

impl ResolvedPlan {
    pub fn step(&self, index: usize) -> Option<&PlanStep> {
        self.steps.get(index)
    }

    pub fn step_count(&self) -> usize {
        self.steps.len()
    }
}

/// How one slot's session is provisioned (data-contract §4 `sessions[slot]`).
#[derive(Debug, Clone, Deserialize)]
pub struct SessionSpec {
    pub harness: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "SessionBinding::default_fresh")]
    pub session_binding: SessionBinding,
    /// L29: bind an existing session instead of creating a fresh one.
    #[serde(default)]
    pub bind_session_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionBinding {
    /// New session, visible in the run view (deep-linkable).
    Fresh,
    /// New session with no UI focus.
    Headless,
}

impl SessionBinding {
    fn default_fresh() -> Self {
        SessionBinding::Fresh
    }
}

/// One plan step: its structured identity + slot + failure policy + kind payload.
///
/// `key` is the structured step key "<node>.<lane>.<step>" (B5); `slot` is the
/// step's session-affinity handle. Both are stamped by the server resolver and
/// carried through to the observed step-run row. They are `serde(default)` at the
/// wire boundary for resilience — the server (the authority) always populates
/// them.
#[derive(Debug, Clone, Deserialize)]
pub struct PlanStep {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub slot: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub on_fail: OnFail,
    #[serde(flatten)]
    pub kind: StepKind,
}

impl PlanStep {
    /// The stable step-kind slug recorded on the step run row.
    pub fn kind_slug(&self) -> &'static str {
        self.kind.slug()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum StepKind {
    #[serde(rename = "agent.config")]
    AgentConfig(AgentConfigStep),
    #[serde(rename = "agent.prompt")]
    AgentPrompt(AgentPromptStep),
    #[serde(rename = "agent.emit")]
    AgentEmit(AgentEmitStep),
    #[serde(rename = "shell.run")]
    ShellRun(ShellRunStep),
    #[serde(rename = "scm.open_pr")]
    ScmOpenPr(ScmOpenPrStep),
    #[serde(rename = "notify")]
    Notify(NotifyStep),
    #[serde(rename = "branch")]
    Branch(BranchStep),
}

impl StepKind {
    pub fn slug(&self) -> &'static str {
        match self {
            StepKind::AgentConfig(_) => "agent.config",
            StepKind::AgentPrompt(_) => "agent.prompt",
            StepKind::AgentEmit(_) => "agent.emit",
            StepKind::ShellRun(_) => "shell.run",
            StepKind::ScmOpenPr(_) => "scm.open_pr",
            StepKind::Notify(_) => "notify",
            StepKind::Branch(_) => "branch",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentPromptStep {
    pub prompt: String,
    #[serde(default)]
    pub goal: Option<GoalSpec>,
    /// L27 gate: after the turn, require this provider+tool was invoked. The gate
    /// loop (C14) lands with the session plane; the plan carries it now.
    #[serde(default)]
    pub required_invocation: Option<RequiredInvocation>,
}

/// Write-output step (§1.2): prompts, then captures a schema-shaped output. The
/// emit `name` is resolved away server-side (refs are already indexed), so the
/// runtime only needs the re-ask budget + optional schema.
#[derive(Debug, Clone, Deserialize)]
pub struct AgentEmitStep {
    pub prompt: String,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
}

fn default_max_attempts() -> u32 {
    3
}

#[derive(Debug, Clone, Deserialize)]
pub struct RequiredInvocation {
    pub provider: String,
    pub tool: String,
}

/// Sets the active model for the steps below it in the same slot. Model-only
/// (A3): harness is fixed per slot, so a different harness is a different slot —
/// there is no harness-switch. Executes instantly and never opens a session of
/// its own.
#[derive(Debug, Clone, Deserialize)]
pub struct AgentConfigStep {
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GoalSpec {
    pub objective: String,
    pub max_turns: u32,
    pub max_wall_secs: u64,
    #[serde(default)]
    pub token_budget: Option<i64>,
    #[serde(default)]
    pub on_blocked: OnBlocked,
    #[serde(default)]
    pub verify: Option<VerifySpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnBlocked {
    /// Record an in-app notify and keep waiting; the goal may unblock.
    #[default]
    Notify,
    /// Park the run on a durable approval; approve resumes, deny fails the step.
    PauseForApproval,
    /// Fail the step immediately with `goal_blocked`.
    Fail,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VerifySpec {
    pub shell: String,
    pub expect_exit: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShellRunStep {
    pub command: String,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScmOpenPrStep {
    #[serde(default)]
    pub base: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: bool,
}

/// Slack-only notify (E1b): the server sends it (`slack_notify` action);
/// template-only in v1. No channel discriminator, no in-app variant.
#[derive(Debug, Clone, Deserialize)]
pub struct NotifyStep {
    pub slack_channel_id: String,
    pub message: String,
}

/// Branch step (C11/D3): switch on a prior emit's field (already rewritten to an
/// indexed ref) and route each case to continue|end. The engine arm lands in a
/// later phase; the plan carries the shape now.
#[derive(Debug, Clone, Deserialize)]
pub struct BranchStep {
    pub on: String,
    pub cases: BTreeMap<String, BranchCase>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BranchCase {
    pub to: BranchTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BranchTarget {
    /// Normal advance to the next step.
    Continue,
    /// The run goes terminal (`completed`); later steps are marked skipped (E5).
    End,
}

/// Per-step failure policy. Defaults to `stop`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct OnFail {
    #[serde(default)]
    pub kind: OnFailKind,
    /// Max retries when `kind = retry`.
    #[serde(default)]
    pub n: u32,
}

impl Default for OnFail {
    fn default() -> Self {
        Self {
            kind: OnFailKind::Stop,
            n: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnFailKind {
    #[default]
    Stop,
    Retry,
    Continue,
}

/// Strictly deserialize a resolved plan from its raw JSON string.
pub fn parse(plan_json: &str) -> Result<ResolvedPlan, PlanError> {
    let value: serde_json::Value =
        serde_json::from_str(plan_json).map_err(|error| PlanError::InvalidJson(error.to_string()))?;
    parse_value(value)
}

/// Strictly deserialize a resolved plan from an already-parsed JSON value.
pub fn parse_value(value: serde_json::Value) -> Result<ResolvedPlan, PlanError> {
    serde_json::from_value(value).map_err(|error| PlanError::Malformed(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_plan_json() -> &'static str {
        r#"{
            "run_id": "run-1",
            "plan_version": 1,
            "workflow_id": "wf-1",
            "workflow_version_id": "wfv-1",
            "version_n": 2,
            "trigger_kind": "manual",
            "target_mode": "local",
            "sessions": {
                "triage": { "harness": "claude", "model": "sonnet", "session_binding": "fresh" },
                "fix": { "harness": "codex", "model": "opus", "session_binding": "headless",
                         "bind_session_id": "sess_abc" }
            },
            "inputs": { "ticket": "ABC-1" },
            "steps": [
                { "key": "0.-.0", "slot": "triage", "label": "set model",
                  "kind": "agent.config", "model": "opus" },
                {
                    "key": "0.-.1", "slot": "triage", "label": "investigate",
                    "kind": "agent.prompt",
                    "prompt": "fix {{steps[2].output.thing}}",
                    "required_invocation": { "provider": "linear", "tool": "update_status" },
                    "goal": {
                        "objective": "make CI green",
                        "max_turns": 25,
                        "max_wall_secs": 5400,
                        "on_blocked": "pause_for_approval",
                        "verify": { "shell": "make test", "expect_exit": 0 }
                    },
                    "on_fail": { "kind": "retry", "n": 2 }
                },
                { "key": "0.-.2", "slot": "triage", "kind": "agent.emit",
                  "prompt": "summarize", "max_attempts": 5,
                  "output_schema": { "type": "object" } },
                { "key": "1.-.0", "slot": "fix", "kind": "shell.run",
                  "command": "cargo build", "timeout_secs": 600, "output_name": "build" },
                { "key": "1.-.1", "slot": "fix", "kind": "scm.open_pr",
                  "title": "Fix", "body": "done", "draft": true },
                { "key": "1.-.2", "slot": "fix", "kind": "notify",
                  "slack_channel_id": "C123", "message": "shipped" },
                { "key": "1.-.3", "slot": "fix", "kind": "branch",
                  "on": "{{steps[2].output.verdict}}",
                  "cases": { "ship": { "to": "continue" }, "wont_fix": { "to": "end" } },
                  "reason": "route" }
            ]
        }"#
    }

    #[test]
    fn parses_a_full_plan_with_all_step_kinds() {
        let plan = parse(full_plan_json()).expect("parse full plan");
        assert_eq!(plan.run_id, "run-1");
        assert_eq!(plan.plan_version, Some(1));
        assert_eq!(plan.version_n, Some(2));
        assert_eq!(plan.step_count(), 7);

        // sessions map, keyed by slot.
        assert_eq!(plan.sessions.len(), 2);
        assert_eq!(plan.sessions["fix"].bind_session_id.as_deref(), Some("sess_abc"));
        assert_eq!(plan.sessions["fix"].session_binding, SessionBinding::Headless);
        assert_eq!(plan.sessions["triage"].harness, "claude");
        assert_eq!(plan.sessions["triage"].session_binding, SessionBinding::Fresh);

        // steps carry structured key + slot + label.
        assert_eq!(plan.steps[0].key, "0.-.0");
        assert_eq!(plan.steps[0].slot, "triage");
        assert_eq!(plan.steps[0].label, "set model");

        let StepKind::AgentConfig(config) = &plan.steps[0].kind else {
            panic!("expected agent.config");
        };
        assert_eq!(config.model.as_deref(), Some("opus"));
        assert_eq!(plan.steps[0].kind_slug(), "agent.config");
        assert_eq!(plan.steps[0].on_fail.kind, OnFailKind::Stop);

        let StepKind::AgentPrompt(agent) = &plan.steps[1].kind else {
            panic!("expected agent.prompt");
        };
        let inv = agent.required_invocation.as_ref().expect("required_invocation");
        assert_eq!(inv.provider, "linear");
        assert_eq!(inv.tool, "update_status");
        let goal = agent.goal.as_ref().expect("goal");
        assert_eq!(goal.max_turns, 25);
        assert_eq!(goal.on_blocked, OnBlocked::PauseForApproval);
        assert_eq!(plan.steps[1].on_fail.kind, OnFailKind::Retry);
        assert_eq!(plan.steps[1].on_fail.n, 2);

        let StepKind::AgentEmit(emit) = &plan.steps[2].kind else {
            panic!("expected agent.emit");
        };
        assert_eq!(emit.max_attempts, 5);
        assert!(emit.output_schema.is_some());

        let StepKind::Notify(notify) = &plan.steps[5].kind else {
            panic!("expected notify");
        };
        assert_eq!(notify.slack_channel_id, "C123");

        let StepKind::Branch(branch) = &plan.steps[6].kind else {
            panic!("expected branch");
        };
        assert_eq!(branch.cases["ship"].to, BranchTarget::Continue);
        assert_eq!(branch.cases["wont_fix"].to, BranchTarget::End);
    }

    #[test]
    fn defaults_apply_for_minimal_steps() {
        let plan = parse(
            r#"{
                "run_id": "run-2",
                "sessions": { "main": { "harness": "codex", "session_binding": "headless" } },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "agent.prompt", "prompt": "hi" } ]
            }"#,
        )
        .expect("parse minimal plan");
        assert_eq!(plan.sessions["main"].session_binding, SessionBinding::Headless);
        assert!(plan.sessions["main"].model.is_none());
        let StepKind::AgentPrompt(agent) = &plan.steps[0].kind else {
            panic!("expected agent.prompt");
        };
        assert!(agent.goal.is_none());
        assert!(agent.required_invocation.is_none());
        assert_eq!(plan.steps[0].on_fail.kind, OnFailKind::Stop);
    }

    #[test]
    fn agent_emit_max_attempts_defaults_to_three() {
        let plan = parse(
            r#"{
                "run_id": "run-emit",
                "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "agent.emit", "prompt": "go" } ]
            }"#,
        )
        .expect("parse emit plan");
        let StepKind::AgentEmit(emit) = &plan.steps[0].kind else {
            panic!("expected agent.emit");
        };
        assert_eq!(emit.max_attempts, 3);
    }

    #[test]
    fn rejects_an_unknown_step_kind() {
        let error = parse(
            r#"{
                "run_id": "run-3",
                "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "human.approval", "message": "x" } ]
            }"#,
        )
        .expect_err("unknown kind must reject");
        assert!(matches!(error, PlanError::Malformed(_)));
    }

    #[test]
    fn rejects_a_missing_required_field() {
        // agent.prompt requires `prompt`.
        let error = parse(
            r#"{
                "run_id": "run-4",
                "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "agent.prompt" } ]
            }"#,
        )
        .expect_err("missing prompt must reject");
        assert!(matches!(error, PlanError::Malformed(_)));
    }

    #[test]
    fn rejects_invalid_json() {
        let error = parse("{not json").expect_err("invalid json must reject");
        assert!(matches!(error, PlanError::InvalidJson(_)));
    }

    // --- per-run gateway block (PR E, E3 namespace-level scope) ---

    #[test]
    fn parses_full_gateway_block_with_integrations() {
        let plan = parse(
            r#"{
                "run_id": "run-gw",
                "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
                "gateway": {
                    "url": "https://cloud.test/v1/cloud/integration-gateway/mcp",
                    "authorization": "Bearer per-run-secret",
                    "ping_url": "https://cloud.test/v1/cloud/workflows/runs/run-gw/ping",
                    "integrations": ["issues", "slack"]
                },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "agent.prompt", "prompt": "hi" } ]
            }"#,
        )
        .expect("parse gateway plan");
        let gateway = plan.gateway.as_ref().expect("gateway present");
        assert_eq!(gateway.url, "https://cloud.test/v1/cloud/integration-gateway/mcp");
        assert_eq!(gateway.authorization, "Bearer per-run-secret");
        assert_eq!(
            gateway.ping_url,
            "https://cloud.test/v1/cloud/workflows/runs/run-gw/ping"
        );
        assert_eq!(gateway.integrations, vec!["issues", "slack"]);
    }

    #[test]
    fn gateway_integrations_default_to_empty() {
        // §3.7/L16: a token is minted for every run, so a gateway block can be
        // present with no integration scopes at all (empty `integrations`).
        let plan = parse(
            r#"{
                "run_id": "run-gw-empty",
                "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
                "gateway": {
                    "url": "https://cloud.test/mcp",
                    "authorization": "Bearer t",
                    "ping_url": "https://cloud.test/ping"
                },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "shell.run", "command": "x" } ]
            }"#,
        )
        .expect("parse gateway plan without integrations");
        let gateway = plan.gateway.as_ref().expect("gateway present");
        assert!(gateway.integrations.is_empty());
    }

    #[test]
    fn plans_without_gateway_still_parse() {
        // A token is minted for every run under L16, but a gateway-less plan
        // must still parse (the block is `serde(default)`).
        let plan = parse(
            r#"{
                "run_id": "run-nogw",
                "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
                "steps": [ { "key": "0.-.0", "slot": "main", "kind": "agent.prompt", "prompt": "hi" } ]
            }"#,
        )
        .expect("parse plan without gateway");
        assert!(plan.gateway.is_none());
    }
}
