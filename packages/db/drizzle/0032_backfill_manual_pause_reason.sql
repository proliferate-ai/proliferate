UPDATE sessions SET pause_reason = 'manual'
WHERE status = 'paused' AND pause_reason IS NULL;
