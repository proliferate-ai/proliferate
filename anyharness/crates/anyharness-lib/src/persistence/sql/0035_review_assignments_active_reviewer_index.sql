DROP INDEX IF EXISTS idx_review_assignments_reviewer_session;

CREATE UNIQUE INDEX idx_review_assignments_reviewer_session
ON review_assignments(reviewer_session_id)
WHERE reviewer_session_id IS NOT NULL
  AND status IN ('launching', 'reviewing', 'reminded');
