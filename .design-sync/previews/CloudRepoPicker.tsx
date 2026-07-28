import type { ReactNode } from "react";
import { CloudRepoPicker } from "@proliferate/ui";

const noop = () => {};

const HANDLERS = {
  onQueryChange: noop,
  onManualValueChange: noop,
  onAddRepository: noop,
  onAddManual: noop,
  onLoadMore: noop,
};

const REPOSITORIES = [
  {
    id: "proliferate-ai/proliferate",
    fullName: "proliferate-ai/proliferate",
    defaultBranch: "main",
    private: true,
    fork: false,
    archived: false,
    disabled: false,
    permission: "admin",
    configured: true,
    repoConfigState: "configured",
  },
  {
    id: "proliferate-ai/anyharness",
    fullName: "proliferate-ai/anyharness",
    defaultBranch: "main",
    private: true,
    fork: false,
    archived: false,
    disabled: false,
    permission: "write",
    configured: false,
    repoConfigState: "missing",
  },
  {
    id: "proliferate-ai/cloud-sdk",
    fullName: "proliferate-ai/cloud-sdk",
    defaultBranch: "release/0.7",
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    permission: "read",
    configured: false,
    repoConfigState: "disabled",
  },
  {
    id: "pablo-hansen/proliferate",
    fullName: "pablo-hansen/proliferate",
    defaultBranch: null,
    private: false,
    fork: true,
    archived: false,
    disabled: false,
    permission: "admin",
    configured: false,
    repoConfigState: "missing",
  },
];

/** The picker body is presentational; the dialog chrome comes from the host. */
const DialogChrome = ({ children }: { children: ReactNode }) => (
  <div
    className="rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-popover"
    style={{ width: 440 }}
  >
    <div className="pb-3">
      <div className="text-body-emphasis font-medium text-foreground">Add cloud environment</div>
      <p className="text-ui-sm text-muted-foreground">
        Pick a GitHub repository to run in your cloud sandbox.
      </p>
    </div>
    {children}
  </div>
);

export const Repositories = () => (
  <DialogChrome>
    <CloudRepoPicker
      {...HANDLERS}
      query=""
      manualValue=""
      repositories={REPOSITORIES}
      nextCursor="cursor:page-2"
    />
  </DialogChrome>
);

export const AddingRepository = () => (
  <DialogChrome>
    <CloudRepoPicker
      {...HANDLERS}
      query="proliferate"
      manualValue=""
      repositories={REPOSITORIES.slice(0, 3)}
      addingRepoId="proliferate-ai/anyharness"
    />
  </DialogChrome>
);

export const LoadingRepositories = () => (
  <DialogChrome>
    <CloudRepoPicker {...HANDLERS} query="" manualValue="" repositories={[]} loading />
  </DialogChrome>
);

export const NoMatches = () => (
  <DialogChrome>
    <CloudRepoPicker
      {...HANDLERS}
      query="kubernetes"
      manualValue="proliferate-ai/anyharness"
      repositories={[]}
      error="GitHub authorization expired — reconnect the Proliferate GitHub App to list repositories."
      onRetry={noop}
    />
  </DialogChrome>
);

export const PrerequisiteBlocker = () => (
  <DialogChrome>
    <CloudRepoPicker
      {...HANDLERS}
      query=""
      manualValue=""
      repositories={[]}
      blocker={{
        title: "Authorize GitHub App",
        description:
          "Authorize the Proliferate GitHub App so Cloud can use your GitHub identity to clone and push.",
        actionLabel: "Authorize GitHub App",
        steps: [
          {
            label: "Sign in with GitHub",
            description: "Your account is linked to @pablo-hansen.",
            status: "complete",
          },
          {
            label: "Authorize the App",
            description: "Grants Cloud a user-to-server token.",
            status: "current",
          },
          {
            label: "Install on the org",
            description: "Pick which repositories Cloud can reach.",
            status: "upcoming",
          },
        ],
        onAction: noop,
      }}
    />
  </DialogChrome>
);
