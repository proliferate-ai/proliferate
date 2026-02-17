"use client";

import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useCreatePrebuild } from "@/hooks/use-prebuilds";
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

	const createPrebuild = useCreatePrebuild();
	const createSession = useCreateSession();

	// Combined state for the two-step creation process
	const isPending = createPrebuild.isPending || createSession.isPending;
	const isSuccess = createSession.isSuccess;
	const isError = createPrebuild.isError || createSession.isError;
	const error = createPrebuild.error || createSession.error;

	const createSessionFromRepo = useCallback(async () => {
		// Step 1: Create prebuild with single repo
		const prebuildResult = await createPrebuild.mutateAsync({ repoIds: [repoId!] });

		// Step 2: Create session with the prebuild
		const sessionResult = await createSession.mutateAsync({
			prebuildId: prebuildResult.prebuildId,
			sessionType,
			modelId: selectedModel,
		});
		return sessionResult;
	}, [repoId, sessionType, selectedModel, createPrebuild, createSession]);

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
		createPrebuild.reset();
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
