import { useEffect, useState } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@/components/ui/Tooltip";
import { useTerminalTabNativeContextMenu } from "@/hooks/terminals/use-terminal-tab-native-context-menu";
import {
  Check,
  Pencil,
  Terminal as TerminalIcon,
  X,
} from "@/components/ui/icons";

const HEADER_TERMINAL_TAB_CLASS = "ui-tab-system-tab right-panel-terminal-tab";
const HEADER_TAB_EDIT_CLASS =
  "ui-tab-system-tab right-panel-terminal-tab right-panel-terminal-tab--editing";
const HEADER_TAB_ACTION_CLASS = "ui-icon-button right-panel-terminal-edit-action";

interface TerminalHeaderIconProps {
  terminal: TerminalRecord;
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

export function TerminalHeaderIcon({
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
}: TerminalHeaderIconProps) {
  const [renameDraft, setRenameDraft] = useState(displayTitle);
  const [renaming, setRenaming] = useState(false);
  const [isEditingHeaderTitle, setIsEditingHeaderTitle] = useState(false);

  const handleRenameCommand = () => {
    onSelect();
    setIsEditingHeaderTitle(true);
  };

  const { onContextMenuCapture } = useTerminalTabNativeContextMenu({
    isRuntimeReady,
    onRename: handleRenameCommand,
    onClose,
  });

  useEffect(() => {
    if (!isEditingHeaderTitle) {
      setRenameDraft(displayTitle);
    }
  }, [displayTitle, isEditingHeaderTitle]);

  const submitRename = (title: string, onDone?: () => void) => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle.length > 160) {
      return;
    }
    setRenaming(true);
    onRename(nextTitle)
      .then(() => {
        setIsEditingHeaderTitle(false);
        onDone?.();
      })
      .catch(() => undefined)
      .finally(() => setRenaming(false));
  };

  if (isActive && isEditingHeaderTitle) {
    return (
      <div className="right-panel-terminal-tab-shell" data-right-panel-tab-no-drag="true">
        <form
          className={HEADER_TAB_EDIT_CLASS}
          onSubmit={(event) => {
            event.preventDefault();
            submitRename(renameDraft);
          }}
          data-active="true"
          data-label-editing="true"
        >
          <div className="ui-tab-system-tab__content">
            <TerminalIcon className="ui-tab-system-tab__icon" />
            <span className="ui-tab-system-tab__label-edit-slot">
              <Input
                value={renameDraft}
                maxLength={160}
                onChange={(event) => setRenameDraft(event.target.value)}
                className="ui-tab-system-tab__label-input"
                autoFocus
              />
            </span>
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              title="Save terminal title"
              aria-label="Save terminal title"
              disabled={renaming || !renameDraft.trim()}
              className={HEADER_TAB_ACTION_CLASS}
            >
              <Check className="ui-icon" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Cancel terminal title edit"
              aria-label="Cancel terminal title edit"
              className={HEADER_TAB_ACTION_CLASS}
              onClick={() => {
                setRenameDraft(displayTitle);
                setIsEditingHeaderTitle(false);
              }}
            >
              <X className="ui-icon" />
            </Button>
          </div>
        </form>
      </div>
    );
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={displayTitle}
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-editor-panel-group-terminal-${terminal.id}`}
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
      onDoubleClick={() => setIsEditingHeaderTitle(true)}
      onContextMenuCapture={onContextMenuCapture}
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
  );

  return (
    <Tooltip content={displayTitle} className="right-panel-terminal-tooltip">
      <div className="right-panel-terminal-tab-shell">
        <PopoverButton
          triggerMode="contextMenu"
          side="bottom"
          align="start"
          className="w-56 rounded-md border border-border bg-popover p-1 shadow-floating"
          trigger={trigger}
        >
          {(close) => (
            <div className="py-0.5">
              <PopoverMenuItem
                label="Rename"
                icon={<Pencil className="size-3.5" />}
                onClick={() => {
                  close();
                  handleRenameCommand();
                }}
              />
              <PopoverMenuItem
                label="Close"
                icon={<X className="size-3.5" />}
                disabled={!isRuntimeReady}
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  close();
                  onClose();
                }}
              />
            </div>
          )}
        </PopoverButton>
        <div
          className="ui-tab-system-tab__close-container"
          data-right-panel-tab-no-drag="true"
        >
          <IconButton
            size="xs"
            tone="sidebar"
            title={`Close ${displayTitle}`}
            disabled={!isRuntimeReady}
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
