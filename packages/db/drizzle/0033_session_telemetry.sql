-- Phase 2a: Session telemetry columns
ALTER TABLE "sessions" ADD COLUMN "outcome" text;
ALTER TABLE "sessions" ADD COLUMN "summary" text;
ALTER TABLE "sessions" ADD COLUMN "pr_urls" jsonb;
ALTER TABLE "sessions" ADD COLUMN "metrics" jsonb;
ALTER TABLE "sessions" ADD COLUMN "latest_task" text;

-- Backfill outcome/summary/pr_urls from automation_runs completion data.
-- Uses DISTINCT ON to pick the most recently completed run per session.
-- COALESCE prevents overwriting non-null values (safe to run multiple times).
WITH latest_runs AS (
  SELECT DISTINCT ON (session_id)
    session_id,
    completion_json
  FROM automation_runs
  WHERE completion_json IS NOT NULL
    AND session_id IS NOT NULL
  ORDER BY session_id, completed_at DESC NULLS LAST, id DESC
)
UPDATE sessions s
SET
  outcome = COALESCE(s.outcome, lr.completion_json->>'outcome'),
  summary = COALESCE(s.summary, lr.completion_json->>'summary_markdown'),
  pr_urls = COALESCE(s.pr_urls,
    CASE WHEN jsonb_typeof(lr.completion_json->'side_effect_refs') = 'array'
    THEN (
      SELECT jsonb_agg(DISTINCT elem)
      FROM jsonb_array_elements_text(lr.completion_json->'side_effect_refs') AS elem
      WHERE elem ~ '^https://github\.com/[^/]+/[^/]+/pull/\d+$'
    )
    ELSE NULL END
  )
FROM latest_runs lr
WHERE lr.session_id = s.id
  AND (s.outcome IS NULL OR s.summary IS NULL OR s.pr_urls IS NULL);
