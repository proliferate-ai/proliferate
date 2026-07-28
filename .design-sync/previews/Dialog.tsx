import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  GitBranch,
} from "@proliferate/ui";

export const RenameThread = () => (
  <Dialog defaultOpen modal={false}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename thread</DialogTitle>
        <DialogDescription>
          Threads are renamed everywhere they appear — sidebar, command palette, and share links.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 pt-4">
        <Label htmlFor="ds-dialog-thread-name">Thread name</Label>
        <Input
          id="ds-dialog-thread-name"
          defaultValue="Design sync — preview authoring"
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button size="sm">Save name</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const AddRepository = () => (
  <Dialog defaultOpen modal={false}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add a repository</DialogTitle>
        <DialogDescription>
          Proliferate clones the default branch into a fresh sandbox the first time an agent runs.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 pt-4">
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="flex items-center gap-2 text-ui text-foreground">
            <GitBranch className="icon-paired text-muted-foreground" />
            proliferate/proliferate
          </span>
          <Badge tone="success">Connected</Badge>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="flex items-center gap-2 text-ui text-foreground">
            <GitBranch className="icon-paired text-muted-foreground" />
            proliferate/anyharness
          </span>
          <Badge tone="neutral">Read only</Badge>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button size="sm">Add repository</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const WithTriggerBehind = () => (
  <Dialog defaultOpen modal={false}>
    <DialogTrigger asChild>
      <Button variant="secondary" size="sm">Manage environment</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Restart sandbox</DialogTitle>
        <DialogDescription>
          sandbox-us-east-2 will be rebuilt from the environment image. Running agents are stopped first.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button variant="destructive" size="sm">Restart</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const NoCloseButton = () => (
  <Dialog defaultOpen modal={false}>
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Finish connecting GitHub</DialogTitle>
        <DialogDescription>
          The installation needs repository access before agents can open pull requests.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button size="sm">Continue to GitHub</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
