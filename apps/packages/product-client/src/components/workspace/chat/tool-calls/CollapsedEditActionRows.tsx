import { useState } from "react";
import type {
  FileChangeContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { FileChangeStats } from "#product/components/content/ui/FileChangeStats";
import { DiffViewer } from "#product/components/content/ui/DiffViewer";
import { FileDiffCard } from "#product/components/content/ui/FileDiffCard";
import { basename } from "#product/domain/chats/tools/collapsed-action-labels";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import { CollapsedActionIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionIcon";
import { ActionRowIcon } from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";
import { GenericActionRow } from "#product/components/workspace/chat/tool-calls/CollapsedGenericActionRow";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { resolveDiffDisplayPolicy } from "#product/lib/domain/workspaces/changes/diff-display-policy";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { Button } from "#product/primitives/Button";
import { ArrowUpRight } from "#product/primitives/icons/core";
import { Copy } from "#product/primitives/icons/core";
import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

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
  const host = useProductHost();
  const pathLabel = part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path;
  const displayName = part.newBasename ?? part.basename ?? basename(pathLabel);
  const additions = part.additions ?? 0;
  const deletions = part.deletions ?? 0;
  const workspacePath = part.newWorkspacePath ?? part.workspacePath ?? null;
  const patch = part.patch?.trim() ? part.patch : null;
  const canExpand = Boolean(patch);
  const fileActions = useFileReferenceActions({ rawPath: pathLabel, workspacePath });
  const canOpenFile = fileActions.canOpenPrimary;
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
      className={`relative flex min-w-0 max-w-full items-center text-left text-chat transition-colors ${
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
        {!failed && <span className="shrink-0">Edited</span>}
        <span data-edit-action-file-label className="min-w-0 truncate">
          <FileReferenceBadge
            rawPath={pathLabel}
            workspacePath={workspacePath}
            label={displayName}
            variant="plain"
            className="pointer-events-auto text-chat"
          />
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
            className="edit-action-row-open pointer-events-auto size-5 shrink-0 rounded border-0 bg-transparent p-0 text-current opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-1"
          >
            <ArrowUpRight className="icon-compact" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="group/edit-action min-w-0">
      {row}
      {expanded && patch && (
        <ToolActionDetailsPanel
          data-diff-surface="chat"
          className="thread-diff-virtualized mt-1.5"
        >
          {displayPolicy && !displayPolicy.canRenderInline ? (
            <div className="px-3 py-4 text-chat text-muted-foreground">
              <p className="font-medium text-foreground">{displayPolicy.placeholderTitle}</p>
              <p className="mt-0.5 leading-5">{displayPolicy.placeholderDescription}</p>
            </div>
          ) : (
            <FileDiffCard
              filePath={pathLabel}
              additions={additions}
              deletions={deletions}
              isExpanded
              collapsible={false}
              headerTone="inlineTool"
              showOpenAction={false}
              onOpenFile={canOpenFile ? () => void fileActions.openPrimary() : undefined}
              actions={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Copy diff for ${pathLabel}`}
                  title="Copy diff"
                  onClick={(event) => {
                    event.stopPropagation();
                    void host.clipboard.writeText(patch);
                  }}
                  className="size-6 rounded-lg border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1"
                >
                  <Copy className="icon-paired" />
                </Button>
              )}
              actionsAtRest
            >
              <DiffViewer
                patch={patch}
                filePath={pathLabel}
                contentSearchUnitId={contentSearchUnitId}
                className="w-full"
                viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
                variant="chat"
              />
            </FileDiffCard>
          )}
        </ToolActionDetailsPanel>
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
