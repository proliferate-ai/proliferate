import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  GitBranch,
  GitCommit,
  GitPullRequest,
  StackedFiles,
} from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { AgentGlyphStack } from "./AgentGlyph";
import {
  buildActivityFacts,
  buildSubagentAggregate,
  subagentCountsLine,
  type ActivityFact,
} from "./PopoverPaneActivityFacts";
import type { PrototypeAgent, PrototypeGit } from "./PopoverPaneFixtures";

export type PrototypeSourceControlAction =
  | "review"
  | "commit"
  | "publish"
  | "pull-request";

/**
 * Compact attached activity cap + click-open aggregate popover.
 * The popover is aggregate-only: source-control facts plus a subagent avatar
 * stack with counts. The full roster lives in the right pane, opened from here.
 */
export function ActivityAggregatePopover({
  git,
  agents,
  onOpenSubagentsPane,
  onSourceControlAction,
}: {
  git: PrototypeGit;
  agents: readonly PrototypeAgent[];
  onOpenSubagentsPane: () => void;
  onSourceControlAction?: (action: PrototypeSourceControlAction) => void;
}) {
  const aggregate = buildSubagentAggregate(agents);
  const facts = buildActivityFacts(git, aggregate).slice(0, 3);
  const countsLine = subagentCountsLine(aggregate);
  const stagingLabel = git.stagedFiles > 0 ? `${git.stagedFiles} staged` : null;
  const syncLabel = [
    git.ahead > 0 ? `${git.ahead} ahead` : null,
    git.behind > 0 ? `${git.behind} behind` : null,
  ].filter((part): part is string => part !== null).join(" · ") || null;

  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          // Same cap treatment as the production activity card: cancel the
          // dock's px-5 inset so the cap shares the composer's outer edges.
          className="-mx-5 flex h-9 w-[calc(100%+2.5rem)] min-w-0 items-center justify-start rounded-t-[var(--radius-composer,1rem)] border-x-[0.5px] border-t-[0.5px] border-[var(--color-composer-border)] bg-[var(--color-composer-background)] px-3 text-left text-ui-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          aria-label={`Workspace activity: ${facts.map((fact) => fact.label).join(", ")}`}
        >
          <span className="flex min-w-0 flex-1 items-center overflow-hidden">
            {facts.map((fact, index) => (
              <TriggerFact key={fact.key} fact={fact} withSeparator={index > 0} />
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
        >
          <PopoverSection title="Source control" flush={aggregate.total === 0}>
            <PopoverFactRow icon={<GitBranch className="size-4" />} label={git.branch} />
            <PopoverFactRow
              icon={<StackedFiles className="size-4" />}
              label={git.changedFiles === 0
                ? "No changes"
                : `${git.changedFiles} ${git.changedFiles === 1 ? "change" : "changes"}`}
              meta={stagingLabel}
            />
            {git.conflictedFiles > 0 ? (
              <PopoverFactRow
                icon={<CircleAlert className="size-4 text-destructive" />}
                label={`${git.conflictedFiles} ${git.conflictedFiles === 1 ? "conflict" : "conflicts"}`}
              />
            ) : null}
            {syncLabel ? (
              <PopoverFactRow icon={<ArrowUp className="size-4" />} label={syncLabel} />
            ) : null}
            {git.pullRequestLabel ? (
              <PopoverFactRow
                icon={<GitPullRequest className="size-4" />}
                label={git.pullRequestLabel}
              />
            ) : null}
            <div className="mt-1 flex flex-col gap-0.5 border-t border-border/60 pt-1">
              {git.changedFiles > 0 ? (
                <PopoverActionRow
                  icon={<StackedFiles className="size-4" />}
                  label="Review changes"
                  onClick={() => {
                    onSourceControlAction?.("review");
                    close();
                  }}
                />
              ) : null}
              {git.changedFiles > 0 ? (
                <PopoverActionRow
                  icon={<GitCommit className="size-4" />}
                  label="Commit…"
                  onClick={() => {
                    onSourceControlAction?.("commit");
                    close();
                  }}
                />
              ) : null}
              <PopoverActionRow
                icon={<ArrowUp className="size-4" />}
                label={git.ahead > 0 ? "Push changes" : "Publish branch"}
                onClick={() => {
                  onSourceControlAction?.("publish");
                  close();
                }}
              />
              <PopoverActionRow
                icon={<GitPullRequest className="size-4" />}
                label={git.pullRequestLabel ? "Open pull request" : "Create pull request"}
                onClick={() => {
                  onSourceControlAction?.("pull-request");
                  close();
                }}
              />
            </div>
          </PopoverSection>
          {aggregate.total > 0 ? (
            <PopoverSection title="Subagents" flush>
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                onClick={() => {
                  onOpenSubagentsPane();
                  close();
                }}
                className="relative isolate flex min-h-8 w-full min-w-0 items-center justify-start gap-2 py-1 text-left text-ui-sm text-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-sm before:content-[''] hover:before:bg-list-hover focus-visible:outline-none focus-visible:before:bg-list-hover"
                aria-label={`Open subagents pane: ${aggregate.total} ${aggregate.total === 1 ? "subagent" : "subagents"}`}
              >
                <AgentGlyphStack ids={agents.map((agent) => agent.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {aggregate.total} {aggregate.total === 1 ? "subagent" : "subagents"}
                  </span>
                  {countsLine ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {countsLine}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverSection>
          ) : null}
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function PopoverActionRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      onClick={onClick}
      className="relative isolate flex min-h-8 w-full min-w-0 items-center justify-start gap-2 py-1 text-left text-ui-sm text-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-sm before:content-[''] hover:before:bg-list-hover focus-visible:outline-none focus-visible:before:bg-list-hover"
    >
      <span className="flex w-[18px] shrink-0 items-center justify-start text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Button>
  );
}

function TriggerFact({ fact, withSeparator }: { fact: ActivityFact; withSeparator: boolean }) {
  const toneClass = fact.tone === "destructive"
    ? "text-destructive"
    : fact.tone === "attention"
      ? "text-warning-foreground"
      : "text-current";
  return (
    <>
      {withSeparator ? <span className="mx-1.5 shrink-0 text-border-heavy">·</span> : null}
      <span className={`min-w-0 truncate ${toneClass}`}>{fact.label}</span>
    </>
  );
}

function PopoverSection({
  title,
  flush = false,
  children,
}: {
  title: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`relative flex flex-col ${flush ? "pb-0.5" : "pb-3 after:absolute after:inset-x-3.5 after:bottom-0 after:h-px after:scale-y-50 after:bg-border after:content-['']"}`}>
      <header className="flex h-7 min-w-0 items-center px-3.5 pb-0.5 text-ui-sm text-muted-foreground">
        <span className="shrink-0">{title}</span>
      </header>
      <div className="flex flex-col gap-0.5 px-3.5">{children}</div>
    </section>
  );
}

function PopoverFactRow({
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
