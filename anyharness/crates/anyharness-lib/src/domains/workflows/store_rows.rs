//! SQLite row → record mappers for the workflow tables, split out of `store.rs`
//! to keep that seam under its size ratchet. Every mapper is lenient on the
//! enum/JSON columns: an unknown or corrupt value degrades to `None` with an
//! error event instead of bricking the whole read path.

use rusqlite::{types::Type, Row};

use super::model::{
    RenderedEnvelope, WorkflowNodeFailureCode, WorkflowNodeKind, WorkflowNodeStatus,
    WorkflowNodeType, WorkflowRunDocRecord, WorkflowRunNodeRecord, WorkflowRunRecord,
    WorkflowRunStatus,
};

pub(super) fn map_run(row: &Row<'_>) -> rusqlite::Result<WorkflowRunRecord> {
    Ok(WorkflowRunRecord {
        id: row.get("id")?,
        invocation_id: row.get("invocation_id")?,
        definition_json: row.get("definition_json")?,
        arguments_json: row.get("arguments_json")?,
        workspace_id: row.get("workspace_id")?,
        status: parse_text(row.get::<_, String>("status")?.as_str(), "run status", |s| {
            WorkflowRunStatus::parse(s)
        })?,
        current_node_row_id: row.get("current_node_row_id")?,
        failure_code: row.get("failure_code")?,
        // Lenient: an unknown code (written by a newer binary) degrades to
        // None with an error event instead of bricking the read path.
        interruption_code: row
            .get::<_, Option<String>>("interruption_code")?
            .and_then(|code| {
                let parsed = super::model::WorkflowInterruptionCode::parse(&code);
                if parsed.is_none() {
                    tracing::error!(code = %code, "unknown workflow run interruption_code; reading as none");
                }
                parsed
            }),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
    })
}

pub(super) fn map_node(row: &Row<'_>) -> rusqlite::Result<WorkflowRunNodeRecord> {
    // Lenient: a corrupt or newer-schema envelope degrades to None (the
    // engine re-renders) instead of bricking every read of the run.
    let envelope = row
        .get::<_, Option<String>>("rendered_envelope")?
        .and_then(|json| match serde_json::from_str::<RenderedEnvelope>(&json) {
            Ok(envelope) => Some(envelope),
            Err(error) => {
                tracing::error!(%error, "unreadable workflow node rendered_envelope; reading as none");
                None
            }
        });
    // Same leniency: an unreadable model pick degrades to the default
    // resolution path instead of bricking the run's reads.
    let model = row
        .get::<_, Option<String>>("model")?
        .and_then(|json| match serde_json::from_str(&json) {
            Ok(model) => Some(model),
            Err(error) => {
                tracing::error!(%error, "unreadable workflow node model; reading as none");
                None
            }
        });
    Ok(WorkflowRunNodeRecord {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        definition_node_id: row.get("definition_node_id")?,
        kind: parse_text(row.get::<_, String>("kind")?.as_str(), "node kind", |s| {
            WorkflowNodeKind::parse(s)
        })?,
        node_type: parse_text(
            row.get::<_, String>("node_type")?.as_str(),
            "node type",
            |s| WorkflowNodeType::parse(s),
        )?,
        replaces_node_row_id: row.get("replaces_node_row_id")?,
        anchor_node_row_id: row.get("anchor_node_row_id")?,
        chain_index: row.get("chain_index")?,
        title: row.get("title")?,
        prompt: row.get("prompt")?,
        status: parse_text(
            row.get::<_, String>("status")?.as_str(),
            "node status",
            |s| WorkflowNodeStatus::parse(s),
        )?,
        session_id: row.get("session_id")?,
        prompt_id: row.get("prompt_id")?,
        model,
        rendered_envelope: envelope,
        failure_code: row
            .get::<_, Option<String>>("failure_code")?
            .and_then(|code| {
                let parsed = WorkflowNodeFailureCode::parse(&code);
                if parsed.is_none() {
                    tracing::error!(code = %code, "unknown workflow node failure_code; reading as none");
                }
                parsed
            }),
        first_turn_finished_at: row.get("first_turn_finished_at")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
    })
}

pub(super) fn map_doc(row: &Row<'_>) -> rusqlite::Result<WorkflowRunDocRecord> {
    Ok(WorkflowRunDocRecord {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        slug: row.get("slug")?,
        filename: row.get("filename")?,
        producing_node_row_id: row.get("producing_node_row_id")?,
        seeded_from_template: row.get::<_, i64>("seeded_from_template")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_text<T>(
    value: &str,
    what: &'static str,
    parse: impl Fn(&str) -> Option<T>,
) -> rusqlite::Result<T> {
    parse(value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(0, Type::Text, format!("unknown {what}: {value}").into())
    })
}
