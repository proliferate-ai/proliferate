"use client";

import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useCreateConfiguration } from "@/hooks/use-configurations";
import { useRepo } from "@/hooks/use-repos";
import { useCreateSession } from "@/hooks/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

export default function NewSessionPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { pendingPrompt, selectedModel } = useDashboardStore();

	const repoId = searchParams.get("repoId");
	const sessionType = (searchParams.get("type") as "setup" | "coding") || "coding";

	const { data: repo } = useRepo(repoId || "");
	const creationStartedRef = useRef(false);

	const createConfiguration = useCreateConfiguration();
	const createSession = useCreateSession();

	// Combined state for the two-step creation process
	const isPending = createConfiguration.isPending || createSession.isPending;
	const isSuccess = createSession.isSuccess;
	const isError = createConfiguration.isError || createSession.isError;
	const error = createConfiguration.error || createSession.error;

	const createSessionFromRepo = useCallback(async () => {
		// Step 1: Create configuration with single repo
		const configurationResult = await createConfiguration.mutateAsync({ repoIds: [repoId!] });

		// Step 2: Create session with the configuration
		const sessionResult = await createSession.mutateAsync({
			configurationId: configurationResult.configurationId,
			sessionType,
			modelId: selectedModel,
		});
		return sessionResult;
	}, [repoId, sessionType, selectedModel, createConfiguration, createSession]);

	// Trigger creation once
	useEffect(() => {
		if (!repoId) {
			router.replace("/dashboard");
			return;
		}

		// Setup sessions have a dedicated page with title, description, and "Done" button
		if (sessionType === "setup") {
			router.replace(`/workspace/setup/${repoId}`);
			return;
		}

		// Only create once
		if (creationStartedRef.current || isPending || isSuccess) {
			return;
		}

		creationStartedRef.current = true;
		void (async () => {
			try {
				const data = await createSessionFromRepo();
				router.replace(`/workspace/${data.sessionId}`);
			} catch {
				creationStartedRef.current = false;
			}
		})();
	}, [repoId, sessionType, isPending, isSuccess, router, createSessionFromRepo]);

	// Reset on error
	useEffect(() => {
		if (isError) {
			creationStartedRef.current = false;
		}
	}, [isError]);

	const resetMutations = () => {
		creationStartedRef.current = false;
		createConfiguration.reset();
		createSession.reset();
	};

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center space-y-4">
					<p className="text-destructive">
						{error instanceof Error ? error.message : "Failed to create session"}
					</p>
					<Button
						variant="link"
						className="h-auto p-0 text-sm text-primary underline"
						onClick={resetMutations}
					>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	const stage = createSession.isPending ? "provisioning" : "preparing";

	return (
		<SessionLoadingShell
			mode="creating"
			stage={stage}
			repoName={repo?.githubRepoName}
			initialPrompt={sessionType === "setup" ? pendingPrompt || undefined : undefined}
		/>
	);
}
