"use client";

import { useHasSlackInstallation } from "@/hooks/use-integrations";
import {
	useSessionNotificationSubscription,
	useSubscribeNotifications,
	useUnsubscribeNotifications,
} from "@/hooks/use-sessions";
import type { AutoStartOutputMessage, ConfigurationServiceCommand } from "@proliferate/shared";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { AutoStartContent } from "./auto-start-panel";
import { PanelShell } from "./panel-shell";
import { SessionInfoContent } from "./session-info-panel";
import { SnapshotsContent } from "./snapshots-panel";

export interface SettingsPanelProps {
	// Session identity
	sessionId?: string;
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
	// Slack
	slackThreadUrl?: string | null;
}

export function SettingsPanel({
	sessionId,
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
	slackThreadUrl,
}: SettingsPanelProps) {
	const canSubscribe = sessionStatus === "running" || sessionStatus === "starting";
	const { data: isSubscribed } = useSessionNotificationSubscription(
		sessionId ?? "",
		canSubscribe && !!sessionId,
	);
	const subscribeNotifications = useSubscribeNotifications();
	const unsubscribeNotifications = useUnsubscribeNotifications();
	const { hasSlack } = useHasSlackInstallation();

	const handleToggleNotifications = async () => {
		if (!sessionId) return;
		try {
			if (isSubscribed) {
				await unsubscribeNotifications.mutateAsync({ sessionId });
				toast.success("Notifications turned off");
			} else {
				await subscribeNotifications.mutateAsync({ sessionId });
				toast.success("You'll be notified when this session completes");
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to update notifications";
			toast.error(message);
		}
	};

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
					slackThreadUrl={slackThreadUrl}
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

				{/* Notifications */}
				{canSubscribe && sessionId && (
					<>
						<div className="border-b border-border/50 mx-4" />
						<div className="px-4 py-3">
							<button
								type="button"
								className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full disabled:opacity-50 disabled:pointer-events-none"
								onClick={handleToggleNotifications}
								disabled={!hasSlack}
							>
								{isSubscribed ? (
									<BellOff className="h-3.5 w-3.5" />
								) : (
									<Bell className="h-3.5 w-3.5" />
								)}
								<div>
									<span>{isSubscribed ? "Notifications on" : "Notify me when done"}</span>
									{!hasSlack && (
										<span className="block text-[11px] text-muted-foreground">
											Connect Slack in Settings
										</span>
									)}
								</div>
							</button>
						</div>
					</>
				)}
			</div>
		</PanelShell>
	);
}
