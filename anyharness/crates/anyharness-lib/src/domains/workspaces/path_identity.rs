//! The answer to "are these two recorded paths the same directory?".
//!
//! A plain string compare is wrong on every developer machine we ship to:
//! macOS aliases `/tmp` to `/private/tmp`, so two rows recording the same
//! directory under different spellings read as different paths — and the
//! archive path-claim gate, whose whole job is to refuse restoring over
//! another row's live worktree, would call an occupied path unclaimed.
//!
//! `std::fs::canonicalize` alone is not enough either, because the paths that
//! matter most are the ones that do NOT exist: an archived row's freed
//! directory, a target path about to be created. So resolution walks up to the
//! nearest existing ancestor, canonicalizes THAT, and re-attaches the
//! remainder.
//!
//! Only when nothing on the path resolves at all does the answer have to be
//! guessed, and the guess is not the same in both directions, because the
//! callers are not asking the same question. Both variants below degrade
//! AWAY from the destructive branch, which is what puts them in opposition:
//!
//! - [`same_path`] answers "does another row claim this directory?", where
//!   `true` refuses. Unresolvable degrades to `true`.
//! - [`same_path_strict`] answers "is this git registration ours?", where
//!   `true` admits a reclaim or a prune. Unresolvable degrades to `false`.
//!
//! Reaching for the wrong one silently inverts the fail-safe, so each function
//! names its callers.

use std::path::{Component, Path, PathBuf};

/// The comparable identity of `path`: the canonical form of its
/// deepest existing ancestor with the non-existent remainder re-attached, or
/// `None` when not even the root resolves.
pub fn resolve_for_comparison(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return Some(canonical);
    }
    let mut remainder: Vec<&std::ffi::OsStr> = Vec::new();
    let mut cursor = path;
    loop {
        let parent = cursor.parent()?;
        if let Some(name) = cursor.file_name() {
            remainder.push(name);
        }
        if let Ok(canonical) = std::fs::canonicalize(parent) {
            let mut resolved = canonical;
            for name in remainder.iter().rev() {
                resolved.push(name);
            }
            return Some(resolved);
        }
        parent.components().next()?;
        cursor = parent;
    }
}

/// Whether `left` and `right` name the same directory, for the callers whose
/// `true` answer REFUSES a destructive step: the path-claim gate
/// (`any_other_row_claims_path`, `other_rows_claiming_path`) and the sweep's
/// `claimed_by_any_row`. Unresolvable on either side means "assume yes",
/// because for those callers the conservative answer is the safe one.
///
/// The other question this module gets asked - "is this git registration OUR
/// row's?" - runs the other way: there a `true` answer ENABLES a reclaim or a
/// prune. That question uses [`same_path_strict`], and picking the wrong one
/// silently inverts the fail-safe.
pub fn same_path(left: &Path, right: &Path) -> bool {
    if lexically_equal(left, right) {
        return true;
    }
    match (resolve_for_comparison(left), resolve_for_comparison(right)) {
        (Some(left), Some(right)) => left == right,
        _ => true,
    }
}

/// [`same_path`] for the callers whose `true` answer ENABLES a destructive
/// step - the own-debris reclaim's "this registration is ours" and the sweep's
/// phantom-registration prune. An unresolvable comparison there must read as
/// SOMEONE ELSE'S path, or an unmounted volume turns a foreign registration
/// into ours and steers straight into the reclaim.
///
/// A lexical match still answers yes: two identical strings are the same path
/// on any filesystem, resolvable or not.
pub fn same_path_strict(left: &Path, right: &Path) -> bool {
    if lexically_equal(left, right) {
        return true;
    }
    matches!(
        (resolve_for_comparison(left), resolve_for_comparison(right)),
        (Some(left), Some(right)) if left == right
    )
}

fn lexically_equal(left: &Path, right: &Path) -> bool {
    normalize(left) == normalize(right)
}

/// Drops `.` components and trailing separators so `/a/b`, `/a/b/`, and
/// `/a/./b` compare equal without touching the filesystem. `..` is left alone
/// deliberately: collapsing it lexically is wrong across symlinks, and the
/// canonicalizing path above handles it correctly.
fn normalize(path: &Path) -> PathBuf {
    path.components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{resolve_for_comparison, same_path, same_path_strict};
    use std::path::{Path, PathBuf};

    fn temp_dir(prefix: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("anyharness-{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn trailing_separators_and_dot_components_compare_equal() {
        assert!(same_path(Path::new("/a/b"), Path::new("/a/b/")));
        assert!(same_path(Path::new("/a/b"), Path::new("/a/./b")));
        assert!(!same_path(Path::new("/a/b"), Path::new("/a/c")));
    }

    #[test]
    fn a_missing_leaf_still_resolves_through_its_existing_parent() {
        let parent = temp_dir("path-identity-missing-leaf");
        let missing = parent.join("not-created-yet");

        let resolved = resolve_for_comparison(&missing).expect("resolve through parent");

        assert_eq!(
            resolved,
            std::fs::canonicalize(&parent)
                .expect("canonicalize parent")
                .join("not-created-yet")
        );
        std::fs::remove_dir_all(&parent).ok();
    }

    /// The reason this module exists at all: on macOS `/tmp` is a symlink to
    /// `/private/tmp`, so two rows recording the same directory under
    /// different spellings must not read as different paths.
    #[test]
    fn two_spellings_of_one_directory_are_the_same_path() {
        let real = temp_dir("path-identity-alias");
        let canonical = std::fs::canonicalize(&real).expect("canonicalize");

        assert!(same_path(&real, &canonical));
        std::fs::remove_dir_all(&real).ok();
    }

    /// Different directories that both exist must still read as different —
    /// otherwise the conservative fallback would swallow every comparison and
    /// the claim gate would refuse everything.
    #[test]
    fn two_distinct_existing_directories_are_not_the_same_path() {
        let left = temp_dir("path-identity-left");
        let right = temp_dir("path-identity-right");

        assert!(!same_path(&left, &right));
        std::fs::remove_dir_all(&left).ok();
        std::fs::remove_dir_all(&right).ok();
    }

    /// The two fail-safes point in OPPOSITE directions, and this is the pair
    /// that proves it. A relative path whose first component does not exist
    /// resolves to nothing at all, which is the unmounted-volume shape: the
    /// claim gate must read it as a claim (refuse), and the reclaim/prune
    /// question must read it as somebody else's (also refuse).
    #[test]
    fn an_unresolvable_comparison_claims_but_never_reclaims() {
        let left = Path::new("anyharness-no-such-root-left/one");
        let right = Path::new("anyharness-no-such-root-right/two");
        assert!(resolve_for_comparison(left).is_none());
        assert!(resolve_for_comparison(right).is_none());

        assert!(
            same_path(left, right),
            "the claim gate's true answer refuses, so unresolvable means claimed"
        );
        assert!(
            !same_path_strict(left, right),
            "the reclaim's true answer force-removes, so unresolvable must never read as ours"
        );
    }

    /// ...and the strict variant still answers yes where it genuinely can:
    /// identical strings, and two spellings of one real directory.
    #[test]
    fn the_strict_variant_still_resolves_a_real_alias() {
        let real = temp_dir("path-identity-strict");
        let canonical = std::fs::canonicalize(&real).expect("canonicalize");

        assert!(same_path_strict(&real, &canonical));
        assert!(same_path_strict(Path::new("/a/b"), Path::new("/a/b/")));
        assert!(!same_path_strict(&real, Path::new("/a/b")));
        std::fs::remove_dir_all(&real).ok();
    }
}
