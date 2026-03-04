/**
 * V1 action and capability contracts.
 */

export const CAPABILITY_MODES = ["allow", "require_approval", "deny"] as const;
export type CapabilityMode = (typeof CAPABILITY_MODES)[number];

export const ACTION_INVOCATION_STATUSES = [
	"pending",
	"approved",
	"denied",
	"expired",
	"executing",
	"completed",
	"failed",
] as const;
export type ActionInvocationStatus = (typeof ACTION_INVOCATION_STATUSES)[number];

export const TERMINAL_ACTION_INVOCATION_STATUSES: readonly ActionInvocationStatus[] = [
	"denied",
	"expired",
	"completed",
	"failed",
];

const ACTION_INVOCATION_TRANSITIONS: Record<string, readonly ActionInvocationStatus[]> = {
	pending: ["approved", "denied", "expired"],
	approved: ["executing", "failed"],
	executing: ["completed", "failed"],
};

export function isValidActionInvocationTransition(
	from: ActionInvocationStatus,
	to: ActionInvocationStatus,
): boolean {
	return ACTION_INVOCATION_TRANSITIONS[from]?.includes(to) ?? false;
}
