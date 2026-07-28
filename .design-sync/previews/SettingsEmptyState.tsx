import { type ReactNode } from "react";
import { Button, KeyRound, Robot, SettingsEmptyState } from "@proliferate/ui";

/**
 * The state is flat by contract (no card of its own), so the pane it fills is
 * drawn here as preview glue — that is what makes `full` vs `compact` legible.
 */
function Pane({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-3xl rounded-lg border border-border">{children}</div>
  );
}

export const NoSecrets = () => (
  <Pane>
    <SettingsEmptyState
      icon={<KeyRound />}
      title="No personal secrets yet"
      description="Secrets you add here are mounted into your personal cloud sandbox and are never shared with your organization."
      action={
        <Button type="button" variant="secondary" size="sm">
          Add secret
        </Button>
      }
    />
  </Pane>
);

export const HarnessInstallGate = () => (
  <Pane>
    <SettingsEmptyState
      icon={<Robot />}
      title="Install Claude Code to continue"
      description="Claude Code is not installed on this machine. Install it to configure local credentials and model routing."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm">
            Install Claude Code
          </Button>
          <Button type="button" variant="outline" size="sm">
            Installation docs
          </Button>
        </div>
      }
    />
  </Pane>
);

export const AdminGate = () => (
  <Pane>
    <SettingsEmptyState
      size="compact"
      title="Admin access required"
      description="Organization owners and admins can configure this page. You are a member of Proliferate."
      action={
        <Button type="button" variant="outline" size="sm">
          Open organization
        </Button>
      }
    />
  </Pane>
);

export const TitleOnly = () => (
  <Pane>
    <SettingsEmptyState size="compact" title="Sign in to view your organization" />
  </Pane>
);
