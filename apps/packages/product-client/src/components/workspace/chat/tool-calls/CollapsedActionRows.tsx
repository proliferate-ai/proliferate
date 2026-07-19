import type { ReactNode } from "react";
import type {
  FileReadContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { classifyCollapsedAction } from "@proliferate/product-domain/chats/transcript/transcript-collapsed-actions";
import {
  getToolCallParsedCommands,
  type ParsedToolCommand,
} from "@proliferate/product-domain/chats/transcript/transcript-tool-commands";
import {
  basename,
  deriveReadPathTarget,
  formatFetchLabel,
  formatListingLabel,
  formatParsedCommandLabel,
  formatSearchLabel,
} from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
import { CommandActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedCommandActionRow";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { EditRows } from "#product/components/workspace/chat/tool-calls/CollapsedEditActionRows";
import { GenericActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedGenericActionRow";
import {
  ActionFileLink,
  ActionRowIcon,
  PlainActionRow,
} from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";

export function CollapsedActionRows({ item }: { item: ToolCallItem }) {
  const parsedCommands = getToolCallParsedCommands(item);
  if (parsedCommands.length > 0) {
    return <ParsedCommandRows item={item} commands={parsedCommands} />;
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
      return <CommandActionRow item={item} />;
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
  // Structured parts are server-normalized: a missing workspacePath there is
  // an authoritative "outside the workspace" ruling (null = external-only).
  // Raw-input fallbacks carry no such ruling, so leave workspacePath undefined
  // and let the file-reference resolver infer it from the workspace root.
  const targets = fileReads.length > 0
    ? fileReads.map((part) => ({
      rawPath: part.workspacePath ?? part.path,
      workspacePath: part.workspacePath ?? null,
      displayName: part.basename || basename(part.workspacePath ?? part.path),
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
  /** null = authoritatively external; undefined = infer from workspace root. */
  workspacePath: string | null | undefined;
  displayName: string;
  failed: boolean;
}) {
  return (
    <div
      title={`${verb} ${pathLabel}`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-chat leading-[var(--text-chat--line-height)] ${
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
}: {
  item: ToolCallItem;
  commands: ParsedToolCommand[];
}) {
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
