import { Button } from "#product/primitives/Button";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import type { PendingAgentUpdates } from "#product/lib/domain/chat/composer/pending-agent-updates";

/**
 * The queued agent updates row (Pending Updates canvas page).
 *
 * One quiet row for everything agents have queued: overlapping seal glyphs, a
 * count, and "delivered next turn". No edit, no delete, no preview — you see
 * THAT updates are pending, never what they say (ADR §4). Reading happens where
 * the conversation lives, so a glyph click opens that agent's session.
 *
 * The human's own queued messages are a different thing entirely and keep their
 * full row with its steer/edit/remove actions.
 */
export function PendingAgentUpdatesRow({
  updates,
  onOpenAgent,
}: {
  updates: PendingAgentUpdates;
  onOpenAgent?: (sessionId: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-0.5 pl-4"
      data-pending-agent-updates
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-ui text-muted-foreground">
        <span className="shrink-0">From agents</span>
        <span className="flex items-center -space-x-1.5">
          {updates.groups.map((group) => {
            const sessionId = group.sessionId;
            const glyph = (
              <DelegatedAgentIdenticon
                identity={group.identity}
                className={`icon-indicator ${group.identity.textColorClassName}`}
              />
            );
            const wellClassName =
              "icon-large flex items-center justify-center rounded-full bg-surface-elevated ring-1 ring-border transition-transform";
            if (!sessionId || !onOpenAgent) {
              return (
                <span
                  key={group.key}
                  className={wellClassName}
                  title={group.hoverLabel}
                  data-pending-agent-update-glyph
                >
                  {glyph}
                </span>
              );
            }
            return (
              <Button
                key={group.key}
                type="button"
                variant="unstyled"
                size="unstyled"
                className={`${wellClassName} hover:z-raised hover:scale-110`}
                title={group.hoverLabel}
                // The visible hover is the ADR's verbatim "N queued · click to
                // open"; the accessible name still has to say WHICH agent,
                // because a screen reader cannot see the seal.
                aria-label={`${group.identity.title} · ${group.hoverLabel}`}
                data-pending-agent-update-glyph
                onClick={() => onOpenAgent(sessionId)}
              >
                {glyph}
              </Button>
            );
          })}
        </span>
        <span className="shrink-0 text-ui-sm text-faint">{updates.countLabel}</span>
      </span>
      <span className="shrink-0 text-ui-sm text-faint">delivered next turn</span>
    </div>
  );
}
