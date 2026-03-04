import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";

export function getDisconnectDescription(entry: CatalogEntry): string {
	if (entry.provider === "github") {
		return "Repos using this connection will be marked as orphaned until reconnected.";
	}
	const name = entry.name;
	return `Triggers and automations using this ${name} connection will stop working.`;
}
