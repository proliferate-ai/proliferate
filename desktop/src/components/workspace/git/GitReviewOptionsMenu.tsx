import {
  CollapseAll,
  ExpandAll,
  RefreshCw,
  WrapText,
} from "@/components/ui/icons";
import {
  PaneOptionsMenu,
  PaneOptionsMenuItem,
} from "@/components/workspace/pane/PaneOptionsMenu";

export function GitReviewOptionsMenu({
  allFilesCollapsed,
  wrapLongLines,
  isRuntimeReady,
  onToggleAllFiles,
  onToggleWrap,
  onRefresh,
}: {
  allFilesCollapsed: boolean;
  wrapLongLines: boolean;
  isRuntimeReady: boolean;
  onToggleAllFiles: () => void;
  onToggleWrap: () => void;
  onRefresh: () => void;
}) {
  return (
    <PaneOptionsMenu label="Git review options">
      {(close) => (
        <div className="flex flex-col gap-px">
          <PaneOptionsMenuItem
            label={allFilesCollapsed ? "Expand all diffs" : "Collapse all diffs"}
            icon={allFilesCollapsed ? (
              <ExpandAll className="size-3" />
            ) : (
              <CollapseAll className="size-3" />
            )}
            onClick={() => {
              onToggleAllFiles();
              close();
            }}
          />
          <PaneOptionsMenuItem
            label={wrapLongLines ? "Turn word wrap off" : "Turn word wrap on"}
            icon={<WrapText className="size-3" />}
            onClick={() => {
              onToggleWrap();
              close();
            }}
          />
          <PaneOptionsMenuItem
            label="Refresh"
            disabled={!isRuntimeReady}
            icon={<RefreshCw className="size-3" />}
            onClick={() => {
              onRefresh();
              close();
            }}
          />
        </div>
      )}
    </PaneOptionsMenu>
  );
}
