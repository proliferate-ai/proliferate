import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  AppShellReviewIcon,
  ArrowUpRight,
  Check,
  CircleAlert,
  Circle,
  GitCommit,
  GitPullRequest,
  List,
  PixelAgentSprite,
  RefreshCw,
  Robot,
  Spinner,
  SquareTerminal,
} from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import {
  Tooltip as KitTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@proliferate/ui/kit/Tooltip";

/**
 * Workspace status: the single ambient-state surface for a session.
 * One icon-only trigger in the composer's trailing cluster opens a
 * codex-anatomy card (reference/codex/status/card.html):
 *   - Source control first (review / commit-push / compare / checks)
 *   - Subagents (ours), codex-format: pixel sprite + name rows
 *   - Native agents & terminals as count rows with hover detail cards
 * Conversation-flow state (queued prompts, goal, blocking approvals)
 * deliberately stays in the composer dock and is NOT rendered here.
 */

export type WorkspaceStatusDetailState =
  | "failing"
  | "pending"
  | "passing"
  | "working"
  | "done";

export interface WorkspaceStatusDetailItem {
  key: string;
  name: string;
  state?: WorkspaceStatusDetailState;
  detail?: string;
  meta?: string;
}

export interface WorkspaceStatusSubagentRow {
  key: string;
  name: string;
  /** Session to focus when the group row is clicked (tab activation). */
  sessionId?: string | null;
  /** oklab agent tint (text-delegated-agent-N). */
  tintClassName?: string;
}

export interface WorkspaceStatusNativeRow {
  key: string;
  kind: "agents" | "terminals" | "loops";
  label: string;
  meta?: string;
  items: WorkspaceStatusDetailItem[];
}

export interface WorkspaceStatusModel {
  environment: {
    reviewChangesLabel: string;
    commitOrPushLabel: string;
    commitOrPushMeta: string | null;
    compareLabel: string;
    compareMeta: string | null;
    checks: {
      label: string;
      state: "failing" | "pending" | "passing";
      actionLabel: string | null;
      items: WorkspaceStatusDetailItem[];
    } | null;
  } | null;
  /** Codex format: one row per state group — sprite cluster + "N working". */
  subagents: {
    working: WorkspaceStatusSubagentRow[];
    done: WorkspaceStatusSubagentRow[];
  };
  native: WorkspaceStatusNativeRow[];
}

export interface WorkspaceStatusActions {
  onOpenChanges?: () => void;
  onCommitOrPush?: () => void;
  onCompareBranch?: () => void;
  /** Checks row action ("View") — opens the PR itself. */
  onViewChecks?: () => void;
  /** Focus one of our agents' chat tabs (subagent or review session). */
  onOpenAgentSession?: (sessionId: string) => void;
}

export function WorkspaceStatusComposerControl({
  model,
  actions = {},
}: {
  model: WorkspaceStatusModel;
  actions?: WorkspaceStatusActions;
}) {
  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          icon={<List className="size-4" />}
          label="Workspace status"
          aria-label="Workspace status"
          title="Workspace status"
        />
      )}
      side="top"
      align="end"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => <WorkspaceStatusCard model={model} actions={actions} close={close} />}
    </PopoverButton>
  );
}

export function WorkspaceStatusCard({
  model,
  actions,
  close,
}: {
  model: WorkspaceStatusModel;
  actions: WorkspaceStatusActions;
  close: () => void;
}) {
  const run = (action?: () => void) => () => {
    action?.();
    close();
  };

  return (
    // Codex card surface: 300px, 20px radius (their rounded-3xl base is
    // 1.25rem), solid dropdown background, elevation-prominent = 0.5px
    // stroke painted in the shadow stack + two soft shadows — no ring.
    <ComposerPopoverSurface
      variant="summary"
      // overflow-hidden keeps the sticky section headers (which paint the
      // card background) clipped to the rounded corners.
      className="w-[min(300px,calc(100vw-1rem))] overflow-hidden rounded-[1.25rem] p-0 pt-2.5 ring-0 shadow-[0_0_0_0.5px_var(--color-popover-ring),0_3px_7.5px_rgba(0,0,0,0.25),0_0_20px_rgba(0,0,0,0.28)]"
      data-telemetry-mask
    >
      <div className="flex max-h-[min(34rem,calc(100vh-8rem))] flex-col gap-3 overflow-y-auto pb-3">
        {model.environment && (
          <StatusSection title="Source control">
            <StatusRow
              icon={<AppShellReviewIcon className="size-4" />}
              label={model.environment.reviewChangesLabel}
              onSelect={run(actions.onOpenChanges)}
            />
            <StatusRow
              icon={<GitCommit className="size-4" />}
              label={model.environment.commitOrPushLabel}
              meta={model.environment.commitOrPushMeta ?? undefined}
              onSelect={run(actions.onCommitOrPush)}
            />
            <StatusRow
              icon={<GitPullRequest className="size-4" />}
              label={model.environment.compareLabel}
              meta={model.environment.compareMeta ?? undefined}
              trailing={(
                <span className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/status-row:opacity-100 group-focus-visible/status-row:opacity-100">
                  <ArrowUpRight className="size-3.5" />
                </span>
              )}
              onSelect={run(actions.onCompareBranch)}
            />
            {model.environment.checks && (
              <StatusRow
                icon={(
                  <DetailStateGlyph
                    state={model.environment.checks.state}
                    emphasizeFailing
                  />
                )}
                label={model.environment.checks.label}
                hoverItems={model.environment.checks.items}
                trailing={model.environment.checks.actionLabel && actions.onViewChecks
                  ? (
                    <Button
                      type="button"
                      variant="unstyled"
                      size="unstyled"
                      onClick={run(actions.onViewChecks)}
                      className="shrink-0 rounded-sm px-1 text-ui text-muted-foreground hover:text-foreground"
                    >
                      {model.environment.checks.actionLabel}
                    </Button>
                  )
                  : undefined}
              />
            )}
          </StatusSection>
        )}

        {(model.subagents.working.length > 0 || model.subagents.done.length > 0) && (
          <StatusSection title="Subagents">
            <SubagentGroupRow
              rows={model.subagents.working}
              state="working"
              actions={actions}
              close={close}
            />
            <SubagentGroupRow
              rows={model.subagents.done}
              state="done"
              actions={actions}
              close={close}
            />
          </StatusSection>
        )}

        {model.native.length > 0 && (
          <StatusSection title="Native agents & terminals">
            {model.native.map((row) => (
              <StatusRow
                key={row.key}
                icon={row.kind === "terminals"
                  ? <SquareTerminal className="size-4" />
                  : row.kind === "loops"
                    ? <RefreshCw className="size-4" />
                    : <Robot className="size-4" />}
                label={row.label}
                meta={row.meta}
                hoverItems={row.items}
              />
            ))}
          </StatusSection>
        )}
      </div>
    </ComposerPopoverSurface>
  );
}

/* Codex section anatomy (card.html): hairline via ::after inset-x-4,
   sticky h-7 header in card background, rows in a gap-0.5 px-4 column. */
function StatusSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="relative z-0 flex flex-col pb-3 after:absolute after:inset-x-4 after:bottom-0 after:h-[0.5px] after:bg-border after:content-[''] last:pb-0 last:after:hidden">
      <header className="sticky top-0 z-10 flex h-7 w-full min-w-0 items-center justify-start gap-2 bg-popover ps-4 pe-2.5 pb-0.5 text-ui text-muted-foreground">
        <span className="truncate">{title}</span>
        {detail ? <span className="ms-auto shrink-0 text-ui-sm text-faint">{detail}</span> : null}
      </header>
      <div className="mt-0.5 flex flex-col gap-0.5 px-4">{children}</div>
    </section>
  );
}

/* Codex row recipe (group/summary-panel-row): h-7, icon in a fixed slot,
   truncating label, trailing meta, full-row hover paint via ::before that
   outsets 8px past the row box. */
const STATUS_ROW_CLASS =
  "group/status-row relative isolate flex h-7 w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-ui text-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-md before:content-['']";

function StatusRow({
  icon,
  leading,
  label,
  meta,
  trailing,
  hoverItems,
  onSelect,
  title,
}: {
  icon?: ReactNode;
  /** Replaces the fixed-width icon slot — for codex avatar-group clusters. */
  leading?: ReactNode;
  label: string;
  meta?: string;
  trailing?: ReactNode;
  hoverItems?: WorkspaceStatusDetailItem[];
  onSelect?: () => void;
  title?: string;
}) {
  const body = (
    <>
      {leading ?? (
        <span className="flex w-[18px] shrink-0 items-center justify-start text-muted-foreground">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="shrink-0 text-ui-sm text-muted-foreground">{meta}</span> : null}
      {trailing}
    </>
  );

  const interactive = !!onSelect || !!trailing;
  const row = interactive
    ? (
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        title={title}
        onClick={onSelect}
        className={`${STATUS_ROW_CLASS} cursor-pointer hover:before:bg-list-hover`}
      >
        {body}
      </Button>
    )
    : <div className={`${STATUS_ROW_CLASS} hover:before:bg-list-hover`}>{body}</div>;

  if (!hoverItems || hoverItems.length === 0) {
    return row;
  }

  /* Leaf detail on hover, codex tooltip recipe (tooltip1.html): rounded-xl,
     translucent popover bg, 0.5px ring, backdrop blur; radix-portaled so the
     card's scroll container can't clip it; opens leftward over the
     transcript — the free side next to a right-anchored card. */
  return (
    <TooltipProvider delayDuration={150}>
      <KitTooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent
          side="left"
          sideOffset={14}
          collisionPadding={12}
          className="pointer-events-none flex w-80 flex-col rounded-xl bg-popover/90 p-0 py-1 font-normal shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm"
        >
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-3">
            {hoverItems.map((item) => (
              <div key={item.key} className="flex min-w-0 items-start gap-2 py-1.5">
                <span className="flex h-4 w-[18px] shrink-0 items-center justify-start">
                  <DetailStateGlyph state={item.state} emphasizeFailing />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-ui text-foreground">{item.name}</span>
                  {item.detail ? (
                    <span className="line-clamp-2 text-ui-sm leading-4 text-muted-foreground">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
                {item.meta ? (
                  <span className="shrink-0 text-ui-sm text-faint">{item.meta}</span>
                ) : null}
              </div>
            ))}
          </div>
        </TooltipContent>
      </KitTooltip>
    </TooltipProvider>
  );
}

/* One state group of our agents, codex-format: sprite cluster + "N working".
   Clicking focuses the group's first agent session (tab activation) — the
   hover card lists every member. */
function SubagentGroupRow({
  rows,
  state,
  actions,
  close,
}: {
  rows: WorkspaceStatusSubagentRow[];
  state: "working" | "done";
  actions: WorkspaceStatusActions;
  close: () => void;
}) {
  if (rows.length === 0) {
    return null;
  }
  const firstSessionId = rows.find((row) => row.sessionId)?.sessionId ?? null;
  const onSelect = actions.onOpenAgentSession && firstSessionId
    ? () => {
      actions.onOpenAgentSession?.(firstSessionId);
      close();
    }
    : undefined;
  return (
    <StatusRow
      leading={<SubagentSpriteCluster rows={rows} />}
      label={`${rows.length} ${state}`}
      hoverItems={rows.map((row) => ({
        key: row.key,
        name: row.name,
        state,
      }))}
      onSelect={onSelect}
    />
  );
}

/* Codex avatar-group (thread-summary-panel-item-avatar-group): the group's
   sprites sit side by side ahead of the "N working" label, capped at four. */
function SubagentSpriteCluster({ rows }: { rows: WorkspaceStatusSubagentRow[] }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {rows.slice(0, 4).map((row) => (
        <PixelAgentSprite
          key={row.key}
          seed={row.name}
          className={`size-4 ${row.tintClassName ?? "text-muted-foreground"}`}
        />
      ))}
    </span>
  );
}

function DetailStateGlyph({
  state,
  emphasizeFailing = false,
}: {
  state?: WorkspaceStatusDetailState;
  emphasizeFailing?: boolean;
}) {
  if (state === "failing") {
    return (
      <CircleAlert
        className={`size-4 ${emphasizeFailing ? "text-destructive" : "text-muted-foreground"}`}
      />
    );
  }
  if (state === "working") {
    return <Spinner className="size-3.5 text-muted-foreground" />;
  }
  if (state === "pending") {
    return <Circle className="size-3.5 text-muted-foreground" />;
  }
  if (state === "passing" || state === "done") {
    return <Check className="size-3.5 text-muted-foreground" />;
  }
  return null;
}
