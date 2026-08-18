import { ArrowLeft } from "#product/primitives/icons/core";
import { StickyNote } from "#product/primitives/icons/product";
import { Button } from "#product/primitives/Button";
import { Badge } from "#product/primitives/Badge";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { MarkdownBody } from "#product/components/workspace/chat/transcript/MarkdownBody";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import { renderDesktopCodeBlock } from "#product/components/content/ui/desktop-markdown-code-block";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import {
  subagentDisplayTitle,
  subagentStatusLabel,
  type ActivitySubagentWire,
} from "#product/domain/activity/subagent";
import {
  findSubagentLaunchItem,
  resolveSubagentLaunchDisplay,
} from "#product/domain/chats/subagents/subagent-launch";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useTranscriptPaneStateForSession } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import { useFeedStream } from "#product/hooks/activity/derived/use-feed-stream";
import { useClaudeSessionLogTranscript } from "#product/hooks/activity/derived/use-claude-session-log-transcript";

/** The one harness whose `tail_file` feed this view can translate into a transcript today (see `domain/activity/claude-session-log.ts`). */
const TRANSCRIPT_SHAPED_PROVIDER_KIND = "claude";

export interface BackgroundSubagentViewProps {
  subagent: ActivitySubagentWire;
  sessionId: string;
  workspaceId: string;
  onBack: () => void;
}

/**
 * Read-only detail view for one harness-native subagent (Design Handoff —
 * NEW `BackgroundSubagentView`; Delivery Spec — Background Work Slice 1,
 * rung R4/R4b). Header on `AgentsPaneDetail`'s grammar: back + generated
 * identity glyph + title + `Status · provider` + a "read only" `Badge`.
 * Body: the launch tool call's initial prompt (when one correlates — see
 * `findSubagentLaunchItem`), then the child's own output. Footer replaces
 * `AgentsPaneComposer` with a fixed read-only line — no composer, no input,
 * ever.
 *
 * Feed fidelity (rung R4b, resolving R4's reported blocker): a claude
 * subagent's `tail_file` feed carries Claude's own native CLI session-log
 * JSONL, not an ACP `SessionEventEnvelope` stream — `open_tail_file`
 * (`anyharness-lib/src/domains/activity/feeds.rs`) always emits raw
 * `FeedFrame::Bytes`, and no runtime/fork change backs this PR. So the
 * translation happens entirely client-side:
 * `domain/activity/claude-session-log.ts` maps the accumulated buffer
 * into a `TranscriptState` (reusing `@anyharness/sdk`'s own reducer), and
 * this view renders it with the literal component the handoff names —
 * `MessageList` with `sessionViewState="idle"` — fed directly via its
 * `transcript` prop with a synthetic `activeSessionId`/`sessionId`; no
 * session-store entry is needed because `MessageList` (via
 * `ChatTranscriptView`) only *reads* the `transcript` prop it is given and
 * uses the session id as an opaque context/routing key, never to look
 * itself up in a store. Codex (and any harness whose mapped subset comes up
 * empty — degrades honestly rather than rendering a confident but empty
 * transcript) keeps the raw-tail `<pre>` treatment this view has always had.
 */
export function BackgroundSubagentView({
  subagent,
  sessionId,
  workspaceId,
  onBack,
}: BackgroundSubagentViewProps) {
  const displayTitle = subagentDisplayTitle(subagent);
  const identity = buildDelegatedAgentIdentity({
    id: subagent.id,
    title: displayTitle,
    workspaceId,
    sessionId: subagent.id,
  });
  const providerKind = useSessionDirectoryStore((state) => state.entriesById[sessionId]?.agentKind ?? null);
  const providerLabel = providerKind ? getProviderDisplayName(providerKind) : null;

  const { transcript } = useTranscriptPaneStateForSession(sessionId);
  const launchItem = transcript ? findSubagentLaunchItem(transcript, subagent.id) : null;
  const promptText = launchItem ? resolveSubagentLaunchDisplay(launchItem).prompt : null;

  const { content, connected, error } = useFeedStream(subagent.feed, {
    workspaceId,
    enabled: subagent.feed !== null,
  });
  const bodyText = content || (subagent.feed ? (error ?? (connected ? "" : "Connecting…")) : "");

  // Transcript-shaped rendering (rung R4b): only claude's tail_file bytes have
  // a translator (domain/activity/claude-session-log.ts). Every other harness,
  // and a claude buffer whose mapped subset comes up empty (no complete lines
  // yet, or nothing but skipped/malformed ones), keeps the raw-tail fallback.
  const isClaudeSubagent = providerKind === TRANSCRIPT_SHAPED_PROVIDER_KIND;
  const claudeTranscript = useClaudeSessionLogTranscript(content, subagent.id);
  const showTranscriptView = isClaudeSubagent && claudeTranscript.transcript.turnOrder.length > 0;

  return (
    <section
      aria-label={`Subagent ${displayTitle}`}
      data-background-subagent-view=""
      data-subagent-id={subagent.id}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to background work"
            onClick={onBack}
          >
            <ArrowLeft className="icon-compact" />
          </Button>
          <AgentIdentityGlyph identity={identity} dimension={20} label={identity.generatedName} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui font-medium text-foreground" title={displayTitle}>
              {displayTitle}
            </span>
            <span className="truncate text-ui-sm text-muted-foreground">
              {subagentStatusLabel(subagent)}
              {providerLabel && (
                <>
                  {" · "}
                  {providerLabel}
                </>
              )}
            </span>
          </div>
          <Badge size="micro">read only</Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {promptText && (
          <div className="shrink-0 px-3 pt-2">
            <ToolActionDetailsPanel>
              <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-ui-sm text-muted-foreground">
                <StickyNote aria-hidden="true" className="icon-compact shrink-0 text-faint" />
                <span>Initial prompt</span>
              </div>
              <AutoHideScrollArea className="w-full" viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}>
                <div className="px-3 py-2 text-chat leading-relaxed text-muted-foreground" data-telemetry-mask>
                  <MarkdownBody
                    content={promptText}
                    className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                    renderCodeBlock={renderDesktopCodeBlock}
                  />
                </div>
              </AutoHideScrollArea>
            </ToolActionDetailsPanel>
          </div>
        )}
        {showTranscriptView ? (
          <MessageList
            activeSessionId={subagent.id}
            selectedWorkspaceId={workspaceId}
            optimisticPrompt={null}
            transcript={claudeTranscript.transcript}
            sessionViewState="idle"
            contentSearchEnabled={false}
          />
        ) : (
          <AutoHideScrollArea className="min-h-0 w-full flex-1" viewportClassName="p-3">
            <pre
              className="m-0 whitespace-pre-wrap font-mono text-readable-code text-foreground"
              data-telemetry-mask
            >
              {bodyText}
            </pre>
          </AutoHideScrollArea>
        )}
      </div>

      <footer className="border-t border-border px-3 py-2 text-ui-sm text-muted-foreground">
        Read-only. Transcript mirrored from the agent; no composer.
      </footer>
    </section>
  );
}
