//! `anyharness logs` — the local tail: everything that happened on this
//! machine, across every process, one time-ordered stream.
//!
//! Collector-first: the diagnostics collector is THE local log store
//! (admission, order, retention), reached through the connection-descriptor
//! file its desktop host writes; the per-process file sinks (anyharness,
//! worker, supervisor, local-dev server) are the fallback and the free-text
//! detail. A missing source degrades loudly to one line saying what is
//! absent — never silently.
//!
//! Filtering law: JSON lines and collector records carry a `session_id` the
//! filter can hold onto; a text line cannot, so under `--session` text lines
//! are excluded and counted rather than guessed at.
//!
//! Spec: observability README §3 Flow 5. Frozen scope:
//! delivery/observability/delivery-spec-slice-3-local-tail.md.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use clap::Args;

#[derive(Args, Debug)]
pub struct LogsArgs {
    /// Only this session's story (UUID; matches JSON lines and collector records)
    #[arg(long)]
    pub session: Option<String>,
    /// Minimum level: error, warn, info, debug, trace
    #[arg(long)]
    pub level: Option<String>,
    /// Window start: a duration like 15m / 2h / 30s, or an RFC3339 timestamp
    #[arg(long, default_value = "15m")]
    pub since: String,
    /// Keep streaming as new lines and records arrive
    #[arg(long)]
    pub follow: bool,
    /// Discovery root (holds worker/, supervisor/, server/, diagnostics/);
    /// defaults to ~/.proliferate
    #[arg(long)]
    pub dir: Option<PathBuf>,
    /// Runtime home whose logs/anyharness.log to read; defaults to the
    /// standard runtime home
    #[arg(long)]
    pub runtime_home: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "trace" => Some(Self::Trace),
            "debug" => Some(Self::Debug),
            "info" => Some(Self::Info),
            "warn" | "warning" => Some(Self::Warn),
            "error" | "critical" | "fatal" => Some(Self::Error),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Trace => "TRACE",
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

/// One line of the merged stream, whatever its source.
#[derive(Debug, Clone)]
pub struct LogLine {
    pub timestamp: Option<DateTime<Utc>>,
    pub level: Option<Level>,
    pub source: String,
    pub session_id: Option<String>,
    pub text: String,
}

/// Why a line is not in the output: filtered is a decision, unfilterable is
/// an honesty count (a text line cannot carry the session filter).
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    Filtered,
    Unfilterable,
}

pub struct Filters {
    pub session: Option<String>,
    pub min_level: Option<Level>,
    pub since: Option<DateTime<Utc>>,
}

impl Filters {
    pub fn verdict(&self, line: &LogLine) -> Verdict {
        if let (Some(since), Some(timestamp)) = (self.since, line.timestamp) {
            if timestamp < since {
                return Verdict::Filtered;
            }
        }
        if let Some(min) = self.min_level {
            match line.level {
                Some(level) if level >= min => {}
                Some(_) => return Verdict::Filtered,
                // A line with no level (a continuation, a bare text line)
                // is not level-filtered: levels are advisory for text.
                None => {}
            }
        }
        if let Some(session) = &self.session {
            match &line.session_id {
                Some(id) if id == session => {}
                Some(_) => return Verdict::Filtered,
                None => return Verdict::Unfilterable,
            }
        }
        Verdict::Pass
    }
}

/// `15m`, `2h`, `30s`, `1d`, or RFC3339.
pub fn parse_since(text: &str, now: DateTime<Utc>) -> Result<DateTime<Utc>, String> {
    let trimmed = text.trim();
    if let Ok(instant) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(instant.with_timezone(&Utc));
    }
    let (digits, unit) = trimmed.split_at(trimmed.len().saturating_sub(1));
    let value: i64 = digits
        .parse()
        .map_err(|_| format!("--since {trimmed:?} is neither a duration (15m) nor RFC3339"))?;
    let seconds = match unit {
        "s" => value,
        "m" => value * 60,
        "h" => value * 3600,
        "d" => value * 86_400,
        _ => return Err(format!("--since unit {unit:?} must be one of s m h d")),
    };
    Ok(now - chrono::Duration::seconds(seconds))
}

/// Parses one file-sink line. Two JSON shapes exist (the Rust sinks nest
/// event fields under `fields`, the server writes them flat); anything that
/// is not JSON is a human-format text line and keeps only its raw text.
pub fn parse_sink_line(source: &str, raw: &str) -> LogLine {
    let raw = raw.trim_end();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        if value.is_object() {
            let fields = value.get("fields").and_then(|f| f.as_object());
            let pick = |key: &str| -> Option<String> {
                fields
                    .and_then(|f| f.get(key))
                    .or_else(|| value.get(key))
                    .and_then(|v| v.as_str())
                    .map(str::to_owned)
            };
            let timestamp = value
                .get("timestamp")
                .and_then(|v| v.as_str())
                .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
                .map(|v| v.with_timezone(&Utc));
            return LogLine {
                timestamp,
                level: value
                    .get("level")
                    .and_then(|v| v.as_str())
                    .and_then(Level::parse),
                source: source.to_owned(),
                session_id: pick("session_id"),
                text: pick("message").unwrap_or_else(|| raw.to_owned()),
            };
        }
    }
    // The tracing text format (what the Rust sinks write in local dev):
    // `2026-08-27T10:00:01.123456Z  INFO target: message`. The leading
    // timestamp and level are what --since and the merge need; the session
    // filter still cannot hold onto a text line and says so.
    let mut tokens = raw.split_whitespace();
    let timestamp = tokens
        .next()
        .and_then(|token| DateTime::parse_from_rfc3339(token).ok())
        .map(|value| value.with_timezone(&Utc));
    let level = timestamp.and(tokens.next().and_then(Level::parse));
    LogLine {
        timestamp,
        level,
        source: source.to_owned(),
        session_id: None,
        text: raw.to_owned(),
    }
}

/// Turns one collector record (a `CollectorAcceptedRecordV1` JSON value) into
/// a stream line. The record's stable name is the text; a detailed record's
/// human message rides behind it.
pub fn record_line(value: &serde_json::Value) -> LogLine {
    let record = value.get("record").unwrap_or(value);
    let name = record.get("name").and_then(|v| v.as_str()).unwrap_or("?");
    let message = record.pointer("/detailed/message").and_then(|v| v.as_str());
    let lifecycle = record.pointer("/lifecycle/phase").and_then(|v| v.as_str());
    let outcome = record
        .pointer("/lifecycle/outcome")
        .and_then(|v| v.as_str());
    let mut text = name.to_owned();
    if let Some(phase) = lifecycle {
        text.push_str(&format!(
            " [{phase}{}]",
            outcome.map(|o| format!(":{o}")).unwrap_or_default()
        ));
    }
    if let Some(message) = message {
        text.push_str(": ");
        text.push_str(message);
    }
    LogLine {
        timestamp: record
            .get("source_timestamp")
            .and_then(|v| v.as_str())
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.with_timezone(&Utc)),
        level: record
            .get("severity")
            .and_then(|v| v.as_str())
            .and_then(Level::parse),
        source: format!(
            "collector/{}",
            record
                .get("component")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
        ),
        session_id: record
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        text,
    }
}

/// Stable merge: by timestamp, then arrival order. Timestamp-less lines ride
/// with the previous timestamped line from the same source (a stack trace
/// stays under its header).
pub fn merge_sorted(mut lines: Vec<(usize, LogLine)>) -> Vec<LogLine> {
    let mut last_seen: BTreeMap<String, DateTime<Utc>> = BTreeMap::new();
    for (_, line) in lines.iter_mut() {
        match line.timestamp {
            Some(timestamp) => {
                last_seen.insert(line.source.clone(), timestamp);
            }
            None => line.timestamp = last_seen.get(&line.source).copied(),
        }
    }
    lines.sort_by(|(seq_a, a), (seq_b, b)| {
        a.timestamp.cmp(&b.timestamp).then_with(|| seq_a.cmp(seq_b))
    });
    lines.into_iter().map(|(_, line)| line).collect()
}

pub fn render(line: &LogLine) -> String {
    let time = line
        .timestamp
        .map(|t| t.format("%H:%M:%S%.3f").to_string())
        .unwrap_or_else(|| "--:--:--".to_owned());
    let level = line.level.map(Level::label).unwrap_or("     ");
    let session = line
        .session_id
        .as_deref()
        .map(|id| format!(" ({})", id.chars().take(8).collect::<String>()))
        .unwrap_or_default();
    format!("{time} {level:5} [{}]{session} {}", line.source, line.text)
}

/// The connection-descriptor file the desktop host writes beside its state
/// (`<root>/diagnostics/collector.json`, 0600): endpoint + capability for
/// the collector's loopback surface.
#[derive(serde::Deserialize)]
pub struct DescriptorFile {
    pub endpoint: String,
    pub capability: String,
}

pub fn discovery_root(dir: Option<PathBuf>) -> PathBuf {
    dir.unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".proliferate")
    })
}

pub fn sink_paths(root: &Path, runtime_home: &Path) -> Vec<(String, PathBuf)> {
    vec![
        (
            "anyharness".to_owned(),
            runtime_home.join("logs/anyharness.log"),
        ),
        ("worker".to_owned(), root.join("worker/logs/worker.log")),
        (
            "supervisor".to_owned(),
            root.join("supervisor/logs/supervisor.log"),
        ),
        ("server".to_owned(), root.join("server/logs/server.log")),
    ]
}

fn read_descriptor(root: &Path) -> Option<DescriptorFile> {
    let raw = std::fs::read_to_string(root.join("diagnostics/collector.json")).ok()?;
    let descriptor: DescriptorFile = serde_json::from_str(&raw).ok()?;
    // Symmetric with the desktop's own client: the capability travels only
    // to the loopback surface it was minted for, whatever the file says.
    if !descriptor.endpoint.starts_with("http://127.0.0.1:") {
        return None;
    }
    Some(descriptor)
}

/// The session filter's input domain is closed to UUID shape before it
/// reaches a query string or a URL.
pub fn valid_session_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

/// Backfill: every retained record inside the window, oldest-first, paged on
/// the retention cursor. Returns the records and the highest cursor seen, so
/// follow mode resumes exactly where backfill ended instead of replaying the
/// store from zero.
fn collector_backfill(
    descriptor: &DescriptorFile,
    session: Option<&str>,
    since: Option<DateTime<Utc>>,
) -> Result<(Vec<serde_json::Value>, u64), String> {
    let client = reqwest::blocking::Client::new();
    let mut records = Vec::new();
    let mut cursor: Option<u64> = None;
    loop {
        let mut url = format!(
            "{}/v1/records?schema_version=1.1&limit=500",
            descriptor.endpoint.trim_end_matches('/')
        );
        if let Some(session) = session {
            url.push_str(&format!("&session_id={session}"));
        }
        if let Some(since) = since {
            url.push_str(&format!(
                "&source_time_from={}",
                since.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            ));
        }
        if let Some(cursor) = cursor {
            url.push_str(&format!("&after_cursor={cursor}"));
        }
        let page: serde_json::Value = client
            .get(url)
            .bearer_auth(&descriptor.capability)
            .timeout(Duration::from_secs(5))
            .send()
            .map_err(|e| format!("collector unreachable: {e}"))?
            .error_for_status()
            .map_err(|e| format!("collector refused: {e}"))?
            .json()
            .map_err(|e| format!("collector page unreadable: {e}"))?;
        if let Some(batch) = page.get("records").and_then(|v| v.as_array()) {
            records.extend(batch.iter().cloned());
        }
        match page.get("next_cursor").and_then(|v| v.as_u64()) {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    let max_cursor = records
        .iter()
        .filter_map(|record| record.get("retention_cursor").and_then(|v| v.as_u64()))
        .max()
        .unwrap_or(0);
    Ok((records, max_cursor))
}
fn spawn_file_follow(source: String, path: PathBuf, from: u64, tx: mpsc::Sender<LogLine>) {
    std::thread::spawn(move || {
        let mut offset = from;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let Ok(mut file) = std::fs::File::open(&path) else {
                continue;
            };
            let Ok(len) = file.metadata().map(|m| m.len()) else {
                continue;
            };
            if len < offset {
                offset = 0; // rotated: start over on the new file
            }
            if len == offset {
                continue;
            }
            if file.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut buffer = Vec::new();
            if file.read_to_end(&mut buffer).is_err() {
                continue;
            }
            // Only complete lines are consumed; a partially-written final
            // line waits for its newline rather than being emitted as a
            // fragment. Non-UTF-8 bytes render lossily instead of stalling
            // the source.
            let Some(consumed) = buffer
                .iter()
                .rposition(|byte| *byte == b'\n')
                .map(|i| i + 1)
            else {
                continue;
            };
            offset += consumed as u64;
            for raw in String::from_utf8_lossy(&buffer[..consumed]).lines() {
                if tx.send(parse_sink_line(&source, raw)).is_err() {
                    return;
                }
            }
        }
    });
}
fn spawn_collector_follow(descriptor: DescriptorFile, from_cursor: u64, tx: mpsc::Sender<LogLine>) {
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::new();
        let mut cursor = from_cursor;
        let mut attempts = 0_u32;
        loop {
            let connection = client
                .get(format!(
                    "{}/v1/tail?schema_version=1.1&after_cursor={cursor}",
                    descriptor.endpoint.trim_end_matches('/')
                ))
                .bearer_auth(&descriptor.capability)
                .send()
                .and_then(reqwest::blocking::Response::error_for_status);
            let response = match connection {
                Ok(response) => {
                    attempts = 0;
                    response
                }
                Err(error) => {
                    attempts += 1;
                    if attempts == 1 {
                        eprintln!("(collector stream degraded: {error}; retrying)");
                    }
                    if attempts > 10 {
                        eprintln!("(collector stream gave up after 10 attempts)");
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };
            let reader = BufReader::new(response);
            for raw in reader.lines() {
                let Ok(raw) = raw else { break };
                let Ok(frame) = serde_json::from_str::<serde_json::Value>(&raw) else {
                    continue;
                };
                match frame.get("frame").and_then(|v| v.as_str()) {
                    Some("records") => {
                        if let Some(next) = frame.get("cursor").and_then(|v| v.as_u64()) {
                            cursor = next;
                        }
                        for record in frame
                            .get("records")
                            .and_then(|v| v.as_array())
                            .into_iter()
                            .flatten()
                        {
                            if tx.send(record_line(record)).is_err() {
                                return;
                            }
                        }
                    }
                    Some("lag") => {
                        let dropped = frame
                            .get("dropped_frames")
                            .and_then(|v| v.as_u64())
                            .unwrap_or_default();
                        if let Some(resume) =
                            frame.get("resume_after_cursor").and_then(|v| v.as_u64())
                        {
                            cursor = resume;
                        }
                        eprintln!("(collector stream lagged: {dropped} frames dropped; resuming)");
                    }
                    Some("gap") => {
                        eprintln!("(collector retention gap: some records aged out mid-stream)");
                    }
                    _ => {}
                }
            }
            // The stream ended (collector stopped or restarted). Say so and
            // resume from the last cursor: the next ready generation rewrites
            // the descriptor, but the endpoint usually survives a restart.
            eprintln!("(collector stream ended; reconnecting)");
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
pub fn run(args: LogsArgs) -> anyhow::Result<()> {
    let now = Utc::now();
    if let Some(session) = args.session.as_deref() {
        if !valid_session_id(session) {
            anyhow::bail!("--session must be a canonical UUID");
        }
    }
    let since = parse_since(&args.since, now).map_err(anyhow::Error::msg)?;
    let filters = Filters {
        session: args.session.clone(),
        min_level: args.level.as_deref().and_then(Level::parse),
        since: Some(since),
    };
    let root = discovery_root(args.dir);
    let runtime_home = args
        .runtime_home
        .clone()
        .unwrap_or_else(|| PathBuf::from(anyharness_lib::app::default_runtime_home()));

    let mut unfilterable = 0_u64;
    let mut sequence = 0_usize;
    let mut backfill: Vec<(usize, LogLine)> = Vec::new();
    let mut offsets: Vec<(String, PathBuf, u64)> = Vec::new();

    for (source, path) in sink_paths(&root, &runtime_home) {
        match std::fs::File::open(&path) {
            Ok(mut file) => {
                // Backfill exactly the bytes follow mode resumes after: the
                // last complete line at open time. Bytes appended during the
                // read belong to the follower, never to both.
                let mut buffer = Vec::new();
                let consumed = if file.read_to_end(&mut buffer).is_ok() {
                    buffer
                        .iter()
                        .rposition(|byte| *byte == b'\n')
                        .map_or(0, |i| i + 1)
                } else {
                    0
                };
                for raw in String::from_utf8_lossy(&buffer[..consumed]).lines() {
                    let line = parse_sink_line(&source, raw);
                    sequence += 1;
                    backfill.push((sequence, line));
                }
                offsets.push((source, path, consumed as u64));
            }
            Err(_) => {
                eprintln!("(source absent: {} — {})", source, path.display());
                // Follow mode still watches the path: a sink that appears
                // later (the dev server starting) joins the stream.
                offsets.push((source, path, 0));
            }
        }
    }

    let descriptor = read_descriptor(&root);
    let mut collector_cursor = 0_u64;
    match &descriptor {
        Some(descriptor) => {
            match collector_backfill(descriptor, filters.session.as_deref(), Some(since)) {
                Ok((records, max_cursor)) => {
                    collector_cursor = max_cursor;
                    for record in &records {
                        sequence += 1;
                        backfill.push((sequence, record_line(record)));
                    }
                }
                Err(reason) => eprintln!("(collector degraded: {reason})"),
            }
        }
        None => eprintln!(
            "(collector absent: no readable loopback descriptor at {}/diagnostics/collector.json — is the desktop app running?)",
            root.display()
        ),
    }

    for line in merge_sorted(backfill) {
        match filters.verdict(&line) {
            Verdict::Pass => println!("{}", render(&line)),
            Verdict::Filtered => {}
            Verdict::Unfilterable => unfilterable += 1,
        }
    }
    if unfilterable > 0 {
        eprintln!(
            "({unfilterable} text lines could not carry the session filter and were excluded)"
        );
    }

    if !args.follow {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<LogLine>();
    for (source, path, offset) in offsets {
        spawn_file_follow(source, path, offset, tx.clone());
    }
    if let Some(descriptor) = descriptor {
        spawn_collector_follow(descriptor, collector_cursor, tx.clone());
    }
    drop(tx);
    for line in rx {
        match filters.verdict(&line) {
            Verdict::Pass => println!("{}", render(&line)),
            Verdict::Filtered | Verdict::Unfilterable => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(seconds: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 27, 10, 0, seconds).unwrap()
    }

    #[test]
    fn both_json_shapes_and_text_parse() {
        let rust = parse_sink_line(
            "worker",
            r#"{"timestamp":"2026-08-27T10:00:01Z","level":"INFO","fields":{"message":"probe ok","session_id":"s-1"}}"#,
        );
        assert_eq!(rust.text, "probe ok");
        assert_eq!(rust.session_id.as_deref(), Some("s-1"));
        assert_eq!(rust.level, Some(Level::Info));

        let python = parse_sink_line(
            "server",
            r#"{"timestamp":"2026-08-27T10:00:02+00:00","level":"WARNING","message":"slow request","session_id":"s-2"}"#,
        );
        assert_eq!(python.text, "slow request");
        assert_eq!(python.level, Some(Level::Warn));
        assert_eq!(python.session_id.as_deref(), Some("s-2"));

        let text = parse_sink_line("anyharness", "plain human line");
        assert!(text.timestamp.is_none());
        assert!(text.session_id.is_none());
    }

    #[test]
    fn merge_orders_globally_and_glues_text_to_its_header() {
        let mk = |seconds: Option<u32>, source: &str, text: &str| LogLine {
            timestamp: seconds.map(at),
            level: None,
            source: source.to_owned(),
            session_id: None,
            text: text.to_owned(),
        };
        let merged = merge_sorted(vec![
            (1, mk(Some(5), "worker", "w1")),
            (2, mk(None, "worker", "w1-trace")),
            (3, mk(Some(2), "server", "s1")),
            (4, mk(Some(7), "collector/anyharness", "c1")),
        ]);
        let texts: Vec<_> = merged.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, vec!["s1", "w1", "w1-trace", "c1"]);
    }

    #[test]
    fn session_filter_excludes_and_counts_what_it_cannot_hold() {
        let filters = Filters {
            session: Some("s-1".to_owned()),
            min_level: None,
            since: None,
        };
        let mine = parse_sink_line(
            "worker",
            r#"{"timestamp":"2026-08-27T10:00:01Z","level":"INFO","fields":{"message":"m","session_id":"s-1"}}"#,
        );
        let theirs = parse_sink_line(
            "worker",
            r#"{"timestamp":"2026-08-27T10:00:01Z","level":"INFO","fields":{"message":"m","session_id":"s-2"}}"#,
        );
        let text = parse_sink_line("worker", "no ids here");
        assert_eq!(filters.verdict(&mine), Verdict::Pass);
        assert_eq!(filters.verdict(&theirs), Verdict::Filtered);
        assert_eq!(filters.verdict(&text), Verdict::Unfilterable);
    }

    #[test]
    fn since_and_level_windows_hold() {
        let now = at(30);
        assert_eq!(
            parse_since("15m", now).unwrap(),
            now - chrono::Duration::seconds(900)
        );
        assert!(parse_since("2026-08-27T09:00:00Z", now).is_ok());
        assert!(parse_since("soon", now).is_err());

        let filters = Filters {
            session: None,
            min_level: Some(Level::Warn),
            since: Some(at(10)),
        };
        let old_error = LogLine {
            timestamp: Some(at(5)),
            level: Some(Level::Error),
            source: "s".into(),
            session_id: None,
            text: "old".into(),
        };
        let new_info = LogLine {
            timestamp: Some(at(20)),
            level: Some(Level::Info),
            ..old_error.clone()
        };
        let new_error = LogLine {
            timestamp: Some(at(20)),
            level: Some(Level::Error),
            ..old_error.clone()
        };
        assert_eq!(filters.verdict(&old_error), Verdict::Filtered);
        assert_eq!(filters.verdict(&new_info), Verdict::Filtered);
        assert_eq!(filters.verdict(&new_error), Verdict::Pass);
    }

    #[test]
    fn the_tracing_text_format_yields_timestamp_and_level() {
        let line = parse_sink_line(
            "anyharness",
            "2026-08-27T10:00:01.123456Z  INFO anyharness_lib::live: session ready",
        );
        assert!(
            line.timestamp.is_some(),
            "text lines carry their own timestamp"
        );
        assert_eq!(line.level, Some(Level::Info));
        assert!(
            line.session_id.is_none(),
            "text cannot carry the session filter"
        );
        let continuation = parse_sink_line("anyharness", "    at src/live/mod.rs:42");
        assert!(
            continuation.timestamp.is_none(),
            "stack frames glue to their header"
        );
    }

    #[test]
    fn session_ids_are_uuid_closed_and_render_survives_multibyte() {
        assert!(valid_session_id("0191d1f0-0000-7000-8000-000000000042"));
        assert!(!valid_session_id("0191d1f0-0000-7000-8000-00000000004"));
        assert!(!valid_session_id("'; drop table sessions; --"));
        let line = LogLine {
            timestamp: None,
            level: None,
            source: "worker".to_owned(),
            session_id: Some("€€€€€€€€€€".to_owned()),
            text: "x".to_owned(),
        };
        assert!(render(&line).contains("€€€€€€€€"), "char-safe truncation");
    }

    #[test]
    fn a_lifecycle_record_renders_its_phase_and_outcome() {
        let record = serde_json::json!({
            "record": {
                "name": "anyharness.turn.execute",
                "component": "anyharness",
                "severity": "info",
                "source_timestamp": "2026-08-27T10:00:03Z",
                "session_id": "s-3",
                "lifecycle": { "phase": "terminal", "outcome": "succeeded" }
            }
        });
        let line = record_line(&record);
        assert_eq!(line.source, "collector/anyharness");
        assert_eq!(line.session_id.as_deref(), Some("s-3"));
        assert!(line.text.contains("terminal:succeeded"), "{}", line.text);
    }
}
