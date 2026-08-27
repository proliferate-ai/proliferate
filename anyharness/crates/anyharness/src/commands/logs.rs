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

// `commands/logs/` would be swallowed by the repo-wide `logs/` gitignore
// entry, so the pure half lives beside this file instead of under it.
#[path = "logs_model.rs"]
pub mod model;
pub use model::*;

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
