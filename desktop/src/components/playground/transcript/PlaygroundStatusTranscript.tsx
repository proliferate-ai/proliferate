import type { ReactNode } from "react";
import { CircleAlert } from "@/components/ui/icons";
import { AssistantMessage } from "@/components/workspace/chat/transcript/AssistantMessage";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";
import type { ScenarioKey } from "@/config/playground";
import {
  HookPreview,
  TranscriptPreviewShell,
  TransientStatusRow,
} from "@/components/playground/transcript/PlaygroundTranscriptShell";

export function renderPlaygroundStatusTranscript(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "status-background":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="I’ll connect the MCP server and continue once authentication is ready." />
          <TransientStatusRow text="Authenticating MCP Google… follow the browser prompt if it appears." />
        </TranscriptPreviewShell>
      );
    case "status-hook-running":
      return (
        <TranscriptPreviewShell>
          <HookPreview status="running" title="Hook: Pre Tool Use" body="checking output policy" />
          <StreamingIndicator startedAt={new Date(Date.now() - 7_000).toISOString()} />
        </TranscriptPreviewShell>
      );
    case "status-hook-completed":
      return (
        <TranscriptPreviewShell>
          <HookPreview status="completed" title="Hook: Post Tool Use" body="Feedback: formatted command output" />
        </TranscriptPreviewShell>
      );
    case "status-hook-blocked":
      return (
        <TranscriptPreviewShell>
          <HookPreview status="failed" title="Hook: Stop" body="Stop: tests must pass before ending the turn" />
        </TranscriptPreviewShell>
      );
    case "status-deprecation":
      return (
        <TranscriptPreviewShell>
          <WarningNotice
            title="Deprecated instructions file detected"
            body="Move these instructions into AGENTS.md so future Codex sessions load them consistently."
          />
        </TranscriptPreviewShell>
      );
    case "status-assistant-handoff":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage
            content="I found the relevant files and I’m going to inspect the runtime path next."
            isStreaming={false}
          />
          <StreamingIndicator startedAt={new Date(Date.now() - 18_000).toISOString()} />
        </TranscriptPreviewShell>
      );
    case "gemini-retry-status":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="I started drafting the change, but the model stream was interrupted mid-sentence" />
          <TransientStatusRow text="Retrying Gemini request..." />
          <AssistantMessage content="Retry finished with a fresh attempt. I’ll continue from the recovered response." />
        </TranscriptPreviewShell>
      );
    case "gemini-blocked-warning":
      return (
        <TranscriptPreviewShell>
          <WarningNotice
            title="Gemini agent execution blocked"
            body="A policy hook blocked the requested action. The warning remains in the transcript after the turn ends."
          />
        </TranscriptPreviewShell>
      );
    case "gemini-no-response-warning":
      return (
        <TranscriptPreviewShell>
          <WarningNotice
            title="Gemini ended without a valid response"
            body="The adapter reports the invalid stream as visible transcript text instead of leaving the turn looking frozen."
          />
        </TranscriptPreviewShell>
      );
    case "gemini-mcp-approval-options":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="Gemini needs permission before calling the GitHub MCP search tool." />
          <TransientStatusRow text="Waiting for exact MCP permission option selection." />
        </TranscriptPreviewShell>
      );
    case "gemini-tool-before-approval":
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
    default:
      return null;
  }
}

function WarningNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
      <div className="flex items-center gap-2 font-medium">
        <CircleAlert className="size-3.5" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
