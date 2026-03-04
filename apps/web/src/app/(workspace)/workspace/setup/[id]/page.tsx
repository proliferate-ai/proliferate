"use client";

import { CodingSession } from "@/components/coding-session/coding-session";
import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { ExistingSetupSession } from "@/components/workspace/existing-setup-session";
import { SessionCreationError } from "@/components/workspace/session-creation-error";
import { useSetupSession } from "@/hooks/sessions/use-setup-session";
import { useDashboardStore } from "@/stores/dashboard";
import { useParams } from "next/navigation";

export default function SetupPage() {
	const params = useParams();
	const repoId = params.id as string;
	const { selectedModel } = useDashboardStore();

	const { sessionId, existingSessionId, isError, errorMessage, retry } = useSetupSession({
		repoId,
		modelId: selectedModel,
	});

	if (existingSessionId && !sessionId) {
		return <ExistingSetupSession existingSessionId={existingSessionId} repoId={repoId} />;
	}

	if (!sessionId) {
		if (isError) {
			return <SessionCreationError message={errorMessage} onRetry={retry} />;
		}

		return <SessionLoadingShell mode="creating" />;
	}

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
