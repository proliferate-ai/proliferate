//! The exit sequence's process reap: the agent's whole process GROUP dies
//! with its actor, not just the direct child.
//!
//! `kill_on_drop` is a crash backstop for the direct child only, and the
//! direct child is the ACP adapter. The vendor CLI it spawns is a grandchild,
//! and the measurement behind the idle reaper
//! (`delivery/idle-session-reaper/`) puts 64% of a session's memory in that
//! grandchild, so dropping the child alone turns a reclaim into a leak plus a
//! cold start.

use crate::live::sessions::actor::state::SessionActor;

/// How long the exit sequence waits to reap the agent child before giving up
/// on it. Sized to sit strictly ABOVE the escalation it runs beside (a 5s
/// TERM grace plus a 10s confirmation budget in `process_kill`), so it can
/// only ever expire on a child that survived a delivered SIGKILL - a D-state
/// process, or a group signal that reached nothing. Killing the wait is not
/// killing the process; it is refusing to trade the actor's whole remaining
/// lifetime for a reap that is not coming.
const REAP_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);

impl SessionActor {
    /// TERM the agent's process group, KILL it after a 5s grace if it
    /// ignored the TERM, and await BOTH the group escalation's confirmation
    /// and this actor's own reap of `self.child` (an owned child left
    /// unreaped is a zombie, invisible to "kill(pid, 0)" but still occupying
    /// a slot the group enumeration would otherwise wait on forever).
    /// Returns the `(total, git)` census taken before signaling; `(0, 0)`
    /// means the group was already empty.
    pub(in crate::live::sessions::actor) async fn kill_process_group_and_reap(
        &mut self,
    ) -> (usize, usize) {
        let Some(pid) = self.child.id() else {
            return (0, 0);
        };
        // `spawn_agent_process` gives the child its own process group via
        // `process_group(0)`, which makes the child's own pid the pgid.
        let pgid = pid as i32;
        if !child_leads_its_own_group(pgid) {
            // The child is in somebody else's group, so a group kill aimed at
            // its pid signals nothing, and the wait below would then burn the
            // whole reap budget waiting for a process nobody told to die.
            // Production never spawns that shape (`spawn_agent_process` always
            // sets `process_group(0)`), but the exit sequence has to stay
            // bounded for any spawn site that does not, so fall back to the
            // direct SIGKILL `kill_on_drop` would have delivered anyway. The
            // census is the group's, and this group has no members.
            let _ = tokio::time::timeout(REAP_BUDGET, self.child.kill()).await;
            return (0, 0);
        }
        let (kills, wait_result) = tokio::join!(
            crate::process_kill::kill_group_and_await(pgid),
            tokio::time::timeout(REAP_BUDGET, self.child.wait())
        );
        match wait_result {
            Ok(Ok(_status)) => {}
            Ok(Err(error)) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    error = %error,
                    "failed to reap agent process after workspace stop"
                );
            }
            Err(_elapsed) => {
                // The escalation ran and the child still did not die. Report
                // it and let the actor finish: an unbounded wait here is the
                // one await in the exit sequence that can never resolve, and
                // an actor that never returns from `run()` never runs its
                // `on_exit` hook, so its handle stays in the live-session map
                // forever, advertising a session that is not there.
                tracing::warn!(
                    session_id = %self.session_id,
                    pid = pid,
                    budget_secs = REAP_BUDGET.as_secs(),
                    "agent process outlived the reap budget; abandoning the wait"
                );
            }
        }
        kills
    }
}

/// Whether the agent process is its own group leader, which is what makes a
/// group kill aimed at its pid reach it and everything it spawned.
#[cfg(unix)]
fn child_leads_its_own_group(pid: i32) -> bool {
    // Safety: `getpgid` only reads the kernel's process table. A `-1` (the
    // process is already gone) is not a leader either, which is the right
    // answer here.
    unsafe { libc::getpgid(pid) == pid }
}

#[cfg(not(unix))]
fn child_leads_its_own_group(_pid: i32) -> bool {
    false
}
