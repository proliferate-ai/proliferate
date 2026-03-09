/**
 * Type declarations for @mariozechner/pi-coding-agent.
 *
 * This package is only available at runtime inside the sandbox (installed by Pi).
 * These declarations provide type safety during development.
 */
declare module "@mariozechner/pi-coding-agent" {
	interface ToolParameter {
		type: "string" | "number" | "boolean" | "object";
		description?: string;
		nullable?: boolean;
		properties?: Record<string, unknown>;
		required?: string[];
	}

	interface ToolResult {
		content: Array<{ type: "text"; text: string }>;
	}

	interface ToolDefinition {
		name: string;
		label: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, unknown>;
			required?: string[];
		};
		execute(
			toolCallId: string,
			params: Record<string, unknown>,
		): Promise<ToolResult>;
	}

	interface ExtensionAPI {
		registerTool(tool: ToolDefinition): void;
	}
}
