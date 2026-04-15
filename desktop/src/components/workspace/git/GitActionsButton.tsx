import { useState, useRef, useEffect, type ReactNode } from "react";
import { GitCommit, CloudUpload, GitHub, ChevronDown } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import type { GitStatusSnapshot } from "@anyharness/sdk";

interface GitActionsButtonProps {
  gitStatus: GitStatusSnapshot | null;
  existingPr: { url?: string } | null;
  disabled?: boolean;
  onCommit: () => void;
  onPush: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
}

interface DropdownItem {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

export function GitActionsButton({
  gitStatus,
  existingPr,
  disabled = false,
  onCommit,
  onPush,
  onCreatePr,
  onViewPr,
}: GitActionsButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!gitStatus) return null;

  const { actions, clean } = gitStatus;

  // Primary action for button face
  let primaryLabel = "Commit";
  let primaryIcon = <GitCommit className="size-3.5" />;
  let primaryOnClick = onCommit;
  let primaryDisabled = disabled;

  if (!disabled && !clean && actions.canCommit) {
    primaryLabel = "Commit";
    primaryIcon = <GitCommit className="size-3.5" />;
    primaryOnClick = onCommit;
  } else if (!disabled && clean && actions.canPush) {
    primaryLabel = actions.pushLabel;
    primaryIcon = <CloudUpload className="size-3.5" />;
    primaryOnClick = onPush;
  } else if (!disabled && existingPr) {
    primaryLabel = "View PR";
    primaryIcon = <GitHub className="size-3.5" />;
    primaryOnClick = onViewPr;
  } else if (!disabled && clean && actions.canCreatePullRequest) {
    primaryLabel = "Create PR";
    primaryIcon = <GitHub className="size-3.5" />;
    primaryOnClick = onCreatePr;
  } else {
    primaryDisabled = true;
  }

  const items: DropdownItem[] = [
    {
      icon: <GitCommit className="size-3.5" />,
      label: "Commit",
      disabled: disabled || clean || !actions.canCommit,
      onClick: onCommit,
    },
    {
      icon: <CloudUpload className="size-3.5" />,
      label: actions.pushLabel,
      disabled: disabled || !actions.canPush,
      onClick: onPush,
    },
    {
      icon: <GitHub className="size-3.5" />,
      label: "Create PR",
      disabled: disabled || !actions.canCreatePullRequest || !!existingPr,
      onClick: onCreatePr,
    },
    ...(existingPr
      ? [{
          icon: <GitHub className="size-3.5" />,
          label: "View PR",
          disabled,
          onClick: onViewPr,
        }]
      : []),
  ];

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            if (!primaryDisabled) primaryOnClick();
          }}
          disabled={primaryDisabled}
          className="h-6 gap-1.5 rounded-lg rounded-r-none border-r-0 bg-background px-2 text-xs font-medium"
        >
          {primaryIcon}
          <span>{primaryLabel}</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          className="h-6 rounded-lg rounded-l-none bg-background px-1.5 text-xs"
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-border bg-popover shadow-lg py-1 px-1 backdrop-blur-sm">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Git actions</div>
          {items.map((item) => (
            <Button
              key={item.label}
              type="button"
              variant="ghost"
              size="sm"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-xs font-normal text-foreground hover:bg-muted/60 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="min-w-0 truncate">{item.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
