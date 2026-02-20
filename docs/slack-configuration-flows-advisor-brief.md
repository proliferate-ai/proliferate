# Slack Configuration + Notification Flows Deep Dive (Advisor Brief)

Date: 2026-02-19  
Audience: External technical advisor (no repo access)  
Companion UX doc: `docs/slack-notifications-ux-north-star.md`

## 1) Scope and problem statement

We need one coherent design for two parallel concerns:

1. Configuration selection strategy (`fixed config` vs `let agent decide`) in two entry points.
2. Slack notification routing in two entry points.

Entry points in scope:
- Slack `@Proliferate` thread flow
- Automation runs
- Session list UX for user opt-in notifications
- Integrations page UX for Slack defaults

Product requirement from stakeholder:
- `let agent decide` should be available where configuration is selected.
- `let agent decide` must **not** create managed configurations dynamically.
- DM destination should be selectable via Slack member dropdown (not free-text user ID).
- Notifications should be descriptive, correctly linked, and robust/idempotent.

## 2) End-state UX target (short form)

North-star behavior:
- Automations editor: choose destination (`DM user`, `channel`, `off`) and which state transitions notify.
- Sessions list: three-dots action `Send me notifications` subscribes owner and DMs on completion.
- Slack-initiated sessions keep streaming in-thread; web UI clearly marks Slack origin and shows Slack thread deep-link.
- Integrations page (Slack): set default configuration strategy for Slack-originated sessions (`fixed` or `let agent decide`).
- Consistent strategy semantics across surfaces, high reliability, and high code quality.

## 3) Current behavior in code (evidence)

### 3.1 Slack `@Proliferate` flow

Ingress route accepts `app_mention` and certain thread replies:

```ts
// apps/web/src/app/api/slack/events/route.ts:104-151
// Only process app_mention and message events
if (!event || (event.type !== "app_mention" && event.type !== "message")) {
	return new Response("OK");
}

// Find installation by team_id
const installation = await integrations.findSlackInstallationByTeamId(team_id);

// For message events, only continue if thread already mapped to a session
if (event.type === "message") {
	if (!event.thread_ts) return new Response("OK");
	const existingSession = await integrations.findSlackSessionByThread(
		installation.id,
		event.channel,
		event.thread_ts,
	);
	if (!existingSession) return new Response("OK");
}
```

Worker creates/reuses session by Slack thread metadata:

```ts
// apps/worker/src/slack/client.ts:157-183
const existingSession = await sessions.findSessionBySlackThread(
	installationId,
	channelId,
	threadTs,
);

if (!existingSession) {
	const result = await this.syncClient.createSession({
		organizationId,
		managedConfiguration: {}, // Auto-find/create managed configuration
		sessionType: "coding",
		clientType: "slack",
		clientMetadata: {
			installationId,
			channelId,
			threadTs,
		},
		initialPrompt: content,
	});
}
```

Receiver currently stops on `message_complete` with no explicit terminal marker:

```ts
// apps/worker/src/slack/client.ts:327-329
case "message_complete":
	this.logger.info("Message complete");
	return "stop";
```

### 3.2 Slack↔session linkage model in runtime

Runtime lookup is currently JSON metadata on `sessions`, not `slack_conversations` table:

```ts
// packages/services/src/sessions/db.ts:504-516
export async function findBySlackThread(installationId: string, channelId: string, threadTs: string) {
	const result = await db.query.sessions.findFirst({
		where: and(
			eq(sessions.clientType, "slack"),
			sql`${sessions.clientMetadata}->>'installationId' = ${installationId}`,
			sql`${sessions.clientMetadata}->>'channelId' = ${channelId}`,
			sql`${sessions.clientMetadata}->>'threadTs' = ${threadTs}`,
		),
	});
}
```

There is a physical index backing this metadata lookup:

```ts
// packages/db/src/schema/schema.ts:1399-1406
index("idx_sessions_slack_lookup")
	.using(
		"btree",
		sql`((client_metadata ->> 'installationId'::text))`,
		sql`((client_metadata ->> 'channelId'::text))`,
		sql`((client_metadata ->> 'threadTs'::text))`,
	)
	.where(sql`(client_type = 'slack'::text)`)
```

`slack_conversations` exists in schema but is not the active routing path:

```ts
// packages/db/src/schema/slack.ts:73-87
export const slackConversations = pgTable("slack_conversations", {
	id: uuid("id").primaryKey().defaultRandom(),
	slackInstallationId: uuid("slack_installation_id").notNull(),
	channelId: text("channel_id").notNull(),
	threadTs: text("thread_ts").notNull(),
	sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
	repoId: uuid("repo_id").references(() => repos.id),
});
```

### 3.3 Automation notification flow

Automations notification dispatch is implemented and terminal-state based:

```ts
// apps/worker/src/automation/notifications.ts:211-214
const channelId = resolveNotificationChannelId(
	run.automation?.notificationChannelId,
	run.automation?.enabledTools,
);
```

Fallback behavior still exists:

```ts
// apps/worker/src/automation/notifications.ts:175-191
// Prefers dedicated column, falls back to enabled_tools.slack_notify.channelId
if (notificationChannelId) return notificationChannelId;
...
if (config.enabled && typeof config.channelId === "string" && config.channelId) {
	return config.channelId;
}
```

Outbox dispatch includes terminal run notifications:

```ts
// apps/worker/src/automation/index.ts:356-368
switch (item.kind) {
	case "notify_run_terminal":
		await dispatchRunNotification(runId, logger);
		break;
}
```

### 3.4 Automation configuration selection flow

Selection logic currently uses `allowAgenticRepoSelection` + `suggestedRepoId`.

```ts
// apps/worker/src/automation/resolve-target.ts:29-76
if (!automation?.allowAgenticRepoSelection) {
	return { type: "default", configurationId: defaultConfigurationId, reason: "selection_disabled" };
}

const suggestedRepoId = extractSuggestedRepoId(enrichmentJson);
if (!suggestedRepoId) {
	return { type: "default", configurationId: defaultConfigurationId, reason: "no_suggestion" };
}

const existingConfigurationId = await findManagedConfigurationForRepo(suggestedRepoId, organizationId);
if (existingConfigurationId) {
	return { type: "selected", configurationId: existingConfigurationId, reason: "enrichment_suggestion_reused" };
}

return {
	type: "selected",
	repoIds: [suggestedRepoId],
	reason: "enrichment_suggestion_new",
};
```

Important: this can lead to new managed configuration creation downstream:

```ts
// apps/worker/src/automation/index.ts:263-267
if (target.type === "selected" && target.repoIds) {
	sessionRequest.managedConfiguration = { repoIds: target.repoIds };
} else {
	sessionRequest.configurationId = target.configurationId;
}
```

### 3.5 But trigger providers currently do not populate `suggestedRepoId`

Type supports it:

```ts
// packages/triggers/src/types.ts:9-14
export interface ParsedEventContext {
	title: string;
	description?: string;
	relatedFiles?: string[];
	suggestedRepoId?: string;
}
```

Provider parse functions shown below do not set it:

```ts
// packages/triggers/src/github.ts:105-110
parseContext(item: GitHubItem): ParsedEventContext {
	const baseContext: ParsedEventContext = {
		title: item.title || `GitHub ${item.eventType}: ${item.action || "event"}`,
		description: item.body,
		relatedFiles: item.relatedFiles,
```

```ts
// packages/triggers/src/linear.ts:197-203
parseContext(item: LinearIssue): ParsedEventContext {
	return {
		title: `Linear Issue: ${item.title || "Untitled"}`,
		description: item.description,
		linear: {
```

```ts
// packages/triggers/src/sentry.ts:138-143
return {
	title: issue.title || event?.title || "Sentry Error",
	description: issue.culprit,
	relatedFiles: [...new Set(relatedFiles)],
	sentry: {
```

Net effect: in many real paths, auto repo selection likely falls back to default config.

### 3.6 Automation editor UI today

There is a configuration selector, but no visible `allowAgenticRepoSelection` control in this page:

```ts
// apps/web/src/app/(command-center)/dashboard/automations/[id]/page.tsx:532-539
<span className="text-sm text-muted-foreground">Configuration</span>
<ConfigurationSelector
	configurations={readyConfigurations}
	selectedId={automation.default_configuration_id}
	onChange={handleConfigurationChange}
/>
```

Slack notification destination UI is currently free-form channel ID and optional workspace selector:

```ts
// apps/web/src/components/automations/integration-permissions.tsx:267-296
<Select value={notificationSlackInstallationId ?? "auto"} ...>
	<SelectItem value="auto">Auto-detect</SelectItem>
	{slackInstallations.map((inst) => (
		<SelectItem key={inst.id} value={inst.id}>{inst.team_name ?? inst.team_id}</SelectItem>
	))}
</Select>

<Label className="text-xs text-muted-foreground">Channel ID</Label>
<Input
	value={enabledTools.slack_notify?.channelId || ""}
	onChange={(e) => onToolConfigChange("slack_notify", "channelId", e.target.value)}
	placeholder="C01234567890"
/>
```

### 3.7 Sessions list actions today

Action menu supports extension via `customActions`:

```ts
// apps/web/src/components/ui/item-actions-menu.tsx:20-25
interface ItemActionsMenuProps {
	onRename?: () => void;
	onDelete?: () => void;
	onDuplicate?: () => void;
	customActions?: CustomAction[];
}
```

Session rows currently wire rename/delete and optional custom snapshot actions, so `Send me notifications` can be added cleanly.

### 3.8 Session API shape today lacks Slack thread deep-link data

`Session` contract includes `clientType` but not Slack thread metadata:

```ts
// packages/shared/src/contracts/sessions.ts:40-42
origin: z.string().nullable(),
clientType: z.string().nullable(),
automationId: z.string().uuid().nullable().optional(),
```

Mapper also exposes `clientType` only, not `clientMetadata`:

```ts
// packages/services/src/sessions/mapper.ts:58-60
origin: row.origin,
clientType: row.clientType,
automationId: row.automationId ?? null,
```

### 3.9 Slack installation lookup and potential ambiguity

Slack event ingress resolves installation by `teamId` only:

```ts
// packages/services/src/integrations/db.ts:852-858
const result = await db.query.slackInstallations.findFirst({
	where: and(eq(slackInstallations.teamId, teamId), eq(slackInstallations.status, "active")),
});
```

Installations are unique on `(organization_id, team_id)`:

```ts
// packages/db/src/schema/slack.ts:50-53
unique("slack_installations_organization_id_team_id_key").on(
	table.organizationId,
	table.teamId,
)
```

So team-only lookup may become ambiguous if same Slack workspace is installed into multiple orgs.

## 4) Gaps vs UX target

1. No per-session notification subscription model.
2. No DM-user picker endpoint/UX for session notifications.
3. No unified destination model (`dm_user` vs `channel`) in automation editor.
4. Current automation UI stores channel ID under `enabled_tools.slack_notify.channelId` legacy path.
5. Slack flow always uses `managedConfiguration: {}` path today; no configurable strategy in integrations page.
6. Automation `let agent decide` path can create managed configurations (explicitly disallowed by stakeholder).
7. Auto-decision today relies on `suggestedRepoId` that providers currently do not populate.
8. Session list UI cannot display Slack thread deep-link because thread metadata is not exposed in contract.
9. Slack send paths are fragmented (`apps/worker/src/slack/api.ts`, `apps/worker/src/slack/lib.ts`, `apps/worker/src/automation/notifications.ts`).

## 5) Proposed unified model

## 5.1 Shared strategy object

Introduce one explicit strategy model and use it in both Slack and automations:

- `strategy = fixed`
- `strategy = agent_decide`

Common rules:
- `fallbackConfigurationId` is always required.
- `agent_decide` can only choose from existing allowed configurations.
- `agent_decide` never creates new managed configuration.

## 5.2 Product surface mapping

Slack (integrations page):
- `Slack default session strategy`: fixed or agent_decide.
- If fixed: choose default configuration.
- If agent_decide: choose fallback configuration + optional allowed set.

Automations (automation editor):
- `Run configuration strategy`: fixed or agent_decide.
- If fixed: existing configuration selector.
- If agent_decide: fallback config + optional allowed set.

## 5.3 Auto-decision design (LLM-based, bounded)

Requirement from stakeholder: use LLM for the decision tree when `agent_decide` is set.

Recommended algorithm:

1. Build candidate set from allowed configuration IDs (or all ready configs if no explicit allowlist).
2. Build candidate metadata context for each configuration:
- configuration name
- repos in configuration (`org/repo`)
- precomputed repo summary (README summary, domains, key paths)
3. Build decision context:
- Slack flow: user message + recent thread context (bounded)
- Automation flow: trigger `parsedContext` + event title/description + provider context
4. Call selector model with strict JSON schema output:
- `{ configurationId, confidence, rationale, matchedSignals[] }`
5. Validate output:
- selected ID must be in candidate set
- confidence threshold check
- if invalid/low confidence, use fallback configuration
6. Persist decision trace into session/run metadata for observability.

Suggested output schema:

```json
{
  "configurationId": "uuid",
  "confidence": 0.0,
  "rationale": "short text",
  "matchedSignals": ["repo_name_match", "domain_match", "file_path_match"]
}
```

## 5.4 Repo metadata for LLM decision context

Stakeholder suggestion is aligned with this plan: store useful repo metadata at config creation/build time and pass it to the selector LLM.

Recommended metadata payload per repo:
- `repoFullName`
- `readmeSummary` (short)
- `dominantLanguages`
- `topLevelDirs`
- `keywords/topics`
- `lastIndexedAt`

This keeps runtime decision calls cheap and consistent.

## 5.5 Session notifications architecture

Add a subscription model:
- New table: `session_notification_subscriptions`
- Key fields:
  - `sessionId`, `userId`, `slackInstallationId`
  - `destinationType` (`dm_user` | `channel`)
  - `slackUserId` nullable
  - `slackChannelId` nullable
  - `eventTypes` (`message_complete` initially)
  - `createdAt`, `updatedAt`

UI:
- Add `Send me notifications` action in session row three-dots menu.
- For first version, this always creates a DM subscription for current user.

Event source:
- Today Redis pubsub for async clients only publishes `user_message`.
- Extend shared event type with assistant completion event and publish from gateway when message completes.

Current publish point:

```ts
// apps/gateway/src/hub/session-hub.ts:1029-1039
if (context.session.client_type) {
	const event: SessionEventMessage = {
		type: "user_message",
		sessionId: this.sessionId,
		source: options?.source || "web",
		timestamp: Date.now(),
		content,
		userId,
	};
	publishSessionEvent(event)
}
```

Current completion point:

```ts
// apps/gateway/src/hub/event-processor.ts:390-403
private completeCurrentMessage(): void {
	...
	this.callbacks.broadcast({
		type: "message_complete",
		payload: { messageId: this.currentAssistantMessageId },
	});
}
```

Recommended:
- publish a Redis `assistant_message_complete` event at completion.
- worker notification dispatcher listens and sends subscribed notifications.

## 5.6 Automation notifications destination model

Replace legacy channel-only path with explicit destination fields:

- `notificationDestinationType`: `slack_dm_user` | `slack_channel` | `none`
- `notificationSlackUserId` (for DM)
- `notificationChannelId` (for channel)
- `notificationSlackInstallationId`
- `notificationEvents` (array of run statuses)

Keep temporary backward compatibility:
- read legacy `enabled_tools.slack_notify.channelId` only during migration.
- write only new canonical columns from updated UI.

## 6) Slack API and scope implications

Existing app scopes configured today:

```ts
// apps/web/src/lib/slack.ts:304-317
export const SLACK_BOT_SCOPES = [
	"app_mentions:read",
	"chat:write",
	"chat:write.public",
	"channels:history",
	"groups:history",
	"im:history",
	"mpim:history",
	"channels:read",
	"groups:read",
	"users:read",
	"users:read.email",
	"files:write",
].join(",");
```

Relevant methods and docs checked:
- `chat.postMessage` (post final notifications): [Slack docs](https://docs.slack.dev/reference/methods/chat.postMessage/) and API facts show `chat:write`.
- `conversations.open` (open/resume DM channel): [Slack docs](https://docs.slack.dev/reference/methods/conversations.open/). Context7 OpenAPI indicates `conversations:write`.
- `conversations.list` (channel picker): [Slack docs](https://docs.slack.dev/reference/methods/conversations.list/). Context7 indicates `conversations:read`.
- `users.lookupByEmail` (already used): requires `users:read.email` (confirmed in Context7 and in existing code usage).
- `users.list` (member dropdown source): [Slack API method](https://api.slack.com/methods/users.list) (for workspace member enumeration).

Practical scope change likely needed for this project:
- add `conversations:write` for DM opening
- add `conversations:read` for robust channel listing APIs

## 7) Decision quality and reliability requirements

`agent_decide` quality requirements:
- strict output schema parsing
- deterministic fallback path
- telemetry for decision confidence, fallback reason, selected config
- replay-safe idempotency key per run/session message turn

Notification reliability requirements:
- dedupe key per `(entityId, eventType, destination)`
- retry transient Slack errors with bounded backoff
- explicit terminal handling for permanent errors (`channel_not_found`, `user_not_found`, revoked install)
- central Slack send module for retry/timeout/serialization consistency

## 8) Recommended phased rollout

Phase 1: Contract + data model
- Add canonical automation destination fields and event selection fields.
- Add Slack installation default strategy fields for Slack-initiated sessions.
- Add session notification subscription table.

Phase 2: API + UI
- Automation editor: destination type selector, member dropdown, channel selector.
- Session row menu: `Send me notifications`.
- Integrations page: Slack default config strategy controls.

Phase 3: Runtime behavior
- Implement shared `ConfigurationSelectorService` for both Slack flow and automation flow.
- Enforce `agent_decide` never creates managed config.
- Add assistant completion pubsub event + session notification dispatcher.

Phase 4: Cleanup
- Migrate old `enabled_tools.slack_notify.channelId` values into canonical fields.
- Remove legacy fallback read path once migration is complete.
- Consolidate Slack send code paths.

## 9) Key advisor questions

1. Should candidate configurations for `agent_decide` default to all ready configs or require explicit allowlist?
2. Do we want one selector model prompt for Slack + automation contexts, or two specialized prompts?
3. Is Redis pubsub for completion notifications sufficient, or should this be persisted as durable queue/outbox first?
4. Should Slack thread deep-link data be exposed by extending `Session` contract with safe subset of `clientMetadata`?
5. Should installation lookup for Slack events remain `teamId`-only, or require explicit org disambiguation strategy now?

## 10) Appendix A: Full file snapshot (`apps/worker/src/automation/resolve-target.ts`)

```ts
/**
 * Target resolution for automation runs.
 *
 * Determines which configuration/repo to use for session creation
 * based on enrichment output and automation configuration.
 */

import { configurations, repos } from "@proliferate/services";
import type { runs } from "@proliferate/services";
import type { EnrichmentPayload } from "./enrich";

export interface TargetResolution {
	type: "default" | "selected" | "fallback";
	configurationId?: string;
	repoIds?: string[];
	reason: string;
	suggestedRepoId?: string;
}

export async function resolveTarget(input: {
	automation: runs.AutomationRunWithRelations["automation"];
	enrichmentJson: unknown;
	organizationId: string;
}): Promise<TargetResolution> {
	const { automation, enrichmentJson, organizationId } = input;

	const defaultConfigurationId = automation?.defaultConfigurationId ?? undefined;

	if (!automation?.allowAgenticRepoSelection) {
		return {
			type: "default",
			configurationId: defaultConfigurationId,
			reason: "selection_disabled",
		};
	}

	const suggestedRepoId = extractSuggestedRepoId(enrichmentJson);
	if (!suggestedRepoId) {
		return {
			type: "default",
			configurationId: defaultConfigurationId,
			reason: "no_suggestion",
		};
	}

	const repoValid = await repos.repoExists(suggestedRepoId, organizationId);
	if (!repoValid) {
		return {
			type: "fallback",
			configurationId: defaultConfigurationId,
			reason: "repo_not_found_or_wrong_org",
			suggestedRepoId,
		};
	}

	// Reuse an existing managed configuration that already contains this repo
	// to avoid creating a new configuration + setup session on every run.
	const existingConfigurationId = await findManagedConfigurationForRepo(
		suggestedRepoId,
		organizationId,
	);
	if (existingConfigurationId) {
		return {
			type: "selected",
			configurationId: existingConfigurationId,
			reason: "enrichment_suggestion_reused",
			suggestedRepoId,
		};
	}

	return {
		type: "selected",
		repoIds: [suggestedRepoId],
		reason: "enrichment_suggestion_new",
		suggestedRepoId,
	};
}

function extractSuggestedRepoId(enrichmentJson: unknown): string | null {
	if (!enrichmentJson || typeof enrichmentJson !== "object") return null;
	const payload = enrichmentJson as Partial<EnrichmentPayload>;
	if (payload.version !== 1) return null;
	if (typeof payload.suggestedRepoId !== "string" || payload.suggestedRepoId.length === 0)
		return null;
	return payload.suggestedRepoId;
}

async function findManagedConfigurationForRepo(
	repoId: string,
	organizationId: string,
): Promise<string | null> {
	const managed = await configurations.findManagedConfigurations();
	const match = managed.find((c) =>
		c.configurationRepos?.some(
			(cr) => cr.repo?.id === repoId && cr.repo?.organizationId === organizationId,
		),
	);
	return match?.id ?? null;
}
```

## 11) Appendix B: Full file snapshot (`apps/worker/src/automation/enrich.ts`)

```ts
/**
 * Enrichment computation for automation runs.
 *
 * Pure deterministic extraction from trigger context — no external calls.
 */

import type { runs } from "@proliferate/services";
import type { ParsedEventContext } from "@proliferate/triggers";

export class EnrichmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EnrichmentError";
	}
}

export interface EnrichmentPayload {
	version: 1;
	provider: string;
	summary: {
		title: string;
		description: string | null;
	};
	source: {
		url: string | null;
		externalId: string | null;
		eventType: string | null;
	};
	relatedFiles: string[];
	suggestedRepoId: string | null;
	providerContext: Record<string, unknown>;
	automationContext: {
		automationId: string;
		automationName: string;
		hasLlmFilter: boolean;
		hasLlmAnalysis: boolean;
	};
}

export function buildEnrichmentPayload(
	context: runs.AutomationRunWithRelations,
): EnrichmentPayload {
	const { automation, triggerEvent, trigger } = context;
	if (!automation || !triggerEvent || !trigger) {
		throw new EnrichmentError("Missing automation, trigger, or trigger event");
	}

	const parsed = triggerEvent.parsedContext as ParsedEventContext | null;
	if (!parsed || typeof parsed !== "object") {
		throw new EnrichmentError("parsedContext is missing or not an object");
	}

	if (!parsed.title) {
		throw new EnrichmentError("parsedContext.title is required");
	}

	return {
		version: 1,
		provider: trigger.provider,
		summary: {
			title: parsed.title,
			description: parsed.description ?? null,
		},
		source: {
			url: extractSourceUrl(parsed),
			externalId: triggerEvent.externalEventId,
			eventType: triggerEvent.providerEventType,
		},
		relatedFiles: parsed.relatedFiles ?? [],
		suggestedRepoId: parsed.suggestedRepoId ?? null,
		providerContext: extractProviderContext(parsed),
		automationContext: {
			automationId: automation.id,
			automationName: automation.name,
			hasLlmFilter: !!automation.llmFilterPrompt,
			hasLlmAnalysis: !!automation.llmAnalysisPrompt,
		},
	};
}

export function extractSourceUrl(parsed: ParsedEventContext): string | null {
	if (parsed.linear?.issueUrl) return parsed.linear.issueUrl;
	if (parsed.sentry?.issueUrl) return parsed.sentry.issueUrl;
	if (parsed.github) {
		return (
			parsed.github.issueUrl ??
			parsed.github.prUrl ??
			parsed.github.compareUrl ??
			parsed.github.workflowUrl ??
			null
		);
	}
	if (parsed.posthog?.eventUrl) return parsed.posthog.eventUrl;
	return null;
}

function extractProviderContext(parsed: ParsedEventContext): Record<string, unknown> {
	if (parsed.linear) return { ...parsed.linear };
	if (parsed.sentry) return { ...parsed.sentry };
	if (parsed.github) return { ...parsed.github };
	if (parsed.posthog) return { ...parsed.posthog };
	if (parsed.gmail) return { ...parsed.gmail };
	return {};
}
```

## 12) Spec notes relevant to this initiative

From `docs/specs/automations-runs.md`:
- Target resolution decision tree currently depends on `suggestedRepoId` and can emit `repoIds` for managed config creation.
- Known limitation explicitly states `llm_filter_prompt` and `llm_analysis_prompt` are currently unused at runtime.
- Notification channel fallback from canonical column to legacy tool config is documented as tech debt.

From `docs/specs/integrations.md`:
- Slack OAuth and installation lifecycle are implemented.
- Slack schema drift and integration tech debt are already tracked.

