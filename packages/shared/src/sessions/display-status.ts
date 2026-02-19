/**
 * Session display status derivation.
 *
 * Maps raw DB (status, pauseReason) pairs to user-facing display statuses.
 * Pure function — no side effects, no DB access.
 */

export type DisplayStatus =
	| "active"
	| "idle"
	| "paused"
	| "blocked"
	| "recovering"
	| "completed"
	| "failed";

const BILLING_PAUSE_REASONS = new Set([
	"credit_limit",
	"payment_failed",
	"overage_cap",
	"suspended",
]);

/**
 * Derive user-facing display status from raw DB status and pauseReason.
 *
 * See docs/session-display-redesign-spec.md — Complete Status Matrix.
 */
export function deriveDisplayStatus(
	status: string | null | undefined,
	pauseReason: string | null | undefined,
): DisplayStatus {
	switch (status) {
		case "pending":
		case "starting":
		case "running":
			return "active";

		case "stopped":
			return pauseReason === "snapshot_failed" ? "failed" : "completed";

		case "failed":
			return "failed";

		case "suspended":
			return "blocked";

		case "paused": {
			if (pauseReason === "inactivity") return "idle";
			if (pauseReason === "orphaned") return "recovering";
			if (pauseReason && BILLING_PAUSE_REASONS.has(pauseReason)) return "blocked";
			// manual, null, or unknown → paused (neutral fallback)
			return "paused";
		}

		default:
			return "failed";
	}
}

/**
 * Human-readable reason text for blocked sessions.
 * Returns null if the session is not in a blocked state.
 */
export function getBlockedReasonText(
	pauseReason: string | null | undefined,
	status: string | null | undefined,
): string | null {
	if (status === "suspended") return "Account suspended";
	if (pauseReason === "credit_limit") return "Out of credits";
	if (pauseReason === "payment_failed") return "Payment failed";
	if (pauseReason === "overage_cap") return "Usage cap reached";
	if (pauseReason === "suspended") return "Account suspended";
	return null;
}
