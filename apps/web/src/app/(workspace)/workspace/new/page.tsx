"use client";

import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useRepo } from "@/hooks/org/use-repos";
import { useCreateSessionFromRepo } from "@/hooks/sessions/use-create-session";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function NewSessionPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { pendingPrompt, selectedModel } = useDashboardStore();

	const repoId = searchParams.get("repoId");
	const sessionType = (searchParams.get("type") as "setup" | "coding") || "coding";

	const { data: repo } = useRepo(repoId || "");

	const { isPending, isSuccess, isError, errorMessage, stage, retry, create } =
		useCreateSessionFromRepo({
			repoId,
			sessionType,
			modelId: selectedModel,
		});

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

		if (isPending || isSuccess) {
			return;
		}

		void (async () => {
			const sessionId = await create();
			if (sessionId) {
				router.replace(`/workspace/${sessionId}`);
			}
		})();
	}, [repoId, sessionType, isPending, isSuccess, router, create]);

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center space-y-4">
					<p className="text-destructive">{errorMessage || "Failed to create session"}</p>
					<Button
						variant="link"
						className="h-auto p-0 text-sm text-primary underline"
						onClick={retry}
					>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	return (
		<SessionLoadingShell
			mode="creating"
			stage={stage}
			repoName={repo?.githubRepoName}
			initialPrompt={sessionType === "setup" ? pendingPrompt || undefined : undefined}
		/>
	);
}
