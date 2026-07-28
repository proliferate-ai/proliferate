import { CloudEnvironmentList } from "@proliferate/ui";

const noop = () => {};

const ENVIRONMENTS = [
  {
    id: "proliferate-ai/proliferate",
    fullName: "proliferate-ai/proliferate",
    description: "Default branch main · setup.sh runs pnpm install",
    cloudStatus: "ready",
  },
  {
    id: "proliferate-ai/anyharness",
    fullName: "proliferate-ai/anyharness",
    description: "Default branch main · cargo build --workspace",
    cloudStatus: "running",
  },
  {
    id: "proliferate-ai/cloud-sdk",
    fullName: "proliferate-ai/cloud-sdk",
    description: "Default branch release/0.7 · no setup script",
    cloudStatus: "error",
  },
];

export const WithEnvironments = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentList
      cloudEnvironments={ENVIRONMENTS}
      onSelectCloudEnvironment={noop}
      onAddCloudEnvironment={noop}
    />
  </div>
);

export const EmptyState = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentList
      cloudEnvironments={[]}
      onSelectCloudEnvironment={noop}
      onAddCloudEnvironment={noop}
    />
  </div>
);

export const LoadFailed = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentList
      cloudEnvironments={[ENVIRONMENTS[0]]}
      cloudErrorMessage="Proliferate Cloud did not respond while listing environments."
      onSelectCloudEnvironment={noop}
      onRetryCloudEnvironments={noop}
      onAddCloudEnvironment={noop}
    />
  </div>
);

export const CloudUnavailable = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentList
      title="Environments"
      description="GitHub repositories that run in Proliferate Cloud."
      cloudEnvironments={[]}
      cloudUnavailableReason="Cloud is disabled for this workspace. Ask an owner to enable Proliferate Cloud."
      onSelectCloudEnvironment={noop}
      onAddCloudEnvironment={noop}
    />
  </div>
);
