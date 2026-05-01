import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { Terminal as TerminalIcon } from "@/components/ui/icons";
import { TerminalHeaderIcon } from "@/components/workspace/shell/right-panel/TerminalHeaderIcon";

const HEADER_TERMINAL_TAB_CLASS = "ui-tab-system-tab right-panel-terminal-tab";

interface TerminalHeaderButtonProps {
  terminalId: string;
  terminal: TerminalRecord | null;
  displayTitle: string;
  isActive: boolean;
  unread: boolean;
  isRuntimeReady: boolean;
  isDragging: boolean;
  shouldSuppressClick: () => boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
}

export function TerminalHeaderButton({
  terminalId,
  terminal,
  displayTitle,
  isActive,
  unread,
  isRuntimeReady,
  isDragging,
  shouldSuppressClick,
  onSelect,
  onClose,
  onRename,
}: TerminalHeaderButtonProps) {
  if (terminal) {
    return (
      <TerminalHeaderIcon
        terminal={terminal}
        displayTitle={displayTitle}
        isActive={isActive}
        unread={unread}
        isRuntimeReady={isRuntimeReady}
        isDragging={isDragging}
        shouldSuppressClick={shouldSuppressClick}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
      />
    );
  }

  return (
    <Tooltip content={displayTitle} className="right-panel-terminal-tooltip">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={displayTitle}
        role="tab"
        aria-selected={isActive}
        aria-controls={`tabpanel-editor-panel-group-terminal-${terminalId}`}
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
        className={HEADER_TERMINAL_TAB_CLASS}
      >
        <span className="ui-tab-system-tab__content">
          <TerminalIcon className="ui-tab-system-tab__icon" />
          <span className="ui-tab-system-tab__label">
            <span className="ui-tab-system-tab__label-primary">{displayTitle}</span>
          </span>
          <span
            className="ui-tab-system-tab__dirty-indicator"
            data-dirty={unread ? true : undefined}
            aria-hidden="true"
          />
        </span>
      </Button>
    </Tooltip>
  );
}
