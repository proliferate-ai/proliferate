CREATE TABLE IF NOT EXISTS "org_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"transport" text DEFAULT 'remote_http' NOT NULL,
	"url" text NOT NULL,
	"auth" jsonb NOT NULL,
	"risk_policy" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_org_connectors_org" ON "org_connectors" USING btree ("organization_id");

ALTER TABLE "org_connectors" ADD CONSTRAINT "org_connectors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_connectors" ADD CONSTRAINT "org_connectors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;

-- Backfill: copy existing prebuild connector configs into org_connectors.
-- For each prebuild with connectors, resolve the organization via prebuild_repos → repos.
-- Deduplicates exact duplicates (same org + same effective connector config), while preserving
-- distinct connectors that share a URL/name but use different auth or policy.
-- ID assignment is defensive:
-- - preserve legacy UUIDs when valid and non-conflicting
-- - generate fresh UUIDs for invalid/missing/conflicting legacy IDs
WITH expanded AS (
	SELECT
		r."organization_id" AS organization_id,
		c->>'id' AS legacy_id,
		c->>'name' AS name,
		COALESCE(c->>'transport', 'remote_http') AS transport,
		c->>'url' AS url,
		c->'auth' AS auth,
		c->'riskPolicy' AS risk_policy,
		COALESCE((c->>'enabled')::boolean, true) AS enabled,
		p."created_by" AS created_by,
		COALESCE(p."connectors_updated_at", p."created_at", now()) AS updated_at
	FROM "prebuilds" p
	CROSS JOIN LATERAL jsonb_array_elements(p."connectors") AS c
	JOIN "prebuild_repos" pr ON pr."prebuild_id" = p."id"
	JOIN "repos" r ON r."id" = pr."repo_id"
	WHERE p."connectors" IS NOT NULL
	  AND jsonb_array_length(p."connectors") > 0
	  AND c->>'name' IS NOT NULL
	  AND c->>'url' IS NOT NULL
	  AND c->'auth' IS NOT NULL
),
dedup AS (
	SELECT
		*,
		row_number() OVER (
			PARTITION BY organization_id, name, transport, url, auth, risk_policy, enabled
			ORDER BY updated_at DESC
		) AS dup_rank
	FROM expanded
),
normalized AS (
	SELECT
		*,
		row_number() OVER (
			PARTITION BY legacy_id
			ORDER BY updated_at DESC, organization_id, name, url
		) AS legacy_id_rank
	FROM dedup
	WHERE dup_rank = 1
)
INSERT INTO "org_connectors" ("id", "organization_id", "name", "transport", "url", "auth", "risk_policy", "enabled", "created_by", "created_at", "updated_at")
SELECT
	CASE
		WHEN legacy_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
			AND legacy_id_rank = 1
		THEN legacy_id::uuid
		ELSE gen_random_uuid()
	END AS id,
	organization_id,
	name,
	transport,
	url,
	auth,
	risk_policy,
	enabled,
	created_by,
	updated_at,
	updated_at
FROM normalized;
