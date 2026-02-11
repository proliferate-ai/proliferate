/**
 * Action adapter interface.
 *
 * Each integration (Sentry, Linear, etc.) implements this interface
 * to declare available actions and how to execute them.
 */

export interface ActionParam {
	name: string;
	type: "string" | "number" | "boolean" | "object";
	required: boolean;
	description: string;
}

export interface ActionDefinition {
	name: string;
	description: string;
	riskLevel: "read" | "write" | "danger";
	params: ActionParam[];
}

export interface ActionAdapter {
	integration: string;
	actions: ActionDefinition[];
	execute(action: string, params: Record<string, unknown>, token: string): Promise<unknown>;
}
