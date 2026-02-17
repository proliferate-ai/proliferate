"use client";

import { CodingSession } from "@/components/coding-session";
import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useCreateConfiguration } from "@/hooks/use-configurations";
import { useCreateSession, useFinalizeSetup } from "@/hooks/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { Check, Settings } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SetupPage() {
	const params = useParams();
	const router = useRouter();
	const repoId = params.id as string;

	const [sessionId, setSessionId] = useState<string | null>(null);
	const creationStartedRef = useRef(false);
	const { selectedModel } = useDashboardStore();

	const createConfigurationMutation = useCreateConfiguration();
	const createSessionMutation = useCreateSession();
	const finalizeSetupMutation = useFinalizeSetup();

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
				});

				setSessionId(sessionResult.sessionId);
			} catch {
				creationStartedRef.current = false;
			}
		};

		createConfigurationAndSession();
	}, [repoId, sessionId, selectedModel, createConfigurationMutation, createSessionMutation]);

	const handleFinalize = async () => {
		if (!sessionId) return;

		try {
			await finalizeSetupMutation.mutateAsync({
				repoId,
				sessionId,
			});
			router.push("/dashboard");
		} catch (error) {
			console.error("Failed to finalize setup:", error);
		}
	};

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

	return (
		<div className="flex h-full flex-col">
			{/* Setup context banner */}
			<div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 shrink-0">
				<Settings className="h-4 w-4 text-muted-foreground shrink-0" />
				<div className="flex-1 min-w-0">
					<span className="text-sm font-medium">Setting up your environment</span>
					<span className="text-xs text-muted-foreground ml-2">
						Install dependencies, configure services, and save when ready
					</span>
				</div>
				<Button
					onClick={handleFinalize}
					disabled={!sessionId || finalizeSetupMutation.isPending}
					size="sm"
					className="gap-1.5 shrink-0"
				>
					<Check className="h-3.5 w-3.5" />
					{finalizeSetupMutation.isPending ? "Saving..." : "Done — Save Snapshot"}
				</Button>
			</div>

			{/* Session */}
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
