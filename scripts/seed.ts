/**
 * Database seed script
 *
 * Populates the database with fake sessions, automation runs, and action invocations
 * for every user/org in the database.
 *
 * Usage: pnpm exec tsx scripts/seed.ts
 *
 * Requires DATABASE_URL to be set (reads from .env.local via @proliferate/environment).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env and .env.local into process.env (Next.js does this automatically, scripts don't)
for (const envFile of [".env.local", ".env"]) {
	try {
		const content = readFileSync(resolve(import.meta.dirname ?? __dirname, "..", envFile), "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let value = trimmed.slice(eqIdx + 1).trim();
			// Strip surrounding quotes
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			if (!(key in process.env)) {
				process.env[key] = value;
			}
		}
	} catch {
		// File might not exist
	}
}

import { getDb, resetDb } from "../packages/db/src/client";
import { member } from "../packages/db/src/schema/auth";
import { automations } from "../packages/db/src/schema/automations";
import { repos } from "../packages/db/src/schema/repos";
import { actionInvocations, automationRuns } from "../packages/db/src/schema/schema";
import { sessions } from "../packages/db/src/schema/sessions";
import { triggerEvents, triggers } from "../packages/db/src/schema/triggers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickN<T>(arr: T[], n: number): T[] {
	const shuffled = [...arr].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, n);
}

/** Random date between `daysAgo` and now */
function randomDate(daysAgo: number): Date {
	const now = Date.now();
	const past = now - daysAgo * 24 * 60 * 60 * 1000;
	return new Date(past + Math.random() * (now - past));
}

/** Random date in the last N hours (for "recent" timestamps) */
function recentDate(hoursAgo: number): Date {
	const now = Date.now();
	const past = now - hoursAgo * 60 * 60 * 1000;
	return new Date(past + Math.random() * (now - past));
}

function uuid(): string {
	return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Fake data pools
// ---------------------------------------------------------------------------

const REPO_DEFS = [
	{ name: "acme/web-app", url: "https://github.com/acme/web-app" },
	{ name: "acme/api-server", url: "https://github.com/acme/api-server" },
	{ name: "acme/mobile-app", url: "https://github.com/acme/mobile-app" },
	{ name: "acme/design-system", url: "https://github.com/acme/design-system" },
	{ name: "acme/infra", url: "https://github.com/acme/infra" },
];

const SESSION_TITLES = [
	"Fix authentication bug in login flow",
	"Add dark mode support",
	"Refactor database queries for performance",
	"Implement user profile page",
	"Update API error handling",
	"Add email notification system",
	"Fix memory leak in WebSocket handler",
	"Implement search functionality",
	"Add CSV export feature",
	"Fix mobile responsive layout",
	"Update dependencies to latest versions",
	"Add rate limiting to API endpoints",
	"Implement file upload handling",
	"Fix timezone issues in date picker",
	"Add integration tests for checkout flow",
	"Refactor state management to Zustand",
	"Implement OAuth2 with Google",
	"Fix N+1 query in dashboard",
	"Add Stripe webhook handling",
	"Implement real-time notifications",
];

const SESSION_PROMPTS = [
	"The login page throws a 401 error when users try to sign in with email. Can you investigate and fix it?",
	"We need dark mode support across the app. Please implement it using CSS custom properties.",
	"The dashboard page takes 8 seconds to load. Profile the queries and optimize them.",
	"Build out the user profile page with avatar upload, name editing, and email preferences.",
	"Our API returns generic 500 errors. Add proper error classes and meaningful messages.",
	"Set up an email notification system using Resend for transactional emails.",
	"There's a memory leak when WebSocket connections are closed. Find and fix it.",
	"Add full-text search across projects and sessions using PostgreSQL tsvector.",
	"Users need to export their data as CSV. Add export buttons to the dashboard tables.",
	"The sidebar overlaps content on mobile screens below 768px. Fix the responsive layout.",
	"Run dependency updates and fix any breaking changes.",
	"Add rate limiting (100 req/min per user) to all API endpoints.",
	"Implement multipart file upload with progress tracking and S3 storage.",
	"Date picker shows wrong dates for users in non-UTC timezones. Fix the conversion.",
	"Write integration tests for the checkout flow covering happy path and edge cases.",
	"Migrate from Redux to Zustand for client-side state management.",
	"Add Google OAuth login alongside the existing email/password auth.",
	"The dashboard queries N+1 on user relations. Add proper eager loading.",
	"Set up Stripe webhook handler for subscription events (created, updated, cancelled).",
	"Add real-time notification bell with WebSocket updates for new events.",
];

const BRANCHES = [
	"fix/auth-bug",
	"feat/dark-mode",
	"perf/db-queries",
	"feat/user-profile",
	"fix/api-errors",
	"feat/email-notifications",
	"fix/ws-memory-leak",
	"feat/search",
	"feat/csv-export",
	"fix/mobile-layout",
	"chore/deps-update",
	"feat/rate-limiting",
	"feat/file-upload",
	"fix/timezone-dates",
	"test/checkout-flow",
	"refactor/zustand",
	"feat/google-oauth",
	"fix/n-plus-one",
	"feat/stripe-webhooks",
	"feat/realtime-notifications",
];

const AUTOMATION_DEFS = [
	{
		name: "PR Review Bot",
		description: "Automatically reviews pull requests and provides feedback on code quality",
		instructions:
			"Review the pull request changes. Check for bugs, security issues, and code style. Provide constructive feedback.",
	},
	{
		name: "Bug Triage",
		description: "Triages incoming bug reports from Sentry and creates fix PRs",
		instructions:
			"Analyze the error, find the root cause, and create a fix. Run tests to verify the fix works.",
	},
	{
		name: "Nightly Maintenance",
		description: "Runs nightly maintenance tasks like dependency updates and security scans",
		instructions:
			"Update dependencies, run security audit, fix any breaking changes, and open a PR with the updates.",
	},
];

const TRIGGER_EVENT_TYPES = [
	"pull_request.opened",
	"pull_request.synchronize",
	"issues.opened",
	"push",
	"issue_comment.created",
];

const ACTION_DEFS_COMPLETED = [
	{
		integration: "github",
		action: "add_comment",
		risk: "write",
		params: { pr: 142, body: "LGTM — tests pass, no regressions" },
	},
	{ integration: "github", action: "list_files", risk: "read", params: { pr: 138 } },
	{
		integration: "linear",
		action: "update_issue",
		risk: "write",
		params: { issueId: "ENG-312", state: "In Review" },
	},
	{ integration: "linear", action: "list_issues", risk: "read", params: { project: "Backend" } },
	{ integration: "sentry", action: "get_issue", risk: "read", params: { issueId: "SENTRY-8821" } },
	{
		integration: "sentry",
		action: "resolve_issue",
		risk: "write",
		params: { issueId: "SENTRY-8821" },
	},
];

const ACTION_DEFS_PENDING = [
	{
		integration: "github",
		action: "create_pull_request",
		risk: "write",
		params: {
			base: "main",
			head: "fix/auth-bug",
			title: "Fix OAuth token refresh race condition",
			draft: false,
		},
	},
	{
		integration: "github",
		action: "merge_pull_request",
		risk: "danger",
		params: { pr: 147, method: "squash", title: "feat: add rate limiting to API endpoints" },
	},
	{
		integration: "linear",
		action: "create_issue",
		risk: "write",
		params: {
			title: "Investigate flaky test in CI — checkout.spec.ts",
			priority: "high",
			team: "Backend",
		},
	},
];

// ---------------------------------------------------------------------------
// Seed one org
// ---------------------------------------------------------------------------

async function seedOrg(
	db: ReturnType<typeof getDb>,
	orgId: string,
	orgName: string,
	userId: string,
	userName: string,
) {
	// Unique suffix per org seed (avoids repo unique constraint collisions)
	const suffix = uuid().slice(0, 6);

	console.log(`\n  [${userName} / ${orgName}]`);

	// 1. Repos
	const repoRows = await db
		.insert(repos)
		.values(
			REPO_DEFS.map((r, i) => ({
				organizationId: orgId,
				githubUrl: r.url,
				githubRepoId: `seed-${suffix}-${i}`,
				githubRepoName: r.name,
				defaultBranch: "main",
				addedBy: userId,
				source: "github",
			})),
		)
		.returning();
	console.log(`    Repos:              ${repoRows.length}`);

	// 2. Sessions
	const sessionStatuses = [
		...Array(5).fill("running"),
		...Array(5).fill("paused"),
		...Array(8).fill("stopped"),
		...Array(2).fill("failed"),
	] as string[];

	const sessionRows = await db
		.insert(sessions)
		.values(
			sessionStatuses.map((status, i) => {
				const startedAt = randomDate(30);
				const isActive = status === "running";
				const isStopped = status === "stopped" || status === "failed";
				return {
					organizationId: orgId,
					repoId: pick(repoRows).id,
					createdBy: userId,
					sessionType: "coding" as const,
					status,
					title: SESSION_TITLES[i]!,
					initialPrompt: SESSION_PROMPTS[i]!,
					branchName: BRANCHES[i]!,
					sandboxProvider: "modal",
					origin: "web",
					startedAt,
					lastActivityAt: isActive ? recentDate(2) : randomDate(15),
					pausedAt: status === "paused" ? randomDate(7) : null,
					endedAt: isStopped ? randomDate(5) : null,
				};
			}),
		)
		.returning();
	console.log(`    Sessions:           ${sessionRows.length}`);

	// 3. Automations
	const automationRows = await db
		.insert(automations)
		.values(
			AUTOMATION_DEFS.map((a) => ({
				organizationId: orgId,
				name: a.name,
				description: a.description,
				agentInstructions: a.instructions,
				enabled: true,
				createdBy: userId,
			})),
		)
		.returning();
	console.log(`    Automations:        ${automationRows.length}`);

	// 4. Triggers (one per automation)
	const triggerRows = await db
		.insert(triggers)
		.values(
			automationRows.map((a) => ({
				organizationId: orgId,
				automationId: a.id,
				triggerType: "webhook",
				provider: "github",
				enabled: true,
				webhookUrlPath: `wh/${uuid()}`,
				createdBy: userId,
			})),
		)
		.returning();
	console.log(`    Triggers:           ${triggerRows.length}`);

	// 5. Trigger events
	const triggerEventStatuses = [
		...Array(6).fill("processed"),
		...Array(2).fill("queued"),
		...Array(1).fill("skipped"),
		...Array(1).fill("failed"),
	] as string[];

	const triggerEventRows = await db
		.insert(triggerEvents)
		.values(
			triggerEventStatuses.map((status) => {
				const trigger = pick(triggerRows);
				return {
					triggerId: trigger.id,
					organizationId: orgId,
					externalEventId: `gh-${uuid().slice(0, 8)}`,
					providerEventType: pick(TRIGGER_EVENT_TYPES),
					status,
					rawPayload: { event: "seed", timestamp: new Date().toISOString() },
					processedAt: status === "processed" ? randomDate(14) : null,
					skipReason: status === "skipped" ? "Filtered by LLM analysis" : null,
					dedupKey: uuid(),
				};
			}),
		)
		.returning();
	console.log(`    Trigger Events:     ${triggerEventRows.length}`);

	// 6. Automation runs (one per trigger event — unique FK constraint)
	const runStatuses = [
		...Array(4).fill("completed"),
		...Array(3).fill("executing"),
		...Array(2).fill("queued"),
		...Array(1).fill("failed"),
	] as string[];

	const runnableSessions = pickN(sessionRows, 6);

	const automationRunRows = await db
		.insert(automationRuns)
		.values(
			triggerEventRows.map((te, i) => {
				const status = runStatuses[i] ?? "queued";
				const automation = pick(automationRows);
				const trigger = pick(triggerRows);
				const queuedAt = randomDate(14);
				const isExecuting = status === "executing" || status === "completed";
				const isCompleted = status === "completed";
				const linkedSession = i < runnableSessions.length ? runnableSessions[i] : null;
				return {
					organizationId: orgId,
					automationId: automation.id,
					triggerEventId: te.id,
					triggerId: trigger.id,
					status,
					queuedAt,
					enrichmentStartedAt: isExecuting ? new Date(queuedAt.getTime() + 2000) : null,
					enrichmentCompletedAt: isExecuting ? new Date(queuedAt.getTime() + 5000) : null,
					executionStartedAt: isExecuting ? new Date(queuedAt.getTime() + 6000) : null,
					completedAt: isCompleted ? new Date(queuedAt.getTime() + 120_000) : null,
					sessionId: linkedSession?.id ?? null,
					sessionCreatedAt: linkedSession?.startedAt ?? null,
					errorCode: status === "failed" ? "NEEDS_CLARIFICATION" : null,
					errorMessage:
						status === "failed"
							? "Agent needs your input — multiple fix strategies available, awaiting direction"
							: null,
					lastActivityAt: isExecuting ? recentDate(6) : null,
				};
			}),
		)
		.returning();
	console.log(`    Automation Runs:    ${automationRunRows.length}`);

	// 7. Action invocations
	const actionStatuses = [
		...Array(6).fill("completed"),
		...Array(3).fill("pending"),
		...Array(3).fill("approved"),
		...Array(2).fill("failed"),
		...Array(1).fill("denied"),
	] as string[];

	const actionRows = await db
		.insert(actionInvocations)
		.values(
			actionStatuses.map((status) => {
				const session = pick(sessionRows);
				const isPending = status === "pending";
				const actionDef = isPending ? pick(ACTION_DEFS_PENDING) : pick(ACTION_DEFS_COMPLETED);
				const createdAt = isPending ? recentDate(4) : randomDate(21);
				const isCompleted = status === "completed";
				const isApproved = status === "approved" || status === "completed";
				return {
					sessionId: session.id,
					organizationId: orgId,
					integration: actionDef.integration,
					action: actionDef.action,
					riskLevel: actionDef.risk,
					mode: actionDef.risk === "read" ? "auto" : "manual",
					modeSource: "org_default",
					params: actionDef.params,
					status,
					result: isCompleted ? { success: true } : null,
					error: status === "failed" ? "GitHub API rate limit exceeded (5000 req/hr)" : null,
					deniedReason: status === "denied" ? "Action not allowed by org policy" : null,
					durationMs: isCompleted ? Math.floor(Math.random() * 5000) + 200 : null,
					approvedBy: isApproved ? userId : null,
					approvedAt: isApproved ? new Date(createdAt.getTime() + 30_000) : null,
					completedAt: isCompleted ? new Date(createdAt.getTime() + 60_000) : null,
					createdAt,
				};
			}),
		)
		.returning();
	console.log(`    Action Invocations: ${actionRows.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const db = getDb();

	// Find all members (user + org pairs) — deduplicate by orgId so we seed each org once
	const allMembers = await db.query.member.findMany({
		with: { user: true, organization: true },
	});

	if (allMembers.length === 0) {
		console.error("No users/orgs found in database. Sign up first, then run this script.");
		process.exit(1);
	}

	// Deduplicate by orgId — pick the first member per org as the "creator"
	const seenOrgs = new Set<string>();
	const uniqueOrgMembers = allMembers.filter((m) => {
		if (!m.user || !m.organization || seenOrgs.has(m.organization.id)) return false;
		seenOrgs.add(m.organization.id);
		return true;
	});

	console.log(`Found ${uniqueOrgMembers.length} org(s) to seed.`);

	for (const m of uniqueOrgMembers) {
		await seedOrg(db, m.organization!.id, m.organization!.name, m.user!.id, m.user!.name);
	}

	console.log("\nSeed complete.");
	await resetDb();
}

main().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
