//! Deterministic process steps: `shell.run`, `scm.open_pr`, and `notify`. These
//! shell out in the run's workspace, capturing a bounded output *tail* + exit
//! code, and map failures to typed step outcomes. The broker contract requires
//! descendant-group kill and quiescence on timeout/cancel.

use std::path::Path;
use std::time::Duration;

use serde_json::json;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{ScmOpenPrStep, ShellRunStep};
use crate::live::workflows::isolation::{
    run_workflow_command, WorkflowCommandRequest, WorkflowIsolationBroker,
    WorkflowIsolationCapability, WorkflowIsolationError, WorkflowProcessIdentity,
    WORKFLOW_COMMAND_COMBINED_LIMIT, WORKFLOW_COMMAND_MEMORY_LIMIT, WORKFLOW_COMMAND_PROCESS_LIMIT,
    WORKFLOW_COMMAND_STDERR_LIMIT, WORKFLOW_COMMAND_STDOUT_LIMIT,
};
use crate::process_env::complete_workflow_operation_env;

/// Bytes of combined output tail retained per shell step.
const MAX_OUTPUT_TAIL: usize = 8 * 1024;
const SCM_TIMEOUT: Duration = Duration::from_secs(180);

struct ShellResult {
    exit_code: Option<i32>,
    tail: String,
    timed_out: bool,
    spawn_error: Option<String>,
}

/// Run a `sh -lc` command in the workspace dir, capturing a bounded combined
/// output tail + exit code, killing the child on timeout.
async fn run_shell(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: WorkflowProcessIdentity,
    workspace_path: &Path,
    command: &str,
    env: &[(String, String)],
    timeout: Duration,
) -> ShellResult {
    run_program(
        broker,
        capability,
        identity,
        workspace_path,
        Path::new("/bin/sh"),
        vec!["-lc".to_string(), command.to_string()],
        env,
        timeout,
    )
    .await
}

async fn run_program(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: WorkflowProcessIdentity,
    workspace_path: &Path,
    program: &Path,
    args: Vec<String>,
    env: &[(String, String)],
    timeout: Duration,
) -> ShellResult {
    let request = WorkflowCommandRequest {
        identity,
        program: program.to_path_buf(),
        args,
        cwd: workspace_path.to_path_buf(),
        env: complete_workflow_operation_env(env.iter().cloned()),
        timeout,
        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
    };
    match run_workflow_command(broker, capability, request).await {
        Ok(output) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            ShellResult {
                exit_code: output.exit_code,
                tail: tail_of(&combined),
                timed_out: false,
                spawn_error: None,
            }
        }
        Err(WorkflowIsolationError::TimedOut) => ShellResult {
            exit_code: None,
            tail: String::new(),
            timed_out: true,
            spawn_error: None,
        },
        Err(error) => ShellResult {
            exit_code: None,
            tail: String::new(),
            timed_out: false,
            spawn_error: Some(error.to_string()),
        },
    }
}

/// Keep the last `MAX_OUTPUT_TAIL` bytes of `text`, on a char boundary.
fn tail_of(text: &str) -> String {
    if text.len() <= MAX_OUTPUT_TAIL {
        return text.to_string();
    }
    let mut start = text.len() - MAX_OUTPUT_TAIL;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
}

/// A standalone verify shell (used by the `agent.goal` verify gate). Returns the
/// exit code (`None` if it never ran) and the output tail.
pub async fn run_verify_shell(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: WorkflowProcessIdentity,
    workspace_path: &Path,
    env: &[(String, String)],
    shell: &str,
    timeout: Duration,
) -> (Option<i32>, String) {
    let result = run_shell(
        broker,
        capability,
        identity,
        workspace_path,
        shell,
        env,
        timeout,
    )
    .await;
    (result.exit_code, result.tail)
}

/// Execute a `shell.run` step.
pub async fn run_shell_step(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: WorkflowProcessIdentity,
    workspace_path: &Path,
    env: &[(String, String)],
    step: &ShellRunStep,
) -> StepOutcome {
    let timeout = Duration::from_secs(step.timeout_secs.unwrap_or(600));
    let result = run_shell(
        broker,
        capability,
        identity,
        workspace_path,
        &step.command,
        env,
        timeout,
    )
    .await;
    let mut output = json!({ "output_tail": result.tail });
    if let Some(name) = &step.output_name {
        output["output_name"] = json!(name);
    }
    if let Some(error) = result.spawn_error {
        output["exit_code"] = json!(-1);
        return StepOutcome::Failed {
            code: "spawn_failed".to_string(),
            message: Some(error),
            output: Some(output),
        };
    }
    if result.timed_out {
        return StepOutcome::Failed {
            code: "timeout".to_string(),
            message: Some(format!("command exceeded {}s", timeout.as_secs())),
            output: Some(output),
        };
    }
    let exit_code = result.exit_code.unwrap_or(-1);
    output["exit_code"] = json!(exit_code);
    if exit_code == 0 {
        StepOutcome::Completed { output }
    } else {
        StepOutcome::Failed {
            code: "nonzero_exit".to_string(),
            message: Some(format!("command exited {exit_code}")),
            output: Some(output),
        }
    }
}

/// Execute an `scm.open_pr` step: push the current branch, then `gh pr create`,
/// parsing the PR URL from stdout. Missing/unauthenticated `gh` is typed as
/// `scm_unavailable` (a cloud-lane concern deferred to W4/W7).
pub async fn open_pr_step(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: WorkflowProcessIdentity,
    workspace_path: &Path,
    env: &[(String, String)],
    step: &ScmOpenPrStep,
) -> StepOutcome {
    let push = run_program(
        broker,
        capability,
        identity.clone(),
        workspace_path,
        Path::new("git"),
        vec![
            "push".to_string(),
            "-u".to_string(),
            "origin".to_string(),
            "HEAD".to_string(),
        ],
        env,
        SCM_TIMEOUT,
    )
    .await;
    if push.timed_out {
        return scm_failed("push timed out", &push.tail);
    }
    if push.exit_code != Some(0) {
        return scm_failed("git push failed", &push.tail);
    }

    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--title".to_string(),
        step.title.clone(),
        "--body".to_string(),
        step.body.clone().unwrap_or_default(),
    ];
    if let Some(base) = &step.base {
        args.push("--base".to_string());
        args.push(base.clone());
    }
    if step.draft {
        args.push("--draft".to_string());
    }

    let create = run_program(
        broker,
        capability,
        identity,
        workspace_path,
        Path::new("gh"),
        args,
        env,
        SCM_TIMEOUT,
    )
    .await;
    if create.timed_out {
        return scm_failed("gh pr create timed out", &create.tail);
    }
    if create.exit_code != Some(0) {
        if is_gh_unavailable(&create.tail) {
            return StepOutcome::Failed {
                code: "scm_unavailable".to_string(),
                message: Some(create.tail),
                output: None,
            };
        }
        return scm_failed("gh pr create failed", &create.tail);
    }
    match parse_pr_url(&create.tail) {
        Some(url) => StepOutcome::Completed {
            output: json!({ "pr_url": url }),
        },
        None => scm_failed("could not parse PR url from gh output", &create.tail),
    }
}

fn scm_failed(reason: &str, tail: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: "scm_failed".to_string(),
        message: Some(format!("{reason}: {}", tail_of(tail))),
        output: None,
    }
}

fn is_gh_unavailable(tail: &str) -> bool {
    let low = tail.to_ascii_lowercase();
    low.contains("command not found")
        || low.contains("not installed")
        || low.contains("gh: not found")
        || low.contains("auth")
        || low.contains("login")
        || low.contains("gh auth")
}

/// Extract the last `https://` token from gh output (the PR URL gh prints).
fn parse_pr_url(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .rfind(|token| token.starts_with("https://"))
        .map(|token| token.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::workflows::isolation::{
        test_isolation_capability, BrokeredWorkflowAgentProcess, TrustedLocalGatewayBinding,
        WorkflowAgentLaunchRequest, WorkflowCommandOutput, WorkflowDeliveryIdentity,
        WorkflowExecutableAuthorization, WorkflowIsolationAttestation, WorkflowIsolationPolicy,
        WorkflowProcessGroup,
    };
    use std::sync::Mutex;

    #[derive(Default)]
    struct CapturingBroker {
        commands: Mutex<Vec<WorkflowCommandRequest>>,
    }

    #[async_trait::async_trait]
    impl WorkflowIsolationBroker for CapturingBroker {
        fn attest(
            &self,
            _identity: &WorkflowDeliveryIdentity,
            _policy: &WorkflowIsolationPolicy,
        ) -> Result<WorkflowIsolationAttestation, WorkflowIsolationError> {
            unreachable!()
        }

        fn spawn_agent(
            &self,
            _capability: &WorkflowIsolationCapability,
            _request: WorkflowAgentLaunchRequest,
        ) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError> {
            unreachable!()
        }

        fn authorize_executable(
            &self,
            capability: &WorkflowIsolationCapability,
            identity: &WorkflowProcessIdentity,
            requested_program: &Path,
        ) -> Result<WorkflowExecutableAuthorization, WorkflowIsolationError> {
            let canonical_program = if requested_program.is_absolute() {
                requested_program.to_path_buf()
            } else {
                Path::new("/usr/bin").join(requested_program)
            };
            WorkflowExecutableAuthorization::try_new(
                identity.clone(),
                requested_program.to_path_buf(),
                canonical_program,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                capability.identity().execution_generation(),
                capability.broker_generation(),
            )
        }

        fn bind_local_gateway(
            &self,
            _capability: &WorkflowIsolationCapability,
            _identity: &WorkflowProcessIdentity,
        ) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError> {
            unreachable!()
        }

        async fn run_command(
            &self,
            _capability: &WorkflowIsolationCapability,
            request: WorkflowCommandRequest,
        ) -> Result<WorkflowCommandOutput, WorkflowIsolationError> {
            self.commands.lock().unwrap().push(request);
            Ok(WorkflowCommandOutput {
                exit_code: Some(0),
                stdout: b"ok".to_vec(),
                stderr: Vec::new(),
            })
        }

        async fn cancel_process_group(
            &self,
            _capability: &WorkflowIsolationCapability,
            _process_group: &WorkflowProcessGroup,
        ) -> Result<(), WorkflowIsolationError> {
            unreachable!()
        }

        async fn cancel_run(
            &self,
            _capability: &WorkflowIsolationCapability,
        ) -> Result<(), WorkflowIsolationError> {
            unreachable!()
        }

        fn notify_step_transition(
            &self,
            _capability: &WorkflowIsolationCapability,
        ) -> Result<(), WorkflowIsolationError> {
            unreachable!()
        }
    }

    fn delivery_identity() -> WorkflowDeliveryIdentity {
        WorkflowDeliveryIdentity::try_new(
            "run-1",
            Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
            Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
            Some(1),
        )
        .expect("identity")
    }

    #[test]
    fn parses_the_last_https_url() {
        let output = "Creating pull request\nhttps://github.com/o/r/pull/7\n";
        assert_eq!(
            parse_pr_url(output).as_deref(),
            Some("https://github.com/o/r/pull/7")
        );
    }

    #[test]
    fn detects_gh_unavailable() {
        assert!(is_gh_unavailable("gh: command not found"));
        assert!(is_gh_unavailable(
            "You are not logged into any GitHub hosts. Run gh auth login"
        ));
        assert!(!is_gh_unavailable("a merge conflict occurred"));
    }

    #[test]
    fn tail_keeps_the_end() {
        let text = "x".repeat(MAX_OUTPUT_TAIL + 100);
        assert_eq!(tail_of(&text).len(), MAX_OUTPUT_TAIL);
    }

    #[tokio::test]
    async fn workflow_shell_reaches_only_broker_with_contained_environment() {
        let broker = CapturingBroker::default();
        let capability = test_isolation_capability(delivery_identity());
        let identity = WorkflowProcessIdentity::try_step(
            delivery_identity(),
            "root::node::-::step",
            1,
            crate::live::workflows::isolation::WorkflowCommandKind::Shell,
            Path::new("/tmp"),
        )
        .expect("step identity");
        let step = ShellRunStep {
            command: "printf ok".to_string(),
            timeout_secs: Some(5),
            output_name: None,
            replay_key: None,
        };
        let outcome = run_shell_step(
            &broker,
            &capability,
            identity,
            Path::new("/tmp"),
            &[
                ("PATH".to_string(), "/usr/bin".to_string()),
                (
                    "ANYHARNESS_SECRET_CANARY".to_string(),
                    "must-not-escape".to_string(),
                ),
                (
                    "PROLIFERATE_PRIVATE_CALLBACK_URL".to_string(),
                    "https://private.invalid".to_string(),
                ),
                (
                    "ANTHROPIC_API_KEY".to_string(),
                    "anthropic-canary".to_string(),
                ),
                ("OPENAI_API_KEY".to_string(), "openai-canary".to_string()),
                ("GH_TOKEN".to_string(), "github-canary".to_string()),
                (
                    "AWS_SECRET_ACCESS_KEY".to_string(),
                    "aws-canary".to_string(),
                ),
                ("USER_DEFINED_SECRET".to_string(), "user-canary".to_string()),
            ],
            &step,
        )
        .await;
        assert!(matches!(outcome, StepOutcome::Completed { .. }));
        let commands = broker.commands.lock().unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].program, Path::new("/bin/sh"));
        assert!(commands[0]
            .env
            .iter()
            .any(|(key, value)| key == "PATH" && value == "/usr/bin:/bin"));
        for secret in [
            "ANYHARNESS_SECRET_CANARY",
            "PROLIFERATE_PRIVATE_CALLBACK_URL",
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GH_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "USER_DEFINED_SECRET",
        ] {
            assert!(commands[0].env.iter().all(|(key, _)| key != secret));
        }
    }

    #[tokio::test]
    async fn scm_open_pr_is_parked_before_any_broker_effect() {
        let broker = CapturingBroker::default();
        let capability = test_isolation_capability(delivery_identity());
        let identity = WorkflowProcessIdentity::try_step(
            delivery_identity(),
            "root::node::-::scm",
            1,
            crate::live::workflows::isolation::WorkflowCommandKind::Scm,
            "/tmp",
        )
        .expect("identity");
        let step = ScmOpenPrStep {
            base: Some("main".to_string()),
            title: "title; not shell".to_string(),
            body: Some("body $(not-shell)".to_string()),
            draft: true,
        };
        let outcome = open_pr_step(
            &broker,
            &capability,
            identity,
            Path::new("/tmp"),
            &[],
            &step,
        )
        .await;
        assert!(matches!(outcome, StepOutcome::Failed { .. }));
        let commands = broker.commands.lock().unwrap();
        assert!(commands.is_empty());
    }
}
