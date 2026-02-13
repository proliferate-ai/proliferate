"use client";

import { SettingsModal } from "@/components/dashboard/settings-modal";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRepo } from "@/hooks/use-repos";
import { useSessionData, useSnapshotSession } from "@/hooks/use-sessions";
import { useSession as useBetterAuthSession } from "@/lib/auth-client";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionApprovalBanner } from "./action-approval-banner";
import type { SessionPanelProps } from "./right-panel";
import { RightPanel } from "./right-panel";
import { SessionHeader } from "./session-header";
import { SessionLoadingShell } from "./session-loading-shell";
import { Thread } from "./thread";
import { SessionContext } from "./tool-ui";
import { useCodingSessionRuntime } from "./use-coding-session-runtime";

interface CodingSessionProps {
	sessionId: string;
	title?: string;
	description?: string;
	initialPrompt?: string;
	initialImages?: string[];
	asModal?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onError?: (error: string) => void;
}

export function CodingSession({
	sessionId,
	title,
	description,
	initialPrompt,
	initialImages,
	asModal = false,
	open = true,
	onOpenChange,
}: CodingSessionProps) {
	const { data: authSession, isPending: authLoading } = useBetterAuthSession();
	const { data: sessionData, isLoading: sessionLoading } = useSessionData(sessionId);
	const { data: repoData } = useRepo(sessionData?.repoId || "");

	const {
		status,
		runtime,
		error,
		previewUrl,
		sessionTitle,
		isMigrating,
		activityTick,
		autoStartOutput,
		sendRunAutoStart,
		gitState,
		gitResult,
		sendGetGitStatus,
		sendGitCreateBranch,
		sendGitCommit,
		sendGitPush,
		sendGitCreatePr,
		clearGitResult,
		pendingApprovals,
		wsToken,
	} = useCodingSessionRuntime({
		sessionId,
		initialPrompt,
		initialImages,
		initialTitle: sessionData?.title ?? null,
		clientType: sessionData?.clientType ?? null,
	});

	const snapshotSession = useSnapshotSession();
	const canSnapshot = sessionData?.status === "running" && !!sessionData?.sandboxId;
	const handleSnapshot = async () => {
		const toastId = toast.loading("Preparing snapshot...");
		const stages = [
			{ delay: 3000, message: "Capturing filesystem..." },
			{ delay: 10000, message: "Compressing data..." },
			{ delay: 25000, message: "Almost done..." },
		];
		const timeouts = stages.map(({ delay, message }) =>
			setTimeout(() => toast.loading(message, { id: toastId }), delay),
		);
		try {
			await snapshotSession.mutateAsync(sessionId);
			toast.success("Snapshot saved", { id: toastId });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save snapshot", {
				id: toastId,
			});
		} finally {
			timeouts.forEach(clearTimeout);
		}
	};

	const { mode, toggleUrlPreview, togglePanel, mobileView, toggleMobileView } =
		usePreviewPanelStore();
	const isPanelOpen = mode.type !== "none";
	const [secretsModalOpen, setSecretsModalOpen] = useState(false);

	// Combine all loading states
	const isLoading =
		authLoading || sessionLoading || status === "loading" || status === "connecting";
	const isSessionCreating = sessionData?.status === "starting" && !sessionData?.sandboxId;

	// Session props for the right panel (session-info & snapshots modes)
	const sessionPanelProps: SessionPanelProps | undefined = sessionData
		? {
				sessionId,
				activityTick,
				sessionStatus: sessionData.status ?? undefined,
				repoId: sessionData.repoId,
				prebuildId: sessionData.prebuildId,
				repoName: repoData?.githubRepoName || sessionData.repo?.githubRepoName,
				branchName: sessionData.branchName,
				snapshotId: sessionData.sandboxId,
				startedAt: sessionData.startedAt,
				concurrentUsers: 1,
				isModal: asModal,
				onSecretsClick: () => setSecretsModalOpen(true),
				isMigrating,
				canSnapshot,
				isSnapshotting: snapshotSession.isPending,
				onSnapshot: handleSnapshot,
				autoStartOutput,
				sendRunAutoStart,
				gitState,
				gitResult,
				sendGetGitStatus,
				sendGitCreateBranch,
				sendGitCommit,
				sendGitPush,
				sendGitCreatePr,
				clearGitResult,
				pendingApprovals,
			}
		: undefined;

	const displayTitle = sessionTitle || sessionData?.title || title;
	const headerDisabled = isLoading || !authSession || !sessionData || status === "error";

	const innerContent = isLoading ? (
		sessionData ? (
			<SessionLoadingShell
				mode={isSessionCreating ? "creating" : "resuming"}
				stage={
					isSessionCreating ? (status === "connecting" ? "provisioning" : "preparing") : undefined
				}
				repoName={repoData?.githubRepoName || sessionData.repo?.githubRepoName}
				initialPrompt={initialPrompt}
				showHeader={false}
			/>
		) : (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		)
	) : !authSession ? (
		<div className="flex h-full items-center justify-center">
			<p className="text-sm text-destructive">Not authenticated</p>
		</div>
	) : !sessionData ? (
		<div className="flex h-full items-center justify-center">
			<p className="text-sm text-destructive">Session not found</p>
		</div>
	) : status === "error" ? (
		<div className="flex h-full items-center justify-center">
			<p className="text-sm text-destructive">{error || "Connection error"}</p>
		</div>
	) : (
		<AssistantRuntimeProvider runtime={runtime}>
			<div className="relative flex h-full">
				{/* Chat area */}
				<div
					className={
						isPanelOpen
							? `relative hidden md:block md:w-1/2 ${mobileView === "chat" ? "!block w-full" : ""}`
							: "relative w-full"
					}
				>
					<SessionContext.Provider value={{ sessionId, repoId: sessionData.repoId ?? undefined }}>
						<Thread title={title} description={description} />
					</SessionContext.Provider>
					{/* Action approval requests */}
					{pendingApprovals.length > 0 && (
						<div className="absolute bottom-20 left-0 right-0 z-10">
							<ActionApprovalBanner
								sessionId={sessionId}
								token={wsToken}
								pendingApprovals={pendingApprovals}
							/>
						</div>
					)}
				</div>

				{/* Right panel — buttons above + rounded card */}
				{isPanelOpen && (
					<div
						className={`hidden md:flex md:flex-col md:w-1/2 p-2 gap-1 ${mobileView === "preview" ? "!flex w-full" : ""}`}
					>
						<div className="flex justify-start shrink-0 px-1">
							<SessionHeader
								error={error}
								panelMode={mode}
								onTogglePreview={() => toggleUrlPreview(previewUrl)}
								onToggleSettings={() => togglePanel("settings")}
								onToggleGit={() => togglePanel("git")}
								onToggleTerminal={() => togglePanel("terminal")}
								onToggleVscode={() => togglePanel("vscode")}
								onToggleArtifacts={() => togglePanel("artifacts")}
								mobileView={mobileView}
								onToggleMobileView={toggleMobileView}
							/>
						</div>
						<div className="flex-1 min-h-0 rounded-xl border bg-background overflow-hidden">
							<RightPanel
								isMobileFullScreen={mobileView === "preview"}
								sessionProps={sessionPanelProps}
							/>
						</div>
					</div>
				)}
			</div>

			<SettingsModal
				open={secretsModalOpen}
				onOpenChange={setSecretsModalOpen}
				defaultTab="secrets"
			/>
		</AssistantRuntimeProvider>
	);

	const content = (
		<div className="relative flex h-full flex-col">
			{/* Always-visible floating title — top left */}
			{displayTitle && (
				<div className="absolute top-2 left-3 z-10">
					<span className="text-sm font-medium text-foreground truncate max-w-[200px] block">
						{displayTitle}
					</span>
				</div>
			)}

			{/* Always-visible floating buttons — top right (only when panel is closed) */}
			{!isPanelOpen && (
				<div className="absolute top-2 right-3 z-10">
					<SessionHeader
						error={headerDisabled ? null : error}
						disabled={headerDisabled}
						panelMode={mode}
						onTogglePreview={() => toggleUrlPreview(previewUrl)}
						onToggleSettings={() => togglePanel("settings")}
						onToggleGit={() => togglePanel("git")}
						onToggleTerminal={() => togglePanel("terminal")}
						onToggleVscode={() => togglePanel("vscode")}
						onToggleArtifacts={() => togglePanel("artifacts")}
						mobileView={mobileView}
						onToggleMobileView={toggleMobileView}
					/>
				</div>
			)}

			{/* Main content (loading shell or runtime) */}
			<div className="flex-1 min-h-0">{innerContent}</div>
		</div>
	);

	if (asModal) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 flex flex-col">
					<DialogTitle className="sr-only">{title || "Coding Session"}</DialogTitle>
					{content}
				</DialogContent>
			</Dialog>
		);
	}

	return content;
}
