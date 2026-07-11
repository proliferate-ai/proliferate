import type { ReactNode } from "react";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  AppShellReviewIcon,
  ArrowUp,
  CircleAlert,
  Copy,
  GitBranch,
  GitCommit,
  GitPullRequest,
  StackedFiles,
} from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { useComposerWorkspaceActivityModel } from "@/hooks/workspaces/derived/use-composer-workspace-activity-model";
import type {
  ComposerWorkspaceActivityModel,
  WorkspaceActivityFact,
} from "@/lib/domain/workspaces/activity/composer-workspace-activity";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useWorkspaceCopyActions } from "@/hooks/workspaces/workflows/use-workspace-copy-actions";

export function ConnectedWorkspaceActivityComposerCard() {
  const { model, runtimeBlockedReason, hasExistingPullRequest } =
    useComposerWorkspaceActivityModel();
  const shellActions = useWorkspaceShellActions();
  const { copyBranchName } = useWorkspaceCopyActions();

  if (!model) {
    return null;
  }

  return (
    <WorkspaceActivityComposerCard
      model={model}
      gitActionsDisabledReason={runtimeBlockedReason}
      pullRequestActionLabel={hasExistingPullRequest ? "Open pull request" : "Create pull request"}
      hasExistingPullRequest={hasExistingPullRequest}
      onCopyBranch={model.git?.branchName
        ? () => void copyBranchName(model.git?.branchName)
        : undefined}
      onOpenChanges={shellActions
        ? () => shellActions.openRightPanelTool("git")
        : undefined}
      onCommit={shellActions
        ? () => shellActions.openPublishDialog("commit")
        : undefined}
      onPublish={shellActions
        ? () => shellActions.openPublishDialog("publish")
        : undefined}
      onPullRequest={shellActions?.openPullRequest}
    />
  );
}

export function WorkspaceActivityComposerCard({
  model,
  gitActionsDisabledReason,
  pullRequestActionLabel,
  hasExistingPullRequest = false,
  onOpenChanges,
  onCopyBranch,
  onCommit,
  onPublish,
  onPullRequest,
}: {
  model: ComposerWorkspaceActivityModel;
  gitActionsDisabledReason?: string | null;
  pullRequestActionLabel: string;
  hasExistingPullRequest?: boolean;
  onOpenChanges?: () => void;
  onCopyBranch?: () => void;
  onCommit?: () => void;
  onPublish?: () => void;
  onPullRequest?: () => void;
}) {
  const shownFacts = model.facts.slice(0, 3);
  const narrowOverflowCount = Math.max(0, model.facts.length - 2);

  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          // The dock gives attached content px-5. Cancel it here so this cap
          // shares the composer's outer edges instead of reading as an inset card.
          className="-mx-5 flex h-9 w-[calc(100%+2.5rem)] min-w-0 items-center justify-start rounded-t-[var(--radius-composer,1rem)] border-x-[0.5px] border-t-[0.5px] border-[var(--color-composer-border)] bg-[var(--color-composer-background)] px-3 text-left text-ui-sm text-muted-foreground hover:text-foreground"
          aria-label={`Workspace activity: ${shownFacts.map((fact) => fact.label).join(", ")}`}
          data-workspace-activity-trigger="true"
          data-telemetry-mask
        >
          <span className="flex min-w-0 flex-1 items-center overflow-hidden">
            {shownFacts.map((fact, index) => (
              <ActivityFact
                key={fact.key}
                fact={fact}
                index={index}
                narrowOverflowCount={narrowOverflowCount}
              />
            ))}
          </span>
        </Button>
      )}
      side="top"
      align="start"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <ComposerPopoverSurface
          variant="summary"
          className="w-[min(300px,calc(100vw-1rem))] overflow-hidden"
          data-telemetry-mask
        >
          <div className="max-h-[min(34rem,calc(100vh-8rem))] overflow-y-auto">
            {model.git ? (
              <WorkspaceActivitySection
                title="Source control"
                flush
              >
                {model.git.branchName ? (
                  <ActivityActionRow
                    icon={<GitBranch className="size-4" />}
                    label={model.git.branchName}
                    meta="Copy"
                    trailing={<Copy className="size-3.5" />}
                    onSelect={() => {
                      onCopyBranch?.();
                      close();
                    }}
                    disabled={!onCopyBranch}
                  />
                ) : null}
                <ActivityDetailRow
                  icon={<StackedFiles className="size-4" />}
                  label={model.git.changeLabel}
                  meta={model.git.stagingLabel}
                />
                {model.git.conflictedFiles > 0 ? (
                  <ActivityDetailRow
                    icon={<CircleAlert className="size-4 text-destructive" />}
                    label={`${model.git.conflictedFiles} ${model.git.conflictedFiles === 1 ? "conflict" : "conflicts"}`}
                  />
                ) : null}
                {model.git.syncLabel ? (
                  <ActivityDetailRow
                    icon={<ArrowUp className="size-4" />}
                    label={model.git.syncLabel}
                  />
                ) : null}
                {model.git.pullRequestLabel ? (
                  <ActivityDetailRow
                    icon={<GitPullRequest className="size-4" />}
                    label={model.git.pullRequestLabel}
                  />
                ) : null}
                <ActivityActionRow
                  icon={<AppShellReviewIcon className="size-4" />}
                  label="Review changes"
                  onSelect={() => {
                    onOpenChanges?.();
                    close();
                  }}
                  disabled={!onOpenChanges}
                />
                <ActivityActionRow
                  icon={<GitCommit className="size-4" />}
                  label="Commit…"
                  onSelect={() => {
                    onCommit?.();
                    close();
                  }}
                  disabled={!onCommit || !!gitActionsDisabledReason}
                  title={gitActionsDisabledReason ?? undefined}
                />
                <ActivityActionRow
                  icon={<ArrowUp className="size-4" />}
                  label={model.git.pushLabel}
                  onSelect={() => {
                    onPublish?.();
                    close();
                  }}
                  disabled={!onPublish || !!gitActionsDisabledReason}
                  title={gitActionsDisabledReason ?? undefined}
                />
                <ActivityActionRow
                  icon={<GitPullRequest className="size-4" />}
                  label={pullRequestActionLabel}
                  onSelect={() => {
                    onPullRequest?.();
                    close();
                  }}
                  disabled={!onPullRequest || (!hasExistingPullRequest && !!gitActionsDisabledReason)}
                  title={!hasExistingPullRequest ? gitActionsDisabledReason ?? undefined : undefined}
                />
              </WorkspaceActivitySection>
            ) : null}
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function ActivityFact({
  fact,
  index,
  narrowOverflowCount,
}: {
  fact: WorkspaceActivityFact;
  index: number;
  narrowOverflowCount: number;
}) {
  const toneClass = fact.tone === "destructive"
    ? "text-destructive"
    : fact.tone === "attention"
      ? "text-warning"
      : "text-current";
  if (index === 2 && narrowOverflowCount > 0) {
    return (
      <>
        <span className="mx-1.5 shrink-0 text-border-heavy @max-[430px]:hidden">·</span>
        <span className={`min-w-0 truncate @max-[430px]:hidden ${toneClass}`}>{fact.label}</span>
        <span className="mx-1.5 hidden shrink-0 text-border-heavy @max-[430px]:inline">·</span>
        <span className="hidden shrink-0 @max-[430px]:inline">+{narrowOverflowCount}</span>
      </>
    );
  }
  return (
    <>
      {index > 0 ? <span className="mx-1.5 shrink-0 text-border-heavy">·</span> : null}
      <span className={`min-w-0 truncate ${toneClass}`}>{fact.label}</span>
    </>
  );
}

function WorkspaceActivitySection({
  title,
  detail,
  flush = false,
  children,
}: {
  title: string;
  detail?: string | null;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`relative flex flex-col ${flush ? "pb-0.5" : "pb-3 after:absolute after:inset-x-3.5 after:bottom-0 after:h-px after:scale-y-50 after:bg-border after:content-['']"}`}>
      <header className="flex h-7 min-w-0 items-center gap-2 px-3.5 pb-0.5 text-ui-sm text-muted-foreground">
        <span className="shrink-0">{title}</span>
        {detail ? (
          <span className="min-w-0 flex-1 truncate text-right font-mono text-xs">
            {detail}
          </span>
        ) : null}
      </header>
      <div className="flex flex-col gap-0.5 px-3.5">{children}</div>
    </section>
  );
}

function ActivityDetailRow({
  icon,
  label,
  meta,
}: {
  icon: ReactNode;
  label: string;
  meta?: string | null;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2 py-1 text-ui-sm text-muted-foreground">
      <span className="flex w-[18px] shrink-0 items-center justify-start">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="shrink-0 text-xs text-faint">{meta}</span> : null}
    </div>
  );
}

function ActivityActionRow({
  icon,
  label,
  meta,
  trailing,
  onSelect,
  disabled,
  title,
}: {
  icon: ReactNode;
  label: string;
  meta?: string | null;
  trailing?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className="relative isolate flex min-h-7 w-full min-w-0 items-center justify-start gap-2 py-1 text-left text-ui-sm text-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-sm before:content-[''] hover:before:bg-list-hover"
    >
      <span className="flex w-[18px] shrink-0 items-center justify-start text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
      {trailing ? <span className="shrink-0 text-muted-foreground">{trailing}</span> : null}
    </Button>
  );
}
