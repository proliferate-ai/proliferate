import pg from "pg";

const DB_URL =
	process.env.E2E_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/proliferate";

const SEED_SQL = `
BEGIN;

-- User
INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES ('e2e-user-001', 'E2E Test User', 'e2e@test.local', true, now(), now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;

-- Organization
INSERT INTO organization (id, name, slug, "createdAt", is_personal, onboarding_complete, billing_state)
VALUES ('e2e-org-001', 'E2E Test Org', 'e2e-test-org', now(), false, true, 'unconfigured')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

-- Member
INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
VALUES ('e2e-member-001', 'e2e-org-001', 'e2e-user-001', 'owner', now())
ON CONFLICT (id) DO NOTHING;

-- GitHub integration (satisfies hasGitHubConnection onboarding check)
INSERT INTO integrations (id, organization_id, provider, integration_id, connection_id, status)
VALUES ('c0000000-0000-0000-0000-000000000001', 'e2e-org-001', 'nango', 'github-app', 'e2e-connection', 'active')
ON CONFLICT (id) DO NOTHING;

-- Public repo (octocat/Hello-World)
INSERT INTO repos (id, organization_id, github_url, github_repo_id, github_repo_name, default_branch)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'e2e-org-001',
  'https://github.com/octocat/Hello-World',
  'octocat-hello-world',
  'octocat/Hello-World',
  'master'
)
ON CONFLICT (id) DO NOTHING;

-- Repo connection
INSERT INTO repo_connections (repo_id, integration_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Configuration (no snapshot → fresh clone, no snapshot restore)
INSERT INTO configurations (id, organization_id, sandbox_provider, name)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'e2e-org-001',
  'modal',
  'E2E Hello World'
)
ON CONFLICT (id) DO NOTHING;

-- Configuration ↔ Repo junction
INSERT INTO configuration_repos (configuration_id, repo_id, workspace_path)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  '/workspace/Hello-World'
)
ON CONFLICT DO NOTHING;

COMMIT;
`;

const CLEANUP_SQL = `
BEGIN;
DELETE FROM configuration_repos WHERE configuration_id = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM configurations WHERE id = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM repo_connections WHERE repo_id = 'a0000000-0000-0000-0000-000000000001';
DELETE FROM repos WHERE id = 'a0000000-0000-0000-0000-000000000001';
DELETE FROM integrations WHERE id = 'c0000000-0000-0000-0000-000000000001';
DELETE FROM member WHERE id = 'e2e-member-001';
-- Also clean by unique fields in case IDs drifted
DELETE FROM organization WHERE id = 'e2e-org-001' OR slug = 'e2e-test-org';
DELETE FROM "user" WHERE id = 'e2e-user-001' OR email = 'e2e@test.local';
COMMIT;
`;

export async function seedDatabase(): Promise<void> {
	const client = new pg.Client(DB_URL);
	try {
		await client.connect();
		await client.query(SEED_SQL);
	} finally {
		await client.end();
	}
}

export async function cleanupDatabase(): Promise<void> {
	const client = new pg.Client(DB_URL);
	try {
		await client.connect();
		await client.query(CLEANUP_SQL);
	} finally {
		await client.end();
	}
}

export async function waitForService(
	url: string,
	{ timeout = 30_000, interval = 1_000 } = {},
): Promise<void> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			if (res.ok) return;
		} catch {
			// retry
		}
		await new Promise((r) => setTimeout(r, interval));
	}
	throw new Error(`Service at ${url} not healthy after ${timeout}ms`);
}
