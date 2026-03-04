CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"worker_id" uuid,
	"channel_overrides" jsonb DEFAULT '{}'::jsonb,
	"muted_categories" jsonb DEFAULT '[]'::jsonb,
	"digest_cadence" text DEFAULT 'immediate',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_notification_prefs_user_worker" UNIQUE("user_id","worker_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"worker_id" uuid,
	"session_id" uuid,
	"run_id" uuid,
	"category" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_worker_id_workers_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_worker_run_id_worker_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_repo_baseline_id_repo_baselines_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_repo_baseline_target_id_repo_baseline_targets_id_fk";
--> statement-breakpoint
ALTER TABLE "workers" ALTER COLUMN "manager_session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_prefs_org_user" ON "notification_preferences" USING btree ("organization_id" text_ops,"user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_status" ON "notifications" USING btree ("user_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_org_user" ON "notifications" USING btree ("organization_id" text_ops,"user_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_worker" ON "notifications" USING btree ("worker_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_session" ON "notifications" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notifications_idempotency_key" ON "notifications" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_setup_session_id_sessions_id_fk" FOREIGN KEY ("setup_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_worker_run_id_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_baseline_id_repo_baselines_id_fk" FOREIGN KEY ("repo_baseline_id") REFERENCES "public"."repo_baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_baseline_target_id_repo_baseline_targets_id_fk" FOREIGN KEY ("repo_baseline_target_id") REFERENCES "public"."repo_baseline_targets"("id") ON DELETE no action ON UPDATE no action;