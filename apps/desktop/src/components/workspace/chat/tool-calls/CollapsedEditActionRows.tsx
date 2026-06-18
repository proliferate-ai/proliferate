import { useCallback, useState, type KeyboardEvent } from "react";
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
import { ChevronRight, FilePen } from "@proliferate/ui/icons";
import { basename } from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
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
  const action = failed
    ? formatFailedEditActionTitle(part.operation)
    : formatEditActionTitle(part.operation);
  const additions = part.additions ?? 0;
  const deletions = part.deletions ?? 0;
  const hasDetails = !!part.patch || !!part.preview;
  const [expanded, setExpanded] = useState(false);
  const workspacePath = part.newWorkspacePath ?? part.workspacePath ?? null;
  const fileReferenceActions = useFileReferenceActions({
    rawPath: pathLabel,
    workspacePath,
    // The path comes from the file_change tool-call metadata, so it is
    // authoritative — skip the fuzzy backstop (which could re-resolve a
    // same-basename file), matching FileChangeCall.
    authoritativePath: true,
  });
  const handleOpen = useCallback(() => {
    void fileReferenceActions.openPrimary();
  }, [fileReferenceActions]);
  const toggleExpanded = () => setExpanded((next) => !next);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasDetails) return;
    if (
      event.target === event.currentTarget
      && (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      toggleExpanded();
    }
  };

  return (
    <div>
      <div
        {...(hasDetails
          ? {
            role: "button",
            tabIndex: 0,
            "data-chat-transcript-ignore": true,
            "aria-expanded": expanded,
            onClick: toggleExpanded,
            onKeyDown: handleKeyDown,
          }
          : {})}
        className={`group/action-row inline-flex min-w-0 max-w-full items-center gap-1 rounded-none bg-transparent p-0 text-left text-chat leading-[var(--text-chat--line-height)] font-normal text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:underline ${hasDetails ? "cursor-pointer" : ""}`}
      >
        <FilePen
          aria-hidden="true"
          className={`size-3 shrink-0 transition-colors ${
            failed
              ? "text-destructive/70"
              : "text-faint group-hover/action-row:text-muted-foreground group-focus-visible/action-row:text-muted-foreground"
          }`}
        />
        <span className={failed ? "shrink-0 text-destructive/80" : "shrink-0 text-inherit"}>
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
            aria-hidden="true"
            className={`size-2.5 shrink-0 text-faint transition-transform group-hover/action-row:text-muted-foreground group-focus-visible/action-row:text-muted-foreground ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </div>
      {expanded && part.patch ? (
        <div className="mt-1.5">
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
      ) : expanded && part.preview ? (
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

function formatEditActionTitle(operation: FileChangeContentPart["operation"]): string {
  switch (operation) {
    case "create":
      return "Create";
    case "delete":
      return "Delete";
    case "move":
      return "Move";
    case "edit":
    default:
      return "Edit";
  }
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
