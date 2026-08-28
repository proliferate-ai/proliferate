//! Seats v1 proof tests (delivery-spec-slice-1-mint-and-run §Proof).
//!
//! - `seat_mint_store_render_launch_roundtrip`: the e2e proven by hand on
//!   2026-08-26, automated with the token print stubbed — mint capture →
//!   (the server's vault/render half, pinned by the contract fixture and the
//!   Python suite, simulated here as the wire document it produces) → apply →
//!   launch env carries the token + the per-seat dir with the strip list.
//! - `mint_capture_never_touches_disk`: abort the mint at each step and
//!   assert no secret survives anywhere — not in the service, not in any file
//!   under the runtime home, not in the scratch dir.
//!
//! Both spawn a real PTY through the live login-terminal service with a stub
//! shell command standing in for `claude setup-token`.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::domains::agents::route_auth::{
    resolve_launch_route_auth, AgentAuthState, GatewayModelPlan, GatewayModelResolve,
};
use crate::live::terminals::{
    AgentLoginTerminalService, AgentLoginTerminalStatus, MintClaimError, MintTerminalOptions,
    StartAgentLoginTerminalOptions,
};

use super::login_terminal::MintCaptureStatus;

struct NoPlanResolver;

impl GatewayModelResolve for NoPlanResolver {
    fn resolve_gateway_models(&self, _harness_kind: &str, _sequence: i64) -> GatewayModelPlan {
        GatewayModelPlan::default()
    }
}

fn seat_token() -> String {
    format!("sk-ant-oat01-{}", "A1b2C3d4".repeat(5))
}

fn temp_home(prefix: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).expect("create temp home");
    path
}

fn mint_scratch(home: &Path) -> PathBuf {
    let dir = home
        .join("agent-auth-mint")
        .join(format!("mint-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("claude-config")).expect("create scratch");
    dir
}

fn start_options(home: &Path, scratch: &Path, script: &str) -> StartAgentLoginTerminalOptions {
    StartAgentLoginTerminalOptions {
        kind: "claude".to_string(),
        title: "Add a Claude.ai login".to_string(),
        program: "/bin/sh".to_string(),
        args: vec!["-c".to_string(), script.to_string()],
        cwd: home.to_path_buf(),
        env: Vec::new(),
        command_display: "claude setup-token (stubbed)".to_string(),
        cols: 120,
        rows: 24,
        mint: Some(MintTerminalOptions {
            scratch_dir: scratch.to_path_buf(),
        }),
    }
}

async fn wait_for_mint_status(
    service: &AgentLoginTerminalService,
    terminal_id: &str,
    wanted: MintCaptureStatus,
) {
    for _ in 0..200 {
        if service.mint_status(terminal_id).await == Some(wanted) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("mint capture never reached {wanted:?}");
}

/// Every file under `root`, read as bytes, must be free of `secret`.
fn assert_no_secret_under(root: &Path, secret: &str) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(contents) = std::fs::read(&path) {
                let haystack = String::from_utf8_lossy(&contents);
                assert!(
                    !haystack.contains(secret),
                    "secret found on disk at {}",
                    path.display()
                );
            }
        }
    }
}

/// The spine proof: mint (stubbed token print) → vault row → render → apply →
/// launch. The vault/render legs are the server's (pinned by the contract
/// fixture + the Python suite); here the claimed token is placed into exactly
/// the wire document that renderer emits, and the launch legs run for real.
#[tokio::test]
async fn seat_mint_store_render_launch_roundtrip() {
    let home = temp_home("seat-roundtrip");
    let scratch = mint_scratch(&home);
    let token = seat_token();
    let service = AgentLoginTerminalService::new();

    // Mint: the stub prints noise, then the token, then exits — exactly the
    // observable shape of `claude setup-token` after the browser sign-in.
    let script = format!("echo 'Sign in to Claude.ai...'; echo '{token}'");
    let record = service
        .start_terminal(start_options(&home, &scratch, &script))
        .await
        .expect("start mint terminal");
    assert_eq!(record.mint_status, Some(MintCaptureStatus::Waiting));

    // Completion signal 1: terminal exit.
    wait_for_mint_status(&service, &record.id, MintCaptureStatus::Ready).await;

    // The one-time handoff (the courier's read). The buffer is wiped and the
    // scratch dir goes with it.
    let claimed = service
        .claim_mint_token(&record.id)
        .await
        .expect("claim the captured token");
    assert_eq!(claimed, token);
    assert!(
        !scratch.exists(),
        "the mint scratch dir must be removed on handoff"
    );
    assert_eq!(
        service.claim_mint_token(&record.id).await,
        Err(MintClaimError::NotReady(MintCaptureStatus::Consumed)),
        "a second claim finds nothing"
    );

    // Store + render (the server half, simulated as its pinned output): the
    // vault row becomes one seat source in the rendered document.
    let seat_id = "40000000-0000-4000-8000-000000000031";
    let state: AgentAuthState = serde_json::from_value(serde_json::json!({
        "version": 2,
        "lineage": "test-lineage",
        "sequence": 7,
        "user_id": "20000000-0000-4000-8000-000000000001",
        "harnesses": [{
            "harness_kind": "claude",
            "sources": [{
                "kind": "seat",
                "env": { "CLAUDE_CODE_OAUTH_TOKEN": claimed },
                "seat_id": seat_id,
            }],
        }],
    }))
    .expect("wire document parses");
    crate::domains::agents::route_auth::apply_state_file(&home, &state).expect("apply");

    // Launch: the env carries the token + the per-seat home, strip list applied.
    let rendered =
        resolve_launch_route_auth(&home, "claude", &NoPlanResolver).expect("launch render");
    assert_eq!(
        rendered.set.get("CLAUDE_CODE_OAUTH_TOKEN"),
        Some(&token),
        "the minted token reaches the launch env"
    );
    let config_dir = rendered
        .set
        .get("CLAUDE_CONFIG_DIR")
        .expect("per-seat CLAUDE_CONFIG_DIR");
    assert!(config_dir.contains(&format!("claude-config-{seat_id}")));
    assert!(std::path::Path::new(config_dir).is_dir());
    for key in [
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "AWS_BEARER_TOKEN_BEDROCK",
    ] {
        assert!(
            rendered.remove.contains(&key.to_string()),
            "missing removal of {key}"
        );
    }

    let _ = std::fs::remove_dir_all(home);
}

/// Abort the mint at each step; at every stop the token must exist NOWHERE —
/// not in the vault (nothing was ever uploaded), not in any file under the
/// runtime home, not in the service's memory once wiped.
#[tokio::test]
async fn mint_capture_never_touches_disk() {
    let token = seat_token();

    // Step 1 — abort mid-sign-in, before any token was printed.
    {
        let home = temp_home("seat-abort-waiting");
        let scratch = mint_scratch(&home);
        let service = AgentLoginTerminalService::new();
        let record = service
            .start_terminal(start_options(&home, &scratch, "echo waiting; sleep 30"))
            .await
            .expect("start");
        service.close_terminal(&record.id).await.expect("close");
        assert_eq!(
            service.claim_mint_token(&record.id).await,
            Err(MintClaimError::NotFound),
            "a closed mint terminal holds nothing"
        );
        assert!(!scratch.exists(), "abort removes the scratch dir");
        assert_no_secret_under(&home, &token);
        let _ = std::fs::remove_dir_all(home);
    }

    // Step 2 — abort AFTER the token was captured but before completion: the
    // buffer is wiped with the close; nothing was persisted anywhere.
    {
        let home = temp_home("seat-abort-captured");
        let scratch = mint_scratch(&home);
        let service = AgentLoginTerminalService::new();
        let script = format!("echo '{token}'; sleep 30");
        let record = service
            .start_terminal(start_options(&home, &scratch, &script))
            .await
            .expect("start");
        wait_for_mint_status(&service, &record.id, MintCaptureStatus::Captured).await;
        service.close_terminal(&record.id).await.expect("close");
        assert_eq!(
            service.claim_mint_token(&record.id).await,
            Err(MintClaimError::NotFound)
        );
        assert_no_secret_under(&home, &token);
        assert!(!scratch.exists());
        assert!(
            !home.join("agent-auth").join("state.json").exists(),
            "an aborted mint must not have produced any applied state"
        );
        let _ = std::fs::remove_dir_all(home);
    }

    // Step 3 — capture completed (terminal exit) but the handoff never
    // happens: closing the terminal wipes the ready token.
    {
        let home = temp_home("seat-abort-ready");
        let scratch = mint_scratch(&home);
        let service = AgentLoginTerminalService::new();
        let script = format!("echo '{token}'");
        let record = service
            .start_terminal(start_options(&home, &scratch, &script))
            .await
            .expect("start");
        wait_for_mint_status(&service, &record.id, MintCaptureStatus::Ready).await;
        // Never claimed. Close instead.
        service.close_terminal(&record.id).await.expect("close");
        assert_eq!(
            service.claim_mint_token(&record.id).await,
            Err(MintClaimError::NotFound)
        );
        assert_no_secret_under(&home, &token);
        assert!(!scratch.exists());
        let _ = std::fs::remove_dir_all(home);
    }

    // Step 4 — a failed mint (terminal exits without a token) wipes itself.
    {
        let home = temp_home("seat-abort-failed");
        let scratch = mint_scratch(&home);
        let service = AgentLoginTerminalService::new();
        let record = service
            .start_terminal(start_options(&home, &scratch, "echo 'sign-in failed'"))
            .await
            .expect("start");
        wait_for_mint_status(&service, &record.id, MintCaptureStatus::Failed).await;
        assert_eq!(
            service.claim_mint_token(&record.id).await,
            Err(MintClaimError::NotReady(MintCaptureStatus::Failed))
        );
        assert!(!scratch.exists(), "a failed capture removes its scratch");
        assert_no_secret_under(&home, &token);
        let _ = std::fs::remove_dir_all(home);
    }
}

/// The single-flight guard under CONCURRENT starts (a double-click firing two
/// POSTs): the guard's write lock is held across check + spawn + reserve, so
/// every racer lands on ONE terminal — a check-then-act guard let both pass
/// the check before either reserved, spawning two live mint PTYs.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mint_single_flight_survives_concurrent_starts() {
    let home = temp_home("seat-concurrent");
    let service = AgentLoginTerminalService::new();

    let mut tasks = Vec::new();
    for _ in 0..8 {
        let service = service.clone();
        let home = home.clone();
        tasks.push(tokio::spawn(async move {
            let scratch = mint_scratch(&home);
            service
                .start_terminal(start_options(&home, &scratch, "sleep 30"))
                .await
                .expect("concurrent start")
        }));
    }
    let mut ids = Vec::new();
    for task in tasks {
        ids.push(task.await.expect("join").id);
    }
    let first = ids[0].clone();
    assert!(
        ids.iter().all(|id| *id == first),
        "all concurrent starts must land on one terminal, got {ids:?}"
    );
    // Exactly one scratch dir survives — the winner's; every loser's was
    // removed on the spot.
    let survivors = std::fs::read_dir(home.join("agent-auth-mint"))
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(survivors, 1, "only the winning mint's scratch dir remains");

    service.close_terminal(&first).await.expect("close");
    let _ = std::fs::remove_dir_all(home);
}

/// An exited-but-unclaimed mint is torn down, not stranded: the scratch dir
/// goes at exit (the CLI cannot need its config dir any more), and starting
/// the NEXT mint wipes the old Ready capture as its slot is released.
#[tokio::test]
async fn a_replaced_exited_mint_is_torn_down_not_stranded() {
    let home = temp_home("seat-stale-replace");
    let scratch = mint_scratch(&home);
    let token = seat_token();
    let service = AgentLoginTerminalService::new();
    let script = format!("echo '{token}'");
    let first = service
        .start_terminal(start_options(&home, &scratch, &script))
        .await
        .expect("start first");
    wait_for_mint_status(&service, &first.id, MintCaptureStatus::Ready).await;
    assert!(
        !scratch.exists(),
        "a Ready exit removes the scratch dir without waiting for the claim"
    );

    let second_scratch = mint_scratch(&home);
    let second = service
        .start_terminal(start_options(&home, &second_scratch, "sleep 30"))
        .await
        .expect("start second");
    assert_ne!(second.id, first.id, "a finished mint releases the slot");
    assert_eq!(
        service.claim_mint_token(&first.id).await,
        Err(MintClaimError::NotFound),
        "the replaced mint's capture is wiped, never left claimable"
    );
    assert_no_secret_under(&home, &token);

    service.close_terminal(&second.id).await.expect("close");
    let _ = std::fs::remove_dir_all(home);
}

/// The one-time handoff wipes EVERY runtime copy: after the claim, a ws
/// (re)connect's replay must not be able to serve the token line again.
#[tokio::test]
async fn claim_purges_the_replay_buffer() {
    let home = temp_home("seat-replay-purge");
    let scratch = mint_scratch(&home);
    let token = seat_token();
    let service = AgentLoginTerminalService::new();
    let script = format!("echo '{token}'; sleep 30");
    let record = service
        .start_terminal(start_options(&home, &scratch, &script))
        .await
        .expect("start");
    wait_for_mint_status(&service, &record.id, MintCaptureStatus::Captured).await;
    let handle = service
        .lookup_terminal(&record.id)
        .await
        .expect("terminal handle");
    let (frames, _rx) = handle.subscribe_output(None).await.expect("subscribe");
    assert!(
        frames_contain(&frames, &token),
        "sanity: the printed token flowed into the replay buffer"
    );

    service.close_terminal(&record.id).await.expect("close");
    // Closing wiped capture AND replay; a fresh Ready mint proves the claim
    // path purges too.
    let scratch = mint_scratch(&home);
    let script = format!("echo '{token}'");
    let record = service
        .start_terminal(start_options(&home, &scratch, &script))
        .await
        .expect("start second");
    wait_for_mint_status(&service, &record.id, MintCaptureStatus::Ready).await;
    let claimed = service.claim_mint_token(&record.id).await.expect("claim");
    assert_eq!(claimed, token);
    let handle = service
        .lookup_terminal(&record.id)
        .await
        .expect("terminal handle");
    let (frames, _rx) = handle
        .subscribe_output(None)
        .await
        .expect("subscribe after claim");
    assert!(
        !frames_contain(&frames, &token),
        "the one-time handoff must purge the replay copy of the token"
    );
    service
        .close_terminal(&record.id)
        .await
        .expect("close second");
    let _ = std::fs::remove_dir_all(home);
}

/// PRODUCTION REGRESSION (2026-08-27), driven through the real PTY and the real
/// live capture: `claude setup-token` renders through Ink, which HARD-WRAPS its
/// own output at the PTY width, and the login pane resizes the PTY to its own
/// width. At the 99-column pane the acceptance run used, the 108-character token
/// arrived as a 99-character head — itself a valid `^sk-ant-…$` line — plus a
/// 9-character tail, and the capture stored the head. The stored seat then failed
/// every session with `401 OAuth access token is invalid`.
///
/// The stub below reproduces the wrap byte-for-byte (per-fragment SGR pair,
/// `\r\r\n` between fragments) at the pane width that broke, and at widths either
/// side of it. The claimed token must be byte-identical to the printed one.
#[tokio::test]
async fn a_hard_wrapped_token_survives_the_live_capture() {
    for width in [99, 61, 37] {
        let home = temp_home("seat-wrapped");
        let scratch = mint_scratch(&home);
        let token = long_seat_token();
        let service = AgentLoginTerminalService::new();
        let script = wrapped_mint_script(&token, width);
        let record = service
            .start_terminal(start_options(&home, &scratch, &script))
            .await
            .expect("start mint terminal");
        wait_for_mint_status(&service, &record.id, MintCaptureStatus::Ready).await;
        let claimed = service
            .claim_mint_token(&record.id)
            .await
            .expect("claim the captured token");
        assert_eq!(
            claimed.len(),
            token.len(),
            "captured {} chars of a {}-char token wrapped at {width} columns",
            claimed.len(),
            token.len(),
        );
        assert_eq!(claimed, token, "wrapped at {width} columns");
        let _ = std::fs::remove_dir_all(home);
    }
}

/// A token of the length real setup-tokens have (108: two independently verified
/// working setup-tokens and a live keychain access token all measured 108).
fn long_seat_token() -> String {
    let token = format!("sk-ant-oat01-{}", "A1b2C3d4_Zq-9Xw".repeat(7))[..108].to_string();
    assert_eq!(token.len(), 108);
    token
}

/// The `claude setup-token` success frame as bytes on a PTY of `width` columns:
/// the label line, a blank, the token hard-wrapped with a per-fragment SGR colour
/// pair and `\r\r\n` between fragments, then the dim trailer lines. Each fragment
/// is a `printf` OPERAND, never a format string, so a fragment starting with `-`
/// or containing `%` cannot change the shell's parse.
fn wrapped_mint_script(token: &str, width: usize) -> String {
    let mut script = String::from(
        "printf '%s\\r\\r\\n\\r\\r\\n' 'Long-lived authentication token created successfully!'; \
         printf '%s\\r\\r\\n' 'Your OAuth token (valid for 1 year):'; ",
    );
    let chars: Vec<char> = token.chars().collect();
    for fragment in chars.chunks(width) {
        let fragment: String = fragment.iter().collect();
        script.push_str(&format!(
            "printf '\\033[38;2;215;119;87m%s\\033[39m\\r\\r\\n' '{fragment}'; "
        ));
    }
    script.push_str(
        "printf '\\r\\r\\n'; \
         printf '%s\\r\\r\\n' \"Store this token securely. You won't be able to see it again.\"; \
         printf '%s\\r\\r\\n' 'Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>'",
    );
    script
}

fn frames_contain(frames: &[crate::live::terminals::TerminalOutputEvent], needle: &str) -> bool {
    frames.iter().any(|frame| match frame {
        crate::live::terminals::TerminalOutputEvent::Data { data, .. } => {
            String::from_utf8_lossy(data).contains(needle)
        }
        _ => false,
    })
}

/// Crash recovery: mint state is memory-only, so every scratch dir on disk at
/// process start is a previous process's orphan — the startup sweep removes
/// them all (their claude-config/ can hold CLI-written credential state).
#[test]
fn startup_sweep_removes_orphaned_mint_scratch() {
    let home = temp_home("seat-sweep");
    let orphan = mint_scratch(&home);
    std::fs::write(
        orphan.join("claude-config").join(".credentials.json"),
        "{\"credential\": \"left by a crashed process\"}",
    )
    .expect("write orphan credential");

    crate::domains::agents::runtime::sweep_mint_scratch(&home);

    assert!(!orphan.exists(), "the orphaned mint scratch must be swept");
    let survivors = std::fs::read_dir(home.join("agent-auth-mint"))
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(survivors, 0, "the sweep leaves the mint root empty");
    let _ = std::fs::remove_dir_all(home);
}

/// The single-flight guard: while a mint terminal is open for a harness, a
/// second mint start returns THAT terminal (the UI focuses it) instead of
/// spawning a sibling; once it finishes, the slot is free again.
#[tokio::test]
async fn mint_is_single_flight_per_harness() {
    let home = temp_home("seat-single-flight");
    let scratch = mint_scratch(&home);
    let service = AgentLoginTerminalService::new();
    let first = service
        .start_terminal(start_options(&home, &scratch, "sleep 30"))
        .await
        .expect("start first");

    let second_scratch = mint_scratch(&home);
    let second = service
        .start_terminal(start_options(&home, &second_scratch, "sleep 30"))
        .await
        .expect("start second");
    assert_eq!(
        second.id, first.id,
        "a second mint focuses the open terminal instead of spawning"
    );
    assert!(
        !second_scratch.exists(),
        "the unused second scratch dir is removed"
    );

    service.close_terminal(&first.id).await.expect("close");
    let third_scratch = mint_scratch(&home);
    let third = service
        .start_terminal(start_options(&home, &third_scratch, "sleep 30"))
        .await
        .expect("start third");
    assert_ne!(third.id, first.id, "a finished mint releases the slot");
    assert_eq!(
        third.status,
        AgentLoginTerminalStatus::Running,
        "the replacement is a real new terminal"
    );

    service
        .close_terminal(&third.id)
        .await
        .expect("close third");
    let _ = std::fs::remove_dir_all(home);
}
