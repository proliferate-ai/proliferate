"use client";

import { CodingSession } from "@/components/coding-session";
import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useCreateBaseline } from "@/hooks/sessions/use-baselines";
import { useCreateConfiguration } from "@/hooks/sessions/use-configurations";
import { useCreateSession } from "@/hooks/sessions/use-sessions";
import { orpc } from "@/lib/infra/orpc";
import { useDashboardStore } from "@/stores/dashboard";
import { getSetupInitialPrompt } from "@proliferate/shared/prompts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SetupPage() {
	const params = useParams();
	const repoId = params.id as string;

	const [sessionId, setSessionId] = useState<string | null>(null);
	const creationStartedRef = useRef(false);
	const { selectedModel } = useDashboardStore();

	// Check setup session invariant: at most one non-terminal setup session per repo
	const {
		data: invariantData,
		isLoading: invariantLoading,
		isError: invariantError,
	} = useQuery({
		...orpc.baselines.checkSetupInvariant.queryOptions({ input: { repoId } }),
		enabled: !!repoId && !sessionId,
	});

	const existingSessionId = invariantData?.existingSessionId ?? null;

	const createBaseline = useCreateBaseline();
	const createConfigurationMutation = useCreateConfiguration();
	const createSessionMutation = useCreateSession();

	// Create baseline, configuration, and session on mount (only if no existing setup session)
	useEffect(() => {
		if (!repoId || sessionId) return;
		if (creationStartedRef.current) return;
		if (invariantLoading || invariantError) return;
		if (existingSessionId) return;

		creationStartedRef.current = true;

		const create = async () => {
			try {
				// Create a baseline record (starts in validating status)
				const baselineResult = await createBaseline.mutateAsync({
					repoId,
				});

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

		create();
	}, [
		repoId,
		sessionId,
		selectedModel,
		invariantLoading,
		invariantError,
		existingSessionId,
		createBaseline,
		createConfigurationMutation,
		createSessionMutation,
	]);

	// Existing non-terminal setup session found — offer to resume
	if (existingSessionId && !sessionId) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center space-y-4 max-w-md">
					<p className="text-sm text-foreground">
						A setup session is already running for this repository.
					</p>
					<p className="text-xs text-muted-foreground">
						Only one setup session can run at a time per repository.
					</p>
					<div className="flex items-center justify-center gap-3">
						<Button size="sm" asChild>
							<Link href={`/session/${existingSessionId}`}>Resume existing session</Link>
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link href={`/settings/repositories/${repoId}`}>Back to repository</Link>
						</Button>
					</div>
				</div>
			</div>
		);
	}

	const hasError =
		createBaseline.isError || createConfigurationMutation.isError || createSessionMutation.isError;
	const errorMessage =
		createBaseline.error?.message ||
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
								createBaseline.reset();
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
