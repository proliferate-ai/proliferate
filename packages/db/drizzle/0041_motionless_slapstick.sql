ALTER TABLE "sessions" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "runtime_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "operator_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "visibility" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_manager_shape_check" CHECK ((kind != 'manager'::text) OR (worker_id IS NOT NULL AND worker_run_id IS NULL AND continued_from_session_id IS NULL AND rerun_of_session_id IS NULL));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_linkage_check" CHECK ((kind != 'task'::text) OR (repo_id IS NOT NULL AND repo_baseline_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_setup_requires_repo_check" CHECK ((kind != 'setup'::text) OR (repo_id IS NOT NULL));
