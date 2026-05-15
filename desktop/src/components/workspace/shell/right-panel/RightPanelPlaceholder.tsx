import {
  parseRightPanelHeaderEntryKey,
  type RightPanelActiveEntryKey,
} from "@/lib/domain/workspaces/shell/right-panel-model";

export function RightPanelPlaceholder({ activeEntryKey }: { activeEntryKey: RightPanelActiveEntryKey }) {
  const entry = parseRightPanelHeaderEntryKey(activeEntryKey);
  const kind = entry?.kind === "tool" ? entry.tool : entry?.kind ?? "git";
  const title = kind === "terminal"
    ? "Terminals are getting ready"
    : kind === "browser"
      ? "Browser is getting ready"
      : kind === "settings"
        ? "Cloud settings are getting ready"
        : "Git view is getting ready";
  const description = kind === "terminal"
    ? "Terminals will connect once the workspace runtime is ready."
    : kind === "browser"
      ? "Browser tabs will appear once the workspace is ready."
      : kind === "settings"
        ? "Repo sync status and setup controls will appear once the cloud workspace finishes loading."
        : "Changes and diffs will appear here as soon as the workspace finishes loading.";

  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-xs space-y-2">
        <p className="text-base font-[450] text-sidebar-foreground">{title}</p>
        <p className="text-sm leading-5 text-sidebar-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
