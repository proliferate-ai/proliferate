import { useCallback, useState } from "react";
import type {
  FileChangeContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileChangeStats, FileDiffCard } from "@/components/ui/content/FileDiffCard";
import { HighlightedCodePanel } from "@/components/ui/content/HighlightedCodePanel";
import { ChevronRight } from "@/components/ui/icons";
import { useFileReferenceActions } from "@/hooks/workspaces/files/use-file-reference-actions";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tools/tool-call-layout";
import {
  basename,
  formatEditVerb,
} from "@/lib/domain/chat/tools/collapsed-action-labels";
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
  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(true);
  const pathLabel = part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path;
  const displayName = part.newBasename ?? part.basename ?? basename(pathLabel);
  const action = failed ? "Failed editing" : formatEditVerb(part.operation);
  const additions = part.additions ?? 0;
  const deletions = part.deletions ?? 0;
  const hasDetails = !!part.patch || !!part.preview;
  const workspacePath = part.newWorkspacePath ?? part.workspacePath ?? null;
  const fileReferenceActions = useFileReferenceActions({
    rawPath: pathLabel,
    workspacePath,
  });
  const handleOpen = useCallback(() => {
    void fileReferenceActions.openPrimary();
  }, [fileReferenceActions]);

  return (
    <div>
      <div
        role={hasDetails ? "button" : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        {...(hasDetails ? { "data-chat-transcript-ignore": true } : {})}
        className={`group/action-row flex min-w-0 items-center gap-1 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground/80 ${action === "Edited" ? "my-2" : ""}`}
        onClick={() => {
          if (hasDetails) setExpanded((value) => !value);
        }}
        onKeyDown={(event) => {
          if (
            hasDetails
            && event.target === event.currentTarget
            && (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
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
        {hasDetails && (
          <ChevronRight
            className={`ml-0.5 size-3 shrink-0 text-faint opacity-0 transition-all duration-200 group-hover/action-row:opacity-100 ${
              expanded ? "rotate-90 opacity-100" : ""
            }`}
          />
        )}
      </div>
      {expanded && hasDetails && (
        part.patch ? (
          <div className="mt-1.5">
            <FileDiffCard
              filePath={pathLabel}
              additions={additions}
              deletions={deletions}
              isExpanded={diffExpanded}
              onToggleExpand={() => setDiffExpanded((value) => !value)}
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
        ) : null
      )}
    </div>
  );
}
