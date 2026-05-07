import { type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import { OpenTargetMenu, TargetIcon } from "./OpenTargetMenu";
import { OpenTargetIcon } from "./OpenTargetIcon";
import type { OpenTarget } from "@/lib/access/tauri/shell";

interface SplitButtonProps {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  targets?: OpenTarget[];
  onTargetClick?: (targetId: string) => void;
  preferredTarget?: OpenTarget | null;
}

export function SplitButton({
  icon,
  label,
  onClick,
  targets,
  onTargetClick,
  preferredTarget,
}: SplitButtonProps) {
  const displayIcon = preferredTarget
    ? <OpenTargetIcon iconId={preferredTarget.iconId} className="size-3.5" variant="menu" />
    : icon;

  if (!targets || targets.length === 0 || !onTargetClick) {
    return (
      <button
        onClick={onClick}
        className="inline-flex items-center whitespace-nowrap border border-border bg-background hover:bg-accent hover:text-accent-foreground h-6 px-2 text-xs rounded-lg gap-2 font-medium"
      >
        {displayIcon}
        <span>{label}</span>
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
            onClick={onClick}
            className="inline-flex items-center whitespace-nowrap border border-border bg-background hover:bg-accent hover:text-accent-foreground h-6 px-2 text-xs rounded-lg flex-1 justify-start gap-2 rounded-r-none border-r-0 font-mono font-medium pr-2"
          >
            {displayIcon}
            <span>{label}</span>
          </button>
          <button
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            className="inline-flex items-center justify-center whitespace-nowrap border border-border hover:bg-accent hover:text-accent-foreground font-[450] h-6 text-xs gap-1.5 rounded-lg rounded-l-none px-2 bg-sidebar-background/4"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      )}
    />
  );
}

export { TargetIcon };
