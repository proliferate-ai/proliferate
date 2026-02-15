-- Partition llm_spend_cursors by organization_id (remove global singleton).
-- Keeps the legacy singleton table as llm_spend_cursors_global for audit/migration purposes.

ALTER TABLE "llm_spend_cursors" RENAME TO "llm_spend_cursors_global";

CREATE TABLE "llm_spend_cursors" (
	"organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
	"last_start_time" timestamptz NOT NULL,
	"last_request_id" text,
	"records_processed" integer NOT NULL DEFAULT 0,
	"synced_at" timestamptz NOT NULL DEFAULT now()
);

