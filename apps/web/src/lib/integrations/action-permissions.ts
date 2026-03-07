export type OrgActionMode = "allow" | "require_approval" | "deny";

export function isOrgActionDenied(
	actionModes: Record<string, OrgActionMode | undefined>,
	actionModeKey: string,
): boolean {
	return actionModes[actionModeKey] === "deny";
}

export interface UserToggleStateInput {
	adminActionEnabled: boolean;
	userActionEnabled: boolean;
}

export interface UserToggleState {
	checked: boolean;
	disabledByAdmin: boolean;
}

export interface ConnectorPermissionAction {
	key: string;
	name: string;
	description: string;
	riskLevel: string;
}

export interface ConnectorDiscoveredAction {
	name: string;
	description: string;
	riskLevel: "read" | "write" | "danger";
}

export function resolveUserToggleState(input: UserToggleStateInput): UserToggleState {
	if (!input.adminActionEnabled) {
		return {
			checked: false,
			disabledByAdmin: true,
		};
	}

	return {
		checked: input.userActionEnabled,
		disabledByAdmin: false,
	};
}

export function mapConnectorToolsToPermissionActions(
	connectorId: string | undefined,
	actions: ConnectorDiscoveredAction[] | undefined,
): ConnectorPermissionAction[] {
	if (!connectorId || !actions) {
		return [];
	}

	return actions.map((action) => ({
		key: `connector:${connectorId}:${action.name}`,
		name: action.name,
		description: action.description,
		riskLevel: action.riskLevel,
	}));
}
