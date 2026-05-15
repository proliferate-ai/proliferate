use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

use crate::error::WorkerError;

use super::{
    default_materialization_root,
    files::{ensure_no_symlink_path, expand_home, materialization_error},
    git_identity::target_git_paths,
};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnsureRepoCheckoutPayload {
    pub provider: String,
    pub owner: String,
    pub name: String,
    pub path: String,
    pub base_branch: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureRepoCheckoutOutcome {
    pub path: String,
    pub provider: String,
    pub owner: String,
    pub name: String,
    pub current_head: Option<String>,
    pub base_branch: Option<String>,
}

pub fn parse_ensure_repo_checkout_payload(
    payload: &serde_json::Value,
) -> Result<EnsureRepoCheckoutPayload, WorkerError> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        materialization_error(format!("invalid ensure_repo_checkout payload: {error}"))
    })
}

pub fn ensure_repo_checkout(
    allowed_root: Option<&Path>,
    payload: &EnsureRepoCheckoutPayload,
) -> Result<EnsureRepoCheckoutOutcome, WorkerError> {
    if payload.provider != "github" {
        return Err(materialization_error(
            "repo_access_denied: unsupported provider",
        ));
    }
    let git_paths = target_git_paths(allowed_root)?;
    if !git_paths.credentials.exists() || !git_paths.config.exists() {
        return Err(materialization_error(
            "target_git_not_ready: target Git identity is not configured",
        ));
    }
    let checkout_path = prepare_checkout_path(allowed_root, &payload.path)?;
    if !checkout_path.exists() {
        let parent = checkout_path.parent().ok_or_else(|| {
            materialization_error(format!(
                "repo_clone_failed: invalid checkout path {}",
                checkout_path.display()
            ))
        })?;
        std::fs::create_dir_all(parent).map_err(|source| WorkerError::CreateParent {
            path: parent.to_path_buf(),
            source,
        })?;
        let mut args = vec!["clone".to_string()];
        if let Some(branch) = payload
            .base_branch
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            args.push("--branch".to_string());
            args.push(branch.to_string());
        }
        args.push(repo_url(payload));
        args.push(checkout_path.to_string_lossy().to_string());
        run_git(None, &git_paths.config, &args)
            .map_err(|message| materialization_error(format!("repo_clone_failed: {message}")))?;
    } else {
        validate_existing_checkout(&checkout_path, &git_paths.config, payload)?;
        run_git(
            Some(&checkout_path),
            &git_paths.config,
            &[
                "fetch".to_string(),
                "--prune".to_string(),
                "origin".to_string(),
            ],
        )
        .map_err(|message| materialization_error(format!("repo_clone_failed: {message}")))?;
        checkout_base_branch(&checkout_path, &git_paths.config, payload)?;
    }
    configure_repo_git(&checkout_path, &git_paths.config)?;
    let current_head = run_git_capture(
        Some(&checkout_path),
        &git_paths.config,
        &["rev-parse".to_string(), "HEAD".to_string()],
    )
    .ok();
    Ok(EnsureRepoCheckoutOutcome {
        path: checkout_path.to_string_lossy().to_string(),
        provider: payload.provider.clone(),
        owner: payload.owner.clone(),
        name: payload.name.clone(),
        current_head: current_head.map(|value| value.trim().to_string()),
        base_branch: payload.base_branch.clone(),
    })
}

fn prepare_checkout_path(
    allowed_root: Option<&Path>,
    checkout_path: &str,
) -> Result<PathBuf, WorkerError> {
    let allowed_root = allowed_root
        .map(Path::to_path_buf)
        .unwrap_or_else(default_materialization_root);
    let allowed_root = allowed_root
        .to_str()
        .map(expand_home)
        .unwrap_or_else(|| allowed_root.to_path_buf());
    std::fs::create_dir_all(&allowed_root).map_err(|source| WorkerError::CreateParent {
        path: allowed_root.clone(),
        source,
    })?;
    let allowed_root = allowed_root
        .canonicalize()
        .map_err(|source| WorkerError::CreateParent {
            path: allowed_root.clone(),
            source,
        })?;
    let checkout_path = expand_home(checkout_path);
    ensure_no_symlink_path(&checkout_path)?;
    let comparable = if checkout_path.exists() {
        checkout_path
            .canonicalize()
            .map_err(|source| WorkerError::CreateParent {
                path: checkout_path.clone(),
                source,
            })?
    } else {
        nearest_existing_ancestor(&checkout_path)?
            .canonicalize()
            .map_err(|source| WorkerError::CreateParent {
                path: checkout_path.clone(),
                source,
            })?
    };
    if !comparable.starts_with(&allowed_root) {
        return Err(materialization_error(format!(
            "repo_clone_failed: checkout path {} is outside materialization root {}",
            checkout_path.display(),
            allowed_root.display()
        )));
    }
    Ok(checkout_path)
}

fn nearest_existing_ancestor(path: &Path) -> Result<&Path, WorkerError> {
    let mut current = path.parent().ok_or_else(|| {
        materialization_error(format!("invalid checkout path {}", path.display()))
    })?;
    loop {
        if current.exists() {
            return Ok(current);
        }
        current = current.parent().ok_or_else(|| {
            materialization_error(format!(
                "repo_clone_failed: no existing ancestor for checkout path {}",
                path.display()
            ))
        })?;
    }
}

fn validate_existing_checkout(
    checkout_path: &Path,
    config_path: &Path,
    payload: &EnsureRepoCheckoutPayload,
) -> Result<(), WorkerError> {
    if !checkout_path.join(".git").exists() {
        return Err(materialization_error(
            "repo_mismatch: checkout path exists but is not a git repository",
        ));
    }
    let remote = run_git_capture(
        Some(checkout_path),
        config_path,
        &[
            "remote".to_string(),
            "get-url".to_string(),
            "origin".to_string(),
        ],
    )
    .map_err(|message| materialization_error(format!("repo_mismatch: {message}")))?;
    if !remote_matches(remote.trim(), payload) {
        return Err(materialization_error(
            "repo_mismatch: existing checkout origin does not match requested repo",
        ));
    }
    Ok(())
}

fn configure_repo_git(checkout_path: &Path, config_path: &Path) -> Result<(), WorkerError> {
    let mut entries = vec![(
        "credential.helper".to_string(),
        format!(
            "store --file={}",
            config_path
                .parent()
                .unwrap_or(config_path)
                .join("credentials")
                .to_string_lossy()
        ),
    )];
    if let Ok(username) = run_git_capture(
        None,
        config_path,
        &[
            "config".to_string(),
            "--get".to_string(),
            "user.name".to_string(),
        ],
    ) {
        let username = username.trim();
        if !username.is_empty() {
            entries.push(("user.name".to_string(), username.to_string()));
        }
    }
    if let Ok(email) = run_git_capture(
        None,
        config_path,
        &[
            "config".to_string(),
            "--get".to_string(),
            "user.email".to_string(),
        ],
    ) {
        let email = email.trim();
        if !email.is_empty() {
            entries.push(("user.email".to_string(), email.to_string()));
        }
    }
    for (key, value) in entries {
        run_git(
            Some(checkout_path),
            config_path,
            &["config".to_string(), key, value],
        )
        .map_err(|message| materialization_error(format!("repo_clone_failed: {message}")))?;
    }
    Ok(())
}

fn checkout_base_branch(
    checkout_path: &Path,
    config_path: &Path,
    payload: &EnsureRepoCheckoutPayload,
) -> Result<(), WorkerError> {
    let Some(branch) = payload
        .base_branch
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    run_git(
        Some(checkout_path),
        config_path,
        &[
            "checkout".to_string(),
            "-B".to_string(),
            branch.to_string(),
            format!("origin/{branch}"),
        ],
    )
    .map_err(|message| {
        materialization_error(format!(
            "repo_clone_failed: failed to checkout base branch {branch}: {message}"
        ))
    })
}

fn repo_url(payload: &EnsureRepoCheckoutPayload) -> String {
    format!("https://github.com/{}/{}.git", payload.owner, payload.name)
}

fn remote_matches(remote: &str, payload: &EnsureRepoCheckoutPayload) -> bool {
    let suffix = format!("{}/{}.git", payload.owner, payload.name);
    let suffix_without_git = format!("{}/{}", payload.owner, payload.name);
    remote.ends_with(&suffix) || remote.ends_with(&suffix_without_git)
}

fn run_git(cwd: Option<&Path>, config_path: &Path, args: &[String]) -> Result<(), String> {
    run_git_capture(cwd, config_path, args).map(|_| ())
}

fn run_git_capture(
    cwd: Option<&Path>,
    config_path: &Path,
    args: &[String],
) -> Result<String, String> {
    let mut command = Command::new("git");
    command.args(args);
    command.env("GIT_CONFIG_GLOBAL", config_path);
    command.env("GIT_TERMINAL_PROMPT", "0");
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git exited with status {}", output.status)
    } else {
        stderr
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn existing_checkout_updates_to_requested_base_branch() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let root = temp_root("existing-checkout");
        let allowed_root = root.join("workspaces");
        fs::create_dir_all(&allowed_root).expect("create allowed root");
        write_target_git_files(&allowed_root);

        let remote = root
            .join("remotes")
            .join("proliferate-ai")
            .join("proliferate.git");
        fs::create_dir_all(remote.parent().expect("remote parent")).expect("create remote parent");
        run_plain(None, &["git", "init", "--bare", remote.to_str().unwrap()]);

        let source = root.join("source");
        run_plain(None, &["git", "init", source.to_str().unwrap()]);
        run_plain(Some(&source), &["git", "config", "user.name", "Test User"]);
        run_plain(
            Some(&source),
            &["git", "config", "user.email", "test@example.com"],
        );
        fs::write(source.join("README.md"), "one\n").expect("write source file");
        run_plain(Some(&source), &["git", "add", "README.md"]);
        run_plain(Some(&source), &["git", "commit", "-m", "one"]);
        run_plain(Some(&source), &["git", "branch", "-M", "main"]);
        run_plain(
            Some(&source),
            &["git", "remote", "add", "origin", remote.to_str().unwrap()],
        );
        run_plain(Some(&source), &["git", "push", "origin", "main"]);
        run_plain(
            Some(&remote),
            &["git", "symbolic-ref", "HEAD", "refs/heads/main"],
        );

        let checkout = allowed_root.join("repo");
        run_plain(
            None,
            &[
                "git",
                "clone",
                remote.to_str().unwrap(),
                checkout.to_str().unwrap(),
            ],
        );
        let old_head = git_capture(&checkout, &["rev-parse", "HEAD"]);

        fs::write(source.join("README.md"), "two\n").expect("update source file");
        run_plain(Some(&source), &["git", "add", "README.md"]);
        run_plain(Some(&source), &["git", "commit", "-m", "two"]);
        run_plain(Some(&source), &["git", "push", "origin", "main"]);
        let new_head = git_capture(&source, &["rev-parse", "HEAD"]);
        assert_ne!(old_head, new_head);

        let outcome = ensure_repo_checkout(
            Some(&allowed_root),
            &EnsureRepoCheckoutPayload {
                provider: "github".to_string(),
                owner: "proliferate-ai".to_string(),
                name: "proliferate".to_string(),
                path: checkout.to_string_lossy().to_string(),
                base_branch: Some("main".to_string()),
            },
        )
        .expect("ensure checkout");

        assert_eq!(outcome.current_head.as_deref(), Some(new_head.trim()));
        assert_eq!(git_capture(&checkout, &["rev-parse", "HEAD"]), new_head);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn checkout_path_outside_root_does_not_create_parent() {
        let root = temp_root("outside-root");
        let allowed_root = root.join("workspaces");
        fs::create_dir_all(&allowed_root).expect("create allowed root");
        write_target_git_files(&allowed_root);
        let outside = root.join("outside").join("repo");

        let result = ensure_repo_checkout(
            Some(&allowed_root),
            &EnsureRepoCheckoutPayload {
                provider: "github".to_string(),
                owner: "proliferate-ai".to_string(),
                name: "proliferate".to_string(),
                path: outside.to_string_lossy().to_string(),
                base_branch: Some("main".to_string()),
            },
        );

        assert!(result.is_err());
        assert!(!outside.parent().expect("outside parent").exists());
        let _ = fs::remove_dir_all(root);
    }

    fn write_target_git_files(root: &Path) {
        let git_root = root.join(".proliferate").join("target-git");
        fs::create_dir_all(&git_root).expect("create git root");
        fs::write(
            git_root.join("credentials"),
            "https://x-access-token:test@github.com\n",
        )
        .expect("write credentials");
        fs::write(
            git_root.join("gitconfig"),
            "[user]\n\tname = Test User\n\temail = test@example.com\n",
        )
        .expect("write git config");
    }

    fn temp_root(name: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::current_dir()
            .expect("current dir")
            .join("target")
            .join("tmp")
            .join(format!(
                "proliferate-worker-repo-checkout-{name}-{}-{now}",
                std::process::id()
            ))
    }

    fn run_plain(cwd: Option<&Path>, args: &[&str]) {
        let mut command = Command::new(args[0]);
        command.args(&args[1..]);
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let output = command.output().expect("run command");
        assert!(
            output.status.success(),
            "command failed: {:?}\nstdout: {}\nstderr: {}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_capture(cwd: &Path, args: &[&str]) -> String {
        let mut command = Command::new("git");
        command.args(args).current_dir(cwd);
        let output = command.output().expect("run git");
        assert!(
            output.status.success(),
            "git failed: {:?}\nstdout: {}\nstderr: {}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
}
