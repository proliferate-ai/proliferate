use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::process::ChildStderr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::live::sessions) enum AgentStderrSeverity {
    Error,
    Warn,
    Debug,
}

/// Retains the most recent agent stderr lines so startup failures can surface
/// what the process said before it died.
#[derive(Debug, Clone, Default)]
pub(in crate::live::sessions) struct AgentStderrTail {
    lines: Arc<Mutex<VecDeque<String>>>,
}

impl AgentStderrTail {
    /// Enough to capture a fatal error plus a few lines of context without
    /// bloating the startup error string shown to the user.
    const MAX_LINES: usize = 8;

    pub(in crate::live::sessions) fn push(&self, line: &str) {
        let mut lines = self.lock_lines();
        while lines.len() >= Self::MAX_LINES {
            lines.pop_front();
        }
        lines.push_back(line.to_string());
    }

    pub(in crate::live::sessions) fn snapshot(&self) -> Vec<String> {
        self.lock_lines().iter().cloned().collect()
    }

    fn lock_lines(&self) -> std::sync::MutexGuard<'_, VecDeque<String>> {
        // A poisoned tail must not panic the startup error path it exists to
        // improve; the buffered lines stay usable regardless.
        self.lines
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub(in crate::live::sessions) fn sanitize_agent_stderr_line(line: &str) -> String {
    strip_ansi_escape_codes(line).trim().to_string()
}

pub(in crate::live::sessions) fn classify_agent_stderr_line(line: &str) -> AgentStderrSeverity {
    let upper = line.to_ascii_uppercase();

    if has_log_level_token(&upper, "ERROR") {
        AgentStderrSeverity::Error
    } else if has_log_level_token(&upper, "WARN") || has_log_level_token(&upper, "WARNING") {
        AgentStderrSeverity::Warn
    } else if has_log_level_token(&upper, "INFO")
        || has_log_level_token(&upper, "DEBUG")
        || has_log_level_token(&upper, "TRACE")
    {
        AgentStderrSeverity::Debug
    } else {
        AgentStderrSeverity::Warn
    }
}

pub(in crate::live::sessions) fn has_log_level_token(line: &str, level: &str) -> bool {
    line.starts_with(level)
        || line.contains(&format!(" {level} "))
        || line.contains(&format!(":{level} "))
        || line.contains(&format!(" {level}:"))
}

pub(in crate::live::sessions) fn strip_ansi_escape_codes(input: &str) -> String {
    let mut cleaned = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                for escape_char in chars.by_ref() {
                    if ('@'..='~').contains(&escape_char) {
                        break;
                    }
                }
            }
            continue;
        }

        cleaned.push(ch);
    }

    cleaned
}

/// Returns the tail buffer plus the reader task's handle so callers can wait
/// for the pipe to drain (EOF follows the child's exit) before snapshotting.
pub(in crate::live::sessions) fn spawn_agent_stderr_logger(
    stderr: ChildStderr,
    session_id: String,
    agent_kind: String,
) -> (AgentStderrTail, tokio::task::JoinHandle<()>) {
    let tail = AgentStderrTail::default();
    let tail_writer = tail.clone();
    let reader_task = tokio::task::spawn_local(async move {
        use tokio::io::AsyncBufReadExt;
        let reader = tokio::io::BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = sanitize_agent_stderr_line(&line);
            if line.is_empty() {
                continue;
            }
            tail_writer.push(&line);

            match classify_agent_stderr_line(&line) {
                AgentStderrSeverity::Error => {
                    tracing::error!(
                        session_id = %session_id,
                        agent = %agent_kind,
                        "[agent stderr] {line}"
                    );
                }
                AgentStderrSeverity::Warn => {
                    tracing::warn!(
                        session_id = %session_id,
                        agent = %agent_kind,
                        "[agent stderr] {line}"
                    );
                }
                AgentStderrSeverity::Debug => {
                    tracing::debug!(
                        session_id = %session_id,
                        agent = %agent_kind,
                        "[agent stderr] {line}"
                    );
                }
            }
        }
    });
    (tail, reader_task)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_agent_stderr_line_strips_ansi_sequences() {
        let line = "\u{1b}[2m2026-03-28T03:11:55.593240Z\u{1b}[0m \u{1b}[32m INFO\u{1b}[0m codex_otel.log_only";

        assert_eq!(
            sanitize_agent_stderr_line(line),
            "2026-03-28T03:11:55.593240Z  INFO codex_otel.log_only"
        );
    }

    #[test]
    fn classify_agent_stderr_line_downgrades_info_logs() {
        let line = "2026-03-28T03:11:55.593240Z INFO codex_otel.log_only";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Debug);
    }

    #[test]
    fn classify_agent_stderr_line_preserves_warnings() {
        let line = "2026-03-28T03:11:55.593240Z WARN auth refresh failed";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Warn);
    }

    #[test]
    fn classify_agent_stderr_line_preserves_errors() {
        let line = "2026-03-28T03:11:55.593240Z ERROR session crashed";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Error);
    }

    #[test]
    fn classify_agent_stderr_line_keeps_unknown_stderr_visible() {
        let line = "fatal: failed to resolve workspace";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Warn);
    }

    #[test]
    fn agent_stderr_tail_keeps_only_the_most_recent_lines() {
        let evicted = 3;
        let total = AgentStderrTail::MAX_LINES + evicted;
        let tail = AgentStderrTail::default();
        for index in 0..total {
            tail.push(&format!("line {index}"));
        }

        let snapshot = tail.snapshot();
        assert_eq!(snapshot.len(), AgentStderrTail::MAX_LINES);
        assert_eq!(snapshot.first(), Some(&format!("line {evicted}")));
        assert_eq!(snapshot.last(), Some(&format!("line {}", total - 1)));
    }
}
