"use client";

import { ActionsContent } from "./actions-panel";
import { PanelShell } from "./panel-shell";

interface ArtifactsPanelProps {
	sessionId: string;
	activityTick: number;
}

export function ArtifactsPanel({ sessionId, activityTick }: ArtifactsPanelProps) {
	return (
		<PanelShell title="Workspace" noPadding>
			<div className="h-full min-h-0">
				<ActionsContent sessionId={sessionId} activityTick={activityTick} />
			</div>
		</PanelShell>
	);
}
