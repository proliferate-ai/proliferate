/**
 * Demo data seed script for automation events UI.
 *
 * Usage (from repo root):
 *   pnpm --filter web exec tsx scripts/seed-demo.ts            # seed
 *   pnpm --filter web exec tsx scripts/seed-demo.ts --cleanup  # tear down
 *
 * Or with global tsx:
 *   tsx apps/web/scripts/seed-demo.ts
 *   tsx apps/web/scripts/seed-demo.ts --cleanup
 */

import pg from "pg";

const DB_URL =
	process.env.DATABASE_URL ||
	process.env.E2E_DATABASE_URL ||
	"postgresql://postgres:postgres@127.0.0.1:5432/proliferate";

// ============================================
// ID conventions — all prefixed with d0 for easy identification
// ============================================

const IDS = {
	user: "demo-user-001",
	org: "demo-org-001",
	member: "demo-member-001",

	// Automations
	automationPosthog: "d0000000-0000-0000-0001-000000000001",
	automationSentry: "d0000000-0000-0000-0001-000000000002",
	automationFlaky: "d0000000-0000-0000-0001-000000000003",

	// Triggers
	triggerPosthog: "d0000000-0000-0000-0002-000000000001",
	triggerSentry: "d0000000-0000-0000-0002-000000000002",
	triggerFlaky: "d0000000-0000-0000-0002-000000000003",

	// Trigger events — posthog
	evtPh1: "d0000000-0000-0000-0003-000000000001",
	evtPh2: "d0000000-0000-0000-0003-000000000002",
	evtPh3: "d0000000-0000-0000-0003-000000000003",
	evtPh4: "d0000000-0000-0000-0003-000000000004",
	evtPh5: "d0000000-0000-0000-0003-000000000005",
	evtPh6: "d0000000-0000-0000-0003-000000000006",

	// Trigger events — sentry
	evtSe1: "d0000000-0000-0000-0004-000000000001",
	evtSe2: "d0000000-0000-0000-0004-000000000002",
	evtSe3: "d0000000-0000-0000-0004-000000000003",
	evtSe4: "d0000000-0000-0000-0004-000000000004",
	evtSe5: "d0000000-0000-0000-0004-000000000005",
	evtSe6: "d0000000-0000-0000-0004-000000000006",

	// Trigger events — flaky
	evtFl1: "d0000000-0000-0000-0005-000000000001",
	evtFl2: "d0000000-0000-0000-0005-000000000002",
	evtFl3: "d0000000-0000-0000-0005-000000000003",
	evtFl4: "d0000000-0000-0000-0005-000000000004",
	evtFl5: "d0000000-0000-0000-0005-000000000005",

	// Automation runs — posthog
	runPh1: "d0000000-0000-0000-0006-000000000001",
	runPh2: "d0000000-0000-0000-0006-000000000002",
	runPh3: "d0000000-0000-0000-0006-000000000003",
	runPh4: "d0000000-0000-0000-0006-000000000004",
	runPh5: "d0000000-0000-0000-0006-000000000005",
	runPh6: "d0000000-0000-0000-0006-000000000006",

	// Automation runs — sentry
	runSe1: "d0000000-0000-0000-0007-000000000001",
	runSe2: "d0000000-0000-0000-0007-000000000002",
	runSe3: "d0000000-0000-0000-0007-000000000003",
	runSe4: "d0000000-0000-0000-0007-000000000004",
	runSe5: "d0000000-0000-0000-0007-000000000005",
	runSe6: "d0000000-0000-0000-0007-000000000006",

	// Automation runs — flaky
	runFl1: "d0000000-0000-0000-0008-000000000001",
	runFl2: "d0000000-0000-0000-0008-000000000002",
	runFl3: "d0000000-0000-0000-0008-000000000003",
	runFl4: "d0000000-0000-0000-0008-000000000004",
	runFl5: "d0000000-0000-0000-0008-000000000005",
};

// ============================================
// Helper — JSON for SQL
// ============================================
function j(obj: unknown): string {
	return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}

// Timestamps spread over last 48h
function ago(hours: number): string {
	return `now() - interval '${hours} hours'`;
}

// ============================================
// SEED SQL
// ============================================

const SEED_SQL = `
BEGIN;

-- =============================================
-- Foundation: user, org, member
-- =============================================

INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES ('${IDS.user}', 'Demo User', 'demo@proliferate.dev', true, now(), now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;

INSERT INTO organization (id, name, slug, "createdAt", is_personal, onboarding_complete, billing_state)
VALUES ('${IDS.org}', 'Demo Workspace', 'demo-workspace', now(), false, true, 'unconfigured')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
VALUES ('${IDS.member}', '${IDS.org}', '${IDS.user}', 'owner', now())
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Automations
-- =============================================

INSERT INTO automations (id, organization_id, name, enabled, agent_instructions, agent_type, model_id, created_by, created_at, updated_at)
VALUES
  ('${IDS.automationPosthog}', '${IDS.org}', 'PostHog Rage Click Triage', true,
   'You are a frontend debugging agent. When a PostHog rage click or dead click event comes in, investigate the UI element, check for broken click handlers, CSS issues, or slow responses. If you find a bug, open a PR with a fix.',
   'opencode', 'claude-sonnet-4-20250514', '${IDS.user}', ${ago(72)}, ${ago(2)}),

  ('${IDS.automationSentry}', '${IDS.org}', 'Sentry Exception Triage', true,
   'You are a backend debugging agent. When a Sentry error comes in, analyze the stack trace, identify the root cause, and either fix the issue directly or escalate with a detailed analysis.',
   'opencode', 'claude-sonnet-4-20250514', '${IDS.user}', ${ago(96)}, ${ago(5)}),

  ('${IDS.automationFlaky}', '${IDS.org}', 'Nightly Flaky Test Sweep', true,
   'You are a test reliability agent. Scan the CI results for the given PR, identify flaky tests (tests that passed on retry), analyze the root cause of flakiness, and either fix the test or file a detailed issue.',
   'opencode', 'claude-sonnet-4-20250514', '${IDS.user}', ${ago(120)}, ${ago(1)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Triggers
-- =============================================

INSERT INTO triggers (id, organization_id, automation_id, name, trigger_type, provider, enabled, execution_mode, config, created_by, created_at, updated_at)
VALUES
  ('${IDS.triggerPosthog}', '${IDS.org}', '${IDS.automationPosthog}', 'PostHog Webhooks', 'webhook', 'posthog', true, 'auto', '{"eventNames": ["$rageclick", "$deadclick", "$exception"]}'::jsonb, '${IDS.user}', ${ago(72)}, ${ago(72)}),

  ('${IDS.triggerSentry}', '${IDS.org}', '${IDS.automationSentry}', 'Sentry Alerts', 'webhook', 'sentry', true, 'auto', '{"minLevel": "error"}'::jsonb, '${IDS.user}', ${ago(96)}, ${ago(96)}),

  ('${IDS.triggerFlaky}', '${IDS.org}', '${IDS.automationFlaky}', 'GitHub CI Checks', 'webhook', 'github', true, 'auto', '{}'::jsonb, '${IDS.user}', ${ago(120)}, ${ago(120)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Trigger Events — PostHog
-- =============================================

INSERT INTO trigger_events (id, trigger_id, organization_id, status, provider_event_type, raw_payload, parsed_context, dedup_key, created_at)
VALUES
  -- PH1: Rage clicks on Add to Cart — succeeded
  ('${IDS.evtPh1}', '${IDS.triggerPosthog}', '${IDS.org}', 'completed', '$rageclick',
   '{"event": "$rageclick"}'::jsonb,
   ${j({
			title: 'Rage clicks on "Add to Cart" button — checkout page',
			posthog: {
				event: "$rageclick",
				distinctId: "user-8a3f2b",
				eventUrl: "https://app.example.com/checkout",
				timestamp: "2025-02-05T14:23:11Z",
				properties: {
					$current_url: "https://app.example.com/checkout",
					$element_tag: "button",
					$element_text: "Add to Cart",
					$element_classes: ["btn-primary", "checkout-cta"],
					$rage_click_count: 7,
				},
				person: {
					name: "Sarah Chen",
					url: "https://app.posthog.com/person/user-8a3f2b",
				},
			},
			llm_analysis_result: {
				severity: "high",
				summary:
					"Users are rage-clicking the Add to Cart button on the checkout page. The button's onClick handler has a race condition where it disables itself before the cart API responds, but re-enables on a failed network retry — causing a brief clickable window that triggers duplicate requests.",
				rootCause:
					"Race condition in CartButton component: the loading state is toggled off during retry logic in useAddToCart hook, allowing clicks during pending API calls.",
				recommendedActions: [
					"Fix loading state in useAddToCart hook",
					"Add debounce to click handler",
					"Review cart API response times",
				],
			},
		})},
   'ph-rageclick-001', ${ago(3)}),

  -- PH2: Dead click on pricing toggle — succeeded
  ('${IDS.evtPh2}', '${IDS.triggerPosthog}', '${IDS.org}', 'completed', '$deadclick',
   '{"event": "$deadclick"}'::jsonb,
   ${j({
			title: "Dead click on pricing toggle",
			posthog: {
				event: "$deadclick",
				distinctId: "user-c91d4e",
				eventUrl: "https://app.example.com/pricing",
				timestamp: "2025-02-05T09:15:43Z",
				properties: {
					$current_url: "https://app.example.com/pricing",
					$element_tag: "div",
					$element_text: "Monthly / Annual",
					$element_classes: ["pricing-toggle", "flex"],
				},
				person: {
					name: "James Wilson",
					url: "https://app.posthog.com/person/user-c91d4e",
				},
			},
			llm_analysis_result: {
				severity: "low",
				summary:
					"The pricing toggle appears interactive (cursor: pointer, hover effects) but the click handler is attached to the child span elements, not the parent div. Users clicking the gap between spans get no response.",
				rootCause: "Click handler on child elements only; parent div has pointer cursor but no onClick.",
				recommendedActions: ["Move onClick handler to parent div", "Add proper ARIA role"],
			},
		})},
   'ph-deadclick-001', ${ago(8)}),

  -- PH3: Rage clicks on signup submit — needs_human
  ('${IDS.evtPh3}', '${IDS.triggerPosthog}', '${IDS.org}', 'completed', '$rageclick',
   '{"event": "$rageclick"}'::jsonb,
   ${j({
			title: "Rage clicks on submit button — signup form",
			posthog: {
				event: "$rageclick",
				distinctId: "user-f72a1c",
				eventUrl: "https://app.example.com/signup",
				timestamp: "2025-02-05T18:41:29Z",
				properties: {
					$current_url: "https://app.example.com/signup",
					$element_tag: "button",
					$element_text: "Create Account",
					$element_classes: ["btn-primary", "signup-submit"],
					$rage_click_count: 12,
				},
				person: {
					name: "Anonymous",
					url: "https://app.posthog.com/person/user-f72a1c",
				},
			},
			llm_analysis_result: {
				severity: "critical",
				summary:
					"12 rage clicks on the signup submit button. The form validation is running client-side but the error messages are rendered below the fold. Users cannot see why their submission is failing and keep clicking.",
				rootCause:
					"Form validation errors render at the bottom of a scrollable form container. No auto-scroll to first error. No visual feedback on the submit button itself.",
				recommendedActions: [
					"Auto-scroll to first validation error",
					"Add inline validation on blur",
					"Show loading state on submit button",
					"Escalate to design team for UX review",
				],
			},
		})},
   'ph-rageclick-002', ${ago(1)}),

  -- PH4: Exception in payment flow — failed
  ('${IDS.evtPh4}', '${IDS.triggerPosthog}', '${IDS.org}', 'completed', '$exception',
   '{"event": "$exception"}'::jsonb,
   ${j({
			title: "Exception in payment flow",
			posthog: {
				event: "$exception",
				distinctId: "user-2b8e9d",
				eventUrl: "https://app.example.com/checkout/payment",
				timestamp: "2025-02-05T21:05:17Z",
				properties: {
					$exception_type: "TypeError",
					$exception_message: "Cannot read properties of null (reading 'id')",
					$current_url: "https://app.example.com/checkout/payment",
				},
				person: {
					name: "Alex Rivera",
					url: "https://app.posthog.com/person/user-2b8e9d",
				},
			},
			llm_analysis_result: {
				severity: "critical",
				summary:
					"TypeError in payment flow when user's saved payment method is null. The PaymentMethodSelector component assumes at least one saved method exists.",
				rootCause:
					"PaymentMethodSelector.tsx line 42: paymentMethods[0].id accessed without null check when user has no saved payment methods.",
				recommendedActions: [
					"Add null check for empty payment methods",
					"Show 'Add payment method' CTA when none exist",
					"Add E2E test for new user checkout",
				],
			},
		})},
   'ph-exception-001', ${ago(6)}),

  -- PH5: Dead click on Export button — running
  ('${IDS.evtPh5}', '${IDS.triggerPosthog}', '${IDS.org}', 'completed', '$deadclick',
   '{"event": "$deadclick"}'::jsonb,
   ${j({
			title: 'Dead click on disabled "Export" button',
			posthog: {
				event: "$deadclick",
				distinctId: "user-44ae71",
				eventUrl: "https://app.example.com/dashboard/analytics",
				timestamp: "2025-02-06T02:30:55Z",
				properties: {
					$current_url: "https://app.example.com/dashboard/analytics",
					$element_tag: "button",
					$element_text: "Export CSV",
					$element_classes: ["btn-outline", "opacity-50"],
				},
				person: {
					name: "Maria Santos",
					url: "https://app.posthog.com/person/user-44ae71",
				},
			},
			llm_analysis_result: {
				severity: "medium",
				summary:
					"Users are clicking a visually disabled Export button. The button uses opacity to indicate disabled state but has no disabled attribute or tooltip explaining why it's unavailable.",
				rootCause:
					"Export button is styled as disabled (opacity-50) but not actually disabled. Missing disabled prop and missing tooltip with reason.",
				recommendedActions: [
					"Add disabled attribute to button",
					"Add tooltip explaining export prerequisites",
				],
			},
		})},
   'ph-deadclick-002', ${ago(0.5)}),

  -- PH6: Rage click on mobile nav — queued
  ('${IDS.evtPh6}', '${IDS.triggerPosthog}', '${IDS.org}', 'queued', '$rageclick',
   '{"event": "$rageclick"}'::jsonb,
   ${j({
			title: "Rage click on mobile nav hamburger",
			posthog: {
				event: "$rageclick",
				distinctId: "user-55bc82",
				eventUrl: "https://app.example.com/dashboard",
				timestamp: "2025-02-06T03:12:08Z",
				properties: {
					$current_url: "https://app.example.com/dashboard",
					$element_tag: "button",
					$element_text: "",
					$element_classes: ["hamburger-menu", "md:hidden"],
					$rage_click_count: 5,
					$device_type: "Mobile",
				},
				person: {
					name: "Anonymous",
					url: "https://app.posthog.com/person/user-55bc82",
				},
			},
		})},
   'ph-rageclick-003', ${ago(0.1)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Trigger Events — Sentry
-- =============================================

INSERT INTO trigger_events (id, trigger_id, organization_id, status, provider_event_type, raw_payload, parsed_context, dedup_key, created_at)
VALUES
  -- SE1: TypeError Cannot read map — succeeded
  ('${IDS.evtSe1}', '${IDS.triggerSentry}', '${IDS.org}', 'completed', 'error.created',
   '{"action": "created", "data": {"issue": {}}}'::jsonb,
   ${j({
			title: "TypeError: Cannot read properties of undefined (reading 'map')",
			sentry: {
				errorType: "TypeError",
				errorMessage: "Cannot read properties of undefined (reading 'map')",
				stackTrace:
					"TypeError: Cannot read properties of undefined (reading 'map')\n    at UserList (src/components/UserList.tsx:23:18)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)\n    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)",
				issueUrl: "https://sentry.io/organizations/demo/issues/48291/",
				environment: "production",
				release: "2.4.1",
				projectSlug: "web-app",
			},
			relatedFiles: ["src/components/UserList.tsx"],
			llm_analysis_result: {
				severity: "high",
				summary:
					"UserList component crashes when the API returns an empty response body instead of an empty array. The users prop is undefined when the fetch fails silently.",
				rootCause:
					"The useUsers hook returns undefined during error states instead of an empty array. UserList.tsx:23 calls users.map() without a fallback.",
				recommendedActions: [
					"Add default empty array in useUsers hook",
					"Add optional chaining in UserList",
					"Fix API error handling to return proper empty response",
				],
			},
		})},
   'sentry-48291', ${ago(4)}),

  -- SE2: Unhandled promise rejection — failed
  ('${IDS.evtSe2}', '${IDS.triggerSentry}', '${IDS.org}', 'completed', 'error.created',
   '{"action": "created", "data": {"issue": {}}}'::jsonb,
   ${j({
			title: "Unhandled promise rejection in /api/checkout",
			sentry: {
				errorType: "UnhandledRejection",
				errorMessage: "Unhandled promise rejection: PaymentProcessingError: Card declined",
				stackTrace:
					"PaymentProcessingError: Card declined\n    at processPayment (src/services/payment.ts:89:11)\n    at async handler (src/app/api/checkout/route.ts:34:18)",
				issueUrl: "https://sentry.io/organizations/demo/issues/48305/",
				environment: "production",
				release: "2.4.1",
				projectSlug: "web-app",
			},
			relatedFiles: ["src/services/payment.ts", "src/app/api/checkout/route.ts"],
			llm_analysis_result: {
				severity: "critical",
				summary:
					"The checkout API endpoint has an unhandled promise rejection when payment processing fails. The error is not caught, causing a 500 response instead of a proper error message to the user.",
				rootCause:
					"payment.ts:89 throws PaymentProcessingError but the checkout route handler at line 34 doesn't have a try/catch around the processPayment call.",
				recommendedActions: [
					"Add try/catch in checkout route handler",
					"Return proper 402 response for declined cards",
					"Add error boundary for payment flow",
					"Alert on-call engineer",
				],
			},
		})},
   'sentry-48305', ${ago(7)}),

  -- SE3: RangeError stack overflow — succeeded
  ('${IDS.evtSe3}', '${IDS.triggerSentry}', '${IDS.org}', 'completed', 'error.created',
   '{"action": "created", "data": {"issue": {}}}'::jsonb,
   ${j({
			title: "RangeError: Maximum call stack size exceeded",
			sentry: {
				errorType: "RangeError",
				errorMessage: "Maximum call stack size exceeded",
				stackTrace:
					"RangeError: Maximum call stack size exceeded\n    at deepClone (src/utils/clone.ts:12:10)\n    at deepClone (src/utils/clone.ts:15:12)\n    at deepClone (src/utils/clone.ts:15:12)\n    at deepClone (src/utils/clone.ts:15:12)",
				issueUrl: "https://sentry.io/organizations/demo/issues/48287/",
				environment: "production",
				release: "2.4.0",
				projectSlug: "web-app",
			},
			relatedFiles: ["src/utils/clone.ts"],
			llm_analysis_result: {
				severity: "medium",
				summary:
					"Infinite recursion in deepClone utility when encountering circular references. Triggered when cloning user preferences that contain self-referencing objects.",
				rootCause:
					"deepClone in clone.ts has no circular reference detection. When user preferences contain circular refs (from a data migration bug), it recurses infinitely.",
				recommendedActions: [
					"Add circular reference detection using WeakSet",
					"Replace custom deepClone with structuredClone",
					"Fix data migration that creates circular refs",
				],
			},
		})},
   'sentry-48287', ${ago(16)}),

  -- SE4: CORS error — needs_human
  ('${IDS.evtSe4}', '${IDS.triggerSentry}', '${IDS.org}', 'completed', 'error.created',
   '{"action": "created", "data": {"issue": {}}}'::jsonb,
   ${j({
			title: "CORS policy error on /api/analytics",
			sentry: {
				errorType: "NetworkError",
				errorMessage:
					"Access to XMLHttpRequest at '/api/analytics' from origin 'https://app.example.com' has been blocked by CORS policy",
				issueUrl: "https://sentry.io/organizations/demo/issues/48312/",
				environment: "production",
				release: "2.4.1",
				projectSlug: "web-app",
			},
			relatedFiles: ["src/middleware.ts", "next.config.js"],
			llm_analysis_result: {
				severity: "high",
				summary:
					"CORS error blocking analytics API calls after the recent middleware refactor. The new middleware overwrites the CORS headers set by Next.js config.",
				rootCause:
					"middleware.ts sets custom headers that overwrite the Access-Control-Allow-Origin header. The analytics endpoint needs to allow requests from the app subdomain.",
				recommendedActions: [
					"Review middleware header logic",
					"Preserve CORS headers in middleware chain",
					"Needs infra team review for CDN-level CORS config",
				],
			},
		})},
   'sentry-48312', ${ago(2)}),

  -- SE5: Redis timeout — timed_out
  ('${IDS.evtSe5}', '${IDS.triggerSentry}', '${IDS.org}', 'completed', 'error.created',
   '{"action": "created", "data": {"issue": {}}}'::jsonb,
   ${j({
			title: "Connection timeout to Redis",
			sentry: {
				errorType: "ConnectionError",
				errorMessage: "Redis connection timed out after 5000ms",
				stackTrace:
					"ConnectionError: Redis connection timed out after 5000ms\n    at RedisClient.connect (node_modules/ioredis/built/Redis.js:185:23)\n    at async getSession (src/lib/session.ts:14:18)\n    at async handler (src/app/api/auth/session/route.ts:8:20)",
				issueUrl: "https://sentry.io/organizations/demo/issues/48298/",
				environment: "production",
				release: "2.4.1",
				projectSlug: "web-app",
			},
			relatedFiles: ["src/lib/session.ts"],
			llm_analysis_result: {
				severity: "critical",
				summary:
					"Redis connection timeouts are causing auth session lookups to fail, breaking authentication for all users. This is an infrastructure issue, not a code bug.",
				rootCause:
					"Redis cluster in us-east-1 is experiencing high latency. Connection pool is exhausted due to missing connection reuse in the session handler.",
				recommendedActions: [
					"Check Redis cluster health in AWS console",
					"Implement connection pooling in session.ts",
					"Add circuit breaker for Redis calls",
					"Page infrastructure on-call",
				],
			},
		})},
   'sentry-48298', ${ago(12)}),

  -- SE6: 404 deprecated endpoint — skipped
  ('${IDS.evtSe6}', '${IDS.triggerSentry}', '${IDS.org}', 'skipped', 'error.created',
   '{"action": "created", "data": {"issue": {}}}'::jsonb,
   ${j({
			title: "404 on deprecated /api/v1/users endpoint",
			sentry: {
				errorType: "NotFoundError",
				errorMessage: "GET /api/v1/users - 404 Not Found",
				issueUrl: "https://sentry.io/organizations/demo/issues/48320/",
				environment: "production",
				release: "2.4.1",
				projectSlug: "web-app",
			},
			llm_analysis_result: {
				severity: "low",
				summary:
					"External clients still hitting the deprecated v1 users endpoint. This was intentionally removed in v2.3.0. The errors are from third-party integrations that haven't migrated.",
				rootCause: "Expected behavior — deprecated endpoint was removed. External clients need to migrate to /api/v2/users.",
				recommendedActions: ["Notify API consumers about deprecation", "Consider adding 301 redirect"],
			},
		})},
   'sentry-48320', ${ago(20)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Trigger Events — Flaky Tests
-- =============================================

INSERT INTO trigger_events (id, trigger_id, organization_id, status, provider_event_type, raw_payload, parsed_context, dedup_key, created_at)
VALUES
  -- FL1: 3 flaky tests in PR #412 — succeeded
  ('${IDS.evtFl1}', '${IDS.triggerFlaky}', '${IDS.org}', 'completed', 'check_suite.completed',
   '{"action": "completed"}'::jsonb,
   ${j({
			title: "3 flaky tests detected in PR #412: refactor auth middleware",
			github: {
				eventType: "check_suite",
				action: "completed",
				repoFullName: "proliferate-ai/web-app",
				repoUrl: "https://github.com/proliferate-ai/web-app",
				prNumber: 412,
				prTitle: "refactor auth middleware",
				prUrl: "https://github.com/proliferate-ai/web-app/pull/412",
				headBranch: "refactor/auth-middleware",
				baseBranch: "main",
				checkName: "CI / Tests",
				conclusion: "success",
			},
			relatedFiles: [
				"src/middleware/__tests__/auth.test.ts",
				"src/middleware/__tests__/session.test.ts",
			],
			llm_analysis_result: {
				severity: "medium",
				summary:
					"3 tests in the auth middleware test suite are timing-dependent. They rely on setTimeout for token expiry checks and fail intermittently under CI load.",
				rootCause:
					"Tests use real timers (setTimeout) for token expiry validation. Under CI load, the 100ms timeout margin is too tight.",
				recommendedActions: [
					"Replace setTimeout with jest.useFakeTimers()",
					"Increase timeout margins to 500ms",
					"Add retry annotation for known flaky tests",
				],
			},
		})},
   'gh-check-412', ${ago(5)}),

  -- FL2: 7 flaky tests in PR #398 — needs_human
  ('${IDS.evtFl2}', '${IDS.triggerFlaky}', '${IDS.org}', 'completed', 'check_suite.completed',
   '{"action": "completed"}'::jsonb,
   ${j({
			title: "7 flaky tests detected in PR #398: migrate to new ORM",
			github: {
				eventType: "check_suite",
				action: "completed",
				repoFullName: "proliferate-ai/web-app",
				repoUrl: "https://github.com/proliferate-ai/web-app",
				prNumber: 398,
				prTitle: "migrate to new ORM",
				prUrl: "https://github.com/proliferate-ai/web-app/pull/398",
				headBranch: "feat/drizzle-migration",
				baseBranch: "main",
				checkName: "CI / Tests",
				conclusion: "success",
			},
			relatedFiles: [
				"src/db/__tests__/users.test.ts",
				"src/db/__tests__/orders.test.ts",
				"src/db/__tests__/transactions.test.ts",
			],
			llm_analysis_result: {
				severity: "high",
				summary:
					"7 database integration tests are failing intermittently. The tests share a database connection pool and don't properly isolate transactions, causing test pollution.",
				rootCause:
					"Tests run in parallel and share the same database. Missing transaction rollbacks in afterEach hooks cause data from one test to leak into another.",
				recommendedActions: [
					"Wrap each test in a transaction with rollback",
					"Use separate test databases per worker",
					"Add database cleanup in afterEach hooks",
					"Requires developer review of test architecture",
				],
			},
		})},
   'gh-check-398', ${ago(10)}),

  -- FL3: 1 flaky test in PR #421 — succeeded
  ('${IDS.evtFl3}', '${IDS.triggerFlaky}', '${IDS.org}', 'completed', 'check_suite.completed',
   '{"action": "completed"}'::jsonb,
   ${j({
			title: "1 flaky test in PR #421: update deps",
			github: {
				eventType: "check_suite",
				action: "completed",
				repoFullName: "proliferate-ai/web-app",
				repoUrl: "https://github.com/proliferate-ai/web-app",
				prNumber: 421,
				prTitle: "update deps",
				prUrl: "https://github.com/proliferate-ai/web-app/pull/421",
				headBranch: "chore/update-deps",
				baseBranch: "main",
				checkName: "CI / Tests",
				conclusion: "success",
			},
			relatedFiles: ["src/utils/__tests__/date.test.ts"],
			llm_analysis_result: {
				severity: "low",
				summary:
					"One date formatting test fails at midnight UTC due to timezone edge case. The test compares formatted dates using the system timezone.",
				rootCause:
					"date.test.ts:45 uses new Date() without mocking, causing the expected output to vary around midnight UTC.",
				recommendedActions: [
					"Mock Date.now() in test setup",
					"Use fixed dates for formatting tests",
				],
			},
		})},
   'gh-check-421', ${ago(14)}),

  -- FL4: 12 flaky tests in PR #385 — running
  ('${IDS.evtFl4}', '${IDS.triggerFlaky}', '${IDS.org}', 'completed', 'check_suite.completed',
   '{"action": "completed"}'::jsonb,
   ${j({
			title: "12 flaky tests in PR #385: redesign dashboard",
			github: {
				eventType: "check_suite",
				action: "completed",
				repoFullName: "proliferate-ai/web-app",
				repoUrl: "https://github.com/proliferate-ai/web-app",
				prNumber: 385,
				prTitle: "redesign dashboard",
				prUrl: "https://github.com/proliferate-ai/web-app/pull/385",
				headBranch: "feat/dashboard-v2",
				baseBranch: "main",
				checkName: "CI / Tests",
				conclusion: "success",
			},
			relatedFiles: [
				"src/components/__tests__/Dashboard.test.tsx",
				"src/components/__tests__/Chart.test.tsx",
				"src/components/__tests__/Table.test.tsx",
				"e2e/dashboard.spec.ts",
			],
			llm_analysis_result: {
				severity: "critical",
				summary:
					"12 tests across component and E2E suites are flaky. The dashboard redesign introduced async data loading that the tests don't properly wait for.",
				rootCause:
					"Component tests use synchronous rendering assertions but the new dashboard fetches data with React Query. waitFor timeouts are too short for CI.",
				recommendedActions: [
					"Add proper waitFor blocks with extended timeouts",
					"Mock React Query in unit tests",
					"Use Playwright auto-waiting in E2E tests",
					"Consider splitting into smaller PRs",
				],
			},
		})},
   'gh-check-385', ${ago(0.3)}),

  -- FL5: 2 retried tests in PR #419 — succeeded
  ('${IDS.evtFl5}', '${IDS.triggerFlaky}', '${IDS.org}', 'completed', 'check_suite.completed',
   '{"action": "completed"}'::jsonb,
   ${j({
			title: "CI passed but 2 tests were retried in PR #419",
			github: {
				eventType: "check_suite",
				action: "completed",
				repoFullName: "proliferate-ai/web-app",
				repoUrl: "https://github.com/proliferate-ai/web-app",
				prNumber: 419,
				prTitle: "add rate limiting to API",
				prUrl: "https://github.com/proliferate-ai/web-app/pull/419",
				headBranch: "feat/rate-limiting",
				baseBranch: "main",
				checkName: "CI / Tests",
				conclusion: "success",
			},
			relatedFiles: ["src/middleware/__tests__/rate-limit.test.ts"],
			llm_analysis_result: {
				severity: "low",
				summary:
					"2 rate limiting tests passed on retry. The tests check request counts within a time window and are sensitive to CI execution speed.",
				rootCause:
					"Rate limit tests use real timers and tight time windows (100ms). CI runners occasionally exceed the window.",
				recommendedActions: [
					"Use fake timers for rate limit window",
					"Increase time window tolerance in tests",
				],
			},
		})},
   'gh-check-419', ${ago(18)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Automation Runs — PostHog
-- =============================================

INSERT INTO automation_runs (id, organization_id, automation_id, trigger_event_id, trigger_id, status, status_reason, error_message, queued_at, completed_at, created_at, updated_at)
VALUES
  ('${IDS.runPh1}', '${IDS.org}', '${IDS.automationPosthog}', '${IDS.evtPh1}', '${IDS.triggerPosthog}',
   'succeeded', 'Agent fixed the race condition in useAddToCart hook and opened PR #423', NULL,
   ${ago(3)}, ${ago(2.5)}, ${ago(3)}, ${ago(2.5)}),

  ('${IDS.runPh2}', '${IDS.org}', '${IDS.automationPosthog}', '${IDS.evtPh2}', '${IDS.triggerPosthog}',
   'succeeded', 'Agent moved onClick handler to parent div and added ARIA role', NULL,
   ${ago(8)}, ${ago(7.5)}, ${ago(8)}, ${ago(7.5)}),

  ('${IDS.runPh3}', '${IDS.org}', '${IDS.automationPosthog}', '${IDS.evtPh3}', '${IDS.triggerPosthog}',
   'needs_human', 'Requires UX review — multiple form validation issues across signup flow', NULL,
   ${ago(1)}, NULL, ${ago(1)}, ${ago(0.8)}),

  ('${IDS.runPh4}', '${IDS.org}', '${IDS.automationPosthog}', '${IDS.evtPh4}', '${IDS.triggerPosthog}',
   'failed', NULL, 'Agent could not reproduce the error — payment sandbox credentials expired',
   ${ago(6)}, ${ago(5.5)}, ${ago(6)}, ${ago(5.5)}),

  ('${IDS.runPh5}', '${IDS.org}', '${IDS.automationPosthog}', '${IDS.evtPh5}', '${IDS.triggerPosthog}',
   'running', NULL, NULL,
   ${ago(0.5)}, NULL, ${ago(0.5)}, ${ago(0.3)}),

  ('${IDS.runPh6}', '${IDS.org}', '${IDS.automationPosthog}', '${IDS.evtPh6}', '${IDS.triggerPosthog}',
   'queued', NULL, NULL,
   ${ago(0.1)}, NULL, ${ago(0.1)}, ${ago(0.1)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Automation Runs — Sentry
-- =============================================

INSERT INTO automation_runs (id, organization_id, automation_id, trigger_event_id, trigger_id, status, status_reason, error_message, queued_at, completed_at, created_at, updated_at)
VALUES
  ('${IDS.runSe1}', '${IDS.org}', '${IDS.automationSentry}', '${IDS.evtSe1}', '${IDS.triggerSentry}',
   'succeeded', 'Added optional chaining and default empty array in useUsers hook — PR #425', NULL,
   ${ago(4)}, ${ago(3.5)}, ${ago(4)}, ${ago(3.5)}),

  ('${IDS.runSe2}', '${IDS.org}', '${IDS.automationSentry}', '${IDS.evtSe2}', '${IDS.triggerSentry}',
   'failed', NULL, 'Session sandbox timed out before agent could finish debugging the payment service',
   ${ago(7)}, ${ago(6)}, ${ago(7)}, ${ago(6)}),

  ('${IDS.runSe3}', '${IDS.org}', '${IDS.automationSentry}', '${IDS.evtSe3}', '${IDS.triggerSentry}',
   'succeeded', 'Replaced custom deepClone with structuredClone — PR #420', NULL,
   ${ago(16)}, ${ago(15.5)}, ${ago(16)}, ${ago(15.5)}),

  ('${IDS.runSe4}', '${IDS.org}', '${IDS.automationSentry}', '${IDS.evtSe4}', '${IDS.triggerSentry}',
   'needs_human', 'CORS configuration requires infrastructure team review — agent cannot modify CDN config', NULL,
   ${ago(2)}, NULL, ${ago(2)}, ${ago(1.5)}),

  ('${IDS.runSe5}', '${IDS.org}', '${IDS.automationSentry}', '${IDS.evtSe5}', '${IDS.triggerSentry}',
   'timed_out', 'Agent session exceeded 30-minute deadline while investigating Redis cluster', 'Deadline exceeded: 30 minutes',
   ${ago(12)}, ${ago(11.5)}, ${ago(12)}, ${ago(11.5)}),

  ('${IDS.runSe6}', '${IDS.org}', '${IDS.automationSentry}', '${IDS.evtSe6}', '${IDS.triggerSentry}',
   'skipped', 'Event filtered — deprecated endpoint, known issue', NULL,
   ${ago(20)}, ${ago(20)}, ${ago(20)}, ${ago(20)})
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Automation Runs — Flaky Tests
-- =============================================

INSERT INTO automation_runs (id, organization_id, automation_id, trigger_event_id, trigger_id, status, status_reason, error_message, queued_at, completed_at, created_at, updated_at)
VALUES
  ('${IDS.runFl1}', '${IDS.org}', '${IDS.automationFlaky}', '${IDS.evtFl1}', '${IDS.triggerFlaky}',
   'succeeded', 'Replaced real timers with jest.useFakeTimers() in 3 auth tests — PR #424', NULL,
   ${ago(5)}, ${ago(4.5)}, ${ago(5)}, ${ago(4.5)}),

  ('${IDS.runFl2}', '${IDS.org}', '${IDS.automationFlaky}', '${IDS.evtFl2}', '${IDS.triggerFlaky}',
   'needs_human', 'Test architecture needs redesign — too many shared database fixtures across 7 test files', NULL,
   ${ago(10)}, NULL, ${ago(10)}, ${ago(9)}),

  ('${IDS.runFl3}', '${IDS.org}', '${IDS.automationFlaky}', '${IDS.evtFl3}', '${IDS.triggerFlaky}',
   'succeeded', 'Mocked Date.now() in date formatting test — PR #422', NULL,
   ${ago(14)}, ${ago(13.8)}, ${ago(14)}, ${ago(13.8)}),

  ('${IDS.runFl4}', '${IDS.org}', '${IDS.automationFlaky}', '${IDS.evtFl4}', '${IDS.triggerFlaky}',
   'running', NULL, NULL,
   ${ago(0.3)}, NULL, ${ago(0.3)}, ${ago(0.1)}),

  ('${IDS.runFl5}', '${IDS.org}', '${IDS.automationFlaky}', '${IDS.evtFl5}', '${IDS.triggerFlaky}',
   'succeeded', 'Replaced real timers with fake timers in rate limit tests — PR #426', NULL,
   ${ago(18)}, ${ago(17.5)}, ${ago(18)}, ${ago(17.5)})
ON CONFLICT (id) DO NOTHING;

COMMIT;
`;

// ============================================
// CLEANUP SQL
// ============================================

const CLEANUP_SQL = `
BEGIN;

-- Runs
DELETE FROM automation_runs WHERE id LIKE 'd0000000-0000-0000-0006-%' OR id LIKE 'd0000000-0000-0000-0007-%' OR id LIKE 'd0000000-0000-0000-0008-%';

-- Events
DELETE FROM trigger_events WHERE id LIKE 'd0000000-0000-0000-0003-%' OR id LIKE 'd0000000-0000-0000-0004-%' OR id LIKE 'd0000000-0000-0000-0005-%';

-- Triggers
DELETE FROM triggers WHERE id LIKE 'd0000000-0000-0000-0002-%';

-- Automations
DELETE FROM automations WHERE id LIKE 'd0000000-0000-0000-0001-%';

-- Foundation
DELETE FROM member WHERE id = 'demo-member-001';
DELETE FROM organization WHERE id = 'demo-org-001';
DELETE FROM "user" WHERE id = 'demo-user-001';

COMMIT;
`;

// ============================================
// Runner
// ============================================

async function main() {
	const isCleanup = process.argv.includes("--cleanup");
	const client = new pg.Client(DB_URL);

	try {
		await client.connect();
		if (isCleanup) {
			console.log("Cleaning up demo data...");
			await client.query(CLEANUP_SQL);
			console.log("Done — demo data removed.");
		} else {
			console.log("Seeding demo data...");
			await client.query(SEED_SQL);
			console.log("Done — demo data seeded.");
			console.log("\nSeeded:");
			console.log("  - 1 user, 1 org, 1 member");
			console.log("  - 3 automations (PostHog, Sentry, Flaky Tests)");
			console.log("  - 3 triggers");
			console.log("  - 17 trigger events");
			console.log("  - 17 automation runs");
			console.log(`\nOrg ID: ${IDS.org}`);
			console.log(`Automation IDs:`);
			console.log(`  PostHog:     ${IDS.automationPosthog}`);
			console.log(`  Sentry:      ${IDS.automationSentry}`);
			console.log(`  Flaky Tests: ${IDS.automationFlaky}`);
		}
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
