import type {
	ActionDefinition,
	ActionExecutionContext,
	ActionSource,
} from "@proliferate/providers";
import type { ConnectorConfig } from "@proliferate/shared";

export interface CachedConnectorTools {
	connectorId: string;
	connectorName: string;
	actions: ActionDefinition[];
	expiresAt: number;
}

export interface SessionConnectorContext {
	connectors: ConnectorConfig[];
	orgId: string;
}

export interface ResolvedAction {
	source: ActionSource;
	actionDef: ActionDefinition;
	ctx: ActionExecutionContext;
	isDrifted: boolean;
}
