use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use anyhow::Context;

use crate::sessions::model::PromptAttachmentRecord;

#[derive(Debug, Clone)]
pub struct PromptAttachmentStorage {
    root: PathBuf,
}

impl PromptAttachmentStorage {
    pub fn new(runtime_home: impl Into<PathBuf>) -> Self {
        Self {
            root: runtime_home.into().join("attachments").join("sessions"),
        }
    }

    pub fn storage_path(&self, session_id: &str, attachment_id: &str) -> String {
        format!("attachments/sessions/{session_id}/{attachment_id}/content")
    }

    pub fn write_new(
        &self,
        session_id: &str,
        attachment_id: &str,
        content: &[u8],
    ) -> anyhow::Result<String> {
        let relative_path = self.storage_path(session_id, attachment_id);
        let final_path = self.resolve_storage_path(&relative_path)?;
        let parent = final_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("attachment storage path has no parent"))?;
        fs::create_dir_all(parent)
            .with_context(|| format!("creating attachment directory {}", parent.display()))?;
        let tmp_path = parent.join(format!(".{attachment_id}.tmp"));
        {
            let mut file = fs::File::create(&tmp_path)
                .with_context(|| format!("creating attachment temp file {}", tmp_path.display()))?;
            file.write_all(content)
                .with_context(|| format!("writing attachment temp file {}", tmp_path.display()))?;
            file.sync_all()
                .with_context(|| format!("syncing attachment temp file {}", tmp_path.display()))?;
        }
        fs::rename(&tmp_path, &final_path).with_context(|| {
            format!(
                "moving attachment temp file {} to {}",
                tmp_path.display(),
                final_path.display()
            )
        })?;
        Ok(relative_path)
    }

    pub fn read(&self, record: &PromptAttachmentRecord) -> anyhow::Result<Vec<u8>> {
        let path = self.resolve_storage_path(&record.storage_path)?;
        fs::read(&path).with_context(|| {
            format!(
                "reading prompt attachment {} from {}",
                record.attachment_id,
                path.display()
            )
        })
    }

    pub fn delete_record(&self, record: &PromptAttachmentRecord) -> anyhow::Result<()> {
        let path = self.resolve_storage_path(&record.storage_path)?;
        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("deleting prompt attachment {}", path.display()))?;
        }
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
        Ok(())
    }

    pub fn delete_session_dir(&self, session_id: &str) -> anyhow::Result<()> {
        let path = self.resolve_relative_components(Path::new(session_id))?;
        if path.exists() {
            fs::remove_dir_all(&path)
                .with_context(|| format!("deleting session attachment dir {}", path.display()))?;
        }
        Ok(())
    }

    fn resolve_storage_path(&self, relative_path: &str) -> anyhow::Result<PathBuf> {
        let prefix = Path::new("attachments").join("sessions");
        let path = Path::new(relative_path);
        let suffix = path.strip_prefix(&prefix).with_context(|| {
            format!("attachment storage path must be under {}", prefix.display())
        })?;
        self.resolve_relative_components(suffix)
    }

    fn resolve_relative_components(&self, suffix: &Path) -> anyhow::Result<PathBuf> {
        let mut resolved = self.root.clone();
        for component in suffix.components() {
            match component {
                Component::Normal(part) => resolved.push(part),
                _ => anyhow::bail!("invalid prompt attachment storage path"),
            }
        }
        Ok(resolved)
    }
}

#[cfg(test)]
mod tests {
    use super::PromptAttachmentStorage;
    use crate::sessions::model::{
        PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentSource, PromptAttachmentState,
    };

    #[test]
    fn writes_reads_and_deletes_attachment_bytes() {
        let storage = test_storage();
        let storage_path = storage
            .write_new("session-1", "attachment-1", b"hello")
            .expect("write attachment");
        let record = record(storage_path);

        assert_eq!(storage.read(&record).expect("read attachment"), b"hello");
        storage.delete_record(&record).expect("delete attachment");
        assert!(storage.read(&record).is_err());
    }

    #[test]
    fn rejects_storage_paths_outside_attachment_root() {
        let storage = test_storage();
        let mut record = record("../escape".to_string());
        assert!(storage.read(&record).is_err());
        record.storage_path = "attachments/sessions/session-1/../escape/content".to_string();
        assert!(storage.read(&record).is_err());
    }

    fn test_storage() -> PromptAttachmentStorage {
        PromptAttachmentStorage::new(
            std::env::temp_dir().join(format!("anyharness-test-{}", uuid::Uuid::new_v4())),
        )
    }

    fn record(storage_path: String) -> PromptAttachmentRecord {
        PromptAttachmentRecord {
            attachment_id: "attachment-1".to_string(),
            session_id: "session-1".to_string(),
            state: PromptAttachmentState::Pending,
            kind: PromptAttachmentKind::TextResource,
            source: PromptAttachmentSource::Upload,
            mime_type: Some("text/plain".to_string()),
            display_name: Some("hello.txt".to_string()),
            source_uri: None,
            storage_path,
            size_bytes: 5,
            sha256: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}
