import {
  BillingBalanceNotice,
  BillingGateState,
  billingGateView,
} from "#product/components/patterns/BillingGateState";
import { ModelTable } from "#product/components/patterns/ModelTable";
import { PrStatusDot } from "#product/components/patterns/PrStatusBadge";
import { ProductPageShell } from "#product/components/patterns/ProductPageShell";
import { SettingsPageHeader } from "#product/components/patterns/SettingsPageHeader";
import { SecretManagementPanel } from "#product/components/patterns/secrets/SecretManagementPanel";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import type { LibraryEntry, LibraryTier } from "./types";

function ModelTableDemo() {
  return (
    <ModelTable
      models={[{
        id: "claude-sonnet",
        displayName: "Claude Sonnet",
        provider: "anthropic",
        enabled: true,
      }]}
      onToggle={noop}
    />
  );
}

function ProductPageShellDemo() {
  return (
    <div className="h-32 overflow-hidden rounded-md border border-border">
      <ProductPageShell title="Page title" description="Page description">
        <p className="text-ui-sm text-muted-foreground">Shell body.</p>
      </ProductPageShell>
    </div>
  );
}

function SecretManagementPanelDemo() {
  return (
    <div className="max-h-64 overflow-y-auto">
      <SecretManagementPanel
        title="Secrets"
        description="Environment variables and files for this scope."
        filePathMode="relative"
        envVars={[{ id: "API_KEY", name: "API_KEY", byteSize: 32, updatedAt: "2026-07-01T00:00:00.000Z" }]}
        files={[]}
        onSaveEnvVar={noop}
        onDeleteEnvVar={noop}
        onSaveFile={noop}
        onDeleteFile={noop}
      />
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
  { name: "BillingGateState", subpath: "#product/components/patterns/BillingGateState", render: BillingGateStateDemo },
  { name: "ModelTable", subpath: "#product/components/patterns/ModelTable", render: ModelTableDemo },
  { name: "PrStatusBadge", subpath: "#product/components/patterns/PrStatusBadge", render: () => (
    <PrStatusDot status={{ kind: "open", number: 42 }} />
  ) },
  { name: "ProductPageShell", subpath: "#product/components/patterns/ProductPageShell", render: ProductPageShellDemo },
  { name: "SettingsPageHeader", subpath: "#product/components/patterns/SettingsPageHeader", render: () => (
    <SettingsPageHeader title="Settings" description="Page description" />
  ) },
  { name: "secrets/SecretManagementPanel", subpath: "#product/components/patterns/secrets/SecretManagementPanel", render: SecretManagementPanelDemo },
];

export const PRODUCT_PATTERNS_TIER: LibraryTier = {
  id: "product-patterns",
  title: "Product patterns",
  entries: PRODUCT_PATTERNS_ENTRIES,
};
