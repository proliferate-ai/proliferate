-- P1 fix: source-level upserts broken because NULL action_id values are
-- treated as distinct by the normal UNIQUE constraint. This means ON CONFLICT
-- never fires for source-level rows, creating duplicates and causing stale
-- "disabled" rows to persist after re-enabling.

-- Step 1: Deduplicate any existing source-level rows (action_id IS NULL).
-- Keep only the most recently updated row per (user_id, organization_id, source_id).
DELETE FROM "user_action_preferences" a
USING "user_action_preferences" b
WHERE a.action_id IS NULL
  AND b.action_id IS NULL
  AND a.user_id = b.user_id
  AND a.organization_id = b.organization_id
  AND a.source_id = b.source_id
  AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id));
--> statement-breakpoint

-- Step 2: Replace the constraint with NULLS NOT DISTINCT so Postgres treats
-- NULL action_id values as equal for uniqueness checks.
ALTER TABLE "user_action_preferences" DROP CONSTRAINT "user_action_prefs_user_org_source_action_key";
--> statement-breakpoint
ALTER TABLE "user_action_preferences" ADD CONSTRAINT "user_action_prefs_user_org_source_action_key" UNIQUE NULLS NOT DISTINCT ("user_id","organization_id","source_id","action_id");
