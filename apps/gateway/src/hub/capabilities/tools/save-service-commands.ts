/**
 * Save Service Commands Tool Handler
 *
 * Intercepts save_service_commands tool calls from the agent and persists
 * the auto-start commands to the configuration.
 */

import { configurations } from "@proliferate/services";
import { z } from "zod";
import type { SessionHub } from "../../session-hub";
import type { InterceptedToolHandler, InterceptedToolResult } from "./index";

const CommandSchema = z.object({
	name: z.string().min(1).max(100),
	command: z.string().min(1).max(1000),
	cwd: z.string().max(500).optional(),
	workspacePath: z.string().max(500).optional(),
});

const ArgsSchema = z.object({
	commands: z.array(CommandSchema).min(1).max(10),
});

export const saveServiceCommandsHandler: InterceptedToolHandler = {
	name: "save_service_commands",

	async execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult> {
		const parsed = ArgsSchema.safeParse(args);
		if (!parsed.success) {
			return {
				success: false,
				result: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
			};
		}

		const context = hub.getContext();
		const sessionType = context.session.session_type;
		const configurationId = context.session.configuration_id;
		const updatedBy = context.session.created_by || "agent";

		if (sessionType !== "setup") {
			return {
				success: false,
				result: "save_service_commands is only available in setup sessions.",
			};
		}

		if (!configurationId) {
			return {
				success: false,
				result: "Session has no configuration — cannot save service commands.",
			};
		}

		try {
			await configurations.updateConfigurationServiceCommands({
				configurationId,
				serviceCommands: parsed.data.commands,
				updatedBy,
			});

			const names = parsed.data.commands.map((c) => c.name).join(", ");
			return {
				success: true,
				result: `Service commands saved for configuration: ${names}. These will auto-run in future sessions with this configuration.`,
				data: { configurationId, commandCount: parsed.data.commands.length },
			};
		} catch (err) {
			return {
				success: false,
				result: `Failed to save service commands: ${err instanceof Error ? err.message : "Unknown error"}`,
			};
		}
	},
};
