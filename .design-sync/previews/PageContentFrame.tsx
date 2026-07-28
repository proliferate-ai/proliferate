import {
  Badge,
  Button,
  GitBranch,
  PageContentFrame,
  PageHeader,
  Plus,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@proliferate/ui";

const noop = () => {};

export const SettingsPage = () => (
  <div className="h-96 w-full overflow-hidden rounded-lg border border-border">
    <PageContentFrame
      header={
        <PageHeader
          className="border-b-0 px-0 sm:px-0 sm:py-0"
          title="Agent defaults"
          description="Applied to every new workspace unless a repository overrides them."
          actions={<Button size="sm">Save changes</Button>}
        />
      }
    >
      <SettingsSection
        title="Execution"
        description="How agents run inside a cloud sandbox."
      >
        <SettingsRow
          label="Auto-approve safe commands"
          description="Reads, greps and test runs execute without a prompt."
        >
          <Switch checked onChange={noop} />
        </SettingsRow>
        <SettingsRow
          label="Idle shutdown"
          description="Stop the sandbox after 30 minutes without activity."
        >
          <Switch checked onChange={noop} />
        </SettingsRow>
      </SettingsSection>
    </PageContentFrame>
  </div>
);

export const NarrowColumn = () => (
  <div className="h-96 w-full overflow-hidden rounded-lg border border-border">
    <PageContentFrame
      maxWidthClassName="max-w-md"
      header={
        <PageHeader
          className="border-b-0 px-0 sm:px-0 sm:py-0"
          title="Add repository"
          description="Pick a repository the GitHub App can reach."
        />
      }
    >
      <div className="flex flex-col gap-2">
        {["anthropics/proliferate", "anthropics/anyharness", "anthropics/catalogs"].map((repo) => (
          <div
            key={repo}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <span className="min-w-0 truncate text-ui text-foreground">{repo}</span>
            <Button variant="secondary" size="sm">
              <Plus className="icon-paired" />
              Add
            </Button>
          </div>
        ))}
      </div>
    </PageContentFrame>
  </div>
);

export const ScrollingList = () => (
  <div className="h-96 w-full overflow-hidden rounded-lg border border-border">
    <PageContentFrame
      stickyTitle="Workspaces"
      stickyAction={<Button size="sm">New workspace</Button>}
      header={
        <PageHeader
          className="border-b-0 px-0 sm:px-0 sm:py-0"
          title="Workspaces"
          description="12 sandboxes running across 3 repositories."
          actions={<Button size="sm">New workspace</Button>}
        />
      }
    >
      <div className="flex flex-col gap-2">
        {[
          { branch: "claude/design-sync-ui-import", repo: "anthropics/proliferate", state: "Running" },
          { branch: "fix/sandbox-idle-timeout", repo: "anthropics/proliferate", state: "Running" },
          { branch: "feat/model-catalog-table", repo: "anthropics/proliferate", state: "Idle" },
          { branch: "chore/bump-playwright", repo: "anthropics/anyharness", state: "Idle" },
          { branch: "release/2026.07", repo: "anthropics/catalogs", state: "Stopped" },
        ].map((row) => (
          <div
            key={row.branch}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="icon-paired text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-ui text-foreground">{row.branch}</span>
                <span className="truncate text-ui-sm text-muted-foreground">{row.repo}</span>
              </div>
            </div>
            <Badge tone={row.state === "Running" ? "success" : "neutral"}>{row.state}</Badge>
          </div>
        ))}
      </div>
    </PageContentFrame>
  </div>
);
