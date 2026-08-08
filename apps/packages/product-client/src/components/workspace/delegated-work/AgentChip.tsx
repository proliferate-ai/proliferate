import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";

/**
 * The agent chip — the one way an agent appears inside somebody else's
 * transcript (agent-ops ADR §4, "Spawn receipts" + "Agent messages").
 *
 * Anatomy is locked by the Spawn Receipts canvas page: a 28px (`h-7`) pill on
 * `surface-elevated` with a `border-light` edge, a 16px seal glyph, the
 * task-derived name truncating at 288px (`max-w-72`), and a hover that raises
 * border + background. The name carries the agent's colour token so the glyph
 * and the words read as one identity.
 *
 * The chip IS the agent: wherever a session can be opened it renders as a
 * button that opens it. A closed agent keeps its chip forever in the dimmed
 * variant — transparent fill, muted text, dimmed glyph — and stays clickable,
 * because its transcript stays readable.
 */

/**
 * 28px pill · 16px glyph · truncate at 288px. Shared by every chip surface.
 *
 * The label sits at `text-ui` (13px) rather than inheriting the 14px transcript
 * size, because the glyph's `icon-paired` tier is relative to it and only lands
 * on the locked 16px against 13px text. The Workspace Ops canvas chip sizes its
 * label the same way.
 */
export const AGENT_CHIP_SHAPE_CLASS =
  "inline-flex h-7 max-w-72 min-w-0 items-center gap-1.5 rounded-full border py-0 pe-2.5 ps-2 align-middle text-ui";
export const AGENT_CHIP_LIVE_TONE_CLASS =
  "border-border-light bg-surface-elevated hover:border-border hover:bg-hover";
/** Closed: transparent fill + muted text, so "closed" reads at a glance. */
export const AGENT_CHIP_DIMMED_TONE_CLASS =
  "border-border-light bg-transparent text-muted-foreground hover:border-border hover:bg-hover";
export const AGENT_CHIP_GLYPH_CLASS = "icon-paired shrink-0";

export interface AgentChipProps {
  identity: DelegatedAgentIdentity;
  /** Closed agents: dimmed glyph + muted text, still clickable. */
  dimmed?: boolean;
  /**
   * Render the mono short id as a faint suffix. Set when the target was
   * addressed cross-session by id, so the addressing stays visible.
   */
  showShortId?: boolean;
  /** Opens the agent's session. Omitted → the chip renders as static text. */
  onOpen?: () => void;
  title?: string;
  className?: string;
}

export function AgentChip({
  identity,
  dimmed = false,
  showShortId = false,
  onOpen,
  title,
  className = "",
}: AgentChipProps) {
  const toneClass = dimmed ? AGENT_CHIP_DIMMED_TONE_CLASS : AGENT_CHIP_LIVE_TONE_CLASS;
  const nameClass = dimmed
    ? "min-w-0 truncate text-muted-foreground"
    : `min-w-0 truncate ${identity.textColorClassName}`;
  const hoverTitle = title ?? identity.displayName;
  const body: ReactNode = (
    <>
      <DelegatedAgentIdenticon
        identity={identity}
        className={`${AGENT_CHIP_GLYPH_CLASS} ${
          dimmed ? "text-muted-foreground/50" : identity.textColorClassName
        }`}
      />
      <span className={nameClass}>{identity.title}</span>
      {showShortId && (
        <span className="shrink-0 font-mono text-ui-sm text-faint">{identity.shortId}</span>
      )}
    </>
  );

  if (!onOpen) {
    return (
      <span
        className={`${AGENT_CHIP_SHAPE_CLASS} ${toneClass} ${className}`.trim()}
        title={hoverTitle}
        data-agent-chip
      >
        {body}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-chat-transcript-ignore
      data-agent-chip
      className={`${AGENT_CHIP_SHAPE_CLASS} ${toneClass} ${className}`.trim()}
      title={hoverTitle}
      aria-label={`Open ${identity.title}`}
      onClick={onOpen}
    >
      {body}
    </Button>
  );
}

/**
 * The quiet trailing verb that follows a chip (or run of chips): "started
 * working", "messaged", "replied", "finished", "closed — superseded by …".
 * Never a bubble, never its own card — one muted phrase on the transcript line.
 */
export function AgentChipVerb({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`relative top-px align-middle text-muted-foreground ${className}`.trim()}>
      {children}
    </span>
  );
}
