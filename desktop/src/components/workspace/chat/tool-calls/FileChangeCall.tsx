import type { ReactNode } from "react";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { HighlightedCodePanel } from "@/components/ui/content/HighlightedCodePanel";
import { ArrowRight, FilePen, FilePlus, Minus } from "@/components/ui/icons";
import {
  ToolCallBlock,
  TOOL_CALL_BODY_MAX_HEIGHT_CLASS,
} from "./ToolCallBlock";
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
}: FileChangeCallProps) {
  const hasDiff = !!patch;
  const actionLabel = getOperationLabel(operation, status);
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

  return (
    <ToolCallBlock
      icon={getOperationIcon(operation)}
      name={label}
      hint={statsHint}
      status={status}
      duration={duration}
      defaultExpanded={defaultExpanded}
      expandable={hasDiff || !!preview}
      bodyClassName="overflow-hidden"
    >
      {hasDiff || preview ? (
        <div className="overflow-hidden rounded-md border border-border/60 bg-muted/25">
          {hasDiff ? (
            <DiffViewer
              patch={patch!}
              filePath={newWorkspacePath || workspacePath || newPath || path}
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            />
          ) : preview ? (
            <div className="p-2">
              <HighlightedCodePanel
                code={preview}
                filename={newWorkspacePath || workspacePath || newPath || path}
                showLanguageLabel={false}
                className="border-0 bg-transparent"
                contentClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </ToolCallBlock>
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
