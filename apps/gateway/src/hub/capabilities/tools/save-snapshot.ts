/**
 * Save Snapshot Tool Handler
 *
 * Intercepts save_snapshot tool calls from the agent and executes
 * the snapshot on the gateway side (where we have provider access).
 */

import type { SessionHub } from "../../session-hub";
import type { InterceptedToolHandler, InterceptedToolResult } from "./index";

export const saveSnapshotHandler: InterceptedToolHandler = {
	name: "save_snapshot",

	async execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult> {
		const message = args.message as string | undefined;

		try {
			const { snapshotId, target } = await hub.saveSnapshot(message);
			return {
				success: true,
				result: `Snapshot saved to ${target}: ${snapshotId}`,
				data: { snapshotId, target },
			};
		} catch (err) {
			return {
				success: false,
				result: `Snapshot failed: ${err instanceof Error ? err.message : "Unknown error"}`,
			};
		}
	},
};
