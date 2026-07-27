import { useState } from "react";
import { ModelTable } from "@proliferate/product-ui/patterns/ModelTable";
import { PrStatusDot } from "@proliferate/product-ui/patterns/PrStatusBadge";
import { ProductPageShell } from "@proliferate/product-ui/patterns/ProductPageShell";
import { SettingsEmptyState } from "@proliferate/product-ui/patterns/SettingsEmptyState";
import { SettingsEyebrow } from "@proliferate/product-ui/patterns/SettingsEyebrow";
import { SettingsPageHeader } from "@proliferate/product-ui/patterns/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/patterns/SettingsRow";
import { SettingsSaveFooter } from "@proliferate/product-ui/patterns/SettingsSaveFooter";
import { SettingsScopeTabs } from "@proliferate/product-ui/patterns/SettingsScopeTabs";
import { SettingsSection } from "@proliferate/product-ui/patterns/SettingsSection";
import { SecretManagementPanel } from "@proliferate/product-ui/patterns/secrets/SecretManagementPanel";
import { Switch } from "@proliferate/ui/primitives/Switch";
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

export const PRODUCT_PATTERNS_ENTRIES: LibraryEntry[] = [
  { name: "ModelTable", subpath: "@proliferate/product-ui/patterns/ModelTable", render: ModelTableDemo },
  { name: "PrStatusBadge", subpath: "@proliferate/product-ui/patterns/PrStatusBadge", render: () => (
    <PrStatusDot status={{ kind: "open", number: 42 }} />
  ) },
  { name: "ProductPageShell", subpath: "@proliferate/product-ui/patterns/ProductPageShell", render: ProductPageShellDemo },
  { name: "SettingsEmptyState", subpath: "@proliferate/product-ui/patterns/SettingsEmptyState", render: () => (
    <SettingsEmptyState title="No results" description="Nothing to show yet." size="compact" />
  ) },
  { name: "SettingsEyebrow", subpath: "@proliferate/product-ui/patterns/SettingsEyebrow", render: () => (
    <SettingsEyebrow>Section</SettingsEyebrow>
  ) },
  { name: "SettingsPageHeader", subpath: "@proliferate/product-ui/patterns/SettingsPageHeader", render: () => (
    <SettingsPageHeader title="Settings" description="Page description" />
  ) },
  { name: "SettingsRow", subpath: "@proliferate/product-ui/patterns/SettingsRow", render: SettingsRowDemo },
  { name: "SettingsSaveFooter", subpath: "@proliferate/product-ui/patterns/SettingsSaveFooter", render: () => (
    <SettingsSaveFooter onSave={noop} onRevert={noop} />
  ) },
  { name: "SettingsScopeTabs", subpath: "@proliferate/product-ui/patterns/SettingsScopeTabs", render: SettingsScopeTabsDemo },
  { name: "SettingsSection", subpath: "@proliferate/product-ui/patterns/SettingsSection", render: SettingsSectionDemo },
  { name: "secrets/SecretManagementPanel", subpath: "@proliferate/product-ui/patterns/secrets/SecretManagementPanel", render: SecretManagementPanelDemo },
];

export const PRODUCT_PATTERNS_TIER: LibraryTier = {
  id: "product-patterns",
  title: "Product patterns",
  entries: PRODUCT_PATTERNS_ENTRIES,
};
