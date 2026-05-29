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
        tone === "failed" ? "text-destructive/80" : "text-muted-foreground/80"
      }`}
    >
      {label}
    </div>
  );
}

export function ActionDisclosureRow({
  label,
  expanded,
  failed,
  onToggle,
}: {
  label: string;
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
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal hover:bg-transparent focus-visible:ring-0 ${
        failed ? "text-destructive/80 hover:text-destructive" : "text-muted-foreground/80 hover:text-foreground"
      }`}
      onClick={onToggle}
    >
      <span className="min-w-0 truncate">{label}</span>
      <ChevronRight
        className={`size-3 shrink-0 text-faint opacity-0 transition-all duration-200 group-hover/action-row:opacity-100 group-focus-visible/action-row:opacity-100 ${
          expanded ? "rotate-90 opacity-100" : ""
        }`}
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
