import type { ReactNode } from "react";
import { ProposedPlanCard } from "@/components/workspace/chat/transcript/ProposedPlanCard";
import { AssistantMessage } from "@/components/workspace/chat/transcript/AssistantMessage";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";
import { BashCommandCall } from "@/components/workspace/chat/tool-calls/BashCommandCall";
import { CoworkArtifactToolActionRow } from "@/components/workspace/chat/tool-calls/CoworkArtifactToolActionRow";
import { FileChangeCall } from "@/components/workspace/chat/tool-calls/FileChangeCall";
import { FileReadCall } from "@/components/workspace/chat/tool-calls/FileReadCall";
import { GenericToolResultRow } from "@/components/workspace/chat/tool-calls/GenericToolResultRow";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import { ToolActionDetailsPanel } from "@/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { ToolActionRow } from "@/components/workspace/chat/tool-calls/ToolActionRow";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { CircleAlert, Settings, Sparkles } from "@/components/ui/icons";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tool-call-layout";
import {
  CLAUDE_PLAN_LONG,
  CLAUDE_PLAN_SHORT,
  PLAYGROUND_COWORK_ARTIFACT_TOOL_CALL,
  PLAYGROUND_SUBAGENT_TRANSCRIPT,
  PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT,
} from "@/lib/domain/chat/__fixtures__/playground";
import type { PlaygroundScenarioSelection } from "@/config/playground";
import type { PlaygroundReplayState } from "@/hooks/playground/use-replay-session";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { useHarnessStore } from "@/stores/sessions/harness-store";

interface PlaygroundTranscriptProps {
  selection: PlaygroundScenarioSelection;
  replay: PlaygroundReplayState;
}

export function PlaygroundTranscript({ selection, replay }: PlaygroundTranscriptProps) {
  const replaySlot = useHarnessStore((state) =>
    replay.sessionId ? state.sessionSlots[replay.sessionId] ?? null : null
  );
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);

  if (selection.kind === "recording") {
    if (replay.error) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {replay.error}
        </div>
      );
    }
    if (!replay.enabled) {
      return (
        <div className="text-sm text-muted-foreground">
          Replay is disabled for this runtime.
        </div>
      );
    }
    if (!replay.sessionId || !replaySlot) {
      return (
        <div className="text-sm text-muted-foreground">
          Loading replay session...
        </div>
      );
    }
    return (
      <div className="h-[min(720px,calc(100vh-13rem))] min-h-[420px]">
        <MessageList
          activeSessionId={replay.sessionId}
          selectedWorkspaceId={selectedWorkspaceId ?? replay.workspaceId}
          optimisticPrompt={replaySlot.optimisticPrompt}
          transcript={replaySlot.transcript}
          sessionViewState={resolveSessionViewState(replaySlot)}
        />
      </div>
    );
  }

  const scenario = selection.key;

  if (scenario === "claude-plan-short") {
    return (
      <ProposedPlanCard
        content={CLAUDE_PLAN_SHORT}
        isStreaming={false}
        decisionState="pending"
        nativeResolutionState="none"
        decisionVersion={1}
        onApprove={noop}
        onReject={noop}
      />
    );
  }
  if (scenario === "claude-plan-long") {
    return (
      <ProposedPlanCard
        content={CLAUDE_PLAN_LONG}
        isStreaming={false}
        decisionState="approved"
        nativeResolutionState="finalized"
        decisionVersion={2}
        onImplementHere={noop}
      />
    );
  }
  if (scenario === "status-background") {
    return (
      <TranscriptPreviewShell>
        <AssistantMessage content="I’ll connect the MCP server and continue once authentication is ready." />
        <TransientStatusRow text="Authenticating MCP Google… follow the browser prompt if it appears." />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "status-hook-running") {
    return (
      <TranscriptPreviewShell>
        <HookPreview status="running" title="Hook: Pre Tool Use" body="checking output policy" />
        <StreamingIndicator startedAt={new Date(Date.now() - 7_000).toISOString()} />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "status-hook-completed") {
    return (
      <TranscriptPreviewShell>
        <HookPreview status="completed" title="Hook: Post Tool Use" body="Feedback: formatted command output" />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "status-hook-blocked") {
    return (
      <TranscriptPreviewShell>
        <HookPreview status="failed" title="Hook: Stop" body="Stop: tests must pass before ending the turn" />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "status-deprecation") {
    return (
      <TranscriptPreviewShell>
        <div className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <div className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-3.5" />
            <span>Deprecated instructions file detected</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Move these instructions into AGENTS.md so future Codex sessions load them consistently.
          </p>
        </div>
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "status-assistant-handoff") {
    return (
      <TranscriptPreviewShell>
        <AssistantMessage
          content="I found the relevant files and I’m going to inspect the runtime path next."
          isStreaming={false}
        />
        <StreamingIndicator startedAt={new Date(Date.now() - 18_000).toISOString()} />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "gemini-retry-status") {
    return (
      <TranscriptPreviewShell>
        <AssistantMessage content="I started drafting the change, but the model stream was interrupted mid-sentence" />
        <TransientStatusRow text="Retrying Gemini request..." />
        <AssistantMessage content="Retry finished with a fresh attempt. I’ll continue from the recovered response." />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "gemini-blocked-warning") {
    return (
      <TranscriptPreviewShell>
        <div className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <div className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-3.5" />
            <span>Gemini agent execution blocked</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A policy hook blocked the requested action. The warning remains in the transcript after the turn ends.
          </p>
        </div>
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "gemini-no-response-warning") {
    return (
      <TranscriptPreviewShell>
        <div className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <div className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-3.5" />
            <span>Gemini ended without a valid response</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The adapter reports the invalid stream as visible transcript text instead of leaving the turn looking frozen.
          </p>
        </div>
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "gemini-mcp-approval-options") {
    return (
      <TranscriptPreviewShell>
        <AssistantMessage content="Gemini needs permission before calling the GitHub MCP search tool." />
        <TransientStatusRow text="Waiting for exact MCP permission option selection." />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "gemini-tool-before-approval") {
    return (
      <TranscriptPreviewShell>
        <HookPreview
          status="running"
          name="MCP tool"
          title="MCP: github.search_pull_requests"
          body={'{\n  "query": "is:pr repo:proliferate-ai/proliferate interactions"\n}'}
        />
        <TransientStatusRow text="Awaiting permission to run this MCP tool." />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-bash-running") {
    return (
      <TranscriptPreviewShell>
        <BashCommandCall
          command="pnpm --dir desktop exec vitest run src/config/playground.test.ts"
          output="RUN  src/config/playground.test.ts\n"
          status="running"
          duration="for 12s"
          defaultExpanded
        />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-bash-completed") {
    return (
      <TranscriptPreviewShell>
        <BashCommandCall
          command="pnpm --dir desktop exec tsc --noEmit"
          output="Done in 4.2s\n"
          status="completed"
          duration="for 4s"
          defaultExpanded
        />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-bash-failed") {
    return (
      <TranscriptPreviewShell>
        <BashCommandCall
          command="pnpm --dir desktop exec vite build"
          output="error TS2322: Type 'string' is not assignable to type 'number'.\n"
          status="failed"
          duration="for 7s"
          defaultExpanded
        />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-read-preview") {
    return (
      <TranscriptPreviewShell>
        <FileReadCall
          path="/Users/pablo/proliferate/desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx"
          workspacePath="desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx"
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
  }
  if (scenario === "tool-file-change-running") {
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
  }
  if (scenario === "tool-file-change-failed") {
    return (
      <TranscriptPreviewShell>
        <FileChangeCall
          operation="edit"
          path="/Users/pablo/proliferate/desktop/src/App.tsx"
          workspacePath="desktop/src/App.tsx"
          basename="App.tsx"
          preview={"<<<<<<< ours\n<App />\n=======\n<Broken />\n>>>>>>> theirs\n"}
          status="failed"
          duration="for 3s"
          defaultExpanded
        />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-file-change-diff") {
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
  }
  if (scenario === "tool-reasoning") {
    return (
      <TranscriptPreviewShell>
        <ReasoningBlock content={"Inspecting transcript rendering paths.\nChecking subagent nested tool output.\nChoosing the compact row migration."} />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-cowork-artifact") {
    return (
      <TranscriptPreviewShell>
        <CoworkArtifactToolActionRow item={PLAYGROUND_COWORK_ARTIFACT_TOOL_CALL} />
      </TranscriptPreviewShell>
    );
  }
  if (scenario === "tool-generic-result") {
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
  }
  if (scenario === "tool-subagent-task") {
    return (
      <div className="h-[min(720px,calc(100vh-13rem))] min-h-[420px]">
        <MessageList
          activeSessionId="playground-subagent"
          selectedWorkspaceId={selectedWorkspaceId ?? "playground-workspace"}
          optimisticPrompt={null}
          transcript={PLAYGROUND_SUBAGENT_TRANSCRIPT}
          sessionViewState="idle"
        />
      </div>
    );
  }
  if (scenario === "subagent-wake-card") {
    return (
      <div className="h-[min(720px,calc(100vh-13rem))] min-h-[420px]">
        <MessageList
          activeSessionId="playground-subagent-wake"
          selectedWorkspaceId={selectedWorkspaceId ?? "playground-workspace"}
          optimisticPrompt={null}
          transcript={PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT}
          sessionViewState="idle"
        />
      </div>
    );
  }
  return (
    <div className="text-sm text-muted-foreground">
      <p className="leading-relaxed">
        This is the simulated transcript pane. Swap scenarios above to see
        different composer states and the Claude plan approval card.
      </p>
    </div>
  );
}

function noop() {}

function TranscriptPreviewShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

function TransientStatusRow({ text }: { text: string }) {
  return (
    <div className="flex min-h-[2.625rem] items-start gap-2 py-1 text-xs text-muted-foreground">
      <Sparkles className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

function HookPreview({
  status,
  name = "Hook",
  title,
  body,
}: {
  status: "running" | "completed" | "failed";
  name?: string;
  title: string;
  body: string;
}) {
  return (
    <ToolActionRow
      icon={<Settings className="size-3 text-faint" />}
      label={<span className="font-[460] text-foreground/90">{name}</span>}
      hint={title}
      status={status}
      defaultExpanded
    >
      <ToolActionDetailsPanel>
        <AutoHideScrollArea
          className="w-full"
          viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
        >
          <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
            {body}
          </pre>
        </AutoHideScrollArea>
      </ToolActionDetailsPanel>
    </ToolActionRow>
  );
}
