ALTER TABLE "organization"
  ADD COLUMN "overage_used_cents" integer NOT NULL DEFAULT 0,
  ADD COLUMN "overage_cycle_month" text,
  ADD COLUMN "overage_topup_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "overage_last_topup_at" timestamp with time zone,
  ADD COLUMN "overage_decline_at" timestamp with time zone,
  ADD COLUMN "last_reconciled_at" timestamp with time zone;
