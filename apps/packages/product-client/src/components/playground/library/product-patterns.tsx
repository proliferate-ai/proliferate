import { AgentIdentityChip } from "#product/components/patterns/AgentIdentityChip";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import {
  BillingBalanceNotice,
  BillingGateState,
} from "#product/components/patterns/BillingGateState";
import { billingGateView } from "#product/lib/domain/billing/billing-gate-presentation";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { PrStatusDot } from "#product/components/patterns/PrStatusBadge";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import type { LibraryEntry, LibraryTier } from "./types";

const DEMO_AGENT_IDENTITY = buildDelegatedAgentIdentity({
  id: "library-agent-link",
  title: "Explore dotfiles",
  workspaceId: "library-workspace",
  sessionId: "library-agent-session",
  sessionLinkId: "library-agent-link",
});

// Hover target for the clamped message preview: far past the preview ceiling,
// the way a real subagent brief is.
const DEMO_LONG_MESSAGE =
  "Investigate the retry behavior end to end, trace the actual mechanism until you can explain why it occurs, and report back with a mental model plus concrete fix options. "
    .repeat(20);

function AgentIdentityChipDemo() {
  return (
    <div className="flex flex-col items-start gap-2">
      <AgentIdentityChip identity={DEMO_AGENT_IDENTITY} onOpen={noop} />
      <AgentIdentityChip identity={DEMO_AGENT_IDENTITY} closed />
      <AgentIdentityChip
        identity={DEMO_AGENT_IDENTITY}
        exactMessage={DEMO_LONG_MESSAGE}
        onOpen={noop}
      />
    </div>
  );
}

function AgentIdentityGlyphDemo() {
  return (
    <div className="flex items-center gap-2">
      <AgentIdentityGlyph identity={DEMO_AGENT_IDENTITY} dimension={16} />
      <AgentIdentityGlyph identity={DEMO_AGENT_IDENTITY} dimension={18} />
      <AgentIdentityGlyph identity={DEMO_AGENT_IDENTITY} dimension={20} closed />
    </div>
  );
}

function BillingGateStateDemo() {
  return (
    <div className="flex w-full flex-col gap-3">
      <BillingGateState
        size="compact"
        view={billingGateView("credits_exhausted", {
          isPaidPlan: false,
          canManageBilling: true,
          onUpgrade: noop,
          onOpenBilling: noop,
        })}
      />
      <BillingBalanceNotice
        view={{
          kind: "refill",
          title: "Credits running low",
          description: "2 hours of compute remaining this period.",
          primaryAction: { label: "Add credits", onClick: noop },
        }}
      />
    </div>
  );
}

export const PRODUCT_PATTERNS_ENTRIES: LibraryEntry[] = [
  { name: "AgentIdentityChip", subpath: "#product/components/patterns/AgentIdentityChip", render: AgentIdentityChipDemo },
  { name: "AgentIdentityGlyph", subpath: "#product/components/patterns/AgentIdentityGlyph", render: AgentIdentityGlyphDemo },
  { name: "BillingGateState", subpath: "#product/components/patterns/BillingGateState", render: BillingGateStateDemo },
  { name: "PrStatusBadge", subpath: "#product/components/patterns/PrStatusBadge", render: () => (
    <PrStatusDot status={{ kind: "open", number: 42 }} />
  ) },
];

export const PRODUCT_PATTERNS_TIER: LibraryTier = {
  id: "product-patterns",
  title: "Product patterns",
  entries: PRODUCT_PATTERNS_ENTRIES,
};
