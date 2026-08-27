//! Login-terminal domain glue: start/get/close sessions over the live PTY
//! service — plus the seat-mint capture machine (seats v1, agent_auth spec §3
//! flow 2).
//!
//! The mint capture is deliberately a PURE state machine here ([`MintCapture`]):
//! the live service feeds it terminal output bytes and lifecycle events, and it
//! decides what the captured token is and when the capture completes. The rules,
//! verbatim from the spec:
//!
//! - Capture rule: the last non-empty line of terminal output matching
//!   `^sk-ant-[A-Za-z0-9_-]{40,}$` (the `oat01` infix is server-issued,
//!   observed not contractual — the loose prefix survives a version bump).
//! - Completion: terminal exit, or a 60-second grace after the pattern
//!   appears, whichever comes first.
//! - The captured token lives in MEMORY ONLY — never machine disk, never
//!   logs. The buffer is wiped on handoff (claim) and on every error path.
//! - Single-flight per harness: the live service's guard, not this machine.

use std::time::{Duration, Instant};

use crate::live::terminals::{
    AgentLoginTerminalRecord as LiveAgentLoginTerminalRecord, AgentLoginTerminalService,
    AgentLoginTerminalStatus as LiveAgentLoginTerminalStatus, MintTerminalOptions,
    StartAgentLoginTerminalOptions,
};

use crate::domains::agents::runtime::{AgentLoginStart, AgentRuntime, AgentRuntimeError};

/// Which login flow a terminal runs (mirrors the contract's
/// `AgentLoginVariant`). `Native` is the harness's own interactive login;
/// `MintSeat` runs `claude setup-token` in an isolated dir with the capture
/// attached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AgentLoginVariant {
    #[default]
    Native,
    MintSeat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentLoginTerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AgentLoginTerminalRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: AgentLoginTerminalStatus,
    pub cwd: String,
    pub command_display: String,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    /// Present only on a mint terminal: the capture's lifecycle.
    pub mint_status: Option<MintCaptureStatus>,
}

#[derive(Debug, Clone)]
pub struct AgentLoginTerminalStart {
    pub kind: String,
    pub label: String,
    pub message: Option<String>,
    pub terminal: AgentLoginTerminalRecord,
}

pub async fn start_agent_login_terminal_session(
    agent_runtime: &AgentRuntime,
    kind: &str,
    variant: AgentLoginVariant,
    terminal_service: &AgentLoginTerminalService,
) -> Result<AgentLoginTerminalStart, AgentRuntimeError> {
    let (start, mint) = match variant {
        AgentLoginVariant::Native => (agent_runtime.start_login_terminal(kind).await?, None),
        AgentLoginVariant::MintSeat => {
            let mint_start = agent_runtime.start_mint_seat_terminal(kind).await?;
            let scratch_dir = mint_start.scratch_dir.clone();
            (mint_start.start, Some(MintTerminalOptions { scratch_dir }))
        }
    };
    let AgentLoginStart {
        kind,
        label,
        command,
        cwd,
        env,
        command_display,
        message,
        ..
    } = start;
    let terminal = terminal_service
        .start_terminal(StartAgentLoginTerminalOptions {
            kind: kind.clone(),
            title: label.clone(),
            program: command.program,
            args: command.args,
            cwd,
            env,
            command_display,
            cols: 120,
            rows: 24,
            mint,
        })
        .await
        .map_err(|error| AgentRuntimeError::LoginTerminalFailed(error.to_string()))?;

    Ok(AgentLoginTerminalStart {
        kind,
        label,
        message,
        terminal: agent_login_terminal_from_live(terminal),
    })
}

pub async fn get_agent_login_terminal(
    terminal_id: &str,
    terminal_service: &AgentLoginTerminalService,
) -> Result<AgentLoginTerminalRecord, AgentRuntimeError> {
    terminal_service
        .get_terminal(terminal_id)
        .await
        .map(agent_login_terminal_from_live)
        .ok_or_else(|| AgentRuntimeError::LoginTerminalNotFound(terminal_id.to_string()))
}

pub async fn close_agent_login_terminal(
    terminal_id: &str,
    terminal_service: &AgentLoginTerminalService,
) -> Result<(), AgentRuntimeError> {
    terminal_service
        .close_terminal(terminal_id)
        .await
        .map_err(|error| AgentRuntimeError::LoginTerminalNotFound(error.to_string()))
}

fn agent_login_terminal_from_live(
    record: LiveAgentLoginTerminalRecord,
) -> AgentLoginTerminalRecord {
    AgentLoginTerminalRecord {
        id: record.id,
        kind: record.kind,
        title: record.title,
        status: match record.status {
            LiveAgentLoginTerminalStatus::Starting => AgentLoginTerminalStatus::Starting,
            LiveAgentLoginTerminalStatus::Running => AgentLoginTerminalStatus::Running,
            LiveAgentLoginTerminalStatus::Exited => AgentLoginTerminalStatus::Exited,
            LiveAgentLoginTerminalStatus::Failed => AgentLoginTerminalStatus::Failed,
        },
        cwd: record.cwd,
        command_display: record.command_display,
        exit_code: record.exit_code,
        created_at: record.created_at,
        updated_at: record.updated_at,
        mint_status: record.mint_status,
    }
}

// ---------------------------------------------------------------------------
// The seat-mint capture machine (pure; the live service drives it).
// ---------------------------------------------------------------------------

/// Completion grace: once the pattern appears, the capture completes this long
/// after the LAST match unless the terminal exits first (the "last non-empty
/// matching line" rule needs a window in which a later, better line can still
/// arrive).
pub const MINT_CAPTURE_GRACE: Duration = Duration::from_secs(60);

/// The capture's externally visible lifecycle (mirrored onto the contract's
/// `AgentMintCaptureStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MintCaptureStatus {
    Waiting,
    Captured,
    Ready,
    Consumed,
    Failed,
}

/// The in-memory capture for one mint terminal. Holds at most one candidate
/// token; every buffer is overwritten before release on wipe. Never `Debug`s
/// its contents.
#[derive(Default)]
pub struct MintCapture {
    /// Raw bytes of the in-progress (not yet newline-terminated) output line.
    pending: Vec<u8>,
    /// The last non-empty sanitized line matching the token rule.
    candidate: Option<String>,
    matched_at: Option<Instant>,
    exited: bool,
    consumed: bool,
    failed: bool,
}

impl std::fmt::Debug for MintCapture {
    /// Deliberately content-free: the candidate IS the secret.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MintCapture")
            .field("has_candidate", &self.candidate.is_some())
            .field("exited", &self.exited)
            .field("consumed", &self.consumed)
            .field("failed", &self.failed)
            .finish()
    }
}

impl MintCapture {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed raw terminal output. Complete lines (split on `\n`) are sanitized
    /// (ANSI escapes and control bytes stripped, whitespace trimmed) and
    /// matched against the token rule; the LAST matching line wins.
    pub fn feed(&mut self, bytes: &[u8], now: Instant) {
        if self.consumed || self.failed {
            return;
        }
        for byte in bytes {
            if *byte == b'\n' {
                let line = std::mem::take(&mut self.pending);
                self.take_line(&line, now);
                wipe_bytes(line);
            } else {
                self.pending.push(*byte);
            }
        }
    }

    /// The terminal exited (or errored). Flushes the trailing partial line —
    /// a token printed without a final newline still counts — then completes:
    /// with a candidate the capture is ready; without one it has failed and
    /// every buffer is wiped.
    pub fn on_exit(&mut self, now: Instant) {
        if self.consumed || self.failed {
            return;
        }
        let line = std::mem::take(&mut self.pending);
        self.take_line(&line, now);
        wipe_bytes(line);
        self.exited = true;
        if self.candidate.is_none() {
            self.fail();
        }
    }

    /// The capture's lifecycle at `now` (the grace window is evaluated lazily,
    /// so no timer task holds a token reference).
    pub fn status(&self, now: Instant) -> MintCaptureStatus {
        if self.consumed {
            return MintCaptureStatus::Consumed;
        }
        if self.failed {
            return MintCaptureStatus::Failed;
        }
        match (&self.candidate, self.matched_at) {
            (Some(_), Some(matched_at)) => {
                if self.exited || now.duration_since(matched_at) >= MINT_CAPTURE_GRACE {
                    MintCaptureStatus::Ready
                } else {
                    MintCaptureStatus::Captured
                }
            }
            _ => MintCaptureStatus::Waiting,
        }
    }

    /// One-time handoff: returns the token exactly when the capture is
    /// [`MintCaptureStatus::Ready`], wiping every internal buffer. A second
    /// claim — or a claim before completion — returns `None`.
    pub fn claim(&mut self, now: Instant) -> Option<String> {
        if self.status(now) != MintCaptureStatus::Ready {
            return None;
        }
        let token = self.candidate.take();
        self.consumed = true;
        self.wipe();
        token
    }

    /// Error-path teardown (terminal closed, service dropped): overwrite and
    /// release every buffer. Idempotent.
    pub fn fail(&mut self) {
        self.failed = true;
        self.wipe();
    }

    /// True when no secret material remains in this capture.
    pub fn is_wiped(&self) -> bool {
        self.candidate.is_none() && self.pending.is_empty()
    }

    fn wipe(&mut self) {
        if let Some(candidate) = self.candidate.take() {
            wipe_bytes(candidate.into_bytes());
        }
        let pending = std::mem::take(&mut self.pending);
        wipe_bytes(pending);
    }

    fn take_line(&mut self, raw: &[u8], now: Instant) {
        let sanitized = sanitize_terminal_line(raw);
        if is_seat_token_line(&sanitized) {
            // Replace (and wipe) any earlier candidate: the LAST match wins.
            if let Some(previous) = self.candidate.take() {
                wipe_bytes(previous.into_bytes());
            }
            self.candidate = Some(sanitized);
            self.matched_at = Some(now);
        } else {
            wipe_bytes(sanitized.into_bytes());
        }
    }
}

impl Drop for MintCapture {
    fn drop(&mut self) {
        self.wipe();
    }
}

/// Best-effort in-memory scrub: overwrite before release so a dropped buffer
/// does not keep the token readable in freed memory longer than necessary.
fn wipe_bytes(mut bytes: Vec<u8>) {
    for byte in bytes.iter_mut() {
        *byte = 0;
    }
    drop(bytes);
}

/// The capture rule, exactly: `^sk-ant-[A-Za-z0-9_-]{40,}$`. Hand-rolled (no
/// regex dependency) and total: a prefix match plus a 40+-char tail of the
/// exact character class.
pub fn is_seat_token_line(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("sk-ant-") else {
        return false;
    };
    rest.len() >= 40
        && rest
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

/// Strip ANSI escape sequences (CSI, OSC, and two-byte ESC sequences) and
/// control bytes from one raw PTY output line, then trim whitespace. PTY
/// output routinely carries `\r` and color/cursor sequences around the line
/// the CLI "prints"; the capture rule speaks about the visible line.
fn sanitize_terminal_line(raw: &[u8]) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let byte = raw[i];
        if byte == 0x1b {
            i += 1;
            match raw.get(i) {
                // CSI: ESC '[' parameter bytes then one final byte 0x40-0x7E.
                Some(b'[') => {
                    i += 1;
                    while i < raw.len() && !(0x40..=0x7e).contains(&raw[i]) {
                        i += 1;
                    }
                    i += 1; // consume the final byte
                }
                // OSC: ESC ']' ... terminated by BEL or ESC '\'.
                Some(b']') => {
                    i += 1;
                    while i < raw.len() {
                        if raw[i] == 0x07 {
                            i += 1;
                            break;
                        }
                        if raw[i] == 0x1b && raw.get(i + 1) == Some(&b'\\') {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                // Any other ESC sequence: consume the one following byte.
                Some(_) => i += 1,
                None => {}
            }
            continue;
        }
        if byte.is_ascii_control() {
            i += 1;
            continue;
        }
        out.push(byte as char);
        i += 1;
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_x";

    fn now() -> Instant {
        Instant::now()
    }

    #[test]
    fn the_capture_rule_matches_the_spec_pattern() {
        assert!(is_seat_token_line(TOKEN));
        // 40 chars after the prefix is the boundary.
        let boundary = format!("sk-ant-{}", "a".repeat(40));
        assert!(is_seat_token_line(&boundary));
        let short = format!("sk-ant-{}", "a".repeat(39));
        assert!(!is_seat_token_line(&short));
        assert!(!is_seat_token_line("sk-ant "));
        assert!(!is_seat_token_line("prefix sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        assert!(!is_seat_token_line(&format!("sk-ant-{}!", "a".repeat(40))));
    }

    #[test]
    fn captures_the_last_matching_line_through_ansi_noise() {
        let mut capture = MintCapture::new();
        let earlier = format!("sk-ant-{}", "b".repeat(40));
        capture.feed(b"Signing you in...\r\n", now());
        capture.feed(format!("{earlier}\r\n").as_bytes(), now());
        // The real token arrives wrapped in color codes and a CR.
        capture.feed(format!("\x1b[1;32m{TOKEN}\x1b[0m\r\n", TOKEN = TOKEN).as_bytes(), now());
        capture.feed(b"Store this token somewhere safe.\r\n", now());
        capture.on_exit(now());
        let token = capture.claim(now()).expect("claimable after exit");
        assert_eq!(token, TOKEN);
    }

    #[test]
    fn a_token_without_a_trailing_newline_still_captures_on_exit() {
        let mut capture = MintCapture::new();
        capture.feed(TOKEN.as_bytes(), now());
        assert_eq!(capture.status(now()), MintCaptureStatus::Waiting);
        capture.on_exit(now());
        assert_eq!(capture.claim(now()).as_deref(), Some(TOKEN));
    }

    #[test]
    fn completion_is_exit_or_the_grace_window_whichever_first() {
        let mut capture = MintCapture::new();
        let start = now();
        capture.feed(format!("{TOKEN}\n").as_bytes(), start);
        // Matched but neither exited nor aged: the grace window is running.
        assert_eq!(capture.status(start), MintCaptureStatus::Captured);
        assert!(capture.claim(start).is_none(), "not claimable mid-grace");
        let aged = start.checked_add(MINT_CAPTURE_GRACE).expect("instant add");
        assert_eq!(capture.status(aged), MintCaptureStatus::Ready);
        assert_eq!(capture.claim(aged).as_deref(), Some(TOKEN));
    }

    #[test]
    fn claim_is_single_shot_and_wipes() {
        let mut capture = MintCapture::new();
        capture.feed(format!("{TOKEN}\n").as_bytes(), now());
        capture.on_exit(now());
        assert!(capture.claim(now()).is_some());
        assert!(capture.is_wiped());
        assert_eq!(capture.status(now()), MintCaptureStatus::Consumed);
        assert!(capture.claim(now()).is_none(), "a second claim finds nothing");
    }

    #[test]
    fn exit_without_a_match_fails_and_wipes() {
        let mut capture = MintCapture::new();
        capture.feed(b"error: could not open browser\n", now());
        capture.feed(b"sk-ant-too-short\n", now());
        capture.on_exit(now());
        assert_eq!(capture.status(now()), MintCaptureStatus::Failed);
        assert!(capture.is_wiped());
        assert!(capture.claim(now()).is_none());
    }

    #[test]
    fn explicit_failure_wipes_a_captured_but_unclaimed_token() {
        // The abort path: a token was seen, then the terminal is closed before
        // the handoff. Nothing may remain in memory.
        let mut capture = MintCapture::new();
        capture.feed(format!("{TOKEN}\n").as_bytes(), now());
        assert_eq!(capture.status(now()), MintCaptureStatus::Captured);
        capture.fail();
        assert_eq!(capture.status(now()), MintCaptureStatus::Failed);
        assert!(capture.is_wiped());
        assert!(capture.claim(now()).is_none());
    }

    #[test]
    fn debug_never_prints_the_token() {
        let mut capture = MintCapture::new();
        capture.feed(format!("{TOKEN}\n").as_bytes(), now());
        let debug = format!("{capture:?}");
        assert!(!debug.contains("sk-ant-"), "Debug leaked the token: {debug}");
    }
}
