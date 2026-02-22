"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ProliferateToolCard } from "./proliferate-tool-card";

interface EnvFileKey {
	key: string;
	required: boolean;
}

interface EnvFileSpec {
	workspacePath?: string;
	path: string;
	format: "dotenv";
	mode: "secret";
	keys: EnvFileKey[];
}

interface SaveEnvFilesArgs {
	files?: EnvFileSpec[];
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

export const SaveEnvFilesToolUI = makeAssistantToolUI<SaveEnvFilesArgs, string>({
	toolName: "save_env_files",
	render: function SaveEnvFilesUI({ args, result, status }) {
		const isRunning = status.type === "running";
		const files = args?.files ?? [];

		if (isRunning) {
			return <ProliferateToolCard label="Saving env file spec..." status="running" />;
		}

		if (isError(result)) {
			return <ProliferateToolCard label="Save env files" status="error" errorMessage={result} />;
		}

		const count = files.length;
		const label = `Saved ${count} env file spec${count !== 1 ? "s" : ""}`;
		const summary = files
			.map((f) => `${f.path} (${f.keys.length} key${f.keys.length !== 1 ? "s" : ""})`)
			.join(", ");

		return (
			<ProliferateToolCard label={label} status="success">
				{summary && <span>{summary}</span>}
			</ProliferateToolCard>
		);
	},
});
