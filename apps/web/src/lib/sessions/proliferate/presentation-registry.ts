/**
 * Presentation registry.
 *
 * Maps (integration, action) to a reusable presentation kind and a
 * human-readable label. Custom UI is opt-in for a curated subset of
 * high-value actions. Everything else falls back to genericJsonFallback.
 *
 * Scaling rule: map multiple actions to the same presentation kind rather
 * than building one component per action.
 */

export type PresentationKind =
	/** `proliferate actions list` catalog display */
	| "actions-catalog"
	/** List of email/message rows (fetch, list) */
	| "messageList"
	/** List of message/thread handles where full metadata is not available */
	| "messageHandles"
	/** Single message view (fetch by id, get draft) */
	| "messageDetail"
	/** Confirmation card for write/mutation actions (send, delete, label, etc.) */
	| "mutationSummary"
	/** Generic expandable JSON — the long-tail fallback */
	| "genericJsonFallback";

export interface ActionPresentation {
	kind: PresentationKind;
	/** Human-readable label shown in the chat card */
	label: string;
}

// ---------------------------------------------------------------------------
// Gmail action map
// Multiple read actions -> messageList; multiple write actions -> mutationSummary
// ---------------------------------------------------------------------------

const GMAIL_MAP: Record<string, ActionPresentation> = {
	GMAIL_FETCH_EMAILS: { kind: "messageList", label: "Fetched emails" },
	GMAIL_LIST_MESSAGES: { kind: "messageHandles", label: "Listed messages" },
	GMAIL_LIST_THREADS: { kind: "messageHandles", label: "Listed threads" },
	GMAIL_LIST_DRAFTS: { kind: "messageList", label: "Listed drafts" },

	GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: { kind: "messageDetail", label: "Fetched message" },
	GMAIL_FETCH_MESSAGE_BY_THREAD_ID: { kind: "messageDetail", label: "Fetched thread" },
	GMAIL_GET_DRAFT: { kind: "messageDetail", label: "Fetched draft" },

	GMAIL_SEND_EMAIL: { kind: "mutationSummary", label: "Sent email" },
	GMAIL_REPLY_TO_THREAD: { kind: "mutationSummary", label: "Replied to thread" },
	GMAIL_FORWARD_MESSAGE: { kind: "mutationSummary", label: "Forwarded message" },
	GMAIL_CREATE_EMAIL_DRAFT: { kind: "mutationSummary", label: "Created draft" },
	GMAIL_UPDATE_DRAFT: { kind: "mutationSummary", label: "Updated draft" },
	GMAIL_SEND_DRAFT: { kind: "mutationSummary", label: "Sent draft" },
	GMAIL_DELETE_DRAFT: { kind: "mutationSummary", label: "Deleted draft" },
	GMAIL_ADD_LABEL_TO_EMAIL: { kind: "mutationSummary", label: "Updated labels" },
	GMAIL_BATCH_MODIFY_MESSAGES: { kind: "mutationSummary", label: "Modified messages" },
	GMAIL_MODIFY_THREAD_LABELS: { kind: "mutationSummary", label: "Updated thread labels" },
	GMAIL_MOVE_TO_TRASH: { kind: "mutationSummary", label: "Moved to trash" },
	GMAIL_TRASH_THREAD: { kind: "mutationSummary", label: "Moved thread to trash" },
	GMAIL_DELETE_MESSAGE: { kind: "mutationSummary", label: "Deleted message" },
	GMAIL_BATCH_DELETE_MESSAGES: { kind: "mutationSummary", label: "Deleted messages" },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the presentation kind and label for a given integration + action.
 * Uses action-name prefix to identify provider for composio connectors.
 */
export function resolvePresentation(_integration: string, action: string): ActionPresentation {
	const upper = action.toUpperCase();

	if (upper.startsWith("GMAIL_")) {
		return GMAIL_MAP[upper] ?? { kind: "genericJsonFallback", label: humanizeAction(action) };
	}

	return { kind: "genericJsonFallback", label: humanizeAction(action) };
}

/**
 * Human-readable label for an integration string.
 * "linear" -> "Linear"
 * "connector:uuid" -> "Integration"
 */
export function resolveIntegrationLabel(integration: string): string {
	if (integration === "linear") return "Linear";
	if (integration === "sentry") return "Sentry";
	if (integration === "github") return "GitHub";
	if (integration === "slack") return "Slack";
	if (integration === "jira") return "Jira";
	if (integration === "posthog") return "PostHog";
	if (integration === "gmail") return "Gmail";
	if (integration.startsWith("connector:")) return "Integration";
	// Capitalize first letter of unknown integrations
	return integration.charAt(0).toUpperCase() + integration.slice(1);
}

/**
 * Turn a raw action name into a readable label.
 * "GMAIL_FETCH_EMAILS" -> "Fetch emails"
 * "list_teams" -> "List teams"
 */
export function humanizeAction(action: string): string {
	return (
		action
			// Remove leading provider prefix like "GMAIL_" or "SLACK_"
			.replace(/^[A-Z]+_(?=[A-Z])/, "")
			.replace(/_/g, " ")
			.toLowerCase()
			.replace(/^\w/, (c) => c.toUpperCase())
	);
}
