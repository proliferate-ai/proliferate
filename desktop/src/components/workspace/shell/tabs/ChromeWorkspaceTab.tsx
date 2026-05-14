import {
  forwardRef,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { X } from "@/components/ui/icons";

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
    const showCloseButton = !isMini || isActive;
    const activeFill = "color-mix(in oklab, var(--color-foreground) 6%, var(--color-background))";
    const selectedFill = "color-mix(in oklab, var(--color-foreground) 8%, var(--color-background))";
    const inactiveFill = "color-mix(in oklab, var(--color-foreground) 2%, var(--color-background))";
    const tabFill = isActive ? activeFill : isMultiSelected ? selectedFill : inactiveFill;
    const titleMask = "linear-gradient(90deg, #000 0%, #000 calc(100% - 20px), transparent)";

    return (
      <div
        ref={ref}
        role="presentation"
        data-telemetry-mask="true"
        className={`group/tab relative h-7 min-w-0 shrink-0 app-region-no-drag select-none ${className}`}
        style={{
          width,
          ...style,
        }}
        {...props}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 rounded-lg border transition-[background-color,border-color,opacity] duration-150 ${
            isActive
              ? "border-border/70 opacity-100"
              : isMultiSelected
                ? "border-border/60 opacity-100 group-hover/tab:opacity-100"
                : "border-border/15 opacity-100 group-hover/tab:border-border/35"
          }`}
          style={{ backgroundColor: tabFill }}
        />
        <div
          className={`absolute inset-0 flex items-center overflow-hidden rounded-lg py-1 ${
            isMini ? "px-1" : "px-2"
          }`}
        >
          {showCloseButton && (
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
              className="pointer-events-none absolute top-1.5 z-20 size-4 shrink-0 rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/tab:pointer-events-auto group-hover/tab:opacity-90 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-90 focus-visible:pointer-events-auto focus-visible:opacity-100"
              style={{ left: isMini ? 4 : 8 }}
            >
              <X className="size-2.5" />
            </Button>
          )}
          <Button
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="ghost"
            size="sm"
            onClick={onSelect}
            onPointerDownCapture={onSelectPointerDownCapture}
            className={`relative z-10 h-full min-w-0 flex-1 justify-start rounded-none bg-transparent p-0 text-sm leading-4 hover:bg-transparent ${
              isActive
                ? "font-medium text-foreground"
                : isMultiSelected
                  ? "font-medium text-foreground"
                : "font-medium text-muted-foreground group-hover/tab:text-foreground"
            } ${isSmall ? "gap-1" : "gap-2"}`}
          >
            <span
              className={`flex size-4 shrink-0 items-center justify-center transition-opacity ${
                showCloseButton
                  ? "group-hover/tab:opacity-0 group-focus-within/tab:opacity-0"
                  : ""
              }`}
            >
              {icon}
            </span>
            {showTitle && (
              <span
                className="min-w-0 font-foreground flex-1 text-base overflow-hidden whitespace-nowrap text-left"
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
          {!isMini && rightAccessory}
        </div>
      </div>
    );
  },
);
