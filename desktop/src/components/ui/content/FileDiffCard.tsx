import { type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";

interface FileDiffCardProps {
  filePath: string;
  additions: number;
  deletions: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}

export function FileDiffCard({
  filePath,
  additions,
  deletions,
  isExpanded,
  onToggleExpand,
  actions,
  children,
}: FileDiffCardProps) {
  const canExpand = additions > 0 || deletions > 0;

  return (
    <div className="group/file-diff flex flex-col overflow-clip rounded-lg bg-foreground/5">
      <div
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={canExpand ? onToggleExpand : undefined}
        onKeyDown={canExpand ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        } : undefined}
        className={`select-none bg-sidebar-background ${canExpand ? "cursor-pointer" : ""}`}
      >
        <div className="bg-foreground/5">
          <div className="flex items-center gap-2 pt-1 pr-1 pb-1 pl-3 text-xs">
            <div className="flex min-w-0 items-center gap-2 pb-0.5 text-sidebar-foreground">
              <span
                className="min-w-0 truncate text-start [direction:rtl]"
                title={filePath}
              >
                <span className="[direction:ltr] [unicode-bidi:plaintext]">
                  {filePath}
                </span>
              </span>
              <span className="ml-auto shrink-0">
                <span className="inline-flex items-center gap-1 tabular-nums tracking-tight">
                  {additions > 0 && (
                    <span className="shrink-0 text-git-green">+{additions}</span>
                  )}
                  {deletions > 0 && (
                    <span className="shrink-0 text-git-red">-{deletions}</span>
                  )}
                </span>
              </span>
            </div>

            <div className="ms-auto mr-1 flex items-center gap-1">
              {actions && (
                <div className="flex items-center opacity-0 transition-opacity duration-200 group-hover/file-diff:opacity-100">
                  {actions}
                </div>
              )}
              {canExpand && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand();
                  }}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity duration-200 hover:bg-sidebar-accent"
                  aria-label="Toggle file diff"
                >
                  <ChevronDown
                    className={`size-3 transition-transform duration-200 ${
                      isExpanded ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {canExpand && isExpanded && children && (
        <div className="relative overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
