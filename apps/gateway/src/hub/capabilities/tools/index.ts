/**
 * Intercepted Tools Registry
 *
 * Tools that the gateway intercepts and executes server-side
 * instead of letting the sandbox run them.
 */

import type { SessionHub } from "../../session-hub";
import { automationCompleteHandler } from "./automation-complete";
import { saveEnvFilesHandler } from "./save-env-files";
import { saveServiceCommandsHandler } from "./save-service-commands";
import { saveSnapshotHandler } from "./save-snapshot";
import { verifyHandler } from "./verify";

/**
 * Result from an intercepted tool execution
 */
export interface InterceptedToolResult {
	success: boolean;
	result: string;
	data?: Record<string, unknown>;
}

/**
 * Handler for a tool that the gateway intercepts
 */
export interface InterceptedToolHandler {
	name: string;
	execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult>;
}

/**
 * Registry of intercepted tools
 */
const interceptedTools = new Map<string, InterceptedToolHandler>();

// Register built-in intercepted tools
interceptedTools.set(saveSnapshotHandler.name, saveSnapshotHandler);
interceptedTools.set(verifyHandler.name, verifyHandler);
interceptedTools.set(automationCompleteHandler.name, automationCompleteHandler);
interceptedTools.set("automation_complete", automationCompleteHandler);
interceptedTools.set(saveServiceCommandsHandler.name, saveServiceCommandsHandler);
interceptedTools.set(saveEnvFilesHandler.name, saveEnvFilesHandler);

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

/**
 * Get all intercepted tool names
 */
export function getInterceptedToolNames(): string[] {
	return Array.from(interceptedTools.keys());
}

/**
 * Register a custom intercepted tool handler
 */
export function registerInterceptedTool(handler: InterceptedToolHandler): void {
	interceptedTools.set(handler.name, handler);
}
