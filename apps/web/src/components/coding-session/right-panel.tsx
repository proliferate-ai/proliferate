"use client";

import { usePreviewPanelStore } from "@/stores/preview-panel";
import type {
	ActionApprovalRequestMessage,
	AutoStartOutputMessage,
	GitResultMessage,
	GitState,
} from "@proliferate/shared";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { ArtifactsPanel } from "./artifacts-panel";
import { GitPanel } from "./git-panel";
import { PreviewPanel } from "./preview-panel";
import { SettingsPanel } from "./settings-panel";
import { VscodePanel } from "./vscode-panel";

const TerminalPanel = dynamic(() => import("./terminal-panel").then((m) => m.TerminalPanel), {
	ssr: false,
});

const ServicesPanel = dynamic(() => import("./services-panel").then((m) => m.ServicesPanel), {
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
	previewUrl?: string | null;
}

export function RightPanel({ isMobileFullScreen, sessionProps, previewUrl }: RightPanelProps) {
	const { mode, close, setMobileView } = usePreviewPanelStore();

	const handleClose = () => {
		close();
		setMobileView("chat");
	};

	// If session isn't ready, show loading placeholder
	if (!sessionProps?.sessionId && mode.type !== "url") {
		return (
			<div className="flex flex-col h-full">
				<div className="flex-1 flex items-center justify-center">
					<div className="flex flex-col items-center gap-3">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Waiting for session...</p>
					</div>
				</div>
			</div>
		);
	}

	const panelContent = (() => {
		// Settings panel
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
					prebuildId={sessionProps.prebuildId}
					autoStartOutput={sessionProps.autoStartOutput}
					sendRunAutoStart={sessionProps.sendRunAutoStart}
				/>
			);
		}

		// Git panel
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

		// Terminal panel
		if (mode.type === "terminal" && sessionProps?.sessionId) {
			return <TerminalPanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
		}

		// Services panel
		if (mode.type === "services" && sessionProps?.sessionId) {
			return <ServicesPanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
		}

		// VS Code panel
		if (mode.type === "vscode" && sessionProps?.sessionId) {
			return <VscodePanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
		}

		// Artifacts panel
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
				<PreviewPanel
					url={mode.url || previewUrl || null}
					className="h-full"
					onClose={isMobileFullScreen ? handleClose : undefined}
				/>
			);
		}

		return null;
	})();

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 min-h-0">{panelContent}</div>
		</div>
	);
}
