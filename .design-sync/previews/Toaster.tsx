import { useEffect, type ReactNode } from "react";
import {
  Badge,
  Button,
  GitBranch,
  SquareTerminal,
  Toaster,
  toast,
} from "@proliferate/ui";

/**
 * `Toaster` is a mount point: it renders an empty fixed region until something
 * calls `toast()`, so a still capture of the bare component is blank. Every
 * cell here pushes a real toast on mount with `duration: Infinity` (the shot
 * would otherwise race the 4 s auto-dismiss) over a stand-in workspace pane, so
 * the toast is photographed the way it actually lands in the product.
 */
function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-full" style={{ height: 560 }}>
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-heading text-foreground">anyharness</p>
            <p className="mt-0.5 text-ui-sm text-muted-foreground">
              feature/session-activity · ~/src/anyharness
            </p>
          </div>
          <Badge tone="success">Ready</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary">
            <GitBranch className="icon-paired" />
            Push branch
          </Button>
          <Button type="button" size="sm" variant="secondary">
            <SquareTerminal className="icon-paired" />
            Open terminal
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function useToastOnMount(push: () => void) {
  useEffect(() => {
    toast.dismiss();
    push();
    return () => toast.dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const Notification = () => {
  useToastOnMount(() => {
    toast("Workspace created", {
      description: "feature/session-activity is ready.",
      duration: Infinity,
    });
  });
  return (
    <Backdrop>
      <Toaster />
    </Backdrop>
  );
};

export const WithAction = () => {
  useToastOnMount(() => {
    toast("Branch pushed to origin", {
      description: "12 commits on feature/session-activity.",
      duration: Infinity,
      action: { label: "Open PR", onClick: () => undefined },
    });
  });
  return (
    <Backdrop>
      <Toaster />
    </Backdrop>
  );
};

export const Stacked = () => {
  useToastOnMount(() => {
    toast.success("Secrets materialized", {
      description: "8 environment variables synced to the sandbox.",
      duration: Infinity,
    });
    toast("Setup script finished", {
      description: "pnpm install completed in 41s.",
      duration: Infinity,
    });
    toast.error("Cloud workspace unreachable", {
      description: "Reconnect, or retry the managed run.",
      duration: Infinity,
    });
  });
  return (
    <Backdrop>
      <Toaster />
    </Backdrop>
  );
};

export const TopRight = () => {
  useToastOnMount(() => {
    toast("Run queued in Managed Cloud", {
      description: "Issue triage · revision 4",
      duration: Infinity,
    });
  });
  return (
    <Backdrop>
      <Toaster position="top-right" />
    </Backdrop>
  );
};
