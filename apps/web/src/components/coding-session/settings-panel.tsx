"use client";

import type { AutoStartOutputMessage, ConfigurationServiceCommand } from "@proliferate/shared";
import { AutoStartContent } from "./auto-start-panel";
import { PanelShell } from "./panel-shell";
import { SessionInfoContent } from "./session-info-panel";
import { SnapshotsContent } from "./snapshots-panel";

export interface SettingsPanelProps {
	// Session info
	sessionStatus?: string;
	repoName?: string | null;
	branchName?: string | null;
	snapshotId?: string | null;
	startedAt?: string | null;
	concurrentUsers?: number;
	isModal?: boolean;
	isMigrating?: boolean;
	// Snapshots
	canSnapshot?: boolean;
	isSnapshotting?: boolean;
	onSnapshot?: () => void;
	// Auto-start
	repoId?: string | null;
	configurationId?: string | null;
	autoStartOutput?: AutoStartOutputMessage["payload"] | null;
	sendRunAutoStart?: (
		runId: string,
		mode?: "test" | "start",
		commands?: ConfigurationServiceCommand[],
	) => void;
}

export function SettingsPanel({
	sessionStatus,
	repoName,
	branchName,
	snapshotId,
	startedAt,
	concurrentUsers,
	isModal,
	isMigrating,
	canSnapshot,
	isSnapshotting,
	onSnapshot,
	repoId,
	configurationId,
	autoStartOutput,
	sendRunAutoStart,
}: SettingsPanelProps) {
	return (
		<PanelShell title="Settings" noPadding>
			<div className="flex-1 min-h-0 overflow-y-auto">
				{/* Session Info */}
				<SessionInfoContent
					sessionStatus={sessionStatus}
					repoName={repoName}
					branchName={branchName}
					snapshotId={snapshotId}
					startedAt={startedAt}
					concurrentUsers={concurrentUsers}
					isModal={isModal}
					isMigrating={isMigrating}
				/>

				<div className="border-b border-border/50 mx-4" />

				{/* Snapshots */}
				<SnapshotsContent
					snapshotId={snapshotId}
					repoId={repoId}
					configurationId={configurationId}
					canSnapshot={canSnapshot}
					isSnapshotting={isSnapshotting}
					onSnapshot={onSnapshot}
				/>

				<div className="border-b border-border/50 mx-4" />

				{/* Auto-start */}
				<AutoStartContent
					repoId={repoId}
					configurationId={configurationId}
					autoStartOutput={autoStartOutput}
					sendRunAutoStart={sendRunAutoStart}
				/>
			</div>
		</PanelShell>
	);
}
