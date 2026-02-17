"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PreviewMode } from "@/stores/preview-panel";
import type { AutoStartOutputMessage, ConfigurationServiceCommand } from "@proliferate/shared";
import { useState } from "react";
import { AutoStartContent } from "./auto-start-panel";
import { PanelShell } from "./panel-shell";
import { SessionInfoContent } from "./session-info-panel";
import { SnapshotsContent } from "./snapshots-panel";

export interface SettingsPanelProps {
	panelMode: PreviewMode;
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
	panelMode,
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
	const defaultTab = panelMode.type === "settings" && panelMode.tab ? panelMode.tab : "info";
	const [activeTab, setActiveTab] = useState<string>(defaultTab);

	return (
		<PanelShell title="Settings" noPadding>
			<Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col min-h-0">
				<div className="px-3 pt-2">
					<TabsList className="w-full">
						<TabsTrigger value="info" className="flex-1 text-xs">
							Info
						</TabsTrigger>
						<TabsTrigger value="snapshots" className="flex-1 text-xs">
							Snapshots
						</TabsTrigger>
						<TabsTrigger value="auto-start" className="flex-1 text-xs">
							Auto-start
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="info" className="flex-1 min-h-0 overflow-y-auto mt-0">
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
				</TabsContent>

				<TabsContent value="snapshots" className="flex-1 min-h-0 overflow-y-auto mt-0">
					<SnapshotsContent
						snapshotId={snapshotId}
						repoId={repoId}
						configurationId={configurationId}
						canSnapshot={canSnapshot}
						isSnapshotting={isSnapshotting}
						onSnapshot={onSnapshot}
						onNavigateAutoStart={() => setActiveTab("auto-start")}
					/>
				</TabsContent>

				<TabsContent value="auto-start" className="flex-1 min-h-0 overflow-y-auto mt-0">
					<AutoStartContent
						repoId={repoId}
						configurationId={configurationId}
						autoStartOutput={autoStartOutput}
						sendRunAutoStart={sendRunAutoStart}
					/>
				</TabsContent>
			</Tabs>
		</PanelShell>
	);
}
