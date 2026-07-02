use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

use super::ssh_tunnel::{
    append_common_ssh_options, command_output_error, normalize_port, parse_ssh_connection,
    redact_tokens, ssh_destination, wait_for_child_output, DEFAULT_ANYHARNESS_PORT,
};

const INSTALLER_SCRIPT: &str = include_str!("../../../../../install/proliferate-target-install.sh");
const SSH_INSTALL_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSshTargetRuntimeInput {
    ssh_host: String,
    ssh_user: String,
    ssh_port: Option<u16>,
    identity_file: Option<String>,
    remote_anyharness_port: Option<u16>,
    cloud_base_url: String,
    enrollment_token: String,
    anyharness_bearer_token: Option<String>,
    artifact_base_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallSshTargetRuntimeResult {
    stdout: String,
    stderr: String,
}

#[tauri::command]
pub async fn install_ssh_target_runtime(
    input: InstallSshTargetRuntimeInput,
) -> Result<InstallSshTargetRuntimeResult, String> {
    let cloud_base_url = input
        .cloud_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    let enrollment_token = input.enrollment_token.trim().to_string();
    if cloud_base_url.is_empty() {
        return Err("Cloud base URL is required.".to_string());
    }
    if enrollment_token.is_empty() {
        return Err("Enrollment token is required.".to_string());
    }
    let anyharness_bearer_token = input
        .anyharness_bearer_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let artifact_base_url = input
        .artifact_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let remote_anyharness_port = normalize_port(
        input.remote_anyharness_port,
        DEFAULT_ANYHARNESS_PORT,
        "Remote AnyHarness port",
    )?;
    let connection = parse_ssh_connection(
        input.ssh_host,
        input.ssh_user,
        input.ssh_port,
        input.identity_file,
    )?;

    tokio::task::spawn_blocking(move || {
        let mut command = Command::new("ssh");
        append_common_ssh_options(&mut command, &connection);
        command
            .arg("--")
            .arg(ssh_destination(&connection))
            .arg("sh")
            .arg("-s")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start SSH installer: {error}"))?;

        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Failed to open SSH installer stdin.".to_string())?;
            let payload = installer_payload(
                &cloud_base_url,
                &enrollment_token,
                anyharness_bearer_token.as_deref(),
                artifact_base_url.as_deref(),
                remote_anyharness_port,
            );
            stdin
                .write_all(payload.as_bytes())
                .map_err(|error| format!("Failed to stream installer over SSH: {error}"))?;
        }

        let mut secret_tokens: Vec<&str> = vec![&enrollment_token];
        if let Some(bearer) = anyharness_bearer_token.as_deref() {
            secret_tokens.push(bearer);
        }
        let output =
            wait_for_child_output(child, SSH_INSTALL_TIMEOUT, "SSH installer", &secret_tokens)?;
        let stdout = redact_tokens(output.stdout, &secret_tokens);
        let stderr = redact_tokens(output.stderr, &secret_tokens);
        if output.status.success() {
            Ok(InstallSshTargetRuntimeResult { stdout, stderr })
        } else {
            Err(command_output_error(
                "SSH installer failed",
                &stdout,
                &stderr,
                &secret_tokens,
            ))
        }
    })
    .await
    .map_err(|error| format!("SSH installer task failed: {error}"))?
}

fn installer_payload(
    cloud_base_url: &str,
    enrollment_token: &str,
    anyharness_bearer_token: Option<&str>,
    artifact_base_url: Option<&str>,
    remote_anyharness_port: u16,
) -> String {
    let mut payload = String::new();
    payload.push_str("set -eu\n");
    payload.push_str(&format!(
        "PROLIFERATE_CLOUD_URL={}\n",
        shell_quote(cloud_base_url),
    ));
    payload.push_str(&format!(
        "PROLIFERATE_ENROLLMENT_TOKEN={}\n",
        shell_quote(enrollment_token),
    ));
    if let Some(anyharness_bearer_token) = anyharness_bearer_token {
        payload.push_str(&format!(
            "PROLIFERATE_ANYHARNESS_BEARER_TOKEN={}\n",
            shell_quote(anyharness_bearer_token),
        ));
    }
    payload.push_str(&format!(
        "PROLIFERATE_ANYHARNESS_PORT={}\n",
        shell_quote(&remote_anyharness_port.to_string()),
    ));
    payload.push_str(&format!(
        "PROLIFERATE_ANYHARNESS_BASE_URL={}\n",
        shell_quote(&format!("http://127.0.0.1:{remote_anyharness_port}")),
    ));
    if let Some(artifact_base_url) = artifact_base_url {
        payload.push_str(&format!(
            "PROLIFERATE_ARTIFACT_BASE_URL={}\n",
            shell_quote(artifact_base_url),
        ));
    }
    payload.push('\n');
    payload.push_str(INSTALLER_SCRIPT);
    payload.push('\n');
    payload
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(test)]
mod tests {
    use super::{command_output_error, installer_payload, redact_tokens, INSTALLER_SCRIPT};

    fn env_prelude(payload: &str) -> &str {
        payload
            .split(INSTALLER_SCRIPT)
            .next()
            .expect("payload embeds the installer script")
    }

    #[test]
    fn installer_payload_includes_bearer_env_when_present() {
        let payload = installer_payload(
            "https://api.example.com",
            "enroll-token",
            Some("runtime-bearer"),
            Some("https://artifacts.example.com/releases"),
            18457,
        );
        assert!(payload.contains("PROLIFERATE_CLOUD_URL='https://api.example.com'\n"));
        assert!(payload.contains("PROLIFERATE_ENROLLMENT_TOKEN='enroll-token'\n"));
        assert!(payload.contains("PROLIFERATE_ANYHARNESS_BEARER_TOKEN='runtime-bearer'\n"));
        assert!(payload.contains("PROLIFERATE_ANYHARNESS_PORT='18457'\n"));
        assert!(payload.contains("PROLIFERATE_ANYHARNESS_BASE_URL='http://127.0.0.1:18457'\n"));
        assert!(payload
            .contains("PROLIFERATE_ARTIFACT_BASE_URL='https://artifacts.example.com/releases'\n"));
    }

    #[test]
    fn installer_payload_omits_bearer_env_when_absent() {
        let payload =
            installer_payload("https://api.example.com", "enroll-token", None, None, 8457);
        let prelude = env_prelude(&payload);
        assert!(!prelude.contains("PROLIFERATE_ANYHARNESS_BEARER_TOKEN"));
        assert!(!prelude.contains("PROLIFERATE_ARTIFACT_BASE_URL"));
    }

    #[test]
    fn installer_payload_shell_quotes_bearer() {
        let payload = installer_payload(
            "https://api.example.com",
            "enroll-token",
            Some("bear'er"),
            None,
            8457,
        );
        assert!(payload.contains("PROLIFERATE_ANYHARNESS_BEARER_TOKEN='bear'\"'\"'er'\n"));
    }

    #[test]
    fn redact_tokens_scrubs_every_secret() {
        let redacted = redact_tokens(
            "token=enroll-token bearer=runtime-bearer".to_string(),
            &["enroll-token", "runtime-bearer"],
        );
        assert_eq!(redacted, "token=[redacted] bearer=[redacted]");
    }

    #[test]
    fn command_output_error_redacts_secrets_in_detail() {
        let error = command_output_error(
            "SSH installer failed",
            "stdout mentions enroll-token",
            "stderr mentions runtime-bearer",
            &["enroll-token", "runtime-bearer"],
        );
        assert!(!error.contains("enroll-token"));
        assert!(!error.contains("runtime-bearer"));
        assert!(error.contains("[redacted]"));
    }
}
