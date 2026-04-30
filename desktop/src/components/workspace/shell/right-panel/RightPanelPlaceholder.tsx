import type { RightPanelTool } from "@/lib/domain/workspaces/right-panel";

export function RightPanelPlaceholder({ tool }: { tool: RightPanelTool }) {
  const title = tool === "files"
    ? "Files are getting ready"
    : tool === "terminal"
      ? "Terminals are getting ready"
      : tool === "settings"
        ? "Cloud settings are getting ready"
        : "Git view is getting ready";
  const description = tool === "files"
    ? "The file tree will appear here as soon as the workspace finishes loading."
    : tool === "terminal"
      ? "Terminals will connect once the workspace runtime is ready."
      : tool === "settings"
        ? "Repo sync status and setup controls will appear once the cloud workspace finishes loading."
        : "Changes and diffs will appear here as soon as the workspace finishes loading.";

  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-xs space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
