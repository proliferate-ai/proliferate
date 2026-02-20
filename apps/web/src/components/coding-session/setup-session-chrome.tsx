"use client";

import { HelpLink } from "@/components/help/help-link";
import { SetupIntroModal } from "@/components/sessions/setup-intro-modal";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFinalizeSetup } from "@/hooks/use-sessions";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { useSetupProgressStore } from "@/stores/setup-progress";
import { Check, KeyRound, MessageSquare, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

interface SetupSessionChromeProps {
	sessionId: string;
	/** Explicit repoId when available (e.g. from setup page URL). Optional — handler can derive it. */
	repoId?: string;
	/** Whether the session is in a runnable state (running + has sandbox) */
	canFinalize: boolean;
	/** Show SetupIntroModal (first-time user education) */
	showIntro?: boolean;
}

export function SetupSessionChrome({
	sessionId,
	repoId,
	canFinalize,
	showIntro = false,
}: SetupSessionChromeProps) {
	const router = useRouter();
	const finalizeSetupMutation = useFinalizeSetup();
	const mode = usePreviewPanelStore((s) => s.mode);
	const togglePanel = usePreviewPanelStore((s) => s.togglePanel);

	const { hasActivity, envRequested, verified, snapshotSaved } = useSetupProgressStore(
		(s) => s.progress,
	);
	const setActiveSession = useSetupProgressStore((s) => s.setActiveSession);
	const resetProgress = useSetupProgressStore((s) => s.reset);

	const openEnvironmentPanel = () => {
		if (mode.type !== "environment") {
			togglePanel("environment");
		}
	};

	// Register this session as the active one for progress tracking
	useEffect(() => {
		setActiveSession(sessionId);
		return () => resetProgress(sessionId);
	}, [sessionId, setActiveSession, resetProgress]);

	const handleFinalize = async () => {
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
			toast.error("Failed to save snapshot", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	const progressText = snapshotSaved
		? "Setup complete \u2014 save the snapshot to finish"
		: verified
			? "Environment verified \u2014 ready to save"
			: envRequested
				? "Secrets requested \u2014 open Environment and create secret files"
				: hasActivity
					? "Installing dependencies and configuring services\u2026"
					: "The agent is starting setup\u2026";

	return (
		<>
			{showIntro && <SetupIntroModal />}
			<div className="border-b border-border bg-muted/50 px-5 py-2.5 shrink-0">
				<div className="flex items-center gap-3">
					<Settings className="h-4 w-4 text-muted-foreground shrink-0" />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-1.5">
							<span className="text-sm font-medium">Setup Session</span>
							<HelpLink topic="setup-sessions" iconOnly />
						</div>
						<span className="text-xs text-muted-foreground block">{progressText}</span>
					</div>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									onClick={handleFinalize}
									disabled={!canFinalize || finalizeSetupMutation.isPending}
									size="sm"
									className="gap-1.5 shrink-0"
								>
									<Check className="h-3.5 w-3.5" />
									{finalizeSetupMutation.isPending ? "Saving..." : "Done \u2014 Save Snapshot"}
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom" align="end" className="max-w-[240px]">
								Saves this environment as a reusable snapshot. Future coding sessions will boot from
								this state.
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>
				<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
					<span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1">
						<MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
						{verified
							? "Agent setup and verification complete"
							: "Iterate with the agent until setup and verification finish"}
					</span>
					<span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1">
						<KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
						{envRequested
							? "Action needed: create/update secret files"
							: "If credentials are needed, configure them in Environment"}
					</span>
					<Button
						variant="outline"
						size="sm"
						className="h-7 gap-1.5 text-xs"
						onClick={openEnvironmentPanel}
					>
						<KeyRound className="h-3.5 w-3.5" />
						Open Environment
					</Button>
				</div>
			</div>
		</>
	);
}
