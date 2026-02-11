"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type {
	ActionApprovalRequestMessage,
	AutoStartOutputMessage,
	GitResultMessage,
	GitState,
	VerificationFile,
} from "@proliferate/shared";
import { ArrowLeft, Grid, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ActionsPanel } from "./actions-panel";
import { AutoStartPanel } from "./auto-start-panel";
import { ChangesPanel } from "./changes-panel";
import { FileViewer } from "./file-viewer";
import { GitPanel } from "./git-panel";
import { PreviewPanel } from "./preview-panel";
import { ServicesPanel } from "./services-panel";
import { SessionInfoPanel } from "./session-info-panel";
import { SnapshotsPanel } from "./snapshots-panel";
import { VerificationGallery } from "./verification-gallery";
import { VscodePanel } from "./vscode-panel";

const TerminalPanel = dynamic(() => import("./terminal-panel").then((m) => m.TerminalPanel), {
	ssr: false,
});

export interface SessionPanelProps {
	sessionId?: string;
	activityTick?: number;
	sessionStatus?: string;
	repoId?: string | null;
	prebuildId?: string | null;
	repoName?: string | null;
	branchName?: string | null;
	snapshotId?: string | null;
	startedAt?: string | null;
	concurrentUsers?: number;
	isModal?: boolean;
	onSecretsClick?: () => void;
	isMigrating?: boolean;
	canSnapshot?: boolean;
	isSnapshotting?: boolean;
	onSnapshot?: () => void;
	autoStartOutput?: AutoStartOutputMessage["payload"] | null;
	sendRunAutoStart?: (
		runId: string,
		mode?: "test" | "start",
		commands?: import("@proliferate/shared").PrebuildServiceCommand[],
	) => void;
	gitState?: GitState | null;
	gitResult?: GitResultMessage["payload"] | null;
	sendGetGitStatus?: (workspacePath?: string) => void;
	sendGitCreateBranch?: (branchName: string, workspacePath?: string) => void;
	sendGitCommit?: (
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
	) => void;
	sendGitPush?: (workspacePath?: string) => void;
	sendGitCreatePr?: (
		title: string,
		body?: string,
		baseBranch?: string,
		workspacePath?: string,
	) => void;
	clearGitResult?: () => void;
	pendingApprovals?: ActionApprovalRequestMessage["payload"][];
}

interface RightPanelProps {
	isMobileFullScreen?: boolean;
	sessionProps?: SessionPanelProps;
}

export function RightPanel({ isMobileFullScreen, sessionProps }: RightPanelProps) {
	const { mode, close, openGallery, setMobileView } = usePreviewPanelStore();
	// Track the gallery files when viewing a single file (for back navigation)
	const [galleryContext, setGalleryContext] = useState<VerificationFile[] | null>(null);

	// When showing gallery, save it for back navigation
	useEffect(() => {
		if (mode.type === "gallery") {
			setGalleryContext(mode.files);
		}
	}, [mode]);

	const handleClose = () => {
		close();
		setMobileView("chat");
	};

	// Session info panel
	if (mode.type === "session-info" && sessionProps) {
		return <SessionInfoPanel {...sessionProps} onClose={handleClose} />;
	}

	// Snapshots panel
	if (mode.type === "snapshots" && sessionProps) {
		return (
			<SnapshotsPanel
				snapshotId={sessionProps.snapshotId}
				repoId={sessionProps.repoId}
				prebuildId={sessionProps.prebuildId}
				canSnapshot={sessionProps.canSnapshot}
				isSnapshotting={sessionProps.isSnapshotting}
				onSnapshot={sessionProps.onSnapshot}
				onClose={handleClose}
			/>
		);
	}

	// Git panel
	if (mode.type === "git" && sessionProps) {
		return (
			<GitPanel
				onClose={handleClose}
				gitState={sessionProps.gitState ?? null}
				gitResult={sessionProps.gitResult ?? null}
				sendGetGitStatus={sessionProps.sendGetGitStatus}
				sendGitCreateBranch={sessionProps.sendGitCreateBranch}
				sendGitCommit={sessionProps.sendGitCommit}
				sendGitPush={sessionProps.sendGitPush}
				sendGitCreatePr={sessionProps.sendGitCreatePr}
				clearGitResult={sessionProps.clearGitResult}
			/>
		);
	}

	// Changes panel
	if (mode.type === "changes" && sessionProps?.sessionId) {
		return (
			<ChangesPanel
				sessionId={sessionProps.sessionId}
				activityTick={sessionProps.activityTick ?? 0}
				onClose={handleClose}
			/>
		);
	}

	// Terminal panel
	if (mode.type === "terminal" && sessionProps?.sessionId) {
		return <TerminalPanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
	}

	// VS Code panel
	if (mode.type === "vscode" && sessionProps?.sessionId) {
		return <VscodePanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
	}

	// Actions panel
	if (mode.type === "actions" && sessionProps?.sessionId) {
		return (
			<ActionsPanel
				sessionId={sessionProps.sessionId}
				activityTick={sessionProps.activityTick ?? 0}
				onClose={handleClose}
			/>
		);
	}

	// Services panel
	if (mode.type === "services" && sessionProps?.sessionId) {
		return <ServicesPanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
	}

	// Auto-start panel
	if (mode.type === "service-commands") {
		return (
			<AutoStartPanel
				repoId={sessionProps?.repoId}
				prebuildId={sessionProps?.prebuildId}
				onClose={handleClose}
				autoStartOutput={sessionProps?.autoStartOutput}
				sendRunAutoStart={sessionProps?.sendRunAutoStart}
			/>
		);
	}

	// URL preview uses PreviewPanel which has its own header
	if (mode.type === "url") {
		return (
			<div className="flex flex-col h-full">
				<PreviewPanel
					url={mode.url}
					className="h-full"
					onClose={isMobileFullScreen ? handleClose : undefined}
				/>
			</div>
		);
	}

	// File viewer or gallery
	if (mode.type === "file" || mode.type === "gallery") {
		return (
			<TooltipProvider delayDuration={150}>
				<div className="flex flex-col h-full">
					{/* Header */}
					<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
						<div className="flex items-center gap-2 min-w-0">
							{mode.type === "file" && galleryContext && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 shrink-0"
											onClick={() => openGallery(galleryContext)}
										>
											<ArrowLeft className="h-4 w-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Back to gallery</TooltipContent>
								</Tooltip>
							)}
							<span className="text-sm font-medium truncate">
								{mode.type === "file" ? mode.file.name : "Verification Evidence"}
							</span>
						</div>
						<div className="flex items-center gap-1 shrink-0">
							{mode.type === "file" && galleryContext && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											onClick={() => openGallery(galleryContext)}
										>
											<Grid className="h-4 w-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>View all files</TooltipContent>
								</Tooltip>
							)}
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
										<X className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Close panel</TooltipContent>
							</Tooltip>
						</div>
					</div>

					{/* Content */}
					<div className="flex-1 min-h-0">
						{mode.type === "file" && <FileViewer file={mode.file} />}
						{mode.type === "gallery" && <VerificationGallery files={mode.files} />}
					</div>
				</div>
			</TooltipProvider>
		);
	}

	// Should not reach here if panel is open
	return null;
}
