import { ArrowLeft } from "#product/primitives/icons/core";
import { StickyNote } from "#product/primitives/icons/product";
import { Button } from "#product/primitives/Button";
import { Badge } from "#product/primitives/Badge";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { MarkdownBody } from "#product/components/workspace/chat/transcript/MarkdownBody";
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

export interface BackgroundSubagentViewProps {
  subagent: ActivitySubagentWire;
  sessionId: string;
  workspaceId: string;
  onBack: () => void;
}

/**
 * Read-only detail view for one harness-native subagent (Design Handoff —
 * NEW `BackgroundSubagentView`; Delivery Spec — Background Work Slice 1,
 * rung R4). Header on `AgentsPaneDetail`'s grammar: back + generated
 * identity glyph + title + `Status · provider` + a "read only" `Badge`.
 * Body: the launch tool call's initial prompt (when one correlates — see
 * `findSubagentLaunchItem`), then the child's own output. Footer replaces
 * `AgentsPaneComposer` with a fixed read-only line — no composer, no input,
 * ever.
 *
 * BLOCKER (reported per `implement-pr-slice` discipline, same class as R3's
 * `BashCommandCall` stop): the handoff's "Feed fidelity" note calls
 * transcript-shaped `MessageList` rendering "honest for Claude today"
 * because "the child transcript arrives as a JSONL tail over `tail_file`."
 * That is not what the runtime actually sends. `open_tail_file`
 * (`anyharness-lib/src/domains/activity/feeds.rs`) always emits raw
 * `FeedFrame::Bytes` regardless of `FeedKind`, and the WS handler
 * (`api/ws/feeds.rs`) does no JSONL→ACP translation — a Claude subagent's
 * `tail_file` feed carries Claude's own native CLI session-log JSONL
 * (`parentUuid`/`isSidechain`/`uuid` fields), not the `SessionEventEnvelope`
 * shape `@anyharness/sdk`'s reducer (and therefore `MessageList`, which
 * requires a `TranscriptState`) needs. No translator for this exists
 * anywhere in the repo. This view therefore renders the feed as plain text
 * for every harness — the same raw-tail treatment the handoff already rules
 * for Codex (pending the `acp_child_demux` binding) — rather than inventing
 * a client-side JSONL-to-ACP translator that is out of this slice's scope.
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
        <AutoHideScrollArea className="min-h-0 w-full flex-1" viewportClassName="p-3">
          <pre
            className="m-0 whitespace-pre-wrap font-mono text-readable-code text-foreground"
            data-telemetry-mask
          >
            {bodyText}
          </pre>
        </AutoHideScrollArea>
      </div>

      <footer className="border-t border-border px-3 py-2 text-ui-sm text-muted-foreground">
        Read-only. Transcript mirrored from the agent; no composer.
      </footer>
    </section>
  );
}
