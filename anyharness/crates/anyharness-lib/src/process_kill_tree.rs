//! Process-tree bookkeeping for the Windows kill path, with no FFI in it.
//!
//! Split out from `process_kill_windows.rs` deliberately. Everything here is
//! `std::collections`, `String` and a `[u16; 260]` decode, so gating it
//! `#[cfg(any(windows, test))]` lets the whole of it compile and RUN on the
//! ordinary Linux and macOS test jobs, on every PR. That matters more than it
//! looks: the two bugs this module exists to prevent (adopting a stranger
//! through a stale parent link, and stranding a grandchild whose parent died
//! mid-kill) both live in the multi-pass escalation rung, which a real-process
//! Windows test never reaches because its tree dies on the first pass. Pure
//! logic tested everywhere beats FFI logic tested nowhere.
//!
//! `process_kill_windows.rs` supplies the two things that genuinely need
//! Windows - the Toolhelp enumeration and the creation-time read - and hands
//! them in.

use std::collections::{HashMap, HashSet};

/// Cap on the parent-chain walk that orders a pass deepest-first. A chain
/// longer than this is truncated for ordering purposes; a chain that CYCLES
/// is reported separately (see [`TreeTracker::depth_of`]).
const DEPTH_LIMIT: u32 = 64;

/// A process's creation time in FILETIME ticks. This is the generation
/// counter a bare pid does not have: two processes can share a pid over time
/// but never a (pid, creation time) pair.
pub(super) type Generation = u64;

/// One row of a Toolhelp process snapshot. The base executable name comes
/// back in the same read as the parent link, so unlike the unix path the
/// `git` census costs no extra per-pid syscall.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProcessEntry {
    pub(super) pid: u32,
    pub(super) parent: u32,
    pub(super) exe: String,
}

/// `szExeFile` is a fixed 260-wide buffer holding a NUL-terminated base name;
/// decoding the whole array would append the padding.
pub(super) fn executable_name(raw: &[u16; 260]) -> String {
    let end = raw.iter().position(|&unit| unit == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..end])
}

/// Whether a snapshot's base name is `git`. Windows file names are
/// case-insensitive and the executable carries an extension, so the unix
/// path's exact `"git"` comparison would count zero every time and quietly
/// change `repair_kill_debris`'s refusal behavior.
pub(super) fn is_git_executable(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    lowered == "git.exe" || lowered == "git"
}

/// The `(total, git)` census over an already-enumerated pass, taken BEFORE
/// anything is signaled for the same reason the unix path does it: counting
/// afterwards undercounts exactly the processes that died fastest.
pub(super) fn census(entries: &[ProcessEntry]) -> (usize, usize) {
    let git = entries
        .iter()
        .filter(|entry| is_git_executable(&entry.exe))
        .count();
    (entries.len(), git)
}

/// The set of pids belonging to one target tree, carried ACROSS enumeration
/// passes and keyed on identity rather than on a bare pid.
///
/// Two hazards this exists to close, both of them ways a plain
/// `th32ParentProcessID` walk gets the wrong answer:
///
/// **Stale parent links.** A pid is not an identity. A long-lived process
/// whose creator exited keeps pointing at that freed number, and when Windows
/// hands the number to our agent child the stranger looks like a descendant
/// and gets terminated. Adoption therefore requires the child's creation time
/// to be at or after the parent's.
///
/// What that buys, precisely: for a link to be stale, the number's previous
/// owner had to be alive when the stranger started and had to exit before our
/// root could acquire the number, so in real time the stranger STARTED before
/// our root did. A genuine child always starts after its parent. So the
/// comparison separates the two cases whenever the clock separates them.
///
/// What it does not buy: the comparison is on REPORTED `GetProcessTimes`
/// values, not on real time, and it admits equality. At an equal reported
/// timestamp a stranger is adopted. Equality has to be admitted anyway, or a
/// genuine child created inside the same tick as its parent leaks, so the
/// code is deliberately this way and the residual is the same-tick window
/// rather than a bug. How wide that window is depends on the sampling
/// resolution `GetProcessTimes` actually reports on a given machine, which
/// nothing here has measured; do not assume it is the 100ns the FILETIME
/// encoding suggests. Job Objects (see the module header's follow-up note)
/// remove the question rather than narrowing it.
///
/// An adoption whose generations cannot be read is refused outright, because
/// terminating a stranger is worse than leaking a descendant.
///
/// A pid can also be recycled while it is ALREADY tracked, if it dies and is
/// reassigned between two passes so we never observe it missing. Adoption
/// checks cannot help there, because an already-tracked pid is never a
/// candidate for adoption. Every pass therefore re-verifies the identity of
/// the pids it already holds and drops any whose creation time has CHANGED.
/// A time it cannot read is a different thing from a time that differs: the
/// pid keeps its place in the set, and only loses its ability to prove
/// adoptions. Treating unreadable as changed would let one transient failure
/// against the root drop it permanently and report a live root as dead, which
/// is the same shape of bug as reading a failed enumeration as an empty
/// process table.
/// That subsumes the weaker "never re-adopt a pid we have seen die" rule this
/// started with, which was redundant once identity is checked and which
/// leaked a genuine child that happened to reuse a retired number.
///
/// **Orphans are not re-parented.** Re-deriving the tree from the root each
/// pass would lose every survivor the moment the root died, so the set is
/// remembered. Growth runs BEFORE the vanished are dropped, so a grandchild
/// whose parent died inside that same interval is still adopted through the
/// parent's last known membership; dropping first would strand it forever,
/// which is this module's own defect narrowed to a window.
pub(super) struct TreeTracker {
    tracked: HashMap<u32, Option<Generation>>,
    self_pid: u32,
}

impl TreeTracker {
    pub(super) fn new(root: u32, root_generation: Option<Generation>, self_pid: u32) -> Self {
        let mut tracked = HashMap::new();
        tracked.insert(root, root_generation);
        Self { tracked, self_pid }
    }

    /// Adopt any provable new descendant, retire what vanished, and return
    /// the tracked processes this snapshot still lists, ordered root-first.
    ///
    /// `created_at` resolves a pid's creation time. It is a parameter rather
    /// than a direct syscall so this whole function is testable off Windows,
    /// and so the caller can memoize it: it costs an `OpenProcess` each.
    pub(super) fn absorb(
        &mut self,
        snapshot: &[ProcessEntry],
        created_at: &mut dyn FnMut(u32) -> Option<Generation>,
    ) -> Vec<ProcessEntry> {
        // VERIFY IDENTITY FIRST, so a number that changed hands between
        // passes can neither be terminated nor used as a parent. A stored
        // generation of `None` means the identity was never establishable, so
        // there is nothing to compare against and nothing may be adopted
        // through it anyway.
        let live_ids: Vec<u32> = snapshot
            .iter()
            .map(|entry| entry.pid)
            .filter(|pid| self.tracked.contains_key(pid))
            .collect();
        for pid in live_ids {
            let Some(Some(stored)) = self.tracked.get(&pid).copied() else {
                continue;
            };
            match created_at(pid) {
                // Same process we have been tracking all along.
                Some(current) if current == stored => {}
                // A different process holds this number now. Drop it: it is
                // not ours and must not be terminated or adopted through.
                Some(_) => {
                    self.tracked.remove(&pid);
                }
                // Unreadable, which is NOT evidence of a change. Keep it in
                // the set so a transient failure cannot report a live process
                // dead, but downgrade it so nothing can be adopted through an
                // identity we can no longer confirm. The downgrade is
                // permanent by design: a later successful read cannot tell us
                // whether it is reading the same process.
                None => {
                    self.tracked.insert(pid, None);
                }
            }
        }

        // GROW SECOND. A parent that died during this interval is still
        // tracked right now, and that is the only thing that lets its orphan
        // be adopted at all.
        loop {
            let mut grew = false;
            for entry in snapshot {
                if !self.may_adopt(entry) {
                    continue;
                }
                let Some(Some(parent_generation)) = self.tracked.get(&entry.parent).copied() else {
                    // Either the parent is not ours, or its identity was
                    // never established. Refuse rather than guess.
                    continue;
                };
                let Some(child_generation) = created_at(entry.pid) else {
                    continue;
                };
                if child_generation < parent_generation {
                    // A stale link: this process predates the pid it claims
                    // as its parent, so that number has been recycled since.
                    continue;
                }
                self.tracked.insert(entry.pid, Some(child_generation));
                grew = true;
            }
            if !grew {
                break;
            }
        }

        // DROP THE VANISHED LAST, after they have had their one chance to
        // pass on their orphans.
        let live: HashSet<u32> = snapshot.iter().map(|entry| entry.pid).collect();
        let vanished: Vec<u32> = self
            .tracked
            .keys()
            .copied()
            .filter(|pid| !live.contains(pid))
            .collect();
        for pid in vanished {
            self.tracked.remove(&pid);
        }

        let parents: HashMap<u32, u32> = snapshot
            .iter()
            .map(|entry| (entry.pid, entry.parent))
            .collect();
        let mut alive: Vec<ProcessEntry> = snapshot
            .iter()
            .filter(|entry| self.tracked.contains_key(&entry.pid))
            .cloned()
            .collect();
        alive.sort_by_key(|entry| {
            // An unresolvable chain sorts last, so it is terminated first.
            let depth = self
                .depth_of(entry.pid, &parents)
                .map_or((1u8, u32::MAX), |depth| (0u8, depth));
            (depth, entry.pid)
        });
        alive
    }

    /// Whether `entry` is even a candidate for adoption, before its identity
    /// is checked.
    fn may_adopt(&self, entry: &ProcessEntry) -> bool {
        // pid 0 is the idle process and is every unparented row's "parent";
        // letting it into the set would sweep the machine.
        entry.pid != 0
            && entry.pid != self.self_pid
            && entry.parent != entry.pid
            && !self.tracked.contains_key(&entry.pid)
    }

    /// Hops from `pid` up to the shallowest tracked ancestor, or `None` when
    /// the chain CYCLES. Ordering is the only consumer, so a chain deeper
    /// than [`DEPTH_LIMIT`] is truncated to it rather than treated as an
    /// error. A cycle is reported distinctly because it is a corrupt reading
    /// of the table, and because without the visited set the walk would not
    /// terminate at all.
    pub(super) fn depth_of(&self, pid: u32, parents: &HashMap<u32, u32>) -> Option<u32> {
        let mut seen = HashSet::new();
        seen.insert(pid);
        let mut cursor = pid;
        for depth in 0..DEPTH_LIMIT {
            let Some(&parent) = parents.get(&cursor) else {
                return Some(depth);
            };
            if !self.tracked.contains_key(&parent) {
                return Some(depth);
            }
            if !seen.insert(parent) {
                return None;
            }
            cursor = parent;
        }
        Some(DEPTH_LIMIT)
    }
}

#[cfg(test)]
#[path = "process_kill_tree_tests.rs"]
mod tests;
