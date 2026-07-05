import type { ReactNode } from "react";
import { Settings } from "@proliferate/ui/icons";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import { BashCommandCall } from "@/components/workspace/chat/tool-calls/BashCommandCall";
import { CoworkArtifactToolActionRow } from "@/components/workspace/chat/tool-calls/CoworkArtifactToolActionRow";
import { FileChangeCall } from "@/components/workspace/chat/tool-calls/FileChangeCall";
import { FileReadCall } from "@/components/workspace/chat/tool-calls/FileReadCall";
import { GenericToolResultRow } from "@/components/workspace/chat/tool-calls/GenericToolResultRow";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import type { ScenarioKey } from "@/config/playground";
import { PLAYGROUND_END_TURN_DIFF_TRANSCRIPT } from "@/lib/domain/chat/__fixtures__/playground/git-diff-fixtures";
import {
  PLAYGROUND_COWORK_ARTIFACT_TOOL_CALL,
} from "@/lib/domain/chat/__fixtures__/playground/tool-artifact-transcript-fixtures";
import {
  PLAYGROUND_SUBAGENT_CREATION_GROUP_TRANSCRIPT,
  PLAYGROUND_SUBAGENT_CREATION_SINGLE_TRANSCRIPT,
} from "@/lib/domain/chat/__fixtures__/playground/subagent-creation-transcript-fixtures";
import {
  PLAYGROUND_SUBAGENT_PARENT_SEND_TRANSCRIPT,
} from "@/lib/domain/chat/__fixtures__/playground/subagent-parent-send-transcript-fixtures";
import {
  PLAYGROUND_SUBAGENT_ACTIVITY_CONCURRENT,
  PLAYGROUND_SUBAGENT_ACTIVITY_DONE,
  PLAYGROUND_SUBAGENT_ACTIVITY_FAILED,
  PLAYGROUND_SUBAGENT_ACTIVITY_RUNNING,
} from "@/lib/domain/chat/__fixtures__/playground/subagent-activity-transcript-fixtures";
import {
  PLAYGROUND_SUBAGENT_TRANSCRIPT,
} from "@/lib/domain/chat/__fixtures__/playground/subagent-tool-transcript-fixtures";
import {
  PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT,
} from "@/lib/domain/chat/__fixtures__/playground/subagent-wake-transcript-fixtures";
import { TranscriptPreviewShell } from "@/components/playground/transcript/PlaygroundTranscriptShell";

export function renderPlaygroundToolTranscript(
  scenario: ScenarioKey,
  selectedWorkspaceId: string | null,
  stickyBottomInsetPx: number,
): ReactNode | null {
  switch (scenario) {
    case "tool-bash-running":
      return (
        <TranscriptPreviewShell>
          <BashCommandCall
            command="pnpm --dir desktop exec vitest run src/config/playground.test.ts"
            output="RUN  src/config/playground.test.ts\n"
            status="running"
            duration="for 12s"
          />
        </TranscriptPreviewShell>
      );
    case "tool-bash-completed":
      return (
        <TranscriptPreviewShell>
          <BashCommandCall
            command="pnpm --dir desktop exec tsc --noEmit"
            output="Done in 4.2s\n"
            status="completed"
            duration="for 4s"
          />
        </TranscriptPreviewShell>
      );
    case "tool-bash-failed":
      return (
        <TranscriptPreviewShell>
          <BashCommandCall
            command="pnpm --dir desktop exec vite build"
            output="error TS2322: Type 'string' is not assignable to type 'number'.\n"
            status="failed"
            duration="for 7s"
          />
        </TranscriptPreviewShell>
      );
    case "tool-read-preview":
      return (
        <TranscriptPreviewShell>
          <FileReadCall
            path="/Users/pablo/proliferate/apps/desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx"
            workspacePath="apps/desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx"
            basename="ToolActionRow.tsx"
            scope="range"
            startLine={1}
            endLine={10}
            preview={"export function ToolActionRow() {\n  return null;\n}"}
            status="completed"
            defaultExpanded
          />
        </TranscriptPreviewShell>
      );
    case "tool-file-change-running":
      return (
        <TranscriptPreviewShell>
          <FileChangeCall
            operation="edit"
            path="/Users/pablo/proliferate/README.md"
            workspacePath="README.md"
            basename="README.md"
            additions={3}
            deletions={1}
            status="running"
            duration="for 9s"
          />
        </TranscriptPreviewShell>
      );
    case "tool-file-change-failed":
      return (
        <TranscriptPreviewShell>
          <FileChangeCall
            operation="edit"
            path="/Users/pablo/proliferate/apps/desktop/src/App.tsx"
            workspacePath="apps/desktop/src/App.tsx"
            basename="App.tsx"
            preview={"<<<<<<< ours\n<App />\n=======\n<Broken />\n>>>>>>> theirs\n"}
            status="failed"
            duration="for 3s"
            defaultExpanded
          />
        </TranscriptPreviewShell>
      );
    case "tool-file-change-diff":
      return (
        <TranscriptPreviewShell>
          <FileChangeCall
            operation="edit"
            path="/Users/pablo/proliferate/README.md"
            workspacePath="README.md"
            basename="README.md"
            additions={2}
            deletions={1}
            patch={"@@ -1,3 +1,4 @@\n Proliferate\n-Old transcript rows\n+Compact transcript rows\n+Visible nested tool calls\n"}
            status="completed"
          />
        </TranscriptPreviewShell>
      );
    case "tool-reasoning":
      return (
        <TranscriptPreviewShell>
          <ReasoningBlock content={"Inspecting transcript rendering paths.\nChecking subagent nested tool output.\nChoosing the compact row migration."} />
        </TranscriptPreviewShell>
      );
    case "tool-cowork-artifact":
      return (
        <TranscriptPreviewShell>
          <CoworkArtifactToolActionRow item={PLAYGROUND_COWORK_ARTIFACT_TOOL_CALL} />
        </TranscriptPreviewShell>
      );
    case "tool-generic-result":
      return (
        <TranscriptPreviewShell>
          <GenericToolResultRow
            icon={<Settings className="size-3 text-faint" />}
            label={<span className="font-[460] text-foreground/90">MCP tool</span>}
            hint="github.search_pull_requests"
            status="completed"
            resultText={'{\n  "total_count": 3,\n  "items": ["#123", "#124", "#125"]\n}'}
          />
        </TranscriptPreviewShell>
      );
    case "tool-subagent-task":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_TRANSCRIPT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "tool-subagent-creation-single":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-creation-single"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_CREATION_SINGLE_TRANSCRIPT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "tool-subagent-creations":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-creations"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_CREATION_GROUP_TRANSCRIPT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "subagent-activity-running":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-activity-running"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_ACTIVITY_RUNNING}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "subagent-activity-done":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-activity-done"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_ACTIVITY_DONE}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "subagent-activity-failed":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-activity-failed"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_ACTIVITY_FAILED}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "subagent-activity-concurrent":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-activity-concurrent"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_ACTIVITY_CONCURRENT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "subagent-parent-send-card":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-child"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_PARENT_SEND_TRANSCRIPT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "end-turn-multi-file-diff":
      return (
        <MessageListTranscript
          activeSessionId="playground-end-turn-diff"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_END_TURN_DIFF_TRANSCRIPT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    case "subagent-wake-card":
      return (
        <MessageListTranscript
          activeSessionId="playground-subagent-wake"
          selectedWorkspaceId={selectedWorkspaceId}
          transcript={PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      );
    default:
      return null;
  }
}

function MessageListTranscript({
  activeSessionId,
  selectedWorkspaceId,
  transcript,
  stickyBottomInsetPx,
}: {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  transcript: Parameters<typeof MessageList>[0]["transcript"];
  stickyBottomInsetPx: number;
}) {
  return (
    <div className="h-[min(720px,calc(100vh-13rem))] min-h-[420px]">
      <MessageList
        activeSessionId={activeSessionId}
        selectedWorkspaceId={selectedWorkspaceId ?? "playground-workspace"}
        optimisticPrompt={null}
        transcript={transcript}
        sessionViewState="idle"
        bottomInsetPx={stickyBottomInsetPx}
        onOpenSession={() => {}}
      />
    </div>
  );
}
