import { CloudEnvironmentConfigSection } from "@proliferate/ui";

const noop = () => {};

const BRANCHES = ["main", "release/0.7", "claude/design-sync-ui-import", "pablo/cloud-secrets"];

const SETUP_SCRIPT = "pnpm install --frozen-lockfile\npnpm -F \"@proliferate/product-ui...\" build";

export const Saved = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentConfigSection
      statusLabel="Saved"
      statusTone="success"
      defaultBranch={null}
      githubDefaultBranch="main"
      branches={BRANCHES}
      setupScript={SETUP_SCRIPT}
      runCommand="make dev"
      saveDisabled
      revertDisabled
      onDefaultBranchChange={noop}
      onSetupScriptChange={noop}
      onRunCommandChange={noop}
      onSave={noop}
      onRevert={noop}
    />
  </div>
);

export const UnsavedChanges = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentConfigSection
      statusLabel="Unsaved changes"
      statusTone="info"
      defaultBranch="release/0.7"
      githubDefaultBranch="main"
      branches={BRANCHES}
      setupScript={SETUP_SCRIPT}
      runCommand="pnpm dev --host"
      onDefaultBranchChange={noop}
      onSetupScriptChange={noop}
      onRunCommandChange={noop}
      onSave={noop}
      onRevert={noop}
    />
  </div>
);

export const Saving = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentConfigSection
      statusLabel="Saving"
      statusTone="neutral"
      defaultBranch="main"
      githubDefaultBranch="main"
      branches={BRANCHES}
      setupScript={SETUP_SCRIPT}
      runCommand="make dev"
      saving
      revertDisabled
      onDefaultBranchChange={noop}
      onSetupScriptChange={noop}
      onRunCommandChange={noop}
      onSave={noop}
      onRevert={noop}
    />
  </div>
);

export const BranchLoadFailed = () => (
  <div className="w-full max-w-3xl">
    <CloudEnvironmentConfigSection
      statusLabel="Not saved"
      statusTone="destructive"
      defaultBranch="release/0.6"
      githubDefaultBranch={null}
      branches={[]}
      branchError="GitHub branches could not be listed — the App installation was revoked."
      setupScript=""
      runCommand=""
      error="Save failed: the cloud environment for proliferate-ai/proliferate is not authorized."
      onDefaultBranchChange={noop}
      onSetupScriptChange={noop}
      onRunCommandChange={noop}
      onSave={noop}
      onRevert={noop}
    />
  </div>
);
