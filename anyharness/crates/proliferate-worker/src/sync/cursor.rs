use crate::store::cursors::SyncCursorRecord;

#[derive(Debug, Clone)]
pub struct SyncCursor {
    pub workspace_id: String,
    pub session_id: String,
    pub last_uploaded_seq: i64,
    pub last_ack_seq: i64,
}

impl From<SyncCursorRecord> for SyncCursor {
    fn from(record: SyncCursorRecord) -> Self {
        Self {
            workspace_id: record.workspace_id,
            session_id: record.session_id,
            last_uploaded_seq: record.last_uploaded_seq,
            last_ack_seq: record.last_ack_seq,
        }
    }
}
