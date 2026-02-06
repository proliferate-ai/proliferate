import { expect, test } from "@playwright/test";
import { cleanupDatabase, seedDatabase, waitForService } from "./helpers";

const GATEWAY_URL = process.env.E2E_GATEWAY_URL || "http://localhost:8787";
const WEB_URL = process.env.E2E_WEB_URL || "http://localhost:3000";
const E2E_ORG_ID = process.env.E2E_ORG_ID || "e2e-org-001";
const E2E_AUTH_TOKEN = process.env.E2E_AUTH_TOKEN || "test-e2e-token";
// Prebuild seeded with snapshot_id=NULL → gateway does a fresh repo clone (no snapshot restore)
const E2E_PREBUILD_ID = process.env.E2E_PREBUILD_ID || "b0000000-0000-0000-0000-000000000001";
const PROMPT = 'Say exactly: "Hello from Playwright!" and nothing else.';

test.beforeAll(async () => {
	// Clean up stale data, then seed fresh
	await cleanupDatabase();
	await seedDatabase();

	// Ensure services are up
	await Promise.all([
		waitForService(`${WEB_URL}/api/auth/get-session`, { timeout: 60_000 }),
		waitForService(`${GATEWAY_URL}/health`, { timeout: 30_000 }),
	]);
});

test.afterAll(async () => {
	await cleanupDatabase();
});

test("dashboard loads with seeded snapshot", async ({ page }) => {
	// Quick smoke test that the dashboard renders correctly with our seeded data
	await page.goto("/dashboard");
	await page.waitForLoadState("networkidle");

	await expect(page.getByText("What do you want to build?")).toBeVisible({
		timeout: 30_000,
	});

	// Sidebar should show our seeded snapshot
	await expect(page.getByText("E2E Hello World")).toBeVisible({
		timeout: 10_000,
	});
});

test("create session and chat with agent", async ({ page }) => {
	// Generous timeout - sandbox creation + agent response can take a while
	test.setTimeout(5 * 60 * 1000);

	// 1. Create session via gateway HTTP API
	const createRes = await fetch(`${GATEWAY_URL}/proliferate/sessions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${E2E_AUTH_TOKEN}`,
		},
		body: JSON.stringify({
			prebuildId: E2E_PREBUILD_ID,
			organizationId: E2E_ORG_ID,
			sessionType: "coding",
			clientType: "web",
		}),
	});

	const createBody = await createRes.json();
	expect(createRes.ok, `Session create failed: ${JSON.stringify(createBody)}`).toBe(true);
	const sessionId = (createBody as { sessionId: string }).sessionId;
	expect(sessionId).toBeTruthy();

	// 2. Send message via gateway HTTP API
	// The ensureSessionReady middleware will wait for the sandbox to be ready
	// before processing the message, so this handles the startup delay.
	const messageRes = await fetch(`${GATEWAY_URL}/proliferate/${sessionId}/message`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${E2E_AUTH_TOKEN}`,
		},
		body: JSON.stringify({
			type: "prompt",
			content: PROMPT,
			userId: "e2e-user-001",
			source: "web",
		}),
	});

	const messageBody = await messageRes.json();
	expect(messageRes.ok, `Message send failed: ${JSON.stringify(messageBody)}`).toBe(true);

	// 3. Navigate to the session page
	await page.goto(`/dashboard/sessions/${sessionId}`);

	// 4. Wait for the page to show the session is connected (LIVE badge)
	await expect(page.getByText("Live")).toBeVisible({ timeout: 90_000 });

	// 5. Wait for the user message to appear in the thread
	await expect(page.getByText(PROMPT)).toBeVisible({ timeout: 60_000 });

	// 6. Wait for the assistant response.
	// The user message contains "Hello from Playwright!" as a substring, so we need
	// to verify a SECOND element with that text exists (the assistant's reply).
	// Use exact: true to match only elements whose full text is exactly the response.
	await expect(page.getByText("Hello from Playwright!", { exact: true })).toBeVisible({
		timeout: 3 * 60 * 1000,
	});

	// 7. Take a screenshot for evidence
	await page.screenshot({
		path: test.info().outputPath("session-flow-success.png"),
		fullPage: true,
	});
});
