import {
  forwardRef,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from "react";
import { twMerge } from "tailwind-merge";

interface AutoHideScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  allowHorizontal?: boolean;
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"];
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"];
  onViewportScroll?: (viewport: HTMLDivElement) => void;
}

export const AutoHideScrollArea = forwardRef<HTMLDivElement, AutoHideScrollAreaProps>(
  function AutoHideScrollArea(
    {
      children,
      className = "",
      viewportClassName = "",
      contentClassName = "",
      allowHorizontal = false,
      overscrollBehavior = "none",
      overscrollBehaviorX,
      overscrollBehaviorY,
      onViewportScroll,
    },
    ref,
  ) {
    const viewportStyle = {
      overscrollBehavior,
      ...(overscrollBehaviorX ? { overscrollBehaviorX } : {}),
      ...(overscrollBehaviorY ? { overscrollBehaviorY } : {}),
    } as CSSProperties;

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
      onViewportScroll?.(event.currentTarget);
    };

    return (
      <div className={twMerge("relative min-h-0 overflow-hidden", className)}>
        <div
          ref={ref}
          style={viewportStyle}
          onScroll={handleScroll}
          className={twMerge(
            "h-full w-full web-scrollbar",
            allowHorizontal ? "overflow-auto" : "overflow-y-auto overflow-x-hidden",
            viewportClassName,
          )}
        >
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    );
  },
);
