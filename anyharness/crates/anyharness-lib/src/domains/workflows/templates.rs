//! Late-binding of `{{steps[N].output.Y}}` placeholders against completed step
//! outputs, plus brace unescaping.
//!
//! `{{args.*}}` were already interpolated server-side. The server escaped any
//! braces that came from arg *values* (an injection guard) as `\{` / `\}`, so a
//! genuine placeholder is an *unescaped* `{{ ... }}`. Substitution and
//! unescaping run in one pass: an escaped brace is emitted as a literal (and can
//! never open a placeholder), an unescaped `{{steps[N].output.KEY}}` is replaced
//! with the matching completed-step output, and an unresolved placeholder is
//! left verbatim (never silently emptied).

use std::collections::HashMap;

use super::plan::{
    AgentConfigStep, AgentEmitStep, AgentPromptStep, BranchStep, GoalSpec, NotifyStep, PlanStep,
    ScmOpenPrStep, ShellRunStep, StepKind, VerifySpec,
};

/// Completed step outputs keyed by step index.
pub type StepOutputs = HashMap<usize, serde_json::Value>;

/// Resolve a single templated string: substitute `{{steps[N].output.KEY}}`
/// placeholders, then unescape `\{` / `\}` (both handled in a single scan).
pub fn resolve_string(template: &str, outputs: &StepOutputs) -> String {
    let chars: Vec<char> = template.chars().collect();
    let mut out = String::with_capacity(template.len());
    let mut i = 0;
    while i < chars.len() {
        // Escaped brace: emit the brace literally, consuming the backslash. This
        // is what makes arg-injected braces inert — they can never open a
        // placeholder.
        if chars[i] == '\\' && i + 1 < chars.len() && (chars[i + 1] == '{' || chars[i + 1] == '}') {
            out.push(chars[i + 1]);
            i += 2;
            continue;
        }
        // A genuine (unescaped) placeholder opener.
        if chars[i] == '{' && i + 1 < chars.len() && chars[i + 1] == '{' {
            if let Some((resolved, next)) = try_placeholder(&chars, i, outputs) {
                out.push_str(&resolved);
                i = next;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// Attempt to parse and resolve a placeholder starting at `start` (`chars[start]`
/// is the first `{`). Returns the replacement text and the index just past the
/// closing `}}`, or `None` if this is not a resolvable `steps[..].output..`
/// placeholder (leaving the caller to emit the text verbatim).
fn try_placeholder(
    chars: &[char],
    start: usize,
    outputs: &StepOutputs,
) -> Option<(String, usize)> {
    // Find the closing `}}`.
    let mut j = start + 2;
    while j + 1 < chars.len() {
        if chars[j] == '}' && chars[j + 1] == '}' {
            break;
        }
        j += 1;
    }
    if j + 1 >= chars.len() || chars[j] != '}' {
        return None;
    }
    let inner: String = chars[start + 2..j].iter().collect();
    let end = j + 2;
    let value = resolve_reference(inner.trim(), outputs)?;
    Some((value, end))
}

/// Resolve `steps[N].output.KEY.PATH` against the outputs map. Returns `None`
/// for any other reference (e.g. a leftover `args.*`) so it is left verbatim.
fn resolve_reference(reference: &str, outputs: &StepOutputs) -> Option<String> {
    let rest = reference.strip_prefix("steps[")?;
    let (index_str, rest) = rest.split_once(']')?;
    let index: usize = index_str.trim().parse().ok()?;
    let path = rest.strip_prefix(".output")?;
    // Accept `.output` (whole output) or `.output.key.path`.
    let path = path.strip_prefix('.').unwrap_or("");
    let value = outputs.get(&index)?;
    let target = navigate(value, path)?;
    Some(render_value(target))
}

/// Navigate a dot-separated key path into a JSON value. An empty path returns
/// the value itself.
fn navigate<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    if path.is_empty() {
        return Some(value);
    }
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

/// Render a resolved JSON value into template text: strings verbatim (no quotes),
/// everything else as compact JSON.
fn render_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// Produce a resolved clone of a step with every templated string field
/// late-bound against `outputs`.
pub fn resolve_step(step: &PlanStep, outputs: &StepOutputs) -> PlanStep {
    let kind = match &step.kind {
        // agent.config carries only literal harness/model ids — nothing to bind.
        StepKind::AgentConfig(config) => StepKind::AgentConfig(AgentConfigStep {
            harness: config.harness.clone(),
            model: config.model.clone(),
        }),
        StepKind::AgentPrompt(agent) => StepKind::AgentPrompt(AgentPromptStep {
            prompt: resolve_string(&agent.prompt, outputs),
            goal: agent.goal.as_ref().map(|goal| resolve_goal(goal, outputs)),
            required_invocation: agent.required_invocation.clone(),
        }),
        StepKind::AgentEmit(emit) => StepKind::AgentEmit(AgentEmitStep {
            prompt: resolve_string(&emit.prompt, outputs),
            max_attempts: emit.max_attempts,
            output_schema: emit.output_schema.clone(),
        }),
        StepKind::ShellRun(shell) => StepKind::ShellRun(ShellRunStep {
            command: resolve_string(&shell.command, outputs),
            timeout_secs: shell.timeout_secs,
            output_name: shell.output_name.clone(),
        }),
        StepKind::ScmOpenPr(pr) => StepKind::ScmOpenPr(ScmOpenPrStep {
            base: pr.base.clone(),
            title: resolve_string(&pr.title, outputs),
            body: pr.body.as_ref().map(|body| resolve_string(body, outputs)),
            draft: pr.draft,
        }),
        StepKind::Notify(notify) => StepKind::Notify(NotifyStep {
            slack_channel_id: notify.slack_channel_id.clone(),
            message: resolve_string(&notify.message, outputs),
        }),
        StepKind::Branch(branch) => StepKind::Branch(BranchStep {
            on: resolve_string(&branch.on, outputs),
            cases: branch.cases.clone(),
            reason: branch.reason.clone(),
        }),
    };
    PlanStep {
        key: step.key.clone(),
        slot: step.slot.clone(),
        label: step.label.clone(),
        on_fail: step.on_fail,
        kind,
    }
}

fn resolve_goal(goal: &GoalSpec, outputs: &StepOutputs) -> GoalSpec {
    GoalSpec {
        objective: resolve_string(&goal.objective, outputs),
        max_turns: goal.max_turns,
        max_wall_secs: goal.max_wall_secs,
        token_budget: goal.token_budget,
        on_blocked: goal.on_blocked,
        verify: goal.verify.as_ref().map(|verify| VerifySpec {
            shell: resolve_string(&verify.shell, outputs),
            expect_exit: verify.expect_exit,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outputs() -> StepOutputs {
        let mut map = StepOutputs::new();
        map.insert(
            0,
            serde_json::json!({ "pr_url": "https://x/pr/1", "exit_code": 0, "nested": { "k": "v" } }),
        );
        map.insert(1, serde_json::json!({ "output_tail": "line1\nline2" }));
        map
    }

    #[test]
    fn substitutes_a_string_output() {
        let resolved = resolve_string("PR: {{steps[0].output.pr_url}} done", &outputs());
        assert_eq!(resolved, "PR: https://x/pr/1 done");
    }

    #[test]
    fn substitutes_a_non_string_as_compact_json() {
        let resolved = resolve_string("code={{steps[0].output.exit_code}}", &outputs());
        assert_eq!(resolved, "code=0");
    }

    #[test]
    fn navigates_a_nested_key_path() {
        let resolved = resolve_string("{{steps[0].output.nested.k}}", &outputs());
        assert_eq!(resolved, "v");
    }

    #[test]
    fn unescapes_backslash_braces() {
        // Arg-injected braces arrive escaped and must become literal, never a
        // placeholder.
        let resolved = resolve_string(r"literal \{not a placeholder\}", &outputs());
        assert_eq!(resolved, "literal {not a placeholder}");
    }

    #[test]
    fn escaped_double_brace_is_not_a_placeholder() {
        let resolved = resolve_string(r"\{\{steps[0].output.pr_url\}\}", &outputs());
        assert_eq!(resolved, "{{steps[0].output.pr_url}}");
    }

    #[test]
    fn leaves_unresolved_placeholder_verbatim() {
        // Missing step index, and a leftover args.* both stay untouched.
        assert_eq!(
            resolve_string("{{steps[9].output.x}}", &outputs()),
            "{{steps[9].output.x}}"
        );
        assert_eq!(resolve_string("{{args.foo}}", &outputs()), "{{args.foo}}");
    }

    #[test]
    fn resolve_step_rewrites_prompt_and_goal() {
        let step: PlanStep = serde_json::from_value(serde_json::json!({
            "kind": "agent.prompt",
            "prompt": "use {{steps[0].output.pr_url}}",
            "goal": { "objective": "verify {{steps[1].output.output_tail}}", "max_turns": 5, "max_wall_secs": 60 }
        }))
        .expect("parse step");
        let resolved = resolve_step(&step, &outputs());
        let StepKind::AgentPrompt(agent) = &resolved.kind else {
            panic!("expected agent.prompt");
        };
        assert_eq!(agent.prompt, "use https://x/pr/1");
        assert_eq!(
            agent.goal.as_ref().expect("goal").objective,
            "verify line1\nline2"
        );
    }
}
