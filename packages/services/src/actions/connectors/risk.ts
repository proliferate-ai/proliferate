/**
 * MCP tool annotation → Actions risk level mapping.
 *
 * Priority:
 * 1. Connector-level per-tool override (riskPolicy.overrides[toolName])
 * 2. MCP annotations (destructiveHint → danger, readOnlyHint → read; destructive first for fail-safe)
 * 3. Connector-level default (riskPolicy.defaultRisk)
 * 4. Safe fallback: "write" (requires approval)
 */

import type { ConnectorRiskPolicy } from "@proliferate/shared";

export interface McpToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

export function deriveRiskLevel(
	toolName: string,
	annotations: McpToolAnnotations | undefined,
	policy: ConnectorRiskPolicy | undefined,
): "read" | "write" | "danger" {
	// 1. Explicit per-tool override
	if (policy?.overrides?.[toolName]) {
		return policy.overrides[toolName];
	}

	// 2. MCP annotations (untrusted hints — check destructive first for fail-safe)
	if (annotations) {
		if (annotations.destructiveHint === true) return "danger";
		if (annotations.readOnlyHint === true) return "read";
	}

	// 3. Connector-level default
	if (policy?.defaultRisk) return policy.defaultRisk;

	// 4. Safe fallback — treat unknown tools as write (requires approval)
	return "write";
}
