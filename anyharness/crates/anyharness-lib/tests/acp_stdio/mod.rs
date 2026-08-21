//! A deadline-bounded newline-delimited-JSON peer for driving a spawned ACP
//! agent over stdio, shared by the tests in `windows_acp_handshake.rs`.
//!
//! The framing is hand-rolled rather than driven through
//! `acp::ClientSideConnection` on purpose: that client owns its own async
//! runtime and its own unbounded read loop, and a hang inside it would give no
//! diagnosis. The BYTES are identical (the adapter reads the stream with
//! `ndJsonStream(...)` over `process.stdin`), and the request and response
//! payloads still go through the real `acp::schema` types at the call sites, so
//! the only thing reimplemented here is "one JSON value per line".
//!
//! Every read is bounded. There is no code path here that waits forever and no
//! code path that turns silence into success: silence is
//! `ACP-HANDSHAKE-TIMEOUT`, a closed stream is `ACP-HANDSHAKE-EOF`, and an
//! unusable stdin handle is `ACP-HANDSHAKE-WRITE-FAILED`.
//!
//! This lives in a subdirectory, not at `tests/acp_stdio.rs`, so cargo does not
//! pick it up as a second integration-test target.

// Not every test in the suite touches every helper; the module is shared
// support code, not a public API.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum HandshakeFailure {
    /// Nothing came back in time. The loud one.
    Timeout {
        method: String,
        waited: Duration,
        stderr: String,
        transcript: Vec<String>,
    },
    /// stdout closed (or errored) without ever carrying our response.
    Eof {
        method: String,
        stderr: String,
        transcript: Vec<String>,
    },
    /// The request could not even be handed to the child.
    WriteFailed { method: String, error: String },
}

impl std::fmt::Display for HandshakeFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Timeout {
                method,
                waited,
                stderr,
                transcript,
            } => write!(
                f,
                "ACP-HANDSHAKE-TIMEOUT: no JSON-RPC response to `{method}` arrived on stdout \
                 within {waited:?}. The process was spawned and accepted the request but never \
                 answered it. This is a failure, not a skip.\n\
                 lines received on stdout ({} total): {transcript:#?}\n\
                 stderr so far:\n{stderr}",
                transcript.len()
            ),
            Self::Eof {
                method,
                stderr,
                transcript,
            } => write!(
                f,
                "ACP-HANDSHAKE-EOF: stdout closed before any JSON-RPC response to `{method}` \
                 arrived. The process exited or dropped the stream instead of answering. An \
                 empty response is a failure, not a pass.\n\
                 lines received on stdout ({} total): {transcript:#?}\n\
                 stderr so far:\n{stderr}",
                transcript.len()
            ),
            Self::WriteFailed { method, error } => write!(
                f,
                "ACP-HANDSHAKE-WRITE-FAILED: could not write the `{method}` request to the \
                 child's stdin: {error}. The stdio handle the launcher handed us is not usable."
            ),
        }
    }
}

/// Owns a spawned process and reads newline-delimited JSON off its stdout with
/// a deadline on every read.
///
/// The framing is hand-rolled rather than driven through
/// `acp::ClientSideConnection` on purpose: that client owns its own async
/// runtime and its own (unbounded) read loop, and a hang inside it would give
/// no diagnosis. The BYTES are identical — the adapter reads this stream with
/// `ndJsonStream(...)` over `process.stdin` — and the request and response
/// payloads below still go through the real `acp::schema` types, so the only
/// thing reimplemented here is "one JSON value per line".
pub struct AcpPeer {
    child: Child,
    stdin: Option<std::process::ChildStdin>,
    lines: Receiver<String>,
    stderr: Arc<Mutex<String>>,
    transcript: Vec<String>,
}

impl AcpPeer {
    pub fn attach(mut child: Child) -> Self {
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");

        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if tx.send(line).is_err() {
                            return;
                        }
                    }
                    // A read error is EOF for our purposes; dropping `tx` on
                    // the way out is what signals it.
                    Err(_) => return,
                }
            }
        });

        let stderr_buffer = Arc::new(Mutex::new(String::new()));
        let stderr_sink = Arc::clone(&stderr_buffer);
        std::thread::spawn(move || {
            // Drained continuously so the child can never wedge on a full
            // stderr pipe while we are waiting on stdout.
            let mut chunk = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut stderr, &mut chunk) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n]).into_owned();
                        if let Ok(mut sink) = stderr_sink.lock() {
                            sink.push_str(&text);
                        }
                    }
                }
            }
        });

        Self {
            child,
            stdin: Some(stdin),
            lines,
            stderr: stderr_buffer,
            transcript: Vec::new(),
        }
    }

    pub fn stderr_snapshot(&self) -> String {
        self.stderr
            .lock()
            .map(|sink| sink.clone())
            .unwrap_or_else(|_| "<stderr buffer poisoned>".to_string())
    }

    /// Write one JSON-RPC request and read until its response, or until the
    /// deadline. Never blocks without a bound.
    pub fn request(
        &mut self,
        id: u64,
        method: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, HandshakeFailure> {
        let line = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();
        println!("--> {line}");

        let stdin = self.stdin.as_mut().expect("stdin still open");
        if let Err(error) = stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.write_all(b"\n"))
            .and_then(|()| stdin.flush())
        {
            return Err(HandshakeFailure::WriteFailed {
                method: method.to_string(),
                error: format!("{error} (kind {:?})", error.kind()),
            });
        }

        let started = Instant::now();
        let deadline = started + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(HandshakeFailure::Timeout {
                    method: method.to_string(),
                    waited: started.elapsed(),
                    stderr: self.stderr_snapshot(),
                    transcript: self.transcript.clone(),
                });
            }
            match self.lines.recv_timeout(remaining) {
                Ok(line) => {
                    println!("<-- {line}");
                    self.transcript.push(line.clone());
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        // Not JSON at all. Recorded, not fatal on its own: the
                        // deadline is what ends the loop. If cmd.exe ever
                        // injects a banner line into the stream this is where
                        // it will show up in the log.
                        continue;
                    };
                    // A response, not an agent-initiated request: responses
                    // carry no `method`.
                    if value.get("method").is_some() {
                        continue;
                    }
                    if value.get("id").and_then(serde_json::Value::as_u64) != Some(id) {
                        continue;
                    }
                    println!(
                        "response to `{method}` (id {id}) arrived after {:?}",
                        started.elapsed()
                    );
                    return Ok(value);
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(HandshakeFailure::Timeout {
                        method: method.to_string(),
                        waited: started.elapsed(),
                        stderr: self.stderr_snapshot(),
                        transcript: self.transcript.clone(),
                    })
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(HandshakeFailure::Eof {
                        method: method.to_string(),
                        stderr: self.stderr_snapshot(),
                        transcript: self.transcript.clone(),
                    })
                }
            }
        }
    }

    /// Close stdin and wait, bounded, for the process to exit.
    pub fn close_stdin_and_wait(mut self, timeout: Duration) -> (Option<ExitStatus>, String) {
        drop(self.stdin.take());
        let deadline = Instant::now() + timeout;
        let mut status = None;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(exited)) => {
                    status = Some(exited);
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => panic!("try_wait on the managed agent failed: {error}"),
            }
        }
        if status.is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        (status, self.stderr_snapshot())
    }

    pub fn kill(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Spawn a node one-liner with all three handles piped.
///
/// Node is not optional and is never skipped past: the managed install these
/// tests exercise runs `npm install`, so a runner without node cannot run any
/// test in this suite at all. A missing node is a hard failure with its own
/// message, never a skip.
pub fn spawn_node(label: &str, script: &str) -> Child {
    Command::new("node")
        .arg("-e")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| {
            panic!(
                "could not spawn the `{label}` discriminator process (`node -e ...`): {error} \
                 (kind {:?}). node is required by the managed install path this file tests, so \
                 this is a failure, not a reason to skip.",
                error.kind()
            )
        })
}
