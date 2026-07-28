import { CloudRepoPickerBlocker } from "@proliferate/ui";

const noop = () => {};

// The blocker is the picker body's "prerequisite" branch, so it renders inside
// the same 440px modal panel CloudRepoPickerDialog provides.
const PANEL = "w-full max-w-md rounded-xl border border-border bg-background p-4";

export const AuthorizeGitHub = () => (
  <div className={PANEL}>
    <CloudRepoPickerBlocker
      blocker={{
        title: "Connect GitHub to run in the cloud",
        description:
          "Proliferate clones your repository into a managed sandbox and pushes agent commits back to a branch.",
        steps: [
          {
            label: "Authorize Proliferate",
            description: "Grants read access to the repositories you pick.",
            status: "current",
          },
          {
            label: "Install the GitHub App",
            description: "Scoped per organization — you choose the repositories.",
            status: "upcoming",
          },
          {
            label: "Pick a repository",
            description: "proliferate/proliferate and anything else you granted.",
            status: "upcoming",
          },
        ],
        actionLabel: "Authorize on GitHub",
        onAction: noop,
      }}
    />
  </div>
);

export const InstallAppStep = () => (
  <div className={PANEL}>
    <CloudRepoPickerBlocker
      blocker={{
        title: "Install the GitHub App on proliferate-ai",
        description:
          "Your account is authorized, but the app is not installed on the organization that owns proliferate/proliferate.",
        steps: [
          {
            label: "Authorize Proliferate",
            description: "Signed in as pablosfsanchez 4 minutes ago.",
            status: "complete",
          },
          {
            label: "Install the GitHub App",
            description: "An owner of proliferate-ai has to approve the install.",
            status: "current",
          },
          {
            label: "Pick a repository",
            description: "Granted repositories appear here immediately after.",
            status: "upcoming",
          },
        ],
        actionLabel: "Install on proliferate-ai",
        actionLoading: true,
        onAction: noop,
      }}
    />
  </div>
);

export const NoOrganizationAccess = () => (
  <div className={PANEL}>
    <CloudRepoPickerBlocker
      blocker={{
        title: "No organizations with cloud access",
        description:
          "The GitHub App is installed, but none of the organizations you belong to have granted repository access yet. Ask an owner of proliferate-ai to add repositories to the install.",
      }}
    />
  </div>
);
