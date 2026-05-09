import { Button } from "@/components/ui/Button";
import { FileChangeStats } from "@/components/ui/content/FileDiffCard";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { ArrowUpRight, Check, Plus } from "@/components/ui/icons";
import { FileText } from "@/components/ui/file-icons";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  GitPanelFile,
  GitPanelSectionScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

type StagePath = (path: string) => Promise<unknown>;
type OpenFile = (path: string) => Promise<void>;
type OpenFileDiff = (
  path: string,
  options?: {
    scope?: GitPanelSectionScope | null;
    baseRef?: string | null;
    oldPath?: string | null;
  },
) => Promise<void>;

interface ChangesFileRowProps {
  file: GitPanelFile;
  sectionScope: GitPanelSectionScope;
  baseRef: string | null;
  isBranchMode: boolean;
  isRuntimeReady: boolean;
  stagePath: StagePath;
  unstagePath: StagePath;
  openFile: OpenFile;
  openFileDiff: OpenFileDiff;
}

export function ChangesFileRow({
  file,
  sectionScope,
  baseRef,
  isBranchMode,
  isRuntimeReady,
  stagePath,
  unstagePath,
  openFile,
  openFileDiff,
}: ChangesFileRowProps) {
  const baseName = file.displayPath.split("/").pop() ?? file.displayPath;
  const shouldUnstage = sectionScope === "staged";
  const stateLabel = isBranchMode
    ? file.status
    : shouldUnstage
      ? "staged"
      : "unstaged";
  const openDiff = () => openFileDiff(file.path, {
    scope: sectionScope,
    baseRef: isBranchMode ? baseRef : null,
    oldPath: isBranchMode ? file.oldPath : null,
  });

  return (
    <div className="group rounded-md border border-sidebar-border/60 bg-sidebar-accent/20 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/70">
      <div className="flex min-w-0 items-center gap-1 pr-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void openDiff()}
          disabled={!isRuntimeReady}
          title={`Open ${file.displayPath} diff`}
          className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md bg-transparent px-2 py-2 text-left hover:bg-transparent"
        >
          <FileTreeEntryIcon
            name={baseName}
            path={file.path}
            kind="file"
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.68rem] font-medium text-sidebar-foreground [direction:ltr] [unicode-bidi:plaintext]">
              {file.displayPath}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[10px] text-sidebar-muted-foreground">
              <span className="capitalize">{stateLabel}</span>
              <FileChangeStats
                additions={file.additions}
                deletions={file.deletions}
              />
            </span>
          </span>
        </Button>
        <Tooltip content="Open file">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void openFile(file.path)}
            disabled={!isRuntimeReady}
            aria-label={`Open ${baseName} file`}
            className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <FileText className="size-3" />
          </Button>
        </Tooltip>
        {!isBranchMode && (
          <Tooltip content={shouldUnstage ? "Unstage" : "Stage"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (shouldUnstage) {
                  void unstagePath(file.path);
                } else {
                  void stagePath(file.path);
                }
              }}
              disabled={!isRuntimeReady}
              aria-label={shouldUnstage ? `Unstage ${baseName}` : `Stage ${baseName}`}
              className={`size-6 hover:bg-sidebar-accent ${
                shouldUnstage
                  ? "text-git-green"
                  : "text-sidebar-muted-foreground hover:text-sidebar-foreground"
              }`}
            >
              {shouldUnstage ? (
                <Check className="size-3" />
              ) : (
                <Plus className="size-3" />
              )}
            </Button>
          </Tooltip>
        )}
        <Tooltip singleLine content="Open diff">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void openDiff()}
            disabled={!isRuntimeReady}
            aria-label={`Open ${baseName} diff`}
            className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ArrowUpRight className="size-3" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
