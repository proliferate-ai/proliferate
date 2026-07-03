use std::collections::HashMap;

use anyharness_contract::v1::FeedKind;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::model::{
    ActivityProcessRecord, ActivitySubagentRecord, FeedBindingRecord, FeedOwnerKind,
    FeedTransport, ProcessRunStatus, SubagentRunStatus,
};
use crate::domains::sessions::model::SessionEventRecord;
use crate::persistence::Db;

#[derive(Clone)]
pub struct ActivityStore {
    db: Db,
}

impl ActivityStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn with_tx_anyhow<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        self.db.with_tx_anyhow(f)
    }

    // -- processes ----------------------------------------------------------

    pub fn find_process_tx(
        tx: &Connection,
        session_id: &str,
        process_id: &str,
    ) -> rusqlite::Result<Option<ActivityProcessRecord>> {
        tx.query_row(
            "SELECT * FROM activity_processes WHERE session_id = ?1 AND process_id = ?2",
            params![session_id, process_id],
            map_process,
        )
        .optional()
    }

    pub fn list_processes(&self, session_id: &str) -> anyhow::Result<Vec<ActivityProcessRecord>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM activity_processes WHERE session_id = ?1 ORDER BY started_at ASC",
            )?;
            let rows = statement
                .query_map([session_id], map_process)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    /// Still-`running` processes for a session — the attach reset target
    /// (Claude process-bound children die with the harness).
    pub fn list_running_processes_tx(
        tx: &Connection,
        session_id: &str,
    ) -> rusqlite::Result<Vec<ActivityProcessRecord>> {
        let mut statement = tx.prepare(
            "SELECT * FROM activity_processes
             WHERE session_id = ?1 AND status = 'running'
             ORDER BY started_at ASC",
        )?;
        let rows = statement
            .query_map([session_id], map_process)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn upsert_process(tx: &Connection, record: &ActivityProcessRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO activity_processes (
                session_id, workspace_id, process_id, command, cwd, status, exit_code, pid,
                started_at, ended_at, feed_id, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(session_id, process_id) DO UPDATE SET
                command = excluded.command,
                cwd = excluded.cwd,
                status = excluded.status,
                exit_code = excluded.exit_code,
                pid = excluded.pid,
                ended_at = excluded.ended_at,
                feed_id = excluded.feed_id,
                updated_at = excluded.updated_at",
            params![
                record.session_id,
                record.workspace_id,
                record.process_id,
                record.command,
                record.cwd,
                process_status_to_db(record.status),
                record.exit_code,
                record.pid,
                record.started_at,
                record.ended_at,
                record.feed_id,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    // -- subagents ------------------------------------------------------------

    pub fn find_subagent_tx(
        tx: &Connection,
        session_id: &str,
        subagent_id: &str,
    ) -> rusqlite::Result<Option<ActivitySubagentRecord>> {
        tx.query_row(
            "SELECT * FROM activity_subagents WHERE session_id = ?1 AND subagent_id = ?2",
            params![session_id, subagent_id],
            map_subagent,
        )
        .optional()
    }

    pub fn list_subagents(&self, session_id: &str) -> anyhow::Result<Vec<ActivitySubagentRecord>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM activity_subagents WHERE session_id = ?1 ORDER BY updated_at ASC",
            )?;
            let rows = statement
                .query_map([session_id], map_subagent)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    pub fn upsert_subagent(
        tx: &Connection,
        record: &ActivitySubagentRecord,
    ) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO activity_subagents (
                session_id, workspace_id, subagent_id, agent_type, description, model,
                background, status, summary, tokens_used, tool_calls, duration_seconds,
                feed_id, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(session_id, subagent_id) DO UPDATE SET
                agent_type = excluded.agent_type,
                description = excluded.description,
                model = excluded.model,
                background = excluded.background,
                status = excluded.status,
                summary = excluded.summary,
                tokens_used = excluded.tokens_used,
                tool_calls = excluded.tool_calls,
                duration_seconds = excluded.duration_seconds,
                feed_id = excluded.feed_id,
                updated_at = excluded.updated_at",
            params![
                record.session_id,
                record.workspace_id,
                record.subagent_id,
                record.agent_type,
                record.description,
                record.model,
                record.background,
                subagent_status_to_db(record.status),
                record.summary,
                record.tokens_used,
                record.tool_calls,
                record.duration_seconds,
                record.feed_id,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    // -- feed bindings --------------------------------------------------------

    /// Returns the existing binding for this roster element if one exists;
    /// callers use this to keep `feed_id` stable across repeated upserts of
    /// the same owner instead of minting a new opaque id every time.
    pub fn find_feed_binding_tx(
        tx: &Connection,
        session_id: &str,
        owner_kind: FeedOwnerKind,
        owner_id: &str,
    ) -> rusqlite::Result<Option<FeedBindingRecord>> {
        tx.query_row(
            "SELECT * FROM feed_bindings WHERE session_id = ?1 AND owner_kind = ?2 AND owner_id = ?3",
            params![session_id, owner_kind.as_str(), owner_id],
            map_feed_binding,
        )
        .optional()
    }

    /// Resolve one feed by its opaque id — the FeedService's registry lookup
    /// when a `/v1/feeds/{feed_id}` watcher connects.
    pub fn find_feed_binding_by_id(
        &self,
        feed_id: &str,
    ) -> anyhow::Result<Option<FeedBindingRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM feed_bindings WHERE feed_id = ?1",
                params![feed_id],
                map_feed_binding,
            )
            .optional()
            .map_err(Into::into)
        })
    }

    pub fn upsert_feed_binding(tx: &Connection, record: &FeedBindingRecord) -> rusqlite::Result<()> {
        let (transport_kind, path, thread_id, url) = transport_to_db(&record.transport);
        tx.execute(
            "INSERT INTO feed_bindings (
                feed_id, session_id, kind, owner_kind, owner_id, transport_kind,
                transport_path, transport_thread_id, transport_url, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(session_id, owner_kind, owner_id) DO UPDATE SET
                kind = excluded.kind,
                transport_kind = excluded.transport_kind,
                transport_path = excluded.transport_path,
                transport_thread_id = excluded.transport_thread_id,
                transport_url = excluded.transport_url,
                updated_at = excluded.updated_at",
            params![
                record.feed_id,
                record.session_id,
                feed_kind_to_db(record.kind),
                record.owner_kind.as_str(),
                record.owner_id,
                transport_kind,
                path,
                thread_id,
                url,
                record.created_at,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn insert_event(tx: &Connection, record: &SessionEventRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.session_id,
                record.seq,
                record.timestamp,
                record.event_type,
                record.turn_id,
                record.item_id,
                record.payload_json,
            ],
        )?;
        Ok(())
    }

    /// Batch roster read for a page of sessions — one query per table (not
    /// one per session), grouped client-side. Used by `SessionView`'s
    /// batched assembly path.
    pub fn list_rosters_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, (Vec<ActivityProcessRecord>, Vec<ActivitySubagentRecord>)>>
    {
        let mut grouped: HashMap<String, (Vec<ActivityProcessRecord>, Vec<ActivitySubagentRecord>)> =
            HashMap::new();
        if session_ids.is_empty() {
            return Ok(grouped);
        }
        self.db.with_conn(|conn| {
            for session_id in session_ids {
                let mut process_statement = conn.prepare(
                    "SELECT * FROM activity_processes WHERE session_id = ?1 ORDER BY started_at ASC",
                )?;
                let processes = process_statement
                    .query_map([session_id], map_process)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let mut subagent_statement = conn.prepare(
                    "SELECT * FROM activity_subagents WHERE session_id = ?1 ORDER BY updated_at ASC",
                )?;
                let subagents = subagent_statement
                    .query_map([session_id], map_subagent)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                if !processes.is_empty() || !subagents.is_empty() {
                    grouped.insert(session_id.clone(), (processes, subagents));
                }
            }
            Ok(())
        })?;
        Ok(grouped)
    }
}

fn process_status_to_db(status: ProcessRunStatus) -> &'static str {
    match status {
        ProcessRunStatus::Running => "running",
        ProcessRunStatus::Exited => "exited",
    }
}

fn process_status_from_db(value: &str) -> rusqlite::Result<ProcessRunStatus> {
    match value {
        "running" => Ok(ProcessRunStatus::Running),
        "exited" => Ok(ProcessRunStatus::Exited),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown activity process status: {other}").into(),
        )),
    }
}

fn subagent_status_to_db(status: SubagentRunStatus) -> &'static str {
    match status {
        SubagentRunStatus::Running => "running",
        SubagentRunStatus::Completed => "completed",
        SubagentRunStatus::Failed => "failed",
    }
}

fn subagent_status_from_db(value: &str) -> rusqlite::Result<SubagentRunStatus> {
    match value {
        "running" => Ok(SubagentRunStatus::Running),
        "completed" => Ok(SubagentRunStatus::Completed),
        "failed" => Ok(SubagentRunStatus::Failed),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown activity subagent status: {other}").into(),
        )),
    }
}

fn feed_kind_to_db(kind: FeedKind) -> &'static str {
    match kind {
        FeedKind::TerminalBytes => "terminal_bytes",
        FeedKind::Transcript => "transcript",
    }
}

fn feed_kind_from_db(value: &str) -> rusqlite::Result<FeedKind> {
    match value {
        "terminal_bytes" => Ok(FeedKind::TerminalBytes),
        "transcript" => Ok(FeedKind::Transcript),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown feed kind: {other}").into(),
        )),
    }
}

fn transport_to_db(
    transport: &FeedTransport,
) -> (&'static str, Option<&str>, Option<&str>, Option<&str>) {
    match transport {
        FeedTransport::TailFile { path } => ("tail_file", Some(path.as_str()), None, None),
        FeedTransport::AcpChildDemux { thread_id } => {
            ("acp_child_demux", None, Some(thread_id.as_str()), None)
        }
        FeedTransport::HttpSse { url } => ("http_sse", None, None, Some(url.as_str())),
    }
}

fn transport_from_db(
    kind: &str,
    path: Option<String>,
    thread_id: Option<String>,
    url: Option<String>,
) -> rusqlite::Result<FeedTransport> {
    match kind {
        "tail_file" => Ok(FeedTransport::TailFile {
            path: path.unwrap_or_default(),
        }),
        "acp_child_demux" => Ok(FeedTransport::AcpChildDemux {
            thread_id: thread_id.unwrap_or_default(),
        }),
        "http_sse" => Ok(FeedTransport::HttpSse {
            url: url.unwrap_or_default(),
        }),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown feed transport kind: {other}").into(),
        )),
    }
}

fn map_process(row: &Row<'_>) -> rusqlite::Result<ActivityProcessRecord> {
    Ok(ActivityProcessRecord {
        session_id: row.get("session_id")?,
        workspace_id: row.get("workspace_id")?,
        process_id: row.get("process_id")?,
        command: row.get("command")?,
        cwd: row.get("cwd")?,
        status: process_status_from_db(row.get::<_, String>("status")?.as_str())?,
        exit_code: row.get("exit_code")?,
        pid: row.get("pid")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        feed_id: row.get("feed_id")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_subagent(row: &Row<'_>) -> rusqlite::Result<ActivitySubagentRecord> {
    Ok(ActivitySubagentRecord {
        session_id: row.get("session_id")?,
        workspace_id: row.get("workspace_id")?,
        subagent_id: row.get("subagent_id")?,
        agent_type: row.get("agent_type")?,
        description: row.get("description")?,
        model: row.get("model")?,
        background: row.get("background")?,
        status: subagent_status_from_db(row.get::<_, String>("status")?.as_str())?,
        summary: row.get("summary")?,
        tokens_used: row.get("tokens_used")?,
        tool_calls: row.get("tool_calls")?,
        duration_seconds: row.get("duration_seconds")?,
        feed_id: row.get("feed_id")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_feed_binding(row: &Row<'_>) -> rusqlite::Result<FeedBindingRecord> {
    let owner_kind = match row.get::<_, String>("owner_kind")?.as_str() {
        "process" => FeedOwnerKind::Process,
        "subagent" => FeedOwnerKind::Subagent,
        other => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                Type::Text,
                format!("unknown feed owner kind: {other}").into(),
            ))
        }
    };
    Ok(FeedBindingRecord {
        feed_id: row.get("feed_id")?,
        session_id: row.get("session_id")?,
        kind: feed_kind_from_db(row.get::<_, String>("kind")?.as_str())?,
        owner_kind,
        owner_id: row.get("owner_id")?,
        transport: transport_from_db(
            row.get::<_, String>("transport_kind")?.as_str(),
            row.get("transport_path")?,
            row.get("transport_thread_id")?,
            row.get("transport_url")?,
        )?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
