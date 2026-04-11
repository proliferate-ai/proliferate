use std::path::{Path, PathBuf};
use std::process::Command;

const COWORK_GITIGNORE: &str = "\
.cowork/tooling/react/node_modules/\n\
.cowork/tooling/react/.pnpm-store/\n\
.cowork/tooling/react/.npm/\n\
.cowork/tooling/react/.cache/\n\
";

pub fn backing_repo_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join("cowork").join("repo")
}

pub fn worktrees_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join("cowork").join("worktrees")
}

pub fn ensure_backing_repo(runtime_home: &Path) -> anyhow::Result<PathBuf> {
    let repo_root = backing_repo_root(runtime_home);
    std::fs::create_dir_all(worktrees_root(runtime_home))?;
    std::fs::create_dir_all(&repo_root)?;

    seed_repo_layout(&repo_root)?;

    if !repo_root.join(".git").exists() {
        run_git(&repo_root, &["init", "-b", "main"])?;
    }

    if !has_commit(&repo_root)? {
        run_git(&repo_root, &["add", "."])?;
        run_git(
            &repo_root,
            &[
                "-c",
                "user.name=AnyHarness",
                "-c",
                "user.email=anyharness@local",
                "commit",
                "-m",
                "Initialize Cowork backing repo",
            ],
        )?;
    }

    Ok(repo_root)
}

fn seed_repo_layout(repo_root: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(repo_root.join(".artifacts"))?;
    std::fs::create_dir_all(repo_root.join(".cowork").join("tooling").join("react"))?;
    std::fs::write(repo_root.join(".gitignore"), COWORK_GITIGNORE)?;

    ensure_file(repo_root.join(".artifacts").join(".gitkeep"))?;
    ensure_file(
        repo_root
            .join(".cowork")
            .join("tooling")
            .join("react")
            .join(".gitkeep"),
    )?;

    Ok(())
}

fn ensure_file(path: PathBuf) -> anyhow::Result<()> {
    if path.exists() {
        return Ok(());
    }
    std::fs::write(path, "")?;
    Ok(())
}

fn has_commit(repo_root: &Path) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(repo_root)
        .output()?;
    Ok(output.status.success())
}

fn run_git(repo_root: &Path, args: &[&str]) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("failed to run git {:?}: {error}", args))?;

    if output.status.success() {
        return Ok(());
    }

    anyhow::bail!(
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr).trim()
    )
}
