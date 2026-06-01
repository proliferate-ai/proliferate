use crate::sessions::attachment_storage::PromptAttachmentStorage;
use crate::sessions::store::SessionStore;

const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

pub fn read_prompt_attachment_content_with_legacy_fallback(
    store: &SessionStore,
    attachment_storage: &PromptAttachmentStorage,
    record: &crate::sessions::model::PromptAttachmentRecord,
) -> anyhow::Result<Vec<u8>> {
    let has_storage_path = !record.storage_path.trim().is_empty();
    if has_storage_path {
        match attachment_storage.read(record) {
            Ok(content) => return Ok(content),
            Err(error) => {
                tracing::warn!(
                    session_id = %record.session_id,
                    attachment_id = %record.attachment_id,
                    error = %error,
                    "failed to read file-backed prompt attachment; trying legacy content"
                );
            }
        }
    }

    let content = store
        .read_legacy_prompt_attachment_content(&record.session_id, &record.attachment_id)?
        .ok_or_else(|| anyhow::anyhow!("prompt attachment bytes missing"))?;
    if content.is_empty()
        && has_storage_path
        && !(record.size_bytes == 0 && record.sha256 == EMPTY_SHA256)
    {
        anyhow::bail!("prompt attachment file is missing and legacy placeholder is empty");
    }
    let storage_path =
        attachment_storage.write_new(&record.session_id, &record.attachment_id, &content)?;
    store.update_prompt_attachment_storage_path(
        &record.session_id,
        &record.attachment_id,
        &storage_path,
    )?;
    Ok(content)
}
