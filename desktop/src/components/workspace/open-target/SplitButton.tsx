import { type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import { OpenTargetMenu, TargetIcon } from "./OpenTargetMenu";
import { OpenTargetIcon } from "./OpenTargetIcon";
import type { OpenTarget } from "@/hooks/access/tauri/use-shell-actions";

interface SplitButtonProps {
  icon?: ReactNode;
  label: string;
  showLabel?: boolean;
  onClick?: () => void;
  targets?: OpenTarget[];
  onTargetClick?: (targetId: string) => void;
  preferredTarget?: OpenTarget | null;
}

export function SplitButton({
  icon,
  label,
  showLabel = true,
  onClick,
  targets,
  onTargetClick,
  preferredTarget,
}: SplitButtonProps) {
  const displayIcon = preferredTarget
    ? <OpenTargetIcon iconId={preferredTarget.iconId} className="size-3.5" variant="menu" />
    : icon;
  const content = (
    <>
      {displayIcon}
      {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </>
  );
  const primaryClassName = showLabel
    ? "inline-flex items-center whitespace-nowrap border border-border bg-background hover:bg-accent hover:text-accent-foreground h-6 px-2 text-xs rounded-lg gap-2 font-medium"
    : "inline-flex size-7 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground";

  if (!targets || targets.length === 0 || !onTargetClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className={primaryClassName}
      >
        {content}
      </button>
    );
  }

  return (
    <OpenTargetMenu
      targets={targets}
      onTargetClick={(target) => onTargetClick(target.id)}
      align="right"
      trigger={({ toggle, isOpen }) => (
        <div className="flex">
          <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            className={showLabel
              ? "inline-flex items-center whitespace-nowrap border border-border bg-background hover:bg-accent hover:text-accent-foreground h-6 px-2 text-xs rounded-lg flex-1 justify-start gap-2 rounded-r-none border-r-0 font-mono font-medium pr-2"
              : "inline-flex size-7 items-center justify-center whitespace-nowrap rounded-lg rounded-r-none border border-border border-r-0 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}
          >
            {content}
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            title={`Choose ${label}`}
            aria-label={`Choose ${label}`}
            className={showLabel
              ? "inline-flex items-center justify-center whitespace-nowrap border border-border hover:bg-accent hover:text-accent-foreground font-[450] h-6 text-xs gap-1.5 rounded-lg rounded-l-none px-2 bg-sidebar-background/4"
              : "inline-flex h-7 w-6 items-center justify-center whitespace-nowrap rounded-lg rounded-l-none border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      )}
    />
  );
}

export { TargetIcon };
