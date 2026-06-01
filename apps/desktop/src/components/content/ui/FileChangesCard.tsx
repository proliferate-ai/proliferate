import type { ReactNode } from "react";

interface FileChangesCardProps {
  fileCount: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function FileChangesCard({
  fileCount,
  actions,
  children,
  className,
}: FileChangesCardProps) {
  return (
    <div
      className={`mb-2 flex flex-col overflow-hidden rounded-xl bg-[var(--color-diff-panel-surface)] text-base text-foreground ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 pr-1 pl-3">
          <span className="min-w-0 truncate py-2 text-chat leading-[var(--text-chat--line-height)] text-foreground">
            {fileCount} file{fileCount !== 1 ? "s" : ""} changed
          </span>
          <div className="flex-1" />
          {actions && <div className="flex shrink-0 items-center">{actions}</div>}
        </div>
      </div>
      <div className="flex flex-col divide-y-[0.5px] divide-border">
        {children}
      </div>
    </div>
  );
}
