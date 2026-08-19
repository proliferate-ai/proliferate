use std::path::PathBuf;

use super::native_cli_path;
use crate::domains::agents::model::AgentKind;

#[test]
fn claude_executable_override_is_scoped_to_claude() {
    let managed_codex = PathBuf::from("/managed/codex");
    assert_eq!(
        native_cli_path(
            &AgentKind::Codex,
            Some(managed_codex.clone()),
            Some("/managed/claude")
        ),
        Some(managed_codex)
    );
    assert_eq!(
        native_cli_path(&AgentKind::OpenCode, None, Some("/managed/claude")),
        None
    );
    assert_eq!(
        native_cli_path(
            &AgentKind::Claude,
            Some(PathBuf::from("/fallback/claude")),
            Some("/managed/claude")
        ),
        Some(PathBuf::from("/managed/claude"))
    );
}
