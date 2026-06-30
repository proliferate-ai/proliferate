use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use super::super::types::{ProcessServiceError, RunProcessRequest, RunProcessResult};
use crate::process_env::remove_runtime_private_env;

pub async fn run_command(
    workspace_path: &Path,
    request: RunProcessRequest,
) -> Result<RunProcessResult, ProcessServiceError> {
    if request.command.is_empty() {
        return Err(ProcessServiceError::EmptyCommand);
    }

    let cwd = resolve_cwd(workspace_path, request.cwd.as_deref())?;
    let timeout_ms = request.timeout_ms.unwrap_or(30_000);
    let max_output_bytes = request.max_output_bytes.unwrap_or(1_048_576);

    let program = &request.command[0];
    let args = &request.command[1..];

    let mut command = tokio::process::Command::new(program);
    command.args(args).current_dir(&cwd).envs(request.env);
    remove_runtime_private_env(&mut command);

    let result = tokio::time::timeout(Duration::from_millis(timeout_ms), command.output()).await;

    match result {
        Ok(Ok(output)) => Ok(RunProcessResult {
            stdout: truncate_output(&output.stdout, max_output_bytes),
            stderr: truncate_output(&output.stderr, max_output_bytes),
            exit_code: output.status.code().unwrap_or(-1),
        }),
        Ok(Err(error)) => Err(ProcessServiceError::CommandFailed(error.to_string())),
        Err(_) => Err(ProcessServiceError::TimedOut),
    }
}

fn resolve_cwd(workspace_path: &Path, cwd: Option<&str>) -> Result<PathBuf, ProcessServiceError> {
    let workspace_root = workspace_path
        .canonicalize()
        .map_err(|_| ProcessServiceError::CwdEscape)?;

    let Some(cwd) = cwd else {
        return Ok(workspace_root);
    };

    let relative = Path::new(cwd);
    if relative.is_absolute() {
        return Err(ProcessServiceError::CwdEscape);
    }

    for component in relative.components() {
        match component {
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(ProcessServiceError::CwdEscape);
            }
            _ => {}
        }
    }

    let candidate = workspace_root.join(relative);
    if candidate.exists() {
        let canonical = candidate
            .canonicalize()
            .map_err(|_| ProcessServiceError::CwdEscape)?;
        if !canonical.starts_with(&workspace_root) {
            return Err(ProcessServiceError::CwdEscape);
        }
        return Ok(canonical);
    }

    if let Some(parent) = candidate.parent() {
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|_| ProcessServiceError::CwdEscape)?;
            if !canonical_parent.starts_with(&workspace_root) {
                return Err(ProcessServiceError::CwdEscape);
            }
        }
    }

    Ok(candidate)
}

fn truncate_output(output: &[u8], max_output_bytes: usize) -> String {
    let text = String::from_utf8_lossy(output);
    if text.len() <= max_output_bytes {
        return text.into_owned();
    }

    let mut end = max_output_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::{resolve_cwd, run_command};
    use crate::adapters::processes::types::RunProcessRequest;
    use std::path::PathBuf;

    fn make_temp_workspace() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-processes-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("workspace dir");
        path
    }

    #[test]
    fn rejects_parent_directory_escape() {
        let workspace = make_temp_workspace();
        let error = resolve_cwd(&workspace, Some("../escape")).unwrap_err();
        assert!(matches!(error, super::ProcessServiceError::CwdEscape));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn keeps_relative_paths_inside_workspace() {
        let workspace = make_temp_workspace();
        std::fs::create_dir_all(workspace.join("nested")).expect("nested dir");

        let resolved = resolve_cwd(&workspace, Some("nested")).expect("resolve nested cwd");

        assert_eq!(
            resolved,
            workspace
                .join("nested")
                .canonicalize()
                .expect("canonical nested")
        );
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn applies_request_environment_to_command() {
        let workspace = make_temp_workspace();

        let result = run_command(
            &workspace,
            RunProcessRequest {
                command: vec![
                    "sh".to_string(),
                    "-c".to_string(),
                    "printf '%s' \"$PROCESS_ENV_TEST\"".to_string(),
                ],
                cwd: None,
                env: vec![("PROCESS_ENV_TEST".to_string(), "from-env".to_string())],
                timeout_ms: Some(5_000),
                max_output_bytes: None,
            },
        )
        .await
        .expect("run command");

        assert_eq!(result.stdout, "from-env");
        let _ = std::fs::remove_dir_all(workspace);
    }
}
