//! Strict, typed deserialization of the server-produced resolved plan payload.
//!
//! The plan is self-contained (the actor never fetches a definition). `{{args.*}}`
//! are already interpolated server-side; the step strings that survive here may
//! still contain `{{steps[N].output.Y}}` placeholders, which
//! [`super::templates`] late-binds against completed step outputs at execution
//! time. Deserialization is strict: an unknown step `kind` is rejected.

use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("resolved plan payload is not valid JSON: {0}")]
    InvalidJson(String),
    #[error("resolved plan payload is malformed: {0}")]
    Malformed(String),
}

/// The fully-resolved plan the actor executes.
#[derive(Debug, Clone, Deserialize)]
pub struct ResolvedPlan {
    pub run_id: String,
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
    pub setup: PlanSetup,
    /// Server-interpolated arg values, kept verbatim for the run record.
    #[serde(default)]
    pub args: serde_json::Value,
    pub steps: Vec<PlanStep>,
}

impl ResolvedPlan {
    pub fn step(&self, index: usize) -> Option<&PlanStep> {
        self.steps.get(index)
    }

    pub fn step_count(&self) -> usize {
        self.steps.len()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlanSetup {
    pub harness: String,
    #[serde(default)]
    pub model: Option<String>,
    pub session_binding: SessionBinding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionBinding {
    /// New session, visible in the run view (deep-linkable).
    Fresh,
    /// New session with no UI focus.
    Headless,
}

/// One plan step: its kind-specific payload plus the per-step failure policy.
#[derive(Debug, Clone, Deserialize)]
pub struct PlanStep {
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
    #[serde(rename = "shell.run")]
    ShellRun(ShellRunStep),
    #[serde(rename = "scm.open_pr")]
    ScmOpenPr(ScmOpenPrStep),
    #[serde(rename = "notify")]
    Notify(NotifyStep),
    #[serde(rename = "human.approval")]
    HumanApproval(HumanApprovalStep),
}

impl StepKind {
    pub fn slug(&self) -> &'static str {
        match self {
            StepKind::AgentConfig(_) => "agent.config",
            StepKind::AgentPrompt(_) => "agent.prompt",
            StepKind::ShellRun(_) => "shell.run",
            StepKind::ScmOpenPr(_) => "scm.open_pr",
            StepKind::Notify(_) => "notify",
            StepKind::HumanApproval(_) => "human.approval",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentPromptStep {
    pub prompt: String,
    #[serde(default)]
    pub goal: Option<GoalSpec>,
}

/// Sets the active agent harness and/or model for the steps below it. At least
/// one of `harness` / `model` is present (enforced server-side); it executes
/// instantly and never opens a session of its own.
#[derive(Debug, Clone, Deserialize)]
pub struct AgentConfigStep {
    #[serde(default)]
    pub harness: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct NotifyStep {
    pub channel: NotifyChannel,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifyChannel {
    InApp,
    Slack,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HumanApprovalStep {
    pub message: String,
    #[serde(default)]
    pub on_timeout: OnTimeout,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnTimeout {
    #[default]
    Fail,
    Continue,
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
            "workflow_id": "wf-1",
            "workflow_version_id": "wfv-1",
            "version_n": 2,
            "trigger_kind": "manual",
            "target_mode": "local",
            "setup": { "harness": "claude", "model": "sonnet", "session_binding": "fresh" },
            "args": { "ticket": "ABC-1" },
            "steps": [
                { "kind": "agent.config", "harness": "codex", "model": "opus" },
                {
                    "kind": "agent.prompt",
                    "prompt": "fix {{steps[0].output.thing}}",
                    "goal": {
                        "objective": "make CI green",
                        "max_turns": 25,
                        "max_wall_secs": 5400,
                        "on_blocked": "pause_for_approval",
                        "verify": { "shell": "make test", "expect_exit": 0 }
                    },
                    "on_fail": { "kind": "retry", "n": 2 }
                },
                { "kind": "shell.run", "command": "cargo build", "timeout_secs": 600, "output_name": "build" },
                { "kind": "scm.open_pr", "title": "Fix", "body": "done", "draft": true },
                { "kind": "notify", "channel": "slack", "message": "shipped" },
                { "kind": "human.approval", "message": "ok?", "on_timeout": "continue", "timeout_secs": 3600 }
            ]
        }"#
    }

    #[test]
    fn parses_a_full_plan_with_all_step_kinds() {
        let plan = parse(full_plan_json()).expect("parse full plan");
        assert_eq!(plan.run_id, "run-1");
        assert_eq!(plan.version_n, Some(2));
        assert_eq!(plan.setup.harness, "claude");
        assert_eq!(plan.setup.session_binding, SessionBinding::Fresh);
        assert_eq!(plan.step_count(), 6);

        let StepKind::AgentConfig(config) = &plan.steps[0].kind else {
            panic!("expected agent.config");
        };
        assert_eq!(config.harness.as_deref(), Some("codex"));
        assert_eq!(config.model.as_deref(), Some("opus"));
        assert_eq!(plan.steps[0].kind_slug(), "agent.config");
        // agent.config with no explicit on_fail defaults to stop.
        assert_eq!(plan.steps[0].on_fail.kind, OnFailKind::Stop);

        let StepKind::AgentPrompt(agent) = &plan.steps[1].kind else {
            panic!("expected agent.prompt");
        };
        let goal = agent.goal.as_ref().expect("goal");
        assert_eq!(goal.max_turns, 25);
        assert_eq!(goal.on_blocked, OnBlocked::PauseForApproval);
        assert_eq!(goal.verify.as_ref().expect("verify").expect_exit, 0);
        assert_eq!(plan.steps[1].on_fail.kind, OnFailKind::Retry);
        assert_eq!(plan.steps[1].on_fail.n, 2);

        let StepKind::ShellRun(shell) = &plan.steps[2].kind else {
            panic!("expected shell.run");
        };
        assert_eq!(shell.command, "cargo build");
        assert_eq!(shell.timeout_secs, Some(600));
        // stop is the default failure policy
        assert_eq!(plan.steps[2].on_fail.kind, OnFailKind::Stop);

        let StepKind::Notify(notify) = &plan.steps[4].kind else {
            panic!("expected notify");
        };
        assert_eq!(notify.channel, NotifyChannel::Slack);

        let StepKind::HumanApproval(approval) = &plan.steps[5].kind else {
            panic!("expected human.approval");
        };
        assert_eq!(approval.on_timeout, OnTimeout::Continue);
    }

    #[test]
    fn defaults_apply_for_minimal_steps() {
        let plan = parse(
            r#"{
                "run_id": "run-2",
                "setup": { "harness": "codex", "session_binding": "headless" },
                "steps": [ { "kind": "agent.prompt", "prompt": "hi" } ]
            }"#,
        )
        .expect("parse minimal plan");
        assert_eq!(plan.setup.session_binding, SessionBinding::Headless);
        assert!(plan.setup.model.is_none());
        let StepKind::AgentPrompt(agent) = &plan.steps[0].kind else {
            panic!("expected agent.prompt");
        };
        assert!(agent.goal.is_none());
        assert_eq!(plan.steps[0].on_fail.kind, OnFailKind::Stop);
    }

    #[test]
    fn parses_agent_config_with_partial_fields() {
        let plan = parse(
            r#"{
                "run_id": "run-cfg",
                "setup": { "harness": "claude", "session_binding": "fresh" },
                "steps": [
                    { "kind": "agent.config", "harness": "codex" },
                    { "kind": "agent.config", "model": "opus" }
                ]
            }"#,
        )
        .expect("parse agent.config plan");
        let StepKind::AgentConfig(harness_only) = &plan.steps[0].kind else {
            panic!("expected agent.config");
        };
        assert_eq!(harness_only.harness.as_deref(), Some("codex"));
        assert!(harness_only.model.is_none());
        let StepKind::AgentConfig(model_only) = &plan.steps[1].kind else {
            panic!("expected agent.config");
        };
        assert!(model_only.harness.is_none());
        assert_eq!(model_only.model.as_deref(), Some("opus"));
    }

    #[test]
    fn rejects_an_unknown_step_kind() {
        let error = parse(
            r#"{
                "run_id": "run-3",
                "setup": { "harness": "claude", "session_binding": "fresh" },
                "steps": [ { "kind": "tool.call", "tool": "x" } ]
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
                "setup": { "harness": "claude", "session_binding": "fresh" },
                "steps": [ { "kind": "agent.prompt" } ]
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
}
