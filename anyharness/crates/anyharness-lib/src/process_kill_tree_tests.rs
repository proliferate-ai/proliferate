//! Unit tests for the Windows kill path's tree bookkeeping.
//!
//! These are NOT gated on Windows. The logic under test is pure `std`, so
//! `process_kill_tree.rs` is compiled under `cfg(any(windows, test))` and
//! every case here runs on the ordinary Linux and macOS test jobs on every
//! PR. That is deliberate: all of this covers the multi-pass escalation rung,
//! which the real-process Windows integration test never reaches because its
//! tree dies on the first `TerminateProcess` pass.
//!
//! Every test below states the mechanism it pins and what deleting that
//! mechanism does to it. A test that still passes with the mechanism removed
//! is not evidence, and two earlier versions of this file were exactly that.

use std::collections::HashMap;

use super::*;

fn entry(pid: u32, parent: u32, exe: &str) -> ProcessEntry {
    ProcessEntry {
        pid,
        parent,
        exe: exe.to_string(),
    }
}

/// A creation-time oracle: whatever is not listed is unreadable.
fn clock(pairs: &[(u32, Generation)]) -> impl FnMut(u32) -> Option<Generation> {
    let times: HashMap<u32, Generation> = pairs.iter().copied().collect();
    move |pid| times.get(&pid).copied()
}

fn pids(entries: &[ProcessEntry]) -> Vec<u32> {
    entries.iter().map(|entry| entry.pid).collect()
}

#[test]
fn executable_name_stops_at_the_nul_terminator() {
    let mut raw = [0u16; 260];
    for (slot, unit) in raw.iter_mut().zip("git.exe".encode_utf16()) {
        *slot = unit;
    }
    assert_eq!(executable_name(&raw), "git.exe");
}

/// Pins the `git.exe` comparison. The unix path compares the base name
/// against exactly `"git"`; this asserts directly that doing so here would
/// count zero, which is what would silently flip `repair_kill_debris`'s
/// refusal (it branches on `killed_git > 0`).
#[test]
fn the_census_counts_git_exe_where_an_exact_git_comparison_would_count_zero() {
    let tree = vec![
        entry(100, 1, "cmd.exe"),
        entry(200, 100, "git.exe"),
        entry(300, 100, "GIT.EXE"),
    ];
    assert_eq!(census(&tree), (3, 2));

    let unix_style = tree.iter().filter(|entry| entry.exe == "git").count();
    assert_eq!(
        unix_style, 0,
        "the unix comparison must be shown to fail here, or this test proves nothing"
    );

    // ...and it must not over-match either.
    assert!(!is_git_executable("gitk.exe"));
    assert!(!is_git_executable("legit.exe"));
    assert!(!is_git_executable("git.exe.bak"));
}

#[test]
fn absorb_collects_the_whole_descendant_tree_root_first() {
    let snapshot = vec![
        entry(1, 0, "System.exe"),
        entry(400, 1, "unrelated.exe"),
        entry(100, 1, "agent.exe"),
        entry(300, 200, "git.exe"),
        entry(200, 100, "cmd.exe"),
    ];
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    let alive = tracker.absorb(
        &snapshot,
        &mut clock(&[(100, 10), (200, 20), (300, 30), (400, 5)]),
    );
    // Root first, then each generation: the pass is terminated in reverse, so
    // the grandchild dies before the shell that owns it.
    assert_eq!(pids(&alive), vec![100, 200, 300]);
    assert_eq!(census(&alive), (3, 1));
}

#[test]
fn absorb_never_adopts_the_runtimes_own_process() {
    let snapshot = vec![
        entry(100, 1, "agent.exe"),
        entry(9999, 100, "anyharness.exe"),
    ];
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    let alive = tracker.absorb(&snapshot, &mut clock(&[(100, 10), (9999, 20)]));
    assert_eq!(pids(&alive), vec![100]);
}

/// B1. A stale `th32ParentProcessID` must not make a stranger a descendant.
///
/// A long-lived process whose creator exited keeps pointing at that freed
/// number. When Windows hands the number to our agent child, a walk that
/// trusts the link adopts the stranger and terminates it. Reproduced before
/// the fix as `TerminateProcess` on `[8432, 5000, 5001, 5002]` with a census
/// of `(4, 1)`.
///
/// NEGATIVE CONTROL: delete the `child_generation < parent_generation`
/// rejection in `absorb` and this returns exactly that list and that census.
#[test]
fn absorb_refuses_a_stranger_reached_through_a_stale_parent_link() {
    // The strangers are all far OLDER than the root, which is the invariant
    // the fix leans on: for the link to be stale, the number's previous owner
    // had to exit before our root could acquire it, so anything it spawned
    // predates our root.
    let snapshot = vec![
        entry(8432, 1, "agent.exe"),
        entry(5000, 8432, "stranger.exe"),
        entry(5001, 5000, "stranger-child.exe"),
        entry(5002, 5001, "git.exe"),
    ];
    let mut tracker = TreeTracker::new(8432, Some(1000), 9999);
    let alive = tracker.absorb(
        &snapshot,
        &mut clock(&[(8432, 1000), (5000, 10), (5001, 11), (5002, 12)]),
    );
    assert_eq!(pids(&alive), vec![8432]);
    assert_eq!(census(&alive), (1, 0));
}

/// The complement of the test above, and the reason the B1 fix is a
/// generation COMPARISON rather than a blanket refusal: a real descendant is
/// always created after its parent and must still be adopted.
///
/// NEGATIVE CONTROL: "fix" B1 by refusing every adoption and this goes red.
#[test]
fn absorb_still_adopts_a_genuine_child_created_after_its_parent() {
    let snapshot = vec![entry(8432, 1, "agent.exe"), entry(9000, 8432, "git.exe")];
    let mut tracker = TreeTracker::new(8432, Some(1000), 9999);
    let alive = tracker.absorb(&snapshot, &mut clock(&[(8432, 1000), (9000, 1001)]));
    assert_eq!(pids(&alive), vec![8432, 9000]);
    assert_eq!(census(&alive), (2, 1));
}

/// B1, second hole: a pid can be recycled while it is ALREADY tracked, if it
/// dies and is reassigned between two passes so we never observe it missing.
/// Adoption checks cannot catch that, because an already-tracked pid is never
/// an adoption candidate. Only re-verifying identity every pass does.
///
/// NEGATIVE CONTROL: delete the identity-verification block at the top of
/// `absorb` and pid 200 stays tracked, so the stranger is terminated.
#[test]
fn absorb_drops_a_tracked_pid_that_was_recycled_between_passes() {
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    let first = tracker.absorb(
        &[entry(100, 1, "agent.exe"), entry(200, 100, "cmd.exe")],
        &mut clock(&[(100, 10), (200, 20)]),
    );
    assert_eq!(pids(&first), vec![100, 200]);

    // pid 200 died and was handed to something unrelated before we looked
    // again, so we never saw it vanish. Its creation time is the only thing
    // that gives it away.
    let second = tracker.absorb(
        &[entry(100, 1, "agent.exe"), entry(200, 999, "stranger.exe")],
        &mut clock(&[(100, 10), (200, 500)]),
    );
    assert_eq!(pids(&second), vec![100]);
}

/// An identity that cannot be READ is not an identity that has CHANGED. One
/// transient failure against the root must not drop it and report a live root
/// as dead - the same shape of bug as reading a failed enumeration as an empty
/// process table. The pid keeps its place and only loses the ability to prove
/// adoptions.
///
/// NEGATIVE CONTROL: change the `None` arm of the identity check back to
/// `self.tracked.remove(&pid)` and the first assertion goes red, because the
/// root vanishes from a pass in which it is plainly alive.
#[test]
fn absorb_keeps_a_tracked_pid_whose_identity_cannot_be_read() {
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    tracker.absorb(
        &[entry(100, 1, "agent.exe")],
        &mut clock(&[(100, 10), (200, 20)]),
    );

    // The creation-time read fails for the root this pass. It is still right
    // there in the snapshot.
    let snapshot = vec![entry(100, 1, "agent.exe"), entry(200, 100, "cmd.exe")];
    let degraded = tracker.absorb(&snapshot, &mut clock(&[(200, 20)]));
    assert_eq!(
        pids(&degraded),
        vec![100],
        "a live root must not be dropped"
    );

    // ...and the downgrade is real: nothing may be adopted through an
    // identity we can no longer confirm, even once reads start working again.
    let later = tracker.absorb(&snapshot, &mut clock(&[(100, 10), (200, 20)]));
    assert_eq!(pids(&later), vec![100]);
}

/// B3. A grandchild whose parent died inside the same interval must still be
/// adopted, through the parent's last known membership.
///
/// Reproduced before the fix as the confirmation pass returning `[]` and
/// reporting the tree DEAD while `git.exe` was still running, which is this
/// module's whole reason for existing, narrowed to a window.
///
/// NEGATIVE CONTROL: move the "drop the vanished" block back above the growth
/// loop in `absorb` and this returns `[100]`, losing pid 300 forever.
#[test]
fn absorb_adopts_a_grandchild_whose_parent_died_in_the_same_interval() {
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    tracker.absorb(
        &[entry(100, 1, "agent.exe"), entry(200, 100, "cmd.exe")],
        &mut clock(&[(100, 10), (200, 20)]),
    );

    // pid 200 is gone from this snapshot, but it spawned 300 before it died.
    let second = tracker.absorb(
        &[entry(100, 1, "agent.exe"), entry(300, 200, "git.exe")],
        &mut clock(&[(100, 10), (300, 30)]),
    );
    assert_eq!(pids(&second), vec![100, 300]);
    assert_eq!(census(&second), (2, 1));
}

/// The escalation rung end to end, which is the loop none of the real-process
/// tests reach: the tree is enumerated, partly dies, grows a new descendant
/// while the kill is in flight, and only then empties. Every pass must report
/// exactly what is still alive and ours.
#[test]
fn the_escalation_rung_tracks_a_tree_across_passes_until_it_empties() {
    let mut tracker = TreeTracker::new(100, Some(10), 9999);

    let pass_one = tracker.absorb(
        &[
            entry(100, 1, "agent.exe"),
            entry(200, 100, "cmd.exe"),
            entry(700, 1, "unrelated.exe"),
        ],
        &mut clock(&[(100, 10), (200, 20), (700, 5)]),
    );
    assert_eq!(pids(&pass_one), vec![100, 200]);

    // The shell survived the first TerminateProcess and started a new child.
    let pass_two = tracker.absorb(
        &[
            entry(100, 1, "agent.exe"),
            entry(200, 100, "cmd.exe"),
            entry(400, 200, "git.exe"),
            entry(700, 1, "unrelated.exe"),
        ],
        &mut clock(&[(100, 10), (200, 20), (400, 40), (700, 5)]),
    );
    assert_eq!(pids(&pass_two), vec![100, 200, 400]);

    // The root and the shell die; the grandchild is still up.
    let pass_three = tracker.absorb(
        &[entry(400, 200, "git.exe"), entry(700, 1, "unrelated.exe")],
        &mut clock(&[(400, 40), (700, 5)]),
    );
    assert_eq!(pids(&pass_three), vec![400]);

    // Everything ours is gone. The unrelated process must never be reported.
    let pass_four = tracker.absorb(&[entry(700, 1, "unrelated.exe")], &mut clock(&[(700, 5)]));
    assert!(pass_four.is_empty());
}

/// Fail-closed: with no provable identity for the root, no descendant can be
/// proven either, so the kill degrades to the root alone rather than guessing.
#[test]
fn absorb_adopts_nothing_when_the_roots_identity_is_unknown() {
    let snapshot = vec![entry(100, 1, "agent.exe"), entry(200, 100, "cmd.exe")];
    let mut tracker = TreeTracker::new(100, None, 9999);
    let alive = tracker.absorb(&snapshot, &mut clock(&[(200, 20)]));
    assert_eq!(pids(&alive), vec![100]);
}

/// A parent chain that cycles must be REPORTED as a cycle, not walked.
///
/// NEGATIVE CONTROL: delete the `seen` visited set in `depth_of` and the walk
/// runs to `DEPTH_LIMIT` and returns `Some(64)` instead of `None`, so this
/// goes red. Delete the loop bound as well and it does not terminate at all,
/// which is the reason both guards are there.
#[test]
fn depth_of_reports_a_cycle_rather_than_walking_it() {
    // 100 and 200 each claim the other as parent, and both end up tracked.
    let snapshot = vec![entry(100, 200, "agent.exe"), entry(200, 100, "cmd.exe")];
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    let alive = tracker.absorb(&snapshot, &mut clock(&[(100, 10), (200, 20)]));
    assert_eq!(pids(&alive), vec![100, 200]);

    let parents: HashMap<u32, u32> = snapshot
        .iter()
        .map(|entry| (entry.pid, entry.parent))
        .collect();
    assert_eq!(tracker.depth_of(100, &parents), None);
    assert_eq!(tracker.depth_of(200, &parents), None);
}

/// The acyclic counterpart, so the test above cannot be satisfied by a
/// `depth_of` that simply always returns `None`.
#[test]
fn depth_of_measures_an_ordinary_chain() {
    let snapshot = vec![
        entry(100, 1, "agent.exe"),
        entry(200, 100, "cmd.exe"),
        entry(300, 200, "git.exe"),
    ];
    let mut tracker = TreeTracker::new(100, Some(10), 9999);
    tracker.absorb(&snapshot, &mut clock(&[(100, 10), (200, 20), (300, 30)]));

    let parents: HashMap<u32, u32> = snapshot
        .iter()
        .map(|entry| (entry.pid, entry.parent))
        .collect();
    assert_eq!(tracker.depth_of(100, &parents), Some(0));
    assert_eq!(tracker.depth_of(200, &parents), Some(1));
    assert_eq!(tracker.depth_of(300, &parents), Some(2));
}
