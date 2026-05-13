use tokio::process::ChildStderr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::live::sessions) enum AgentStderrSeverity {
    Error,
    Warn,
    Debug,
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

pub(in crate::live::sessions) fn spawn_agent_stderr_logger(
    stderr: ChildStderr,
    session_id: String,
    agent_kind: String,
) {
    tokio::task::spawn_local(async move {
        use tokio::io::AsyncBufReadExt;
        let reader = tokio::io::BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = sanitize_agent_stderr_line(&line);
            if line.is_empty() {
                continue;
            }

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
}
