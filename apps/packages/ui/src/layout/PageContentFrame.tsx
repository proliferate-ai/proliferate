import { useEffect, useRef, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface PageContentFrameProps {
  children: ReactNode;
  header?: ReactNode;
  maxWidthClassName?: string;
  stickyAction?: ReactNode;
  stickyTitle?: string;
  className?: string;
}

export function PageContentFrame({
  children,
  header,
  maxWidthClassName = "max-w-6xl",
  stickyAction,
  stickyTitle,
  className = "",
}: PageContentFrameProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [stickyTitleVisible, setStickyTitleVisible] = useState(false);

  useEffect(() => {
    if (!stickyTitle || !viewportRef.current || !headerRef.current) {
      setStickyTitleVisible(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setStickyTitleVisible(!entry.isIntersecting),
      { root: viewportRef.current, threshold: 0 },
    );
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [stickyTitle]);

  return (
    <div
      ref={viewportRef}
      className={twMerge("h-full flex-1 overflow-auto bg-background web-scrollbar", className)}
    >
      {stickyTitle && (
        <div className="sticky top-0 z-30 h-0">
          <div
            className={twMerge(
              "border-b border-border bg-background/95 backdrop-blur transition-[opacity,transform] duration-150 supports-[backdrop-filter]:bg-background/80",
              stickyTitleVisible
                ? "translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-1 opacity-0",
            )}
          >
            <div
              className={twMerge(
                "mx-auto flex h-10 w-full min-w-0 items-center justify-between gap-3 px-4 sm:px-6",
                maxWidthClassName,
              )}
            >
              <h2 className="min-w-0 truncate text-sm font-medium text-foreground">
                {stickyTitle}
              </h2>
              {stickyAction && <div className="shrink-0">{stickyAction}</div>}
            </div>
          </div>
        </div>
      )}
      <div
        className={twMerge(
          "mx-auto flex min-h-full w-full min-w-0 flex-col gap-5 px-10 pb-12 pt-14",
          maxWidthClassName,
        )}
      >
        {header && <div ref={headerRef}>{header}</div>}
        {children}
      </div>
    </div>
  );
}
