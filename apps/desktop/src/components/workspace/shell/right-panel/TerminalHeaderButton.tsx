import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { AppShellTerminalIcon } from "@proliferate/ui/icons";
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
  shortcutLabel: string | null;
  shortcutRevealVisible: boolean;
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
  shortcutLabel,
  shortcutRevealVisible,
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
        shortcutLabel={shortcutLabel}
        shortcutRevealVisible={shortcutRevealVisible}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
      />
    );
  }

  return (
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
      <span
        className="ui-tab-system-tab__content"
        data-shortcut-reveal={shortcutRevealVisible ? true : undefined}
      >
        <AppShellTerminalIcon className="ui-tab-system-tab__icon" />
        <span className="ui-tab-system-tab__label">
          <span className="ui-tab-system-tab__label-primary">{displayTitle}</span>
        </span>
        <span
          className="ui-tab-system-tab__dirty-indicator"
          data-dirty={unread ? true : undefined}
          aria-hidden="true"
        />
        {shortcutLabel ? (
          <ShortcutBadge
            label={shortcutLabel}
            className={`right-panel-shortcut-badge opacity-0 transition-opacity duration-150 ${
              shortcutRevealVisible ? "opacity-100" : ""
            }`}
          />
        ) : null}
      </span>
    </Button>
  );
}
