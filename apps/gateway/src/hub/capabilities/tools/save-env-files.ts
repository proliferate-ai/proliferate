/**
 * Save Env Files Tool Handler
 *
 * Intercepts save_env_files tool calls from the agent and persists
 * the env file generation spec to the prebuild configuration.
 */

import { prebuilds } from "@proliferate/services";
import { z } from "zod";
import type { SessionHub } from "../../session-hub";
import type { InterceptedToolHandler, InterceptedToolResult } from "./index";

const KeySchema = z.object({
	key: z.string().min(1).max(200),
	required: z.boolean(),
});

const EnvFileSchema = z.object({
	workspacePath: z.string().max(500).default("."),
	path: z.string().min(1).max(500),
	format: z.literal("dotenv"),
	mode: z.literal("secret"),
	keys: z.array(KeySchema).min(1).max(50),
});

const ArgsSchema = z.object({
	files: z.array(EnvFileSchema).min(1).max(10),
});

export const saveEnvFilesHandler: InterceptedToolHandler = {
	name: "save_env_files",

	async execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult> {
		const parsed = ArgsSchema.safeParse(args);
		if (!parsed.success) {
			return {
				success: false,
				result: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
			};
		}

		const context = hub.getContext();
		const prebuildId = context.session.prebuild_id;
		const updatedBy = context.session.created_by || "agent";

		if (!prebuildId) {
			return {
				success: false,
				result: "Session has no prebuild — cannot save env file spec.",
			};
		}

		try {
			await prebuilds.updatePrebuildEnvFiles({
				prebuildId,
				envFiles: parsed.data.files,
				updatedBy,
			});

			const paths = parsed.data.files.map((f) => f.path).join(", ");
			return {
				success: true,
				result: `Env file spec saved: ${paths}. These files will be generated on boot in future sessions.`,
				data: { prebuildId, fileCount: parsed.data.files.length },
			};
		} catch (err) {
			return {
				success: false,
				result: `Failed to save env file spec: ${err instanceof Error ? err.message : "Unknown error"}`,
			};
		}
	},
};
