import { CloudRepoPickerDialog } from "@proliferate/ui";

const noop = () => {};

const REPOSITORIES = [
  {
    id: "r1",
    fullName: "proliferate-ai/proliferate",
    defaultBranch: "main",
    private: true,
    fork: false,
    archived: false,
    disabled: false,
    permission: "admin",
    configured: true,
    repoConfigState: "configured" as const,
    pushedAt: "2026-07-28T09:12:00Z",
  },
  {
    id: "r2",
    fullName: "proliferate-ai/anyharness",
    defaultBranch: "main",
    private: true,
    fork: false,
    archived: false,
    disabled: false,
    permission: "write",
    configured: false,
    repoConfigState: "missing" as const,
    pushedAt: "2026-07-27T18:40:00Z",
  },
  {
    id: "r3",
    fullName: "proliferate-ai/design-tokens",
    defaultBranch: "main",
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    permission: "read",
    configured: false,
    repoConfigState: "disabled" as const,
  },
  {
    id: "r4",
    fullName: "pablosfsanchez/shiki",
    defaultBranch: null,
    private: false,
    fork: true,
    archived: false,
    disabled: false,
    permission: "admin",
    configured: false,
    repoConfigState: "missing" as const,
    disabledReason: "Fork has no default branch — push a commit first",
  },
];

const HANDLERS = {
  onClose: noop,
  onQueryChange: noop,
  onManualValueChange: noop,
  onAddRepository: noop,
  onAddManual: noop,
  onLoadMore: noop,
  onRetry: noop,
};

export const RepositoryList = () => (
  <CloudRepoPickerDialog
    open
    query=""
    manualValue=""
    repositories={REPOSITORIES}
    nextCursor="Y3Vyc29yOjIw"
    {...HANDLERS}
  />
);

export const AddingRepository = () => (
  <CloudRepoPickerDialog
    open
    title="Add a cloud repository"
    description="Agents clone it into a managed sandbox on first run."
    query="prolif"
    manualValue="proliferate-ai/catalogs"
    repositories={REPOSITORIES.slice(0, 3)}
    addingRepoId="r2"
    {...HANDLERS}
  />
);

export const LoadingRepositories = () => (
  <CloudRepoPickerDialog
    open
    query=""
    manualValue=""
    repositories={[]}
    loading
    {...HANDLERS}
  />
);

export const BlockedOnGitHubApp = () => (
  <CloudRepoPickerDialog
    open
    query=""
    manualValue=""
    repositories={[]}
    blocker={{
      title: "Connect GitHub to run in the cloud",
      description:
        "Proliferate clones your repository into a managed sandbox and pushes agent commits back to a branch.",
      steps: [
        {
          label: "Authorize Proliferate",
          description: "Grants read access to the repositories you pick.",
          status: "complete",
        },
        {
          label: "Install the GitHub App",
          description: "Scoped per organization — you choose the repositories.",
          status: "current",
        },
      ],
      actionLabel: "Install on proliferate-ai",
      onAction: noop,
    }}
    {...HANDLERS}
  />
);
