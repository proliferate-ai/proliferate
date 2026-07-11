import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { FileReferenceBadge } from "@/components/workspace/file-references/FileReferenceBadge";

const CHAT_BUTTON_TEXT_CLASS = "text-chat leading-[var(--text-chat--line-height)]";

export function PlainActionRow({
  label,
  icon,
  tone = "normal",
}: {
  label: string;
  icon: ReactNode;
  tone?: "normal" | "failed";
}) {
  return (
    <div
      title={label}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-chat leading-[var(--text-chat--line-height)] ${
        tone === "failed" ? "text-destructive/80" : "text-foreground/60"
      }`}
    >
      <ActionRowIcon>{icon}</ActionRowIcon>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

export function ActionRowIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[1.143em] shrink-0 items-center justify-center text-current [&_svg]:size-[1.143em] [&_svg]:text-current"
    >
      {children}
    </span>
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
      className={`group/action-row h-auto max-w-full justify-start gap-1.5 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal hover:bg-transparent focus-visible:ring-0 ${
        failed ? "text-destructive/80 hover:text-destructive" : "text-foreground/60 hover:text-foreground"
      }`}
      onClick={onToggle}
    >
      <ActionRowIcon>{icon}</ActionRowIcon>
      <span className="min-w-0 truncate">{label}</span>
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
      className={`min-w-0 truncate ${CHAT_BUTTON_TEXT_CLASS} !font-normal !text-inherit underline decoration-current decoration-dotted decoration-[0.5px] underline-offset-2 hover:!text-inherit hover:decoration-dotted [&>span:first-child]:hidden`}
    />
  );
}
