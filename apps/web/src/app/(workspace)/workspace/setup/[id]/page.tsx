"use client";

import { CodingSession } from "@/components/coding-session";
import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useCreateConfiguration } from "@/hooks/use-configurations";
import { useCreateSession } from "@/hooks/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { getSetupInitialPrompt } from "@proliferate/shared/prompts";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SetupPage() {
	const params = useParams();
	const repoId = params.id as string;

	const [sessionId, setSessionId] = useState<string | null>(null);
	const creationStartedRef = useRef(false);
	const { selectedModel } = useDashboardStore();

	const createConfigurationMutation = useCreateConfiguration();
	const createSessionMutation = useCreateSession();

	// Create configuration and session on mount
	useEffect(() => {
		if (!repoId || sessionId) return;
		if (creationStartedRef.current) return;

		creationStartedRef.current = true;

		const createConfigurationAndSession = async () => {
			try {
				const configurationResult = await createConfigurationMutation.mutateAsync({
					repoIds: [repoId],
				});

				const sessionResult = await createSessionMutation.mutateAsync({
					configurationId: configurationResult.configurationId,
					sessionType: "setup",
					modelId: selectedModel,
					initialPrompt: getSetupInitialPrompt(),
				});

				setSessionId(sessionResult.sessionId);
			} catch {
				creationStartedRef.current = false;
			}
		};

		createConfigurationAndSession();
	}, [repoId, sessionId, selectedModel, createConfigurationMutation, createSessionMutation]);

	const hasError = createConfigurationMutation.isError || createSessionMutation.isError;
	const errorMessage =
		createConfigurationMutation.error?.message ||
		createSessionMutation.error?.message ||
		"Failed to create session";

	if (!sessionId) {
		if (hasError) {
			return (
				<div className="flex h-full items-center justify-center">
					<div className="text-center space-y-4">
						<p className="text-destructive">{errorMessage}</p>
						<Button
							variant="link"
							className="h-auto p-0 text-sm text-primary underline"
							onClick={() => {
								creationStartedRef.current = false;
								createConfigurationMutation.reset();
								createSessionMutation.reset();
							}}
						>
							Try again
						</Button>
					</div>
				</div>
			);
		}

		return <SessionLoadingShell mode="creating" />;
	}

	// CodingSession detects sessionType="setup" and renders SetupSessionChrome automatically
	return (
		<div className="flex h-full flex-col">
			<div className="flex-1 min-h-0">
				<CodingSession
					sessionId={sessionId}
					title="Set up your Environment"
					description="Configure your cloud environment — install dependencies, start services, set up databases. When you're done, save it as a snapshot. Every future session will start from this exact state."
				/>
			</div>
		</div>
	);
}
