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
    fn resolve_gateway_models(&self, _harness_kind: &str, _revision: i64) -> GatewayModelPlan {
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

fn start_options(
    home: &Path,
    scratch: &Path,
    script: &str,
) -> StartAgentLoginTerminalOptions {
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
    assert!(!scratch.exists(), "the mint scratch dir must be removed on handoff");
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
        "revision": 7,
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

    service.close_terminal(&third.id).await.expect("close third");
    let _ = std::fs::remove_dir_all(home);
}
