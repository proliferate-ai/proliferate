-- WF-ID cutover: legacy workflow plans were open JSON and may contain plaintext
-- credentials under arbitrary renamed or nested keys. Every legacy actor is
-- drained before this migration, so retain the run ledger but replace the whole
-- untrusted plan blob with a credential-free tombstone. A short known-key list
-- is not a security boundary.
UPDATE workflow_runs
SET plan_json = '{}',
    status = CASE
        WHEN status IN ('running', 'waiting_approval') THEN 'failed'
        ELSE status
    END,
    error_code = CASE
        WHEN status IN ('running', 'waiting_approval')
            THEN 'workflow_identity_upgrade_required'
        ELSE error_code
    END,
    error_message = CASE
        WHEN status IN ('running', 'waiting_approval')
            THEN 'Legacy workflow run parked during identity cutover.'
        ELSE error_message
    END,
    updated_at = datetime('now');
