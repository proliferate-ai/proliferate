import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";
import { FileReferenceBadge } from "@/components/workspace/file-references/FileReferenceBadge";

const CHAT_BUTTON_TEXT_CLASS = "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function PlainActionRow({
  label,
  tone = "normal",
}: {
  label: string;
  tone?: "normal" | "failed";
}) {
  return (
    <div
      title={label}
      className={`truncate text-chat leading-[var(--text-chat--line-height)] ${
        tone === "failed" ? "text-destructive/80" : "text-foreground/60"
      }`}
    >
      {label}
    </div>
  );
}

export function ActionDisclosureRow({
  label,
  icon,
  expanded,
  failed,
  onToggle,
}: {
  label: string;
  icon: ReactNode;
  expanded: boolean;
  failed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      aria-expanded={expanded}
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal hover:bg-transparent focus-visible:ring-0 ${
        failed ? "text-destructive/80 hover:text-destructive" : "text-foreground/60 hover:text-foreground"
      }`}
      onClick={onToggle}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`flex size-4 shrink-0 items-center justify-center transition-colors [&_svg]:size-4 ${
            expanded
              ? "text-foreground/70"
              : failed
                ? "text-destructive/70"
                : "text-foreground/60 group-hover/action-row:text-foreground group-focus-visible/action-row:text-foreground"
          }`}
        >
          {icon}
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className={`size-3.5 shrink-0 text-foreground/40 opacity-0 transition-[opacity,transform] group-hover/action-row:opacity-100 group-focus-visible/action-row:opacity-100 ${expanded ? "rotate-90" : ""}`}
      />
    </Button>
  );
}

export function ActionFileLink({
  pathLabel,
  workspacePath,
  displayName,
}: {
  pathLabel: string;
  workspacePath: string | null;
  displayName: string;
}) {
  return (
    <FileReferenceBadge
      rawPath={pathLabel}
      label={displayName}
      workspacePath={workspacePath}
      variant="inline"
      className={`min-w-0 truncate ${CHAT_BUTTON_TEXT_CLASS} font-normal`}
    />
  );
}
