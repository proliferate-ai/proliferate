import {
  forwardRef,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { X } from "@proliferate/ui/icons";

interface ChromeWorkspaceTabProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  isActive: boolean;
  isMultiSelected?: boolean;
  width: number;
  icon: ReactNode;
  label: string;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onSelectPointerDownCapture?: (event: PointerEvent<HTMLButtonElement>) => void;
  onClose: () => void;
  badge?: ReactNode;
  shortcutLabel?: string | null;
  shortcutRevealVisible?: boolean;
  rightAccessory?: ReactNode;
  groupColor?: string | null;
  isChild?: boolean;
  hideLeftDivider?: boolean;
  hideRightDivider?: boolean;
}

export const ChromeWorkspaceTab = forwardRef<HTMLDivElement, ChromeWorkspaceTabProps>(
  function ChromeWorkspaceTab({
    isActive,
    isMultiSelected = false,
    width,
    icon,
    label,
    onSelect,
    onSelectPointerDownCapture,
    onClose,
    badge,
    shortcutLabel = null,
    shortcutRevealVisible = false,
    rightAccessory,
    groupColor: _groupColor,
    isChild: _isChild = false,
    hideLeftDivider: _hideLeftDivider = false,
    hideRightDivider: _hideRightDivider = false,
    className = "",
    style,
    ...props
  }, ref) {
    const contentWidth = Math.max(0, width);
    const isMini = contentWidth < 48;
    const isSmaller = contentWidth < 60;
    const isSmall = contentWidth < 84;
    const showTitle = !isMini && !isSmaller;
    const showBadge = !isSmall;
    const showShortcut = Boolean(shortcutLabel) && !isSmall;
    const showCloseButton = !isMini || isActive;
    const titleMaskEnd = showShortcut ? 36 : 20;
    const titleMask = `linear-gradient(90deg, #000 0%, #000 calc(100% - ${titleMaskEnd}px), transparent)`;

    return (
      <div
        ref={ref}
        role="presentation"
        data-telemetry-mask="true"
        data-active={isActive ? true : undefined}
        data-multi-selected={isMultiSelected ? true : undefined}
        className={`workspace-shell-tab group/tab relative h-7 min-w-0 shrink-0 app-region-no-drag select-none ${className}`}
        style={{
          width,
          ...style,
        }}
        {...props}
      >
        <span
          aria-hidden="true"
          className="workspace-shell-tab__surface pointer-events-none absolute inset-0 rounded-lg border transition-[background-color,border-color] duration-150"
        />
        <div
          className={`absolute inset-0 flex items-center overflow-hidden rounded-lg py-1 ${
            isMini ? "gap-1 px-1" : isSmall ? "gap-1 px-2" : "gap-2 px-2"
          }`}
        >
          {showCloseButton && (
            <span className="workspace-shell-tab__leading relative z-20 flex size-4 shrink-0 items-center justify-center">
              <span className="workspace-shell-tab__icon flex size-4 shrink-0 items-center justify-center group-hover/tab:hidden group-focus-within/tab:hidden">
                {icon}
              </span>
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
                className="workspace-shell-tab__close hidden size-4 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground group-hover/tab:inline-flex group-focus-within/tab:inline-flex focus-visible:inline-flex"
              >
                <X className="size-2.5" />
              </Button>
            </span>
          )}
          <Button
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="ghost"
            size="sm"
            onClick={onSelect}
            onPointerDownCapture={onSelectPointerDownCapture}
            className={`workspace-shell-tab__button relative z-10 h-full min-w-0 flex-1 justify-start rounded-none bg-transparent p-0 text-sm leading-4 hover:bg-transparent ${
              isActive
                ? "font-medium text-foreground"
                : isMultiSelected
                  ? "font-medium text-foreground"
                : "font-medium text-muted-foreground group-hover/tab:text-foreground"
            } ${isSmall ? "gap-1" : "gap-2"}`}
          >
            {!showCloseButton && (
              <span className="workspace-shell-tab__icon flex size-4 shrink-0 items-center justify-center">
                {icon}
              </span>
            )}
            {showTitle && (
              <span
                className="workspace-shell-tab__label min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left text-base"
                style={{
                  WebkitMaskImage: titleMask,
                  maskImage: titleMask,
                }}
              >
                {label}
              </span>
            )}
            {showBadge && badge}
          </Button>
          {showShortcut && shortcutLabel ? (
            <ShortcutBadge
              label={shortcutLabel}
              className={`pointer-events-none absolute right-2 top-1/2 z-20 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity duration-150 ${
                shortcutRevealVisible ? "opacity-100" : ""
              }`}
            />
          ) : null}
          {!isMini && rightAccessory}
        </div>
      </div>
    );
  },
);
