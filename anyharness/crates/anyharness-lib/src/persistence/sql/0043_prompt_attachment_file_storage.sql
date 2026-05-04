ALTER TABLE session_prompt_attachments
    ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';

ALTER TABLE session_prompt_attachments
    ADD COLUMN storage_path TEXT NOT NULL DEFAULT '';
