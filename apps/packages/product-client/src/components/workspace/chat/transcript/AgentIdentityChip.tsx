import { Button } from "#product/primitives/Button";
import { Tooltip } from "#product/primitives/Tooltip";
import { AgentIdentityGlyph } from "#product/components/workspace/delegated-work/AgentIdentityGlyph";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";

export function AgentIdentityChip({
  identity,
  closed = false,
  exactMessage,
  onOpen,
  className = "",
}: {
  identity: DelegatedAgentIdentity;
  closed?: boolean;
  exactMessage?: string | null;
  onOpen?: () => void;
  className?: string;
}) {
  if (!identity.sessionId) {
    return null;
  }

  const tooltip = exactMessage?.length ? exactMessage : identity.displayName;
  const content = (
    <>
      <AgentIdentityGlyph
        identity={identity}
        dimension={16}
        closed={closed}
        label={`${identity.displayName} identity`}
      />
      <span className="min-w-0 truncate">{identity.title}</span>
    </>
  );
  const sharedClassName = [
    "inline-flex h-7 max-w-72 min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-surface-elevated px-2 text-chat font-normal text-foreground transition-colors hover:border-border hover:bg-muted focus-visible:border-border focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
    className,
  ].filter(Boolean).join(" ");

  return (
    <Tooltip content={tooltip} className="inline-flex min-w-0 max-w-full align-middle">
      {onOpen ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-agent-identity-chip
          data-chat-transcript-ignore
          className={sharedClassName}
          aria-label={`Open ${identity.displayName}`}
          onClick={onOpen}
        >
          {content}
        </Button>
      ) : (
        <span
          data-agent-identity-chip
          className={sharedClassName}
          tabIndex={0}
          aria-label={identity.displayName}
        >
          {content}
        </span>
      )}
    </Tooltip>
  );
}
