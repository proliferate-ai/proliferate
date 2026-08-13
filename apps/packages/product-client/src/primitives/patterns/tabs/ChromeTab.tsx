import {
  forwardRef,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "#product/primitives/Button";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { TypewriterRevealText } from "#product/primitives/TypewriterRevealText";
import { X } from "#product/primitives/icons/core";

interface ChromeTabProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  isActive: boolean;
  isMultiSelected?: boolean;
  width: number;
  label: string;
  /** True once `label` is a real assigned name; reveals it once, on the first
   *  assignment only. */
  hasAssignedLabel?: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onSelectPointerDownCapture?: (event: PointerEvent<HTMLButtonElement>) => void;
  canClose?: boolean;
  onClose: () => void;
  badge?: ReactNode;
  shortcutLabel?: string | null;
  shortcutRevealVisible?: boolean;
  /** Accepted and ignored today: the grouped/divider treatment these four
   *  describe is not painted by this component. Carried across the promotion
   *  unchanged so the strip's call sites keep compiling; the shell slice
   *  either wires them up or drops them. */
  groupColor?: string | null;
  isChild?: boolean;
  hideLeftDivider?: boolean;
  hideRightDivider?: boolean;
}

/**
 * The tabs kit's chrome-style tab: full-height surface, truncating label,
 * trailing status slot, hover-revealed close, active underline. Slots take
 * ReactNodes (`badge`) and the strip that owns it supplies geometry (`width`).
 */
export const ChromeTab = forwardRef<HTMLDivElement, ChromeTabProps>(
  function ChromeTab({
    isActive,
    isMultiSelected = false,
    width,
    label,
    hasAssignedLabel = false,
    onSelect,
    onSelectPointerDownCapture,
    canClose = true,
    onClose,
    badge,
    shortcutLabel = null,
    shortcutRevealVisible = false,
    groupColor: _groupColor,
    isChild: _isChild = false,
    hideLeftDivider: _hideLeftDivider = false,
    hideRightDivider: _hideRightDivider = false,
    className = "",
    style,
    ...props
  }, ref) {
    const contentWidth = Math.max(0, width);
    const isSmall = contentWidth < 84;
    const showBadge = !isSmall;
    const showStatus = showBadge && badge != null;
    const showShortcut = Boolean(shortcutLabel) && shortcutRevealVisible && !isSmall;

    return (
      <div
        ref={ref}
        role="presentation"
        data-telemetry-mask="true"
        data-active={isActive ? true : undefined}
        data-multi-selected={isMultiSelected ? true : undefined}
        data-has-status={showStatus ? true : undefined}
        data-has-shortcut={showShortcut ? true : undefined}
        className={`workspace-shell-tab group/tab relative h-full min-w-0 shrink-0 app-region-no-drag select-none ${className}`}
        style={{
          width,
          ...style,
        }}
        {...props}
      >
        <span
          aria-hidden="true"
          className="workspace-shell-tab__surface pointer-events-none absolute inset-0 border"
        />
        <div
          className="workspace-shell-tab__content absolute inset-0 flex items-center overflow-hidden"
        >
          <Button
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="ghost"
            size="sm"
            onClick={onSelect}
            onPointerDownCapture={onSelectPointerDownCapture}
            className="workspace-shell-tab__button relative z-10 h-full min-w-0 flex-1 justify-start gap-(--workspace-shell-tab-content-gap) rounded-none bg-transparent px-(--workspace-shell-tab-inline-padding) py-0 hover:bg-transparent"
          >
            <span
              className={`workspace-shell-tab__label min-w-0 flex-1 truncate whitespace-nowrap text-left ${
                isActive || isMultiSelected
                  ? "font-medium text-sidebar-foreground"
                  : "font-normal text-sidebar-muted-foreground group-hover/tab:text-sidebar-foreground"
              }`}
            >
              <TypewriterRevealText
                text={label}
                revealOnFirstAssignment={hasAssignedLabel}
              />
            </span>
            {showStatus ? (
              <span
                className={`workspace-shell-tab__status flex items-center justify-center group-hover/tab:opacity-0 group-focus-within/tab:opacity-0 ${
                  showShortcut ? "opacity-0" : ""
                }`}
              >
                {badge}
              </span>
            ) : null}
            {showShortcut && shortcutLabel ? (
              <ShortcutBadge
                aria-hidden="true"
                label={shortcutLabel}
                className="workspace-shell-tab__shortcut pointer-events-none shrink-0 text-muted-foreground group-hover/tab:invisible group-focus-within/tab:invisible"
              />
            ) : null}
          </Button>
          {canClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-tab-drag-ignore="true"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
              title="Close tab"
              aria-label="Close tab"
              className="workspace-shell-tab__close absolute right-1.5 top-1/2 z-20 hidden size-icon-button-sm shrink-0 -translate-y-1/2 rounded-md text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active group-hover/tab:inline-flex group-focus-within/tab:inline-flex focus-visible:inline-flex"
            >
              <X className="icon-compact" />
            </Button>
          )}
        </div>
        {isActive ? (
          <span
            aria-hidden="true"
            className="workspace-shell-tab__underline pointer-events-none absolute z-raised"
          />
        ) : null}
      </div>
    );
  },
);
