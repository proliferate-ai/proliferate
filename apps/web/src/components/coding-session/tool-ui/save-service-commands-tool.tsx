"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ProliferateToolCard } from "./proliferate-tool-card";

interface ServiceCommand {
	name: string;
	command: string;
	cwd?: string;
	workspacePath?: string;
}

interface SaveServiceCommandsArgs {
	commands?: ServiceCommand[];
}

function isError(result: string | undefined): boolean {
	if (!result) return false;
	const lower = result.toLowerCase();
	return (
		lower.startsWith("failed") ||
		lower.startsWith("invalid") ||
		lower.startsWith("missing") ||
		lower.includes("only available in setup")
	);
}

export const SaveServiceCommandsToolUI = makeAssistantToolUI<SaveServiceCommandsArgs, string>({
	toolName: "save_service_commands",
	render: function SaveServiceCommandsUI({ args, result, status }) {
		const isRunning = status.type === "running";
		const commands = args?.commands ?? [];

		if (isRunning) {
			return <ProliferateToolCard label="Saving service commands..." status="running" />;
		}

		if (isError(result)) {
			return (
				<ProliferateToolCard label="Save service commands" status="error" errorMessage={result} />
			);
		}

		const count = commands.length;
		const label = `Saved ${count} service command${count !== 1 ? "s" : ""}`;
		const names = commands.map((c) => c.name).join(", ");

		return (
			<ProliferateToolCard label={label} status="success">
				{names && <span>{names}</span>}
			</ProliferateToolCard>
		);
	},
});
