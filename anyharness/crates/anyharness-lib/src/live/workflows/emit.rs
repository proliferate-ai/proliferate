//! `agent.emit` (§7.3 + §7.4 file-drop): prompt the agent to write a JSON
//! object to a run/step-scoped file, await the turn, then read + validate
//! against the (optional) schema, re-prompting with concrete errors on failure.
//! Moved verbatim out of `executor.rs` (WS0B-R).

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::AgentEmitStep;

use super::turn::{await_turn_ended, InjectionMeta, TurnWait, TURN_BACKSTOP};
use super::executor::{failed, WorkflowStepExecutorImpl};

/// Bytes of the emit file retained in the failure output for debugging.
const EMIT_RAW_TAIL: usize = 2 * 1024;

impl WorkflowStepExecutorImpl {
    /// `agent.emit` (§7.3 + §7.4 file-drop): prompt the agent to write a JSON
    /// object to a run/step-scoped file, await the turn, then read + validate
    /// against the (optional) schema. Invalid or missing → re-prompt with the
    /// concrete errors, up to the plan's `max_attempts` (C12: sourced from the
    /// plan, no longer a hardcoded constant); the validated object becomes the
    /// step's entire output. Exhaustion fails `emit_invalid`.
    pub(super) async fn run_emit(
        &self,
        slot: &str,
        step: &AgentEmitStep,
        step_index: usize,
        meta: &InjectionMeta,
        scope: &str,
    ) -> StepOutcome {
        let session_id = match self.ensure_session(slot, scope).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        let (workspace_path, _env) = match self.workspace_ctx(scope).await {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        let emit_path = emit_file_path(&workspace_path, &self.run_id, step_index);
        // Ensure the drop directory exists and clear any stale file so a prior
        // attempt/run can't be read as this attempt's output.
        if let Some(parent) = emit_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::remove_file(&emit_path);

        let initial_prompt = format!("{}\n\n{}", step.prompt, emit_instruction(&emit_path));
        // C12: `max_attempts` is sourced from the plan (never hardcoded); the
        // attempt-budget + exhaustion decision lives in `run_emit_loop` so it
        // can be driven directly by tests without a live session.
        let max_attempts = step.max_attempts.max(1);

        run_emit_loop(max_attempts, initial_prompt, |_attempt, prompt| {
            let session_id = session_id.clone();
            let emit_path = emit_path.clone();
            async move {
                // Subscribe BEFORE prompting so a fast TurnEnded is never missed.
                let mut events = self.subscribe(&session_id).await?;
                let turn_id = self.send_prompt(&session_id, &prompt, meta).await?;
                match await_turn_ended(&mut events, turn_id.as_deref(), TURN_BACKSTOP).await {
                    TurnWait::Ended => {}
                    TurnWait::SessionClosed => return Err(failed("session_closed")),
                    TurnWait::Timeout => return Err(failed("turn_timeout")),
                }
                match read_and_validate_emit(&emit_path, step.output_schema.as_ref()) {
                    EmitCheck::Valid(value) => {
                        let _ = std::fs::remove_file(&emit_path);
                        Ok(EmitAttempt::Valid(value))
                    }
                    EmitCheck::Invalid { errors, raw_tail } => Ok(EmitAttempt::Invalid {
                        next_prompt: emit_corrective_prompt(&emit_path, &errors),
                        errors,
                        raw_tail,
                    }),
                }
            }
        })
        .await
    }
}

/// The file an `agent.emit` step's agent must drop its JSON object at:
/// `<workspace>/.proliferate/emit-<run_id>-<step_index>.json`.
fn emit_file_path(workspace_path: &Path, run_id: &str, step_index: usize) -> PathBuf {
    workspace_path
        .join(".proliferate")
        .join(format!("emit-{run_id}-{step_index}.json"))
}

/// The §7.4 file-drop instruction appended to the emit prompt.
fn emit_instruction(path: &Path) -> String {
    format!(
        "When you are done, write ONLY the JSON object (no prose, no code fences) to the file \
         `{}`. Overwrite the file if it already exists.",
        path.display()
    )
}

/// The corrective message re-prompted after an invalid or missing emit, carrying
/// the concrete validation errors so the agent can fix them.
fn emit_corrective_prompt(path: &Path, errors: &[String]) -> String {
    format!(
        "The JSON object you wrote did not satisfy the required schema:\n{}\n\nPlease write ONLY a \
         corrected JSON object (no prose, no code fences) to `{}`, overwriting it.",
        errors.join("\n"),
        path.display()
    )
}

/// The terminal outcome when `agent.emit` never produced a schema-valid object.
fn emit_exhausted_outcome(
    max_attempts: u32,
    errors: Vec<String>,
    raw_tail: Option<String>,
) -> StepOutcome {
    StepOutcome::Failed {
        code: "emit_invalid".to_string(),
        message: Some(format!(
            "agent did not emit a schema-valid object after {max_attempts} attempts"
        )),
        output: Some(serde_json::json!({ "errors": errors, "raw_tail": raw_tail })),
    }
}

/// Outcome of one `agent.emit` attempt fed to [`run_emit_loop`].
enum EmitAttempt {
    Valid(Value),
    Invalid {
        /// The corrective prompt for the next attempt.
        next_prompt: String,
        errors: Vec<String>,
        raw_tail: Option<String>,
    },
}

/// The `agent.emit` attempt loop's control flow (C12), decoupled from live
/// I/O: `attempt(i, prompt)` performs one turn + reads/validates the emit
/// file, returning `Ok(EmitAttempt)`, or `Err` on a hard failure (session
/// closed / timeout / send failed) that ends the loop immediately.
/// `max_attempts` is always sourced from the plan step, never hardcoded.
/// Colocated so the attempt-budget + exhaustion decision can be driven
/// directly by tests without a live session.
async fn run_emit_loop<Attempt, Fut>(
    max_attempts: u32,
    initial_prompt: String,
    mut attempt: Attempt,
) -> StepOutcome
where
    Attempt: FnMut(u32, String) -> Fut,
    Fut: std::future::Future<Output = Result<EmitAttempt, StepOutcome>>,
{
    let mut prompt = initial_prompt;
    let mut last_errors: Vec<String> = Vec::new();
    let mut last_raw_tail: Option<String> = None;
    for i in 0..max_attempts {
        match attempt(i, prompt).await {
            Ok(EmitAttempt::Valid(value)) => return StepOutcome::Completed { output: value },
            Ok(EmitAttempt::Invalid {
                next_prompt,
                errors,
                raw_tail,
            }) => {
                prompt = next_prompt;
                last_errors = errors;
                last_raw_tail = raw_tail;
            }
            Err(outcome) => return outcome,
        }
    }
    emit_exhausted_outcome(max_attempts, last_errors, last_raw_tail)
}

/// Outcome of reading + schema-validating the emit file.
enum EmitCheck {
    Valid(Value),
    Invalid {
        errors: Vec<String>,
        /// Last ~2KB of the file, present only when the file existed.
        raw_tail: Option<String>,
    },
}

/// Read the emit file and validate it against `schema` (when one is present; a
/// schema-less emit accepts any valid JSON value). A missing file, unparseable
/// JSON, and schema-invalid content all map to `Invalid` with concrete,
/// agent-actionable error strings.
fn read_and_validate_emit(path: &Path, schema: Option<&Value>) -> EmitCheck {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(_) => {
            return EmitCheck::Invalid {
                errors: vec![format!("file not found at {}", path.display())],
                raw_tail: None,
            }
        }
    };
    let raw_tail = Some(emit_raw_tail(&contents));
    let value: Value = match serde_json::from_str(&contents) {
        Ok(value) => value,
        Err(error) => {
            return EmitCheck::Invalid {
                errors: vec![format!("emit file is not valid JSON: {error}")],
                raw_tail,
            }
        }
    };
    let errors = match schema {
        Some(schema) => validate_against_schema(&value, schema),
        None => Vec::new(),
    };
    if errors.is_empty() {
        EmitCheck::Valid(value)
    } else {
        EmitCheck::Invalid { errors, raw_tail }
    }
}

/// Collect human-readable schema-validation errors (empty = valid). A schema
/// that itself fails to compile surfaces as a single error rather than a panic.
fn validate_against_schema(value: &Value, schema: &Value) -> Vec<String> {
    match jsonschema::validator_for(schema) {
        Ok(validator) => validator
            .iter_errors(value)
            .map(|error| error.to_string())
            .collect(),
        Err(error) => vec![format!("invalid output_schema: {error}")],
    }
}

/// Keep the last `EMIT_RAW_TAIL` bytes of the file, on a char boundary.
fn emit_raw_tail(text: &str) -> String {
    if text.len() <= EMIT_RAW_TAIL {
        return text.to_string();
    }
    let mut start = text.len() - EMIT_RAW_TAIL;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::workflows::engine::StepOutcome;
    use serde_json::json;

    #[test]
    fn emit_missing_file_is_invalid() {
        let dir = std::env::temp_dir().join(format!("emit-test-{}", std::process::id()));
        let path = emit_file_path(&dir, "run-x", 7);
        match read_and_validate_emit(&path, None) {
            EmitCheck::Invalid { errors, raw_tail } => {
                assert!(errors[0].contains("file not found"));
                assert!(raw_tail.is_none());
            }
            EmitCheck::Valid(_) => panic!("missing file must be invalid"),
        }
    }

    #[test]
    fn emit_validates_against_schema() {
        let dir = std::env::temp_dir().join(format!("emit-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.json");
        std::fs::write(&path, r#"{"verdict": "ship"}"#).unwrap();
        let schema = json!({
            "type": "object",
            "required": ["verdict"],
            "properties": { "verdict": { "type": "string" } }
        });
        assert!(matches!(
            read_and_validate_emit(&path, Some(&schema)),
            EmitCheck::Valid(_)
        ));
        // A value that violates the schema is Invalid with concrete errors.
        std::fs::write(&path, r#"{"verdict": 42}"#).unwrap();
        match read_and_validate_emit(&path, Some(&schema)) {
            EmitCheck::Invalid { errors, .. } => assert!(!errors.is_empty()),
            EmitCheck::Valid(_) => panic!("schema violation must be invalid"),
        }
        // Schema-less emit accepts any valid JSON object.
        assert!(matches!(
            read_and_validate_emit(&path, None),
            EmitCheck::Valid(_)
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn emit_loop_exhausts_emit_invalid_using_the_plans_max_attempts() {
        // Deliberately NOT the hardcoded-3 default used elsewhere, to prove
        // max_attempts is plan-sourced (C12).
        let plan_max_attempts: u32 = 5;
        let attempts_seen = std::sync::atomic::AtomicU32::new(0);
        let outcome = run_emit_loop(
            plan_max_attempts,
            "emit the verdict".to_string(),
            |attempt, _prompt| {
                assert_eq!(attempt, attempts_seen.load(std::sync::atomic::Ordering::SeqCst));
                attempts_seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async move {
                    // Output never validates, across every attempt.
                    Ok(EmitAttempt::Invalid {
                        next_prompt: format!("fix it (attempt {attempt})"),
                        errors: vec!["missing required field verdict".to_string()],
                        raw_tail: Some("{}".to_string()),
                    })
                }
            },
        )
        .await;

        assert_eq!(
            attempts_seen.load(std::sync::atomic::Ordering::SeqCst),
            plan_max_attempts,
            "the loop must use the plan's max_attempts, not a hardcoded 3"
        );
        match outcome {
            StepOutcome::Failed {
                code,
                message,
                output,
            } => {
                assert_eq!(code, "emit_invalid");
                assert!(message.unwrap().contains(&plan_max_attempts.to_string()));
                let output = output.unwrap();
                assert_eq!(output["errors"][0], "missing required field verdict");
                assert_eq!(output["raw_tail"], "{}");
            }
            other => panic!("expected Failed(emit_invalid), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn emit_loop_uses_the_corrective_prompt_on_retry() {
        let seen_prompts = std::sync::Mutex::new(Vec::<String>::new());
        let _ = run_emit_loop(3, "initial prompt".to_string(), |_attempt, prompt| {
            seen_prompts.lock().unwrap().push(prompt);
            async {
                Ok(EmitAttempt::Invalid {
                    next_prompt: "corrective prompt".to_string(),
                    errors: vec!["bad".to_string()],
                    raw_tail: None,
                })
            }
        })
        .await;
        let prompts = seen_prompts.into_inner().unwrap();
        assert_eq!(prompts, vec!["initial prompt", "corrective prompt", "corrective prompt"]);
    }

    #[tokio::test]
    async fn emit_loop_completes_on_first_valid_attempt() {
        let outcome = run_emit_loop(5, "emit".to_string(), |attempt, _prompt| async move {
            if attempt == 0 {
                Ok(EmitAttempt::Invalid {
                    next_prompt: "retry".to_string(),
                    errors: vec!["bad".to_string()],
                    raw_tail: None,
                })
            } else {
                Ok(EmitAttempt::Valid(json!({ "verdict": "ship" })))
            }
        })
        .await;
        match outcome {
            StepOutcome::Completed { output } => assert_eq!(output["verdict"], "ship"),
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn emit_loop_propagates_hard_failure_immediately_without_exhausting_attempts() {
        let attempts_seen = std::sync::atomic::AtomicU32::new(0);
        let outcome = run_emit_loop(5, "emit".to_string(), |_attempt, _prompt| {
            attempts_seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Err(failed("session_closed")) }
        })
        .await;
        assert_eq!(attempts_seen.load(std::sync::atomic::Ordering::SeqCst), 1);
        match outcome {
            StepOutcome::Failed { code, .. } => assert_eq!(code, "session_closed"),
            other => panic!("expected Failed(session_closed), got {other:?}"),
        }
    }
}
