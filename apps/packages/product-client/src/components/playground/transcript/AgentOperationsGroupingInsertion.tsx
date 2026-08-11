import { useEffect, useState } from "react";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import { buildPlaygroundSubagentInsertionTranscript } from "#product/lib/domain/chat/__fixtures__/playground/subagent-creation-transcript-fixtures";

export function AgentOperationsGroupingInsertion({
  selectedWorkspaceId,
  stickyBottomInsetPx,
}: {
  selectedWorkspaceId: string | null;
  stickyBottomInsetPx: number;
}) {
  const [settledCount, setSettledCount] = useState<1 | 2>(1);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSettledCount(2), 900);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div className="h-[min(720px,calc(100vh-13rem))] min-h-[420px]">
      <MessageList
        activeSessionId="playground-agent-operations-grouping"
        selectedWorkspaceId={selectedWorkspaceId ?? "playground-workspace"}
        optimisticPrompt={null}
        transcript={buildPlaygroundSubagentInsertionTranscript(settledCount)}
        sessionViewState="working"
        bottomInsetPx={stickyBottomInsetPx}
        onOpenSession={() => {}}
      />
    </div>
  );
}
