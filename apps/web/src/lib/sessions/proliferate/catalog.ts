export interface ActionsCatalogSummary {
	totalIntegrations: number;
	totalActions: number;
	names: string[];
}

function safeParse(raw: unknown): unknown {
	if (typeof raw !== "string") return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * Summarize `proliferate actions list` output for a compact chat card.
 * Returns null when the output is not structured catalog JSON
 * (for example, when the shell command pipes through grep/head).
 */
export function normalizeActionsCatalog(raw: unknown): ActionsCatalogSummary | null {
	const parsed = safeParse(raw);
	if (!parsed || typeof parsed !== "object") return null;
	const integrations = (parsed as Record<string, unknown>).integrations;
	if (!Array.isArray(integrations) || integrations.length === 0) return null;

	const names: string[] = [];
	let totalActions = 0;

	for (const entry of integrations) {
		if (!entry || typeof entry !== "object") continue;
		const obj = entry as Record<string, unknown>;
		if (typeof obj.displayName === "string" && obj.displayName.length > 0) {
			names.push(obj.displayName);
		} else if (typeof obj.integration === "string" && obj.integration.length > 0) {
			names.push(obj.integration);
		}
		if (Array.isArray(obj.actions)) totalActions += obj.actions.length;
	}

	return {
		totalIntegrations: integrations.length,
		totalActions,
		names: names.slice(0, 6),
	};
}
