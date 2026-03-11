"use client";

import { Thread } from "@/components/coding-session/thread";
import { useCodingSessionRuntime } from "@/hooks/sessions/use-coding-session-runtime";
import { AssistantRuntimeProvider } from "@assistant-ui/react";

interface WorkerChatTabProps {
	managerSessionId: string;
	workerStatus: string;
	workerName: string;
}

export function WorkerChatTab({ managerSessionId, workerStatus, workerName }: WorkerChatTabProps) {
	const { runtime, statusMessage, pendingApprovals, wsToken } = useCodingSessionRuntime({
		sessionId: managerSessionId,
		initialTitle: workerName,
	});

	return (
		<div className="flex flex-col -mx-6 -mb-6" style={{ height: "calc(100vh - 240px)" }}>
			<AssistantRuntimeProvider runtime={runtime}>
				<Thread
					title={workerName}
					sessionId={managerSessionId}
					token={wsToken}
					statusMessage={statusMessage}
					pendingApprovals={pendingApprovals}
				/>
			</AssistantRuntimeProvider>
		</div>
	);
}
