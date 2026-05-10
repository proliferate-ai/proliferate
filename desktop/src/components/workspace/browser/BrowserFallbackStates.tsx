import { Button } from "@/components/ui/Button";
import { CircleAlert, ExternalLink, Globe } from "@/components/ui/icons";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

export function BrowserUnavailableOverlay({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  const { openExternal } = useTauriShellActions();

  return (
    <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-sidebar-background/95 px-8 backdrop-blur">
      <div className="flex max-w-72 flex-col items-center text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-lg border border-sidebar-border bg-foreground/5 text-sidebar-muted-foreground">
          <CircleAlert className="size-5" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-sidebar-muted-foreground">
          {description}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-4 h-7 border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => {
            void openExternal(url);
          }}
        >
          <ExternalLink className="size-3.5" />
          Open externally
        </Button>
      </div>
    </div>
  );
}

export function BrowserEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="flex max-w-72 flex-col items-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-lg border border-sidebar-border bg-foreground/5 text-sidebar-muted-foreground">
          <Globe className="size-6 opacity-70" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-sidebar-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
