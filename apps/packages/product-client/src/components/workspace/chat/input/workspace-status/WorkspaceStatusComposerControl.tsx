import { Button } from "@proliferate/ui/primitives/Button";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  AppShellReviewIcon,
  ArrowUpRight,
  GitCommit,
  GitPullRequest,
  List,
  PixelAgentSprite,
  RefreshCw,
  Robot,
  SquareTerminal,
} from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import {
  DetailStateGlyph,
  StatusRow,
  StatusSection,
  type WorkspaceStatusDetailItem,
  type WorkspaceStatusDetailState,
} from "#product/components/workspace/chat/input/workspace-status/StatusCardPrimitives";
import {
  AdvancedControlSections,
  ResourcesSection,
} from "#product/components/workspace/chat/input/EnvironmentStatusCard";
import type { RuntimePressureTargetState } from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

/**
 * Workspace status: the single ambient-state surface for a session.
 * One icon-only trigger in the composer's trailing cluster opens a
 * codex-anatomy card (reference/codex/status/card.html):
 *   - Source control first (review / commit-push / compare / checks)
 *   - Subagents (ours), codex-format: pixel sprite + name rows
 *   - Native agents & terminals as count rows with hover detail cards
 *   - Resources (worktrees summary → searchable modal, cloud CPU/RAM)
 *   - Advanced session config (absorbed from the removed "..." overflow)
 * Conversation-flow state (queued prompts, goal, blocking approvals)
 * deliberately stays in the composer dock and is NOT rendered here.
 * Section/row primitives live in StatusCardPrimitives.
 */

export type { WorkspaceStatusDetailItem, WorkspaceStatusDetailState };

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
    commitOrPushDisabled: boolean;
    compareLabel: string;
    compareMeta: string | null;
    /** True when the row is "View PR" — the action opens the PR itself. */
    compareOpensPr: boolean;
    /** No PR and no compare page to link — the row dims. */
    compareDisabled: boolean;
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

export interface WorkspaceStatusEnvironmentProps {
  /** Runtime resources (worktrees, cloud CPU/RAM) for the Resources section. */
  environmentState?: RuntimePressureTargetState | null;
  /** Opens the searchable worktrees modal (owner renders the dialog). */
  onOpenWorktrees?: () => void;
  /** Advanced session config absorbed from the removed overflow menu. */
  advancedControls?: LiveSessionControlDescriptor[];
  agentKind?: string | null;
}

export function WorkspaceStatusComposerControl({
  model,
  actions = {},
  environmentState = null,
  onOpenWorktrees,
  advancedControls = [],
  agentKind = null,
}: {
  model: WorkspaceStatusModel;
  actions?: WorkspaceStatusActions;
} & WorkspaceStatusEnvironmentProps) {
  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          icon={<List className="icon-control" />}
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
      {(close) => (
        <WorkspaceStatusCard
          model={model}
          actions={actions}
          close={close}
          environmentState={environmentState}
          onOpenWorktrees={onOpenWorktrees}
          advancedControls={advancedControls}
          agentKind={agentKind}
        />
      )}
    </PopoverButton>
  );
}

export function WorkspaceStatusCard({
  model,
  actions,
  close,
  environmentState = null,
  onOpenWorktrees,
  advancedControls = [],
  agentKind = null,
}: {
  model: WorkspaceStatusModel;
  actions: WorkspaceStatusActions;
  close: () => void;
} & WorkspaceStatusEnvironmentProps) {
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
              icon={<AppShellReviewIcon className="icon-paired" />}
              label={model.environment.reviewChangesLabel}
              onSelect={run(actions.onOpenChanges)}
            />
            <StatusRow
              icon={<GitCommit className="icon-paired" />}
              label={model.environment.commitOrPushLabel}
              meta={model.environment.commitOrPushMeta ?? undefined}
              disabled={model.environment.commitOrPushDisabled}
              onSelect={run(actions.onCommitOrPush)}
            />
            <StatusRow
              icon={<GitPullRequest className="icon-paired" />}
              label={model.environment.compareLabel}
              meta={model.environment.compareMeta ?? undefined}
              disabled={model.environment.compareDisabled}
              trailing={model.environment.compareDisabled
                ? undefined
                : (
                  <span className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/status-row:opacity-100 group-focus-visible/status-row:opacity-100">
                    <ArrowUpRight className="icon-paired" />
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
                  ? <SquareTerminal className="icon-paired" />
                  : row.kind === "loops"
                    ? <RefreshCw className="icon-paired" />
                    : <Robot className="icon-paired" />}
                label={row.label}
                meta={row.meta}
                hoverItems={row.items}
              />
            ))}
          </StatusSection>
        )}

        {environmentState && onOpenWorktrees && (
          <ResourcesSection
            targetState={environmentState}
            onOpenWorktrees={() => {
              close();
              onOpenWorktrees();
            }}
          />
        )}

        <AdvancedControlSections controls={advancedControls} agentKind={agentKind} />
      </div>
    </ComposerPopoverSurface>
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
          className={`icon-paired ${row.tintClassName ?? "text-muted-foreground"}`}
        />
      ))}
    </span>
  );
}
