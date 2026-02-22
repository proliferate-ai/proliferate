"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ProliferateToolCard } from "./proliferate-tool-card";

interface AutomationCompleteArgs {
	run_id?: string;
	runId?: string;
	completion_id?: string;
	completionId?: string;
	outcome?: "succeeded" | "failed" | "needs_human";
	summary_markdown?: string;
}

function isError(result: string | undefined): boolean {
	if (!result) return false;
	const lower = result.toLowerCase();
	return (
		lower.startsWith("failed") ||
		lower.startsWith("invalid") ||
		lower.startsWith("missing") ||
		lower.includes("not found")
	);
}

function getOutcomeLabel(outcome: string | undefined): string {
	switch (outcome) {
		case "succeeded":
			return "Automation succeeded";
		case "failed":
			return "Automation failed";
		case "needs_human":
			return "Automation needs review";
		default:
			return "Automation complete";
	}
}

function renderAutomationComplete({
	args,
	result,
	status,
}: { args: AutomationCompleteArgs; result?: string; status: { type: string } }) {
	const isRunning = status.type === "running";

	if (isRunning) {
		return <ProliferateToolCard label="Completing automation..." status="running" />;
	}

	const toolError = isError(result);
	const outcome = args?.outcome;

	if (toolError) {
		return <ProliferateToolCard label="Automation complete" status="error" errorMessage={result} />;
	}

	const isFailed = outcome === "failed";
	return (
		<ProliferateToolCard label={getOutcomeLabel(outcome)} status={isFailed ? "error" : "success"} />
	);
}

export const AutomationCompleteToolUI = makeAssistantToolUI<AutomationCompleteArgs, string>({
	toolName: "automation.complete",
	render: renderAutomationComplete,
});

export const AutomationCompleteToolUIAlias = makeAssistantToolUI<AutomationCompleteArgs, string>({
	toolName: "automation_complete",
	render: renderAutomationComplete,
});
