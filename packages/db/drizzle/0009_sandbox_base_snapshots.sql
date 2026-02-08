-- Sandbox base snapshot persistence (Layer 1).
--
-- Stores pre-built base snapshot image IDs so the worker builds once
-- and session creation reads from DB instead of MODAL_BASE_SNAPSHOT_ID env var.

CREATE TABLE IF NOT EXISTS "sandbox_base_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "version_key" text NOT NULL,
    "snapshot_id" text,
    "status" text DEFAULT 'building' NOT NULL,
    "error" text,
    "provider" text DEFAULT 'modal' NOT NULL,
    "modal_app_name" text NOT NULL,
    "built_at" timestamptz,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    CONSTRAINT "sandbox_base_snapshots_status_check" CHECK (status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text]))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_sandbox_base_snapshots_version_provider_app"
    ON "sandbox_base_snapshots" ("version_key", "provider", "modal_app_name");

CREATE INDEX IF NOT EXISTS "idx_sandbox_base_snapshots_status"
    ON "sandbox_base_snapshots" ("status");
