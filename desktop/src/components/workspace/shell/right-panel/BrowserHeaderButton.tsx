import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { Globe, X } from "@/components/ui/icons";

const HEADER_BROWSER_TAB_CLASS = "ui-tab-system-tab right-panel-terminal-tab";

interface BrowserHeaderButtonProps {
  browserId: string;
  displayTitle: string;
  isActive: boolean;
  isDragging: boolean;
  shouldSuppressClick: () => boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function BrowserHeaderButton({
  browserId,
  displayTitle,
  isActive,
  isDragging,
  shouldSuppressClick,
  onSelect,
  onClose,
}: BrowserHeaderButtonProps) {
  return (
    <Tooltip content={displayTitle} className="right-panel-terminal-tooltip">
      <div className="right-panel-terminal-tab-shell">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={displayTitle}
          role="tab"
          aria-selected={isActive}
          aria-controls={`tabpanel-editor-panel-group-browser-${browserId}`}
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
          className={HEADER_BROWSER_TAB_CLASS}
        >
          <span className="ui-tab-system-tab__content">
            <Globe className="ui-tab-system-tab__icon" />
            <span className="ui-tab-system-tab__label">
              <span className="ui-tab-system-tab__label-primary">{displayTitle}</span>
            </span>
            <span
              className="ui-tab-system-tab__dirty-indicator"
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
            title={`Close ${displayTitle}`}
            className="ui-icon-button ui-tab-system-tab__close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="ui-icon" />
          </IconButton>
        </div>
      </div>
    </Tooltip>
  );
}
