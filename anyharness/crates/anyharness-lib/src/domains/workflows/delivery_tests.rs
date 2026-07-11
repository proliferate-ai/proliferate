use std::path::Path;

use anyharness_contract::v1::{
    ExecutionBinding, RepositoryObjectFormat, SchemaVersion, SourceKind, WorkflowTarget,
};
use serde_json::Value;

use super::delivery::{
    content_hash_excluding, validate_delivery_identity, write_jcs, DeliveryIdentity,
    DeliveryIdentityError,
};

const RUN_ID: &str = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_ID: &str = "22222222-2222-4222-8222-222222222222";
const VERSION_ID: &str = "33333333-3333-4333-8333-333333333333";
const LOCAL_COMMIT: &str = "1111111111111111111111111111111111111111";

fn canonical(value: &Value) -> Result<String, DeliveryIdentityError> {
    let mut output = String::new();
    write_jcs(value, &mut output)?;
    Ok(output)
}

fn fixture(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/contracts/workflows/fixtures")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    serde_json::from_str(&text).expect("parse shared canonical fixture")
}

fn binding() -> ExecutionBinding {
    let mut binding = ExecutionBinding {
        schema_version: SchemaVersion::<1>,
        target: WorkflowTarget::Local,
        source_kind: SourceKind::LocalCommit,
        repository_object_format: RepositoryObjectFormat::Sha1,
        base_commit_oid: LOCAL_COMMIT.to_string(),
        checkpoint_id: None,
        checkpoint_content_hash: None,
        workspace_id: "workspace-1".to_string(),
        workspace_generation: 1,
        materialization_id: "materialization-1".to_string(),
        executor_id: "executor-1".to_string(),
        executor_generation: 1,
        binding_hash: String::new(),
    };
    let value = serde_json::to_value(&binding).expect("binding JSON");
    binding.binding_hash = content_hash_excluding(&value, "bindingHash").expect("binding hash");
    binding
}

fn plan() -> Value {
    let mut plan = serde_json::json!({
        "planVersion": 1,
        "planHash": "",
        "run_id": RUN_ID,
        "workflow_id": WORKFLOW_ID,
        "workflow_version_id": VERSION_ID,
        "version_n": 1,
        "trigger_kind": "manual",
        "target_mode": "local",
        "sourceIntent": {"kind": "local_commit", "resolvedCommit": LOCAL_COMMIT},
        "isolation": "workspace",
        "sessions": {},
        "inputs": {},
        "steps": []
    });
    let hash = content_hash_excluding(&plan, "planHash").expect("plan hash");
    plan["planHash"] = Value::String(hash);
    plan
}

fn rehash_plan(plan: &mut Value) {
    let hash = content_hash_excluding(plan, "planHash").expect("plan hash");
    plan["planHash"] = Value::String(hash);
}

fn rehash_binding(binding: &mut ExecutionBinding) {
    binding.binding_hash.clear();
    let value = serde_json::to_value(&*binding).expect("binding JSON");
    binding.binding_hash = content_hash_excluding(&value, "bindingHash").expect("binding hash");
}

fn identity(plan: &Value, binding: &ExecutionBinding) -> DeliveryIdentity {
    DeliveryIdentity {
        run_id: plan["run_id"].as_str().unwrap_or(RUN_ID).to_string(),
        plan_hash: plan["planHash"].as_str().unwrap().to_string(),
        binding_hash: binding.binding_hash.clone(),
        execution_generation: 1,
    }
}

fn assert_structurally_rejected(mut candidate: Value, binding: &ExecutionBinding) {
    assert_structurally_rejected_named("adversarial mutation", &mut candidate, binding);
}

fn assert_structurally_rejected_named(
    name: &str,
    candidate: &mut Value,
    binding: &ExecutionBinding,
) {
    rehash_plan(candidate);
    let result = validate_delivery_identity(
        1,
        &identity(candidate, binding),
        candidate,
        "workspace-1",
        1,
        binding,
    );
    assert!(
        matches!(
            result,
            Err(DeliveryIdentityError::InvalidLegacyPlan(_))
                | Err(DeliveryIdentityError::UnsupportedPlanVersion)
        ),
        "{name}: {result:?}"
    );
}

fn v2_key(step: usize) -> String {
    format!("root::aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa::-::44444444-4444-4444-8444-{step:012}")
}

fn plan_with_all_steps() -> Value {
    let mut value = plan();
    value["sessions"] = serde_json::json!({
        "main": {
            "harness": "claude",
            "model": "sonnet",
            "session_binding": "fresh",
            "integrations": ["github_api"],
            "bind_session_id": "session-123"
        }
    });
    value["inputs"] = serde_json::json!({
        "title": "repair",
        "attempts": 2,
        "ratio": 1.5,
        "enabled": true
    });
    value["steps"] = serde_json::json!([
        {
            "kind": "agent.config",
            "key": "0.-.0",
            "key_v2": v2_key(0),
            "slot": "main",
            "label": "Configure",
            "on_fail": {"kind": "stop"},
            "model": "sonnet"
        },
        {
            "kind": "agent.prompt",
            "key": "0.-.1",
            "key_v2": v2_key(1),
            "slot": "main",
            "label": "Prompt",
            "on_fail": {"kind": "retry", "n": 2},
            "prompt": "Repair it",
            "goal": {
                "objective": "Tests pass",
                "max_turns": 3,
                "max_wall_secs": 300,
                "token_budget": 1000,
                "on_blocked": "notify",
                "verify": {"shell": "true", "expect_exit": 0}
            },
            "required_invocation": {"provider": "github", "tool": "get_issue"}
        },
        {
            "kind": "agent.emit",
            "key": "0.-.2",
            "key_v2": v2_key(2),
            "slot": "main",
            "label": "Emit",
            "on_fail": {"kind": "continue"},
            "prompt": "Return JSON",
            "max_attempts": 3,
            "name": "result",
            "output_schema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": false
            }
        },
        {
            "kind": "shell.run",
            "key": "0.-.3",
            "key_v2": v2_key(3),
            "slot": "main",
            "label": "Test",
            "on_fail": {"kind": "stop"},
            "command": "make test",
            "timeout_secs": 300,
            "output_name": "test_output"
        },
        {
            "kind": "scm.open_pr",
            "key": "0.-.4",
            "key_v2": v2_key(4),
            "slot": "main",
            "label": "Open PR",
            "on_fail": {"kind": "stop"},
            "title": "Repair",
            "base": "main",
            "body": "Done",
            "draft": false
        },
        {
            "kind": "notify",
            "key": "0.-.5",
            "key_v2": v2_key(5),
            "slot": "main",
            "label": "Notify",
            "on_fail": {"kind": "continue"},
            "slack_channel_id": "C123",
            "message": "Done"
        },
        {
            "kind": "branch",
            "key": "0.-.6",
            "key_v2": v2_key(6),
            "slot": "main",
            "label": "Branch",
            "on_fail": {"kind": "stop"},
            "on": "{{steps[2].output.ok}}",
            "cases": {"true": {"to": "continue"}, "false": {"to": "end"}},
            "reason": "finish"
        }
    ]);
    rehash_plan(&mut value);
    value
}

#[test]
fn complete_consistent_bridge_is_accepted() {
    let plan = plan();
    let binding = binding();
    let identity = identity(&plan, &binding);
    assert_eq!(
        validate_delivery_identity(1, &identity, &plan, "workspace-1", 1, &binding),
        Ok(())
    );
}

#[test]
fn noncanonical_hash_and_cross_field_mismatch_are_rejected() {
    let plan = plan();
    let binding = binding();
    let plan_hash = plan["planHash"].as_str().unwrap().to_string();
    let mut identity = identity(&plan, &binding);
    identity.plan_hash = format!("sha256:{}", "A".repeat(64));
    assert!(matches!(
        validate_delivery_identity(1, &identity, &plan, "workspace-1", 1, &binding),
        Err(DeliveryIdentityError::InvalidHash { field: "planHash" })
    ));
    identity.plan_hash = plan_hash;
    assert!(matches!(
        validate_delivery_identity(1, &identity, &plan, "different-workspace", 1, &binding),
        Err(DeliveryIdentityError::Inconsistent {
            field: "workspaceId",
            ..
        })
    ));
}

#[test]
fn legacy_plan_accepts_only_exact_wire_field_names() {
    let mut alias = plan();
    alias.as_object_mut().unwrap().remove("planVersion");
    alias["plan_version"] = Value::from(1);
    let binding = binding();
    let identity = identity(&alias, &binding);
    assert!(matches!(
        validate_delivery_identity(1, &identity, &alias, "workspace-1", 1, &binding),
        Err(DeliveryIdentityError::InvalidLegacyPlan(_))
    ));
}

#[test]
fn strict_legacy_plan_accepts_all_seven_exact_step_variants() {
    let plan = plan_with_all_steps();
    let binding = binding();
    assert_eq!(
        validate_delivery_identity(
            1,
            &identity(&plan, &binding),
            &plan,
            "workspace-1",
            1,
            &binding,
        ),
        Ok(())
    );
}

#[test]
fn every_required_delivery_wire_field_is_structurally_enforced_after_rehash() {
    let valid = plan_with_all_steps();
    let binding = binding();
    let cases = [
        ("top.planVersion", "", "planVersion"),
        ("top.run_id", "", "run_id"),
        ("top.workflow_id", "", "workflow_id"),
        ("top.workflow_version_id", "", "workflow_version_id"),
        ("top.version_n", "", "version_n"),
        ("top.trigger_kind", "", "trigger_kind"),
        ("top.target_mode", "", "target_mode"),
        ("top.sourceIntent", "", "sourceIntent"),
        ("top.isolation", "", "isolation"),
        ("top.sessions", "", "sessions"),
        ("top.inputs", "", "inputs"),
        ("top.steps", "", "steps"),
        ("source.kind", "/sourceIntent", "kind"),
        (
            "source.local.resolvedCommit",
            "/sourceIntent",
            "resolvedCommit",
        ),
        ("session.harness", "/sessions/main", "harness"),
        ("session.model", "/sessions/main", "model"),
        (
            "session.session_binding",
            "/sessions/main",
            "session_binding",
        ),
        ("session.integrations", "/sessions/main", "integrations"),
        ("step.key", "/steps/0", "key"),
        ("step.key_v2", "/steps/0", "key_v2"),
        ("step.slot", "/steps/0", "slot"),
        ("step.label", "/steps/0", "label"),
        ("step.on_fail", "/steps/0", "on_fail"),
        ("on_fail.kind", "/steps/0/on_fail", "kind"),
        ("agent.config.model", "/steps/0", "model"),
        ("agent.prompt.prompt", "/steps/1", "prompt"),
        ("goal.objective", "/steps/1/goal", "objective"),
        ("goal.max_turns", "/steps/1/goal", "max_turns"),
        ("goal.max_wall_secs", "/steps/1/goal", "max_wall_secs"),
        ("goal.on_blocked", "/steps/1/goal", "on_blocked"),
        ("verify.shell", "/steps/1/goal/verify", "shell"),
        ("verify.expect_exit", "/steps/1/goal/verify", "expect_exit"),
        (
            "required_invocation.provider",
            "/steps/1/required_invocation",
            "provider",
        ),
        (
            "required_invocation.tool",
            "/steps/1/required_invocation",
            "tool",
        ),
        ("agent.emit.prompt", "/steps/2", "prompt"),
        ("agent.emit.max_attempts", "/steps/2", "max_attempts"),
        ("shell.run.command", "/steps/3", "command"),
        ("scm.open_pr.title", "/steps/4", "title"),
        ("notify.slack_channel_id", "/steps/5", "slack_channel_id"),
        ("notify.message", "/steps/5", "message"),
        ("branch.on", "/steps/6", "on"),
        ("branch.cases", "/steps/6", "cases"),
        ("branch.case.to", "/steps/6/cases/true", "to"),
    ];
    for (name, parent, field) in cases {
        let mut candidate = valid.clone();
        candidate
            .pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .unwrap_or_else(|| panic!("{name}: object parent"))
            .remove(field);
        assert_structurally_rejected_named(name, &mut candidate, &binding);
    }
}

#[test]
fn every_nested_object_rejects_unknown_fields_after_rehash() {
    let valid = plan_with_all_steps();
    let binding = binding();
    let cases = [
        ("top", "", "privateEnvelope"),
        ("source", "/sourceIntent", "checkout"),
        ("session", "/sessions/main", "credential"),
        ("agent.config", "/steps/0", "harness"),
        ("on_fail", "/steps/0/on_fail", "attempts"),
        ("agent.prompt", "/steps/1", "args"),
        ("goal", "/steps/1/goal", "wallClock"),
        ("verify", "/steps/1/goal/verify", "cwd"),
        (
            "required_invocation",
            "/steps/1/required_invocation",
            "authorization",
        ),
        ("agent.emit", "/steps/2", "schema"),
        ("output_schema", "/steps/2/output_schema", "pattern"),
        ("shell.run", "/steps/3", "replay_key"),
        ("scm.open_pr", "/steps/4", "head"),
        ("notify", "/steps/5", "channel"),
        ("branch", "/steps/6", "default"),
        ("branch.case", "/steps/6/cases/true", "reason"),
    ];
    for (name, parent, field) in cases {
        let mut candidate = valid.clone();
        candidate
            .pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .unwrap_or_else(|| panic!("{name}: object parent"))
            .insert(field.to_string(), Value::String("canary".into()));
        assert_structurally_rejected_named(name, &mut candidate, &binding);
    }
}

#[test]
fn nested_grammar_and_positive_integer_rules_are_table_driven_after_rehash() {
    let valid = plan_with_all_steps();
    let binding = binding();
    let cases: Vec<(&str, &str, Value)> = vec![
        ("planVersion literal", "/planVersion", Value::from(2)),
        ("version_n positive", "/version_n", Value::from(0)),
        (
            "trigger vocabulary",
            "/trigger_kind",
            Value::String("webhook".into()),
        ),
        (
            "target vocabulary",
            "/target_mode",
            Value::String("shared_cloud".into()),
        ),
        (
            "isolation vocabulary",
            "/isolation",
            Value::String("container".into()),
        ),
        (
            "session harness clean",
            "/sessions/main/harness",
            Value::String(" claude".into()),
        ),
        (
            "session model bounded",
            "/sessions/main/model",
            Value::String("m".repeat(256)),
        ),
        (
            "bind_session_id control-free",
            "/sessions/main/bind_session_id",
            Value::String("session\n1".into()),
        ),
        (
            "session binding vocabulary",
            "/sessions/main/session_binding",
            Value::String("visible".into()),
        ),
        (
            "integration uniqueness",
            "/sessions/main/integrations",
            serde_json::json!(["github_api", "github_api"]),
        ),
        (
            "integration identifier",
            "/sessions/main/integrations",
            serde_json::json!(["github-api"]),
        ),
        ("legacy key grammar", "/steps/0/key", Value::String("00.-.0".into())),
        ("slot grammar", "/steps/0/slot", Value::String("Main".into())),
        (
            "v2 key UUID grammar",
            "/steps/0/key_v2",
            Value::String(
                "root::AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA::-::44444444-4444-4444-8444-000000000000"
                    .into(),
            ),
        ),
        (
            "retry requires n",
            "/steps/0/on_fail",
            serde_json::json!({"kind": "retry"}),
        ),
        (
            "retry n positive",
            "/steps/0/on_fail",
            serde_json::json!({"kind": "retry", "n": 0}),
        ),
        (
            "non-retry forbids n",
            "/steps/0/on_fail",
            serde_json::json!({"kind": "stop", "n": 1}),
        ),
        ("goal max_turns positive", "/steps/1/goal/max_turns", Value::from(0)),
        (
            "goal max_wall_secs positive",
            "/steps/1/goal/max_wall_secs",
            Value::from(0),
        ),
        (
            "goal token_budget positive",
            "/steps/1/goal/token_budget",
            Value::from(0),
        ),
        (
            "goal blocked vocabulary",
            "/steps/1/goal/on_blocked",
            Value::String("wait".into()),
        ),
        (
            "invocation provider clean",
            "/steps/1/required_invocation/provider",
            Value::String("".into()),
        ),
        (
            "invocation tool bounded",
            "/steps/1/required_invocation/tool",
            Value::String("t".repeat(256)),
        ),
        (
            "emit max_attempts positive",
            "/steps/2/max_attempts",
            Value::from(0),
        ),
        (
            "emit name identifier",
            "/steps/2/name",
            Value::String("bad-name".into()),
        ),
        (
            "emit schema root object",
            "/steps/2/output_schema/type",
            Value::String("array".into()),
        ),
        (
            "shell timeout positive",
            "/steps/3/timeout_secs",
            Value::from(0),
        ),
        (
            "shell output identifier",
            "/steps/3/output_name",
            Value::String("bad-name".into()),
        ),
        (
            "branch target vocabulary",
            "/steps/6/cases/true/to",
            Value::String("jump".into()),
        ),
        (
            "local commit OID grammar",
            "/sourceIntent/resolvedCommit",
            Value::String("abc".into()),
        ),
    ];
    for (name, pointer, replacement) in cases {
        let mut candidate = valid.clone();
        *candidate
            .pointer_mut(pointer)
            .unwrap_or_else(|| panic!("{name}: mutation pointer")) = replacement;
        assert_structurally_rejected_named(name, &mut candidate, &binding);
    }
}

#[test]
fn shared_integer_domain_boundaries_match_strict_preflight_and_runtime_parser() {
    let data = fixture("canonical-structure-vectors-v1.json");
    let binding = binding();
    for vector in data["legacyIntegerDomains"].as_array().unwrap() {
        let name = vector["name"].as_str().unwrap();
        let pointer = vector["planPointer"].as_str().unwrap();

        let mut at_maximum = plan_with_all_steps();
        *at_maximum
            .pointer_mut(pointer)
            .unwrap_or_else(|| panic!("{name}: maximum pointer")) = vector["maximum"].clone();
        rehash_plan(&mut at_maximum);
        assert_eq!(
            validate_delivery_identity(
                1,
                &identity(&at_maximum, &binding),
                &at_maximum,
                "workspace-1",
                1,
                &binding,
            ),
            Ok(()),
            "{name}: accepted maximum"
        );

        if vector["minimum"]
            .as_i64()
            .is_some_and(|minimum| minimum < 0)
        {
            let mut at_minimum = plan_with_all_steps();
            *at_minimum
                .pointer_mut(pointer)
                .unwrap_or_else(|| panic!("{name}: minimum pointer")) = vector["minimum"].clone();
            rehash_plan(&mut at_minimum);
            assert_eq!(
                validate_delivery_identity(
                    1,
                    &identity(&at_minimum, &binding),
                    &at_minimum,
                    "workspace-1",
                    1,
                    &binding,
                ),
                Ok(()),
                "{name}: accepted minimum"
            );
        }

        for boundary in ["belowMinimum", "aboveMaximum"] {
            let mut rejected = plan_with_all_steps();
            *rejected
                .pointer_mut(pointer)
                .unwrap_or_else(|| panic!("{name}: {boundary} pointer")) = vector[boundary].clone();
            assert_structurally_rejected_named(
                &format!("{name}: {boundary}"),
                &mut rejected,
                &binding,
            );
        }
    }
}

#[test]
fn every_shared_invalid_schema_is_rejected_by_delivery_preflight() {
    let data = fixture("invalid/schema-profile-invalid-cases.json");
    let binding = binding();
    for case in data["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut candidate = plan_with_all_steps();
        candidate["steps"][2]["output_schema"] = case["document"].clone();
        assert_structurally_rejected_named(name, &mut candidate, &binding);
    }
}

#[test]
fn recomputed_hash_cannot_hide_missing_renamed_or_unknown_nested_fields() {
    let valid = plan_with_all_steps();
    let binding = binding();
    let mut candidates = Vec::new();

    let mut missing_session_field = valid.clone();
    missing_session_field["sessions"]["main"]
        .as_object_mut()
        .unwrap()
        .remove("model");
    candidates.push(missing_session_field);

    let mut renamed_session_field = valid.clone();
    let session = renamed_session_field["sessions"]["main"]
        .as_object_mut()
        .unwrap();
    let session_binding = session.remove("session_binding").unwrap();
    session.insert("sessionBinding".to_string(), session_binding);
    candidates.push(renamed_session_field);

    let mut unknown_session_field = valid.clone();
    unknown_session_field["sessions"]["main"]["credential"] = Value::String("x".into());
    candidates.push(unknown_session_field);

    let mut missing_step_field = valid.clone();
    missing_step_field["steps"][0]
        .as_object_mut()
        .unwrap()
        .remove("key_v2");
    candidates.push(missing_step_field);

    let mut unknown_step_field = valid.clone();
    unknown_step_field["steps"][1]["args"] = serde_json::json!({});
    candidates.push(unknown_step_field);

    let mut unknown_goal_field = valid.clone();
    unknown_goal_field["steps"][1]["goal"]["wallClock"] = Value::from(1);
    candidates.push(unknown_goal_field);

    let mut renamed_branch_case = valid.clone();
    let branch_case = renamed_branch_case["steps"][6]["cases"]["true"]
        .as_object_mut()
        .unwrap();
    let target = branch_case.remove("to").unwrap();
    branch_case.insert("target".to_string(), target);
    candidates.push(renamed_branch_case);

    let mut renamed_source_field = valid;
    let source = renamed_source_field["sourceIntent"]
        .as_object_mut()
        .unwrap();
    let commit = source.remove("resolvedCommit").unwrap();
    source.insert("resolved_commit".to_string(), commit);
    candidates.push(renamed_source_field);

    for candidate in candidates {
        assert_structurally_rejected(candidate, &binding);
    }
}

#[test]
fn recomputed_hash_cannot_hide_identity_session_or_step_incoherence() {
    let valid = plan_with_all_steps();
    let binding = binding();
    let mut candidates = Vec::new();

    let mut malformed_uuid = valid.clone();
    malformed_uuid["workflow_id"] = Value::String("workflow-1".into());
    candidates.push(malformed_uuid);

    let mut missing_session = valid.clone();
    missing_session["steps"][0]["slot"] = Value::String("missing".into());
    candidates.push(missing_session);

    let mut wrong_lane = valid.clone();
    wrong_lane["steps"][0]["key"] = Value::String("0.other.0".into());
    candidates.push(wrong_lane);

    let mut malformed_v2_key = valid.clone();
    malformed_v2_key["steps"][0]["key_v2"] = Value::String("root::node::-::step".into());
    candidates.push(malformed_v2_key);

    let mut suffix_mismatch = valid.clone();
    suffix_mismatch["steps"][0]["key"] = Value::String("0.-.0.notify_fields".into());
    candidates.push(suffix_mismatch);

    let mut duplicate_legacy_key = valid.clone();
    duplicate_legacy_key["steps"][1]["key"] = duplicate_legacy_key["steps"][0]["key"].clone();
    candidates.push(duplicate_legacy_key);

    let mut duplicate_v2_key = valid;
    duplicate_v2_key["steps"][1]["key_v2"] = duplicate_v2_key["steps"][0]["key_v2"].clone();
    candidates.push(duplicate_v2_key);

    for candidate in candidates {
        assert_structurally_rejected(candidate, &binding);
    }
}

#[test]
fn recomputed_hash_cannot_hide_boolean_numeric_or_private_input_smuggling() {
    let valid = plan_with_all_steps();
    let binding = binding();

    let mut boolean_version = valid.clone();
    boolean_version["version_n"] = Value::Bool(true);
    assert_structurally_rejected(boolean_version, &binding);

    let mut boolean_budget = valid.clone();
    boolean_budget["steps"][1]["goal"]["max_turns"] = Value::Bool(true);
    assert_structurally_rejected(boolean_budget, &binding);

    let mut composite_input = valid.clone();
    composite_input["inputs"]["nested"] = serde_json::json!({"secret": "x"});
    assert_structurally_rejected(composite_input, &binding);

    for alias in [
        "auth_token",
        "bearer-token",
        "clientSecret",
        "private_key",
        "access-key",
        "secret_access_key",
        "sessionToken",
    ] {
        let mut private_input = valid.clone();
        private_input["inputs"] = serde_json::json!({alias: "canary"});
        assert_structurally_rejected(private_input, &binding);
    }

    for malformed in [
        r#"{"value":NaN}"#,
        r#"{"value":Infinity}"#,
        r#"{"value":1e9999}"#,
    ] {
        assert!(serde_json::from_str::<Value>(malformed).is_err());
    }
}

#[test]
fn exact_source_grammar_and_base_linkage_are_enforced_after_rehash() {
    let local = plan();
    let local_binding = binding();

    let mut missing_local_commit = local.clone();
    missing_local_commit["sourceIntent"] = serde_json::json!({"kind": "local_commit"});
    assert_structurally_rejected(missing_local_commit, &local_binding);

    let mut mismatched_local_commit = local.clone();
    mismatched_local_commit["sourceIntent"]["resolvedCommit"] = Value::String("2".repeat(40));
    rehash_plan(&mut mismatched_local_commit);
    assert!(matches!(
        validate_delivery_identity(
            1,
            &identity(&mismatched_local_commit, &local_binding),
            &mismatched_local_commit,
            "workspace-1",
            1,
            &local_binding,
        ),
        Err(DeliveryIdentityError::Inconsistent {
            field: "baseCommitOid",
            ..
        })
    ));

    let mut remote = local;
    remote["target_mode"] = Value::String("personal_cloud".into());
    remote["sourceIntent"] = serde_json::json!({
        "kind": "remote_commit",
        "repo": "github.com/proliferate-ai/proliferate",
        "ref": "refs/heads/main",
        "resolvedCommit": LOCAL_COMMIT
    });
    rehash_plan(&mut remote);
    let mut remote_binding = local_binding.clone();
    remote_binding.target = WorkflowTarget::PersonalCloud;
    remote_binding.source_kind = SourceKind::RemoteCommit;
    rehash_binding(&mut remote_binding);
    assert_eq!(
        validate_delivery_identity(
            1,
            &identity(&remote, &remote_binding),
            &remote,
            "workspace-1",
            1,
            &remote_binding,
        ),
        Ok(())
    );

    for (field, value) in [
        ("repo", "gitlab.com/proliferate-ai/proliferate"),
        ("ref", "refs/heads/bad..ref"),
        ("resolvedCommit", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ] {
        let mut malformed = remote.clone();
        malformed["sourceIntent"][field] = Value::String(value.into());
        assert_structurally_rejected(malformed, &remote_binding);
    }
}

fn assert_binding_rejected(plan: &Value, mut candidate: ExecutionBinding) {
    rehash_binding(&mut candidate);
    let request_workspace_id = candidate.workspace_id.clone();
    let actual_workspace_generation = candidate.workspace_generation;
    assert!(validate_delivery_identity(
        1,
        &identity(plan, &candidate),
        plan,
        &request_workspace_id,
        actual_workspace_generation,
        &candidate,
    )
    .is_err());
}

#[test]
fn binding_identity_grammar_checkpoint_exactness_and_linkage_are_strict() {
    let local = plan();
    let valid = binding();

    for malformed in ["", "has whitespace", "line\nbreak"] {
        let mut candidate = valid.clone();
        candidate.materialization_id = malformed.to_string();
        assert_binding_rejected(&local, candidate);
    }
    let mut oversized = valid.clone();
    oversized.executor_id = "x".repeat(256);
    assert_binding_rejected(&local, oversized);

    let mut bad_oid = valid.clone();
    bad_oid.base_commit_oid = "A".repeat(40);
    assert_binding_rejected(&local, bad_oid);

    let mut wrong_format = valid.clone();
    wrong_format.repository_object_format = RepositoryObjectFormat::Sha256;
    assert_binding_rejected(&local, wrong_format);

    let mut commit_with_checkpoint = valid.clone();
    commit_with_checkpoint.checkpoint_id = Some("checkpoint-1".into());
    commit_with_checkpoint.checkpoint_content_hash = Some(format!("sha256:{}", "a".repeat(64)));
    assert_binding_rejected(&local, commit_with_checkpoint);

    let mut source_mismatch = valid.clone();
    source_mismatch.source_kind = SourceKind::RemoteCommit;
    assert_binding_rejected(&local, source_mismatch);

    let mut target_mismatch = valid.clone();
    target_mismatch.target = WorkflowTarget::PersonalCloud;
    assert_binding_rejected(&local, target_mismatch);

    let mut base_mismatch = valid.clone();
    base_mismatch.base_commit_oid = "2".repeat(40);
    assert_binding_rejected(&local, base_mismatch);

    let mut checkpoint_plan = local;
    checkpoint_plan["sourceIntent"] = serde_json::json!({"kind": "workspace_checkpoint"});
    rehash_plan(&mut checkpoint_plan);
    let mut checkpoint = valid;
    checkpoint.source_kind = SourceKind::WorkspaceCheckpoint;
    checkpoint.checkpoint_id = Some("checkpoint-1".into());
    checkpoint.checkpoint_content_hash = Some(format!("sha256:{}", "a".repeat(64)));
    rehash_binding(&mut checkpoint);
    assert_eq!(
        validate_delivery_identity(
            1,
            &identity(&checkpoint_plan, &checkpoint),
            &checkpoint_plan,
            "workspace-1",
            1,
            &checkpoint,
        ),
        Ok(())
    );

    for (checkpoint_id, checkpoint_hash) in [
        (None, Some(format!("sha256:{}", "a".repeat(64)))),
        (Some("checkpoint-1".to_string()), None),
        (
            Some("bad checkpoint".to_string()),
            Some(format!("sha256:{}", "a".repeat(64))),
        ),
        (
            Some("checkpoint-1".to_string()),
            Some(format!("sha256:{}", "A".repeat(64))),
        ),
    ] {
        let mut candidate = checkpoint.clone();
        candidate.checkpoint_id = checkpoint_id;
        candidate.checkpoint_content_hash = checkpoint_hash;
        assert_binding_rejected(&checkpoint_plan, candidate);
    }
}

#[test]
fn jcs_matches_shared_cross_language_number_and_structure_vectors() {
    for fixture_name in [
        "canonical-number-vectors-v1.json",
        "canonical-structure-vectors-v1.json",
    ] {
        let data = fixture(fixture_name);
        for vector in data["vectors"].as_array().unwrap() {
            assert_eq!(
                canonical(&vector["value"]).expect("canonicalize shared vector"),
                vector["canonical"].as_str().unwrap(),
                "{}: {}",
                fixture_name,
                vector.get("name").or_else(|| vector.get("note")).unwrap()
            );
        }
    }
}

#[test]
fn jcs_rejects_integer_literals_outside_the_exact_binary64_domain() {
    let data = fixture("canonical-structure-vectors-v1.json");
    for literal in data["rejectedIntegerLiterals"].as_array().unwrap() {
        let value: Value = serde_json::from_str(literal.as_str().unwrap()).unwrap();
        assert!(matches!(
            canonical(&value),
            Err(DeliveryIdentityError::InvalidLegacyPlan(_))
        ));
    }
}
