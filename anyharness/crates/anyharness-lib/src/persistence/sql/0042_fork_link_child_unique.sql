CREATE UNIQUE INDEX IF NOT EXISTS idx_session_links_fork_child
    ON session_links (child_session_id)
    WHERE relation = 'fork';
