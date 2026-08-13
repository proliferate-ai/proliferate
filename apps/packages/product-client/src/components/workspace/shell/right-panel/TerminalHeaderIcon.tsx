import { useEffect, useState } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { PanelHeaderEntry } from "#product/primitives/patterns/panel/PanelHeaderEntry";
import { POPOVER_FRAME_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { useTerminalTabNativeContextMenu } from "#product/hooks/terminals/ui/use-terminal-tab-native-context-menu";
import { AppShellTabCloseIcon, AppShellTerminalIcon } from "#product/primitives/icons/app-shell";
import {
  Check,
  Pencil,
  X,
} from "#product/primitives/icons/core";

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
  /** Roving-tabIndex floor passthrough — see PanelHeaderEntry. */
  tabIndexFloor?: boolean;
  shouldSuppressClick: () => boolean;
  shortcutLabel: string | null;
  shortcutRevealVisible: boolean;
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
  tabIndexFloor = false,
  shouldSuppressClick,
  shortcutLabel,
  shortcutRevealVisible,
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
            <AppShellTerminalIcon className="ui-tab-system-tab__icon" />
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
    <PanelHeaderEntry
      label={displayTitle}
      icon={<AppShellTerminalIcon className="icon-control" />}
      active={isActive}
      dirty={unread}
      tabIndexFloor={tabIndexFloor}
      controls={`tabpanel-editor-panel-group-terminal-${terminal.id}`}
      trailing={shortcutRevealVisible && shortcutLabel ? (
        <ShortcutBadge label={shortcutLabel} className="right-panel-shortcut-badge" />
      ) : null}
      data-reorderable="true"
      aria-grabbed={isDragging}
      data-dragging={isDragging ? true : undefined}
      onSelect={() => {
        if (shouldSuppressClick()) {
          return;
        }
        onSelect();
      }}
      onDoubleClick={() => setIsEditingHeaderTitle(true)}
      onContextMenuCapture={onContextMenuCapture}
    />
  );

  return (
    <div className="right-panel-terminal-tab-shell">
      <PopoverButton
        triggerMode="contextMenu"
        side="bottom"
        align="start"
        className={`w-56 ${POPOVER_FRAME_CLASS} p-1`}
        trigger={trigger}
      >
        {(close) => (
          <div className="py-0.5">
            <PopoverMenuItem
              label="Rename"
              icon={<Pencil className="icon-paired" />}
              onClick={() => {
                close();
                handleRenameCommand();
              }}
            />
            <PopoverMenuItem
              label="Close"
              icon={<X className="icon-paired" />}
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
      {/* Close affordance composed at the call site, not via PanelHeaderEntry's
          own onClose: the header strip's drag/reorder system starts a pointer
          session on ANY pointerdown inside the drop zone unless the target is
          under a `data-right-panel-tab-no-drag` element (see
          use-right-panel-header-drag.ts). PanelHeaderEntry doesn't expose a
          passthrough for its internal close button, so widening it for this
          one caller would be a second library edit beyond the sanctioned
          roving-tabIndex fix — flagged in the PR body instead. */}
      <RowActionIconButton
        label={`Close ${displayTitle}`}
        disabled={!isRuntimeReady}
        data-right-panel-tab-no-drag="true"
        className="size-icon-button-sm rounded-full"
        onClick={onClose}
      >
        <AppShellTabCloseIcon />
      </RowActionIconButton>
    </div>
  );
}
