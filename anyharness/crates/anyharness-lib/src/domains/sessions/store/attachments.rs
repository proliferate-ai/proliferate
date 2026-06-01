use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::model::{
    PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentSource, PromptAttachmentState,
};

impl SessionStore {
    pub fn insert_prompt_attachment(&self, record: &PromptAttachmentRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            insert_prompt_attachment_row(conn, record)?;
            Ok(())
        })
    }

    pub fn find_prompt_attachment(
        &self,
        session_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Option<PromptAttachmentRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_prompt_attachments
                 WHERE session_id = ?1 AND attachment_id = ?2",
                params![session_id, attachment_id],
                map_prompt_attachment,
            )
            .optional()
        })
    }

    pub fn list_prompt_attachments(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<PromptAttachmentRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_prompt_attachments
                 WHERE session_id = ?1
                 ORDER BY created_at ASC, attachment_id ASC",
            )?;
            let rows = stmt.query_map([session_id], map_prompt_attachment)?;
            rows.collect()
        })
    }

    pub fn read_legacy_prompt_attachment_content(
        &self,
        session_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Option<Vec<u8>>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT content FROM session_prompt_attachments
                 WHERE session_id = ?1 AND attachment_id = ?2",
                params![session_id, attachment_id],
                |row| row.get(0),
            )
            .optional()
        })
    }

    pub fn update_prompt_attachment_storage_path(
        &self,
        session_id: &str,
        attachment_id: &str,
        storage_path: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE session_prompt_attachments
                 SET storage_path = ?3, updated_at = ?4
                 WHERE session_id = ?1 AND attachment_id = ?2",
                params![session_id, attachment_id, storage_path, now],
            )?;
            Ok(())
        })
    }

    pub fn mark_prompt_attachments_state(
        &self,
        session_id: &str,
        attachment_ids: &[String],
        state: PromptAttachmentState,
    ) -> anyhow::Result<()> {
        if attachment_ids.is_empty() {
            return Ok(());
        }
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|conn| {
            for attachment_id in attachment_ids {
                conn.execute(
                    "UPDATE session_prompt_attachments
                     SET state = ?3, updated_at = ?4
                     WHERE session_id = ?1 AND attachment_id = ?2",
                    params![session_id, attachment_id, state.as_str(), now],
                )?;
            }
            Ok(())
        })
    }

    pub fn delete_prompt_attachments(
        &self,
        session_id: &str,
        attachment_ids: &[&str],
    ) -> anyhow::Result<()> {
        if attachment_ids.is_empty() {
            return Ok(());
        }
        self.db.with_tx(|conn| {
            for attachment_id in attachment_ids {
                conn.execute(
                    "DELETE FROM session_prompt_attachments
                     WHERE session_id = ?1 AND attachment_id = ?2 AND state = 'pending'",
                    params![session_id, attachment_id],
                )?;
            }
            Ok(())
        })
    }
}

fn map_prompt_attachment(row: &rusqlite::Row) -> rusqlite::Result<PromptAttachmentRecord> {
    let state: String = row.get("state")?;
    let kind: String = row.get("kind")?;
    let source: String = row.get("source")?;
    Ok(PromptAttachmentRecord {
        attachment_id: row.get("attachment_id")?,
        session_id: row.get("session_id")?,
        state: PromptAttachmentState::parse(&state),
        kind: PromptAttachmentKind::parse(&kind),
        source: PromptAttachmentSource::parse(&source),
        mime_type: row.get("mime_type")?,
        display_name: row.get("display_name")?,
        source_uri: row.get("source_uri")?,
        storage_path: row.get("storage_path")?,
        size_bytes: row.get("size_bytes")?,
        sha256: row.get("sha256")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn insert_prompt_attachment_row(
    conn: &rusqlite::Connection,
    record: &PromptAttachmentRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_prompt_attachments (
            attachment_id, session_id, state, kind, source, mime_type, display_name, source_uri,
            storage_path, size_bytes, sha256, content, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(attachment_id) DO UPDATE SET
            session_id = excluded.session_id,
            state = excluded.state,
            kind = excluded.kind,
            source = excluded.source,
            mime_type = excluded.mime_type,
            display_name = excluded.display_name,
            source_uri = excluded.source_uri,
            storage_path = excluded.storage_path,
            size_bytes = excluded.size_bytes,
            sha256 = excluded.sha256,
            content = excluded.content,
            updated_at = excluded.updated_at",
        params![
            record.attachment_id,
            record.session_id,
            record.state.as_str(),
            record.kind.as_str(),
            record.source.as_str(),
            record.mime_type,
            record.display_name,
            record.source_uri,
            record.storage_path,
            record.size_bytes,
            record.sha256,
            Vec::<u8>::new(),
            record.created_at,
            record.updated_at,
        ],
    )?;
    Ok(())
}
