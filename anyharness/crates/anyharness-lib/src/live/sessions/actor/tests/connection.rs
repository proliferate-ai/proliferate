use super::*;

#[test]
fn sanitize_agent_stderr_line_strips_ansi_sequences() {
    let line = "\u{1b}[2m2026-03-28T03:11:55.593240Z\u{1b}[0m \u{1b}[32m INFO\u{1b}[0m codex_otel.log_only";

    assert_eq!(
        sanitize_agent_stderr_line(line),
        "2026-03-28T03:11:55.593240Z  INFO codex_otel.log_only"
    );
}

#[test]
fn classify_agent_stderr_line_downgrades_info_logs() {
    let line = "2026-03-28T03:11:55.593240Z INFO codex_otel.log_only";

    assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Debug);
}

#[test]
fn client_capabilities_preserve_codex_managed_gate() {
    let capabilities = build_client_capabilities(
        AgentKind::Codex.as_str(),
        &resolved_agent_with_source(AgentKind::Codex, "managed"),
    );

    assert_eq!(
        capability_bool(&capabilities, "codex", "requestUserInput"),
        Some(true)
    );
    assert_eq!(
        capability_bool(&capabilities, "codex", "mcpElicitation"),
        None
    );
    assert_eq!(
        capability_bool(&capabilities, "claude", "mcpElicitation"),
        None
    );
}

#[test]
fn client_capabilities_preserve_codex_override_gate() {
    let capabilities = build_client_capabilities(
        AgentKind::Codex.as_str(),
        &resolved_agent_with_source(AgentKind::Codex, "override"),
    );

    assert_eq!(
        capability_bool(&capabilities, "codex", "requestUserInput"),
        Some(true)
    );
    assert_eq!(
        capability_bool(&capabilities, "codex", "mcpElicitation"),
        Some(true)
    );
    assert_eq!(
        capability_bool(&capabilities, "claude", "mcpElicitation"),
        None
    );
}

#[test]
fn client_capabilities_advertise_claude_mcp_only() {
    let capabilities = build_client_capabilities(
        AgentKind::Claude.as_str(),
        &resolved_agent_with_source(AgentKind::Claude, "managed"),
    );

    assert_eq!(
        capability_bool(&capabilities, "claude", "mcpElicitation"),
        Some(true)
    );
    assert_eq!(
        capability_bool(&capabilities, "claude", "requestUserInput"),
        None
    );
    assert_eq!(
        capability_bool(&capabilities, "codex", "requestUserInput"),
        None
    );
}

#[test]
fn classify_agent_stderr_line_preserves_warnings() {
    let line = "2026-03-28T03:11:55.593240Z WARN auth refresh failed";

    assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Warn);
}

#[test]
fn classify_agent_stderr_line_preserves_errors() {
    let line = "2026-03-28T03:11:55.593240Z ERROR session crashed";

    assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Error);
}

#[test]
fn classify_agent_stderr_line_keeps_unknown_stderr_visible() {
    let line = "fatal: failed to resolve workspace";

    assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Warn);
}

#[test]
fn merge_spawn_env_prefers_session_launch_over_workspace_env() {
    let workspace_env = BTreeMap::from([
        (
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            "/workspace/bin/claude".to_string(),
        ),
        ("PATH".to_string(), "/usr/bin".to_string()),
    ]);
    let session_launch_env = BTreeMap::from([(
        "CLAUDE_CODE_EXECUTABLE".to_string(),
        "/managed/bin/claude".to_string(),
    )]);

    let merged = merge_spawn_env(&workspace_env, &session_launch_env, None);

    assert_eq!(
        merged.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
        Some("/managed/bin/claude")
    );
    assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
}

#[test]
fn merge_spawn_env_prefers_explicit_override_env_over_session_env() {
    let workspace_env = BTreeMap::from([("PATH".to_string(), "/usr/bin".to_string())]);
    let session_launch_env = BTreeMap::from([("DEBUG".to_string(), "0".to_string())]);
    let override_env = std::collections::HashMap::from([
        ("DEBUG".to_string(), "1".to_string()),
        ("FOO".to_string(), "bar".to_string()),
    ]);

    let merged = merge_spawn_env(&workspace_env, &session_launch_env, Some(&override_env));

    assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
    assert_eq!(merged.get("DEBUG").map(String::as_str), Some("1"));
    assert_eq!(merged.get("FOO").map(String::as_str), Some("bar"));
}

#[test]
fn build_system_prompt_meta_uses_append_shape() {
    let meta = build_system_prompt_meta(Some("Rename the branch")).expect("meta");

    assert_eq!(
        serialize_meta(Some(&meta)),
        Some(serde_json::json!({
            "systemPrompt": {
                "append": "Rename the branch",
            },
        }))
    );
}

#[test]
fn build_system_prompt_meta_skips_blank_values() {
    assert!(build_system_prompt_meta(None).is_none());
    assert!(build_system_prompt_meta(Some("   ")).is_none());
}

#[test]
fn missing_load_session_resource_matches_expected_uri() {
    let error = acp::Error::resource_not_found(Some("session-123".to_string()));
    assert!(is_missing_load_session_resource(&error, "session-123"));
    assert!(!is_missing_load_session_resource(&error, "session-xyz"));
}

#[test]
fn missing_load_session_resource_without_uri_still_matches() {
    let error = acp::Error::resource_not_found(None);
    assert!(is_missing_load_session_resource(&error, "session-123"));
}

#[test]
fn missing_load_session_resource_ignores_other_error_codes() {
    let error = acp::Error::internal_error().data(serde_json::json!({
        "uri": "session-123",
    }));
    assert!(!is_missing_load_session_resource(&error, "session-123"));
}
