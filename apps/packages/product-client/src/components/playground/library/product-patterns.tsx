import { useState } from "react";
import {
  BillingBalanceNotice,
  BillingGateState,
  billingGateView,
} from "#product/components/patterns/BillingGateState";
import { ModelTable } from "#product/components/patterns/ModelTable";
import { PrStatusDot } from "#product/components/patterns/PrStatusBadge";
import { ProductPageShell } from "#product/components/patterns/ProductPageShell";
import { SettingsEmptyState } from "#product/components/patterns/SettingsEmptyState";
import { SettingsEyebrow } from "#product/components/patterns/SettingsEyebrow";
import { SettingsPageHeader } from "#product/components/patterns/SettingsPageHeader";
import { SettingsRow } from "#product/components/patterns/SettingsRow";
import { SettingsSaveFooter } from "#product/components/patterns/SettingsSaveFooter";
import { SettingsScopeTabs } from "#product/components/patterns/SettingsScopeTabs";
import { SettingsSection } from "#product/components/patterns/SettingsSection";
import { SecretManagementPanel } from "#product/components/patterns/secrets/SecretManagementPanel";
import { Switch } from "#product/primitives/Switch";
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

function SettingsRowDemo() {
  const [checked, setChecked] = useState(true);
  return (
    <SettingsRow label="Setting label" description="Setting description">
      <Switch checked={checked} onChange={setChecked} />
    </SettingsRow>
  );
}

function SettingsSectionDemo() {
  return (
    <SettingsSection title="Section title" description="Section description">
      <SettingsRow label="Row label">
        <Switch checked onChange={noop} />
      </SettingsRow>
    </SettingsSection>
  );
}

function SettingsScopeTabsDemo() {
  const [value, setValue] = useState("user");
  return (
    <SettingsScopeTabs
      items={[{ id: "user", label: "User" }, { id: "org", label: "Org" }]}
      value={value}
      onChange={setValue}
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
  { name: "SettingsEmptyState", subpath: "#product/components/patterns/SettingsEmptyState", render: () => (
    <SettingsEmptyState title="No results" description="Nothing to show yet." size="compact" />
  ) },
  { name: "SettingsEyebrow", subpath: "#product/components/patterns/SettingsEyebrow", render: () => (
    <SettingsEyebrow>Section</SettingsEyebrow>
  ) },
  { name: "SettingsPageHeader", subpath: "#product/components/patterns/SettingsPageHeader", render: () => (
    <SettingsPageHeader title="Settings" description="Page description" />
  ) },
  { name: "SettingsRow", subpath: "#product/components/patterns/SettingsRow", render: SettingsRowDemo },
  { name: "SettingsSaveFooter", subpath: "#product/components/patterns/SettingsSaveFooter", render: () => (
    <SettingsSaveFooter onSave={noop} onRevert={noop} />
  ) },
  { name: "SettingsScopeTabs", subpath: "#product/components/patterns/SettingsScopeTabs", render: SettingsScopeTabsDemo },
  { name: "SettingsSection", subpath: "#product/components/patterns/SettingsSection", render: SettingsSectionDemo },
  { name: "secrets/SecretManagementPanel", subpath: "#product/components/patterns/secrets/SecretManagementPanel", render: SecretManagementPanelDemo },
];

export const PRODUCT_PATTERNS_TIER: LibraryTier = {
  id: "product-patterns",
  title: "Product patterns",
  entries: PRODUCT_PATTERNS_ENTRIES,
};
