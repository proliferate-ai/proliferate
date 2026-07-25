import { useCallback, useEffect, useRef, useState } from "react";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { CloudUpload, GitBranch, GitCommit } from "@proliferate/ui/icons";
import {
  useCommitGitMutation,
  usePushGitMutation,
  useStageGitPathsMutation,
} from "@anyharness/sdk-react";
import { generateCommitMessage } from "@proliferate/cloud-sdk/client/ai-magic";
import { useToastStore } from "@/stores/toast/toast-store";

interface CommitModalProps {
  open: boolean;
  workspaceId: string | null;
  branchName: string | null;
  additions: number;
  deletions: number;
  /** Truncated diff excerpt for AI commit message generation. */
  diffExcerpt: string | null;
  /** All changed paths (unstaged+staged) for stage-all. */
  changedPaths: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

const MAX_DIFF_EXCERPT_LENGTH = 20_000;

export function CommitModal({
  open,
  workspaceId,
  branchName,
  additions,
  deletions,
  diffExcerpt,
  changedPaths,
  onClose,
  onSuccess,
}: CommitModalProps) {
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [selectedAction, setSelectedAction] = useState<"commit" | "commit-push" | "push">("commit");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const showToast = useToastStore((state) => state.show);

  const commitMutation = useCommitGitMutation({ workspaceId });
  const pushMutation = usePushGitMutation({ workspaceId });
  const stageMutation = useStageGitPathsMutation({ workspaceId });

  useEffect(() => {
    if (open) {
      setMessage("");
      setIncludeUnstaged(true);
      setSelectedAction("commit");
      setIsSubmitting(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      if (selectedAction === "push") {
        await pushMutation.mutateAsync({});
        showToast("Pushed.", "info");
        onClose();
        onSuccess?.();
        return;
      }

      // Generate or validate commit message FIRST (before staging) so that a
      // generation failure does not leave the index mutated.
      let finalMessage = message.trim();
      if (!finalMessage) {
        try {
          const diffStat = `+${additions} -${deletions}`;
          const excerpt = (diffExcerpt ?? "").slice(0, MAX_DIFF_EXCERPT_LENGTH);
          const result = await generateCommitMessage({
            diffStat,
            diffExcerpt: excerpt,
            branchName: branchName ?? undefined,
          });
          finalMessage = result.message;
        } catch {
          // AI unavailable — require manual message
          showToast("Commit message is required (AI generation unavailable).");
          setIsSubmitting(false);
          isSubmittingRef.current = false;
          textareaRef.current?.focus();
          return;
        }
      }

      // Stage all if requested (after message is ready)
      if (includeUnstaged && changedPaths.length > 0) {
        await stageMutation.mutateAsync(changedPaths);
      }

      await commitMutation.mutateAsync({ summary: finalMessage });

      if (selectedAction === "commit-push") {
        await pushMutation.mutateAsync({});
      }

      showToast(
        selectedAction === "commit-push" ? "Committed and pushed." : "Committed.",
        "info",
      );
      onClose();
      onSuccess?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }, [
    selectedAction,
    includeUnstaged,
    changedPaths,
    message,
    additions,
    deletions,
    diffExcerpt,
    branchName,
    commitMutation,
    pushMutation,
    stageMutation,
    showToast,
    onClose,
    onSuccess,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  const hasDiff = additions > 0 || deletions > 0;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Commit or push"
      sizeClassName="max-w-[420px]"
      showCloseButton={false}
      headerClassName="shrink-0"
      bodyClassName="p-0"
      headerContent={
        <div className="flex h-9 items-center justify-between gap-3 px-3">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate text-sm" data-telemetry-mask="true">
              {branchName ?? "no branch"}
            </span>
          </span>
          {hasDiff && (
            <span className="flex shrink-0 items-center gap-1 tabular-nums text-xs tracking-tight">
              <span className="text-git-green">+{additions}</span>
              <span className="text-git-red">-{deletions}</span>
            </span>
          )}
        </div>
      }
    >
      <div onKeyDown={handleKeyDown}>
        <textarea
          ref={textareaRef}
          rows={3}
          className="h-20 w-full resize-none bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          aria-label="Commit message"
          placeholder="Commit message (leave blank to generate)..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isSubmitting}
        />

        <div className="flex items-center gap-2 px-3 pt-2 pb-3">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={includeUnstaged}
              onChange={(e) => setIncludeUnstaged(e.target.checked)}
              className="size-3.5 rounded border border-border accent-foreground"
              disabled={isSubmitting}
            />
            Include unstaged changes
          </label>
        </div>

        <div className="border-t border-border py-1">
          <ActionRow
            icon={<GitCommit className="size-3.5 shrink-0" />}
            label="Commit"
            shortcut="Cmd+Enter"
            selected={selectedAction === "commit"}
            onSelect={() => setSelectedAction("commit")}
            onActivate={handleSubmit}
            disabled={isSubmitting}
          />
          <ActionRow
            icon={<CloudUpload className="size-3.5 shrink-0" />}
            label="Commit and push"
            selected={selectedAction === "commit-push"}
            onSelect={() => setSelectedAction("commit-push")}
            onActivate={handleSubmit}
            disabled={isSubmitting}
          />
          <ActionRow
            icon={<CloudUpload className="size-3.5 shrink-0" />}
            label="Push"
            selected={selectedAction === "push"}
            onSelect={() => setSelectedAction("push")}
            onActivate={handleSubmit}
            disabled={isSubmitting}
          />
        </div>
      </div>
    </ModalShell>
  );
}

function ActionRow({
  icon,
  label,
  shortcut,
  selected,
  onSelect,
  onActivate,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-selected={selected}
      className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${
        selected ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/30"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      onClick={() => {
        onSelect();
        onActivate();
      }}
      onMouseEnter={onSelect}
    >
      {icon}
      <span className="truncate">{label}</span>
      {shortcut && selected && (
        <kbd className="ml-auto inline-flex rounded-md border-0 bg-foreground/10 px-1.5 py-0 text-xs leading-4 text-foreground/70">
          {shortcut.replace("Cmd", "⌘").replace("Enter", "⏎")}
        </kbd>
      )}
    </div>
  );
}
