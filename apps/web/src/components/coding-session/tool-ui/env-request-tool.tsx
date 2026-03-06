"use client";

import { Button } from "@/components/ui/button";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { KeyRound } from "lucide-react";
import { createContext, useContext, useMemo } from "react";
import { ProliferateToolCard } from "./proliferate-tool-card";

// Context for session info needed by the tool UI
interface SessionContextValue {
	sessionId: string;
	repoId?: string;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionContext() {
	const ctx = useContext(SessionContext);
	if (!ctx) {
		throw new Error("useSessionContext must be used within SessionContext.Provider");
	}
	return ctx;
}

interface EnvVariable {
	key: string;
	description?: string;
	type?: "env" | "secret";
	required?: boolean;
}

interface EnvRequestArgs {
	keys: EnvVariable[];
}

export const EnvRequestToolUI = makeAssistantToolUI<EnvRequestArgs, string>({
	toolName: "request_env_variables",
	render: function EnvRequestUI({ args, result, status }) {
		const togglePanel = usePreviewPanelStore((s) => s.togglePanel);
		const isRunning = status.type === "running";
		const variables = useMemo(() => args?.keys || [], [args?.keys]);
		const requiredCount = variables.filter((v) => v.required !== false).length;

		// Submitted state
		if (result) {
			return (
				<ProliferateToolCard label="Environment request" status="success">
					Configuration submitted.
				</ProliferateToolCard>
			);
		}

		// Loading state
		if (isRunning || !args?.keys) {
			return (
				<ProliferateToolCard label="Environment request" status="running">
					Requesting configuration...
				</ProliferateToolCard>
			);
		}

		// Redirect card — directs user to the Environment sidebar tab
		return (
			<ProliferateToolCard label="Environment request" status="success">
				<div className="space-y-2">
					<p>
						{requiredCount} environment {requiredCount === 1 ? "variable" : "variables"} needed.
					</p>
					<p className="text-xs text-muted-foreground">
						Open Environment and create or update secret files (path + contents), then resume.
					</p>
					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5 px-2 text-xs"
						onClick={() => togglePanel("environment")}
					>
						<KeyRound className="h-3.5 w-3.5" />
						Open Environment Panel
					</Button>
				</div>
			</ProliferateToolCard>
		);
	},
});
