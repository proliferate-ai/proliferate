import { useCallback, type ReactNode } from "react";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import { HighlightedCodePanel } from "@/components/content/ui/HighlightedCodePanel";
import {
  ArrowRight,
  FilePen,
  FilePlus,
  Minus,
} from "@proliferate/ui/icons";
import { useFileReferenceActions } from "@/hooks/workspaces/workflows/files/use-file-reference-actions";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import { resolveDiffDisplayPolicy } from "@/lib/domain/workspaces/changes/diff-display-policy";
import { ToolActionDetailsPanel } from "./ToolActionDetailsPanel";
import { ToolActionRow } from "./ToolActionRow";
import { ToolFileChip } from "./ToolFileChip";
import type { FileChangeOperation } from "@anyharness/sdk";

interface FileChangeCallProps {
  operation: FileChangeOperation;
  path: string;
  workspacePath?: string | null;
  basename?: string | null;
  newPath?: string | null;
  newWorkspacePath?: string | null;
  newBasename?: string | null;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
  preview?: string | null;
  status: "running" | "completed" | "failed";
  duration?: string;
  defaultExpanded?: boolean;
  contentSearchUnitId?: string;
}

export function FileChangeCall({
  operation,
  path,
  workspacePath = null,
  basename = null,
  newPath,
  newWorkspacePath = null,
  newBasename = null,
  additions,
  deletions,
  patch,
  preview,
  status,
  duration,
  defaultExpanded = false,
  contentSearchUnitId,
}: FileChangeCallProps) {
  const hasDiff = !!patch;
  const actionLabel = getOperationLabel(operation, status);
  const displayPath = newWorkspacePath || workspacePath || newPath || path;
  const fileReferenceActions = useFileReferenceActions({
    rawPath: displayPath,
    workspacePath: newWorkspacePath || workspacePath,
  });
  const handleOpenFile = useCallback(() => {
    void fileReferenceActions.openPrimary();
  }, [fileReferenceActions]);
  const label = buildLabel(
    actionLabel,
    operation,
    path,
    workspacePath,
    basename,
    newPath,
    newWorkspacePath,
    newBasename,
  );
  const statsHint = buildStatsHint(additions, deletions);
  const diffDisplayPolicy = patch
    ? resolveDiffDisplayPolicy({
        path: displayPath,
        additions,
        deletions,
        patch,
      })
    : null;

  if (status === "completed" && hasDiff) {
    const nextAdditions = additions ?? 0;
    const nextDeletions = deletions ?? 0;

    return (
      <div className="flex min-w-0 flex-col">
        <div className="mb-1">
          <FileDiffCard
            filePath={displayPath}
            additions={nextAdditions}
            deletions={nextDeletions}
            isExpanded
            collapsible={false}
            headerTone="inlineTool"
            showOpenAction={false}
            onOpenFile={fileReferenceActions.canOpenInSidebar || fileReferenceActions.canOpenExternal
              ? handleOpenFile
              : undefined}
          >
            {diffDisplayPolicy && !diffDisplayPolicy.canRenderInline ? (
              <DiffDisplayPolicyPlaceholder
                title={diffDisplayPolicy.placeholderTitle}
                description={diffDisplayPolicy.placeholderDescription}
              />
            ) : (
              <DiffViewer
                patch={patch!}
                filePath={displayPath}
                contentSearchUnitId={contentSearchUnitId}
                className="w-full"
                viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
                variant="chat"
              />
            )}
          </FileDiffCard>
        </div>
      </div>
    );
  }

  return (
    <ToolActionRow
      icon={getOperationIcon(operation)}
      label={label}
      hint={statsHint}
      status={status}
      duration={duration}
      defaultExpanded={defaultExpanded}
      expandable={hasDiff || !!preview}
    >
      {hasDiff || preview ? (
        <ToolActionDetailsPanel>
          {hasDiff && diffDisplayPolicy && !diffDisplayPolicy.canRenderInline ? (
            <DiffDisplayPolicyPlaceholder
              title={diffDisplayPolicy.placeholderTitle}
              description={diffDisplayPolicy.placeholderDescription}
            />
          ) : hasDiff ? (
            <DiffViewer
              patch={patch!}
              filePath={displayPath}
              contentSearchUnitId={contentSearchUnitId}
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              variant="chat"
            />
          ) : preview ? (
            <div className="p-2">
              <HighlightedCodePanel
                code={preview}
                filename={displayPath}
                showLanguageLabel={false}
                className="border-0 bg-transparent"
                contentClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              />
            </div>
          ) : null}
        </ToolActionDetailsPanel>
      ) : null}
    </ToolActionRow>
  );
}

function DiffDisplayPolicyPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-3 py-4 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-0.5 leading-5">{description}</p>
    </div>
  );
}

function buildLabel(
  actionLabel: string,
  operation: FileChangeOperation,
  path: string,
  workspacePath: string | null,
  basename: string | null,
  newPath: string | null | undefined,
  newWorkspacePath: string | null,
  newBasename: string | null,
): ReactNode {
  const resolvedBasename = basename || extractBasename(path);
  const resolvedNewBasename = newBasename || (newPath ? extractBasename(newPath) : null);

  const primaryChip = (
    <ToolFileChip
      basename={resolvedBasename}
      pathLabel={workspacePath ?? path}
      workspacePath={workspacePath}
    />
  );

  if (operation === "move" && (newPath || newWorkspacePath || resolvedNewBasename)) {
    const nextPathLabel = newWorkspacePath ?? newPath ?? path;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-[460] text-foreground/90">{actionLabel}</span>
        {primaryChip}
        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        <ToolFileChip
          basename={resolvedNewBasename ?? resolvedBasename}
          pathLabel={nextPathLabel}
          workspacePath={newWorkspacePath}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-[460] text-foreground/90">{actionLabel}</span>
      {primaryChip}
    </div>
  );
}

function buildStatsHint(
  additions?: number | null,
  deletions?: number | null,
): string | undefined {
  const nextAdditions = additions ?? 0;
  const nextDeletions = deletions ?? 0;
  if (!nextAdditions && !nextDeletions) {
    return undefined;
  }
  return `+${nextAdditions} -${nextDeletions}`;
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function getOperationIcon(operation: FileChangeOperation) {
  switch (operation) {
    case "create":
      return <FilePlus />;
    case "edit":
      return <FilePen />;
    case "delete":
      return <Minus />;
    case "move":
      return <ArrowRight />;
  }
}

function getOperationLabel(
  operation: FileChangeOperation,
  status: "running" | "completed" | "failed",
): string {
  const inProgress = status === "running";
  switch (operation) {
    case "create":
      return inProgress ? "Creating" : "Created";
    case "edit":
      return inProgress ? "Editing" : "Edited";
    case "delete":
      return inProgress ? "Deleting" : "Deleted";
    case "move":
      return inProgress ? "Moving" : "Moved";
  }
}
