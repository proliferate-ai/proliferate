use rusqlite::Transaction;
use serde_json::Value;

use super::custom_migration_schema::table_columns;

pub(super) const CUSTOM_MIGRATIONS: &[(&str, fn(&Transaction<'_>) -> rusqlite::Result<()>)] = &[
    (
        "0016_backfill_session_background_work_timestamps",
        migrate_session_background_work_timestamps,
    ),
    (
        "0036_rename_review_auto_iterate",
        migrate_review_auto_iterate_column,
    ),
];

pub(super) const CUSTOM_FOREIGN_KEY_MIGRATIONS: &[(
    &str,
    fn(&Transaction<'_>) -> rusqlite::Result<()>,
)] = &[
    (
        "0049_simplify_workspace_records",
        migrate_simplify_workspace_records,
    ),
    (
        "0061_workflow_runs_v2",
        super::workflow_runs_v2_migration::migrate_workflow_runs_v2,
    ),
];

fn migrate_session_background_work_timestamps(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "session_background_work")?;

    if !columns.iter().any(|column| column == "created_at") {
        tx.execute(
            "ALTER TABLE session_background_work ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    if !columns.iter().any(|column| column == "updated_at") {
        tx.execute(
            "ALTER TABLE session_background_work ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    tx.execute_batch(
        "UPDATE session_background_work
         SET created_at = CASE
                WHEN created_at = '' THEN launched_at
                ELSE created_at
             END,
             updated_at = CASE
                WHEN updated_at = '' THEN COALESCE(completed_at, last_activity_at, launched_at)
                ELSE updated_at
             END",
    )?;

    backfill_pending_background_work(tx)?;
    Ok(())
}

fn migrate_review_auto_iterate_column(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "review_runs")?;
    let has_old = columns.iter().any(|column| column == "auto_send_feedback");
    let has_new = columns.iter().any(|column| column == "auto_iterate");

    if has_old && !has_new {
        tx.execute_batch(
            "ALTER TABLE review_runs
             RENAME COLUMN auto_send_feedback TO auto_iterate",
        )?;
    }

    Ok(())
}

fn migrate_simplify_workspace_records(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "workspaces")?;
    if !columns
        .iter()
        .any(|column| column == "source_repo_root_path")
    {
        return Ok(());
    }

    tx.execute_batch(
        "
        INSERT OR IGNORE INTO repo_roots (
            id, kind, path, display_name, default_branch,
            remote_provider, remote_owner, remote_repo_name, remote_url,
            created_at, updated_at
        )
        SELECT
            COALESCE(w.repo_root_id, w.id),
            'external',
            w.source_repo_root_path,
            w.display_name,
            COALESCE(w.current_branch, w.original_branch),
            w.git_provider,
            w.git_owner,
            w.git_repo_name,
            NULL,
            w.created_at,
            w.updated_at
        FROM workspaces w
        WHERE w.kind = 'repo'
          AND w.source_repo_root_path IS NOT NULL
          AND TRIM(w.source_repo_root_path) <> '';

        INSERT OR IGNORE INTO repo_roots (
            id, kind, path, display_name, default_branch,
            remote_provider, remote_owner, remote_repo_name, remote_url,
            created_at, updated_at
        )
        SELECT
            lower(
                hex(randomblob(4)) || '-' ||
                hex(randomblob(2)) || '-4' ||
                substr(hex(randomblob(2)), 2) || '-' ||
                substr('89ab', abs(random()) % 4 + 1, 1) ||
                substr(hex(randomblob(2)), 2) || '-' ||
                hex(randomblob(6))
            ),
            'external',
            w.source_repo_root_path,
            MIN(w.display_name),
            COALESCE(MIN(w.current_branch), MIN(w.original_branch)),
            MIN(w.git_provider),
            MIN(w.git_owner),
            MIN(w.git_repo_name),
            NULL,
            MIN(w.created_at),
            MAX(w.updated_at)
        FROM workspaces w
        WHERE w.source_repo_root_path IS NOT NULL
          AND TRIM(w.source_repo_root_path) <> ''
          AND NOT EXISTS (
              SELECT 1
              FROM repo_roots rr
              WHERE rr.path = w.source_repo_root_path
          )
        GROUP BY w.source_repo_root_path;

        UPDATE workspaces
        SET repo_root_id = (
            SELECT rr.id
            FROM repo_roots rr
            WHERE rr.path = workspaces.source_repo_root_path
            LIMIT 1
        )
        WHERE kind = 'repo'
          AND (
              repo_root_id IS NULL
              OR NOT EXISTS (
                  SELECT 1
                  FROM repo_roots rr
                  WHERE rr.id = workspaces.repo_root_id
              )
          );

        UPDATE workspaces
        SET repo_root_id = (
            SELECT parent.repo_root_id
            FROM workspaces parent
            WHERE parent.id = workspaces.source_workspace_id
              AND parent.kind = 'repo'
            LIMIT 1
        )
        WHERE kind IN ('local', 'worktree')
          AND repo_root_id IS NULL
          AND source_workspace_id IS NOT NULL;

        UPDATE workspaces
        SET repo_root_id = (
            SELECT rr.id
            FROM repo_roots rr
            WHERE rr.path = workspaces.source_repo_root_path
            LIMIT 1
        )
        WHERE kind IN ('local', 'worktree')
          AND (
              repo_root_id IS NULL
              OR NOT EXISTS (
                  SELECT 1
                  FROM repo_roots rr
                  WHERE rr.id = workspaces.repo_root_id
              )
          )
          AND source_repo_root_path IS NOT NULL
          AND TRIM(source_repo_root_path) <> '';

        WITH referenced_repo_rows AS (
            SELECT
                r.*,
                ROW_NUMBER() OVER (
                    PARTITION BY r.path, r.repo_root_id
                    ORDER BY r.created_at ASC, r.id ASC
                ) AS replacement_rank
            FROM workspaces r
            WHERE r.kind = 'repo'
              AND r.repo_root_id IS NOT NULL
              AND (
                  EXISTS (SELECT 1 FROM sessions value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM cowork_threads value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM workspace_access_modes value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM plans value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM mobility_archive_installs value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM cowork_managed_workspaces value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM cowork_managed_workspaces value WHERE value.source_workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM review_runs value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM terminal_command_runs value WHERE value.workspace_id = r.id)
                  OR EXISTS (SELECT 1 FROM workspace_setup_state value WHERE value.workspace_id = r.id)
              )
        )
        INSERT INTO workspaces (
            id, kind, path, source_repo_root_path, source_workspace_id,
            git_provider, git_owner, git_repo_name, original_branch, current_branch,
            display_name, created_at, updated_at, repo_root_id, surface, origin_json,
            lifecycle_state, cleanup_state, creator_context_json, cleanup_error_message,
            cleanup_failed_at, cleanup_attempted_at, cleanup_operation
        )
        SELECT
            lower(
                hex(randomblob(4)) || '-' ||
                hex(randomblob(2)) || '-4' ||
                substr(hex(randomblob(2)), 2) || '-' ||
                substr('89ab', abs(random()) % 4 + 1, 1) ||
                substr(hex(randomblob(2)), 2) || '-' ||
                hex(randomblob(6))
            ),
            'local',
            r.path,
            r.source_repo_root_path,
            NULL,
            r.git_provider,
            r.git_owner,
            r.git_repo_name,
            r.original_branch,
            r.current_branch,
            r.display_name,
            r.created_at,
            r.updated_at,
            r.repo_root_id,
            'standard',
            r.origin_json,
            COALESCE(r.lifecycle_state, 'active'),
            COALESCE(r.cleanup_state, 'none'),
            r.creator_context_json,
            r.cleanup_error_message,
            r.cleanup_failed_at,
            r.cleanup_attempted_at,
            r.cleanup_operation
        FROM referenced_repo_rows r
        WHERE r.replacement_rank = 1
          AND NOT EXISTS (
              SELECT 1
              FROM workspaces l
              WHERE l.kind = 'local'
                AND l.path = r.path
                AND l.repo_root_id = r.repo_root_id
          );

        CREATE TEMP TABLE workspace_repo_replacements (
            repo_workspace_id TEXT PRIMARY KEY,
            local_workspace_id TEXT NOT NULL
        );

        INSERT INTO workspace_repo_replacements (repo_workspace_id, local_workspace_id)
        SELECT
            r.id,
            (
                SELECT l.id
                FROM workspaces l
                WHERE l.kind = 'local'
                  AND l.path = r.path
                  AND l.repo_root_id = r.repo_root_id
                ORDER BY l.created_at ASC, l.id ASC
                LIMIT 1
            )
        FROM workspaces r
        WHERE r.kind = 'repo'
          AND r.repo_root_id IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM workspaces l
              WHERE l.kind = 'local'
                AND l.path = r.path
                AND l.repo_root_id = r.repo_root_id
          );

        UPDATE sessions
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = sessions.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        UPDATE cowork_threads
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = cowork_threads.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        UPDATE plans
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = plans.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        UPDATE mobility_archive_installs
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = mobility_archive_installs.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        UPDATE review_runs
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = review_runs.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        UPDATE terminal_command_runs
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = terminal_command_runs.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        DELETE FROM cowork_managed_workspaces
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements)
          AND EXISTS (
              SELECT 1
              FROM cowork_managed_workspaces existing
              JOIN workspace_repo_replacements replacement
                ON replacement.repo_workspace_id = cowork_managed_workspaces.workspace_id
              WHERE existing.workspace_id = replacement.local_workspace_id
          );

        UPDATE cowork_managed_workspaces
        SET workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = cowork_managed_workspaces.workspace_id
        )
        WHERE workspace_id IN (SELECT repo_workspace_id FROM workspace_repo_replacements);

        UPDATE cowork_managed_workspaces
        SET source_workspace_id = (
            SELECT local_workspace_id
            FROM workspace_repo_replacements
            WHERE repo_workspace_id = cowork_managed_workspaces.source_workspace_id
        )
        WHERE source_workspace_id IN (
            SELECT id
            FROM workspaces
            WHERE kind = 'repo'
        );

        CREATE TEMP TABLE workspace_access_modes_candidates AS
        SELECT workspace_id, mode, handoff_op_id, updated_at
        FROM workspace_access_modes
        WHERE workspace_id NOT IN (SELECT repo_workspace_id FROM workspace_repo_replacements)
        UNION ALL
        SELECT
            replacement.local_workspace_id,
            mode.mode,
            mode.handoff_op_id,
            mode.updated_at
        FROM workspace_access_modes mode
        JOIN workspace_repo_replacements replacement
          ON replacement.repo_workspace_id = mode.workspace_id;

        DELETE FROM workspace_access_modes;

        INSERT INTO workspace_access_modes (workspace_id, mode, handoff_op_id, updated_at)
        SELECT workspace_id, mode, handoff_op_id, updated_at
        FROM (
            SELECT
                workspace_id,
                mode,
                handoff_op_id,
                updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY workspace_id
                    ORDER BY updated_at DESC, mode ASC
                ) AS rn
            FROM workspace_access_modes_candidates
        )
        WHERE rn = 1;

        CREATE TEMP TABLE workspace_setup_state_candidates AS
        SELECT workspace_id, latest_command_run_id, updated_at
        FROM workspace_setup_state
        WHERE workspace_id NOT IN (SELECT repo_workspace_id FROM workspace_repo_replacements)
        UNION ALL
        SELECT
            replacement.local_workspace_id,
            state.latest_command_run_id,
            state.updated_at
        FROM workspace_setup_state state
        JOIN workspace_repo_replacements replacement
          ON replacement.repo_workspace_id = state.workspace_id;

        DELETE FROM workspace_setup_state;

        INSERT INTO workspace_setup_state (workspace_id, latest_command_run_id, updated_at)
        SELECT workspace_id, latest_command_run_id, updated_at
        FROM (
            SELECT
                workspace_id,
                latest_command_run_id,
                updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY workspace_id
                    ORDER BY updated_at DESC, latest_command_run_id ASC
                ) AS rn
            FROM workspace_setup_state_candidates
        )
        WHERE rn = 1;

        CREATE TEMP TABLE agent_model_registry_snapshot_candidates AS
        SELECT
            snapshot.id,
            snapshot.kind,
            CASE
                WHEN snapshot.workspace_scope IN (
                    SELECT repo_workspace_id FROM workspace_repo_replacements
                ) THEN (
                    SELECT local_workspace_id
                    FROM workspace_repo_replacements
                    WHERE repo_workspace_id = snapshot.workspace_scope
                )
                WHEN snapshot.workspace_id IN (
                    SELECT repo_workspace_id FROM workspace_repo_replacements
                ) THEN (
                    SELECT local_workspace_id
                    FROM workspace_repo_replacements
                    WHERE repo_workspace_id = snapshot.workspace_id
                )
                ELSE snapshot.workspace_id
            END AS workspace_id,
            CASE
                WHEN snapshot.workspace_scope IN (
                    SELECT repo_workspace_id FROM workspace_repo_replacements
                ) THEN (
                    SELECT local_workspace_id
                    FROM workspace_repo_replacements
                    WHERE repo_workspace_id = snapshot.workspace_scope
                )
                ELSE snapshot.workspace_scope
            END AS workspace_scope,
            snapshot.source,
            snapshot.status,
            snapshot.refreshed_at,
            snapshot.expires_at,
            snapshot.models_json,
            snapshot.warnings_json,
            snapshot.error_message,
            snapshot.created_at,
            snapshot.updated_at
        FROM agent_model_registry_snapshots snapshot;

        DELETE FROM agent_model_registry_snapshots;

        INSERT INTO agent_model_registry_snapshots (
            id, kind, workspace_id, workspace_scope, source, status, refreshed_at, expires_at,
            models_json, warnings_json, error_message, created_at, updated_at
        )
        SELECT
            id, kind, workspace_id, workspace_scope, source, status, refreshed_at, expires_at,
            models_json, warnings_json, error_message, created_at, updated_at
        FROM (
            SELECT
                id,
                kind,
                workspace_id,
                workspace_scope,
                source,
                status,
                refreshed_at,
                expires_at,
                models_json,
                warnings_json,
                error_message,
                created_at,
                updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY kind, workspace_scope
                    ORDER BY updated_at DESC, refreshed_at DESC, id ASC
                ) AS rn
            FROM agent_model_registry_snapshot_candidates
        )
        WHERE rn = 1;

        DELETE FROM workspaces
        WHERE kind = 'repo';
        ",
    )?;

    let invalid_workspace_count: i64 = tx.query_row(
        "SELECT COUNT(*)
         FROM workspaces
         WHERE kind IN ('local', 'worktree')
           AND (
               repo_root_id IS NULL
               OR NOT EXISTS (
                   SELECT 1
                   FROM repo_roots rr
                   WHERE rr.id = workspaces.repo_root_id
               )
           )",
        [],
        |row| row.get(0),
    )?;
    if invalid_workspace_count != 0 {
        return Err(rusqlite::Error::InvalidQuery);
    }

    tx.execute_batch(
        "
        CREATE TABLE workspaces_new (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('local', 'worktree')),
            repo_root_id TEXT NOT NULL REFERENCES repo_roots(id),
            path TEXT NOT NULL,
            surface TEXT NOT NULL DEFAULT 'standard' CHECK (surface IN ('standard', 'cowork')),
            original_branch TEXT,
            current_branch TEXT,
            display_name TEXT,
            origin_json TEXT,
            creator_context_json TEXT,
            lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'retired')),
            cleanup_state TEXT NOT NULL DEFAULT 'none' CHECK (cleanup_state IN ('none', 'pending', 'complete', 'failed')),
            cleanup_operation TEXT CHECK (cleanup_operation IS NULL OR cleanup_operation IN ('retire', 'purge')),
            cleanup_error_message TEXT,
            cleanup_failed_at TEXT,
            cleanup_attempted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT INTO workspaces_new (
            id, kind, repo_root_id, path, surface, original_branch, current_branch,
            display_name, origin_json, creator_context_json, lifecycle_state, cleanup_state,
            cleanup_operation, cleanup_error_message, cleanup_failed_at, cleanup_attempted_at,
            created_at, updated_at
        )
        SELECT
            id,
            kind,
            repo_root_id,
            path,
            COALESCE(surface, 'standard'),
            original_branch,
            current_branch,
            display_name,
            origin_json,
            creator_context_json,
            COALESCE(lifecycle_state, 'active'),
            COALESCE(cleanup_state, 'none'),
            cleanup_operation,
            cleanup_error_message,
            cleanup_failed_at,
            cleanup_attempted_at,
            created_at,
            updated_at
        FROM workspaces
        WHERE kind IN ('local', 'worktree');

        DROP INDEX IF EXISTS idx_workspaces_path;
        DROP INDEX IF EXISTS idx_workspaces_repo_root_id;
        DROP INDEX IF EXISTS idx_workspaces_retention;

        PRAGMA legacy_alter_table = ON;
        ALTER TABLE workspaces RENAME TO workspaces_old;
        ALTER TABLE workspaces_new RENAME TO workspaces;
        DROP TABLE workspaces_old;
        PRAGMA legacy_alter_table = OFF;

        CREATE INDEX idx_workspaces_path ON workspaces(path);
        CREATE INDEX idx_workspaces_repo_root_id ON workspaces(repo_root_id);
        CREATE INDEX idx_workspaces_retention
            ON workspaces(repo_root_id, kind, lifecycle_state, surface);

        DROP TABLE IF EXISTS workspace_repo_replacements;
        DROP TABLE IF EXISTS workspace_access_modes_candidates;
        DROP TABLE IF EXISTS workspace_setup_state_candidates;
        DROP TABLE IF EXISTS agent_model_registry_snapshot_candidates;
        ",
    )?;

    Ok(())
}

fn backfill_pending_background_work(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let mut stmt = tx.prepare(
        "SELECT session_id, turn_id, timestamp, payload_json
         FROM session_events
         WHERE event_type = 'item_completed'
           AND payload_json LIKE '%\"backgroundWork\"%'
         ORDER BY session_id ASC, seq ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    for row in rows {
        let (session_id, turn_id, timestamp, payload_json) = row?;
        let Some(record) = pending_background_work_from_completed_event(
            &session_id,
            turn_id.as_deref(),
            &timestamp,
            &payload_json,
        ) else {
            continue;
        };

        tx.execute(
            "INSERT OR IGNORE INTO session_background_work (
                session_id, tool_call_id, turn_id, tracker_kind, source_agent_kind, agent_id,
                output_file, state, created_at, updated_at, launched_at, last_activity_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                record.session_id,
                record.tool_call_id,
                record.turn_id,
                record.tracker_kind,
                record.source_agent_kind,
                record.agent_id,
                record.output_file,
                record.state,
                record.created_at,
                record.updated_at,
                record.launched_at,
                record.last_activity_at,
                record.completed_at,
            ],
        )?;
    }

    Ok(())
}

struct PendingBackgroundWorkBackfill {
    session_id: String,
    tool_call_id: String,
    turn_id: String,
    tracker_kind: String,
    source_agent_kind: String,
    agent_id: Option<String>,
    output_file: String,
    state: String,
    created_at: String,
    updated_at: String,
    launched_at: String,
    last_activity_at: String,
    completed_at: Option<String>,
}

fn pending_background_work_from_completed_event(
    session_id: &str,
    turn_id: Option<&str>,
    timestamp: &str,
    payload_json: &str,
) -> Option<PendingBackgroundWorkBackfill> {
    let payload: Value = serde_json::from_str(payload_json).ok()?;
    let item = payload.get("item")?;
    let tool_call_id = item.get("toolCallId")?.as_str()?.trim();
    let source_agent_kind = item.get("sourceAgentKind")?.as_str()?.trim();
    let raw_output = item.get("rawOutput")?;
    let background_work = raw_output.get("_anyharness")?.get("backgroundWork")?;
    let state = background_work.get("state")?.as_str()?.trim();
    if state != "pending" {
        return None;
    }

    let tracker_kind = background_work.get("trackerKind")?.as_str()?.trim();
    let output_file = raw_output.get("outputFile")?.as_str()?.trim();
    if tool_call_id.is_empty()
        || source_agent_kind.is_empty()
        || tracker_kind.is_empty()
        || output_file.is_empty()
    {
        return None;
    }

    Some(PendingBackgroundWorkBackfill {
        session_id: session_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        turn_id: turn_id.unwrap_or_default().to_string(),
        tracker_kind: tracker_kind.to_string(),
        source_agent_kind: source_agent_kind.to_string(),
        agent_id: raw_output
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from),
        output_file: output_file.to_string(),
        state: state.to_string(),
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        launched_at: timestamp.to_string(),
        last_activity_at: timestamp.to_string(),
        completed_at: None,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::table_columns;
    use crate::persistence::custom_migration_registry_tests::{
        mark_foreign_key_migrations_applied, table_column_names,
    };
    use crate::persistence::migrations::{run_migrations, MIGRATIONS};

    #[test]
    fn simplify_workspace_records_migration_remaps_repo_workspaces_and_drops_legacy_columns() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON")
            .expect("fk on");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("create migrations table");
        for (name, sql) in MIGRATIONS {
            conn.execute_batch(sql).expect("apply sql migration");
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }

        conn.execute_batch(
            "INSERT INTO workspaces (
                id, kind, path, source_repo_root_path, git_provider, git_owner, git_repo_name,
                display_name, current_branch, created_at, updated_at
             ) VALUES (
                'repo-ws', 'repo', '/tmp/repo', '/tmp/repo', 'github', 'owner', 'repo',
                'Repo', 'main', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
             );
             INSERT INTO workspaces (
                id, kind, path, source_repo_root_path, source_workspace_id,
                original_branch, current_branch, created_at, updated_at
             ) VALUES (
                'worktree-1', 'worktree', '/tmp/repo-worktree', '/tmp/repo', 'repo-ws',
                'main', 'feature', '2026-01-01T00:01:00Z', '2026-01-01T00:01:00Z'
             );
             INSERT INTO workspaces (
                id, kind, path, source_repo_root_path, repo_root_id,
                display_name, current_branch, created_at, updated_at
             ) VALUES (
                'repo-ws-duplicate', 'repo', '/tmp/repo', '/tmp/repo', 'stale-root',
                'Repo Duplicate', 'main', '2026-01-01T00:01:30Z', '2026-01-01T00:01:30Z'
             );
             INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at
             ) VALUES (
                'session-1', 'repo-ws', 'claude', 'idle',
                '2026-01-01T00:02:00Z', '2026-01-01T00:02:00Z'
             );
             INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at
             ) VALUES (
                'session-2', 'repo-ws-duplicate', 'claude', 'idle',
                '2026-01-01T00:02:30Z', '2026-01-01T00:02:30Z'
             );
             INSERT INTO agent_model_registry_snapshots (
                id, kind, workspace_id, workspace_scope, source, status,
                refreshed_at, expires_at, models_json, warnings_json,
                error_message, created_at, updated_at
             ) VALUES (
                'snapshot-old', 'opencode', 'repo-ws', 'repo-ws', 'provider_cli',
                'available', '2026-01-01T00:03:00Z', NULL,
                '[{\"id\":\"old\"}]', '[]', NULL,
                '2026-01-01T00:03:00Z', '2026-01-01T00:03:00Z'
             );
             INSERT INTO agent_model_registry_snapshots (
                id, kind, workspace_id, workspace_scope, source, status,
                refreshed_at, expires_at, models_json, warnings_json,
                error_message, created_at, updated_at
             ) VALUES (
                'snapshot-new', 'opencode', 'repo-ws-duplicate', 'repo-ws-duplicate',
                'provider_cli', 'available', '2026-01-01T00:04:00Z', NULL,
                '[{\"id\":\"new\"}]', '[]', NULL,
                '2026-01-01T00:04:00Z', '2026-01-01T00:04:00Z'
             );",
        )
        .expect("seed legacy workspace rows");

        run_migrations(&mut conn).expect("run custom migrations");

        let workspace_columns = table_column_names(&conn, "workspaces");
        assert!(!workspace_columns.contains(&"source_repo_root_path".to_string()));
        assert!(!workspace_columns.contains(&"source_workspace_id".to_string()));
        assert!(!workspace_columns.contains(&"git_provider".to_string()));
        assert!(!workspace_columns.contains(&"git_owner".to_string()));
        assert!(!workspace_columns.contains(&"git_repo_name".to_string()));

        let repo_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE kind = 'repo'",
                [],
                |row| row.get(0),
            )
            .expect("count repo workspaces");
        assert_eq!(repo_count, 0);
        let missing_repo_roots: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE repo_root_id IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("count missing repo roots");
        assert_eq!(missing_repo_roots, 0);

        let replacement_id: String = conn
            .query_row(
                "SELECT id FROM workspaces WHERE kind = 'local' AND path = '/tmp/repo'",
                [],
                |row| row.get(0),
            )
            .expect("local replacement");
        let replacement_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE kind = 'local' AND path = '/tmp/repo'",
                [],
                |row| row.get(0),
            )
            .expect("local replacement count");
        assert_eq!(replacement_count, 1);
        let session_workspace_id: String = conn
            .query_row(
                "SELECT workspace_id FROM sessions WHERE id = 'session-1'",
                [],
                |row| row.get(0),
            )
            .expect("session workspace");
        assert_eq!(session_workspace_id, replacement_id);
        let duplicate_session_workspace_id: String = conn
            .query_row(
                "SELECT workspace_id FROM sessions WHERE id = 'session-2'",
                [],
                |row| row.get(0),
            )
            .expect("duplicate session workspace");
        assert_eq!(duplicate_session_workspace_id, replacement_id);
        let snapshot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_model_registry_snapshots
                 WHERE kind = 'opencode' AND workspace_scope = ?1",
                [&replacement_id],
                |row| row.get(0),
            )
            .expect("snapshot count");
        assert_eq!(snapshot_count, 1);
        let (snapshot_workspace_id, snapshot_models): (String, String) = conn
            .query_row(
                "SELECT workspace_id, models_json
                 FROM agent_model_registry_snapshots
                 WHERE kind = 'opencode' AND workspace_scope = ?1",
                [&replacement_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("remapped snapshot");
        assert_eq!(snapshot_workspace_id, replacement_id);
        assert_eq!(snapshot_models, r#"[{"id":"new"}]"#);

        let replacement_repo_root_id: String = conn
            .query_row(
                "SELECT repo_root_id FROM workspaces WHERE id = ?1",
                [&replacement_id],
                |row| row.get(0),
            )
            .expect("replacement repo root");
        let worktree_repo_root_id: String = conn
            .query_row(
                "SELECT repo_root_id FROM workspaces WHERE id = 'worktree-1'",
                [],
                |row| row.get(0),
            )
            .expect("worktree repo root");
        assert_eq!(worktree_repo_root_id, replacement_repo_root_id);

        let fk_violations: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check");
        assert_eq!(fk_violations, 0);
    }

    #[test]
    fn review_auto_iterate_migration_renames_old_0034_schema() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE review_runs (
                id TEXT PRIMARY KEY,
                auto_send_feedback INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO review_runs (id, auto_send_feedback) VALUES ('review-1', 0);",
        )
        .expect("seed old schema");
        for (name, _) in MIGRATIONS {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }
        conn.execute(
            "INSERT INTO _migrations (name) VALUES ('0016_backfill_session_background_work_timestamps')",
            [],
        )
        .expect("mark 0016 custom migration applied");
        mark_foreign_key_migrations_applied(&conn);

        run_migrations(&mut conn).expect("run migrations");

        let columns = table_column_names(&conn, "review_runs");
        assert!(columns.contains(&"auto_iterate".to_string()));
        assert!(!columns.contains(&"auto_send_feedback".to_string()));
        let value: i64 = conn
            .query_row(
                "SELECT auto_iterate FROM review_runs WHERE id = 'review-1'",
                [],
                |row| row.get(0),
            )
            .expect("select renamed value");
        assert_eq!(value, 0);
    }

    #[test]
    fn review_auto_iterate_migration_handles_legacy_0033_alias_schema() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE review_runs (
                id TEXT PRIMARY KEY,
                auto_send_feedback INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO review_runs (id, auto_send_feedback) VALUES ('review-1', 1);
            INSERT INTO _migrations (name) VALUES ('0033_review_agent_loops');",
        )
        .expect("seed legacy schema");
        for (name, _) in MIGRATIONS {
            if *name == "0034_review_agent_loops" {
                continue;
            }
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }
        conn.execute(
            "INSERT INTO _migrations (name) VALUES ('0016_backfill_session_background_work_timestamps')",
            [],
        )
        .expect("mark 0016 custom migration applied");
        mark_foreign_key_migrations_applied(&conn);

        run_migrations(&mut conn).expect("run migrations");

        let columns = table_column_names(&conn, "review_runs");
        assert!(columns.contains(&"auto_iterate".to_string()));
        assert!(!columns.contains(&"auto_send_feedback".to_string()));
        let marked: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = '0034_review_agent_loops')",
                [],
                |row| row.get(0),
            )
            .expect("query 0034 marker");
        assert!(marked);
    }

    #[test]
    fn background_work_timestamp_migration_upgrades_old_schema_and_backfills_rows() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                agent_kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                seq INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                turn_id TEXT,
                payload_json TEXT NOT NULL,
                item_id TEXT
            );
            CREATE TABLE session_background_work (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                tool_call_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                tracker_kind TEXT NOT NULL,
                source_agent_kind TEXT NOT NULL,
                agent_id TEXT,
                output_file TEXT NOT NULL,
                state TEXT NOT NULL,
                launched_at TEXT NOT NULL,
                last_activity_at TEXT NOT NULL,
                completed_at TEXT,
                PRIMARY KEY (session_id, tool_call_id)
            );
            INSERT INTO sessions (id, workspace_id, agent_kind, status, created_at, updated_at)
            VALUES ('session-1', 'workspace-1', 'claude', 'idle', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z');
            INSERT INTO session_background_work (
                session_id, tool_call_id, turn_id, tracker_kind, source_agent_kind, agent_id,
                output_file, state, launched_at, last_activity_at, completed_at
            ) VALUES (
                'session-1', 'tool-existing', 'turn-1', 'claude_async_agent', 'claude', 'agent-existing',
                '/tmp/existing.output', 'pending', '2026-04-11T00:00:10Z', '2026-04-11T00:00:20Z', NULL
            );
            INSERT INTO session_events (
                session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
            ) VALUES (
                'session-1',
                1,
                '2026-04-11T00:01:00Z',
                'item_completed',
                'turn-1',
                'tool-backfill',
                '{\"item\":{\"kind\":\"tool_invocation\",\"status\":\"completed\",\"sourceAgentKind\":\"claude\",\"toolCallId\":\"tool-backfill\",\"rawOutput\":{\"isAsync\":true,\"agentId\":\"agent-backfill\",\"outputFile\":\"/tmp/backfill.output\",\"_anyharness\":{\"backgroundWork\":{\"trackerKind\":\"claude_async_agent\",\"state\":\"pending\"}}},\"contentParts\":[{\"type\":\"tool_result_text\",\"text\":\"Async agent launched successfully.\"}]}}'
            );",
        )
        .expect("seed old schema");

        for (name, _) in MIGRATIONS {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }
        mark_foreign_key_migrations_applied(&conn);

        run_migrations(&mut conn).expect("run migrations");

        let tx = conn.transaction().expect("open transaction");
        let columns = table_columns(&tx, "session_background_work").expect("list columns");
        tx.commit().expect("commit read transaction");
        assert!(columns.contains(&"created_at".to_string()));
        assert!(columns.contains(&"updated_at".to_string()));

        let existing: (String, String) = conn
            .query_row(
                "SELECT created_at, updated_at
                 FROM session_background_work
                 WHERE session_id = 'session-1' AND tool_call_id = 'tool-existing'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("select upgraded row");
        assert_eq!(existing.0, "2026-04-11T00:00:10Z");
        assert_eq!(existing.1, "2026-04-11T00:00:20Z");

        let backfilled: (String, String, String, String) = conn
            .query_row(
                "SELECT tracker_kind, source_agent_kind, output_file, created_at
                 FROM session_background_work
                 WHERE session_id = 'session-1' AND tool_call_id = 'tool-backfill'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("select backfilled row");
        assert_eq!(backfilled.0, "claude_async_agent");
        assert_eq!(backfilled.1, "claude");
        assert_eq!(backfilled.2, "/tmp/backfill.output");
        assert_eq!(backfilled.3, "2026-04-11T00:01:00Z");
    }
}
