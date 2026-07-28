import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  CloudIcon,
  GitBranch,
  Monitor,
} from "@proliferate/ui";

export const DeleteWorkspace = () => (
  <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete workspace “proliferate-web”?</AlertDialogTitle>
        <AlertDialogDescription>
          The cloud sandbox, its checkout of claude/design-sync-ui-import, and 3
          uncommitted files are destroyed. Session history is kept. This cannot
          be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Delete workspace</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export const ReconcileGitState = () => (
  <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Reconcile Git state</AlertDialogTitle>
        <AlertDialogDescription>
          Compare this Mac and Cloud and choose the one safe next step.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-ui text-foreground">
            <Monitor className="icon-paired text-muted-foreground" />
            This Mac
          </span>
          <span className="flex items-center gap-2 text-ui-sm text-muted-foreground">
            <GitBranch className="icon-compact" />
            claude/design-sync-ui-import · 2 ahead
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-ui text-foreground">
            <CloudIcon className="icon-paired text-muted-foreground" />
            Cloud sandbox
          </span>
          <span className="flex items-center gap-2 text-ui-sm text-muted-foreground">
            <GitBranch className="icon-compact" />
            claude/design-sync-ui-import · 7 ahead
          </span>
        </div>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Pull from Cloud</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export const TriggerInDangerZone = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-96 rounded-lg border border-border bg-surface-elevated p-4">
      <div className="text-body-emphasis text-foreground">Danger zone</div>
      <p className="mt-1 text-ui-sm text-muted-foreground">
        Removing this repository detaches every workspace that checks it out and
        revokes the GitHub App installation token.
      </p>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" className="mt-3">
            Remove repository
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove anthropics/proliferate?</AlertDialogTitle>
            <AlertDialogDescription>
              4 workspaces currently check out this repository. They will stop
              syncing immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep repository</AlertDialogCancel>
            <AlertDialogAction>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
