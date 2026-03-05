ALTER TABLE "sessions"
ADD COLUMN "sandbox_state" text DEFAULT 'provisioning' NOT NULL,
ADD COLUMN "agent_state" text DEFAULT 'iterating' NOT NULL,
ADD COLUMN "terminal_state" text,
ADD COLUMN "state_reason" text,
ADD COLUMN "state_updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_sandbox_state_check"
CHECK ("sessions"."sandbox_state" = ANY (ARRAY['provisioning'::text, 'running'::text, 'paused'::text, 'terminated'::text, 'failed'::text]));

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_agent_state_check"
CHECK ("sessions"."agent_state" = ANY (ARRAY['iterating'::text, 'waiting_input'::text, 'waiting_approval'::text, 'done'::text, 'errored'::text]));

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_terminal_state_check"
CHECK ("sessions"."terminal_state" IS NULL OR "sessions"."terminal_state" = ANY (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text]));

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_state_reason_check"
CHECK ("sessions"."state_reason" IS NULL OR "sessions"."state_reason" = ANY (ARRAY[
	'manual_pause'::text,
	'inactivity'::text,
	'approval_required'::text,
	'orphaned'::text,
	'snapshot_failed'::text,
	'automation_completed'::text,
	'credit_limit'::text,
	'payment_failed'::text,
	'overage_cap'::text,
	'suspended'::text,
	'cancelled_by_user'::text,
	'runtime_error'::text
]));

CREATE INDEX "idx_sessions_sandbox_state" ON "sessions" USING btree ("sandbox_state" text_ops);
CREATE INDEX "idx_sessions_agent_state" ON "sessions" USING btree ("agent_state" text_ops);
CREATE INDEX "idx_sessions_terminal_state" ON "sessions" USING btree ("terminal_state" text_ops);

UPDATE "sessions"
SET
	"sandbox_state" = CASE
		WHEN "status" = 'starting' THEN 'provisioning'
		WHEN "status" = 'running' THEN 'running'
		WHEN "status" = 'paused' THEN 'paused'
		WHEN "status" = 'stopped' THEN 'terminated'
		WHEN "status" = 'suspended' THEN 'paused'
		ELSE 'failed'
	END,
	"agent_state" = CASE
		WHEN "operator_status" = 'active' THEN 'iterating'
		WHEN "operator_status" = 'needs_input' THEN 'waiting_input'
		WHEN "operator_status" = 'waiting_for_approval' THEN 'waiting_approval'
		WHEN "operator_status" IN ('ready_for_review', 'done') THEN 'done'
		WHEN "operator_status" = 'errored' THEN 'errored'
		WHEN "status" = 'stopped' THEN 'done'
		ELSE 'iterating'
	END,
	"terminal_state" = CASE
		WHEN "runtime_status" = 'completed' OR "outcome" IN ('completed', 'succeeded') THEN 'succeeded'
		WHEN "runtime_status" = 'failed' OR "outcome" = 'failed' THEN 'failed'
		WHEN "runtime_status" = 'cancelled' THEN 'cancelled'
		ELSE NULL
	END,
	"state_reason" = CASE
		WHEN "pause_reason" = 'manual' THEN 'manual_pause'
		WHEN "pause_reason" = 'inactivity' THEN 'inactivity'
		WHEN "pause_reason" = 'orphaned' THEN 'orphaned'
		WHEN "pause_reason" = 'snapshot_failed' THEN 'snapshot_failed'
		WHEN "pause_reason" = 'automation_completed' THEN 'automation_completed'
		WHEN "pause_reason" = 'credit_limit' THEN 'credit_limit'
		WHEN "pause_reason" = 'payment_failed' THEN 'payment_failed'
		WHEN "pause_reason" = 'overage_cap' THEN 'overage_cap'
		WHEN "pause_reason" = 'suspended' THEN 'suspended'
		ELSE NULL
	END,
	"state_updated_at" = COALESCE("paused_at", "ended_at", "last_activity_at", now());
