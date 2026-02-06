/**
 * Intercepted Tool Framework
 *
 * Provides a standard interface for tools that the gateway intercepts
 * and executes server-side instead of letting the sandbox run them.
 *
 * This keeps sensitive credentials (like S3 keys) out of sandboxes
 * while still allowing agents to call tools like verify() and save_snapshot().
 */

import type { SessionHub } from "./hub/session-hub";

/**
 * Result from an intercepted tool execution
 */
export interface InterceptedToolResult {
	success: boolean;
	result: string;
	/** Optional structured data to include in the result */
	data?: Record<string, unknown>;
}

/**
 * Handler for a tool that the gateway intercepts and executes server-side
 * instead of letting the sandbox execute it.
 */
export interface InterceptedToolHandler {
	/** Tool name (must match OpenCode tool name) */
	name: string;

	/**
	 * Execute the tool server-side.
	 * @param hub - The SessionHub instance (for access to sandbox, database, etc.)
	 * @param args - Arguments passed to the tool by OpenCode
	 * @returns Result to send back to OpenCode
	 */
	execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult>;
}

/**
 * Registry of intercepted tools
 */
export const interceptedTools = new Map<string, InterceptedToolHandler>();

/**
 * Register an intercepted tool handler
 */
export function registerInterceptedTool(handler: InterceptedToolHandler): void {
	interceptedTools.set(handler.name, handler);
}

/**
 * Check if a tool should be intercepted
 */
export function isInterceptedTool(toolName: string): boolean {
	return interceptedTools.has(toolName);
}

/**
 * Get handler for an intercepted tool
 */
export function getInterceptedToolHandler(toolName: string): InterceptedToolHandler | undefined {
	return interceptedTools.get(toolName);
}
