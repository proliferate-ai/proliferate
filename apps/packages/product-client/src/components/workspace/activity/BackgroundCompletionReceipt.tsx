import { AgentMessageReceipt } from "#product/components/workspace/chat/transcript/AgentMessageReceipt";
import { Button } from "#product/primitives/Button";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import {
  subagentReceiptVerb,
  terminalReceiptVerb,
  type BackgroundCompletionReceipt as BackgroundCompletionReceiptModel,
} from "#product/domain/activity/background-completion-receipt";

/**
 * One inline background-work completion receipt in the transcript tail (bgwork
 * r6). Right-aligned on the incoming rail, per the design artifact ("Chat -
 * Background Work Indicator").
 *
 * - Terminal: `exited {code} ·` + a mono command button that deep-opens the
 *   Background work pane's `BackgroundTerminalView` for that process.
 * - Subagent: `finished ·` (or `failed ·`) + the durable `AgentIdentityChip`
 *   (reused via `AgentMessageReceipt`), keyed by the subagent's wire agent id.
 *
 * Both share `AgentMessageReceipt`'s markup (`data-agent-message-receipt`,
 * incoming direction) so the receipts read identically to the transcript's
 * existing agent receipts; the terminal variant swaps the chip for a command
 * button since a background terminal has no agent identity.
 */
export function BackgroundCompletionReceipt({
  receipt,
  workspaceId,
  onOpen,
}: {
  receipt: BackgroundCompletionReceiptModel;
  workspaceId: string | null;
  onOpen: () => void;
}) {
  if (receipt.kind === "subagent") {
    const identity = buildDelegatedAgentIdentity({
      id: receipt.subagentId,
      title: receipt.title,
      workspaceId,
      sessionId: receipt.subagentId,
    });
    return (
      <div
        className="flex justify-end"
        data-agent-origin-prompt
        data-background-completion-receipt="subagent"
      >
        <AgentMessageReceipt
          direction="incoming"
          identity={identity}
          fallbackLabel={receipt.title}
          verb={subagentReceiptVerb(receipt.outcome)}
          onOpen={onOpen}
        />
      </div>
    );
  }

  return (
    <div
      className="flex justify-end"
      data-agent-origin-prompt
      data-background-completion-receipt="terminal"
    >
      <div
        data-agent-message-receipt
        data-direction="incoming"
        className="flex max-w-[85%] items-center self-end text-right text-chat leading-8"
      >
        <span className="relative top-px align-middle text-muted-foreground">
          {terminalReceiptVerb(receipt.exitCode)}
        </span>
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          className="ms-1.5 inline-block min-w-0 max-w-72 shrink cursor-pointer truncate font-mono font-medium text-foreground/80 hover:underline"
          aria-label={`Open terminal ${receipt.command}`}
          onClick={onOpen}
        >
          {receipt.command}
        </Button>
      </div>
    </div>
  );
}
