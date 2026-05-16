import { type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import { OpenTargetIcon } from "@/components/ui/OpenTargetIcon";
import { OpenTargetMenu, TargetIcon } from "./OpenTargetMenu";
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
    ? "workspace-shell-action-button inline-flex items-center whitespace-nowrap font-medium"
    : "workspace-shell-icon-button inline-flex items-center justify-center whitespace-nowrap";

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
              ? "workspace-shell-action-button workspace-shell-split-button-left inline-flex items-center whitespace-nowrap flex-1 justify-start font-mono font-medium"
              : "workspace-shell-icon-button workspace-shell-split-button-left inline-flex items-center justify-center whitespace-nowrap"}
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
              ? "workspace-shell-action-button workspace-shell-split-button-right inline-flex items-center justify-center whitespace-nowrap gap-1.5 font-[450]"
              : "workspace-shell-icon-button workspace-shell-split-button-right inline-flex items-center justify-center whitespace-nowrap"}
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      )}
    />
  );
}

export { TargetIcon };
