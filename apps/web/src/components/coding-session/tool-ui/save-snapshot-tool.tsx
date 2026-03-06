"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ProliferateToolCard } from "./proliferate-tool-card";

interface SaveSnapshotArgs {
	message?: string;
}

/**
 * Simple status indicator for save_snapshot tool.
 * The gateway handles the actual snapshot logic - this just shows status.
 */
export const SaveSnapshotToolUI = makeAssistantToolUI<SaveSnapshotArgs, string>({
	toolName: "save_snapshot",
	render: function SaveSnapshotUI({ args, result, status }) {
		const isRunning = status.type === "running";
		const isSuccess = result && !result.toLowerCase().includes("failed");

		return (
			<ProliferateToolCard
				label={isRunning ? "Saving snapshot..." : "Save snapshot"}
				status={isRunning ? "running" : isSuccess ? "success" : "error"}
				errorMessage={!isRunning && !isSuccess && result ? result : undefined}
			>
				{isRunning && <span>{args?.message || "Capturing current workspace state..."}</span>}
				{!isRunning && isSuccess && <span>Snapshot saved successfully.</span>}
			</ProliferateToolCard>
		);
	},
});
