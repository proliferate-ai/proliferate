use std::path::Path;

use crate::error::WorkerError;

use super::{
    files::{materialization_error, write_file},
    GitCredential,
};

pub fn write_git_materialization(
    workspace_root: &Path,
    credential: Option<&GitCredential>,
) -> Result<bool, WorkerError> {
    let Some(credential) = credential else {
        return Ok(false);
    };
    if credential.provider != "github" {
        return Err(materialization_error(format!(
            "unsupported git credential provider: {}",
            credential.provider
        )));
    }
    validate_git_config_value("accessToken", &credential.access_token)?;
    let git_dir = workspace_root.join(".proliferate").join("git");
    let credential_file = git_dir.join("credentials");
    let config_file = git_dir.join("gitconfig");
    let credentials = format!(
        "https://x-access-token:{}@github.com\n",
        credential.access_token
    );
    write_file(&credential_file, credentials.as_bytes(), true)?;
    let mut config = String::new();
    if let Some(username) = credential
        .username
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        validate_git_config_value("username", username)?;
        config.push_str("[user]\n");
        config.push_str("\tname = ");
        config.push_str(username);
        config.push('\n');
    }
    if let Some(email) = credential
        .email
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        validate_git_config_value("email", email)?;
        if !config.contains("[user]") {
            config.push_str("[user]\n");
        }
        config.push_str("\temail = ");
        config.push_str(email);
        config.push('\n');
    }
    config.push_str("[credential]\n");
    config.push_str("\thelper = store --file=");
    config.push_str(&credential_file.to_string_lossy());
    config.push('\n');
    write_file(&config_file, config.as_bytes(), true)?;
    Ok(true)
}

fn validate_git_config_value(field: &str, value: &str) -> Result<(), WorkerError> {
    if value.chars().any(|ch| ch.is_control()) {
        return Err(materialization_error(format!(
            "git credential {field} contains control characters"
        )));
    }
    Ok(())
}
