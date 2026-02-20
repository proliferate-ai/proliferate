"use client";

import { Button } from "@/components/ui/button";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle, KeyRound, Loader2 } from "lucide-react";
import { createContext, useContext, useMemo } from "react";

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
				<div className="my-2 py-3">
					<div className="flex items-center gap-2">
						<CheckCircle className="h-4 w-4 text-muted-foreground" />
						<span className="text-sm text-muted-foreground">Configuration submitted</span>
					</div>
				</div>
			);
		}

		// Loading state
		if (isRunning || !args?.keys) {
			return (
				<div className="my-2 py-3">
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span className="text-sm">Requesting configuration...</span>
					</div>
				</div>
			);
		}

		// Redirect card — directs user to the Environment sidebar tab
		return (
			<div className="my-2 py-3 space-y-3">
				<div className="flex items-center gap-2">
					<KeyRound className="h-4 w-4 text-muted-foreground" />
					<span className="text-sm font-medium">
						{requiredCount} environment {requiredCount === 1 ? "variable" : "variables"} needed
					</span>
				</div>
				<p className="text-xs text-muted-foreground">
					The agent needs credentials to continue. Open Environment and create or update secret
					files (path + contents), then resume setup.
				</p>
				<Button
					size="sm"
					variant="outline"
					className="gap-2 text-xs"
					onClick={() => togglePanel("environment")}
				>
					<KeyRound className="h-3.5 w-3.5" />
					Open Environment Panel
				</Button>
			</div>
		);
	},
});
