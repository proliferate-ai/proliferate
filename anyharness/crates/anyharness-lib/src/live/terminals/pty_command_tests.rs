use super::*;
use crate::domains::terminals::model::{TerminalCommandOutputMode, TerminalPurpose};
use crate::domains::terminals::store::TerminalStore;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

fn insert_test_workspace(db: &Db, id: &str, path: &str) {
    WorkspaceStore::new(db.clone())
        .insert(&WorkspaceRecord {
            id: id.to_string(),
            kind: "worktree".to_string(),
            repo_root_id: None,
            path: path.to_string(),
            surface: "standard".to_string(),
            source_repo_root_path: path.to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
        .expect("insert workspace");
}

#[test]
fn pty_command_parser_keeps_split_end_marker_pending() {
    let db = Db::open_in_memory().expect("open db");
    insert_test_workspace(&db, "workspace-1", "/tmp/workspace-1");
    let command_service = TerminalCommandService::new(TerminalStore::new(db));
    let mut record = new_command_run_record(
        "run-1",
        "workspace-1",
        Some("terminal-1"),
        TerminalPurpose::Run,
        "echo hello",
        TerminalCommandOutputMode::Combined,
    );
    record.status = TerminalCommandRunStatus::Running;
    command_service
        .insert_command_run(&record)
        .expect("insert run");

    let mut active = ActivePtyCommand {
        command_run_id: "run-1".to_string(),
        nonce: "nonce".to_string(),
        script_path: PathBuf::from("/tmp/missing-anyharness-test-script"),
        buffer: String::new(),
        capturing: false,
        combined: String::new(),
        output_truncated: false,
        last_captured_ended_with_newline: true,
        timed_out: false,
        timeout_task: None,
        started_at: Instant::now(),
    };
    let mut completed = None;

    let output = filter_pty_command_output(
        &mut active,
        b"echo wrapper\n__ANYHARNESS_CMD_START_nonce__\nhello\n__ANYHARNESS_CMD_EN",
        &command_service,
        &mut completed,
    )
    .expect("filter first chunk");

    assert_eq!(String::from_utf8(output).expect("utf8"), "hello\n");
    assert!(completed.is_none());
    assert_eq!(active.buffer, "__ANYHARNESS_CMD_EN");

    let output = filter_pty_command_output(
        &mut active,
        b"D_nonce_0__\n$ ",
        &command_service,
        &mut completed,
    )
    .expect("filter second chunk");

    assert_eq!(String::from_utf8(output).expect("utf8"), "$ ");
    let completed = completed.expect("command completed");
    assert_eq!(completed.status, TerminalCommandRunStatus::Succeeded);
    assert_eq!(completed.combined_output.as_deref(), Some("hello\n"));
}

#[test]
fn pty_command_parser_keeps_prompt_on_next_line_for_output_without_newline() {
    let db = Db::open_in_memory().expect("open db");
    insert_test_workspace(&db, "workspace-1", "/tmp/workspace-1");
    let command_service = TerminalCommandService::new(TerminalStore::new(db));
    let mut record = new_command_run_record(
        "run-1",
        "workspace-1",
        Some("terminal-1"),
        TerminalPurpose::Run,
        "printf hello",
        TerminalCommandOutputMode::Combined,
    );
    record.status = TerminalCommandRunStatus::Running;
    command_service
        .insert_command_run(&record)
        .expect("insert run");

    let mut active = ActivePtyCommand {
        command_run_id: "run-1".to_string(),
        nonce: "nonce".to_string(),
        script_path: PathBuf::from("/tmp/missing-anyharness-test-script"),
        buffer: String::new(),
        capturing: true,
        combined: String::new(),
        output_truncated: false,
        last_captured_ended_with_newline: true,
        timed_out: false,
        timeout_task: None,
        started_at: Instant::now(),
    };
    let mut completed = None;

    let output = filter_pty_command_output(
        &mut active,
        b"hello__ANYHARNESS_CMD_END_nonce_0__\r\n$ ",
        &command_service,
        &mut completed,
    )
    .expect("filter chunk");

    assert_eq!(String::from_utf8(output).expect("utf8"), "hello\r\n$ ");
    let completed = completed.expect("command completed");
    assert_eq!(completed.status, TerminalCommandRunStatus::Succeeded);
    assert_eq!(completed.combined_output.as_deref(), Some("hello"));
}

#[test]
fn pty_command_parser_uses_latest_output_for_prompt_spacing_after_truncation() {
    let db = Db::open_in_memory().expect("open db");
    insert_test_workspace(&db, "workspace-1", "/tmp/workspace-1");
    let command_service = TerminalCommandService::new(TerminalStore::new(db));
    let mut record = new_command_run_record(
        "run-1",
        "workspace-1",
        Some("terminal-1"),
        TerminalPurpose::Run,
        "printf tail",
        TerminalCommandOutputMode::Combined,
    );
    record.status = TerminalCommandRunStatus::Running;
    command_service
        .insert_command_run(&record)
        .expect("insert run");

    let mut active = ActivePtyCommand {
        command_run_id: "run-1".to_string(),
        nonce: "nonce".to_string(),
        script_path: PathBuf::from("/tmp/missing-anyharness-test-script"),
        buffer: String::new(),
        capturing: true,
        combined: format!("{}\n", "x".repeat(64 * 1024 - 1)),
        output_truncated: true,
        last_captured_ended_with_newline: true,
        timed_out: false,
        timeout_task: None,
        started_at: Instant::now(),
    };
    let mut completed = None;

    let output = filter_pty_command_output(
        &mut active,
        b"tail__ANYHARNESS_CMD_END_nonce_0__\r\n$ ",
        &command_service,
        &mut completed,
    )
    .expect("filter chunk");

    assert_eq!(String::from_utf8(output).expect("utf8"), "tail\r\n$ ");
    let completed = completed.expect("command completed");
    assert_eq!(completed.status, TerminalCommandRunStatus::Succeeded);
    assert!(completed.output_truncated);
}
