import { useState } from "react";
import type { ToolCallItem } from "@anyharness/sdk";
import { CommandWindow } from "#product/primitives/icons/workspace";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import {
  deriveCommand,
  deriveCommandOutput,
  formatCommandExecutionLabel,
} from "#product/domain/chats/tools/collapsed-action-labels";
import { useBackgroundCommandStatus } from "#product/hooks/activity/derived/use-background-command-status";
import { useTranscriptSessionId } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { ActionDisclosureRow } from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";

/**
 * Renders a single command row inside a collapsed action ledger (the
 * "Worked for 6s" group every completed turn settles into). Roster state is
 * read via `useBackgroundCommandStatus` (a local-hook composition, bgwork r8
 * round 2/3), same convention `TranscriptToolCallItemBlock` (round 1) and
 * `SubagentCreationGroupBlock` already use for `useTranscriptSessionId`. The
 * pane-opening callback stays a threaded prop, not a local
 * `useOpenBackgroundTerminalDetail()` call: that hook reaches into
 * `useWorkspaces()`/`useProductAuthUserId()`, which requires a fully
 * equipped `ProductHostProvider` — calling it unconditionally here broke
 * every other ledger test that mounts `CollapsedActions` with a minimal test
 * host. Accepting it as an optional prop keeps this component's hook
 * footprint unchanged for every call site that doesn't wire it.
 */
export function CommandActionRow({
  item,
  onOpenBackgroundTerminal,
}: {
  item: ToolCallItem;
  onOpenBackgroundTerminal?: (processId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const command = deriveCommand(item);
  const output = deriveCommandOutput(item);
  const label = formatCommandExecutionLabel(command, item.status);

  const sessionId = useTranscriptSessionId();
  const { processId: backgroundProcessId, trailingStatus } = useBackgroundCommandStatus(
    output,
    sessionId,
  );

  // A background command never expands in place — activating it opens the
  // Background work pane's terminal detail instead, same as the top-level
  // transcript tool-call row (TranscriptToolCallItemBlock, bgwork r8 round 1).
  // Falls back to the ordinary inline toggle when there's no id to open with,
  // matching every other row.
  const canOpenBackgroundTerminal = !!backgroundProcessId && !!onOpenBackgroundTerminal;
  const rowExpanded = canOpenBackgroundTerminal ? false : expanded;
  const onToggle = canOpenBackgroundTerminal
    ? () => onOpenBackgroundTerminal(backgroundProcessId)
    : () => setExpanded((value) => !value);

  return (
    <div>
      <ActionDisclosureRow
        label={label}
        icon={<CommandWindow />}
        expanded={rowExpanded}
        failed={item.status === "failed"}
        onToggle={onToggle}
        trailing={backgroundProcessId ? trailingStatus : undefined}
      />
      {rowExpanded && (
        <ToolActionDetailsPanel className="mt-1.5">
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-chat text-muted-foreground">
            <span>Shell</span>
          </div>
          <div className="px-2 pb-2">
            <code className="block whitespace-pre-wrap break-words font-mono text-readable-code text-muted-foreground">
              $ {command}
            </code>
          </div>
          <AutoHideScrollArea
            viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            allowHorizontal
            chainVerticalWheel
          >
            <pre className="m-0 whitespace-pre-wrap p-2 font-mono text-readable-code text-muted-foreground">
              <code>{output || "No output"}</code>
            </pre>
          </AutoHideScrollArea>
        </ToolActionDetailsPanel>
      )}
    </div>
  );
}
