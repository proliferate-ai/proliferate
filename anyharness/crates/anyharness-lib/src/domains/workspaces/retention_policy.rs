//! Pure worktree-retention policy: the per-repo materialized-worktree cap.
//!
//! Everything here is data-in / data-out: no store, no clock, no uuid, no
//! `&self`. `retention.rs` (`WorkspaceRetentionService`) reads the clock and
//! calls the store; this module owns the decisions — whether a requested cap is
//! in bounds, what the resulting policy row should look like, and how many of a
//! repo's activity-ordered workspaces are kept.
//!
//! The row shape and its SQL live in `store/retention.rs`.

pub const DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO: u32 = 20;
pub const MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO: u32 = 10;
pub const MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO: u32 = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRetentionPolicyRecord {
    pub max_materialized_worktrees_per_repo: u32,
    pub updated_at: String,
}

/// The policy decision behind a cap-update request: reject out-of-bounds values,
/// otherwise return the row the caller should persist. `now` is the caller's
/// clock reading (the service mints it), keeping this fn pure.
pub fn decide_policy_update(
    max_materialized_worktrees_per_repo: u32,
    now: &str,
) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
    validate_max_materialized_worktrees_per_repo(max_materialized_worktrees_per_repo)?;
    Ok(WorktreeRetentionPolicyRecord {
        max_materialized_worktrees_per_repo,
        updated_at: now.to_string(),
    })
}

pub fn validate_max_materialized_worktrees_per_repo(value: u32) -> anyhow::Result<()> {
    if !(MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO..=MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO)
        .contains(&value)
    {
        anyhow::bail!(
            "maxMaterializedWorktreesPerRepo must be between {} and {}",
            MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO,
            MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO
        );
    }
    Ok(())
}

/// How many of a repo's activity-ordered workspaces the policy keeps. The
/// retention pass considers only the tail past this count; everything at or
/// before it is never a retirement candidate.
pub fn keep_count(policy: &WorktreeRetentionPolicyRecord) -> usize {
    policy.max_materialized_worktrees_per_repo as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-01-01T00:00:00Z";

    fn policy(max: u32) -> WorktreeRetentionPolicyRecord {
        WorktreeRetentionPolicyRecord {
            max_materialized_worktrees_per_repo: max,
            updated_at: NOW.to_string(),
        }
    }

    #[test]
    fn accepts_a_cap_inside_the_bounds() {
        let decided = decide_policy_update(20, NOW).expect("in-bounds cap");
        assert_eq!(decided, policy(20));
    }

    #[test]
    fn stamps_the_callers_clock_reading_rather_than_reading_one() {
        let decided = decide_policy_update(20, "2030-06-07T08:09:10Z").expect("in-bounds cap");
        assert_eq!(decided.updated_at, "2030-06-07T08:09:10Z");
    }

    #[test]
    fn accepts_the_minimum_boundary() {
        let decided = decide_policy_update(MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO, NOW)
            .expect("minimum is in bounds");
        assert_eq!(
            decided.max_materialized_worktrees_per_repo,
            MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO
        );
    }

    #[test]
    fn accepts_the_maximum_boundary() {
        let decided = decide_policy_update(MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO, NOW)
            .expect("maximum is in bounds");
        assert_eq!(
            decided.max_materialized_worktrees_per_repo,
            MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO
        );
    }

    #[test]
    fn rejects_one_below_the_minimum_boundary() {
        let error = decide_policy_update(MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO - 1, NOW)
            .expect_err("below minimum");
        assert_eq!(
            error.to_string(),
            "maxMaterializedWorktreesPerRepo must be between 10 and 100"
        );
    }

    #[test]
    fn rejects_one_above_the_maximum_boundary() {
        let error = decide_policy_update(MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO + 1, NOW)
            .expect_err("above maximum");
        assert_eq!(
            error.to_string(),
            "maxMaterializedWorktreesPerRepo must be between 10 and 100"
        );
    }

    #[test]
    fn rejects_zero() {
        assert!(decide_policy_update(0, NOW).is_err());
    }

    #[test]
    fn validation_matches_the_decision_at_every_boundary() {
        assert!(validate_max_materialized_worktrees_per_repo(
            MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO
        )
        .is_ok());
        assert!(validate_max_materialized_worktrees_per_repo(
            MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO
        )
        .is_ok());
        assert!(validate_max_materialized_worktrees_per_repo(
            MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO - 1
        )
        .is_err());
        assert!(validate_max_materialized_worktrees_per_repo(
            MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO + 1
        )
        .is_err());
    }

    #[test]
    fn keep_count_is_the_cap() {
        assert_eq!(keep_count(&policy(10)), 10);
        assert_eq!(
            keep_count(&policy(DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO)),
            DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO as usize
        );
        assert_eq!(keep_count(&policy(100)), 100);
    }

    #[test]
    fn default_cap_sits_inside_the_bounds() {
        assert!(validate_max_materialized_worktrees_per_repo(
            DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO
        )
        .is_ok());
    }
}
