//! Unit proofs for the seat-mint capture machine ([`MintCapture`]) — the pure
//! half of the login-terminal domain glue. Split out of `login_terminal.rs` so
//! the machine's own rules and this module's proofs each stay inside the
//! repo file-size cap.

use std::time::Instant;

use super::login_terminal::{
    is_seat_token_line, MintCapture, MintCaptureStatus, MINT_CAPTURE_GRACE,
};

const TOKEN: &str = "sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_x";

/// The real length of a `claude setup-token` credential: three independently
/// verified working setup-tokens and a live keychain access token all measured
/// 108 characters. The truncation this module guards against produced 99.
const REAL_TOKEN_LEN: usize = 108;

/// A token of the real length, with no repeated run long enough to make a
/// rejoin look right by accident.
fn real_length_token() -> String {
    let alphabet: Vec<char> = "aB3dEfGhIjKlMnOpQrStUvWxYz0123456789_-".chars().collect();
    let mut token = String::from("sk-ant-oat01-");
    for index in 0..(REAL_TOKEN_LEN - token.len()) {
        token.push(alphabet[(index * 7 + index / 5) % alphabet.len()]);
    }
    assert_eq!(token.chars().count(), REAL_TOKEN_LEN);
    token
}

fn now() -> Instant {
    Instant::now()
}

/// The byte shape `claude setup-token` puts on the wire for one rendered line
/// that is WIDER than the PTY: Ink hard-wraps at `width`, emits each fragment
/// with its own SGR color pair, and separates them with `\r\r\n` (the exact
/// delimiter observed on a live 120- and 99-column PTY capture).
fn wrapped_line(text: &str, width: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    for fragment in chars.chunks(width) {
        out.extend_from_slice(b"\x1b[38;2;215;119;87m");
        out.extend(fragment.iter().collect::<String>().into_bytes());
        out.extend_from_slice(b"\x1b[39m\r\r\n");
    }
    out
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
    assert!(!is_seat_token_line(
        "prefix sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ));
    assert!(!is_seat_token_line(&format!("sk-ant-{}!", "a".repeat(40))));
}

#[test]
fn captures_the_last_matching_line_through_ansi_noise() {
    let mut capture = MintCapture::new();
    let earlier = format!("sk-ant-{}", "b".repeat(40));
    capture.feed(b"Signing you in...\r\n", now());
    capture.feed(format!("{earlier}\r\n").as_bytes(), now());
    // The real token arrives wrapped in color codes and a CR.
    capture.feed(
        format!("\x1b[1;32m{TOKEN}\x1b[0m\r\n", TOKEN = TOKEN).as_bytes(),
        now(),
    );
    capture.feed(b"Store this token somewhere safe.\r\n", now());
    capture.on_exit(now());
    let token = capture.claim(now()).expect("claimable after exit");
    assert_eq!(token, TOKEN);
}

#[test]
fn a_bare_carriage_return_resets_the_visible_line() {
    // A \r-overwrite spinner: the CLI prints "Waiting…", returns the
    // cursor to column 0 with a bare \r (no \n), and prints the token
    // over it. The token IS the visible line and must capture — merging
    // the segments ("Waitingsk-ant-…") would miss it.
    let mut capture = MintCapture::new();
    capture.feed(format!("Waiting\r{TOKEN}\r\n").as_bytes(), now());
    capture.on_exit(now());
    assert_eq!(capture.claim(now()).as_deref(), Some(TOKEN));
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
    assert!(
        capture.claim(now()).is_none(),
        "a second claim finds nothing"
    );
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
    assert!(
        !debug.contains("sk-ant-"),
        "Debug leaked the token: {debug}"
    );
}

/// PRODUCTION REGRESSION (2026-08-27). `claude setup-token` renders through Ink,
/// which hard-wraps its own output at the PTY width; the login pane resizes the
/// PTY to its own width, so a 108-character token in a 99-column pane arrives as
/// a 99-character head — itself a valid `^sk-ant-…$` line — plus a 9-character
/// tail. The capture stored the head and the seat 401'd on first use.
///
/// The transcript below is the real success frame: the label line, a blank, the
/// token wrapped `\r\r\n`, a blank, and the two dim trailer lines.
#[test]
fn a_token_hard_wrapped_by_the_cli_is_rejoined_byte_for_byte() {
    for width in [99, 80, 40, 27] {
        let token = real_length_token();
        let mut capture = MintCapture::new();
        capture.feed(b"\x1b[32m\xe2\x9c\x93 Long-lived authentication token created successfully!\x1b[39m\r\r\n\r\r\n", now());
        capture.feed(b"Your OAuth token (valid for 1 year):\r\r\n", now());
        capture.feed(&wrapped_line(&token, width), now());
        capture.feed(b"\r\r\n", now());
        capture.feed(
            b"Store this token securely. You won't be able to see it again.\r\r\n",
            now(),
        );
        capture.feed(
            b"Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\r\r\n",
            now(),
        );
        capture.on_exit(now());
        let claimed = capture.claim(now()).expect("claimable after exit");
        assert_eq!(
            claimed.len(),
            token.len(),
            "captured {} chars of a {}-char token at width {width}",
            claimed.len(),
            token.len(),
        );
        assert_eq!(claimed, token, "captured token differs at width {width}");
    }
}

/// The join must not run away: only the segment that IMMEDIATELY follows the
/// token (empty display lines aside) can be its wrap remainder. Once a real
/// line has intervened, a later bare word — `copy`, the tail of the CLI's own
/// wrapped "…use your terminal's native copy" line — must not be appended.
#[test]
fn a_later_bare_word_never_joins_a_closed_candidate() {
    let mut capture = MintCapture::new();
    capture.feed(format!("{TOKEN}\r\r\n\r\r\n").as_bytes(), now());
    capture.feed(b"Store this token securely.\r\r\n", now());
    capture.feed(b"copy\r\r\n", now());
    capture.on_exit(now());
    assert_eq!(capture.claim(now()).as_deref(), Some(TOKEN));
}

/// Two full token lines in a row are two candidates, not one concatenation: an
/// `sk-ant-` prefix marks a token START, so it can never be read as the
/// remainder of the line above it.
#[test]
fn a_second_token_line_replaces_the_first_instead_of_extending_it() {
    let mut capture = MintCapture::new();
    let earlier = format!("sk-ant-{}", "b".repeat(40));
    capture.feed(format!("{earlier}\r\n").as_bytes(), now());
    capture.feed(format!("{TOKEN}\r\n").as_bytes(), now());
    capture.on_exit(now());
    assert_eq!(capture.claim(now()).as_deref(), Some(TOKEN));
}
