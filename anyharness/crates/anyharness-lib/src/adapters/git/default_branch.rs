use std::path::Path;

use super::executor::run_git;

pub(super) fn detect_default_branch(repo_root: &Path) -> Option<String> {
    let out = run_git(repo_root, &["symbolic-ref", "refs/remotes/origin/HEAD"]).ok()?;
    if out.success {
        let refname = out.stdout.trim();
        return refname
            .strip_prefix("refs/remotes/origin/")
            .map(|s| s.to_string());
    }

    for candidate in &["main", "master", "develop"] {
        let check = run_git(
            repo_root,
            &["rev-parse", "--verify", &format!("refs/heads/{candidate}")],
        );
        if let Ok(o) = check {
            if o.success {
                return Some((*candidate).to_string());
            }
        }
    }
    None
}
