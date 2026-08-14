import { AgentIdentityChip } from "#product/components/patterns/AgentIdentityChip";
import { Button } from "#product/primitives/Button";
import { Tooltip } from "#product/primitives/Tooltip";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";

export type AgentMessageReceiptDirection = "outgoing" | "incoming";

export function AgentMessageReceipt({
  direction,
  identity,
  fallbackLabel = "Agent",
  verb,
  exactMessage,
  closed = false,
  onOpen,
  onToggleDetails,
  detailsExpanded = false,
}: {
  direction: AgentMessageReceiptDirection;
  identity: DelegatedAgentIdentity | null;
  fallbackLabel?: string;
  verb: string;
  exactMessage?: string | null;
  closed?: boolean;
  onOpen?: () => void;
  onToggleDetails?: () => void;
  detailsExpanded?: boolean;
}) {
  const chip = identity?.sessionId ? (
    <AgentIdentityChip
      identity={identity}
      exactMessage={exactMessage}
      closed={closed}
      onOpen={onOpen}
      className={direction === "outgoing" ? "me-1.5" : "ms-1.5"}
    />
  ) : exactMessage ? (
    <Tooltip content={exactMessage} className="inline-flex min-w-0 max-w-full align-middle">
      <span
        data-agent-message-fallback
        className={`inline-block min-w-0 max-w-72 shrink truncate font-medium text-foreground/80 ${
          direction === "outgoing" ? "me-1.5" : "ms-1.5"
        }`}
        tabIndex={0}
        aria-label={`${fallbackLabel} message`}
      >
        {fallbackLabel}
      </span>
    </Tooltip>
  ) : (
    <span
      data-agent-message-fallback
      className={`inline-block min-w-0 max-w-72 shrink truncate font-medium text-foreground/80 ${
        direction === "outgoing" ? "me-1.5" : "ms-1.5"
      }`}
    >
      {fallbackLabel}
    </span>
  );
  const verbNode = onToggleDetails ? (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-chat-transcript-ignore
      className="relative top-px align-middle text-chat text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:underline"
      aria-label={detailsExpanded ? "Hide agent operation details" : "Show agent operation details"}
      aria-expanded={detailsExpanded}
      onClick={onToggleDetails}
    >
      {verb}
    </Button>
  ) : (
    <span className="relative top-px align-middle text-muted-foreground">{verb}</span>
  );

  return (
    <div
      data-agent-message-receipt
      data-direction={direction}
      className={`flex max-w-[85%] items-center text-chat leading-8 ${
        direction === "incoming" ? "self-end text-right" : "self-start text-left"
      }`}
    >
      {direction === "outgoing" ? chip : null}
      {verbNode}
      {direction === "incoming" ? chip : null}
    </div>
  );
}
