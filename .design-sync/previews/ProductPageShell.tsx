import { useState, type ReactNode } from "react";
import {
  Button,
  EmptyState,
  Plus,
  ProductPageShell,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@proliferate/ui";

/**
 * The shell is a scroll viewport (`h-full flex-1 overflow-auto`), so it needs a
 * bounded parent to render at all — the sized frame here stands in for the app
 * pane it normally fills.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: 560 }}
    >
      {children}
    </div>
  );
}

export const SettingsPage = () => {
  const [autoStart, setAutoStart] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  return (
    <Frame>
      <ProductPageShell
        title="Workspace defaults"
        description="Applied to every new workspace created from this repository."
        actions={
          <Button type="button" variant="secondary" size="sm">
            <Plus className="icon-paired" />
            New workspace
          </Button>
        }
      >
        <SettingsSection
          title="Startup"
          description="What happens the moment a workspace is created."
        >
          <SettingsRow
            label="Start the agent automatically"
            description="Runs the harness as soon as the worktree is ready."
          >
            <Switch checked={autoStart} onChange={setAutoStart} />
          </SettingsRow>
          <SettingsRow
            label="Share anonymous run metrics"
            description="Session durations and tool-call counts, never file contents."
          >
            <Switch checked={telemetry} onChange={setTelemetry} />
          </SettingsRow>
        </SettingsSection>
      </ProductPageShell>
    </Frame>
  );
};

export const NarrowColumn = () => (
  <Frame>
    <ProductPageShell
      title="Billing"
      description="Plan, seats, and invoices for Proliferate."
      maxWidthClassName="max-w-xl"
    >
      <SettingsSection title="Plan">
        <SettingsRow label="Team" description="12 of 20 seats in use.">
          <Button type="button" variant="outline" size="sm">
            Manage
          </Button>
        </SettingsRow>
        <SettingsRow label="Renews" description="14 August 2026" />
      </SettingsSection>
    </ProductPageShell>
  </Frame>
);

export const TitleOnlyWithEmptyBody = () => (
  <Frame>
    <ProductPageShell title="Workflows" maxWidthClassName="max-w-5xl">
      <EmptyState
        title="No workflows yet"
        description="Workflows run a saved prompt against a repository on a schedule or a webhook."
        action={
          <Button type="button" size="sm">
            Create workflow
          </Button>
        }
      />
    </ProductPageShell>
  </Frame>
);
