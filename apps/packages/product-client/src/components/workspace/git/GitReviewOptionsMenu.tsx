import {
  CollapseAll,
  Columns2,
  ExpandAll,
  RefreshCw,
  WrapText,
} from "@proliferate/ui/icons";
import { PaneOptionsMenuItem } from "@proliferate/ui/layout/PaneOptionsMenuItem";
import { PaneOptionsMenu } from "#product/components/workspace/pane/PaneOptionsMenu";

export function GitReviewOptionsMenu({
  allFilesCollapsed,
  wrapLongLines,
  layout,
  isRuntimeReady,
  onToggleAllFiles,
  onToggleWrap,
  onToggleLayout,
  onRefresh,
}: {
  allFilesCollapsed: boolean;
  wrapLongLines: boolean;
  layout: "unified" | "split";
  isRuntimeReady: boolean;
  onToggleAllFiles: () => void;
  onToggleWrap: () => void;
  onToggleLayout: () => void;
  onRefresh: () => void;
}) {
  return (
    <PaneOptionsMenu label="Git review options">
      {(close) => (
        <div className="flex flex-col gap-px">
          <PaneOptionsMenuItem
            label={allFilesCollapsed ? "Expand all diffs" : "Collapse all diffs"}
            icon={allFilesCollapsed ? <ExpandAll /> : <CollapseAll />}
            onClick={() => {
              onToggleAllFiles();
              close();
            }}
          />
          <PaneOptionsMenuItem
            label={layout === "split" ? "Use unified diff" : "Use split diff"}
            icon={<Columns2 />}
            onClick={() => {
              onToggleLayout();
              close();
            }}
          />
          <PaneOptionsMenuItem
            label={wrapLongLines ? "Turn word wrap off" : "Turn word wrap on"}
            icon={<WrapText />}
            onClick={() => {
              onToggleWrap();
              close();
            }}
          />
          <PaneOptionsMenuItem
            label="Refresh"
            disabled={!isRuntimeReady}
            icon={<RefreshCw />}
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
