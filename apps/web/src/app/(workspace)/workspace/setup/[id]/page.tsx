"use client";

import { CodingSession } from "@/components/coding-session";
import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { HelpLink } from "@/components/help/help-link";
import { SetupIntroModal } from "@/components/sessions/setup-intro-modal";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCreateConfiguration } from "@/hooks/use-configurations";
import { useCreateSession, useFinalizeSetup } from "@/hooks/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { useSetupProgressStore } from "@/stores/setup-progress";
import { Check, Settings } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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

	const { hasActivity, envRequested, verified, snapshotSaved } = useSetupProgressStore();
	const resetProgress = useSetupProgressStore((s) => s.reset);

	// Reset progress store on mount/unmount
	useEffect(() => {
		resetProgress();
		return () => resetProgress();
	}, [resetProgress]);

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
			toast.success("Snapshot saved!", {
				description: "Your environment is ready. Start a coding session to begin building.",
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
			<SetupIntroModal />

			{/* Setup context banner */}
			<div className="flex items-center gap-3 border-b border-border bg-muted/50 px-5 py-2.5 shrink-0">
				<Settings className="h-4 w-4 text-muted-foreground shrink-0" />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-sm font-medium">Setup Session</span>
						<HelpLink topic="setup-sessions" iconOnly />
					</div>
					<span className="text-xs text-muted-foreground block">
						{snapshotSaved
							? "Setup complete \u2014 save the snapshot to finish"
							: verified
								? "Environment verified \u2014 ready to save"
								: envRequested
									? "Secrets requested \u2014 provide them in the chat below"
									: hasActivity
										? "Installing dependencies and configuring services\u2026"
										: "The agent is starting setup\u2026"}
					</span>
				</div>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								onClick={handleFinalize}
								disabled={!sessionId || finalizeSetupMutation.isPending}
								size="sm"
								className="gap-1.5 shrink-0"
							>
								<Check className="h-3.5 w-3.5" />
								{finalizeSetupMutation.isPending ? "Saving..." : "Done — Save Snapshot"}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom" align="end" className="max-w-[240px]">
							Saves this environment as a reusable snapshot. Future coding sessions will boot from
							this state.
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
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
