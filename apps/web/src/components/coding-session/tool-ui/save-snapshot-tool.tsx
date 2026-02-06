"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle, Loader2, XCircle } from "lucide-react";

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
			<div className="my-2 py-3 flex items-center gap-2">
				{isRunning && (
					<>
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						<span className="text-sm text-muted-foreground">
							{args?.message || "Saving snapshot..."}
						</span>
					</>
				)}
				{!isRunning && isSuccess && (
					<>
						<CheckCircle className="h-4 w-4 text-green-600" />
						<span className="text-sm font-medium text-green-600">Snapshot saved</span>
					</>
				)}
				{!isRunning && !isSuccess && result && (
					<>
						<XCircle className="h-4 w-4 text-destructive" />
						<span className="text-sm text-destructive">{result}</span>
					</>
				)}
			</div>
		);
	},
});
