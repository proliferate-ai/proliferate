-- Allow manager sessions without a worker (ad-hoc coworker sessions).
-- Drop the old constraint that required worker_id IS NOT NULL for manager sessions,
-- and replace it with a relaxed version that only enforces the other invariants.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_manager_shape_check";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_manager_shape_check" CHECK ((kind != 'manager'::text) OR (worker_run_id IS NULL AND continued_from_session_id IS NULL AND rerun_of_session_id IS NULL));
