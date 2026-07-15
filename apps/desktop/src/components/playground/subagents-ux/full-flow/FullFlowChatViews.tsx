import { Archive } from "@proliferate/ui/icons";
import { SubagentCreationReceipt } from "../identity-receipts/SubagentCreationReceipt";
import { SubagentIdentityGlyph } from "../identity-receipts/SubagentIdentityGlyph";
import { ActivityAggregatePopover } from "../popover-pane/ActivityAggregatePopover";
import type { PrototypeAgent } from "../popover-pane/PopoverPaneFixtures";
import { PrototypeComposerSurface } from "../popover-pane/PopoverPanePrototype";
import {
  FULL_FLOW_STATUS_LABELS,
  type FullFlowArchivedSession,
  type FullFlowChild,
  type FullFlowMessage,
  type FullFlowParent,
} from "./FullFlowFixtures";

export function childToPaneAgent(child: FullFlowChild): PrototypeAgent {
  return {
    id: child.id,
    label: child.label,
    harness: child.harness,
    status: child.status,
    wakeScheduled: child.wakeScheduled,
    detail: child.detail,
  };
}

function TranscriptMessage({ message }: { message: FullFlowMessage }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-ui-sm text-muted-foreground">
        {message.speaker === "user" ? "You" : message.speaker === "agent" ? "Agent" : "System"}
      </p>
      <p className={`text-ui leading-5 ${message.speaker === "tool" ? "text-muted-foreground" : "text-foreground"}`}>
        {message.text}
      </p>
    </div>
  );
}

export function ParentChatView({
  parent,
  onOpenChild,
  onOpenAgentsPane,
}: {
  parent: FullFlowParent | undefined;
  onOpenChild: (childId: string) => void;
  onOpenAgentsPane: () => void;
}) {
  if (!parent) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-4">
          {parent.transcript.map((item, index) => (
            item.kind === "message" ? (
              <TranscriptMessage key={index} message={item.message} />
            ) : (
              // Quiet immutable historical event: the receipt records the
              // creation as it happened. Live status stays in the pane/tab.
              <div key={index} className="mb-3 last:mb-0">
                <SubagentCreationReceipt
                  model={item.receipt}
                  density="compact"
                  onOpenSession={(subagentId) => onOpenChild(subagentId)}
                />
              </div>
            )
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col px-5 pb-6">
        <div className="px-5">
          <ActivityAggregatePopover
            git={parent.git}
            agents={parent.children.map(childToPaneAgent)}
            onOpenSubagentsPane={onOpenAgentsPane}
          />
        </div>
        <PrototypeComposerSurface />
      </div>
    </div>
  );
}

export function ChildChatView({
  found,
}: {
  found: { parent: FullFlowParent; child: FullFlowChild } | undefined;
}) {
  if (!found) return null;
  const { parent, child } = found;
  // `detail` is already composed from the runtime status ("Working · 4m");
  // wakeScheduled is metadata appended after it, never a roster state.
  const statusLine = [
    child.detail || FULL_FLOW_STATUS_LABELS[child.status],
    child.wakeScheduled ? "Wake scheduled" : null,
  ].filter((part): part is string => part !== null).join(" · ");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <SubagentIdentityGlyph
          seed={child.id}
          size={18}
          label={`Identity mark for ${child.label}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium">{child.label}</p>
          <p className="truncate text-ui-sm text-muted-foreground">
            {statusLine} · Delegated by {parent.title}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{child.harness}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-4">
          {child.transcript.map((message, index) => (
            <TranscriptMessage key={index} message={message} />
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col px-5 pb-6">
        <PrototypeComposerSurface />
      </div>
    </div>
  );
}

export function ArchivedChatView({ session }: { session: FullFlowArchivedSession | undefined }) {
  if (!session) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <SubagentIdentityGlyph
          seed={session.id}
          size={18}
          dimmed
          label={`Identity mark for ${session.label}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium">{session.label}</p>
          <p className="truncate text-ui-sm text-muted-foreground">
            {session.closedDetail} · Was delegated by {session.parentTitle}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-4">
          {session.transcript.map((message, index) => (
            <TranscriptMessage key={index} message={message} />
          ))}
        </div>
      </div>
      {/* Terminal session: no composer, no writable affordance — just a quiet
          read-only footer stating the session is closed. */}
      <footer className="mx-auto w-full max-w-2xl px-5 pb-6">
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-foreground/5 px-3 py-2 text-ui-sm text-muted-foreground">
          <Archive className="size-3.5 shrink-0" aria-hidden="true" />
          <span>This session is closed. The transcript is read-only; no new prompts can be sent.</span>
        </div>
      </footer>
    </div>
  );
}
