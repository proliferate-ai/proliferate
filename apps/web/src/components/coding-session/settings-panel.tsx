"use client";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PreviewMode } from "@/stores/preview-panel";
import type { AutoStartOutputMessage, PrebuildServiceCommand } from "@proliferate/shared";
import { X } from "lucide-react";
import { useState } from "react";
import { AutoStartContent } from "./auto-start-panel";
import { SessionInfoContent } from "./session-info-panel";
import { SnapshotsContent } from "./snapshots-panel";

export interface SettingsPanelProps {
	panelMode: PreviewMode;
	onClose: () => void;
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
	prebuildId?: string | null;
	autoStartOutput?: AutoStartOutputMessage["payload"] | null;
	sendRunAutoStart?: (
		runId: string,
		mode?: "test" | "start",
		commands?: PrebuildServiceCommand[],
	) => void;
}

export function SettingsPanel({
	panelMode,
	onClose,
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
	prebuildId,
	autoStartOutput,
	sendRunAutoStart,
}: SettingsPanelProps) {
	const defaultTab = panelMode.type === "settings" && panelMode.tab ? panelMode.tab : "info";
	const [activeTab, setActiveTab] = useState<string>(defaultTab);

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<span className="text-sm font-medium">Settings</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
								<X className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Close panel</TooltipContent>
					</Tooltip>
				</div>

				{/* Tabs */}
				<Tabs
					value={activeTab}
					onValueChange={setActiveTab}
					className="flex-1 flex flex-col min-h-0"
				>
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
							prebuildId={prebuildId}
							canSnapshot={canSnapshot}
							isSnapshotting={isSnapshotting}
							onSnapshot={onSnapshot}
							onNavigateAutoStart={() => setActiveTab("auto-start")}
						/>
					</TabsContent>

					<TabsContent value="auto-start" className="flex-1 min-h-0 overflow-y-auto mt-0">
						<AutoStartContent
							repoId={repoId}
							prebuildId={prebuildId}
							autoStartOutput={autoStartOutput}
							sendRunAutoStart={sendRunAutoStart}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</TooltipProvider>
	);
}
