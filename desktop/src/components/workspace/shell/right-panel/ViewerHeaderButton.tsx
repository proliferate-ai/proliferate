import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { AppShellReviewIcon, AppShellTabCloseIcon } from "@/components/ui/icons";
import {
  viewerTargetDisplayPath,
  viewerTargetLabel,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";

const HEADER_VIEWER_TAB_CLASS = "ui-tab-system-tab right-panel-terminal-tab";

interface ViewerHeaderButtonProps {
  target: ViewerTarget;
  isActive: boolean;
  isDirty: boolean;
  isDiff: boolean;
  isDragging: boolean;
  shouldSuppressClick: () => boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function ViewerHeaderButton({
  target,
  isActive,
  isDirty,
  isDiff,
  isDragging,
  shouldSuppressClick,
  onSelect,
  onClose,
}: ViewerHeaderButtonProps) {
  const displayPath = viewerTargetDisplayPath(target);
  const label = viewerTargetLabel(target);
  const title = displayPath ?? label;

  return (
    <Tooltip content={title} className="right-panel-terminal-tooltip">
      <div className="right-panel-terminal-tab-shell">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={title}
          role="tab"
          aria-selected={isActive}
          aria-controls="tabpanel-workspace-right-panel-viewer"
          tabIndex={isActive ? 0 : -1}
          data-reorderable="true"
          aria-grabbed={isDragging}
          data-active={isActive ? true : undefined}
          data-dragging={isDragging ? true : undefined}
          onClick={() => {
            if (shouldSuppressClick()) {
              return;
            }
            onSelect();
          }}
          className={HEADER_VIEWER_TAB_CLASS}
        >
          <span className="ui-tab-system-tab__content">
            {target.kind === "allChanges" ? (
              <AppShellReviewIcon className="ui-tab-system-tab__icon" />
            ) : (
              <FileTreeEntryIcon
                name={label}
                path={displayPath ?? label}
                kind="file"
                className="ui-tab-system-tab__icon"
              />
            )}
            <span className="ui-tab-system-tab__label">
              <span className="ui-tab-system-tab__label-primary">{label}</span>
            </span>
            {isDiff && target.kind !== "allChanges" && (
              <span className="shrink-0 text-[10px] font-medium text-git-green">DIFF</span>
            )}
            <span
              className="ui-tab-system-tab__dirty-indicator"
              data-dirty={isDirty ? true : undefined}
              aria-hidden="true"
            />
          </span>
        </Button>
        <div
          className="ui-tab-system-tab__close-container"
          data-right-panel-tab-no-drag="true"
        >
          <IconButton
            size="xs"
            tone="sidebar"
            title={`Close ${label}`}
            className="ui-icon-button ui-tab-system-tab__close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <AppShellTabCloseIcon className="ui-icon" />
          </IconButton>
        </div>
      </div>
    </Tooltip>
  );
}
