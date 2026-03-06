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

export type OverallWorkState = "working" | "needs_input" | "dormant" | "done";

const BILLING_PAUSE_REASONS = new Set([
	"credit_limit",
	"payment_failed",
	"overage_cap",
	"suspended",
]);

type CanonicalStatus = {
	sandboxState?: string | null;
	agentState?: string | null;
	terminalState?: string | null;
	reason?: string | null;
};

function mapCanonicalToLegacy(status: CanonicalStatus): {
	status: string | null | undefined;
	pauseReason: string | null | undefined;
} {
	const pauseReason =
		status.reason === "manual_pause"
			? "manual"
			: status.reason === "runtime_error"
				? "snapshot_failed"
				: (status.reason ?? null);

	if (status.terminalState === "failed") {
		return { status: "failed", pauseReason };
	}

	if (status.terminalState === "succeeded" || status.terminalState === "cancelled") {
		return { status: "stopped", pauseReason };
	}

	if (status.reason === "orphaned") {
		return { status: "paused", pauseReason: "orphaned" };
	}

	if (status.agentState === "errored") {
		return { status: "failed", pauseReason };
	}

	if (status.agentState === "waiting_approval") {
		return { status: "paused", pauseReason: "approval_required" };
	}

	if (status.agentState === "waiting_input") {
		return { status: "paused", pauseReason: "inactivity" };
	}

	if (status.agentState === "done") {
		return { status: "stopped", pauseReason };
	}

	switch (status.sandboxState) {
		case "provisioning":
		case "running":
			return { status: "running", pauseReason };
		case "paused":
			return { status: "paused", pauseReason };
		case "terminated":
			return { status: "stopped", pauseReason };
		case "failed":
			return { status: "failed", pauseReason };
		default:
			return { status: undefined, pauseReason };
	}
}

/**
 * Derive user-facing display status from raw DB status and pauseReason.
 *
 * See docs/session-display-redesign-spec.md — Complete Status Matrix.
 */
export function deriveDisplayStatus(
	status: string | null | undefined | CanonicalStatus,
	pauseReason: string | null | undefined,
): DisplayStatus {
	const normalized =
		typeof status === "object" && status !== null
			? mapCanonicalToLegacy(status)
			: { status, pauseReason };

	const legacyStatus = normalized.status;
	const legacyPauseReason = normalized.pauseReason;

	switch (legacyStatus) {
		case "pending":
		case "starting":
		case "running":
			return "active";

		case "stopped":
			return legacyPauseReason === "snapshot_failed" ? "failed" : "completed";

		case "failed":
			return "failed";

		case "suspended":
			return "blocked";

		case "paused": {
			if (legacyPauseReason === "inactivity") return "idle";
			if (legacyPauseReason === "orphaned") return "recovering";
			if (legacyPauseReason === "approval_required") return "blocked";
			if (legacyPauseReason && BILLING_PAUSE_REASONS.has(legacyPauseReason)) return "blocked";
			// manual, null, or unknown → paused (neutral fallback)
			return "paused";
		}

		default:
			return "failed";
	}
}

export function deriveOverallWorkState(
	status: CanonicalStatus,
	hasUnreadUpdate: boolean,
): OverallWorkState {
	if (status.terminalState === "succeeded" || status.terminalState === "cancelled") {
		return "done";
	}

	if (
		status.sandboxState === "provisioning" ||
		(status.sandboxState === "running" && status.agentState === "iterating")
	) {
		return "working";
	}

	if (
		hasUnreadUpdate ||
		status.agentState === "waiting_input" ||
		status.agentState === "waiting_approval" ||
		status.agentState === "errored" ||
		status.terminalState === "failed"
	) {
		return "needs_input";
	}

	return "dormant";
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
	if (pauseReason === "approval_required") return "Approval required";
	if (pauseReason === "credit_limit") return "Out of credits";
	if (pauseReason === "payment_failed") return "Payment failed";
	if (pauseReason === "overage_cap") return "Usage cap reached";
	if (pauseReason === "suspended") return "Account suspended";
	return null;
}
