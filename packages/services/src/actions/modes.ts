/**
 * Three-Mode Permissioning Cascade.
 *
 * Every action invocation resolves to exactly one mode:
 *   allow            → execute synchronously
 *   deny             → reject synchronously
 *   require_approval → create pending invocation, wait for human
 *
 * Resolution order:
 *   1. Automation override  (automations.action_modes["sourceId:actionId"])
 *   2. Org default          (organizations.action_modes["sourceId:actionId"])
 *   3. Inferred default     (from action definition risk hint)
 */

import type { ActionMode, RiskLevel } from "@proliferate/providers";
import * as modesDb from "./modes-db";

const VALID_ACTION_MODES = new Set<string>(["allow", "deny", "require_approval"]);

// ============================================
// Types
// ============================================

export type ModeSource = "automation_override" | "org_default" | "inferred_default";

export interface ModeResolution {
	mode: ActionMode;
	source: ModeSource;
}

export interface ResolveModeInput {
	/** Source identifier (e.g., "sentry", "connector:<uuid>") */
	sourceId: string;
	/** Action identifier (e.g., "update_issue") */
	actionId: string;
	/** Risk hint from the action definition */
	riskLevel: RiskLevel;
	/** Organization ID */
	orgId: string;
	/** Automation ID (if running in an automation context) */
	automationId?: string;
	/** Whether the tool has drifted from last admin review (connector tools only) */
	isDrifted?: boolean;
}

// ============================================
// Inferred Default
// ============================================

function inferModeFromRisk(riskLevel: RiskLevel): ActionMode {
	switch (riskLevel) {
		case "read":
			return "allow";
		case "write":
			return "require_approval";
		case "danger":
			return "deny";
		default:
			return "require_approval";
	}
}

// ============================================
// Mode Resolution
// ============================================

/**
 * Resolve the effective action mode via the three-tier cascade.
 *
 * Drift guard: If `isDrifted` is true, `allow` downgrades to
 * `require_approval` but `deny` stays `deny`.
 */
export async function resolveMode(input: ResolveModeInput): Promise<ModeResolution> {
	const modeKey = `${input.sourceId}:${input.actionId}`;

	// 1. Automation override (highest priority)
	if (input.automationId) {
		const automationModes = await modesDb.getAutomationActionModes(input.automationId);
		const raw = automationModes[modeKey];
		if (raw && VALID_ACTION_MODES.has(raw)) {
			return applyDriftGuard(
				{ mode: raw as ActionMode, source: "automation_override" },
				input.isDrifted,
			);
		}
	}

	// 2. Org default
	const orgModes = await modesDb.getOrgActionModes(input.orgId);
	const orgRaw = orgModes[modeKey];
	if (orgRaw && VALID_ACTION_MODES.has(orgRaw)) {
		return applyDriftGuard({ mode: orgRaw as ActionMode, source: "org_default" }, input.isDrifted);
	}

	// 3. Inferred default from risk hint
	const inferred = inferModeFromRisk(input.riskLevel);
	return applyDriftGuard({ mode: inferred, source: "inferred_default" }, input.isDrifted);
}

/**
 * Apply drift guardrail for connector tools.
 * allow → require_approval (needs re-review)
 * deny → deny (never escalate)
 * require_approval → require_approval (unchanged)
 */
function applyDriftGuard(resolution: ModeResolution, isDrifted?: boolean): ModeResolution {
	if (!isDrifted) return resolution;

	if (resolution.mode === "allow") {
		return { mode: "require_approval", source: resolution.source };
	}
	return resolution;
}

// Re-export DB helpers for consumers
export { setOrgActionMode, setAutomationActionMode } from "./modes-db";
