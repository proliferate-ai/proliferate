"use client";

import { Button } from "@/components/ui/button";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type {
	ActionApprovalRequestMessage,
	AutoStartOutputMessage,
	GitDiffMessage,
	GitResultMessage,
	GitState,
} from "@proliferate/shared";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Loader2, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { ArtifactsPanel } from "./artifacts-panel";
import { EnvironmentPanel } from "./environment-panel";
import { FilesPanel } from "./files-panel";
import { GitPanel } from "./git-panel";
import { InvestigationPanel } from "./investigation-panel";
import { PanelErrorBoundary } from "./panel-error-boundary";
import { PreviewPanel } from "./preview-panel";
import { ServicesPanel } from "./services-panel";
import { TerminalPanel } from "./terminal-panel";

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
	gitDiff?: GitDiffMessage["payload"] | null;
	sendGetGitStatus?: (workspacePath?: string) => void;
	sendGetGitDiff?: (
		path: string,
		scope?: "unstaged" | "staged" | "full",
		workspacePath?: string,
	) => void;
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
	slackThreadUrl?: string | null;
	workspaceOptions?: Array<{ workspacePath: string; label: string }>;
}

interface RightPanelProps {
	isMobileFullScreen?: boolean;
	sessionProps?: SessionPanelProps;
	previewUrl?: string | null;
	runId?: string;
	isSetupSession?: boolean;
	/** Session kind: "worker" (default coding) or "manager" (simplified panel set). */
	sessionKind?: "worker" | "manager";
}

export function RightPanel({
	isMobileFullScreen: _isMobileFullScreen,
	sessionProps,
	previewUrl,
	runId,
	isSetupSession = false,
	sessionKind = "worker",
}: RightPanelProps) {
	const { mode, togglePanel } = usePreviewPanelStore();
	const repoSettingsHref = sessionProps?.repoId
		? `/settings/repositories/${sessionProps.repoId}`
		: "/settings/repositories";

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

	// Empty state when no panel is selected
	if (mode.type === "none") {
		if (isSetupSession) {
			return (
				<div className="flex h-full items-center justify-center p-4">
					<div className="w-full max-w-sm rounded-lg border border-border bg-muted/30 p-4 space-y-3">
						<p className="text-sm font-medium">Setup session checklist</p>
						<p className="text-xs text-muted-foreground">
							1. Keep iterating with the agent in chat until setup and verification complete.
						</p>
						<p className="text-xs text-muted-foreground">
							2. If credentials are needed, open Environment and create secret files (path +
							contents).
						</p>
						<Button
							size="sm"
							className="h-8 gap-1.5 text-xs"
							onClick={() => togglePanel("environment")}
						>
							<KeyRound className="h-3.5 w-3.5" />
							Open Environment
						</Button>
					</div>
				</div>
			);
		}

		return (
			<div className="flex flex-col h-full items-center justify-center text-muted-foreground">
				<MousePointerClick className="h-8 w-8 mb-3 opacity-40" />
				<p className="text-sm">Select a tool from the top bar</p>
			</div>
		);
	}

	// Investigation mode without a runId
	if (mode.type === "investigation" && !runId) {
		return (
			<div className="flex flex-col h-full items-center justify-center text-muted-foreground">
				<MousePointerClick className="h-8 w-8 mb-3 opacity-40" />
				<p className="text-sm">Select a tool from the top bar</p>
			</div>
		);
	}

	const panelContent = (() => {
		// Environment panel
		if (mode.type === "environment" && sessionProps?.sessionId) {
			if (!isSetupSession) {
				return (
					<div className="flex h-full items-center justify-center p-4">
						<div className="w-full max-w-sm rounded-lg border border-border bg-muted/30 p-4 space-y-3">
							<p className="text-sm font-medium">Environment moved to repository settings</p>
							<p className="text-xs text-muted-foreground">
								Manage environment files and secrets from repository settings.
							</p>
							<Button asChild size="sm" className="h-8 text-xs">
								<Link href={repoSettingsHref}>Open repository settings</Link>
							</Button>
						</div>
					</div>
				);
			}
			return (
				<EnvironmentPanel
					sessionId={sessionProps.sessionId}
					configurationId={sessionProps.configurationId}
					repoId={sessionProps.repoId}
					isSetupSession={isSetupSession}
					workspaceOptions={sessionProps.workspaceOptions}
				/>
			);
		}

		// Git panel
		if (mode.type === "git" && sessionProps) {
			return (
				<GitPanel
					gitState={sessionProps.gitState ?? null}
					gitResult={sessionProps.gitResult ?? null}
					gitDiff={sessionProps.gitDiff ?? null}
					workspaceOptions={sessionProps.workspaceOptions}
					sendGetGitStatus={sessionProps.sendGetGitStatus}
					sendGetGitDiff={sessionProps.sendGetGitDiff}
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
			return <TerminalPanel sessionId={sessionProps.sessionId} />;
		}

		// Services panel
		if (mode.type === "services" && sessionProps?.sessionId) {
			return <ServicesPanel sessionId={sessionProps.sessionId} />;
		}

		// Files panel (G3)
		if (mode.type === "files" && sessionProps?.sessionId) {
			// Manager sessions don't have coding panels (G9)
			if (sessionKind === "manager") {
				return (
					<div className="flex flex-col h-full items-center justify-center text-muted-foreground">
						<p className="text-sm">Files panel is not available for manager sessions</p>
					</div>
				);
			}
			return (
				<FilesPanel
					sessionId={sessionProps.sessionId}
					activityTick={sessionProps.activityTick ?? 0}
				/>
			);
		}

		// Artifacts panel
		if (mode.type === "artifacts" && sessionProps?.sessionId) {
			return (
				<div className="flex h-full flex-col items-center justify-center text-muted-foreground">
					<p className="text-sm font-medium text-foreground">Workspace coming soon</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Use Code, Logs, and Preview while this view is being finalized.
					</p>
				</div>
			);
		}

		if ((mode.type === "file" || mode.type === "gallery") && sessionProps?.sessionId) {
			return (
				<ArtifactsPanel
					sessionId={sessionProps.sessionId}
					activityTick={sessionProps.activityTick ?? 0}
				/>
			);
		}

		// Investigation panel
		if (mode.type === "investigation" && runId) {
			return <InvestigationPanel runId={runId} />;
		}

		// URL preview
		if (mode.type === "url") {
			return (
				<PreviewPanel
					url={mode.url || previewUrl || null}
					sessionId={sessionProps?.sessionId}
					className="h-full"
				/>
			);
		}

		return null;
	})();

	return (
		<AnimatePresence mode="wait">
			<motion.div
				key={mode.type}
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -4 }}
				transition={{ duration: 0.15 }}
				className="h-full w-full"
			>
				<PanelErrorBoundary key={mode.type}>{panelContent}</PanelErrorBoundary>
			</motion.div>
		</AnimatePresence>
	);
}
