use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use url::Url;

use super::managed_npm::{apply_npm_version_override, npm_package_name, npm_package_version};
use super::npm::{install_managed_npm_package, run_command_capture, TempDirGuard};
use super::InstallError;

#[test]
fn npm_version_override_rewrites_scoped_and_unscoped_packages() {
    assert_eq!(
        apply_npm_version_override("@proliferate/claude-agent-acp@0.24.2", Some("0.25.0")),
        "@proliferate/claude-agent-acp@0.25.0"
    );
    assert_eq!(
        apply_npm_version_override("@proliferate/claude-agent-acp", Some("0.25.0")),
        "@proliferate/claude-agent-acp@0.25.0"
    );
    assert_eq!(
        apply_npm_version_override("example-acp@1.0.0", Some("1.2.3")),
        "example-acp@1.2.3"
    );
    assert_eq!(
        apply_npm_version_override("example-acp", Some("1.2.3")),
        "example-acp@1.2.3"
    );
    assert_eq!(
        apply_npm_version_override(
            "git+https://github.com/proliferate-ai/claude-agent-acp.git#48cc672",
            Some("main")
        ),
        "git+https://github.com/proliferate-ai/claude-agent-acp.git#main"
    );
}

#[test]
fn detects_versions_from_pinned_package_specs() {
    assert_eq!(
        npm_package_version("@proliferate/claude-agent-acp@0.24.2"),
        Some("0.24.2".into())
    );
    assert_eq!(npm_package_version("@proliferate/claude-agent-acp"), None);
    assert_eq!(
        npm_package_version("example-acp@1.2.3"),
        Some("1.2.3".into())
    );
    assert_eq!(npm_package_version("example-acp"), None);
    assert_eq!(
        npm_package_version("git+https://github.com/proliferate-ai/claude-agent-acp.git#48cc672"),
        Some("48cc672".into())
    );
}

#[test]
fn extracts_registry_package_names() {
    assert_eq!(
        npm_package_name("@proliferateai/codex-acp@latest"),
        Some("@proliferateai/codex-acp")
    );
    assert_eq!(
        npm_package_name("@proliferateai/codex-acp"),
        Some("@proliferateai/codex-acp")
    );
    assert_eq!(npm_package_name("example-acp@1.2.3"), Some("example-acp"));
    assert_eq!(npm_package_name("example-acp"), Some("example-acp"));
    assert_eq!(
        npm_package_name("git+https://github.com/proliferate-ai/codex-acp.git#main"),
        None
    );
}

#[test]
fn managed_npm_package_without_subdir_still_installs_directly() {
    let package_root = TempDirGuard::new("npm-direct-package").expect("temp dir");
    write_test_npm_package(
        package_root.path(),
        "direct-test-agent",
        "direct-test-agent",
    );
    let managed_dir = TempDirGuard::new("npm-direct-managed").expect("managed dir");
    let launcher_path = managed_dir.path().join("direct-test-agent-launcher");
    let launcher_args = vec!["--flag".to_string(), "value with space".to_string()];

    let result = install_managed_npm_package(
        &format!("file:{}", package_root.path().display()),
        None,
        None,
        Path::new("node_modules/.bin/direct-test-agent"),
        managed_dir.path(),
        &launcher_path,
        None,
        true,
        &launcher_args,
        &[],
        &HashMap::new(),
        "managed_npm",
    )
    .expect("direct install should succeed");

    assert!(result.is_some());
    assert!(launcher_path.exists());
    assert!(managed_dir
        .path()
        .join("node_modules/.bin/direct-test-agent")
        .exists());
    let launcher = fs::read_to_string(&launcher_path).expect("read launcher");
    assert!(launcher.contains("--flag 'value with space' \"$@\""));
}

#[test]
fn managed_npm_package_with_subdir_rejects_registry_specs() {
    let managed_dir = TempDirGuard::new("npm-invalid-managed").expect("managed dir");
    let launcher_path = managed_dir.path().join("invalid-launcher");
    let error = install_managed_npm_package(
        "@proliferate/claude-agent-acp",
        Some(Path::new("npm")),
        None,
        Path::new("node_modules/.bin/claude-agent-acp"),
        managed_dir.path(),
        &launcher_path,
        None,
        true,
        &[],
        &[],
        &HashMap::new(),
        "managed_npm",
    )
    .expect_err("registry package with subdir should be rejected");

    assert!(
        matches!(error, InstallError::InvalidInstallSpec(message) if message.contains("package_subdir is only supported"))
    );
}

#[test]
fn managed_npm_package_with_subdir_installs_from_local_git_repo() {
    let repo_root = TempDirGuard::new("npm-git-source").expect("repo dir");
    let package_root = repo_root.path().join("npm");
    write_test_npm_package(&package_root, "git-test-agent", "git-test-agent");
    run_command_capture(
        "git",
        Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(repo_root.path()),
    )
    .expect("git init");
    run_command_capture(
        "git",
        Command::new("git").arg("-C").arg(repo_root.path()).args([
            "config",
            "user.email",
            "test@example.com",
        ]),
    )
    .expect("git email");
    run_command_capture(
        "git",
        Command::new("git").arg("-C").arg(repo_root.path()).args([
            "config",
            "user.name",
            "Test User",
        ]),
    )
    .expect("git name");
    run_command_capture(
        "git",
        Command::new("git")
            .arg("-C")
            .arg(repo_root.path())
            .arg("add")
            .arg("."),
    )
    .expect("git add");
    run_command_capture(
        "git",
        Command::new("git")
            .arg("-C")
            .arg(repo_root.path())
            .args(["commit", "--quiet", "-m", "initial"]),
    )
    .expect("git commit");
    let rev_parse = run_command_capture(
        "git",
        Command::new("git")
            .arg("-C")
            .arg(repo_root.path())
            .args(["rev-parse", "HEAD"]),
    )
    .expect("git rev-parse");
    let revision = String::from_utf8_lossy(&rev_parse.stdout)
        .trim()
        .to_string();
    let repo_url = Url::from_directory_path(repo_root.path())
        .expect("file url")
        .to_string();

    let managed_dir = TempDirGuard::new("npm-git-managed").expect("managed dir");
    let launcher_path = managed_dir.path().join("git-test-agent-launcher");
    let result = install_managed_npm_package(
        &format!("git+{repo_url}#{revision}"),
        Some(Path::new("npm")),
        None,
        Path::new("node_modules/.bin/git-test-agent"),
        managed_dir.path(),
        &launcher_path,
        None,
        true,
        &[],
        &[],
        &HashMap::new(),
        "managed_npm",
    )
    .expect("git subdir install should succeed");

    assert!(result.is_some());
    assert!(launcher_path.exists());
    assert!(managed_dir
        .path()
        .join("node_modules/.bin/git-test-agent")
        .exists());
}

#[test]
fn managed_npm_package_can_build_agent_binary_from_source() {
    let repo_root = TempDirGuard::new("source-build-agent").expect("repo dir");
    fs::create_dir_all(repo_root.path().join("src")).expect("create src dir");
    fs::write(
        repo_root.path().join("Cargo.toml"),
        r#"[package]
name = "source-build-agent"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "source-build-agent"
path = "src/main.rs"
"#,
    )
    .expect("write Cargo.toml");
    fs::write(
        repo_root.path().join("src/main.rs"),
        "fn main() { println!(\"ok\"); }\n",
    )
    .expect("write main.rs");

    let managed_dir = TempDirGuard::new("source-build-managed").expect("managed dir");
    let launcher_path = managed_dir.path().join("source-build-agent-launcher");
    let result = install_managed_npm_package(
        &format!("file:{}", repo_root.path().display()),
        None,
        Some("source-build-agent"),
        Path::new("source-build-agent"),
        managed_dir.path(),
        &launcher_path,
        None,
        true,
        &[],
        &[],
        &HashMap::new(),
        "managed_npm",
    )
    .expect("source build install should succeed");

    assert!(result.is_some());
    assert!(launcher_path.exists());
    assert!(managed_dir.path().join("source-build-agent").exists());
}

#[test]
fn run_command_capture_includes_exit_status_with_stderr() {
    let error = run_command_capture(
        "sh",
        Command::new("sh")
            .arg("-c")
            .arg("echo compiling >&2; exit 9"),
    )
    .expect_err("command should fail");

    assert!(
        matches!(error, InstallError::CommandFailed { message, .. } if message.contains("exit status 9") && message.contains("compiling"))
    );
}

fn write_test_npm_package(package_root: &Path, package_name: &str, bin_name: &str) {
    fs::create_dir_all(package_root.join("bin")).expect("create bin dir");
    fs::write(
        package_root.join("package.json"),
        format!(
            "{{\n  \"name\": \"{package_name}\",\n  \"version\": \"0.0.1\",\n  \"bin\": {{ \"{bin_name}\": \"bin/{bin_name}.js\" }},\n  \"files\": [\"bin\"]\n}}\n"
        ),
    )
    .expect("write package.json");
    fs::write(
        package_root.join("bin").join(format!("{bin_name}.js")),
        "#!/usr/bin/env node\nconsole.log('ok');\n",
    )
    .expect("write bin");
}
