"use client";

import { usePreviewPanelStore } from "@/stores/preview-panel";
import type {
	ActionApprovalRequestMessage,
	AutoStartOutputMessage,
	GitResultMessage,
	GitState,
} from "@proliferate/shared";
import dynamic from "next/dynamic";
import { ArtifactsPanel } from "./artifacts-panel";
import { GitPanel } from "./git-panel";
import { PreviewPanel } from "./preview-panel";
import { SettingsPanel } from "./settings-panel";
import { VscodePanel } from "./vscode-panel";

const TerminalPanel = dynamic(() => import("./terminal-panel").then((m) => m.TerminalPanel), {
	ssr: false,
});

export interface SessionPanelProps {
	sessionId?: string;
	activityTick?: number;
	sessionStatus?: string;
	repoId?: string | null;
	configurationId?: string | null;
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
		commands?: import("@proliferate/shared").ConfigurationServiceCommand[],
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
	const { mode, close, setMobileView } = usePreviewPanelStore();

	const handleClose = () => {
		close();
		setMobileView("chat");
	};

	// Settings panel (Session Info + Snapshots + Auto-start)
	if (mode.type === "settings" && sessionProps) {
		return (
			<SettingsPanel
				panelMode={mode}
				onClose={handleClose}
				sessionStatus={sessionProps.sessionStatus}
				repoName={sessionProps.repoName}
				branchName={sessionProps.branchName}
				snapshotId={sessionProps.snapshotId}
				startedAt={sessionProps.startedAt}
				concurrentUsers={sessionProps.concurrentUsers}
				isModal={sessionProps.isModal}
				onSecretsClick={sessionProps.onSecretsClick}
				isMigrating={sessionProps.isMigrating}
				canSnapshot={sessionProps.canSnapshot}
				isSnapshotting={sessionProps.isSnapshotting}
				onSnapshot={sessionProps.onSnapshot}
				repoId={sessionProps.repoId}
				configurationId={sessionProps.configurationId}
				autoStartOutput={sessionProps.autoStartOutput}
				sendRunAutoStart={sessionProps.sendRunAutoStart}
			/>
		);
	}

	// Git panel (Git operations + Changes)
	if (mode.type === "git" && sessionProps) {
		return (
			<GitPanel
				onClose={handleClose}
				panelMode={mode}
				sessionId={sessionProps.sessionId}
				activityTick={sessionProps.activityTick}
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

	// Terminal panel (with services strip)
	if (mode.type === "terminal" && sessionProps?.sessionId) {
		return <TerminalPanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
	}

	// VS Code panel
	if (mode.type === "vscode" && sessionProps?.sessionId) {
		return <VscodePanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
	}

	// Artifacts panel (Actions + File Viewer + Gallery)
	if (
		(mode.type === "artifacts" || mode.type === "file" || mode.type === "gallery") &&
		sessionProps?.sessionId
	) {
		return (
			<ArtifactsPanel
				sessionId={sessionProps.sessionId}
				activityTick={sessionProps.activityTick ?? 0}
				onClose={handleClose}
			/>
		);
	}

	// URL preview
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

	// Should not reach here if panel is open
	return null;
}
