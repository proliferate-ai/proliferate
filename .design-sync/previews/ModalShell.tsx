import { Button, Input, Label, ModalShell, Spinner } from "@proliferate/ui";

const noop = () => {};

export const DeleteWorkspace = () => (
  <ModalShell
    open
    onClose={noop}
    title="Delete workspace?"
    description="proliferate/server · claude/design-sync-ui-import"
    footer={
      <>
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button variant="destructive" size="sm">Delete workspace</Button>
      </>
    }
  >
    <p className="text-ui text-muted-foreground">
      The sandbox and its uncommitted changes are removed immediately. Branches already
      pushed to origin are not affected.
    </p>
  </ModalShell>
);

export const AddRepository = () => (
  <ModalShell
    open
    onClose={noop}
    title="Add repository"
    description="Connect a GitHub repository to run agents against."
    footer={
      <>
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button size="sm">Add repository</Button>
      </>
    }
  >
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="modal-repo">Repository</Label>
        <Input id="modal-repo" defaultValue="anthropics/proliferate" placeholder="owner/repo" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="modal-branch">Default branch</Label>
        <Input id="modal-branch" defaultValue="main" placeholder="main" />
      </div>
      <p className="text-ui-sm text-muted-foreground">
        Proliferate clones over the GitHub App installation — no personal token is stored.
      </p>
    </div>
  </ModalShell>
);

export const WideWithHeaderContent = () => (
  <ModalShell
    open
    onClose={noop}
    sizeClassName="max-w-2xl"
    title="Review changes"
    description="12 files changed across 3 commits"
    headerContent={
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-title font-medium tracking-tight text-foreground">Review changes</span>
          <span className="text-ui text-muted-foreground">
            claude/design-sync-ui-import → main · 12 files
          </span>
        </div>
        <Button variant="secondary" size="sm">Open in editor</Button>
      </div>
    }
    footer={
      <>
        <Button variant="ghost" size="sm">Request changes</Button>
        <Button size="sm">Approve and merge</Button>
      </>
    }
  >
    <div className="flex flex-col gap-2">
      {[
        { path: "apps/packages/ui/src/patterns/ModalShell.tsx", added: 42, removed: 8 },
        { path: "apps/packages/ui/src/primitives/PopoverButton.tsx", added: 17, removed: 3 },
        { path: "apps/packages/product-ui/src/patterns/ModelTable.tsx", added: 96, removed: 21 },
      ].map((file) => (
        <div
          key={file.path}
          className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2"
        >
          <span className="min-w-0 truncate font-mono text-readable-code text-foreground">{file.path}</span>
          <span className="shrink-0 text-ui-sm">
            <span className="text-git-green">+{file.added}</span>{" "}
            <span className="text-git-red">−{file.removed}</span>
          </span>
        </div>
      ))}
    </div>
  </ModalShell>
);

export const BlockingProgress = () => (
  <ModalShell
    open
    onClose={noop}
    disableClose
    showCloseButton={false}
    title="Provisioning sandbox"
    description="This takes about a minute — the window stays open until it finishes."
    footer={<Button variant="ghost" size="sm">Cancel provisioning</Button>}
  >
    <div className="flex items-center gap-3">
      <Spinner className="icon-paired text-muted-foreground" />
      <span className="text-ui text-foreground">Cloning anthropics/proliferate (2.1 GB)…</span>
    </div>
  </ModalShell>
);
