import { AddRepoFlow } from "@proliferate/ui";

const noop = () => {};

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
    id: "pablo-hansen/dotfiles",
    fullName: "pablo-hansen/dotfiles",
    defaultBranch: "master",
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    permission: "admin",
    configured: false,
    repoConfigState: "disabled",
  },
];

const PICKER = {
  query: "",
  manualValue: "",
  repositories: REPOSITORIES,
  onQueryChange: noop,
  onManualValueChange: noop,
  onAddRepository: noop,
  onAddManual: noop,
  onLoadMore: noop,
};

export const DesktopEntry = () => (
  <AddRepoFlow
    open
    step={{ kind: "entry" }}
    options={["add-existing-folder", "clone-from-github", "cloud"]}
    onPickOption={noop}
    onBack={noop}
    onClose={noop}
  />
);

export const WebEntry = () => (
  <AddRepoFlow
    open
    step={{ kind: "entry" }}
    options={["cloud"]}
    onPickOption={noop}
    onBack={noop}
    onClose={noop}
  />
);

export const CloudStep = () => (
  <AddRepoFlow
    open
    step={{ kind: "cloud" }}
    options={["add-existing-folder", "cloud"]}
    cloudPicker={PICKER}
    onPickOption={noop}
    onBack={noop}
    onClose={noop}
  />
);

export const CloneStepWithError = () => (
  <AddRepoFlow
    open
    step={{ kind: "clone" }}
    options={["add-existing-folder", "clone-from-github", "cloud"]}
    clonePicker={{ ...PICKER, query: "anyharness", repositories: [REPOSITORIES[1]] }}
    error="Clone failed: ~/proliferate already contains a git repository."
    onPickOption={noop}
    onBack={noop}
    onClose={noop}
  />
);
