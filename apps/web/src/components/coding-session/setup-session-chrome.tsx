"use client";

import { Button } from "@/components/ui/button";
import { useFinalizeSetup } from "@/hooks/sessions/use-sessions";
import { startSnapshotProgressToast } from "@/lib/display/snapshot-progress-toast";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface SetupSessionChromeProps {
	sessionId: string;
	/** Explicit repoId when available (e.g. from setup page URL). Optional — handler can derive it. */
	repoId?: string;
	/** Whether the session is in a runnable state (running + has sandbox) */
	canFinalize: boolean;
	/** Display name for the repo (e.g. "org/repo-name") */
	repoName?: string;
	/** @deprecated No longer used — kept for caller compatibility */
	showIntro?: boolean;
}

export function SetupSessionChrome({
	sessionId,
	repoId,
	canFinalize,
	repoName,
}: SetupSessionChromeProps) {
	const router = useRouter();
	const finalizeSetupMutation = useFinalizeSetup();

	const handleSaveSnapshot = async () => {
		const progressToast = startSnapshotProgressToast({
			initialMessage: "Saving setup snapshot...",
		});
		try {
			await finalizeSetupMutation.mutateAsync({
				repoId,
				sessionId,
			});
			progressToast.success(
				"Snapshot saved",
				"Your environment is ready. Start a coding session to begin building.",
			);
			router.push("/dashboard");
		} catch (error) {
			progressToast.error(
				"Failed to save snapshot",
				error instanceof Error ? error.message : "Please try again.",
			);
		} finally {
			progressToast.dispose();
		}
	};

	const isSaving = finalizeSetupMutation.isPending;

	return (
		<div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-sm font-medium truncate">Setup{repoName ? `: ${repoName}` : ""}</span>
				{isSaving && <span className="text-xs text-muted-foreground">Saving snapshot…</span>}
			</div>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					className="h-7"
					onClick={handleSaveSnapshot}
					disabled={!canFinalize || isSaving}
				>
					{isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
					Save Snapshot
				</Button>
			</div>
		</div>
	);
}
