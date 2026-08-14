/// Extract one HTTP handler body from its public signature to the next item.
fn handler_body(rel_path: &str, fn_name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel_path);
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {rel_path}: {error}"));
    let signature = format!("pub async fn {fn_name}(");
    let start = text
        .find(&signature)
        .unwrap_or_else(|| panic!("{rel_path}: handler {fn_name} not found"));
    let rest = &text[start..];
    let end = rest[signature.len()..]
        .find("\npub ")
        .map(|idx| idx + signature.len())
        .unwrap_or(rest.len());
    rest[..end].to_string()
}

fn assert_source_order(rel_path: &str, fn_name: &str, first: &str, second: &str, why: &str) {
    let body = handler_body(rel_path, fn_name);
    let first_at = body
        .find(first)
        .unwrap_or_else(|| panic!("{rel_path}::{fn_name}: token '{first}' missing"));
    let second_at = body
        .find(second)
        .unwrap_or_else(|| panic!("{rel_path}::{fn_name}: token '{second}' missing"));
    assert!(
        first_at < second_at,
        "{rel_path}::{fn_name}: '{first}' must come BEFORE '{second}' — {why}"
    );
}

fn assert_admit_before_lease(rel_path: &str, fn_name: &str, admit: &str, lease: &str) {
    assert_source_order(
        rel_path,
        fn_name,
        admit,
        lease,
        "canonical order: session mutation permit before workspace operation lease",
    );
}

#[test]
fn every_dual_lock_handler_takes_the_permit_before_the_operation_lease() {
    const ADMIT: &str = "admit_session_mutation(";
    const ADMIT_ALL: &str = "admit_all_workspace_sessions(";
    const PLAN: &str = "admit_plan_session(";
    const SHARED: &str = ".acquire_shared(";
    const EXCLUSIVE: &str = ".acquire_exclusive(";
    const FORK_LEASE: &str = "acquire_session_exclusive_operation_lease(";
    for (file, handler, admit, lease) in [
        ("sessions.rs", "create_session", ADMIT, SHARED),
        ("plans.rs", "approve_plan", PLAN, SHARED),
        ("plans.rs", "reject_plan", PLAN, SHARED),
        ("plans.rs", "handoff_plan", PLAN, SHARED),
        ("reviews.rs", "start_plan_review", ADMIT, SHARED),
        ("reviews.rs", "start_code_review", ADMIT, SHARED),
        ("sessions_fork.rs", "fork_session", ADMIT, FORK_LEASE),
        (
            "mobility.rs",
            "export_workspace_mobility_archive",
            ADMIT_ALL,
            SHARED,
        ),
        (
            "mobility.rs",
            "destroy_workspace_mobility_source",
            ADMIT_ALL,
            EXCLUSIVE,
        ),
    ] {
        assert_admit_before_lease(&format!("src/api/http/{file}"), handler, admit, lease);
    }
}
