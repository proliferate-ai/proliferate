/**
 * Verify Tool Handler
 *
 * Intercepts verify tool calls from the agent and uploads verification
 * files from the sandbox to S3 on the gateway side (keeping S3 credentials
 * out of the sandbox).
 */

import type { SessionHub } from "../../session-hub";
import type { InterceptedToolHandler, InterceptedToolResult } from "./index";

export const verifyHandler: InterceptedToolHandler = {
	name: "verify",

	async execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult> {
		const folder = (args.folder as string) || ".proliferate/.verification";

		try {
			const { uploadedCount, prefix } = await hub.uploadVerificationFiles(folder);

			if (uploadedCount === 0) {
				return {
					success: true,
					result: `No files found in ${folder}. Add screenshots or logs before calling verify().`,
				};
			}

			// Return JSON that the UI expects: { key: "sessions/.../verification/..." }
			return {
				success: true,
				result: JSON.stringify({ key: prefix }),
				data: { uploadedCount, prefix },
			};
		} catch (err) {
			return {
				success: false,
				result: `Verification upload failed: ${err instanceof Error ? err.message : "Unknown error"}`,
			};
		}
	},
};
