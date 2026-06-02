import { useCallback } from "react";
import type {
  FileChangeContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import { HighlightedCodePanel } from "@/components/content/ui/HighlightedCodePanel";
import { useFileReferenceActions } from "@/hooks/workspaces/workflows/files/use-file-reference-actions";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import {
  basename,
  formatEditVerb,
} from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
import { ActionFileLink } from "./CollapsedActionRowPrimitives";
import { GenericActionRow } from "./CollapsedGenericActionRow";

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
          itemId={item.itemId}
          index={idx}
          part={part}
          failed={item.status === "failed"}
        />
      ))}
    </>
  );
}

function EditActionRow({
  itemId,
  index,
  part,
  failed,
}: {
  itemId: string;
  index: number;
  part: FileChangeContentPart;
  failed: boolean;
}) {
  const pathLabel = part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path;
  const displayName = part.newBasename ?? part.basename ?? basename(pathLabel);
  const action = failed ? "Failed editing" : formatEditVerb(part.operation);
  const additions = part.additions ?? 0;
  const deletions = part.deletions ?? 0;
  const workspacePath = part.newWorkspacePath ?? part.workspacePath ?? null;
  const fileReferenceActions = useFileReferenceActions({
    rawPath: pathLabel,
    workspacePath,
  });
  const handleOpen = useCallback(() => {
    void fileReferenceActions.openPrimary();
  }, [fileReferenceActions]);
  const showActionRow = failed || !part.patch;

  return (
    <div>
      {showActionRow && (
        <div
          className={`group/action-row flex min-w-0 items-center gap-1.5 rounded-lg bg-[var(--color-diff-chat-inline-tool-header-surface)] px-3 py-2 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground/80 transition-colors hover:bg-[var(--color-diff-chat-inline-tool-header-hover-surface)] hover:text-foreground ${action === "Edited" ? "my-1" : ""}`}
        >
          <span className={failed ? "shrink-0 text-destructive/80" : "shrink-0 group-hover/action-row:text-foreground"}>
            {action}
          </span>
          <ActionFileLink
            pathLabel={pathLabel}
            workspacePath={workspacePath}
            displayName={displayName}
          />
          {(additions > 0 || deletions > 0) && (
            <FileChangeStats
              additions={additions}
              deletions={deletions}
              className="text-sm"
            />
          )}
        </div>
      )}
      {part.patch ? (
        <div className={showActionRow ? "mt-1.5" : ""}>
          <FileDiffCard
            filePath={pathLabel}
            additions={additions}
            deletions={deletions}
            isExpanded
            collapsible={false}
            headerTone="inlineTool"
            showOpenAction={false}
            onOpenFile={fileReferenceActions.canOpenInSidebar || fileReferenceActions.canOpenExternal
              ? handleOpen
              : undefined}
          >
            <DiffViewer
              patch={part.patch}
              filePath={pathLabel}
              contentSearchUnitId={`diff:collapsed-tool:${itemId}:file-change:${index}`}
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              variant="chat"
            />
          </FileDiffCard>
        </div>
      ) : part.preview ? (
        <HighlightedCodePanel
          code={part.preview}
          filename={pathLabel}
          showLanguageLabel={false}
          className="mt-1.5 border-border/60 bg-foreground/[0.04]"
          contentClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
        />
      ) : null}
    </div>
  );
}
