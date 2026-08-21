//! The idle reaper's actor-side contracts, proven against the REAL idle loop
//! (`SessionActor::run`), a REAL child process tree, and a real ACP duplex.
//!
//! Two properties live here because neither can be proven from the manager
//! side, where the "actor" is a scripted mailbox consumer:
//!
//! - **The reap kills the agent's process GROUP.** The whole feature is a
//!   memory-reclaim claim, and the measurement it rests on puts 64% of a
//!   session's memory in the vendor CLI, which is a GRANDCHILD of the process
//!   this actor owns. `kill_on_drop` reaches the direct child only, so a reap
//!   that only dropped the child would leak the expensive half of the session.
//! - **The unload is conditional.** The reaper decides from an observation
//!   that is already stale when the command is delivered. `UnloadIfIdle` is
//!   evaluated serially on the actor's own loop, so a prompt, a fork or a
//!   queue mutation that arrived in between wins and the session is kept.
//!
//! The harness is `workspace_stop.rs`'s: a `/bin/sh` "agent" spawned with
//! `process_group(0)` exactly as `spawn_agent_process` spawns the real agent
//! CLI, and a fake ACP peer that defers every `session/prompt` and records but
//! never honors a `session/cancel`.

use std::time::Duration;

use agent_client_protocol as acp;
use tokio::sync::{mpsc, oneshot};

use super::workspace_stop::{
    compile_sleep_binary_named, spawn_actor_with_real_child, temp_dir, wait_for_pidfile,
    RealChildActorHarness, SESSION_ID,
};
use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::command::{
    ConditionalUnloadOutcome, PromptAcceptance, SessionCommand, UnloadRetainedReason,
};
use crate::live::sessions::background_work::BackgroundWorkUpdate;
use crate::process_kill::pid_is_alive;

/// Poll a pid until it is gone. The kill escalation is confirmed before
/// `run()` returns, so this only ever spins for a not-yet-reaped zombie; a
/// grandchild that was never signaled at all never leaves.
async fn await_pid_death(pid: i32, budget: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        if !pid_is_alive(pid) {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// B4: the reap must reclaim the whole agent process tree, and it must leave
/// the session durably resumable.
///
/// The dummy agent backgrounds a grandchild in its own group and then waits.
/// Killing only the direct child (what `drop(self.child)` does through
/// `kill_on_drop`) leaves that grandchild running forever, which is the leak
/// the memory claim cannot survive.
///
/// The durable half is asserted here rather than in the manager-side reaper
/// suite because only the real actor runs `finalize_exit` ->
/// `persist_exit_disposition`: the row is seeded `"running"` and must be
/// `"idle"` afterwards, with `native_session_id` intact.
#[tokio::test]
async fn a_conditional_unload_kills_the_agents_whole_process_group_and_stays_resumable() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let dir = temp_dir("idle-reap-group-kill");
            let grandchild = compile_sleep_binary_named(&dir, "vendor-cli");
            let pidfile = dir.join("vendor-cli.pid");
            // Shaped like production: the ACP adapter (the direct child) with
            // the vendor CLI beneath it. `process_group(0)` at spawn is what
            // makes both reachable by one group signal.
            let script = format!(
                "{} 300 & echo $! > {} ; wait",
                grandchild.display(),
                pidfile.display()
            );

            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                _store,
                ..
            } = spawn_actor_with_real_child(&script).await;
            let adapter_pid = actor.child.id().expect("agent pid") as i32;
            let vendor_pid = wait_for_pidfile(&pidfile).await;
            assert!(pid_is_alive(adapter_pid), "the adapter must be running");
            assert!(pid_is_alive(vendor_pid), "the vendor CLI must be running");
            assert_eq!(
                _store
                    .find_by_id(SESSION_ID)
                    .expect("read session")
                    .expect("session row")
                    .status,
                "running",
                "the seeded row must start as something other than idle, or the \
                 disposition assertion below proves nothing"
            );

            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            let _ = (notification_tx, background_tx);

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });
            drop(command_tx.clone());

            let outcome =
                tokio::time::timeout(Duration::from_secs(20), handle.unload_nonterminal_if_idle())
                    .await
                    .expect("the conditional unload must be answered")
                    .expect("the actor must answer the conditional unload");
            assert_eq!(
                outcome,
                ConditionalUnloadOutcome::Unloading,
                "a genuinely idle actor must accept the reap"
            );

            tokio::time::timeout(Duration::from_secs(30), actor_task)
                .await
                .expect("the actor's exit sequence must terminate")
                .expect("actor task joined")
                .expect("actor run finished");

            assert!(
                await_pid_death(adapter_pid, Duration::from_secs(5)).await,
                "the reap must kill the ACP adapter"
            );
            assert!(
                await_pid_death(vendor_pid, Duration::from_secs(5)).await,
                "the reap must kill the vendor CLI grandchild too - kill_on_drop \
                 reaches the direct child only, and the grandchild is 64% of the \
                 memory this feature exists to reclaim"
            );

            let record = _store
                .find_by_id(SESSION_ID)
                .expect("read session")
                .expect("session row survives the reap");
            assert_eq!(
                record.status, "idle",
                "the reap's Unload disposition must write the non-terminal idle status"
            );
            assert_eq!(record.native_session_id.as_deref(), Some("native-1"));
            assert_eq!(record.closed_at, None);
            assert_eq!(record.dismissed_at, None);

            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
}

/// B3, the FIFO race: a prompt sent AFTER the reaper's unload command still
/// wins, because the actor refuses an unload with anything behind it in the
/// mailbox.
///
/// Both commands are pushed into the real mailbox before the loop starts, so
/// the ordering is exact rather than raced: `[UnloadIfIdle, Prompt]`. With an
/// unconditional `Unload` the actor would exit, `run()` would drop the
/// receiver, and the prompt's responder would be dropped with it - the
/// `SendPromptError::Internal("session actor channel closed")` the user sees.
#[tokio::test]
async fn a_prompt_queued_behind_the_reap_wins_and_the_session_is_kept() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                mut prompt_responder_rx,
                _store,
                ..
            } = spawn_actor_with_real_child("sleep 300").await;

            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            let _ = (notification_tx, background_tx);

            // The reaper's command, then the user's prompt, both in the
            // mailbox before the actor reads either.
            let (unload_tx, unload_rx) = oneshot::channel();
            command_tx
                .send(SessionCommand::UnloadIfIdle {
                    respond_to: unload_tx,
                })
                .await
                .expect("enqueue the conditional unload");
            let (accept_tx, accept_rx) = oneshot::channel();
            command_tx
                .send(SessionCommand::Prompt {
                    payload: PromptPayload::text("the user came back".to_string()),
                    prompt_id: None,
                    from_queue_seq: None,
                    respond_to: accept_tx,
                })
                .await
                .expect("enqueue the racing prompt");

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });

            let acceptance = tokio::time::timeout(Duration::from_secs(10), accept_rx)
                .await
                .expect("the racing prompt must be answered")
                .expect("the prompt's responder must not be dropped by an exiting actor")
                .expect("the prompt must be accepted");
            assert!(
                matches!(acceptance, PromptAcceptance::Started { .. }),
                "the prompt must start a real turn, not be cancelled by the reap: \
                 {acceptance:?}"
            );

            let outcome = tokio::time::timeout(Duration::from_secs(10), unload_rx)
                .await
                .expect("the conditional unload must be answered")
                .expect("the reply channel must stay open");
            assert_eq!(
                outcome,
                ConditionalUnloadOutcome::Retained(UnloadRetainedReason::MailboxNotEmpty),
                "a command already queued behind the unload arrived after the \
                 reaper's observation, so the reap must be refused"
            );
            let _held_prompt_responder =
                tokio::time::timeout(Duration::from_secs(10), prompt_responder_rx.recv())
                    .await
                    .expect("the prompt must reach the agent")
                    .expect("prompt responder present");

            // Tear down through the bounded stop path; the turn is deliberately
            // never finished by the fake peer.
            let _ = tokio::time::timeout(Duration::from_secs(20), handle.stop_and_await()).await;
            let _ = tokio::time::timeout(Duration::from_secs(30), actor_task).await;
        })
        .await;
}

/// B3, the mid-turn case: an unload that reaches an actor whose turn has
/// already started must not cancel it. The unconditional `Unload` sends
/// `CancelNotification` and resolves interactions `Cancelled` from the
/// active-turn dispatch, so the price of a reap would be the turn rather than
/// a cold start.
#[tokio::test]
async fn a_mid_turn_reap_is_refused_without_cancelling_the_turn() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                mut prompt_responder_rx,
                mut cancel_rx,
                _store,
            } = spawn_actor_with_real_child("sleep 300").await;

            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            let _ = (notification_tx, background_tx);

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });

            let (accept_tx, accept_rx) = oneshot::channel();
            command_tx
                .send(SessionCommand::Prompt {
                    payload: PromptPayload::text("a turn the reaper must not eat".to_string()),
                    prompt_id: None,
                    from_queue_seq: None,
                    respond_to: accept_tx,
                })
                .await
                .expect("enqueue the prompt");
            let acceptance = tokio::time::timeout(Duration::from_secs(10), accept_rx)
                .await
                .expect("prompt accepted within the wait budget")
                .expect("prompt acceptance channel open")
                .expect("prompt started");
            assert!(matches!(acceptance, PromptAcceptance::Started { .. }));
            let _held_prompt_responder =
                tokio::time::timeout(Duration::from_secs(10), prompt_responder_rx.recv())
                    .await
                    .expect("prompt delivered to the fake agent")
                    .expect("prompt responder present");

            let outcome =
                tokio::time::timeout(Duration::from_secs(10), handle.unload_nonterminal_if_idle())
                    .await
                    .expect("the conditional unload must be answered")
                    .expect("the actor must answer the conditional unload");
            assert_eq!(
                outcome,
                ConditionalUnloadOutcome::Retained(UnloadRetainedReason::ActiveTurn),
                "a running turn must retain the session"
            );

            // The turn is still the actor's business: no ACP cancel was sent.
            match tokio::time::timeout(Duration::from_millis(300), cancel_rx.recv()).await {
                Err(_elapsed) => {}
                Ok(cancel) => {
                    panic!("the refused reap must not cancel the running turn, got {cancel:?}")
                }
            }

            let _ = tokio::time::timeout(Duration::from_secs(20), handle.stop_and_await()).await;
            let _ = tokio::time::timeout(Duration::from_secs(30), actor_task).await;
        })
        .await;
}
