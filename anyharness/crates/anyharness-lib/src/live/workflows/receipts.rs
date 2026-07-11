//! The `required_invocation` gate (C14, arch §7.6): checks whether a turn
//! invoked the plan-declared provider+tool, and drives the re-prompt/exhaust
//! loop when it did not. Moved verbatim out of `executor.rs` (WS0B-R); WS5c
//! replaces the native-tool-name matching here with a structured receipt.

use serde_json::json;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::RequiredInvocation;

/// The `required_invocation` gate (C14, arch §7.6) re-prompts this many times
/// when the required provider+tool was not invoked within the turn before
/// failing `invocation_missing`.
pub(super) const MAX_GATE_ATTEMPTS: u32 = 3;

/// Was the required provider+tool invoked among the turn's observed tool names?
pub(super) fn invocation_present(invoked_tools: &[String], required: &RequiredInvocation) -> bool {
    invoked_tools
        .iter()
        .any(|name| invocation_matches(name, &required.provider, &required.tool))
}

/// Does a native tool name identify the given gateway provider+tool? The gateway
/// exposes MCP tools as `mcp__<provider>__<tool>`; we also accept the bare
/// `<provider>__<tool>` and `<provider>.<tool>` spellings different harnesses
/// surface, matched case-insensitively.
fn invocation_matches(native_tool_name: &str, provider: &str, tool: &str) -> bool {
    let name = native_tool_name.to_ascii_lowercase();
    let provider = provider.to_ascii_lowercase();
    let tool = tool.to_ascii_lowercase();
    let candidates = [
        format!("mcp__{provider}__{tool}"),
        format!("{provider}__{tool}"),
        format!("{provider}.{tool}"),
    ];
    candidates.iter().any(|candidate| name == *candidate)
        // Tolerate a provider-prefixed name whose suffix is the tool (e.g. a
        // `mcp__sentry__` prefix followed by the tool with extra qualifiers).
        || (name.contains(&provider) && name.ends_with(&tool))
}

/// The re-ask sent when the required invocation was not observed.
fn gate_corrective_prompt(original: &str, required: &RequiredInvocation) -> String {
    format!(
        "{original}\n\nYou did not call the required tool `{}` from `{}`. You MUST invoke that \
         tool before finishing.",
        required.tool, required.provider
    )
}

/// The C14 gate loop's attempt-budget + exhaustion control flow, decoupled from
/// live I/O: `attempt(i, prompt)` performs one turn (send + await + collect
/// invoked tool names) and returns `Ok((turn_id, invoked_tools))`, or `Err` on a
/// hard failure (session closed / timeout / send failed) that ends the loop
/// immediately. Colocated (rather than folded into `run_prompt`) so the
/// attempt-count + exhaustion decision can be driven directly by tests without
/// a live session.
pub(super) async fn run_gate_loop<Attempt, Fut>(
    attempts: u32,
    original_prompt: &str,
    required: &RequiredInvocation,
    session_id: &str,
    mut attempt: Attempt,
) -> StepOutcome
where
    Attempt: FnMut(u32, String) -> Fut,
    Fut: std::future::Future<Output = Result<(Option<String>, Vec<String>), StepOutcome>>,
{
    let mut prompt = original_prompt.to_string();
    for i in 0..attempts {
        let (turn_id, invoked_tools) = match attempt(i, prompt.clone()).await {
            Ok(v) => v,
            Err(outcome) => return outcome,
        };
        if invocation_present(&invoked_tools, required) {
            return StepOutcome::Completed {
                output: json!({
                    "turn_id": turn_id,
                    "session_id": session_id,
                    "required_invocation": { "provider": required.provider, "tool": required.tool },
                }),
            };
        }
        // Missing invocation: re-prompt with the concrete requirement, still
        // counting against the gate budget.
        if i + 1 < attempts {
            prompt = gate_corrective_prompt(original_prompt, required);
        }
    }
    gate_exhausted_outcome(attempts, required, session_id)
}

/// The terminal outcome when the C14 gate never observed the required
/// invocation within the attempt budget.
fn gate_exhausted_outcome(
    attempts: u32,
    required: &RequiredInvocation,
    session_id: &str,
) -> StepOutcome {
    StepOutcome::Failed {
        code: "invocation_missing".to_string(),
        message: Some(format!(
            "required invocation {}::{} was not observed after {} attempts",
            required.provider, required.tool, attempts
        )),
        output: Some(json!({ "session_id": session_id })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn required(provider: &str, tool: &str) -> RequiredInvocation {
        RequiredInvocation {
            provider: provider.to_string(),
            tool: tool.to_string(),
        }
    }

    #[test]
    fn invocation_matches_mcp_and_bare_spellings() {
        assert!(invocation_matches("mcp__linear__update_status", "linear", "update_status"));
        assert!(invocation_matches("linear__update_status", "linear", "update_status"));
        assert!(invocation_matches("linear.update_status", "linear", "update_status"));
        // Case-insensitive.
        assert!(invocation_matches("MCP__Linear__Update_Status", "linear", "update_status"));
        // Wrong tool / provider does not match.
        assert!(!invocation_matches("mcp__linear__create_issue", "linear", "update_status"));
        assert!(!invocation_matches("mcp__sentry__update_status", "linear", "update_status"));
        assert!(!invocation_matches("read_file", "linear", "update_status"));
    }

    #[test]
    fn invocation_present_scans_all_observed_tools() {
        let tools = vec!["read_file".to_string(), "mcp__linear__update_status".to_string()];
        assert!(invocation_present(&tools, &required("linear", "update_status")));
        assert!(!invocation_present(&tools, &required("slack", "post_message")));
        assert!(!invocation_present(&[], &required("linear", "update_status")));
    }

    #[tokio::test]
    async fn gate_loop_exhausts_invocation_missing_when_tool_never_called() {
        let required = required("linear", "update_status");
        let attempts_seen = std::sync::atomic::AtomicU32::new(0);
        let outcome = run_gate_loop(
            MAX_GATE_ATTEMPTS,
            "do the thing",
            &required,
            "sess_1",
            |attempt, _prompt| {
                assert_eq!(attempt, attempts_seen.load(std::sync::atomic::Ordering::SeqCst));
                attempts_seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                // The tool is never invoked across any attempt.
                async move { Ok((Some(format!("turn-{attempt}")), Vec::<String>::new())) }
            },
        )
        .await;

        assert_eq!(
            attempts_seen.load(std::sync::atomic::Ordering::SeqCst),
            MAX_GATE_ATTEMPTS,
            "the loop must exhaust the full attempt budget before failing"
        );
        match outcome {
            StepOutcome::Failed {
                code,
                message,
                output,
            } => {
                assert_eq!(code, "invocation_missing");
                let message = message.unwrap();
                assert!(message.contains("linear::update_status"));
                assert!(message.contains(&MAX_GATE_ATTEMPTS.to_string()));
                assert_eq!(output.unwrap()["session_id"], "sess_1");
            }
            other => panic!("expected Failed(invocation_missing), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn gate_loop_re_prompts_with_corrective_text_between_attempts() {
        let required = required("linear", "update_status");
        let prompts_seen = std::sync::Mutex::new(Vec::<String>::new());
        let _ = run_gate_loop(
            MAX_GATE_ATTEMPTS,
            "original prompt",
            &required,
            "sess_1",
            |_attempt, prompt| {
                prompts_seen.lock().unwrap().push(prompt);
                async { Ok((None, Vec::<String>::new())) }
            },
        )
        .await;
        let prompts = prompts_seen.into_inner().unwrap();
        assert_eq!(prompts.len() as u32, MAX_GATE_ATTEMPTS);
        // Attempt 0 gets the original prompt verbatim...
        assert_eq!(prompts[0], "original prompt");
        // ...every subsequent attempt gets the corrective re-prompt naming the
        // missing tool, and does NOT regress back to the original text.
        for prompt in &prompts[1..] {
            assert_ne!(prompt, "original prompt");
            assert!(prompt.contains("update_status"));
            assert!(prompt.contains("linear"));
        }
    }

    #[tokio::test]
    async fn gate_loop_completes_when_invocation_observed() {
        let required = required("linear", "update_status");
        let outcome = run_gate_loop(
            MAX_GATE_ATTEMPTS,
            "do the thing",
            &required,
            "sess_1",
            |_attempt, _prompt| async {
                Ok((
                    Some("turn-1".to_string()),
                    vec!["mcp__linear__update_status".to_string()],
                ))
            },
        )
        .await;
        match outcome {
            StepOutcome::Completed { output } => {
                assert_eq!(output["required_invocation"]["provider"], "linear");
                assert_eq!(output["required_invocation"]["tool"], "update_status");
            }
            other => panic!("expected Completed, got {other:?}"),
        }
    }
}
