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
//!   observed not contractual — the loose prefix survives a version bump),
//!   REASSEMBLED across a hard wrap (see [`MintCapture::take_line`]) — the CLI
//!   wraps its own output at the PTY width, so "the line the CLI printed" and
//!   "the segment between two newlines" are not the same string.
//! - Completion: terminal exit, or a 60-second grace after the pattern
//!   appears, whichever comes first.
//! - The captured token lives in MEMORY ONLY — never machine disk, never
//!   logs. The buffer is wiped on handoff (claim) and on every error path.
//! - Single-flight per harness: the live service's guard, not this machine.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::live::terminals::{
    AgentLoginTerminalRecord as LiveAgentLoginTerminalRecord, AgentLoginTerminalService,
    AgentLoginTerminalStatus as LiveAgentLoginTerminalStatus, StartAgentLoginTerminalOptions,
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

/// Marks a login terminal as a seat-mint terminal (seats v1): the live
/// service attaches a [`MintCapture`] to its output, enforces single-flight
/// per harness kind, and removes `scratch_dir` (the isolated mint dir) on
/// every terminal teardown path. Domain-owned vocabulary; the live service
/// consumes it.
#[derive(Debug, Clone)]
pub struct MintTerminalOptions {
    pub scratch_dir: PathBuf,
}

/// Why a mint-token claim returned nothing. Domain-owned so transport
/// handlers map it without reaching into the live layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MintClaimError {
    /// Unknown terminal, or a terminal that is not a mint terminal.
    NotFound,
    /// The capture is not (or no longer) claimable; carries its state so the
    /// route can say which.
    NotReady(MintCaptureStatus),
}

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
    /// The token line being accumulated: the last `sk-ant-`-prefixed sanitized
    /// segment plus every hard-wrap continuation appended to it.
    candidate: Option<String>,
    /// Whether `candidate` satisfies the token rule. A wrapped token's FIRST
    /// fragment can be too short to satisfy it on its own (a pane narrower than
    /// 47 columns), so accumulation and admission are separate facts.
    candidate_matched: bool,
    /// True while `candidate` is still the TAIL of the most recent non-empty
    /// sanitized segment, so the next such segment may be the rest of a
    /// hard-wrapped token. Cleared by any non-empty segment that is not a
    /// continuation, and by every teardown.
    candidate_open: bool,
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

    /// Feed raw terminal output. Complete lines (split on `\n` AND on `\r`)
    /// are sanitized (ANSI escapes and control bytes stripped, whitespace
    /// trimmed) and matched against the token rule; the LAST matching line
    /// wins. A bare `\r` is a line boundary rather than a stripped byte
    /// because it resets the cursor to column 0: what follows OVERWRITES the
    /// visible line, and the capture rule speaks about the visible line — a
    /// `\r`-overwrite spinner must not merge into the token
    /// (`"Waiting\rsk-ant-…"` is the token line, visibly). Splitting on both
    /// keeps `\r\n` pairs harmless: the `\n` then flushes an empty segment.
    pub fn feed(&mut self, bytes: &[u8], now: Instant) {
        if self.consumed || self.failed {
            return;
        }
        for byte in bytes {
            if *byte == b'\n' || *byte == b'\r' {
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
        if !self.candidate_matched {
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
        match (self.candidate_matched, self.matched_at) {
            (true, Some(matched_at)) => {
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
        self.candidate_open = false;
        self.candidate_matched = false;
        if let Some(candidate) = self.candidate.take() {
            wipe_bytes(candidate.into_bytes());
        }
        let pending = std::mem::take(&mut self.pending);
        wipe_bytes(pending);
    }

    /// One sanitized segment, classified three ways.
    ///
    /// **Why a wrap must be reassembled.** `claude setup-token` renders through
    /// Ink, which HARD-WRAPS its own output at the PTY width: a token wider than
    /// the pane is emitted as `<width chars>\r\r\n<remainder>`, each fragment its
    /// own newline-delimited segment with no prefix. The PTY width is the login
    /// pane's width (the client resizes it, so the spawn's `cols` is not the
    /// operative number), so at a 99-column pane a 108-character token arrives as
    /// a 99-character head that satisfies the anchored rule on its own plus a
    /// 9-character tail that does not — and "the last matching line" then captures
    /// a truncated token that authenticates nowhere. Widening the PTY only moves
    /// the boundary; the rule has to rejoin the fragments.
    ///
    /// A continuation is recognized width-free: the previous non-empty segment
    /// ENDED in the candidate, this segment is entirely token characters, it does
    /// not itself start `sk-ant-` (that marks a new token, not a continuation),
    /// and it is no longer than what it continues (a wrap remainder cannot exceed
    /// the full-width head it wrapped out of). EMPTY segments are transparent:
    /// the `\r\r\n` a wrap emits segments into two of them, as does any blank
    /// display line, so an empty segment carries no information and must neither
    /// close a candidate nor become one.
    fn take_line(&mut self, raw: &[u8], now: Instant) {
        let sanitized = sanitize_terminal_line(raw);
        if sanitized.is_empty() {
            wipe_bytes(sanitized.into_bytes());
            return;
        }
        if is_token_charset(&sanitized) && sanitized.starts_with(TOKEN_PREFIX) {
            self.start_candidate(sanitized, now);
            return;
        }
        if self.candidate_open && self.continues_candidate(&sanitized) {
            self.extend_candidate(sanitized, now);
            return;
        }
        self.close_candidate();
        wipe_bytes(sanitized.into_bytes());
    }

    /// A new token line begins. It becomes the candidate (the LAST match wins),
    /// EXCEPT that a line too short to satisfy the rule may not displace an
    /// already-matched candidate: a stray short `sk-ant-…` echo must not be able
    /// to destroy a token this capture already holds.
    fn start_candidate(&mut self, line: String, now: Instant) {
        let full = is_seat_token_line(&line);
        if !full && self.candidate_matched {
            self.close_candidate();
            wipe_bytes(line.into_bytes());
            return;
        }
        if let Some(previous) = self.candidate.take() {
            wipe_bytes(previous.into_bytes());
        }
        self.candidate_matched = full;
        self.candidate = Some(line);
        self.candidate_open = true;
        if full {
            self.matched_at = Some(now);
        }
    }

    /// Is `segment` the remainder of the hard-wrapped candidate line?
    fn continues_candidate(&self, segment: &str) -> bool {
        let Some(candidate) = self.candidate.as_ref() else {
            return false;
        };
        segment.len() <= candidate.len()
            && !segment.starts_with(TOKEN_PREFIX)
            && is_token_charset(segment)
    }

    /// Append a wrap remainder, keeping the candidate open so a token wrapped
    /// over three or more rows rejoins in full. The two source buffers are
    /// wiped, not dropped: the joined `String` is a fresh allocation.
    fn extend_candidate(&mut self, tail: String, now: Instant) {
        let Some(head) = self.candidate.take() else {
            return;
        };
        let mut joined = String::with_capacity(head.len() + tail.len());
        joined.push_str(&head);
        joined.push_str(&tail);
        tracing::debug!(
            head_len = head.len(),
            tail_len = tail.len(),
            "mint capture rejoined a hard-wrapped token line"
        );
        wipe_bytes(head.into_bytes());
        wipe_bytes(tail.into_bytes());
        self.candidate_matched = is_seat_token_line(&joined);
        self.candidate = Some(joined);
        if self.candidate_matched {
            self.matched_at = Some(now);
        }
    }

    /// A non-continuation line ended the token line's run. A matched candidate
    /// is kept (it is the capture's answer until a later match replaces it); an
    /// unmatched accumulation was never a token and is wiped on the spot.
    fn close_candidate(&mut self) {
        self.candidate_open = false;
        if !self.candidate_matched {
            if let Some(partial) = self.candidate.take() {
                wipe_bytes(partial.into_bytes());
            }
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
///
/// The zeroing is done with volatile writes plus a compiler fence — a plain
/// `*byte = 0` loop immediately before a drop is a dead store the optimizer
/// is entitled to elide, which would silently defeat the scrub. The FULL
/// capacity is zeroed, not just `len`: in-place edits (`String::drain`,
/// `truncate`) leave stale token bytes between `len` and `capacity`.
fn wipe_bytes(mut bytes: Vec<u8>) {
    let capacity = bytes.capacity();
    let ptr = bytes.as_mut_ptr();
    // SAFETY: `ptr..ptr+capacity` is this Vec's own live allocation, `u8` has
    // no validity invariants, and the length is set to 0 first so no safe
    // reader can observe the overwritten region as initialized contents.
    unsafe {
        bytes.set_len(0);
        for offset in 0..capacity {
            std::ptr::write_volatile(ptr.add(offset), 0);
        }
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    drop(bytes);
}

/// The capture rule, exactly: `^sk-ant-[A-Za-z0-9_-]{40,}$`. Hand-rolled (no
/// regex dependency) and total: a prefix match plus a 40+-char tail of the
/// exact character class.
pub fn is_seat_token_line(line: &str) -> bool {
    let Some(rest) = line.strip_prefix(TOKEN_PREFIX) else {
        return false;
    };
    rest.len() >= 40 && is_token_charset(rest)
}

/// The token rule's prefix. `oat01` is server-issued and observed, not
/// contractual, so the prefix stays loose.
const TOKEN_PREFIX: &str = "sk-ant-";

/// The token rule's character class, `[A-Za-z0-9_-]`. Non-empty is the caller's
/// business: an empty segment is never a token or a continuation.
fn is_token_charset(text: &str) -> bool {
    text.chars()
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
    // Trim IN PLACE and return `out` itself: `out.trim().to_string()` would
    // copy a matched token into a fresh allocation and drop `out` un-zeroed,
    // defeating the wipe invariant on the exact bytes it exists to scrub
    // (every buffer this function returns is later fed to `wipe_bytes`, which
    // zeroes the full capacity — covering the bytes `drain` shifts past the
    // end too).
    let end = out.trim_end().len();
    out.truncate(end);
    let leading = out.len() - out.trim_start().len();
    if leading > 0 {
        out.drain(..leading);
    }
    out
}
