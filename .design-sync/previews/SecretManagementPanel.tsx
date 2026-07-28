import type { ReactNode } from "react";
import { SecretManagementPanel } from "@proliferate/ui";

/**
 * The panel is a `SettingsSection` stack — it sits in a settings pane column,
 * so every cell bounds it the way `PersonalSecretsPane` does. Only key NAMES
 * and byte sizes are ever rendered; the panel never has a secret value.
 */
function Pane({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-3xl">{children}</div>;
}

const ENV_VARS = [
  { id: "env-1", name: "ANTHROPIC_API_KEY", byteSize: 108, updatedAt: "2026-07-14T09:12:00Z" },
  { id: "env-2", name: "DATABASE_URL", byteSize: 74, updatedAt: "2026-07-09T17:41:00Z" },
  { id: "env-3", name: "SENTRY_DSN", byteSize: 91, updatedAt: "2026-06-28T11:02:00Z" },
];

const FILES = [
  { id: "file-1", path: ".npmrc", byteSize: 212, updatedAt: "2026-07-14T09:12:00Z" },
  { id: "file-2", path: "config/gcloud-service-account.json", byteSize: 2_318, updatedAt: "2026-07-02T08:30:00Z" },
];

const COMMON = {
  filePathMode: "relative",
  onSaveEnvVar: () => undefined,
  onDeleteEnvVar: () => undefined,
  onSaveFile: () => undefined,
  onDeleteFile: () => undefined,
};

export const PersonalSecrets = () => (
  <Pane>
    <SecretManagementPanel
      {...COMMON}
      title="Personal secrets"
      description="Available in every cloud sandbox you start. Never shared with your organization."
      envVars={ENV_VARS}
      files={FILES}
      materialization={{ status: "ready", lastError: null, materializedAt: "2026-07-14T09:12:30Z" }}
    />
  </Pane>
);

export const NoSecretsYet = () => (
  <Pane>
    <SecretManagementPanel
      {...COMMON}
      title="Repository secrets"
      description="Injected into cloud sandboxes created from proliferate/anyharness."
      envVars={[]}
      files={[]}
      materialization={{ status: "ready", lastError: null, materializedAt: null }}
    />
  </Pane>
);

export const ReadOnlyForMembers = () => (
  <Pane>
    <SecretManagementPanel
      {...COMMON}
      title="Organization secrets"
      description="Managed by organization owners. Available to every member's cloud sandbox."
      envVars={ENV_VARS}
      files={[]}
      canManage={false}
      materialization={{ status: "ready", lastError: null, materializedAt: "2026-07-11T14:20:00Z" }}
    />
  </Pane>
);

export const MaterializationError = () => (
  <Pane>
    <SecretManagementPanel
      {...COMMON}
      title="Personal secrets"
      description="Available in every cloud sandbox you start. Never shared with your organization."
      envVars={ENV_VARS}
      files={FILES}
      error="Could not write config/gcloud-service-account.json — the sandbox filesystem is read-only."
      materialization={{
        status: "error",
        lastError: "Could not write config/gcloud-service-account.json.",
        materializedAt: "2026-07-14T09:12:30Z",
      }}
    />
  </Pane>
);
