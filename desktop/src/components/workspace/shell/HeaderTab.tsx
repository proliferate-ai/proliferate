import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { X } from "@/components/ui/icons";

interface HeaderTabProps {
  isActive: boolean;
  transparentChromeEnabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onClose: () => void;
  badge?: ReactNode;
}

export function HeaderTab({
  isActive,
  transparentChromeEnabled,
  icon,
  label,
  onClick,
  onClose,
  badge,
}: HeaderTabProps) {
  const shapeClassName = transparentChromeEnabled ? "-mb-px rounded-t-md" : "rounded-md";
  const activeClassName = transparentChromeEnabled
    ? "border-foreground/10 border-b-background bg-background/85 text-foreground shadow-subtle backdrop-blur-xl"
    : "border-border bg-background text-foreground shadow-subtle";

  return (
    <div
      role="presentation"
      className={`group/tab flex h-8 min-w-0 max-w-44 shrink-0 items-center border px-0.5 transition-colors ${shapeClassName} ${
        isActive
          ? activeClassName
          : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      <Button
        type="button"
        role="tab"
        aria-selected={isActive}
        variant="ghost"
        size="sm"
        onClick={onClick}
        title={label}
        className={`h-full min-w-0 flex-1 justify-start gap-1.5 bg-transparent px-2 py-0 text-xs font-normal hover:bg-transparent ${shapeClassName} ${
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        title={`Close ${label}`}
        aria-label={`Close ${label}`}
        className={`mr-1 size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground ${
          isActive
            ? "opacity-70 hover:opacity-100"
            : "opacity-0 transition-opacity group-hover/tab:opacity-70 hover:!opacity-100 focus-visible:opacity-100"
        }`}
      >
        <X className="size-2.5" />
      </Button>
    </div>
  );
}
