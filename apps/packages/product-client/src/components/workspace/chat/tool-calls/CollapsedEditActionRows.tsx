import { useState } from "react";
import type {
  FileChangeContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { FileChangeStats } from "#product/components/content/ui/FileChangeStats";
import { DiffViewer } from "#product/components/content/ui/DiffViewer";
import { basename } from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { ActionRowIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";
import { GenericActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedGenericActionRow";
import { resolveDiffDisplayPolicy } from "#product/lib/domain/workspaces/changes/diff-display-policy";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { useFileReferenceNativeContextMenu } from "#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu";
import {
  FILE_REFERENCE_MENU_CLASS,
  FileReferenceMenuContent,
} from "#product/components/workspace/file-references/FileReferenceMenu";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight } from "@proliferate/ui/icons";

export function EditRows({ item }: { item: ToolCallItem }) {
  const fileChanges = item.contentParts.filter(
    (part): part is FileChangeContentPart => part.type === "file_change",
  );

  if (fileChanges.length === 0) {
    return (
      <GenericActionRow item={item} />
    );
  }

  return (
    <>
      {fileChanges.map((part, idx) => (
        <EditActionRow
          key={`${item.itemId}-edit-${idx}`}
          part={part}
          failed={item.status === "failed"}
          contentSearchUnitId={`diff:${item.itemId}:${idx}`}
        />
      ))}
    </>
  );
}

function EditActionRow({
  part,
  failed,
  contentSearchUnitId,
}: {
  part: FileChangeContentPart;
  failed: boolean;
  contentSearchUnitId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const pathLabel = part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path;
  const displayName = part.newBasename ?? part.basename ?? basename(pathLabel);
  const additions = part.additions ?? 0;
  const deletions = part.deletions ?? 0;
  const workspacePath = part.newWorkspacePath ?? part.workspacePath ?? null;
  const patch = part.patch?.trim() ? part.patch : null;
  const canExpand = Boolean(patch);
  const fileActions = useFileReferenceActions({ rawPath: pathLabel, workspacePath });
  const nativeContextMenu = useFileReferenceNativeContextMenu(fileActions);
  const canOpenFile = fileActions.canOpenInSidebar || fileActions.canOpenExternal;
  const displayPolicy = patch
    ? resolveDiffDisplayPolicy({ path: pathLabel, additions, deletions, patch })
    : null;
  const toggleExpanded = () => {
    if (canExpand) {
      setExpanded((value) => !value);
    }
  };
  const row = (
    <div
      data-edit-action-row
      onContextMenuCapture={nativeContextMenu.onContextMenuCapture}
      className={`group/action-row relative flex min-w-0 max-w-full items-center text-left text-chat leading-[var(--text-chat--line-height)] transition-colors ${
        failed
          ? "text-destructive/80 hover:text-destructive"
          : "text-foreground/60 hover:text-foreground"
      }`}
    >
      {canExpand && (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          aria-label={`Toggle diff for ${pathLabel}`}
          aria-expanded={expanded}
          onClick={toggleExpanded}
          className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        />
      )}
      <div className="pointer-events-none relative z-10 flex min-w-0 max-w-full items-center gap-1.5">
        <ActionRowIcon>
          <CollapsedActionIcon kind="edit" />
        </ActionRowIcon>
        {failed && (
          <span className="shrink-0">{formatFailedEditActionTitle(part.operation)}</span>
        )}
        <span
          data-edit-action-file-label
          title={pathLabel}
          className="min-w-0 truncate underline decoration-current decoration-dotted decoration-[0.5px] underline-offset-2"
        >
          {displayName}
        </span>
        <FileChangeStats
          additions={additions}
          deletions={deletions}
          className="text-chat leading-none"
          tone="activity"
        />
        {canOpenFile && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-chat-transcript-ignore
            aria-label={`Open ${pathLabel}`}
            title="Open file"
            onClick={(event) => {
              event.stopPropagation();
              void fileActions.openPrimary();
            }}
            className="pointer-events-auto size-5 shrink-0 rounded border-0 bg-transparent p-0 text-current opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-1 group-hover/action-row:opacity-100 group-focus-within/action-row:opacity-100"
          >
            <ArrowUpRight className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-w-0">
      <PopoverButton
        trigger={row}
        triggerMode="contextMenu"
        stopPropagation
        className={FILE_REFERENCE_MENU_CLASS}
      >
        {(close) => (
          <FileReferenceMenuContent actions={fileActions} close={close} />
        )}
      </PopoverButton>
      {expanded && patch && (
        <div
          data-diff-surface="chat"
          className="thread-diff-virtualized mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]"
        >
          {displayPolicy && !displayPolicy.canRenderInline ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{displayPolicy.placeholderTitle}</p>
              <p className="mt-0.5 leading-5">{displayPolicy.placeholderDescription}</p>
            </div>
          ) : (
            <DiffViewer
              patch={patch}
              filePath={pathLabel}
              contentSearchUnitId={contentSearchUnitId}
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              variant="chat"
            />
          )}
        </div>
      )}
    </div>
  );
}

function formatFailedEditActionTitle(operation: FileChangeContentPart["operation"]): string {
  switch (operation) {
    case "create":
      return "Failed creating";
    case "delete":
      return "Failed deleting";
    case "move":
      return "Failed moving";
    case "edit":
    default:
      return "Failed editing";
  }
}
