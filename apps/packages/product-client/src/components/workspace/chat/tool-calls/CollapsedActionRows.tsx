import type { ReactNode } from "react";
import type {
  FileReadContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { classifyCollapsedAction } from "#product/domain/chats/transcript/transcript-collapsed-actions";
import {
  getToolCallParsedCommands,
  type ParsedToolCommand,
} from "#product/domain/chats/transcript/transcript-tool-commands";
import {
  basename,
  deriveCommandOutput,
  deriveReadPathTarget,
  formatFetchLabel,
  formatListingLabel,
  formatParsedCommandLabel,
  formatSearchLabel,
} from "#product/domain/chats/tools/collapsed-action-labels";
import { useBackgroundCommandStatus } from "#product/hooks/activity/derived/use-background-command-status";
import { useTranscriptSessionId } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { CommandActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedCommandActionRow";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { EditRows } from "#product/components/workspace/chat/tool-calls/CollapsedEditActionRows";
import { GenericActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedGenericActionRow";
import {
  ActionDisclosureRow,
  ActionFileLink,
  ActionRowIcon,
  PlainActionRow,
} from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";

export function CollapsedActionRows({
  item,
  onOpenBackgroundTerminal,
}: {
  item: ToolCallItem;
  /**
   * bgwork r8 round 2/3: routed to the lone `command`-kind row, or to every
   * row of a parsed/compound command — a background command is one process
   * with one result text no matter how many structural rows it renders into.
   */
  onOpenBackgroundTerminal?: (processId: string) => void;
}) {
  const parsedCommands = getToolCallParsedCommands(item);
  // Resolved once for the whole tool call: a background command's "Command
  // running in background with ID: ..." sentence lives in the ONE result
  // text the item carries, regardless of how many display rows the harness's
  // parsed_cmd breakdown produces below.
  const { processId: backgroundProcessId, trailingStatus: backgroundTrailingStatus } =
    useBackgroundCommandStatus(deriveCommandOutput(item), useTranscriptSessionId());

  if (parsedCommands.length > 0) {
    return (
      <ParsedCommandRows
        item={item}
        commands={parsedCommands}
        backgroundProcessId={backgroundProcessId}
        backgroundTrailingStatus={backgroundTrailingStatus}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />
    );
  }

  switch (classifyCollapsedAction(item)) {
    case "read":
      return <ReadRows item={item} />;
    case "listing":
      return (
        <PlainActionRow
          icon={<CollapsedActionIcon kind="listing" />}
          tone={item.status === "failed" ? "failed" : "normal"}
          label={formatListingLabel(item)}
        />
      );
    case "search":
      return (
        <PlainActionRow
          icon={<CollapsedActionIcon kind="search" />}
          tone={item.status === "failed" ? "failed" : "normal"}
          label={formatSearchLabel(item)}
        />
      );
    case "fetch":
      return (
        <PlainActionRow
          icon={<CollapsedActionIcon kind="fetch" />}
          tone={item.status === "failed" ? "failed" : "normal"}
          label={formatFetchLabel(item)}
        />
      );
    case "command":
      return (
        <CommandActionRow
          item={item}
          onOpenBackgroundTerminal={onOpenBackgroundTerminal}
        />
      );
    case "edit":
      return <EditRows item={item} />;
    case "action":
    default:
      return <GenericActionRow item={item} />;
  }
}

function ReadRows({ item }: { item: ToolCallItem }) {
  const verb = item.status === "in_progress" ? "Reading" : "Read";
  const failed = item.status === "failed";
  const fileReads = item.contentParts.filter(
    (part): part is FileReadContentPart => part.type === "file_read",
  );
  // The SDK collapses an omitted workspacePath and an explicit null to the same
  // value. Preserve a non-empty normalized path, but otherwise let the shared
  // resolver classify the raw path against the current workspace root.
  const targets = fileReads.length > 0
    ? fileReads.map((part) => ({
      rawPath: part.workspacePath || part.path,
      workspacePath: part.workspacePath || undefined,
      displayName: part.basename || basename(part.workspacePath || part.path),
    }))
    : [{ ...deriveReadPathTarget(item), workspacePath: undefined }];

  return (
    <>
      {targets.map((target, idx) => target.rawPath
        ? (
          <FileActionRow
            key={`${item.itemId}-read-${idx}`}
            icon={<CollapsedActionIcon kind="read" />}
            verb={verb}
            pathLabel={target.rawPath}
            workspacePath={target.workspacePath}
            displayName={target.displayName}
            failed={failed}
          />
        )
        : (
          <PlainActionRow
            key={`${item.itemId}-read-${idx}`}
            icon={<CollapsedActionIcon kind="read" />}
            tone={failed ? "failed" : "normal"}
            label={`${verb} ${target.displayName}`}
          />
        ))}
    </>
  );
}

function FileActionRow({
  icon,
  verb,
  pathLabel,
  workspacePath,
  displayName,
  failed,
}: {
  icon: ReactNode;
  verb: string;
  pathLabel: string;
  /** A known workspace-relative path, or absent to infer from pathLabel. */
  workspacePath: string | null | undefined;
  displayName: string;
  failed: boolean;
}) {
  return (
    <div
      title={`${verb} ${pathLabel}`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-chat ${
        failed ? "text-destructive/80" : "text-foreground/60"
      }`}
    >
      <ActionRowIcon>{icon}</ActionRowIcon>
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-inherit">{verb}</span>
        <ActionFileLink
          pathLabel={pathLabel}
          workspacePath={workspacePath}
          displayName={displayName}
        />
      </span>
    </div>
  );
}

function ParsedCommandRows({
  item,
  commands,
  backgroundProcessId,
  backgroundTrailingStatus,
  onOpenBackgroundTerminal,
}: {
  item: ToolCallItem;
  commands: ParsedToolCommand[];
  backgroundProcessId: string | null;
  backgroundTrailingStatus: string | undefined;
  onOpenBackgroundTerminal?: (processId: string) => void;
}) {
  // A background command is one process regardless of how many structural
  // rows its parsed breakdown renders into — every row opens the same
  // terminal detail, uniformly (bgwork r8 round 3), never a mix of some rows
  // opening the pane and others keeping their ordinary per-kind treatment
  // (e.g. a "read"-kind row's file link). Falls back to the ordinary
  // per-kind rendering below when there's no id to open with, or no caller
  // wired to open it.
  if (backgroundProcessId && onOpenBackgroundTerminal) {
    const processId = backgroundProcessId;
    return (
      <>
        {commands.map((command, idx) => (
          <ActionDisclosureRow
            key={`${item.itemId}-parsed-${idx}`}
            label={formatParsedCommandLabel(item, command)}
            icon={<CollapsedActionIcon kind={command.kind} />}
            expanded={false}
            failed={item.status === "failed"}
            onToggle={() => onOpenBackgroundTerminal(processId)}
            trailing={backgroundTrailingStatus}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {commands.map((command, idx) => command.kind === "read" && command.path
        ? (
          <FileActionRow
            key={`${item.itemId}-parsed-${idx}`}
            icon={<CollapsedActionIcon kind="read" />}
            verb={item.status === "in_progress" ? "Reading" : "Read"}
            pathLabel={command.path}
            workspacePath={undefined}
            displayName={command.name ?? basename(command.path)}
            failed={item.status === "failed"}
          />
        )
        : (
          <PlainActionRow
            key={`${item.itemId}-parsed-${idx}`}
            icon={<CollapsedActionIcon kind={command.kind} />}
            tone={item.status === "failed" ? "failed" : "normal"}
            label={formatParsedCommandLabel(item, command)}
          />
        ))}
    </>
  );
}
