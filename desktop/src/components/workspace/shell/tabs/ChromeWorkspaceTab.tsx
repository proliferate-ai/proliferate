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
    groupColor: _groupColor,
    isChild: _isChild = false,
    hideLeftDivider = false,
    hideRightDivider = false,
    className = "",
    style,
    ...props
  }, ref) {
    const contentWidth = Math.max(0, width - 18);
    const isMini = contentWidth < 48;
    const isSmaller = contentWidth < 60;
    const isSmall = contentWidth < 84;
    const showTitle = !isMini && !isSmaller;
    const showBadge = !isSmall;
    const showCloseButton = isActive || !isMini;
    const activeFill = "var(--color-card)";
    const selectedFill = "color-mix(in oklab, var(--color-foreground) 10%, var(--color-card))";
    const inactiveFill = "color-mix(in oklab, var(--color-foreground) 5%, transparent)";
    const tabFill = isActive ? activeFill : isMultiSelected ? selectedFill : inactiveFill;
    const titleMask = "linear-gradient(90deg, #000 0%, #000 calc(100% - 24px), transparent)";

    return (
      <div
        ref={ref}
        role="presentation"
        data-telemetry-mask="true"
        className={`group/tab relative h-9 min-w-0 shrink-0 app-region-no-drag select-none border-0 ${className}`}
        style={{
          width,
          ...style,
        }}
        {...props}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[7px] top-[7px] left-[9px] right-[9px]"
        >
          <span
            className={`absolute inset-y-0 left-0 w-px bg-border/70 transition-opacity ${
              hideLeftDivider || isActive ? "opacity-0" : ""
            } group-hover/tab:opacity-0`}
          />
          <span
            className={`absolute inset-y-0 right-0 w-px bg-border/70 transition-opacity ${
              hideRightDivider || isActive ? "opacity-0" : ""
            } group-hover/tab:opacity-0`}
          />
        </div>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-[9px] right-[9px] rounded-t-lg transition-opacity ${
            isActive
              ? "opacity-100"
              : isMultiSelected
                ? "opacity-100 group-hover/tab:opacity-100"
                : "opacity-0 group-hover/tab:opacity-100"
          }`}
          style={{ backgroundColor: tabFill }}
        />
        <div
          className={`absolute inset-y-0 left-[9px] right-[9px] flex items-center overflow-hidden rounded-t-lg py-[9px] ${
            isMini ? "px-0.5" : "px-2"
          }`}
        >
          <Button
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="ghost"
            size="sm"
            onClick={onSelect}
            onPointerDownCapture={onSelectPointerDownCapture}
            className={`h-full min-w-0 flex-1 justify-start rounded-none bg-transparent p-0 text-xs hover:bg-transparent ${
              isActive
                ? "font-normal text-foreground"
                : isMultiSelected
                  ? "font-medium text-foreground"
                : "font-normal text-muted-foreground group-hover/tab:text-foreground"
            } ${isSmall ? "gap-1" : "gap-2"}`}
          >
            <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
              {icon}
            </span>
            {showTitle && (
              <span
                className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left"
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
              className={`size-4 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground ${
                isActive
                  ? "opacity-80 hover:opacity-100"
                  : "opacity-0 group-hover/tab:opacity-80 hover:!opacity-100 focus-visible:opacity-100"
              }`}
            >
              <X className="size-2" />
            </Button>
          )}
        </div>
      </div>
    );
  },
);
