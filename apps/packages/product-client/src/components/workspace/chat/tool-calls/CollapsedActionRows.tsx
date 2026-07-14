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
  deriveReadPath,
  formatFetchLabel,
  formatListingLabel,
  formatParsedCommandLabel,
  formatSearchLabel,
} from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
import { CommandActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedCommandActionRow";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { EditRows } from "#product/components/workspace/chat/tool-calls/CollapsedEditActionRows";
import { GenericActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedGenericActionRow";
import { PlainActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";

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
  const fileReads = item.contentParts.filter(
    (part): part is FileReadContentPart => part.type === "file_read",
  );
  const paths = fileReads.length > 0
    ? fileReads.map((part) => part.basename || basename(part.workspacePath ?? part.path))
    : [deriveReadPath(item)];

  return (
    <>
      {paths.map((path, idx) => (
        <PlainActionRow
          key={`${item.itemId}-read-${idx}`}
          icon={<CollapsedActionIcon kind="read" />}
          tone={item.status === "failed" ? "failed" : "normal"}
          label={`${item.status === "in_progress" ? "Reading" : "Read"} ${path}`}
        />
      ))}
    </>
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
      {commands.map((command, idx) => (
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
